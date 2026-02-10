import os
import uuid
from collections import deque
from io import BytesIO
from pathlib import Path
from typing import Optional

try:
    import fal_client
    FAL_AVAILABLE = True
except ImportError:
    FAL_AVAILABLE = False
    print("Warning: fal-client not installed. Background removal will not be available.")


class FalBgRemoveService:
    """Fal.ai background removal service."""
    
    def __init__(self):
        if not FAL_AVAILABLE:
            raise ImportError("fal-client package not installed. Run: pip install fal-client")
    
    def remove_bg(
        self,
        input_path: str,
        output_dir: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Remove background from image using Fal.ai.
        
        Args:
            input_path: Path to input image
            output_dir: Directory to save output (default: same as input)
        
        Returns:
            Path to output image with background removed
        """
        resolved_key = api_key or os.getenv("FAL_KEY")
        if not resolved_key:
            raise ValueError("Fal API key is missing. Provide X-Fal-Api-Key or set FAL_KEY.")
        os.environ["FAL_KEY"] = resolved_key

        model_id = model or "fal-ai/imageutils/rembg"

        # Upload image to Fal
        upload_fn = getattr(fal_client, "upload_file", None)
        if not callable(upload_fn):
            raise RuntimeError("fal_client.upload_file is unavailable in this fal-client version")
        image_url = upload_fn(input_path)

        # Call background removal (fal-client API differs by version).
        arguments = {"image_url": image_url}
        result = None
        if callable(getattr(fal_client, "subscribe", None)):
            result = fal_client.subscribe(model_id, arguments=arguments)
        elif callable(getattr(fal_client, "run", None)):
            result = fal_client.run(model_id, arguments=arguments)
        elif callable(getattr(fal_client, "submit", None)):
            request_handle = fal_client.submit(model_id, arguments=arguments)
            if callable(getattr(request_handle, "get", None)):
                result = request_handle.get()
            elif callable(getattr(request_handle, "result", None)):
                result = request_handle.result()
            else:
                raise RuntimeError("Unsupported fal-client submit handle (missing get/result)")
        else:
            raise RuntimeError("Unsupported fal-client version: no subscribe/run/submit API found")
        
        # Download result
        output_url = None
        if isinstance(result, dict):
            output_url = (
                result.get("image", {}).get("url")
                or (result.get("images", [{}])[0] or {}).get("url")
                or result.get("output", {}).get("url")
                or result.get("url")
            )
        if not output_url:
            raise RuntimeError(f"Fal.ai returned no output image. Response keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
        
        # Save output
        if output_dir is None:
            output_dir = Path(input_path).parent
        else:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
        
        output_filename = f"{uuid.uuid4()}.png"
        output_path = output_dir / output_filename

        # Download and normalize result:
        # - crop transparent margins
        # - remove alpha channel (solid RGB output)
        import numpy as np
        import requests
        from PIL import Image, ImageFilter

        response = requests.get(output_url, timeout=60)
        response.raise_for_status()

        with Image.open(BytesIO(response.content)) as img:
            rgba = img.convert("RGBA")
            rgba_arr = np.asarray(rgba, dtype=np.uint8)
            rgb_arr = rgba_arr[..., :3]
            alpha = rgba.getchannel("A").filter(ImageFilter.MedianFilter(size=3))
            alpha_arr = np.asarray(alpha, dtype=np.uint8)

            # Use model alpha when it is actually informative; otherwise, recover matte by
            # removing white/near-white background connected to the image border.
            informative_alpha_ratio = float((alpha_arr < 250).mean())
            if informative_alpha_ratio > 0.003:
                keep_mask = alpha_arr > 3
            else:
                keep_mask = self._recover_foreground_from_white_border(rgb_arr)

            if not keep_mask.any():
                raise RuntimeError("Fal.ai returned no detectable foreground")

            ys, xs = np.where(keep_mask)
            y0, y1 = int(ys.min()), int(ys.max()) + 1
            x0, x1 = int(xs.min()), int(xs.max()) + 1

            rgb_crop = rgb_arr[y0:y1, x0:x1, :].astype(np.float32)
            alpha_crop = alpha_arr[y0:y1, x0:x1].astype(np.float32)
            keep_crop = keep_mask[y0:y1, x0:x1]

            # When source is premultiplied, un-premultiply so dark/white fringes are reduced.
            nonzero_alpha = alpha_crop > 0
            rgb_crop[nonzero_alpha] = np.clip(
                rgb_crop[nonzero_alpha] * (255.0 / alpha_crop[nonzero_alpha, None]),
                0,
                255
            )

            # Final alpha: preserve model alpha if present, else hard-cut matte.
            if informative_alpha_ratio > 0.003:
                final_alpha = np.where(keep_crop, alpha_crop, 0).astype(np.uint8)
            else:
                final_alpha = np.where(keep_crop, 255, 0).astype(np.uint8)

            out_rgba = np.zeros((rgb_crop.shape[0], rgb_crop.shape[1], 4), dtype=np.uint8)
            out_rgba[..., :3] = np.clip(rgb_crop, 0, 255).astype(np.uint8)
            out_rgba[..., 3] = final_alpha
            Image.fromarray(out_rgba, mode="RGBA").save(output_path, format="PNG")
        
        return str(output_path)

    @staticmethod
    def _recover_foreground_from_white_border(rgb_arr):
        """Treat border-connected white-ish pixels as background, keep the rest."""
        import numpy as np

        h, w, _ = rgb_arr.shape
        maxc = rgb_arr.max(axis=2)
        minc = rgb_arr.min(axis=2)
        near_white = (rgb_arr[..., 0] >= 242) & (rgb_arr[..., 1] >= 242) & (rgb_arr[..., 2] >= 242)
        low_chroma = (maxc.astype(np.int16) - minc.astype(np.int16)) <= 20
        bg_candidate = near_white & low_chroma

        visited = np.zeros((h, w), dtype=bool)
        q = deque()

        def push(y, x):
            if 0 <= y < h and 0 <= x < w and bg_candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

        for x in range(w):
            push(0, x)
            push(h - 1, x)
        for y in range(h):
            push(y, 0)
            push(y, w - 1)

        while q:
            y, x = q.popleft()
            push(y - 1, x)
            push(y + 1, x)
            push(y, x - 1)
            push(y, x + 1)

        keep = ~visited
        # Remove isolated one-pixel speckles.
        if keep.any():
            from PIL import Image, ImageFilter
            keep_img = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
            keep_img = keep_img.filter(ImageFilter.MaxFilter(size=3)).filter(ImageFilter.MinFilter(size=3))
            keep = np.asarray(keep_img, dtype=np.uint8) > 127
        return keep


# Global service instance (only if available)
try:
    fal_service = FalBgRemoveService()
except ImportError as e:
    print(f"Fal service not available: {e}")
    fal_service = None
