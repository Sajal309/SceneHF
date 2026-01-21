import uuid
import asyncio
import shutil
import zipfile
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Header, Body
from fastapi.responses import FileResponse

from app.models.schemas import (
    Job, Step, StepType, StepStatus, StepAction,
    JobStatus, AssetKind, JobCreateResponse,
    PlanRequest, RetryRequest, PlateAndRetryRequest,
    PromptVariationsRequest, StepPatchRequest, MaskMode, ReframeRequest, PlanStep, Plan
)
from app.core.storage import storage
from app.core.pubsub import pubsub
from app.core.runner import runner
from app.services.planner import planner
from app.services.vertex_image import get_vertex_image_service
from app.services.fal_bgremove import fal_service
from app.core.masks import load_mask_binary


router = APIRouter()


def _update_job_keys_from_headers(
    job,
    x_google: Optional[str] = None,
    x_openai: Optional[str] = None,
    x_image: Optional[str] = None
):
    """Update job metadata keys if headers are provided."""
    if not job.metadata:
        job.metadata = {}
    
    changed = False
    
    # Update image API key if explicitly provided
    if x_image and job.metadata.get("image_api_key") != x_image:
        job.metadata["image_api_key"] = x_image
        changed = True
    
    # Fallback/Update logic: reuse google/openai keys if image key is still missing
    # or if we want to ensure latest keys are stored
    img_config = job.metadata.get("image_config", {})
    provider = img_config.get("provider", "openai")
    
    if not job.metadata.get("image_api_key"):
        if provider == "google" or provider == "vertex": # Vertex often falls back to google/gemini
            if x_google:
                job.metadata["image_api_key"] = x_google
                changed = True
        elif provider == "openai":
            if x_openai:
                job.metadata["image_api_key"] = x_openai
                changed = True
            
    return changed


@router.post("/jobs", response_model=JobCreateResponse)
async def create_job(file: UploadFile = File(...)):
    """
    Create a new job by uploading a source image.
    """
    # Create job
    job_id = storage.create_job()
    
    # Save uploaded file temporarily
    temp_path = Path(f"/tmp/{uuid.uuid4()}{Path(file.filename).suffix}")
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    # Save as source asset
    asset = storage.save_asset(job_id, str(temp_path), AssetKind.SOURCE)
    
    # Update job
    job = storage.load_job(job_id)
    job.source_image = asset.id
    storage.save_job(job)
    
    # Cleanup temp file
    temp_path.unlink()
    
    # Emit event
    pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
    pubsub.emit_log(job_id, f"Job created with source image: {file.filename}")
    
    return JobCreateResponse(
        job_id=job_id,
        message="Job created successfully"
    )


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """
    Delete a job and all its assets.
    """
    success = storage.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {"message": "Job deleted"}


@router.post("/jobs/{job_id}/assets/mask")
async def upload_mask(job_id: str, file: UploadFile = File(...)):
    """
    Upload a mask image for a job. Stored as a binary (0/255) mask.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported.")

    temp_path = Path(f"/tmp/{uuid.uuid4()}{Path(file.filename).suffix}")
    processed_path = temp_path.with_suffix(".png")

    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        mask = load_mask_binary(str(temp_path))
        width, height = mask.size
        mask.save(processed_path)

        run_id = storage.new_run_id()
        asset = storage.save_asset(
            job_id,
            str(processed_path),
            AssetKind.MASK,
            job=job,
            step_id="mask_upload",
            run_id=run_id,
        )
        pubsub.emit_log(job_id, f"Mask uploaded: {asset.id}")

        return {"asset_id": asset.id, "width": width, "height": height}
    finally:
        if temp_path.exists():
            temp_path.unlink()
        if processed_path.exists():
            processed_path.unlink()


@router.patch("/jobs/{job_id}/steps/{step_id}")
async def patch_step(job_id: str, step_id: str, request: StepPatchRequest):
    """
    Patch a step's mask fields.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    fields_set = request.model_fields_set

    if "mask_mode" in fields_set:
        step.mask_mode = request.mask_mode or MaskMode.NONE
        if step.mask_mode == MaskMode.NONE:
            step.mask_asset_id = None
            step.mask_intent = None

    if "mask_asset_id" in fields_set:
        if request.mask_asset_id is None:
            step.mask_asset_id = None
        else:
            if request.mask_asset_id not in job.assets:
                raise HTTPException(status_code=404, detail="Mask asset not found")
            asset = job.assets[request.mask_asset_id]
            if asset.kind != AssetKind.MASK:
                raise HTTPException(status_code=400, detail="Asset is not a mask")
            step.mask_asset_id = request.mask_asset_id

    if "mask_intent" in fields_set:
        step.mask_intent = request.mask_intent

    if "mask_prompt" in fields_set:
        step.mask_prompt = request.mask_prompt

    storage.save_job(job)
    pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))

    return step.model_dump(mode='json')


@router.get("/jobs")
async def list_jobs():
    """List all jobs with status and timestamp."""
    try:
        job_ids = storage.list_jobs()
        jobs = []
        for jid in job_ids:
            try:
                job = storage.load_job(jid)
                if job:
                    # Include essential metadata for history panel
                    job_data = job.model_dump(mode='json')
                    jobs.append(job_data)
            except Exception as e:
                print(f"Skipping invalid job {jid}: {e}")
                continue
        
        # Sort by timestamp (newest first)
        sorted_jobs = sorted(
            jobs, 
            key=lambda x: x.get('created_at', ''), 
            reverse=True
        )
        
        return sorted_jobs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get job details."""
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return job.model_dump(mode='json')


@router.post("/jobs/{job_id}/plan")
async def plan_job(
    job_id: str, 
    request: PlanRequest,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Generate a dynamic plan for the job using AI.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.source_image:
        raise HTTPException(status_code=400, detail="No source image")
    
    pubsub.emit_log(job_id, "Generating plan...")
    print(f"DEBUG: plan_job request: {request.dict()}")
    
    # Get source image path
    source_path = storage.get_asset_path(job_id, job.source_image)
    if not source_path:
        raise HTTPException(status_code=404, detail="Source image not found")
    
    # Determine API key based on provider
    api_key = None
    print(f"DEBUG: plan_job: request.provider='{request.provider}'")
    print(f"DEBUG: Headers received - X-Google-Api-Key: {'set' if x_google_api_key else 'None'}, X-Openai-Api-Key: {'set' if x_openai_api_key else 'None'}")
    
    if request.provider == "gemini":
        api_key = x_google_api_key
    elif request.provider == "openai":
        api_key = x_openai_api_key

    # Generate plan
    try:
        plan = planner.generate_plan(
            str(source_path), 
            request.provider,
            request.llm_config,
            api_key,
            scene_description=request.scene_description,
            layer_count=request.layer_count,
            layer_map=request.layer_map
        )

        # Enforce layer count if provided and planner under-produces EXTRACT steps
        if request.layer_count and request.layer_map:
            extract_steps = [s for s in plan.steps if s.type == StepType.EXTRACT]
            if len(extract_steps) < request.layer_count:
                pubsub.emit_log(
                    job_id,
                    f"Planner returned {len(extract_steps)} extracts, expected {request.layer_count}. Building fallback steps.",
                    level="warning"
                )
                fallback_steps = []
                for layer in sorted(request.layer_map, key=lambda x: x.get('index', 0)):
                    layer_name = layer.get("name", "Layer")
                    fallback_steps.append(PlanStep(
                        id=f"s{layer.get('index', len(fallback_steps) + 1)}",
                        name=f"Extract {layer_name}",
                        type=StepType.EXTRACT,
                        target=layer_name,
                        prompt=f"Extract {layer_name} on a solid white background. Preserve alignment, framing, and lighting.",
                        prompt_variations=[],
                        validation_rules={"min_nonwhite": 0.01, "max_nonwhite": 0.35},
                        fallbacks=[]
                    ))
                plan = Plan(
                    scene_summary=plan.scene_summary,
                    global_rules=plan.global_rules,
                    steps=fallback_steps
                )

        # Ensure prompt variations exist for each step
        for plan_step in plan.steps:
            variations = [v.strip() for v in plan_step.prompt_variations if isinstance(v, str) and v.strip()]
            if len(variations) < 2:
                try:
                    generated = await asyncio.to_thread(
                        planner.generate_variations,
                        plan_step.prompt,
                        request.provider,
                        request.llm_config,
                        api_key
                    )
                    variations = [v.strip() for v in generated if isinstance(v, str) and v.strip()]
                except Exception as e:
                    pubsub.emit_log(job_id, f"Variation generation failed for {plan_step.id}: {e}", level="warning")
                    variations = []

            # Ensure original prompt is included and keep unique ordering
            unique_variations = []
            for v in [plan_step.prompt] + variations:
                if v and v not in unique_variations:
                    unique_variations.append(v)
            plan_step.prompt_variations = unique_variations

        job.plan = plan
        
        # Store image config in job metadata if provided
        if request.image_config is not None:
            if not job.metadata:
                job.metadata = {}
            job.metadata["image_config"] = request.image_config
            
            # API Key Fallback: If image API key is missing, potentially reuse planning keys
            img_key = x_image_api_key
            if not img_key:
                # If image provider matches planning provider, reuse that key
                image_provider = request.image_config.get("provider")
                planning_provider = request.provider
                
                # Handle mapping: gemini (planner) -> google (image)
                is_google_family = (image_provider == "google" and planning_provider == "gemini")
                is_openai_family = (image_provider == "openai" and planning_provider == "openai")
                
                if image_provider == planning_provider or is_google_family or is_openai_family:
                    img_key = api_key
                elif not image_provider:
                    # If no specific image provider, just use the planning key as a general fallback
                    img_key = api_key
            
            if img_key:
                job.metadata["image_api_key"] = img_key
        
        # Create steps from plan
        job.steps = []
        for idx, plan_step in enumerate(plan.steps):
            step = Step(
                id=plan_step.id,
                index=idx,
                name=plan_step.name,
                type=plan_step.type,
                prompt=plan_step.prompt,
                prompt_variations=plan_step.prompt_variations,
                status=StepStatus.QUEUED
            )
            job.steps.append(step)
        
        job.status = JobStatus.PLANNED
        storage.save_job(job)
        
        pubsub.emit_log(job_id, f"Plan generated with {len(job.steps)} steps")
        pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))
        
        return {"message": "Plan generated", "steps": len(job.steps)}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = str(e)
        pubsub.emit_log(job_id, f"Planning failed: {error_msg}", level="error")
        
        if "429" in error_msg and "quota" in error_msg.lower():
            raise HTTPException(
                status_code=429, 
                detail="Gemini API Quota Exceeded. Please try again later or switch to OpenAI."
            )
        
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/jobs/{job_id}/run")
async def run_job(
    job_id: str, 
    background_tasks: BackgroundTasks,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Run all steps in the job sequentially.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Always take frontend key for access
    if _update_job_keys_from_headers(job, x_google_api_key, x_openai_api_key, x_image_api_key):
        storage.save_job(job)
        pubsub.emit_log(job_id, "Updated API keys from frontend")
    
    # Run in background
    background_tasks.add_task(runner.run_job, job_id)
    
    return {"message": "Job execution started"}


@router.post("/jobs/{job_id}/reframe")
async def reframe_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    request: ReframeRequest = ReframeRequest(),
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Create and run a single reframe step (16:9).
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if request.image_config is not None:
        if not job.metadata:
            job.metadata = {}
        job.metadata["image_config"] = request.image_config
        if not job.metadata.get("image_api_key"):
            image_provider = request.image_config.get("provider")
            if image_provider == "google" and x_google_api_key:
                job.metadata["image_api_key"] = x_google_api_key
            elif image_provider == "openai" and x_openai_api_key:
                job.metadata["image_api_key"] = x_openai_api_key

    if _update_job_keys_from_headers(job, x_google_api_key, x_openai_api_key, x_image_api_key):
        storage.save_job(job)
        pubsub.emit_log(job_id, "Updated API keys from frontend")

    step_id = str(uuid.uuid4())
    step = Step(
        id=step_id,
        index=len(job.steps),
        name="Reframe 16:9",
        type=StepType.REFRAME,
        prompt=request.prompt or "Reframe this image in 16:9.",
        status=StepStatus.QUEUED,
        input_asset_id=job.source_image,
        image_config=request.image_config
    )
    job.steps.append(step)
    job.status = JobStatus.RUNNING
    storage.save_job(job)

    pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
    pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))

    background_tasks.add_task(runner.run_step, job_id, step_id)

    return {"message": "Reframe started", "step_id": step_id}


@router.post("/jobs/{job_id}/steps/{step_id}/run")
async def run_step(
    job_id: str, 
    step_id: str, 
    background_tasks: BackgroundTasks,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Run a single step.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Always take frontend key for access
    if _update_job_keys_from_headers(job, x_google_api_key, x_openai_api_key, x_image_api_key):
        storage.save_job(job)
        pubsub.emit_log(job_id, "Updated API keys from frontend")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Run in background
    background_tasks.add_task(runner.run_step, job_id, step_id)
    
    return {"message": "Step execution started"}


@router.post("/jobs/{job_id}/steps/{step_id}/variations")
async def get_prompt_variations(
    job_id: str,
    step_id: str,
    request: PromptVariationsRequest,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key")
):
    """
    Generate variations for a step's prompt.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Determine API key based on provider
    api_key = None
    if request.provider == "gemini":
        api_key = x_google_api_key
    elif request.provider == "openai":
        api_key = x_openai_api_key

    try:
        current_prompt = step.custom_prompt or step.prompt
        variations = await asyncio.to_thread(
            planner.generate_variations,
            current_prompt,
            request.provider,
            request.llm_config,
            api_key
        )
        return {"variations": variations}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/steps/{step_id}/retry")
async def retry_step(
    job_id: str,
    step_id: str,
    request: RetryRequest,
    background_tasks: BackgroundTasks,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Retry a step with a custom prompt.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Always take frontend key for access
    _update_job_keys_from_headers(job, x_google_api_key, x_openai_api_key, x_image_api_key)
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Update step with custom prompt and reset status
    step.custom_prompt = request.custom_prompt
    if request.image_config:
        step.image_config = request.image_config
    step.status = StepStatus.QUEUED
    storage.save_job(job)
    
    pubsub.emit_log(job_id, f"Retrying step: {step.name}")
    pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
    
    # Run in background
    background_tasks.add_task(runner.run_step, job_id, step_id, request.custom_prompt)
    
    return {"message": "Step retry started"}


@router.post("/jobs/{job_id}/steps/{step_id}/bg-remove")
async def bg_remove_step(
    job_id: str,
    step_id: str,
    background_tasks: BackgroundTasks,
    x_google_api_key: Optional[str] = Header(None, alias="X-Google-Api-Key"),
    x_openai_api_key: Optional[str] = Header(None, alias="X-Openai-Api-Key"),
    x_image_api_key: Optional[str] = Header(None, alias="X-Image-Api-Key")
):
    """
    Apply Fal.ai background removal to step output.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Always take frontend key for access
    _update_job_keys_from_headers(job, x_google_api_key, x_openai_api_key, x_image_api_key)
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    if not step.output_asset_id:
        raise HTTPException(status_code=400, detail="Step has no output")
    
    async def do_bg_remove():
        pubsub.emit_log(job_id, f"Applying background removal to: {step.name}")
        
        try:
            input_path = storage.get_asset_path(job_id, step.output_asset_id)
            if not input_path:
                raise ValueError("Output asset not found")
            
            run_id = storage.new_run_id()
            tmp_path = await asyncio.to_thread(
                fal_service.remove_bg,
                str(input_path),
                output_dir=str(storage._assets_subdir(job_id, "derived"))
            )
            from PIL import Image
            with Image.open(tmp_path) as img:
                output_img = img.copy()
            asset = storage.save_image(
                job_id=job_id,
                step_id=step_id,
                run_id=run_id,
                kind="bg_removed",
                pil_image=output_img,
                asset_kind=AssetKind.BG_REMOVED,
                job=job,
                subdir="derived"
            )
            step.output_asset_id = asset.id
            step.outputs_history.append(asset.id)
            step.last_run_id = run_id
            step.last_prompt_used = step.custom_prompt or step.prompt
            storage.save_job(job)
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
            
            pubsub.emit_log(job_id, "Background removal completed")
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            
        except Exception as e:
            pubsub.emit_log(job_id, f"Background removal failed: {str(e)}", level="error")
    
    background_tasks.add_task(do_bg_remove)
    
    return {"message": "Background removal started"}


@router.post("/jobs/{job_id}/steps/{step_id}/plate-and-retry")
async def plate_and_retry(
    job_id: str,
    step_id: str,
    request: PlateAndRetryRequest,
    background_tasks: BackgroundTasks
):
    """
    Create a plate (remove occluders) then retry extraction.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    async def do_plate_and_retry():
        pubsub.emit_log(job_id, f"Creating plate for: {step.name}")
        
        try:
            run_id_plate = storage.new_run_id()
            run_id_retry = storage.new_run_id()
            # Get input
            if step.input_asset_id:
                input_path = storage.get_asset_path(job_id, step.input_asset_id)
            else:
                input_path = storage.get_asset_path(job_id, job.source_image)
            
            if not input_path:
                raise ValueError("Input asset not found")
            
            # Step 1: Create plate (remove occluders)
            pubsub.emit_log(job_id, "Step 1: Removing occluders to create plate...")
            from app.services.vertex_image import get_vertex_image_service
            from app.services.google_image import get_google_image_service
            
            # Try Vertex first, then Google
            service = get_vertex_image_service()
            used_service = "vertex"
            
            if not service:
                pubsub.emit_log(job_id, "Vertex AI not available, trying Google Image Service...")
                # Get API key if available
                api_key = job.metadata.get("image_api_key") if job.metadata else None
                service = get_google_image_service(api_key)
                used_service = "google"
                
            if not service:
                raise RuntimeError("No image editing service available (Vertex OR Google).")

            if used_service == "vertex":
                plate_path = await asyncio.to_thread(
                    service.edit_image,
                    str(input_path),
                    request.remove_prompt,
                    output_dir=str(storage._assets_dir(job_id))
                )
            else:
                # Google service usage
                output_filename = f"{uuid.uuid4()}.png"
                plate_target = str(storage._assets_dir(job_id) / output_filename)
                plate_path = await asyncio.to_thread(
                    service.remove,
                    str(input_path),
                    request.remove_prompt,
                    plate_target
                )
            from PIL import Image
            with Image.open(plate_path) as img:
                plate_img = img.copy()
            plate_asset = storage.save_image(
                job_id=job_id,
                step_id=step_id,
                run_id=run_id_plate,
                kind="plate",
                pil_image=plate_img,
                asset_kind=AssetKind.PLATE,
                job=job
            )
            pubsub.emit_log(job_id, f"Plate created: {plate_asset.id}")
            
            # Step 2: Retry extraction using plate as input
            pubsub.emit_log(job_id, "Step 2: Retrying extraction with plate...")
            
            if used_service == "vertex":
                output_path = await asyncio.to_thread(
                    service.edit_image,
                    plate_path,
                    request.retry_prompt,
                    output_dir=str(storage._assets_dir(job_id))
                )
            else:
                output_filename = f"{uuid.uuid4()}.png"
                extract_target = str(storage._assets_dir(job_id) / output_filename)
                output_path = await asyncio.to_thread(
                    service.extract,
                    plate_path,
                    request.retry_prompt,
                    extract_target
                )
            with Image.open(output_path) as img:
                retry_img = img.copy()
            output_asset = storage.save_image(
                job_id=job_id,
                step_id=step_id,
                run_id=run_id_retry,
                kind="plate_retry",
                pil_image=retry_img,
                asset_kind=AssetKind.LAYER,
                job=job
            )
            
            # Update step
            step.output_asset_id = output_asset.id
            step.outputs_history.append(output_asset.id)
            step.last_run_id = run_id_retry
            step.last_prompt_used = request.retry_prompt
            step.custom_prompt = f"[Plate+Retry] {request.retry_prompt} ({used_service})"
            storage.save_job(job)
            
            pubsub.emit_log(job_id, "Plate and retry completed")
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            
        except Exception as e:
            pubsub.emit_log(job_id, f"Plate and retry failed: {str(e)}", level="error")
    
    background_tasks.add_task(do_plate_and_retry)
    
    return {"message": "Plate and retry started"}


@router.post("/jobs/{job_id}/steps/{step_id}/replace-image")
async def replace_step_image(
    job_id: str,
    step_id: str,
    file: UploadFile = File(...),
    target: str = "output"
):
    """
    Replace a step's input or output image via file upload.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    if target not in ("output", "input"):
        raise HTTPException(status_code=400, detail="Invalid target. Use 'output' or 'input'.")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported.")

    temp_path = Path(f"/tmp/{uuid.uuid4()}{Path(file.filename).suffix}")
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        run_id = storage.new_run_id()

        if target == "output":
            if step.type == StepType.EXTRACT:
                asset_kind = AssetKind.LAYER
            elif step.type == StepType.REMOVE:
                asset_kind = AssetKind.PLATE
            else:
                asset_kind = AssetKind.BG_REMOVED
        else:
            asset_kind = AssetKind.SOURCE

        asset = storage.save_asset(
            job_id,
            str(temp_path),
            asset_kind,
            job=job,
            step_id=step_id,
            run_id=run_id
        )

        if target == "output":
            step.output_asset_id = asset.id
            step.validation = None
            if step.status in (StepStatus.FAILED, StepStatus.CANCELLED):
                step.status = StepStatus.NEEDS_REVIEW
            step.outputs_history.append(asset.id)
            step.last_run_id = run_id
            step.last_prompt_used = step.custom_prompt or step.prompt
        else:
            step.input_asset_id = asset.id
            step.output_asset_id = None
            step.status = StepStatus.QUEUED
            step.validation = None

        # If this is a clean plate, feed it forward to later steps
        if target == "output" and step.type == StepType.REMOVE:
            if not job.metadata:
                job.metadata = {}
            previous_plate_id = job.metadata.get("latest_plate_asset_id")
            for future_step in job.steps:
                if future_step.index <= step.index:
                    continue
                if future_step.input_asset_id is None or future_step.input_asset_id == previous_plate_id:
                    future_step.input_asset_id = asset.id
            job.metadata["latest_plate_asset_id"] = asset.id

        storage.save_job(job)

        pubsub.emit_log(job_id, f"Replaced {target} image for step: {step.name}")
        pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
        pubsub.emit_job_updated(job_id, job.model_dump(mode='json'))

        return {"message": "Image replaced", "asset_id": asset.id, "target": target}
    finally:
        if temp_path.exists():
            temp_path.unlink()


@router.post("/jobs/{job_id}/steps/{step_id}/accept")
async def accept_step(job_id: str, step_id: str):
    """
    Mark a step as accepted (final output).
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Could add an "accepted" flag to step model if needed
    pubsub.emit_log(job_id, f"Step accepted: {step.name}")
    
    return {"message": "Step accepted"}
    
@router.post("/jobs/{job_id}/steps/{step_id}/stop")
async def stop_step(job_id: str, step_id: str):
    """
    Cancel a running or queued step.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Update status to CANCELLED
    step.status = StepStatus.CANCELLED
    storage.save_job(job)
    
    pubsub.emit_log(job_id, f"Step cancelled by user: {step.name}", level="warning")
    pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
    
    return {"message": "Step cancelled"}


@router.post("/jobs/pause-all")
async def pause_all_jobs():
    """
    Pause/Stop all currently running jobs.
    """
    try:
        count = 0
        job_ids = storage.list_jobs()
        for jid in job_ids:
            job = storage.load_job(jid)
            if job and job.status == JobStatus.RUNNING:
                job.status = JobStatus.PAUSED
                changed_steps = False
                for step in job.steps:
                    if step.status in (StepStatus.RUNNING, StepStatus.QUEUED):
                        step.status = StepStatus.CANCELLED
                        changed_steps = True
                        pubsub.emit_step_updated(jid, step.model_dump(mode='json'))
                storage.save_job(job)
                pubsub.emit_log(jid, "Job paused by 'Pause All' request.", level="warning")
                pubsub.emit_job_updated(jid, job.model_dump(mode='json'))
                if changed_steps:
                    pubsub.emit_log(jid, "All running/queued steps marked as CANCELLED.", level="warning")
                count += 1
        
        return {"message": f"Paused {count} running jobs"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/jobs/{job_id}/assets/{asset_id}")
async def get_asset(job_id: str, asset_id: str):
    """
    Get an asset image file.
    """
    print(f"DEBUG: get_asset request: job_id={job_id}, asset_id={asset_id}")
    asset_path = storage.get_asset_path(job_id, asset_id)
    if not asset_path:
        print(f"DEBUG: get_asset FAILED: asset not found in storage for id {asset_id}")
        raise HTTPException(status_code=404, detail="Asset not found")
    
    print(f"DEBUG: get_asset SUCCESS: serving file at {asset_path}")
    if not Path(asset_path).exists():
        print(f"DEBUG: get_asset ERROR: File exists in DB but MISSING on disk: {asset_path}")
        raise HTTPException(status_code=404, detail="File missing on disk")
        
    return FileResponse(asset_path)


@router.post("/jobs/{job_id}/open-in-finder")
async def open_in_finder(job_id: str):
    """
    Convenience endpoint: open job folder in macOS Finder.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job_dir = storage._job_dir(job_id)
    legacy_dir = storage.legacy_jobs_root / job_id
    if not job_dir.exists() and legacy_dir.exists():
        job_dir = legacy_dir
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job folder not found on disk")
    try:
        subprocess.run(["open", str(job_dir)], check=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "path": str(job_dir)}


@router.get("/jobs/{job_id}/steps/{step_id}/history")
async def get_step_history(job_id: str, step_id: str):
    """
    Return generation history records for a step.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    records = storage.read_history(job_id, step_id)
    return {"history": records}


@router.post("/jobs/{job_id}/steps/{step_id}/set-active")
async def set_active_output(job_id: str, step_id: str, payload: dict = Body(...)):
    """
    Set which asset ID should be the active output for a step.
    """
    asset_id = payload.get("asset_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail="asset_id is required")
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    if asset_id not in job.assets:
        raise HTTPException(status_code=404, detail="Asset not found in job")
    step.output_asset_id = asset_id
    if asset_id not in step.outputs_history:
        step.outputs_history.append(asset_id)
    asset_meta = job.assets.get(asset_id)
    step.last_run_id = asset_meta.run_id if asset_meta else step.last_run_id
    storage.save_job(job)
    pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
    return {"ok": True, "asset_id": asset_id}


@router.get("/jobs/{job_id}/export")
async def export_job(job_id: str):
    """
    Export job as a zip file with accepted layers and metadata.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Create zip
    zip_path = Path(f"/tmp/{job_id}_export.zip")
    
    with zipfile.ZipFile(zip_path, 'w') as zf:
        # Add job.json
        job_file = storage._job_file(job_id)
        zf.write(job_file, "job.json")
        
        # Add plan if exists
        if job.plan:
            zf.writestr("plan.json", job.plan.model_dump_json(indent=2))
        
        # Add all assets
        for asset_id, asset in job.assets.items():
            asset_path = storage.get_asset_path(job_id, asset_id)
            if asset_path and asset_path.exists():
                zf.write(asset_path, f"assets/{asset_path.name}")
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{job_id}_export.zip"
    )
