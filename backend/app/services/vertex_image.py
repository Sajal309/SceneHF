import os
import uuid
from pathlib import Path
from typing import Optional

try:
    import vertexai
    from vertexai.preview.vision_models import ImageGenerationModel
    VERTEX_AVAILABLE = True
except ImportError:
    VERTEX_AVAILABLE = False
    print("Warning: vertexai not installed. Vertex image editing will not be available.")

from PIL import Image


class VertexImageService:
    """Vertex AI image editing service for extractions and removals."""
    
    def __init__(self):
        if not VERTEX_AVAILABLE:
            raise ImportError("vertexai package not installed. Run: pip install google-cloud-aiplatform")
        
        project_id = os.getenv("GCP_PROJECT_ID")
        location = os.getenv("GCP_REGION", "us-central1")
        
        if not project_id:
            raise ValueError("GCP_PROJECT_ID not set")
        
        vertexai.init(project=project_id, location=location)
        self.model = ImageGenerationModel.from_pretrained("imagegeneration@006")
    
    def edit_image(
        self,
        input_path: str,
        prompt: str,
        output_dir: Optional[str] = None
    ) -> str:
        """
        Edit image using Vertex AI imagen.
        
        Args:
            input_path: Path to input image
            prompt: Edit prompt (for EXTRACT or REMOVE)
            output_dir: Directory to save output (default: same as input)
        
        Returns:
            Path to output image
        """
        # Load input image
        base_image = Image.open(input_path)
        
        # Call Vertex AI image editing
        # Note: Using edit_image method for both extractions and removals
        images = self.model.edit_image(
            base_image=base_image,
            prompt=prompt,
            number_of_images=1,
            guidance_scale=15,  # Higher for more faithful prompt following
            edit_mode="inpainting-insert"  # Can also be "inpainting-remove" or "product-image"
        )
        
        if not images:
            raise RuntimeError("Vertex AI returned no images")
        
        # Save output
        if output_dir is None:
            output_dir = Path(input_path).parent
        else:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
        
        output_filename = f"{uuid.uuid4()}.png"
        output_path = output_dir / output_filename
        
        images[0].save(str(output_path))
        
        return str(output_path)


def get_vertex_image_service() -> Optional[VertexImageService]:
    """Get Vertex image service instance."""
    if not VERTEX_AVAILABLE:
        return None
    try:
        return VertexImageService()
    except (ImportError, ValueError) as e:
        print(f"Vertex service not available: {e}")
        return None


# Global service instance (for legacy support if needed)
vertex_service = get_vertex_image_service()
