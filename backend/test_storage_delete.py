import os
import shutil
from pathlib import Path
from app.core.storage import Storage

# Setup test environment
TEST_DIR = "./data/test_jobs"
if os.path.exists(TEST_DIR):
    shutil.rmtree(TEST_DIR)

storage = Storage(base_path=TEST_DIR)

def test_delete():
    print("Testing delete functionality...")
    
    # 1. Create a job
    job_id = storage.create_job()
    print(f"Created job: {job_id}")
    
    job_dir = Path(TEST_DIR) / job_id
    if not job_dir.exists():
        print("FAIL: Job directory not created")
        return
        
    print(f"Job directory verified at {job_dir}")
    
    # 2. Delete the job
    success = storage.delete_job(job_id)
    print(f"Delete operation success: {success}")
    
    if not success:
        print("FAIL: delete_job returned False")
        return
        
    if job_dir.exists():
        print("FAIL: Job directory still exists after deletion")
        return
        
    print("SUCCESS: Job directory removed")

if __name__ == "__main__":
    try:
        test_delete()
    finally:
        # Cleanup
        if os.path.exists(TEST_DIR):
            shutil.rmtree(TEST_DIR)
