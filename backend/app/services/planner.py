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

{layer_instructions}

CRITICAL RULES (must be in every plan):
1. No cropping, shifting, or zooming - preserve exact alignment
2. No new objects, people, animals, text, or logos
3. All extraction outputs MUST have solid white (#FFFFFF) background
4. Process layers from foreground to background
5. Follow the user's layer specifications exactly

For each step, specify:
- Clear target description matching user's layer map
- Precise extraction/removal prompt
- Validation thresholds (min_nonwhite, max_nonwhite for extractions; min_nonwhite for plates)
- Fallback strategies if validation fails

Return ONLY valid JSON matching this schema:
{{
  "scene_summary": "brief description of the scene",
  "global_rules": ["rule 1", "rule 2", ...],
  "steps": [
    {{
      "id": "s1",
      "name": "Extract [layer name]",
      "type": "EXTRACT",
      "target": "what to extract",
      "prompt": "Detailed prompt for extraction with white background requirement",
      "validate": {{"min_nonwhite": 0.01, "max_nonwhite": 0.35}},
      "fallbacks": [
        {{"action": "TIGHTEN_PROMPT", "prompt": "More specific prompt"}}
      ]
    }},
    {{
      "id": "s2",
      "name": "Create background plate",
      "type": "REMOVE",
      "target": "what to remove",
      "prompt": "Detailed prompt for removal/inpainting",
      "validate": {{"min_nonwhite": 0.2}},
      "fallbacks": []
    }}
  ]
}}

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
            self.model = genai.GenerativeModel('gemini-flash-latest')
        
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
        model_config: Optional[dict] = None,
        api_key: Optional[str] = None,
        scene_description: Optional[str] = None,
        layer_count: Optional[int] = None,
        layer_map: Optional[list] = None
    ) -> Plan:
        """
        Generate a dynamic extraction plan for the image.
        
        Args:
            image_path: Path to source image
            provider: Override default provider (openai or gemini)
            model_config: Config dict (e.g. {"model": "gemini-1.5-pro", "temperature": 0.7})
            api_key: Optional API key override
            scene_description: User's description of the scene
            layer_count: Number of layers to extract
            layer_map: List of {"index": int, "name": str} layer specifications
        
        Returns:
            Plan object with steps
        """
        use_provider = provider or self.provider
        config = model_config or {}
        
        # Build layer instructions
        layer_instructions = ""
        if scene_description:
            layer_instructions += f"SCENE DESCRIPTION: {scene_description}\n\n"
        
        if layer_count and layer_map:
            layer_instructions += f"USER LAYER SPECIFICATIONS:\n"
            layer_instructions += f"The user wants exactly {layer_count} layers extracted in this order:\n"
            for layer in sorted(layer_map, key=lambda x: x.get('index', 0)):
                layer_instructions += f"  {layer['index']}. {layer['name']}\n"
            layer_instructions += "\nGenerate extraction steps that match these layer names and ordering.\n"
            layer_instructions += "After each extraction, create a plate by removing that layer.\n"
        
        if use_provider == "openai":
            return self._generate_plan_openai(image_path, config, api_key, layer_instructions)
        elif use_provider == "gemini":
            return self._generate_plan_gemini(image_path, config, api_key, layer_instructions)
        else:
            raise ValueError(f"Unknown provider: {use_provider}")

    
    def _generate_plan_openai(
        self, 
        image_path: str, 
        config: dict,
        api_key: Optional[str] = None,
        layer_instructions: str = ""
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
        
        # Format prompt with layer instructions
        formatted_prompt = PLANNER_PROMPT.format(layer_instructions=layer_instructions)
        
        # Build arguments dynamically
        completion_args = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": formatted_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ]
        }
        
        # Add response_format only if not O1 (which might not support it in some versions, 
        # but usually it's required for JSON mode)
        if not model_name.lower().startswith("o1"):
            completion_args["response_format"] = {"type": "json_object"}
        
        # O1 and gpt-5-mini models do not support temperature parameter
        # AND only add if explicitly provided in config
        if "temperature" in config:
            if not (model_name.lower().startswith("o1") or "gpt-5-mini" in model_name.lower()):
                completion_args["temperature"] = float(config["temperature"])
        
        # Add any other dynamic parameters from config (except model and temperature which we handled)
        for key, value in config.items():
            if key not in ["model", "temperature"] and key not in completion_args:
                completion_args[key] = value

        print(f"DEBUG: Planning with OpenAI model={model_name}, params={list(completion_args.keys())}")
        if "temperature" in completion_args:
            print(f"DEBUG: Temperature value={completion_args['temperature']}")
            
        print(f"Calling OpenAI with model: {model_name}, args: {completion_args.keys()}")
        response = client.chat.completions.create(**completion_args)
        
        print(f"Raw plan JSON: {response.choices[0].message.content}")
        plan_json = json.loads(response.choices[0].message.content)
        return self._parse_plan(plan_json)
    
    def _generate_plan_gemini(
        self, 
        image_path: str, 
        config: dict,
        api_key: Optional[str] = None,
        layer_instructions: str = ""
    ) -> Plan:
        """Generate plan using Gemini."""
        if genai is None:
             raise ImportError("google-generativeai package not installed")

        from PIL import Image
        
        # Configure dynamically if key provided
        if api_key:
            genai.configure(api_key=api_key)
        
        # Use configured model or default
        model_name = config.get("model", "gemini-flash-latest")
        # Ensure we use an available model even if default was set in init
        model = genai.GenerativeModel(model_name)
        
        img = Image.open(image_path)
        
        # Format prompt with layer instructions
        formatted_prompt = PLANNER_PROMPT.format(layer_instructions=layer_instructions)
        
        # Prepare generation config dynamically
        generation_config = {}
        if "temperature" in config:
            generation_config["temperature"] = float(config["temperature"])
        
        # Add response_mime_type if supported (Gemini 1.5+ usually)
        if not ("vision" in model_name and "1.0" in model_name):
            generation_config["response_mime_type"] = "application/json"
            
        # Add any other params from config
        for key, value in config.items():
            if key not in ["model", "temperature"] and key not in generation_config:
                generation_config[key] = value

        print(f"DEBUG: Planning with Gemini model={model_name}, params={list(generation_config.keys())}")
        if "temperature" in generation_config:
            print(f"DEBUG: Temperature value={generation_config['temperature']}")

        response = model.generate_content(
            [formatted_prompt, img],
            generation_config=generation_config if generation_config else None
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
