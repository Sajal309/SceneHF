import os
from typing import Optional
from io import BytesIO
import base64
from PIL import Image as PILImage
import google.genai as genai

MODEL_NAME = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")
    return genai.Client(api_key=api_key)


def _to_pil_image(obj) -> Optional[PILImage.Image]:
    if isinstance(obj, PILImage.Image):
        return obj
    data = None
    if hasattr(obj, "data"):
        data = obj.data
    if hasattr(obj, "image"):
        data = obj.image
    if isinstance(data, str):
        data = base64.b64decode(data)
    if isinstance(data, (bytes, bytearray)):
        return PILImage.open(BytesIO(data))
    return None


def _extract_image(response) -> Optional[PILImage.Image]:
    parts = []
    if getattr(response, "parts", None):
        parts.extend(response.parts)
    if getattr(response, "candidates", None):
        for candidate in response.candidates:
            content = getattr(candidate, "content", None)
            if content and getattr(content, "parts", None):
                parts.extend(content.parts)
    for part in parts:
        if getattr(part, "inline_data", None) is not None:
            inline_data = part.inline_data
            if inline_data and getattr(inline_data, "data", None):
                data = inline_data.data
                if isinstance(data, str):
                    data = base64.b64decode(data)
                return PILImage.open(BytesIO(data))
            try:
                return _to_pil_image(part.as_image())
            except Exception:
                pass
    return None


def _normalize_output_size(output: PILImage.Image, input_img: PILImage.Image) -> PILImage.Image:
    if output.size != input_img.size:
        print(f"Warning: Gemini output size {output.size} does not match input {input_img.size}. Resizing.")
        return output.resize(input_img.size, PILImage.LANCZOS)
    return output


def edit_image(input_path: str, prompt: str) -> PILImage.Image:
    client = _get_client()
    input_img = PILImage.open(input_path)
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[input_img, prompt],
    )
    output_img = _extract_image(response)
    if output_img is None:
        raise RuntimeError("Gemini returned no image output.")
    return _normalize_output_size(output_img, input_img)


def edit_image_with_mask(input_path: str, mask_path: str, prompt: str) -> PILImage.Image:
    client = _get_client()
    input_img = PILImage.open(input_path)
    mask_img = PILImage.open(mask_path)
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[input_img, mask_img, prompt],
    )
    output_img = _extract_image(response)
    if output_img is None:
        raise RuntimeError("Gemini returned no image output.")
    return _normalize_output_size(output_img, input_img)
