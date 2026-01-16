import os
from typing import Optional, Dict, Any
import google.genai as genai

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    Image = None
    PIL_AVAILABLE = False


class GoogleImageService:
    """
    Google Gemini image generation service using google-genai SDK 1.0+.
    Matches user provided script pattern.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize with optional API key."""
        # Prioritize key from arguments, then env vars
        key = api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("Google API key not provided")
        
        self.client = genai.Client(api_key=key)
        self.default_model = "gemini-2.5-flash-image"
    
    @staticmethod
    def is_available() -> bool:
        """Check if the service is available."""
        # If we can import genai, we count it as available.
        return True
    
    def extract(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Extract objects using Gemini image generation.
        """
        config = config or {}
        # Use prompt directly - Planner provides full instruction
        print(f"Google Image Extract: model={self.default_model}")
        return self._generate(image_path, prompt, output_path, config)
    
    def remove(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Remove objects using Gemini image editing/generation.
        """
        config = config or {}
        # Use prompt directly - Planner provides full instruction
        print(f"Google Image Remove: model={self.default_model}")
        return self._generate(image_path, prompt, output_path, config)
    
    def _generate(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Dict[str, Any]
    ) -> str:
        """Internal method to call Gemini API matching user script pattern."""
        if not PIL_AVAILABLE:
            raise ImportError("PIL not installed")
            
        model_name = self.default_model
        
        # Prepare contents
        # User script: contents=[prompt]
        # For I2I, we likely need contents=[prompt, image]
        contents = [prompt]
        
        if image_path:
            try:
                img = Image.open(image_path)
                contents.append(img)
            except Exception as e:
                print(f"Failed to load input image: {e}")
                raise
        
        print(f"DEBUG: Calling generate_content with model='{model_name}'")
        
        try:
            # ✅ exact call structure from user script
            response = self.client.models.generate_content(
                model=model_name,
                contents=contents,
            )
            
            # ✅ exact parsing logic from user script
            saved = False
            if response.parts:
                for part in response.parts:
                    if part.inline_data is not None:
                        img_out = part.as_image()
                        img_out.save(output_path)
                        print(f"✅ Image saved as {output_path}")
                        saved = True
                        break # Save first image and return
            
            if saved:
                return output_path
            
            # Error handling if no image
            print("⚠️ No image returned. Model may have returned only text.")
            text_response = ""
            if response.parts:
                for part in response.parts:
                    if part.text:
                        print(part.text)
                        text_response += part.text
            
            raise RuntimeError(f"Gemini returned no image. Text output: {text_response[:200]}")
                
        except Exception as e:
            print(f"Failed to generate image with Gemini: {e}")
            raise RuntimeError(f"Gemini failed to generate image: {str(e)}")


def get_google_image_service(api_key: Optional[str] = None) -> Optional[GoogleImageService]:
    """Get Google image service instance."""
    try:
        return GoogleImageService(api_key=api_key)
    except Exception as e:
        # Don't print for missing API keys, as this is common when using other providers
        if "API key not provided" not in str(e):
            print(f"Google Image service not available: {e}")
        return None
