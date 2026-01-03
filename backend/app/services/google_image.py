import os
import uuid
from pathlib import Path
from typing import Optional, Dict, Any
from io import BytesIO

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    GENAI_AVAILABLE = False
    print("Warning: google-generativeai not installed. Google image service will not be available.")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    Image = None
    PIL_AVAILABLE = False


class GoogleImageService:
    """
    Google Gemini image generation service for extraction and removal operations.
    Supports gemini-2.5-flash-image (nano banana).
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize with optional API key."""
        if not GENAI_AVAILABLE:
            raise ImportError("google-generativeai package not installed. Run: pip install google-generativeai")
        
        key = api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("Google API key not provided")
        
        genai.configure(api_key=key)
        # Default model, but can be overridden in config
        self.default_model = "gemini-2.5-flash-image"
    
    @staticmethod
    def is_available() -> bool:
        """Check if the service is available."""
        return GENAI_AVAILABLE and PIL_AVAILABLE
    
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
        model_name = config.get("model", self.default_model)
        
        # Enhance prompt for extraction
        enhanced_prompt = f"{prompt}. The extracted object should be isolated with a transparent background. No background, just the object itself."
        
        print(f"Google Image Extract: model={model_name}, config={config.keys()}")
        
        return self._generate(image_path, enhanced_prompt, output_path, config)
    
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
        model_name = config.get("model", self.default_model)
        
        # Enhance prompt for removal
        enhanced_prompt = f"Remove {prompt} from this image and fill the area naturally to match the surroundings."
        
        print(f"Google Image Remove: model={model_name}, config={config.keys()}")
        
        return self._generate(image_path, enhanced_prompt, output_path, config)
    
    def _generate(
        self,
        image_path: str,
        prompt: str,
        output_path: str,
        config: Dict[str, Any]
    ) -> str:
        """Internal method to call Gemini API."""
        if not PIL_AVAILABLE:
            raise ImportError("PIL not installed")
            
        model_name = config.get("model", self.default_model)
        
        # FIX: Force remap problematic models from saved configs
        if "preview" in model_name.lower() or model_name == "gemini-2.5-flash":
            print(f"Remapping model {model_name} to {self.default_model} due to quota/capability issues")
            model_name = self.default_model
            
        model = genai.GenerativeModel(model_name)
        img = Image.open(image_path)
        
        generation_config = {}
        if config:
            # Only include valid GenerationConfig fields
            # See: https://ai.google.dev/api/rest/v1beta/GenerationConfig
            # Standard fields: candidate_count, stop_sequences, max_output_tokens, temperature, top_p, top_k
            # We filter out routing fields and common image params that Gemini doesn't use in GenerationConfig
            for key, value in config.items():
                if key not in ["model", "provider", "quality", "size", "aspect_ratio", "number_of_images"]:
                    generation_config[key] = value
        
        response = model.generate_content(
            [prompt, img],
            generation_config=generation_config if generation_config else None
        )
        
        # Assuming the response contains an image or a URL to an image
        # This part depends on the specific API response of gemini-2.5-flash-image
        # If it returns an image directly in the response:
        try:
            # Debugging response structure
            print(f"Gemini Response Code: {response.candidates[0].finish_reason if response.candidates else 'No candidates'}")
            
            if not response.candidates:
                raise RuntimeError("Gemini returned no candidates")
                
            candidate = response.candidates[0]
            
            # Check for inline image data
            image_parts = [part.inline_data for part in candidate.content.parts if part.inline_data]
            
            if image_parts:
                img_data = image_parts[0].data
                with open(output_path, 'wb') as f:
                    f.write(img_data)
                return output_path
            
            # Safely get text content if any
            text_content = ""
            if candidate.content and candidate.content.parts:
                text_parts = [part.text for part in candidate.content.parts if part.text]
                text_content = " ".join(text_parts)
            
            error_details = f"Finish Reason: {candidate.finish_reason}"
            if candidate.safety_ratings:
                error_details += f", Safety: {candidate.safety_ratings}"
                
            raise RuntimeError(f"Gemini returned no image data. {error_details}. Content: {text_content[:200]}")
            
        except Exception as e:
            print(f"Failed to parse Gemini output: {e}")
            raise RuntimeError(f"Gemini failed to generate image: {str(e)}")


def get_google_image_service(api_key: Optional[str] = None) -> Optional[GoogleImageService]:
    """Get Google image service instance."""
    if not GoogleImageService.is_available():
        return None
    try:
        return GoogleImageService(api_key=api_key)
    except (ImportError, ValueError) as e:
        print(f"Google Image service not available: {e}")
        return None
