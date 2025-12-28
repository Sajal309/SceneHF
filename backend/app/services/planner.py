import os
import base64
import json
from pathlib import Path
from typing import Optional

# Support both OpenAI and Google AI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OpenAI = None
    OPENAI_AVAILABLE = False
    print("Warning: openai not installed. OpenAI planner will not be available.")

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    GENAI_AVAILABLE = False
    print("Warning: google-generativeai not installed. Gemini planner will not be available.")

from app.models.schemas import Plan, PlanStep, StepType


PLANNER_PROMPT = """You are an expert at analyzing images for layer extraction and plate creation.

Analyze this background image and create a detailed step-by-step plan to extract layers and create plates.

CRITICAL RULES (must be in every plan):
1. No cropping, shifting, or zooming - preserve exact alignment
2. No new objects, people, animals, text, or logos
3. All extraction outputs MUST have solid white (#FFFFFF) background
4. Process layers from foreground to background

For each step, specify:
- Clear target description
- Precise extraction/removal prompt
- Validation thresholds (min_nonwhite, max_nonwhite for extractions; min_nonwhite for plates)
- Fallback strategies if validation fails

Common layer types:
- Foreground occluders (bushes, fences, poles, signs)
- Mid-ground elements (buildings, vehicles, trees)
- Background elements (sky, distant buildings)
- Ground/road surfaces

Return ONLY valid JSON matching this schema:
{
  "scene_summary": "brief description of the scene",
  "global_rules": ["rule 1", "rule 2", ...],
  "steps": [
    {
      "id": "s1",
      "name": "Extract foreground occluders",
      "type": "EXTRACT",
      "target": "what to extract",
      "prompt": "Detailed prompt for extraction with white background requirement",
      "validate": {"min_nonwhite": 0.01, "max_nonwhite": 0.35},
      "fallbacks": [
        {"action": "TIGHTEN_PROMPT", "prompt": "More specific prompt"}
      ]
    },
    {
      "id": "s2",
      "name": "Create background plate",
      "type": "REMOVE",
      "target": "what to remove",
      "prompt": "Detailed prompt for removal/inpainting",
      "validate": {"min_nonwhite": 0.2},
      "fallbacks": []
    }
  ]
}

Typical workflow:
1. Extract foreground occluders (EXTRACT with white bg)
2. Create plate by removing occluders (REMOVE)
3. Extract mid-ground elements (EXTRACT with white bg)
4. Create deeper plate (REMOVE)
5. Continue as needed

Be specific in prompts about white backgrounds for extractions.
"""


class Planner:
    """Dynamic plan generation using reasoning models."""
    
    def __init__(self):
        self.provider = os.getenv("PLANNER_PROVIDER", "gemini").lower()
        
        if self.provider == "openai":
            if OpenAI is None:
                raise ImportError("openai package not installed")
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY not set")
            self.client = OpenAI(api_key=api_key)
        
        elif self.provider == "gemini":
            if genai is None:
                raise ImportError("google-generativeai package not installed")
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not set")
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
        
        else:
            raise ValueError(f"Unknown planner provider: {self.provider}")
    
    def _encode_image(self, image_path: str) -> str:
        """Encode image to base64."""
        with open(image_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')
    
    def generate_plan(
        self, 
        image_path: str, 
        provider: Optional[str] = None,
        model_config: Optional[Dict[str, Any]] = None,
        api_key: Optional[str] = None
    ) -> Plan:
        """
        Generate a dynamic extraction plan for the image.
        
        Args:
            image_path: Path to source image
            provider: Override default provider (openai or gemini)
            model_config: Config dict (e.g. {"model": "gemini-1.5-pro", "temperature": 0.7})
            api_key: Optional API key override
        
        Returns:
            Plan object with steps
        """
        use_provider = provider or self.provider
        config = model_config or {}
        
        if use_provider == "openai":
            return self._generate_plan_openai(image_path, config, api_key)
        elif use_provider == "gemini":
            return self._generate_plan_gemini(image_path, config, api_key)
        else:
            raise ValueError(f"Unknown provider: {use_provider}")
    
    def _generate_plan_openai(
        self, 
        image_path: str, 
        config: Dict[str, Any],
        api_key: Optional[str] = None
    ) -> Plan:
        """Generate plan using OpenAI."""
        if OpenAI is None:
             raise ImportError("openai package not installed")

        # Create temporary client if key provided, else use global if available
        client = None
        if api_key:
            client = OpenAI(api_key=api_key)
        elif hasattr(self, 'client'):
            client = self.client
            
        if not client:
             # Try environment variable fallback
             key = os.getenv("OPENAI_API_KEY")
             if key:
                 client = OpenAI(api_key=key)
             else:
                 raise ValueError("OpenAI client not initialized and no API key provided")

        base64_image = self._encode_image(image_path)
        
        model_name = config.get("model", "gpt-4o")
        # Build arguments dynamically
        completion_args = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PLANNER_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "response_format": {"type": "json_object"}
        }
        
        # O1 and gpt-5-mini models do not support temperature parameter
        if not (model_name.lower().startswith("o1") or "gpt-5-mini" in model_name.lower()):
            completion_args["temperature"] = config.get("temperature", 0.7)
        
        print(f"Calling OpenAI with model: {model_name}, args: {completion_args.keys()}")
        response = client.chat.completions.create(**completion_args)
        
        print(f"Raw plan JSON: {response.choices[0].message.content}")
        plan_json = json.loads(response.choices[0].message.content)
        return self._parse_plan(plan_json)
    
    def _generate_plan_gemini(
        self, 
        image_path: str, 
        config: Dict[str, Any],
        api_key: Optional[str] = None
    ) -> Plan:
        """Generate plan using Gemini."""
        if genai is None:
             raise ImportError("google-generativeai package not installed")

        from PIL import Image
        
        # Configure dynamically if key provided
        if api_key:
            genai.configure(api_key=api_key)
        
        # Use configured model or default
        model_name = config.get("model", "gemini-2.0-flash-exp")
        # Ensure we use an available model even if default was set in init
        model = genai.GenerativeModel(model_name)
        
        img = Image.open(image_path)
        
        response = model.generate_content(
            [PLANNER_PROMPT, img],
            generation_config={
                "temperature": config.get("temperature", 0.7),
                "response_mime_type": "application/json"
            }
        )
        
        plan_json = json.loads(response.text)
        return self._parse_plan(plan_json)
    
    def _parse_plan(self, plan_json: dict) -> Plan:
        """Parse and validate plan JSON."""
        # Convert step types to enum
        steps = []
        for step_data in plan_json.get("steps", []):
            step_type_str = step_data.get("type", "EXTRACT").upper()
            step_type = StepType[step_type_str] if step_type_str in StepType.__members__ else StepType.EXTRACT
            
            steps.append(PlanStep(
                id=step_data.get("id", f"s{len(steps)+1}"),
                name=step_data.get("name", "Unnamed step"),
                type=step_type,
                target=step_data.get("target", ""),
                prompt=step_data.get("prompt", ""),
                validation_rules=step_data.get("validate", {}),
                fallbacks=step_data.get("fallbacks", [])
            ))
        
        return Plan(
            scene_summary=plan_json.get("scene_summary", ""),
            global_rules=plan_json.get("global_rules", []),
            steps=steps
        )


# Global planner instance (only if available)
try:
    planner = Planner()
except (ImportError, ValueError) as e:
    print(f"Planner service not available: {e}")
    planner = None
