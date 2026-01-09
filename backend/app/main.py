from contextlib import asynccontextmanager
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
            job = storage.load_job(jid)
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

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
