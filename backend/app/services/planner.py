import os
import base64
import json
from typing import Optional, List, Dict, Any

# Support both OpenAI and Google AI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OpenAI = None
    OPENAI_AVAILABLE = False
    print("Warning: openai not installed. OpenAI planner will not be available.")

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    GENAI_AVAILABLE = False
    print("Warning: google-genai not installed. Gemini planner will not be available.")

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
6. Generate clean plates (removing the extracted layer) ONLY when extremely necessary (e.g., when the object is large or leaves a complex hole). Do NOT generate a clean plate for every single layer if it's not needed.
7. If a clean plate IS generated, it MUST have a solid WHITE background. Do NOT generate transparent or checkered backgrounds.
8. If a scene description is provided, the plan MUST follow it. Do not contradict it or invent elements not described.

For each step, specify:
- Clear target description matching user's layer map
- Precise extraction/removal prompt
- 3-5 prompt variations that preserve the same objective
- Validation thresholds (min_nonwhite, max_nonwhite for extractions; min_nonwhite for plates)
- Fallback strategies if validation fails

Return ONLY valid JSON matching this schema:
{{
  "scene_summary": "brief description of the scene (based on the user's description when provided)",
  "global_rules": ["rule 1", "rule 2", ...],
  "steps": [
    {{
      "id": "s1",
      "name": "Extract [layer name]",
      "type": "EXTRACT",
      "target": "what to extract",
      "prompt": "Detailed prompt for extraction with white background requirement",
      "prompt_variations": ["variation 1", "variation 2", "variation 3"],
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
      "prompt": "Detailed prompt for removal/inpainting. MUST specify solid white background.",
      "prompt_variations": ["variation 1", "variation 2", "variation 3"],
      "validate": {{"min_nonwhite": 0.2}},
      "fallbacks": []
    }}
  ]
}}

Be specific in prompts about white backgrounds for BOTH extractions and clean plates.
"""



class Planner:
    """Dynamic plan generation using reasoning models."""
    
    def __init__(self):
        self.provider = os.getenv("PLANNER_PROVIDER", "openai").lower()
        
        if self.provider == "openai":
            if not OPENAI_AVAILABLE:
                raise ImportError("openai package not installed")
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                # raise ValueError("OPENAI_API_KEY not set")
                print("Warning: OPENAI_API_KEY not set")
            else:
                self.client = OpenAI(api_key=api_key)
        
        elif self.provider == "gemini":
            if not GENAI_AVAILABLE:
                raise ImportError("google-genai package not installed")
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if not api_key:
                # raise ValueError("GOOGLE_API_KEY not set")
                print("Warning: GOOGLE_API_KEY not set")
            else:
                self.client = genai.Client(api_key=api_key)
        
        else:
            print(f"Warning: Unknown planner provider: {self.provider}")
    
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
        """
        use_provider = provider or self.provider
        config = model_config or {}
        
        # Build layer instructions
        layer_instructions = ""
        if scene_description:
            layer_instructions += f"SCENE DESCRIPTION: {scene_description}\n"
            layer_instructions += "The plan must follow this description exactly.\n\n"
        
        if layer_count and layer_map:
            layer_instructions += f"USER LAYER SPECIFICATIONS:\n"
            layer_instructions += f"The user wants exactly {layer_count} layers extracted in this order:\n"
            for layer in sorted(layer_map, key=lambda x: x.get('index', 0)):
                layer_instructions += f"  {layer['index']}. {layer['name']}\n"
            layer_instructions += "\nGenerate extraction steps that match these layer names and ordering.\n"
            # layer_instructions += "After each extraction, create a plate by removing that layer.\n" # REMOVED: Only generate plate if necessary
        
        if use_provider == "openai":
            return self._generate_plan_openai(image_path, config, api_key, layer_instructions)
        elif use_provider == "gemini":
            return self._generate_plan_gemini(image_path, config, api_key, layer_instructions)
        else:
            raise ValueError(f"Unknown provider: {use_provider}")

    
    def _clean_json_response(self, text: str) -> str:
        """Strip markdown blocks from potential JSON response."""
        text = text.strip()
        if text.startswith("```"):
            # Remove opening block
            lines = text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        return text

    def _generate_plan_openai(
        self, 
        image_path: str, 
        config: dict,
        api_key: Optional[str] = None,
        layer_instructions: str = ""
    ) -> Plan:
        """Generate plan using OpenAI."""
        if not OPENAI_AVAILABLE:
             raise ImportError("openai package not installed")

        # Create temporary client if key provided, else use global if available
        client = None
        if api_key:
            print("INFO: Creating temporary OpenAI client with provided key")
            client = OpenAI(api_key=api_key)
        elif hasattr(self, 'client') and self.provider == "openai":
            print("INFO: Using existing OpenAI client")
            client = self.client
            
        if not client:
             # Try environment variable fallback
             key = os.getenv("OPENAI_API_KEY")
             if key:
                 print("INFO: Creating OpenAI client from environment variable")
                 client = OpenAI(api_key=key)
             else:
                 error_msg = ("OpenAI client not initialized. Please ensure OPENAI_API_KEY is provided "
                              "in the frontend settings or set as an environment variable.")
                 print(f"ERROR: {error_msg}")
                 raise ValueError(error_msg)

        base64_image = self._encode_image(image_path)
        
        model_name = config.get("model", "gpt-4o")
        
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
        
        if not model_name.lower().startswith("o1") and "mini" not in model_name.lower():
            completion_args["response_format"] = {"type": "json_object"}
        
        if "temperature" in config:
            if not (model_name.lower().startswith("o1") or "mini" in model_name.lower()):
                completion_args["temperature"] = float(config["temperature"])
        
        for key, value in config.items():
            if key not in ["model", "temperature"] and key not in completion_args:
                completion_args[key] = value

        print(f"DEBUG: Calling OpenAI Chat API with model={model_name}")
        try:
            response = client.chat.completions.create(**completion_args)
            content = response.choices[0].message.content
            print(f"DEBUG: OpenAI raw response: {content[:100]}...")
            
            clean_content = self._clean_json_response(content)
            plan_json = json.loads(clean_content)
            return self._parse_plan(plan_json)
        except Exception as e:
            print(f"OpenAI Planning Error: {e}")
            raise
    
    def _generate_plan_gemini(
        self, 
        image_path: str, 
        config: dict,
        api_key: Optional[str] = None,
        layer_instructions: str = ""
    ) -> Plan:
        """Generate plan using Gemini via google-genai SDK 1.0+."""
        if not GENAI_AVAILABLE:
             raise ImportError("google-genai package not installed")

        from PIL import Image
        
        # Determine client
        client = None
        if api_key:
            print("INFO: Creating temporary Gemini client with provided key")
            client = genai.Client(api_key=api_key)
        elif hasattr(self, 'client') and self.provider == "gemini":
            print("INFO: Using existing Gemini client")
            client = self.client
        
        if not client:
             # Try environment variable fallback because we might have failed init if key wasn't in env then
             key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
             if key:
                 print("INFO: Creating Gemini client from environment variable")
                 client = genai.Client(api_key=key)
             else:
                 error_msg = ("Google client not initialized. Please ensure GOOGLE_API_KEY is provided "
                              "in the frontend settings or set as an environment variable.")
                 print(f"ERROR: {error_msg}")
                 raise ValueError(error_msg)
        
        # Use gemini-1.5-flash as default if not specified, it supports JSON
        model_name = config.get("model", "gemini-2.0-flash")
        
        print(f"DEBUG: Calling Gemini API with model={model_name}")
        
        try:
            img = Image.open(image_path)
            formatted_prompt = PLANNER_PROMPT.format(layer_instructions=layer_instructions)
            
            gen_config = {}
            if "temperature" in config:
                gen_config["temperature"] = float(config["temperature"])
            
            # Use JSON mode defined in types
            gen_config["response_mime_type"] = "application/json"
                
            response = client.models.generate_content(
                model=model_name,
                contents=[formatted_prompt, img],
                config=gen_config
            )
            
            if not response.text:
                raise ValueError("Empty response from Gemini")
            
            print(f"DEBUG: Gemini raw response: {response.text[:100]}...")
            
            clean_content = self._clean_json_response(response.text)
            plan_json = json.loads(clean_content)
            return self._parse_plan(plan_json)
            
        except Exception as e:
            print(f"Gemini Planning Error: {e}")
            raise

    def generate_variations(
        self,
        current_prompt: str,
        provider: Optional[str] = None,
        model_config: Optional[dict] = None,
        api_key: Optional[str] = None
    ) -> List[str]:
        """
        Generate 3-5 distinct variations of the current prompt.
        """
        use_provider = provider or self.provider
        config = model_config or {}
        
        variation_system_prompt = """You are an expert at prompt engineering for AI image editing.
Your goal is to provide 3-5 distinct variations of a given prompt.

Each variation must:
1. Preserve the core objective (what to extract or remove)
2. Follow these CRITICAL RULES:
   - No cropping, shifting, or zooming
   - No new objects, people, animals, text, or logos
   - Specify solid white (#FFFFFF) background for extractions/plates
   - Be clear and descriptive

Return ONLY a JSON array of strings, e.g., ["variation 1", "variation 2", "variation 3"]
Do NOT include any preamble or markdown blocks.
"""

        if use_provider == "openai":
            return self._generate_variations_openai(current_prompt, config, api_key, variation_system_prompt)
        elif use_provider == "gemini":
            return self._generate_variations_gemini(current_prompt, config, api_key, variation_system_prompt)
        else:
            raise ValueError(f"Unknown provider: {use_provider}")

    def _generate_variations_openai(self, prompt: str, config: dict, api_key: str, system_prompt: str) -> List[str]:
        client = None
        if api_key:
            client = OpenAI(api_key=api_key)
        elif hasattr(self, 'client') and self.provider == "openai":
            client = self.client
        
        if not client:
            key = os.getenv("OPENAI_API_KEY")
            if key: client = OpenAI(api_key=key)
            else: raise ValueError("OpenAI client not initialized")

        model_name = config.get("model", "gpt-4o")
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate variations for this prompt: '{prompt}'"}
                ],
                response_format={"type": "json_object"} if not model_name.lower().startswith("o1") else None
            )
            content = response.choices[0].message.content
            clean_content = self._clean_json_response(content)
            data = json.loads(clean_content)
            if isinstance(data, list): return data
            if isinstance(data, dict) and "variations" in data: return data["variations"]
            return [content]
        except Exception as e:
            print(f"OpenAI Variation Error: {e}")
            return [prompt]

    def _generate_variations_gemini(self, prompt: str, config: dict, api_key: str, system_prompt: str) -> List[str]:
        client = None
        if api_key:
            client = genai.Client(api_key=api_key)
        elif hasattr(self, 'client') and self.provider == "gemini":
            client = self.client
        
        if not client:
            key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if key: client = genai.Client(api_key=key)
            else: raise ValueError("Google client not initialized")

        model_name = config.get("model", "gemini-2.0-flash")
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[system_prompt, f"Generate variations for this prompt: '{prompt}'"],
                config={"response_mime_type": "application/json"}
            )
            clean_content = self._clean_json_response(response.text)
            data = json.loads(clean_content)
            if isinstance(data, list): return data
            if isinstance(data, dict) and "variations" in data: return data["variations"]
            return [response.text]
        except Exception as e:
            print(f"Gemini Variation Error: {e}")
            return [prompt]

    def _parse_plan(self, plan_json: dict) -> Plan:
        """Parse and validate plan JSON."""
        steps = []
        for step_data in plan_json.get("steps", []):
            step_type_str = step_data.get("type", "EXTRACT").upper()
            step_type = StepType[step_type_str] if step_type_str in StepType.__members__ else StepType.EXTRACT
            prompt_variations = step_data.get("prompt_variations", step_data.get("prompt_variants", []))
            if not isinstance(prompt_variations, list):
                prompt_variations = []
            
            steps.append(PlanStep(
                id=step_data.get("id", f"s{len(steps)+1}"),
                name=step_data.get("name", "Unnamed step"),
                type=step_type,
                target=step_data.get("target", ""),
                prompt=step_data.get("prompt", ""),
                prompt_variations=prompt_variations,
                validation_rules=step_data.get("validate", {}),
                fallbacks=step_data.get("fallbacks", [])
            ))
        
        return Plan(
            scene_summary=plan_json.get("scene_summary", ""),
            global_rules=plan_json.get("global_rules", []),
            steps=steps
        )


# Global planner instance
try:
    planner = Planner()
except Exception as e:
    print(f"Planner service not available: {e}")
    planner = None
