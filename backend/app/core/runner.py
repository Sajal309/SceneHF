import asyncio
import os
from pathlib import Path
from typing import Optional

from PIL import Image

from app.models.schemas import (
    Job, Step, StepType, StepStatus, StepAction, ValidationResult,
    JobStatus, AssetKind, MaskMode, MaskIntent
)
from app.core.storage import storage
from app.core.pubsub import pubsub
from app.core.validators import validator
from app.core.masks import load_mask_binary, ensure_mask_matches_input
from app.services.vertex_image import get_vertex_image_service
from app.services.fal_bgremove import fal_service
from app.services.fal_upscale import fal_upscale_service
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

        run_id = storage.new_run_id()
        started_at = storage.now_timestamp()
        
        # Check for cancellation
        if step.status == StepStatus.CANCELLED:
            pubsub.emit_log(job_id, f"Step {step.name} was cancelled by user.", level="warning")
            return step
        # If job was paused after a "pause all" while this task was queued, bail early
        if job.status == JobStatus.PAUSED:
            pubsub.emit_log(job_id, f"Job is paused. Skipping step {step.name}.", level="warning")
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

        # History scaffold
        history_record = {
            "job_id": job_id,
            "step_id": step_id,
            "run_id": run_id,
            "started_at": started_at,
            "prompt_base": step.prompt,
            "prompt_custom": custom_prompt or step.custom_prompt,
            "mask": {},
            "model": os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"),
        }
        
        validation = None
        output_asset = None
        output_path = None
        error_message = None
        
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
            history_record["input_asset_path"] = str(input_path)
            
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
            history_record["prompt_full"] = prompt
            history_record["mask"] = {
                "mask_mode": mask_mode.value if hasattr(mask_mode, "value") else str(mask_mode),
                "mask_intent": mask_intent.value if mask_intent else None,
            }
            
            pubsub.emit_log(job_id, f"Using prompt: {prompt[:200]}...")
            if mask_mode != MaskMode.NONE:
                pubsub.emit_log(job_id, f"Mask intent: {mask_intent.value if mask_intent else 'None'}")
                pubsub.emit_log(job_id, f"Mask prompt: {mask_prompt[:200] if mask_prompt else 'None'}")
            
            # Route to appropriate service
            output_img = None
            upscale_factor = 2
            
            if step.type == StepType.BG_REMOVE:
                if not fal_service:
                    raise RuntimeError("Fal background removal service is unavailable. Install fal-client.")
                pubsub.emit_log(job_id, "Calling Fal.ai background removal...")
                fal_api_key = (job.metadata or {}).get("fal_api_key")
                fal_model = ((job.metadata or {}).get("image_config") or {}).get("fal_model")
                tmp_path = await asyncio.to_thread(
                    fal_service.remove_bg,
                    str(input_path),
                    output_dir=str(storage._assets_subdir(job_id, "derived")),
                    api_key=fal_api_key,
                    model=fal_model
                )
                with Image.open(tmp_path) as img:
                    output_img = img.copy()
                # Use derived folder for storage
                output_asset = storage.save_image(
                    job_id=job_id,
                    step_id=step_id,
                    run_id=run_id,
                    kind="bg_removed",
                    pil_image=output_img,
                    asset_kind=AssetKind.BG_REMOVED,
                    job=job,
                    subdir="derived"
                )
                output_path = storage.get_asset_path(job_id, output_asset.id)
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass

            elif step.type == StepType.UPSCALE:
                upscale_config = step.image_config or ((job.metadata or {}).get("upscale_config") or {})
                upscale_model = upscale_config.get("upscale_model") or upscale_config.get("fal_model")
                raw_factor = upscale_config.get("factor", 2)
                try:
                    upscale_factor = int(raw_factor)
                except Exception:
                    upscale_factor = 2
                upscale_factor = max(1, min(6, upscale_factor))

                if upscale_factor == 1:
                    pubsub.emit_log(job_id, "Upscale factor is 1x. Returning original resolution image.")
                    with Image.open(input_path) as img:
                        output_img = img.copy()
                else:
                    if not fal_upscale_service:
                        raise RuntimeError("Fal upscale service is unavailable. Install fal-client.")
                    pubsub.emit_log(job_id, "Calling Fal.ai upscaler...")
                    fal_api_key = (job.metadata or {}).get("fal_api_key")
                    tmp_path = await asyncio.to_thread(
                        fal_upscale_service.upscale,
                        str(input_path),
                        factor=upscale_factor,
                        output_dir=str(storage._assets_subdir(job_id, "generations")),
                        api_key=fal_api_key,
                        model=upscale_model
                    )
                    with Image.open(tmp_path) as img:
                        output_img = img.copy()
                    try:
                        Path(tmp_path).unlink(missing_ok=True)
                    except Exception:
                        pass

                output_asset = storage.save_image(
                    job_id=job_id,
                    step_id=step_id,
                    run_id=run_id,
                    kind=f"upscale_{upscale_factor}x",
                    pil_image=output_img,
                    asset_kind=AssetKind.GENERATION,
                    job=job,
                    subdir="generations"
                )
                output_path = storage.get_asset_path(job_id, output_asset.id)
            
            elif step.type in (StepType.EXTRACT, StepType.REMOVE, StepType.REFRAME, StepType.EDIT):
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
                
                history_record["prompt_full"] = prompt
                history_record["mask"] = {
                    "mask_mode": mask_mode.value if hasattr(mask_mode, "value") else str(mask_mode),
                    "mask_intent": mask_intent.value if mask_intent else None,
                }
                
                if chosen_provider == "openai":
                    pubsub.emit_log(job_id, "Calling OpenAI image generation...")
                    api_key = job.metadata.get("image_api_key") if job.metadata else None
                    openai_service = get_openai_image_service(api_key=api_key)
                    
                    if not openai_service:
                        raise RuntimeError("OpenAI image service not available")
                    
                    output_filename = f"openai_{run_id}.png"
                    output_path = str(storage._assets_subdir(job_id, "generations") / output_filename)
                    
                    if step.type == StepType.EXTRACT:
                        output_path = await asyncio.to_thread(
                            openai_service.extract,
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                    else:  # REMOVE / EDIT / REFRAME
                        output_path = await asyncio.to_thread(
                            openai_service.remove,
                            str(input_path),
                            prompt,
                            output_path,
                            config=image_config
                        )
                    with Image.open(output_path) as img:
                        output_img = img.copy()
                
                elif chosen_provider == "google":
                    from app.services.gemini_image import MODEL_NAME
                    pubsub.emit_log(job_id, "Calling Google image generation (Gemini)...")
                    api_key = job.metadata.get("image_api_key") if job.metadata else None
                    if api_key:
                        os.environ["GEMINI_API_KEY"] = api_key

                    if mask_mode == MaskMode.MANUAL:
                        if not mask_asset_id:
                            raise RuntimeError("Manual mask requested but no mask_asset_id provided.")
                        mask_path = storage.get_asset_path(job_id, mask_asset_id)
                        if not mask_path:
                            raise RuntimeError("Mask asset not found")
                        pubsub.emit_log(job_id, f"Using mask asset: {mask_asset_id}")
                        input_img = Image.open(input_path)
                        mask_img = load_mask_binary(str(mask_path))
                        ensure_mask_matches_input(mask_img, input_img)
                        pubsub.emit_log(job_id, f"Mask size: {mask_img.size}, Input size: {input_img.size}")
                        # Store mask copy for this run
                        mask_asset = storage.save_mask(job_id, step_id, run_id, mask_img, job=job)
                        step.mask_asset_id = mask_asset.id
                        mask_resolved = storage.get_asset_path(job_id, mask_asset.id)
                        history_record["mask"]["mask_asset_path"] = str(mask_resolved) if mask_resolved else None
                        output_img = await asyncio.to_thread(
                            edit_image_with_mask,
                            str(input_path),
                            str(mask_resolved),
                            prompt
                        )
                    else:
                        output_img = await asyncio.to_thread(
                            edit_image,
                            str(input_path),
                            prompt
                        )
                    history_record["model"] = MODEL_NAME
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
                        output_dir=str(storage._assets_subdir(job_id, "generations"))
                    )
                    with Image.open(output_path) as img:
                        output_img = img.copy()
            
            else:
                raise ValueError(f"Unknown step type: {step.type}")
            
            if output_img is None and not output_path:
                raise RuntimeError("Service returned no output")

            # FORCE WHITE BACKGROUND: For REMOVE (clean plate) steps, ensure output is solid white
            if step.type == StepType.REMOVE and output_img:
                try:
                    pubsub.emit_log(job_id, "Post-processing: Enforcing white background for clean plate...")
                    if output_img.mode in ('RGBA', 'LA') or (output_img.mode == 'P' and 'transparency' in output_img.info):
                        white_bg = Image.new("RGB", output_img.size, (255, 255, 255))
                        white_bg.paste(output_img, mask=output_img.split()[3] if output_img.mode == 'RGBA' else None)
                        output_img = white_bg
                except Exception as e:
                    pubsub.emit_log(job_id, f"Warning: White background enforcement failed: {e}", level="warning")
            
            # Save output asset for Gemini/OpenAI/Vertex paths
            if output_asset is None:
                if step.type == StepType.EXTRACT:
                    asset_kind = AssetKind.LAYER
                elif step.type == StepType.EDIT:
                    asset_kind = AssetKind.GENERATION
                else:
                    asset_kind = AssetKind.PLATE
                if step.type == StepType.BG_REMOVE:
                    asset_kind = AssetKind.BG_REMOVED
                subdir = "generations"
                kind_label = step.type.value.lower()
                if custom_prompt:
                    kind_label = "retry"
                output_asset = storage.save_image(
                    job_id=job_id,
                    step_id=step_id,
                    run_id=run_id,
                    kind=kind_label,
                    pil_image=output_img,
                    asset_kind=asset_kind,
                    job=job,
                    subdir="derived" if asset_kind == AssetKind.BG_REMOVED else subdir,
                )
                output_path = storage.get_asset_path(job_id, output_asset.id)
            
            if step.type == StepType.REFRAME and output_path:
                try:
                    from PIL import ImageOps
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
            
            if output_path:
                pubsub.emit_log(job_id, f"Output generated: {Path(output_path).name}")
            
            step.output_asset_id = output_asset.id if output_asset else None
            if output_asset:
                step.outputs_history.append(output_asset.id)
            step.last_run_id = run_id
            step.last_prompt_used = history_record.get("prompt_full", prompt)
            
            # Validate output
            pubsub.emit_log(job_id, "Validating output...")
            
            validation_rules = {}
            if job.plan:
                plan_step = next((ps for ps in job.plan.steps if ps.id == step.id), None)
                if plan_step:
                    validation_rules = plan_step.validation_rules
            
            if step.type == StepType.EXTRACT:
                validation = validator.validate_extraction(
                    str(output_path),
                    str(source_path),
                    validation_rules
                )
            elif step.type == StepType.REMOVE:
                validation = validator.validate_plate(
                    str(output_path),
                    str(source_path),
                    validation_rules
                )
            elif step.type == StepType.REFRAME:
                validation = validator.validate_reframe(
                    str(output_path),
                    str(source_path),
                    validation_rules
                )
            elif step.type == StepType.EDIT:
                validation = ValidationResult(
                    passed=True,
                    status=StepStatus.SUCCESS,
                    metrics={},
                    notes="Edit completed (no validation applied)."
                )
            elif step.type == StepType.UPSCALE:
                validation = ValidationResult(
                    passed=True,
                    status=StepStatus.SUCCESS,
                    metrics={},
                    notes=f"Upscale {upscale_factor}x completed."
                )
            else:
                # BG_REMOVE - basic validation
                validation = validator.validate_extraction(
                    str(output_path),
                    str(source_path),
                    {"min_nonwhite": 0.01, "max_nonwhite": 0.8}
                )
            
            step.validation = validation
            step.status = validation.status
            
            # Set available actions based on status
            if step.status in (StepStatus.SUCCESS, StepStatus.NEEDS_REVIEW):
                if step.type == StepType.UPSCALE:
                    step.actions_available = [StepAction.ACCEPT]
                else:
                    step.actions_available = [
                        StepAction.ACCEPT,
                        StepAction.RETRY,
                        StepAction.BG_REMOVE,
                        StepAction.PLATE_AND_RETRY
                    ]
            elif step.status == StepStatus.FAILED:
                if step.type == StepType.UPSCALE:
                    step.actions_available = [StepAction.RETRY]
                else:
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
            error_message = str(e)
            step.status = StepStatus.FAILED
            step.logs.append(f"Error: {error_message}")
            step.actions_available = [
                StepAction.RETRY,
                StepAction.PLATE_AND_RETRY
            ]
            pubsub.emit_log(job_id, f"Step failed: {error_message}", level="error")
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            return step
        finally:
            # Write history for Gemini runs when an image existed or an error occurred
            if output_asset:
                output_path = storage.get_asset_path(job_id, output_asset.id)
            finished_at = storage.now_timestamp()
            history_record["finished_at"] = finished_at
            history_record["output_asset_path"] = str(output_path) if output_path else None
            if output_asset:
                history_record["output_asset_id"] = output_asset.id
            if validation:
                history_record["validation"] = {
                    "status": validation.status.value if hasattr(validation.status, "value") else str(validation.status),
                    "metrics": validation.metrics,
                    "notes": validation.notes,
                }
            if error_message:
                history_record["error"] = error_message
            try:
                storage.write_history(job_id, step_id, run_id, history_record)
            except Exception:
                # Best-effort; do not raise from history writing
                pass
            storage.save_job(job)
    
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
