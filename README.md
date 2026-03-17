# SceneHF - AI Image Layer Extraction Tool

A local application for AI-powered image layer extraction and plate creation with dynamic planning, interactive refinement, and real-time progress tracking.

## Features

- **🧠 Dynamic Planning**: AI analyzes your scene and creates a custom extraction plan
- **⚡ Auto-Execution**: Steps run automatically with validation and smart pausing
- **🎨 Interactive Refinement**: Retry, adjust prompts, or create plates on the fly
- **📊 Real-time Updates**: SSE-powered live logs and status updates
- **💾 Local Storage**: All jobs saved locally for resumption anytime

### Storage (macOS)
- Default root: `~/Pictures/SceneGen/jobs/<job_id>/`
- Assets live under `assets/source`, `assets/generations`, `assets/masks`, `assets/derived`
- History logs per run: `history/<timestamp>_<step>_<run>.json`
- Override location with `STORAGE_ROOT`; open a job folder via `POST /api/jobs/{job_id}/open-in-finder` or the **Open in Finder** button in the UI.

## Architecture

### Backend (FastAPI)
- **Storage**: Local filesystem (`~/Pictures/SceneGen/jobs/<job_id>/` by default)
- **AI Services**:
  - Planner: Gemini or OpenAI for dynamic step generation
  - Vertex AI: Image editing (extraction & removal)
  - Fal.ai: Background removal
- **Validation**: Automated output quality checks
- **Runner**: Sequential step execution with auto-pause

### Frontend (React + Vite)
- **Pages**: Home (upload) and Job (3-column layout)
- **Components**: Timeline, Preview, Actions, Logs
- **Real-time**: SSE connection for live updates

## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- Google Cloud account with Vertex AI enabled
- API keys for:
  - Google AI (Gemini) or OpenAI
  - Fal.ai

### Backend Setup

1. **Install dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   # Planner
   PLANNER_PROVIDER=gemini
   GOOGLE_API_KEY=your-gemini-api-key
   # OR
   OPENAI_API_KEY=sk-your-openai-key
   
   # Vertex AI
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
   GCP_PROJECT_ID=your-project-id
   GCP_REGION=us-central1
   
   # Fal.ai
   FAL_KEY=your-fal-key
   ```

3. **Run server**:
   ```bash
   python -m app.main
   # or
   uvicorn app.main:app --reload
   ```

   Server runs at `http://localhost:8000`

### Frontend Setup

1. **Install dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Run dev server**:
   ```bash
   # full local dev (backend + frontend, recommended on macOS)
   ./start-dev.sh

   # from repo root (recommended)
   ./start-frontend.sh

   # or from frontend/
   npm run dev
   ```

   Frontend runs at `http://127.0.0.1:5174` (fixed dev port)
   Backend runs at `http://127.0.0.1:8000`

## Deploy Frontend to GitHub Pages

GitHub Pages can host only the frontend static app. The FastAPI backend must stay deployed elsewhere.

1. **Push to `main`**
   - Workflow file: `.github/workflows/deploy-pages.yml`
   - It builds `frontend/` and publishes `frontend/dist` to Pages.

2. **Enable Pages in repo settings**
   - GitHub: `Settings -> Pages -> Build and deployment -> Source: GitHub Actions`.

3. **Set backend URL for frontend**
   - Add a repo variable in GitHub:
     - `Settings -> Secrets and variables -> Actions -> Variables`
     - Name: `VITE_API_BASE`
     - Value example: `https://your-backend-domain.com/api`

4. **Allow your Pages origin in backend CORS**
   - In backend env, set:
     - `CORS_ALLOW_ORIGINS=https://<your-user>.github.io`
   - If you use a custom domain, add it as well (comma-separated).

Notes:
- Frontend API base now reads `VITE_API_BASE` and falls back to `/api` for local dev.
- The workflow builds with `--base=./` so assets resolve correctly on project pages.

## Browser-Only Branch Notes

The `codex/browser-storage-modes` branch replaces the active frontend runtime with browser-owned storage and browser-side provider calls.

What that branch currently supports:
- browser session storage mode
- local-folder storage mode via the File System Access API
- OpenAI image generation/edit from the browser
- Gemini image generation/edit from the browser
- Fal background removal only through a proxy URL

What it does not support:
- direct browser-to-Fal queue calls from static hosting
- hidden server-side processing inside GitHub Pages

## Fal Proxy With BYOK (Cloudflare Worker)

If you want Fal background removal on the browser-only branch, use the Worker in [workers/fal-proxy/README.md](/Users/sajal/Documents/SceneHF/workers/fal-proxy/README.md).

Architecture:
- the frontend keeps the user flow browser-first
- the user still brings their own Fal key
- the frontend sends that key to your Cloudflare Worker in `x-fal-api-key`
- the Worker forwards the request to Fal and returns the processed image

### Deploy the Worker

1. Install and deploy:
   ```bash
   cd workers/fal-proxy
   npm install
   npm run deploy
   ```

2. Copy the deployed Worker URL.

3. In the app settings, set:
   - `Fal AI API Key`: the user's own Fal key
   - `Fal Proxy URL`: your deployed Worker URL

4. Keep `Background Removal Mode` set to the Fal model you want, for example:
   - `fal-ai/imageutils/rembg`

### Why this is needed

Fal background removal cannot be completed directly from a static browser app because the browser request path runs into Fal auth/CORS constraints. The Worker is the minimal proxy layer that makes the browser UX work while still keeping the user on a BYOK flow.

## Usage

### 1. Upload Image
- Open `http://127.0.0.1:5174`
- Drag & drop or select a background image

### 2. Generate Plan
- Click **Plan** to analyze the scene
- AI creates dynamic extraction steps

### 3. Run Steps
- Click **Run** to execute all steps
- Execution auto-pauses on `NEEDS_REVIEW` or `FAILED`

### 4. Refine Outputs
For any step, you can:
- ✅ **Accept**: Mark as final output
- 🪄 **Remove BG**: Apply Fal.ai background removal
- 🔁 **Retry**: Re-run with custom prompt
- 🧹 **Plate + Retry**: Remove occluders first, then retry

### 5. Export
- Click **Export** to download zip with:
  - All assets
  - job.json
  - plan.json

## API Endpoints

### Jobs
- `POST /api/jobs` - Upload image
- `GET /api/jobs/{job_id}` - Get job details
- `POST /api/jobs/{job_id}/plan` - Generate plan
- `POST /api/jobs/{job_id}/run` - Run all steps

### Steps
- `POST /api/jobs/{job_id}/steps/{step_id}/run` - Run single step
- `POST /api/jobs/{job_id}/steps/{step_id}/retry` - Retry with custom prompt
- `POST /api/jobs/{job_id}/steps/{step_id}/bg-remove` - Apply BG removal
- `POST /api/jobs/{job_id}/steps/{step_id}/plate-and-retry` - Create plate then retry
- `POST /api/jobs/{job_id}/steps/{step_id}/accept` - Accept step

### Assets & Events
- `GET /api/jobs/{job_id}/assets/{asset_id}` - Get asset image
- `GET /api/jobs/{job_id}/events` - SSE event stream
- `GET /api/jobs/{job_id}/export` - Export job bundle

## Project Structure

```
SceneHF/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── api/
│   │   │   ├── jobs.py          # Job endpoints
│   │   │   └── events.py        # SSE endpoint
│   │   ├── core/
│   │   │   ├── storage.py       # Local file storage
│   │   │   ├── pubsub.py        # SSE pubsub
│   │   │   ├── validators.py   # Output validation
│   │   │   └── runner.py        # Step orchestration
│   │   ├── services/
│   │   │   ├── planner.py       # AI planner
│   │   │   ├── vertex_image.py  # Vertex AI
│   │   │   └── fal_bgremove.py  # Fal.ai
│   │   └── models/
│   │       └── schemas.py       # Data models
│   ├── data/                    # Job storage (gitignored)
│   └── requirements.txt
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Home.tsx         # Upload page
    │   │   └── Job.tsx          # Job detail page
    │   ├── components/
    │   │   ├── UploadCard.tsx
    │   │   ├── StepTimeline.tsx
    │   │   ├── PreviewPane.tsx
    │   │   ├── StepActions.tsx
    │   │   └── LogsPanel.tsx
    │   ├── lib/
    │   │   ├── api.ts           # API client
    │   │   └── sse.ts           # SSE client
    │   └── main.tsx
    └── package.json
```

## Development

### Backend
```bash
# Fastest path (repo root, fixed port 8000)
./start-backend.sh

# Or manual
cd backend
# Install in dev mode
pip install -e .
# Run with auto-reload
../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```bash
# Full stack local dev (opens backend + frontend in separate Terminal windows, reuses healthy backend)
./start-dev.sh

# Frontend only (repo root)
./start-frontend.sh

# Or manual
cd frontend
npm install
npm run dev
# Build for production
npm run build
```

## Troubleshooting

### Backend won't start
- Check `.env` file has all required keys
- Verify Google Cloud credentials are valid
- Ensure Python 3.9+ is installed

### Frontend build errors
- Run `npm install` to ensure all dependencies are installed
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

### Dev launcher issues (`./start-dev.sh`)
- If port `8000` is in use but backend health fails, another process is occupying the backend port. Stop it and retry.
- If port `5174` is in use, stop the process using that port (fixed frontend dev port) and rerun.
- If `.venv` is missing, create it in the repo root and install backend requirements into it.
- If macOS blocks Terminal automation, allow Terminal/Script Editor automation permissions and run the printed fallback commands manually.

### SSE connection fails
- Check backend is running on port 8000
- Verify CORS settings in `main.py`
- Check browser console for errors

### Validation always fails
- Check image dimensions match source
- Verify prompts include "white background" for extractions
- Review validation metrics in logs

## License

MIT
