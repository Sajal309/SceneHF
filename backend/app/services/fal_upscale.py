import os
import uuid
from io import BytesIO
from pathlib import Path
from typing import Optional

try:
    import fal_client
    FAL_AVAILABLE = True
except ImportError:
    FAL_AVAILABLE = False
    print("Warning: fal-client not installed. Upscaling will not be available.")


class FalUpscaleService:
    """Fal.ai image upscaling service."""

    def __init__(self):
        if not FAL_AVAILABLE:
            raise ImportError("fal-client package not installed. Run: pip install fal-client")

    @staticmethod
    def _invoke_model(model_id: str, arguments: dict):
        if callable(getattr(fal_client, "subscribe", None)):
            return fal_client.subscribe(model_id, arguments=arguments)
        if callable(getattr(fal_client, "run", None)):
            return fal_client.run(model_id, arguments=arguments)
        if callable(getattr(fal_client, "submit", None)):
            request_handle = fal_client.submit(model_id, arguments=arguments)
            if callable(getattr(request_handle, "get", None)):
                return request_handle.get()
            if callable(getattr(request_handle, "result", None)):
                return request_handle.result()
            raise RuntimeError("Unsupported fal-client submit handle (missing get/result)")
        raise RuntimeError("Unsupported fal-client version: no subscribe/run/submit API found")

    def upscale(
        self,
        input_path: str,
        factor: int = 2,
        output_dir: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        """
        Upscale an image using Fal.ai.
        """
        resolved_key = api_key or os.getenv("FAL_KEY")
        if not resolved_key:
            raise ValueError("Fal API key is missing. Provide X-Fal-Api-Key or set FAL_KEY.")
        os.environ["FAL_KEY"] = resolved_key

        model_id = model or os.getenv("FAL_UPSCALE_MODEL", "fal-ai/imageutils/upscale")
        try:
            factor_int = int(factor)
        except Exception:
            factor_int = 2
        factor_int = max(1, min(6, factor_int))

        upload_fn = getattr(fal_client, "upload_file", None)
        if not callable(upload_fn):
            raise RuntimeError("fal_client.upload_file is unavailable in this fal-client version")
        image_url = upload_fn(input_path)

        arg_candidates = [
            {"image_url": image_url, "scale": factor_int},
            {"image_url": image_url, "upscale_factor": factor_int},
            {"image_url": image_url, "scale_factor": factor_int},
            {"image_url": image_url, "factor": factor_int},
            {"image_url": image_url},
        ]

        result = None
        errors = []
        for args in arg_candidates:
            try:
                result = self._invoke_model(model_id, args)
                break
            except Exception as e:
                errors.append(f"{args}: {e}")

        if result is None:
            raise RuntimeError(
                f"Fal.ai upscale failed for model '{model_id}'. Tried multiple argument formats. "
                f"Last errors: {errors[-2:]}"
            )

        output_url = None
        if isinstance(result, dict):
            output_url = (
                result.get("image", {}).get("url")
                or (result.get("images", [{}])[0] or {}).get("url")
                or result.get("output", {}).get("url")
                or result.get("url")
            )
        if not output_url:
            raise RuntimeError(
                f"Fal.ai returned no output image. Response keys: "
                f"{list(result.keys()) if isinstance(result, dict) else type(result)}"
            )

        if output_dir is None:
            output_dir = str(Path(input_path).parent)
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = out_dir / f"{uuid.uuid4()}.png"

        import requests
        from PIL import Image

        response = requests.get(output_url, timeout=90)
        response.raise_for_status()
        with Image.open(BytesIO(response.content)) as img:
            img.convert("RGBA").save(output_path, format="PNG")

        return str(output_path)


try:
    fal_upscale_service = FalUpscaleService()
except ImportError as e:
    print(f"Fal upscale service not available: {e}")
    fal_upscale_service = None
