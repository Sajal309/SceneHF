import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.openai_image import OpenAIImageService  # noqa: E402


class OpenAIImageServiceTests(unittest.TestCase):
    def test_edit_image_passes_input_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            input_path = tmp_dir / "input_bytes_test.png"
            input_bytes = b"fake-image-bytes"
            input_path.write_bytes(input_bytes)

            service = object.__new__(OpenAIImageService)
            service.client = MagicMock()
            service._download_and_convert_webp = MagicMock(return_value=str(tmp_dir / "out.webp"))
            service.client.images.edit.return_value = SimpleNamespace(
                data=[SimpleNamespace(url="https://example.com/out.webp")]
            )

            output = service._edit_image(
                str(input_path),
                "keep style consistent",
                str(tmp_dir / "out.png"),
                {},
            )

            self.assertTrue(output.endswith("out.webp"))
            kwargs = service.client.images.edit.call_args.kwargs
            self.assertEqual(kwargs["image"], input_bytes)
            self.assertEqual(kwargs["prompt"], "keep style consistent")

    def test_remove_no_fallback_raises(self):
        service = object.__new__(OpenAIImageService)
        with patch.object(service, "_edit_image", side_effect=RuntimeError("edit failed")):
            with self.assertRaises(RuntimeError):
                service.remove(
                    "input.png",
                    "prompt",
                    "out.png",
                    config={},
                    allow_generation_fallback=False,
                )


if __name__ == "__main__":
    unittest.main()
