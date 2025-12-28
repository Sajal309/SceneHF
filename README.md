# SceneHF - AI Image Layer Extraction Tool

A local application for AI-powered image layer extraction and plate creation with dynamic planning, interactive refinement, and real-time progress tracking.

## Features

- **🧠 Dynamic Planning**: AI analyzes your scene and creates a custom extraction plan
- **⚡ Auto-Execution**: Steps run automatically with validation and smart pausing
- **🎨 Interactive Refinement**: Retry, adjust prompts, or create plates on the fly
- **📊 Real-time Updates**: SSE-powered live logs and status updates
- **💾 Local Storage**: All jobs saved locally for resumption anytime

## Architecture

### Backend (FastAPI)
- **Storage**: Local filesystem (`./data/jobs/<job_id>/`)
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
   npm run dev
   ```

   App runs at `http://localhost:5173`

## Usage

### 1. Upload Image
- Open `http://localhost:5173`
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
cd backend
# Install in dev mode
pip install -e .
# Run with auto-reload
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
# Install dependencies
npm install
# Run dev server
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
