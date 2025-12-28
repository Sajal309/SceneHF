import uuid
from pathlib import Path
from typing import Optional

from app.models.schemas import (
    Job, Step, StepType, StepStatus, StepAction,
    JobStatus, AssetKind
)
from app.core.storage import storage
from app.core.pubsub import pubsub
from app.core.validators import validator
from app.services.vertex_image import vertex_service
from app.services.fal_bgremove import fal_service
from app.services.openai_image import get_openai_image_service


class Runner:
    """Step execution orchestrator."""
    
    async def run_step(
        self,
        job_id: str,
        step_id: str,
        custom_prompt: Optional[str] = None
    ) -> Step:
        """
        Run a single step.
        
        Args:
            job_id: Job ID
            step_id: Step ID
            custom_prompt: Optional custom prompt override
        
        Returns:
            Updated step
        """
        job = storage.load_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        step = next((s for s in job.steps if s.id == step_id), None)
        if not step:
            raise ValueError(f"Step {step_id} not found")
        
        # Update status to RUNNING
        step.status = StepStatus.RUNNING
        storage.save_job(job)
        pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
        pubsub.emit_log(job_id, f"Starting step: {step.name}")
        
        try:
            # Get input asset
            if step.input_asset_id:
                input_path = storage.get_asset_path(job_id, step.input_asset_id)
            else:
                # Use source image
                input_path = storage.get_asset_path(job_id, job.source_image)
            
            if not input_path:
                raise ValueError("Input asset not found")
            
            # Get source image for validation
            source_path = storage.get_asset_path(job_id, job.source_image)
            
            # Determine prompt
            prompt = custom_prompt or step.custom_prompt or step.prompt
            
            pubsub.emit_log(job_id, f"Using prompt: {prompt[:100]}...")
            
            # Route to appropriate service
            output_path = None
            
            if step.type == StepType.BG_REMOVE:
                pubsub.emit_log(job_id, "Calling Fal.ai background removal...")
                output_path = fal_service.remove_bg(
                    str(input_path),
                    output_dir=str(storage._assets_dir(job_id))
                )
            
            elif step.type in (StepType.EXTRACT, StepType.REMOVE):
                # Check if image config specifies OpenAI
                image_config = job.metadata.get("image_config", {}) if job.metadata else {}
                image_provider = image_config.get("provider", "vertex")
                
                if image_provider == "openai":
                    pubsub.emit_log(job_id, "Calling OpenAI image generation...")
                    api_key = job.metadata.get("image_api_key") if job.metadata else None
                    openai_service = get_openai_image_service(api_key=api_key)
                    
                    if not openai_service:
                        raise RuntimeError("OpenAI image service not available")
                    
                    output_filename = f"output_{uuid.uuid4().hex[:8]}.png"
                    output_path = str(storage._assets_dir(job_id) / output_filename)
                    
                    if step.type == StepType.EXTRACT:
                        output_path = openai_service.extract(
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                    else:  # REMOVE
                        output_path = openai_service.remove(
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                else:
                    # Use Vertex AI (default)
                    pubsub.emit_log(job_id, "Calling Vertex AI image edit...")
                    output_path = vertex_service.edit_image(
                        str(input_path),
                        prompt,
                        output_dir=str(storage._assets_dir(job_id))
                    )
            
            else:
                raise ValueError(f"Unknown step type: {step.type}")
            
            if not output_path:
                raise RuntimeError("Service returned no output")
            
            pubsub.emit_log(job_id, f"Output generated: {Path(output_path).name}")
            
            # Save output asset
            asset_kind = AssetKind.LAYER if step.type == StepType.EXTRACT else AssetKind.PLATE
            if step.type == StepType.BG_REMOVE:
                asset_kind = AssetKind.BG_REMOVED
            
            asset = storage.save_asset(
                job_id,
                output_path,
                asset_kind
            )
            
            step.output_asset_id = asset.id
            
            # Validate output
            pubsub.emit_log(job_id, "Validating output...")
            
            validation_rules = {}
            if job.plan:
                plan_step = next((ps for ps in job.plan.steps if ps.id == step.id), None)
                if plan_step:
                    validation_rules = plan_step.validation_rules
            
            if step.type == StepType.EXTRACT:
                validation = validator.validate_extraction(
                    output_path,
                    str(source_path),
                    validation_rules
                )
            elif step.type == StepType.REMOVE:
                validation = validator.validate_plate(
                    output_path,
                    str(source_path),
                    validation_rules
                )
            else:
                # BG_REMOVE - basic validation
                validation = validator.validate_extraction(
                    output_path,
                    str(source_path),
                    {"min_nonwhite": 0.01, "max_nonwhite": 0.8}
                )
            
            step.validation = validation
            step.status = validation.status
            
            # Set available actions based on status
            if step.status in (StepStatus.SUCCESS, StepStatus.NEEDS_REVIEW):
                step.actions_available = [
                    StepAction.ACCEPT,
                    StepAction.RETRY,
                    StepAction.BG_REMOVE,
                    StepAction.PLATE_AND_RETRY
                ]
            elif step.status == StepStatus.FAILED:
                step.actions_available = [
                    StepAction.RETRY,
                    StepAction.PLATE_AND_RETRY
                ]
            
            pubsub.emit_log(
                job_id,
                f"Step completed with status: {step.status.value}",
                level="success" if step.status == StepStatus.SUCCESS else "warning"
            )
            pubsub.emit_log(job_id, f"Validation: {validation.notes}")
            
            # Save job
            storage.save_job(job)
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            
            return step
            
        except Exception as e:
            step.status = StepStatus.FAILED
            step.logs.append(f"Error: {str(e)}")
            storage.save_job(job)
            pubsub.emit_log(job_id, f"Step failed: {str(e)}", level="error")
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            raise
    
    async def run_job(self, job_id: str) -> Job:
        """
        Run all steps in a job sequentially until pause/fail/done.
        
        Args:
            job_id: Job ID
        
        Returns:
            Updated job
        """
        job = storage.load_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        job.status = JobStatus.RUNNING
        storage.save_job(job)
        pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
        pubsub.emit_log(job_id, "Starting job execution...")
        
        try:
            for step in job.steps:
                if step.status != StepStatus.QUEUED:
                    continue
                
                await self.run_step(job_id, step.id)
                
                # Reload job to get updated step
                job = storage.load_job(job_id)
                step = next(s for s in job.steps if s.id == step.id)
                
                # Check if we should pause
                if step.status == StepStatus.NEEDS_REVIEW:
                    job.status = JobStatus.PAUSED
                    storage.save_job(job)
                    pubsub.emit_log(job_id, "Job paused - step needs review", level="warning")
                    pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
                    return job
                
                if step.status == StepStatus.FAILED:
                    job.status = JobStatus.FAILED
                    storage.save_job(job)
                    pubsub.emit_log(job_id, "Job failed", level="error")
                    pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
                    return job
            
            # All steps completed
            job.status = JobStatus.DONE
            storage.save_job(job)
            pubsub.emit_log(job_id, "Job completed successfully!", level="success")
            pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
            
            return job
            
        except Exception as e:
            job.status = JobStatus.FAILED
            storage.save_job(job)
            pubsub.emit_log(job_id, f"Job failed: {str(e)}", level="error")
            pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
            raise


# Global runner instance
runner = Runner()
