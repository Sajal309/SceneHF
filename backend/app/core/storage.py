import os
import json
import uuid
import shutil
from pathlib import Path
from typing import Optional, Dict, Iterable
from datetime import datetime
from PIL import Image

from app.models.schemas import Job, Asset, AssetKind, StepStatus, StepAction


def _timestamp_ms() -> str:
    """Return local timestamp in YYYYMMDD_HHMMSS_mmm."""
    dt = datetime.now()
    return dt.strftime("%Y%m%d_%H%M%S_") + f"{int(dt.microsecond / 1000):03d}"


class StorageManager:
    """Filesystem storage manager for job assets and history."""

    def __init__(self):
        default_root = Path.home() / "Pictures" / "SceneGen"
        env_root = os.getenv("STORAGE_ROOT", str(default_root))
        self.storage_root = Path(env_root).expanduser()
        self.jobs_root = self.storage_root / "jobs"
        # Legacy path for backward compatibility
        self.legacy_jobs_root = Path("./data/jobs")
        self.jobs_root.mkdir(parents=True, exist_ok=True)

    # ---- Helpers ----
    def now_timestamp(self) -> str:
        return _timestamp_ms()

    def new_run_id(self) -> str:
        return uuid.uuid4().hex[:10]

    def _job_dir(self, job_id: str) -> Path:
        return self.jobs_root / job_id

    def _job_file(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "job.json"

    def _assets_dir(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "assets"

    def _assets_subdir(self, job_id: str, name: str) -> Path:
        return self._assets_dir(job_id) / name

    def _history_dir(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "history"

    def _exports_dir(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "exports"

    def _ensure_job_dirs(self, job_id: str) -> None:
        for path in (
            self._job_dir(job_id),
            self._assets_dir(job_id),
            self._assets_subdir(job_id, "source"),
            self._assets_subdir(job_id, "generations"),
            self._assets_subdir(job_id, "masks"),
            self._assets_subdir(job_id, "derived"),
            self._history_dir(job_id),
            self._exports_dir(job_id),
        ):
            path.mkdir(parents=True, exist_ok=True)

    def _write_atomic(self, path: Path, data: dict) -> None:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        tmp_path.replace(path)

    def _unique_path(self, base_path: Path) -> Path:
        candidate = base_path
        counter = 1
        while candidate.exists():
            candidate = base_path.with_name(f"{base_path.stem}_{counter}{base_path.suffix}")
            counter += 1
        return candidate

    def _resolve_relative(self, base: Path, path_str: str) -> Path:
        return (base / path_str).expanduser().resolve()

    # ---- Job operations ----
    def create_job(self, job_id: Optional[str] = None) -> str:
        """Create a new job structure and persist an empty job.json."""
        if job_id is None:
            job_id = str(uuid.uuid4())

        self._ensure_job_dirs(job_id)
        job = Job(id=job_id, storage_root=str(self.storage_root))
        self.save_job(job)
        return job_id

    def save_job(self, job: Job) -> None:
        """Save job to disk using atomic replace."""
        self._ensure_job_dirs(job.id)
        if not job.storage_root:
            job.storage_root = str(self.storage_root)
        job.updated_at = datetime.utcnow()
        self._write_atomic(self._job_file(job.id), job.model_dump(mode="json"))

    def load_job(self, job_id: str) -> Optional[Job]:
        """Load job.json from storage root or legacy location."""
        job_file = self._job_file(job_id)
        if job_file.exists():
            with open(job_file, "r") as f:
                data = json.load(f)
            job = Job(**data)
            # If the job file is in the new storage root, enforce that root
            job.storage_root = str(self.storage_root)
            self._recover_missing_outputs(job)
            return job

        legacy_file = self.legacy_jobs_root / job_id / "job.json"
        if legacy_file.exists():
            with open(legacy_file, "r") as f:
                data = json.load(f)
            job = Job(**data)
            # Legacy jobs keep their relative paths; record new storage root for future assets
            job.storage_root = str(self.storage_root)
            self._recover_missing_outputs(job)
            return job
        return None

    def _recover_missing_outputs(self, job: Job) -> None:
        """If a step has generated assets but no output_asset_id, reattach the newest one."""
        changed = False
        # Import any on-disk assets that are missing from job.assets (legacy runs)
        if self._import_missing_assets(job):
            changed = True

        # Map step_id -> list of assets
        assets_by_step: Dict[str, list[Asset]] = {}
        for asset in job.assets.values():
            if asset.step_id:
                assets_by_step.setdefault(asset.step_id, []).append(asset)

        for step in job.steps:
            if step.output_asset_id:
                continue
            candidates = assets_by_step.get(step.id, [])
            if not candidates:
                continue
            # pick newest by created_at
            latest = sorted(candidates, key=lambda a: a.created_at, reverse=True)[0]
            step.output_asset_id = latest.id
            # If step was cancelled/queued, mark as needs review so UI shows preview
            if step.status in (StepStatus.CANCELLED, StepStatus.QUEUED, StepStatus.FAILED):
                step.status = StepStatus.NEEDS_REVIEW
                step.validation = None
                step.actions_available = [StepAction.ACCEPT, StepAction.RETRY, StepAction.BG_REMOVE, StepAction.PLATE_AND_RETRY]
            # Keep outputs history
            if latest.id not in step.outputs_history:
                step.outputs_history.append(latest.id)
            changed = True

        if changed:
            self.save_job(job)

    def _import_missing_assets(self, job: Job) -> bool:
        """Scan the assets folder and register any files not present in job.assets."""
        root = Path(job.storage_root or self.storage_root)
        assets_dir = root / "jobs" / job.id / "assets"
        if not assets_dir.exists():
            return False
        existing_paths = {Path(a.path).name for a in job.assets.values()}
        added = False

        def infer_step_id(name: str) -> Optional[str]:
            parts = name.split("_")
            for part in parts:
                if part.startswith("s") and len(part) <= 4:
                    return part
            return None

        def infer_kind(name: str) -> AssetKind:
            lower = name.lower()
            if "mask" in lower:
                return AssetKind.MASK
            if "bg_removed" in lower:
                return AssetKind.BG_REMOVED
            return AssetKind.GENERATION

        for file in assets_dir.rglob("*"):
            if not file.is_file():
                continue
            if file.name in existing_paths:
                continue
            try:
                with Image.open(file) as img:
                    width, height = img.size
            except Exception:
                continue

            step_id = infer_step_id(file.name)
            asset = Asset(
                id=str(uuid.uuid4()),
                kind=infer_kind(file.name),
                path=str(file.relative_to(self.storage_root)),
                width=width,
                height=height,
                step_id=step_id,
                run_id=None,
                model=None,
                prompt_hash=None,
            )
            job.assets[asset.id] = asset
            added = True
        return added

    def list_jobs(self) -> list[str]:
        """List job IDs from new and legacy roots."""
        ids: set[str] = set()
        if self.jobs_root.exists():
            ids.update(
                p.name for p in self.jobs_root.iterdir()
                if p.is_dir() and (p / "job.json").exists()
            )
        if self.legacy_jobs_root.exists():
            ids.update(
                p.name for p in self.legacy_jobs_root.iterdir()
                if p.is_dir() and (p / "job.json").exists()
            )
        return sorted(ids)

    def delete_job(self, job_id: str) -> bool:
        """Delete a job directory (new root only)."""
        job_dir = self._job_dir(job_id)
        if job_dir.exists() and job_dir.is_dir():
            shutil.rmtree(job_dir)
            return True
        return False

    # ---- Asset resolution ----
    def _candidate_paths(self, job: Job, asset_path: str) -> Iterable[Path]:
        path_obj = Path(asset_path)
        if path_obj.is_absolute():
            yield path_obj
        if job.storage_root:
            yield self._resolve_relative(Path(job.storage_root), asset_path)
        # Legacy relative paths
        yield path_obj.expanduser().resolve()
        yield self.legacy_jobs_root / asset_path
        # Repo-level legacy path (backend/data/jobs/...)
        repo_backend = Path(__file__).resolve().parents[2] / "data" / "jobs"
        yield repo_backend / path_obj.name if path_obj.name else repo_backend / asset_path
        yield repo_backend / asset_path

    def get_asset_path(self, job_id: str, asset_id: str) -> Optional[Path]:
        job = self.load_job(job_id)
        if not job or asset_id not in job.assets:
            return None
        asset = job.assets[asset_id]
        for candidate in self._candidate_paths(job, asset.path):
            if candidate.exists():
                return candidate
        return None

    # ---- Asset persistence ----
    def save_asset(
        self,
        job_id: str,
        image_path: str,
        kind: AssetKind,
        asset_id: Optional[str] = None,
        job: Optional[Job] = None,
        step_id: Optional[str] = None,
        run_id: Optional[str] = None,
        model: Optional[str] = None,
        prompt_hash: Optional[str] = None,
    ) -> Asset:
        """
        Copy an existing image file into storage with a collision-safe name.
        Used for uploads and non-Gemini flows.
        """
        self._ensure_job_dirs(job_id)
        asset_id = asset_id or str(uuid.uuid4())
        ext = Path(image_path).suffix or ".png"

        # Choose destination folder
        if kind == AssetKind.SOURCE:
            dest_dir = self._assets_subdir(job_id, "source")
            filename = f"{asset_id}_source{ext}"
        elif kind == AssetKind.MASK:
            dest_dir = self._assets_subdir(job_id, "masks")
            filename = f"{self.now_timestamp()}_{step_id or 'mask'}_{run_id or asset_id}_mask{ext}"
        elif kind == AssetKind.BG_REMOVED:
            dest_dir = self._assets_subdir(job_id, "derived")
            filename = f"{self.now_timestamp()}_{step_id or 'derived'}_{run_id or asset_id}_bg_removed{ext}"
        else:
            dest_dir = self._assets_subdir(job_id, "generations")
            suffix = kind.value.lower()
            filename = f"{self.now_timestamp()}_{step_id or 'asset'}_{run_id or asset_id}_{suffix}{ext}"

        dest_path = self._unique_path(dest_dir / filename)
        shutil.copy2(image_path, dest_path)

        with Image.open(dest_path) as img:
            width, height = img.size

        rel_path = dest_path.relative_to(self.storage_root)
        asset = Asset(
            id=asset_id,
            kind=kind,
            path=str(rel_path),
            width=width,
            height=height,
            step_id=step_id,
            run_id=run_id,
            model=model,
            prompt_hash=prompt_hash,
        )

        target_job = job or self.load_job(job_id)
        if target_job:
            target_job.assets[asset.id] = asset
            target_job.storage_root = target_job.storage_root or str(self.storage_root)
            self.save_job(target_job)

        return asset

    def save_image(
        self,
        job_id: str,
        step_id: str,
        run_id: str,
        kind: str,
        pil_image: Image.Image,
        asset_kind: AssetKind = AssetKind.GENERATION,
        model: Optional[str] = None,
        prompt_hash: Optional[str] = None,
        job: Optional[Job] = None,
        subdir: str = "generations",
    ) -> Asset:
        """Persist a generated PIL image with timestamped naming."""
        self._ensure_job_dirs(job_id)
        timestamp = self.now_timestamp()
        safe_step = step_id.replace("/", "-")
        filename = f"{timestamp}_{safe_step}_{run_id}_{kind}.png"
        dest_dir = self._assets_subdir(job_id, subdir)
        dest_path = self._unique_path(dest_dir / filename)
        pil_image.save(dest_path)
        width, height = pil_image.size

        rel_path = dest_path.relative_to(self.storage_root)
        asset = Asset(
            id=str(uuid.uuid4()),
            kind=asset_kind,
            path=str(rel_path),
            width=width,
            height=height,
            step_id=step_id,
            run_id=run_id,
            model=model,
            prompt_hash=prompt_hash,
        )

        target_job = job or self.load_job(job_id)
        if target_job:
            target_job.assets[asset.id] = asset
            target_job.storage_root = target_job.storage_root or str(self.storage_root)
            self.save_job(target_job)

        return asset

    def save_mask(
        self,
        job_id: str,
        step_id: str,
        run_id: str,
        pil_mask: Image.Image,
        job: Optional[Job] = None,
    ) -> Asset:
        """Persist a mask image alongside the generation run."""
        return self.save_image(
            job_id=job_id,
            step_id=step_id,
            run_id=run_id,
            kind="mask",
            pil_image=pil_mask,
            asset_kind=AssetKind.MASK,
            job=job,
            subdir="masks",
        )

    # ---- History ----
    def write_history(self, job_id: str, step_id: str, run_id: str, data: Dict) -> Path:
        """Write a generation history record to disk."""
        self._ensure_job_dirs(job_id)
        timestamp = data.get("finished_at") or self.now_timestamp()
        safe_step = step_id.replace("/", "-")
        filename = f"{timestamp}_{safe_step}_{run_id}.json"
        dest_path = self._unique_path(self._history_dir(job_id) / filename)
        self._write_atomic(dest_path, data)
        return dest_path

    def read_history(self, job_id: str, step_id: Optional[str] = None) -> list[Dict]:
        """Read history records for a job (optionally filtered by step)."""
        records: list[Dict] = []
        hist_dir = self._history_dir(job_id)
        if not hist_dir.exists():
            return records
        for file in sorted(hist_dir.glob("*.json")):
            try:
                with open(file, "r") as f:
                    data = json.load(f)
                if step_id and data.get("step_id") != step_id:
                    continue
                records.append(data)
            except Exception:
                continue
        return records


# Global storage instance
storage = StorageManager()
