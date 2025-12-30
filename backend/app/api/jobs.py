import uuid
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Header
from fastapi.responses import FileResponse

from app.models.schemas import (
    Job, Step, StepType, StepStatus, StepAction,
    JobStatus, AssetKind, JobCreateResponse,
    PlanRequest, RetryRequest, PlateAndRetryRequest
)
from app.core.storage import storage
from app.core.pubsub import pubsub
from app.core.runner import runner
from app.services.planner import planner
from app.services.vertex_image import vertex_service
from app.services.fal_bgremove import fal_service


router = APIRouter()


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
                    jobs.append(job)
            except Exception as e:
                print(f"Skipping invalid job {jid}: {e}")
                continue
        
        # Sort by timestamp (newest first)
        return sorted(
            [j.model_dump(mode='json') for j in jobs], 
            key=lambda x: x.get('created_at', ''), 
            reverse=True
        )
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
    
    # Get source image path
    source_path = storage.get_asset_path(job_id, job.source_image)
    if not source_path:
        raise HTTPException(status_code=404, detail="Source image not found")
    
    # Determine API key based on provider
    api_key = None
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
            api_key
        )
        job.plan = plan
        
        # Store image config in job metadata if provided
        if request.image_config:
            if not job.metadata:
                job.metadata = {}
            job.metadata["image_config"] = request.image_config
            if x_image_api_key:
                job.metadata["image_api_key"] = x_image_api_key
        
        # Create steps from plan
        job.steps = []
        for idx, plan_step in enumerate(plan.steps):
            step = Step(
                id=plan_step.id,
                index=idx,
                name=plan_step.name,
                type=plan_step.type,
                prompt=plan_step.prompt,
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
        pubsub.emit_log(job_id, f"Planning failed: {str(e)}", level="error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/run")
async def run_job(job_id: str, background_tasks: BackgroundTasks):
    """
    Run all steps in the job sequentially.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Run in background
    background_tasks.add_task(runner.run_job, job_id)
    
    return {"message": "Job execution started"}


@router.post("/jobs/{job_id}/steps/{step_id}/run")
async def run_step(job_id: str, step_id: str, background_tasks: BackgroundTasks):
    """
    Run a single step.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    step = next((s for s in job.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # Run in background
    background_tasks.add_task(runner.run_step, job_id, step_id)
    
    return {"message": "Step execution started"}


@router.post("/jobs/{job_id}/steps/{step_id}/retry")
async def retry_step(
    job_id: str,
    step_id: str,
    request: RetryRequest,
    background_tasks: BackgroundTasks
):
    """
    Retry a step with a custom prompt.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
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
    background_tasks: BackgroundTasks
):
    """
    Apply Fal.ai background removal to step output.
    """
    job = storage.load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
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
            
            output_path = fal_service.remove_bg(
                str(input_path),
                output_dir=str(storage._assets_dir(job_id))
            )
            
            # Save new asset
            asset = storage.save_asset(job_id, output_path, AssetKind.BG_REMOVED)
            
            # Update step output
            step.output_asset_id = asset.id
            storage.save_job(job)
            
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
            v_service = get_vertex_image_service()
            if not v_service:
                raise RuntimeError("Vertex AI image service not available")

            plate_path = v_service.edit_image(
                str(input_path),
                request.remove_prompt,
                output_dir=str(storage._assets_dir(job_id))
            )
            
            plate_asset = storage.save_asset(job_id, plate_path, AssetKind.PLATE)
            pubsub.emit_log(job_id, f"Plate created: {plate_asset.id}")
            
            # Step 2: Retry extraction using plate as input
            pubsub.emit_log(job_id, "Step 2: Retrying extraction with plate...")
            v_service = get_vertex_image_service()
            if not v_service:
                 raise RuntimeError("Vertex AI image service not available")

            output_path = v_service.edit_image(
                plate_path,
                request.retry_prompt,
                output_dir=str(storage._assets_dir(job_id))
            )
            
            output_asset = storage.save_asset(job_id, output_path, AssetKind.LAYER)
            
            # Update step
            step.output_asset_id = output_asset.id
            step.custom_prompt = f"[Plate+Retry] {request.retry_prompt}"
            storage.save_job(job)
            
            pubsub.emit_log(job_id, "Plate and retry completed")
            pubsub.emit_step_updated(job_id, step.model_dump(mode='json'))
            
        except Exception as e:
            pubsub.emit_log(job_id, f"Plate and retry failed: {str(e)}", level="error")
    
    background_tasks.add_task(do_plate_and_retry)
    
    return {"message": "Plate and retry started"}


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
            asset_path = Path(asset.path)
            if asset_path.exists():
                zf.write(asset_path, f"assets/{asset_path.name}")
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{job_id}_export.zip"
    )
