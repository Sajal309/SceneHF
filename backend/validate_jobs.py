import os
import sys
from pathlib import Path

# Add backend to path
sys.path.append("/Users/sajal/Documents/SceneHF/backend")

from app.core.storage import storage
from app.models.schemas import Job

def validate_all():
    job_ids = storage.list_jobs()
    print(f"Found {len(job_ids)} jobs.")
    
    for jid in job_ids:
        try:
            job = storage.load_job(jid)
            print(f"Job {jid}: VALID")
        except Exception as e:
            print(f"Job {jid}: INVALID - {e}")

if __name__ == "__main__":
    validate_all()
