import uuid
import asyncio
import os
from pathlib import Path
from typing import Optional

from app.models.schemas import (
    Job, Step, StepType, StepStatus, StepAction,
    JobStatus, AssetKind, MaskMode, MaskIntent
)
from app.core.storage import storage
from app.core.pubsub import pubsub
from app.core.validators import validator
from app.core.masks import load_mask_binary, ensure_mask_matches_input
from app.services.vertex_image import get_vertex_image_service
from app.services.fal_bgremove import fal_service
from app.services.openai_image import get_openai_image_service
from app.services.google_image import get_google_image_service
from app.services.gemini_image import edit_image, edit_image_with_mask


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
        
        # Check for cancellation
        if step.status == StepStatus.CANCELLED:
            pubsub.emit_log(job_id, f"Step {step.name} was cancelled by user.", level="warning")
            return step

        # Check for Job Pause (Global Pause)
        if job.status == JobStatus.PAUSED:
            pubsub.emit_log(job_id, "Cannot run step: Job is paused.", level="warning")
            return step

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
            mask_mode = step.mask_mode or MaskMode.NONE
            mask_asset_id = step.mask_asset_id
            mask_intent = step.mask_intent
            mask_prompt = step.mask_prompt
            if isinstance(mask_mode, str):
                mask_mode = MaskMode(mask_mode)
            if isinstance(mask_intent, str):
                mask_intent = MaskIntent(mask_intent)
            
            pubsub.emit_log(job_id, f"Using prompt: {prompt[:200]}...")
            if mask_mode != MaskMode.NONE:
                pubsub.emit_log(job_id, f"Mask intent: {mask_intent.value if mask_intent else 'None'}")
                pubsub.emit_log(job_id, f"Mask prompt: {mask_prompt[:200] if mask_prompt else 'None'}")
            
            # Route to appropriate service
            output_path = None
            
            if step.type == StepType.BG_REMOVE:
                pubsub.emit_log(job_id, "Calling Fal.ai background removal...")
                output_path = await asyncio.to_thread(
                    fal_service.remove_bg,
                    str(input_path),
                    output_dir=str(storage._assets_dir(job_id))
                )
            
            elif step.type in (StepType.EXTRACT, StepType.REMOVE, StepType.REFRAME):
                # Check if image config specifies provider
                image_config = step.image_config or (job.metadata.get("image_config", {}) if job.metadata else {})
                image_provider = image_config.get("provider")
                image_model = image_config.get("model", "default")
                
                # SMART PROVIDER SELECTION:
                # If provider is not explicitly chosen, or if it's 'vertex'/'google' but they aren't available,
                # we check what we actually have keys for.
                if not image_provider or image_provider in ("vertex", "google"):
                    # Check Vertex
                    from app.services.vertex_image import get_vertex_image_service
                    v_service = get_vertex_image_service()
                    
                    # Check Google (Gemini)
                    img_api_key = job.metadata.get("image_api_key") if job.metadata else None
                    google_service = get_google_image_service(api_key=img_api_key)
                    
                    if not img_api_key:
                        pubsub.emit_log(job_id, "No image_api_key found in job metadata. Checking environment variables...")
                    
                    # Selection Logic
                    if image_provider == "google" and google_service:
                        chosen_provider = "google"
                    elif image_provider == "vertex" and v_service:
                        chosen_provider = "vertex"
                    elif "gemini" in image_model.lower() and google_service:
                        chosen_provider = "google"
                        pubsub.emit_log(job_id, f"Model '{image_model}' detected. Routing to Google (Gemini)...")
                    elif v_service:
                        chosen_provider = "vertex"
                    elif google_service:
                        chosen_provider = "google"
                    else:
                        # Fallback to OpenAI if others fail or are unconfigured
                        from app.services.openai_image import get_openai_image_service
                        openai_service = get_openai_image_service(api_key=img_api_key)
                        if openai_service:
                            chosen_provider = "openai"
                            pubsub.emit_log(job_id, "Vertex/Google unconfigured or key missing. Falling back to OpenAI...", level="warning")
                        else:
                            # Detailed error message
                            details = []
                            if not v_service: details.append("Vertex AI (GCP_PROJECT_ID not set)")
                            if not google_service: details.append("Google Image Service (API key missing)")
                            if not openai_service: details.append("OpenAI Image Service (API key missing)")
                            
                            error_msg = f"No image generation services available. Attempted followings: {', '.join(details)}. Please check your API keys in Settings."
                            pubsub.emit_log(job_id, error_msg, level="error")
                            raise RuntimeError(error_msg)
                else:
                    chosen_provider = image_provider

                needs_masked_ai = mask_mode == MaskMode.MANUAL
                if mask_mode == MaskMode.MANUAL and needs_masked_ai and chosen_provider != "google":
                    google_service = get_google_image_service(api_key=job.metadata.get("image_api_key") if job.metadata else None)
                    if google_service:
                        chosen_provider = "google"
                        pubsub.emit_log(job_id, "Manual mask requested. Routing to Google (Gemini) for mask-aware edit.")
                    else:
                        raise RuntimeError("Manual mask requires Google (Gemini) image service, but it is unavailable.")

                pubsub.emit_log(job_id, f"Using {chosen_provider} provider (requested: {image_provider or 'default'})")

                if mask_mode == MaskMode.MANUAL:
                    prompt = "Only modify pixels inside the mask. Do not change anything outside the mask. Preserve framing, lighting, style. No new objects/text/people/animals. " + prompt
                elif mask_mode == MaskMode.AUTO:
                    prompt = "Only modify the specified region. Do not change anything else. Preserve framing/style. " + prompt
                if mask_prompt:
                    prompt = f"{prompt}\nIntent: {mask_prompt}"
                    pubsub.emit_log(job_id, "Mask intent appended to prompt.")
                if mask_mode != MaskMode.NONE:
                    pubsub.emit_log(job_id, f"Mask mode: {mask_mode.value}.")
                
                if chosen_provider == "openai":
                    pubsub.emit_log(job_id, "Calling OpenAI image generation...")
                    api_key = job.metadata.get("image_api_key") if job.metadata else None
                    openai_service = get_openai_image_service(api_key=api_key)
                    
                    if not openai_service:
                        raise RuntimeError("OpenAI image service not available")
                    
                    output_filename = f"output_{uuid.uuid4().hex[:8]}.png"
                    output_path = str(storage._assets_dir(job_id) / output_filename)
                    
                    if step.type == StepType.EXTRACT:
                        output_path = await asyncio.to_thread(
                            openai_service.extract,
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                    else:  # REMOVE
                        output_path = await asyncio.to_thread(
                            openai_service.remove,
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                elif chosen_provider == "google":
                    pubsub.emit_log(job_id, "Calling Google image generation (Gemini)...")
                    api_key = job.metadata.get("image_api_key") if job.metadata else None
                    if api_key:
                        os.environ["GEMINI_API_KEY"] = api_key
                    output_filename = f"output_{uuid.uuid4().hex[:8]}.png"
                    output_path = str(storage._assets_dir(job_id) / output_filename)

                    if mask_mode == MaskMode.MANUAL:
                        if not mask_asset_id:
                            raise RuntimeError("Manual mask requested but no mask_asset_id provided.")
                        mask_path = storage.get_asset_path(job_id, mask_asset_id)
                        if not mask_path:
                            raise RuntimeError("Mask asset not found")
                        pubsub.emit_log(job_id, f"Using mask asset: {mask_asset_id}")
                        from PIL import Image
                        input_img = Image.open(input_path)
                        mask_img = load_mask_binary(str(mask_path))
                        ensure_mask_matches_input(mask_img, input_img)
                        pubsub.emit_log(job_id, f"Mask size: {mask_img.size}, Input size: {input_img.size}")
                        mask_img.save(mask_path)
                        output_img = await asyncio.to_thread(
                            edit_image_with_mask,
                            str(input_path),
                            str(mask_path),
                            prompt
                        )
                    else:
                        output_img = await asyncio.to_thread(
                            edit_image,
                            str(input_path),
                            prompt
                        )
                    output_img.save(output_path)
                else:
                    # Use Vertex AI
                    pubsub.emit_log(job_id, "Calling Vertex AI image edit...")
                    from app.services.vertex_image import get_vertex_image_service
                    v_service = get_vertex_image_service()
                    
                    if not v_service:
                        # This shouldn't happen if chosen_provider was "vertex", but for safety:
                        raise RuntimeError("Vertex AI service unexpectely unavailable")

                    output_path = await asyncio.to_thread(
                        v_service.edit_image,
                        str(input_path),
                        prompt,
                        output_dir=str(storage._assets_dir(job_id))
                    )
            
            else:
                raise ValueError(f"Unknown step type: {step.type}")
            
            if not output_path:
                raise RuntimeError("Service returned no output")

            if step.type == StepType.REFRAME and output_path:
                try:
                    from PIL import Image, ImageOps
                    with Image.open(output_path) as img:
                        width, height = img.size
                        target_w = width
                        target_h = round(width * 9 / 16)
                        if target_h > height:
                            target_h = height
                            target_w = round(height * 16 / 9)
                        if (target_w, target_h) != (width, height):
                            reframed = ImageOps.fit(img, (target_w, target_h), method=Image.LANCZOS, centering=(0.5, 0.5))
                            reframed.save(output_path)
                            pubsub.emit_log(job_id, f"Reframe size enforced: {target_w}x{target_h}")
                except Exception as e:
                    pubsub.emit_log(job_id, f"Reframe size enforcement failed: {e}", level="warning")
            
            pubsub.emit_log(job_id, f"Output generated: {Path(output_path).name}")
            
            # Save output asset
            asset_kind = AssetKind.LAYER if step.type == StepType.EXTRACT else AssetKind.PLATE
            if step.type == StepType.BG_REMOVE:
                asset_kind = AssetKind.BG_REMOVED
            
            asset = storage.save_asset(
                job_id,
                output_path,
                asset_kind,
                job=job
            )

            # FORCE WHITE BACKGROUND: For REMOVE (clean plate) steps, ensure output is solid white
            if step.type == StepType.REMOVE and output_path:
                try:
                    pubsub.emit_log(job_id, "Post-processing: Enforcing white background for clean plate...")
                    from PIL import Image
                    
                    with Image.open(output_path) as img:
                        # Check if image has transparency or needs flattening
                        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                            # Create solid white background
                            white_bg = Image.new("RGB", img.size, (255, 255, 255))
                            # Composite
                            white_bg.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
                            
                            # Save back to same path (as PNG to be safe, or keep extension)
                            white_bg.save(output_path)
                            pubsub.emit_log(job_id, "Clean plate composited on white background.")
                        else:
                             # Even if RGB, verify it's not just black where it should be white (less likely if prompt worked, but safe to leave as is)
                             pass
                except Exception as e:
                    print(f"Failed to enforce white background: {e}")
                    pubsub.emit_log(job_id, f"Warning: White background enforcement failed: {e}", level="warning")
            
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
            elif step.type == StepType.REFRAME:
                validation = validator.validate_reframe(
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

            updated_future_steps = False
            if step.type == StepType.REMOVE and step.output_asset_id and step.status in (StepStatus.SUCCESS, StepStatus.NEEDS_REVIEW):
                if not job.metadata:
                    job.metadata = {}
                previous_plate_id = job.metadata.get("latest_plate_asset_id")
                for future_step in job.steps:
                    if future_step.index <= step.index:
                        continue
                    if future_step.input_asset_id is None or future_step.input_asset_id == previous_plate_id:
                        future_step.input_asset_id = step.output_asset_id
                        updated_future_steps = True
                job.metadata["latest_plate_asset_id"] = step.output_asset_id
                if updated_future_steps:
                    pubsub.emit_log(job_id, "Updated future steps to use latest clean plate.")
            
            # Save job
            storage.save_job(job)
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            if updated_future_steps:
                pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
            
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
                
                # Check for external pause/cancellation BEFORE running step
                # Reload job to get latest status
                current_job = storage.load_job(job_id)
                if current_job and current_job.status != JobStatus.RUNNING:
                    pubsub.emit_log(job_id, "Job execution paused/stopped externally.", level="warning")
                    return current_job

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
