# SceneHF: AI Coding Agent Instructions

## Project Overview

**SceneHF** is a local AI-powered image layer extraction and plate creation tool. Users upload source images, the system generates dynamic extraction plans using LLMs, then orchestrates step-by-step execution with AI image services, validation, and interactive refinement.

### Architecture Layers

1. **Backend (FastAPI)**: `backend/app/`
   - **API** (`api/jobs.py`, `api/events.py`): HTTP endpoints & SSE event streaming
   - **Core** (`core/runner.py`, `core/storage.py`, `core/pubsub.py`): Step execution orchestration, filesystem storage, in-memory pub/sub
   - **Services** (`services/planner.py`, `services/*_image.py`): AI provider integrations (Gemini/OpenAI planner, Vertex/Fal image ops)
   - **Models** (`models/schemas.py`): Pydantic job/step/asset schemas
   - **Validators** (`core/validators.py`, `core/masks.py`): Output quality checks

2. **Frontend (React + Vite)**: `frontend/src/`
   - 3-column layout: Timeline (left) → Preview (center) → Actions (right)
   - Real-time SSE subscription for logs and job updates

### Data Flow

```
Upload → Create Job → Plan Steps → Run Step Loop:
  1. Load input asset
  2. Call AI image service (Vertex/FAL/Gemini)
  3. Validate output (pixel density, dimensions, color)
  4. Save asset + emit SSE events
  5. Pause if validation fails → user can retry/refine
```

## Critical Design Decisions

- **Local Storage First**: Assets stored in `~/Pictures/SceneGen/jobs/<job_id>/assets/{source,generations,masks,derived}/` (configurable via `STORAGE_ROOT`)
- **White Background Enforced**: ALL extractions & clean plates must have solid white (`#FFFFFF`) backgrounds—validated server-side
- **No Cropping/Shifting**: Exact pixel alignment preserved; output dimensions match input
- **History Tracking**: Each step run saved in `history/<timestamp>_<step>_<run>.json` for auditability
- **Pauseable Execution**: Jobs can pause mid-execution; steps can be retried with custom prompts or background removal

## Key Files & Patterns

### Schemas (Know This First)
- [app/models/schemas.py](../backend/app/models/schemas.py): All Pydantic models
  - `Job`: Container with status (IDLE→PLANNED→RUNNING→DONE), steps list, assets dict
  - `Step`: Individual task with type (ANALYZE/EXTRACT/REMOVE/BG_REMOVE/REFRAME), status, input/output asset IDs
  - `Asset`: File metadata with kind (SOURCE/PLATE/LAYER/MASK/BG_REMOVED/DEBUG)
  - `StepStatus`: QUEUED→RUNNING→SUCCESS/NEEDS_REVIEW/FAILED/CANCELLED
  - `MaskMode`: NONE/AUTO/MANUAL; masks enable inpainting during extraction

### Step Execution: The Runner
- [app/core/runner.py](../backend/app/core/runner.py) → `Runner.run_step()` is the central orchestrator
  - Loads job → finds step → calls appropriate service (Vertex/FAL/Gemini)
  - **Critical check**: If `job.status == PAUSED` or `step.status == CANCELLED`, skip execution
  - Validates output using `validator.validate_extraction()` or similar
  - On validation fail → auto-pause and emit `NEEDS_REVIEW` status (user retries or masks)
  - Emits SSE events via `pubsub.emit_*()` throughout

### Storage: The Source of Truth
- [app/core/storage.py](../backend/app/core/storage.py) → `StorageManager` singleton
  - Job state: `save_job(job)` / `load_job(job_id)` use atomic JSON writes
  - Assets: `save_asset(job_id, path, kind)` copies files to `assets/<kind>/` subdir
  - History: `save_history_record(job_id, record)` timestamps each run
  - Asset paths built via `get_asset_path(job_id, asset_id)` → returns full filesystem path
  - **Atomic writes**: Temp file + rename to prevent corruption

### Event Streaming (Real-Time UI Updates)
- [app/core/pubsub.py](../backend/app/core/pubsub.py) → In-memory async queue per job
  - `pubsub.subscribe(job_id)` returns async generator yielding SSE strings
  - `pubsub.emit(job_id, event_type, data)` broadcasts to all connected clients
  - Called by runner: `emit_step_updated()`, `emit_log()`, `emit_job_updated()`

### API Endpoints (Entry Points)
- [app/api/jobs.py](../backend/app/api/jobs.py)
  - `POST /api/jobs` → Create job from uploaded image
  - `POST /api/jobs/{job_id}/plan` → Generate plan via planner
  - `POST /api/jobs/{job_id}/run-step` → Execute single step
  - `POST /api/jobs/{job_id}/retry` / `/plate-and-retry` → Refinement flows
  - Background tasks queued via `BackgroundTasks` for long-running ops

### Planner: Dynamic Step Generation
- [app/services/planner.py](../backend/app/services/planner.py)
  - Supports OpenAI & Gemini via environment variables (`PLANNER_PROVIDER`)
  - Encodes image as base64, sends to LLM with structured prompt
  - Returns `Plan` with `scene_summary`, `global_rules`, `steps[]` (each with prompts, prompt_variations, validation thresholds)
  - Validation rules defined as `validate: {min_nonwhite: X, max_nonwhite: Y}` for extractions

### Image Services (Plugin Pattern)
- [app/services/](../backend/app/services/) → Each provider is independent
  - `vertex_image.py` → Google Cloud Vertex AI Image Generator (inpainting)
  - `fal_bgremove.py` → Fal.ai Background Removal (fast pre-processing)
  - `openai_image.py` → OpenAI DALL-E 3
  - `gemini_image.py` → Google Gemini (fallback image generation)
  - Each has `edit_image(prompt, input_path, output_path, ...)` signature

### Validation: Quality Gate
- [app/core/validators.py](../backend/app/core/validators.py)
  - `validator.validate_extraction(image_path, min_nonwhite, max_nonwhite)` → checks pixel color density
  - Returns `ValidationResult` with status (SUCCESS/NEEDS_REVIEW/FAILED) + metrics

## Common Workflows

### Adding a New Image Service
1. Create `backend/app/services/newprovider_image.py`
2. Implement `edit_image(prompt, input_path, output_path, **kwargs) → str` returning output path
3. In runner.py, add conditional: `if service_type == "newprovider": ...`
4. Update schemas if new config fields needed (e.g., `image_config: Dict`)

### Debugging Failed Steps
1. Check `backend/data/jobs/<job_id>/history/` for the most recent run JSON
2. Look at `pubsub` logs emitted during `run_step()`
3. Inspect output image at `assets/generations/` or `assets/derived/`
4. Check validation thresholds in plan vs actual pixel density

### Local Development

**Backend Setup:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Add GOOGLE_API_KEY, OPENAI_API_KEY, etc.
python -m app.main  # or uvicorn app.main:app --reload
```

**Frontend Setup:**
```bash
cd frontend
npm install
npm run dev  # Runs on localhost:5173
```

**Testing Services:**
- `backend/test_planner.py` → Test LLM plan generation
- `backend/test_i2i.py` → Test image editing pipelines
- `backend/verify_genai.py` → Validate Gemini setup

## Naming & Code Conventions

- **IDs**: UUIDs for jobs/steps, hex(10) for run_ids (e.g., "a1b2c3d4e5")
- **Timestamps**: `YYYYMMDD_HHMMSS_mmm` format in history filenames
- **Status Fields**: Use Pydantic Enums (e.g., `JobStatus.RUNNING`, `StepStatus.NEEDS_REVIEW`)
- **Prompt Variations**: Always generate 3–5 alternatives for resilience; stored in `step.prompt_variations`
- **Asset Paths**: Never hardcode; always use `storage.get_asset_path(job_id, asset_id)`
- **Async**: Runner uses `asyncio` for concurrent operations; FastAPI routes are async

## Environment Variables

```
PLANNER_PROVIDER=gemini|openai
GOOGLE_API_KEY=<gemini-api-key>
OPENAI_API_KEY=<openai-key>
GOOGLE_APPLICATION_CREDENTIALS=<path-to-gcp-json>
GCP_PROJECT_ID=<gcp-project>
GCP_REGION=us-central1
FAL_KEY=<fal-ai-key>
STORAGE_ROOT=~/Pictures/SceneGen  # Default
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image  # Default
```

## Important Gotchas

1. **CWD Matters**: Startup checks use `./data/jobs` relative path; always run uvicorn from `/backend`
2. **White Backgrounds**: Validation is **pixel-strict**; any non-white triggers NEEDS_REVIEW
3. **Async Context**: Don't use blocking I/O in `run_step()`; use `aiofiles` if needed
4. **SSE Subscriptions**: Disconnected clients automatically cleaned up; no memory leaks
5. **Atomic JSON**: Always use `storage._write_atomic()` for job state to prevent corruption
