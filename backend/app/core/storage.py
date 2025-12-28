import os
import json
import uuid
import shutil
from pathlib import Path
from typing import Optional, Dict
from datetime import datetime
from PIL import Image

from app.models.schemas import Job, Asset, AssetKind


class Storage:
    """Local filesystem storage for jobs and assets."""
    
    def __init__(self, base_path: str = "./data/jobs"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
    
    def _job_dir(self, job_id: str) -> Path:
        """Get job directory path."""
        return self.base_path / job_id
    
    def _assets_dir(self, job_id: str) -> Path:
        """Get assets directory path."""
        return self._job_dir(job_id) / "assets"
    
    def _job_file(self, job_id: str) -> Path:
        """Get job.json file path."""
        return self._job_dir(job_id) / "job.json"
    
    def create_job(self, job_id: Optional[str] = None) -> str:
        """Create a new job folder structure."""
        if job_id is None:
            job_id = str(uuid.uuid4())
        
        job_dir = self._job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        
        assets_dir = self._assets_dir(job_id)
        assets_dir.mkdir(exist_ok=True)
        
        logs_dir = job_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Initialize empty job
        job = Job(id=job_id)
        self.save_job(job)
        
        return job_id
    
    def save_job(self, job: Job) -> None:
        """Save job to job.json (atomic write)."""
        job.updated_at = datetime.utcnow()
        job_file = self._job_file(job.id)
        
        # Atomic write using temp file
        temp_file = job_file.with_suffix('.tmp')
        with open(temp_file, 'w') as f:
            json.dump(job.model_dump(mode='json'), f, indent=2, default=str)
        
        temp_file.replace(job_file)
    
    def load_job(self, job_id: str) -> Optional[Job]:
        """Load job from job.json."""
        job_file = self._job_file(job_id)
        
        if not job_file.exists():
            return None
        
        with open(job_file, 'r') as f:
            data = json.load(f)
        
        return Job(**data)
    
    def save_asset(
        self,
        job_id: str,
        image_path: str,
        kind: AssetKind,
        asset_id: Optional[str] = None
    ) -> Asset:
        """Save an asset image and return Asset metadata."""
        if asset_id is None:
            asset_id = str(uuid.uuid4())
        
        # Get image dimensions
        with Image.open(image_path) as img:
            width, height = img.size
        
        # Copy to assets directory
        ext = Path(image_path).suffix or '.png'
        dest_path = self._assets_dir(job_id) / f"{asset_id}{ext}"
        shutil.copy2(image_path, dest_path)
        
        asset = Asset(
            id=asset_id,
            kind=kind,
            path=str(dest_path),
            width=width,
            height=height
        )
        
        # Update job with new asset
        job = self.load_job(job_id)
        if job:
            job.assets[asset_id] = asset
            self.save_job(job)
        
        return asset
    
    def get_asset_path(self, job_id: str, asset_id: str) -> Optional[Path]:
        """Get the file path for an asset."""
        job = self.load_job(job_id)
        if not job or asset_id not in job.assets:
            return None
        
        asset = job.assets[asset_id]
        path = Path(asset.path)
        
        if path.exists():
            return path
        
        return None
    
    def list_jobs(self) -> list[str]:
        """List all job IDs."""
        if not self.base_path.exists():
            return []
        
        return [
            d.name for d in self.base_path.iterdir()
            if d.is_dir() and (d / "job.json").exists()
        ]
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job and all its assets."""
        job_dir = self._job_dir(job_id)
        if job_dir.exists() and job_dir.is_dir():
            shutil.rmtree(job_dir)
            return True
        return False


# Global storage instance
storage = Storage()
