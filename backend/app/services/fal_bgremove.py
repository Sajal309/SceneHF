import os
import uuid
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
        image_url = fal_client.upload_file(input_path)
        
        # Call background removal
        result = fal_client.subscribe(
            model_id,
            arguments={
                "image_url": image_url
            }
        )
        
        # Download result
        output_url = result.get("image", {}).get("url")
        if not output_url:
            raise RuntimeError("Fal.ai returned no output image")
        
        # Save output
        if output_dir is None:
            output_dir = Path(input_path).parent
        else:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
        
        output_filename = f"{uuid.uuid4()}.png"
        output_path = output_dir / output_filename
        
        # Download image
        import requests
        response = requests.get(output_url)
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        return str(output_path)


# Global service instance (only if available)
try:
    fal_service = FalBgRemoveService()
except ImportError as e:
    print(f"Fal service not available: {e}")
    fal_service = None
