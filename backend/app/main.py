from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables from .env file
load_dotenv()

from app.api import jobs, events


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan events: startup and shutdown.
    """
    # Startup: Ensure no jobs are stuck in RUNNING state
    print("Startup: Checking for stuck jobs...")
    from app.core.storage import storage
    from app.models.schemas import JobStatus
    
    try:
        # Use absolute path to ensure we hit the right DB even if CWD varies?
        # Actually storage uses relative path "./data/jobs". 
        # If uvicorn runs from /backend, it works.
        job_ids = storage.list_jobs()
        print(f"Startup: Found {len(job_ids)} jobs.")
        for jid in job_ids:
            # Startup only needs status checks; skip expensive recovery/import scans.
            job = storage.load_job(jid, recover_missing_outputs=False)
            if job and job.status == JobStatus.RUNNING:
                print(f"Pausing stuck job: {jid}")
                job.status = JobStatus.PAUSED
                storage.save_job(job)
    except Exception as e:
        print(f"Startup check failed: {e}")
        
    yield
    # Shutdown logic if any

app = FastAPI(
    title="SceneHF API",
    description="AI-powered image layer extraction and plate creation",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
# Defaults allow local development and GitHub Pages.
cors_allow_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
extra_origins = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
if extra_origins:
    cors_allow_origins.extend(
        origin.strip() for origin in extra_origins.split(",") if origin.strip()
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    # Regex keeps localhost dev ports working and allows <user>.github.io Pages origins.
    allow_origin_regex=os.getenv(
        "CORS_ALLOW_ORIGIN_REGEX",
        r"http://localhost(:\d+)?|https://[a-zA-Z0-9-]+\.github\.io",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(jobs.router, prefix="/api", tags=["jobs"])
app.include_router(events.router, prefix="/api", tags=["events"])


@app.get("/")
async def root():
    """Health check."""
    return {"status": "ok", "service": "SceneHF API"}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
