import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api import jobs as jobs_api  # noqa: E402
from app.models.schemas import Asset, AssetKind, EditRequest, Job  # noqa: E402


def _build_job(job_id: str = "job-1") -> Job:
    source = Asset(id="source-1", kind=AssetKind.SOURCE, path="jobs/j/assets/source/source.png")
    generation = Asset(id="gen-1", kind=AssetKind.GENERATION, path="jobs/j/assets/generations/gen.png")
    mask = Asset(id="mask-1", kind=AssetKind.MASK, path="jobs/j/assets/masks/mask.png")
    return Job(
        id=job_id,
        source_image=source.id,
        assets={
            source.id: source,
            generation.id: generation,
            mask.id: mask,
        },
        steps=[],
    )


class EditEndpointTests(unittest.TestCase):
    def test_edit_defaults_to_source_input(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api.storage, "save_job", return_value=None),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
            patch.object(jobs_api.pubsub, "emit_step_updated", return_value=None),
            patch.object(jobs_api.pubsub, "emit_job_updated", return_value=None),
        ):
            asyncio.run(
                jobs_api.edit_job(
                    "job-1",
                    BackgroundTasks(),
                    EditRequest(prompt="test edit", image_config={}),
                )
            )

        self.assertEqual(len(job.steps), 1)
        self.assertEqual(job.steps[0].input_asset_id, "source-1")

    def test_edit_rejects_unknown_input_asset(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
        ):
            with self.assertRaises(HTTPException) as exc:
                asyncio.run(
                    jobs_api.edit_job(
                        "job-1",
                        BackgroundTasks(),
                        EditRequest(prompt="test edit", image_config={}, input_asset_id="missing"),
                    )
                )
        self.assertEqual(exc.exception.status_code, 404)

    def test_edit_rejects_mask_input_asset(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
        ):
            with self.assertRaises(HTTPException) as exc:
                asyncio.run(
                    jobs_api.edit_job(
                        "job-1",
                        BackgroundTasks(),
                        EditRequest(prompt="test edit", image_config={}, input_asset_id="mask-1"),
                    )
                )
        self.assertEqual(exc.exception.status_code, 400)

    def test_edit_accepts_generation_asset_as_input(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api.storage, "save_job", return_value=None),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
            patch.object(jobs_api.pubsub, "emit_step_updated", return_value=None),
            patch.object(jobs_api.pubsub, "emit_job_updated", return_value=None),
        ):
            asyncio.run(
                jobs_api.edit_job(
                    "job-1",
                    BackgroundTasks(),
                    EditRequest(prompt="test edit", image_config={}, input_asset_id="gen-1"),
                )
            )

        self.assertEqual(len(job.steps), 1)
        self.assertEqual(job.steps[0].input_asset_id, "gen-1")

    def test_edit_rejects_partial_style_reference(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
        ):
            with self.assertRaises(HTTPException) as exc:
                asyncio.run(
                    jobs_api.edit_job(
                        "job-1",
                        BackgroundTasks(),
                        EditRequest(
                            prompt="test edit",
                            image_config={},
                            style_reference_job_id="style-job",
                        ),
                    )
                )
        self.assertEqual(exc.exception.status_code, 400)

    def test_edit_accepts_cross_job_style_reference(self):
        job = _build_job("job-1")
        style_job = _build_job("style-job")

        def _load_job(job_id: str, recover_missing_outputs: bool = True):
            if job_id == "job-1":
                return job
            if job_id == "style-job":
                return style_job
            return None

        with (
            patch.object(jobs_api.storage, "load_job", side_effect=_load_job),
            patch.object(jobs_api.storage, "save_job", return_value=None),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
            patch.object(jobs_api.pubsub, "emit_step_updated", return_value=None),
            patch.object(jobs_api.pubsub, "emit_job_updated", return_value=None),
        ):
            asyncio.run(
                jobs_api.edit_job(
                    "job-1",
                    BackgroundTasks(),
                    EditRequest(
                        prompt="test edit",
                        image_config={},
                        style_reference_job_id="style-job",
                        style_reference_asset_id="gen-1",
                    ),
                )
            )

        self.assertEqual(len(job.steps), 1)
        cfg = job.steps[0].image_config or {}
        self.assertEqual(cfg.get("__style_reference_job_id"), "style-job")
        self.assertEqual(cfg.get("__style_reference_asset_id"), "gen-1")

    def test_edit_stores_scene_sequence_id(self):
        job = _build_job()
        with (
            patch.object(jobs_api.storage, "load_job", return_value=job),
            patch.object(jobs_api.storage, "save_job", return_value=None),
            patch.object(jobs_api, "_update_job_keys_from_headers", return_value=False),
            patch.object(jobs_api.pubsub, "emit_step_updated", return_value=None),
            patch.object(jobs_api.pubsub, "emit_job_updated", return_value=None),
        ):
            asyncio.run(
                jobs_api.edit_job(
                    "job-1",
                    BackgroundTasks(),
                    EditRequest(
                        prompt="test edit",
                        image_config={},
                        scene_sequence_id="scene-seq-123",
                    ),
                )
            )

        self.assertEqual(len(job.steps), 1)
        cfg = job.steps[0].image_config or {}
        self.assertEqual(cfg.get("__scene_sequence_id"), "scene-seq-123")


if __name__ == "__main__":
    unittest.main()
