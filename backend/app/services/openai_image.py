import os
import base64
from pathlib import Path
from typing import Optional, Dict, Any
from io import BytesIO

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OpenAI = None
    OPENAI_AVAILABLE = False
    print("Warning: openai not installed. OpenAI image service will not be available.")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    Image = None
    PIL_AVAILABLE = False


class OpenAIImageService:
    """
    OpenAI image generation service for extraction and removal operations.
    Uses GPT Image 1.5 with transparency support.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize with optional API key."""
        if not OPENAI_AVAILABLE:
            raise ImportError("openai package not installed. Run: pip install openai")
        
        key = api_key or os.getenv("OPENAI_IMAGE_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("OpenAI API key not provided")
        
        self.client = OpenAI(api_key=key)
    
    @staticmethod
    def is_available() -> bool:
        """Check if the service is available."""
        return OPENAI_AVAILABLE and PIL_AVAILABLE
    
    def _sanitize_model(self, model: str) -> str:
        """Sanitize model name to avoid dated versions if not supported."""
        if not model:
            return "gpt-image-1.5"
        
        # Strip common dated suffixes like -2025-12-16
        if model.startswith("gpt-image-1.5"):
            return "gpt-image-1.5"
        if model.startswith("gpt-image-1-mini"):
            return "gpt-image-1-mini"
        if model.startswith("gpt-image-1") and "mini" not in model:
            return "gpt-image-1"
            
        return model

    def _sanitize_quality(self, quality: str) -> str:
        """Sanitize quality parameter to avoid legacy names."""
        if quality == "standard":
            return "low"
        if quality == "hd":
            return "high"
        if quality not in ["low", "medium", "high", "auto"]:
            return "low"
        return quality
    
    def extract(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Extract objects using GPT Image 1.5 generation with transparency.
        
        Args:
            image_path: Path to source image
            prompt: Extraction prompt
            output_path: Path to save result
            config: Optional config (model, quality, size)
        
        Returns:
            Path to generated image with transparent background
        """
        config = config or {}
        model = self._sanitize_model(config.get("model", "gpt-image-1.5"))
        quality = self._sanitize_quality(config.get("quality", "low"))  # low, medium, or high
        size = config.get("size", "1024x1024")
        
        # Enhance prompt to request transparent background
        enhanced_prompt = f"{prompt}. The extracted object should be isolated with a transparent background (alpha channel). No background, just the object itself."
        
        print(f"OpenAI Image Extract: model={model}, quality={quality}, format=webp (transparent)")
        
        # Use v1/images/generations endpoint with WebP format for transparency
        response = self.client.images.generate(
            model=model,
            prompt=enhanced_prompt,
            size=size,
            quality=quality,
            n=1
        )
        
        # Download and save as WebP to preserve transparency
        image_url = response.data[0].url
        return self._download_and_convert_webp(image_url, output_path)
    
    def remove(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Remove objects using GPT Image 1.5 image editing.
        
        Args:
            image_path: Path to source image
            prompt: Removal/inpainting prompt
            output_path: Path to save result
            config: Optional config (model, quality, size)
        
        Returns:
            Path to edited image
        """
        config = config or {}
        
        # Use v1/images/edits endpoint
        try:
            return self._edit_image(image_path, prompt, output_path, config)
        except Exception as e:
            print(f"Edit endpoint failed: {e}")
            # If edit fails, fall back to generation approach
            return self._generate_removal(image_path, prompt, output_path, config)
    
    def _edit_image(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Dict[str, Any]
    ) -> str:
        """Use GPT Image 1.5's v1/images/edits endpoint."""
        if not PIL_AVAILABLE:
            raise ImportError("PIL not installed")
        
        model = self._sanitize_model(config.get("model", "gpt-image-1.5"))
        quality = self._sanitize_quality(config.get("quality", "low"))
        size = config.get("size", "1024x1024")
        
        # Prepare image: convert to RGBA PNG
        img = Image.open(image_path)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        # Resize to target size
        target_size = tuple(map(int, size.split('x')))
        if img.size != target_size:
            img = img.resize(target_size, Image.Resampling.LANCZOS)
        
        # Save to bytes buffer as PNG
        img_bytes = BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        img_bytes.name = 'image.png'  # Required by OpenAI API
        
        enhanced_prompt = f"{prompt}. Fill removed areas naturally to match the surrounding scene."
        
        print(f"OpenAI Image Edit: model={model}, quality={quality}")
        
        # Call v1/images/edits endpoint
        response = self.client.images.edit(
            model=model,
            image=img_bytes,
            prompt=enhanced_prompt,
            n=1,
            size=size,
            quality=quality
        )
        
        image_url = response.data[0].url
        return self._download_and_convert_webp(image_url, output_path)
    
    def _generate_removal(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Dict[str, Any]
    ) -> str:
        """Fallback: use generation to create scene without objects."""
        model = self._sanitize_model(config.get("model", "gpt-image-1.5"))
        quality = self._sanitize_quality(config.get("quality", "low"))
        size = config.get("size", "1024x1024")
        
        enhanced_prompt = f"A scene where {prompt}. Maintain the same composition and style as the original image."
        
        response = self.client.images.generate(
            model=model,
            prompt=enhanced_prompt,
            size=size,
            quality=quality,
            n=1
        )
        
        image_url = response.data[0].url
        return self._download_and_convert_webp(image_url, output_path)
    
    def _download_and_convert_webp(self, url: str, output_path: str) -> str:
        """Download image and convert to WebP to preserve transparency."""
        import requests
        
        response = requests.get(url)
        response.raise_for_status()
        
        # Ensure parent directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        
        if PIL_AVAILABLE:
            # Load image from bytes
            img_bytes = BytesIO(response.content)
            img = Image.open(img_bytes)
            
            # Ensure output path has .webp extension
            output_path_obj = Path(output_path)
            if output_path_obj.suffix.lower() not in ['.webp', '.png']:
                output_path = str(output_path_obj.with_suffix('.webp'))
            
            # Save as WebP to preserve transparency
            img.save(output_path, format='WEBP', lossless=True)
            print(f"Saved as WebP with transparency: {output_path}")
        else:
            # Fallback: save raw bytes
            with open(output_path, 'wb') as f:
                f.write(response.content)
        
        return output_path


# Global service instance (only if available)
def get_openai_image_service(api_key: Optional[str] = None) -> Optional[OpenAIImageService]:
    """Get OpenAI image service instance."""
    if not OpenAIImageService.is_available():
        return None
    try:
        return OpenAIImageService(api_key=api_key)
    except (ImportError, ValueError) as e:
        print(f"OpenAI Image service not available: {e}")
        return None
