import os
import base64
import json
from typing import Optional, List, Dict, Any, Callable
from pathlib import Path
from io import BytesIO

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
{reference_examples}

CRITICAL RULES (must be in every plan):
1. No cropping, shifting, or zooming - preserve exact alignment
2. No new objects, people, animals, text, or logos
3. All extraction outputs MUST have solid white (#FFFFFF) background
4. Process layers from foreground to background
5. If user layer specifications are provided, follow them exactly; otherwise decide the optimal layer count and layer names automatically
6. Generate clean plates (removing the extracted layer) ONLY when extremely necessary (e.g., when the object is large or leaves a complex hole). Do NOT generate a clean plate for every single layer if it's not needed.
7. If a clean plate IS generated, it MUST have a solid WHITE background. Do NOT generate transparent or checkered backgrounds.
8. If a scene description is provided, the plan MUST follow it. Do not contradict it or invent elements not described.
9. When user layer specs are NOT provided, choose 2-10 extraction layers that best represent the scene and keep the plan practical.
10. Think like an execution agent: assess complexity, identify likely challenges, and recommend what should happen next.
11. In AUTO mode, avoid redundant layer splits. Consecutive EXTRACT layers must be meaningfully distinct and should not heavily overlap in content/mask area.

For each step, specify:
- Clear target description (matching user's layer map when provided)
- Precise extraction/removal prompt
- 3-5 prompt variations that preserve the same objective
- Validation thresholds (min_nonwhite, max_nonwhite for extractions; min_nonwhite for plates)
- Fallback strategies if validation fails

AUTO LAYER QUALITY CHECKS (must apply when user layer specs are not provided):
- Prefer semantic layers (foreground subject, props, midground, background, sky) over arbitrary patches.
- Keep overlap low between EXTRACT targets. If two planned layers likely overlap heavily (roughly >35%), merge them or redefine boundaries.
- Avoid making 2-3 foreground layers that isolate nearly the same region.
- If uncertainty is high, reduce layer count rather than creating ambiguous overlapping layers.

Return ONLY valid JSON matching this schema:
{{
  "scene_summary": "brief description of the scene (based on the user's description when provided)",
  "agentic_analysis": {{
    "mode": "AUTO or MANUAL",
    "scene_complexity": "LOW | MEDIUM | HIGH",
    "estimated_layer_count": 4,
    "risk_level": "LOW | MEDIUM | HIGH",
    "decision_rationale": "short rationale for why this layer strategy is chosen",
    "potential_challenges": ["challenge 1", "challenge 2"],
    "recommended_next_actions": [
      {{"action": "RUN_PLAN", "reason": "why this should be done now"}},
      {{"action": "REVIEW_STEP_PROMPTS", "reason": "optional preflight review reason"}}
    ]
  }},
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
        {{"action": "TIGHTEN_PROMPT", "prompt": "More specific prompt"}},
        {{"action": "MERGE_OR_REDEFINE_LAYER", "prompt": "Reduce overlap with adjacent layers by merging or redefining boundaries"}}
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
    
    def _encode_image(self, image_path: str, max_side: Optional[int] = None) -> str:
        """Encode image to base64. Optionally downscale for prompt examples."""
        if not max_side:
            with open(image_path, 'rb') as f:
                return base64.b64encode(f.read()).decode('utf-8')

        from PIL import Image
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            w, h = img.size
            scale = min(1.0, float(max_side) / float(max(w, h)))
            if scale < 1.0:
                img = img.resize((int(w * scale), int(h * scale)))
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=70, optimize=True)
            return base64.b64encode(buf.getvalue()).decode('utf-8')

    def _resolve_source_image_path(self, job_data: Dict[str, Any], job_dir: Path) -> Optional[Path]:
        source_id = job_data.get("source_image")
        assets = job_data.get("assets") or {}
        source_asset = assets.get(source_id) if source_id else None
        if not source_asset:
            return None

        candidate = source_asset.get("path")
        if not candidate:
            return None

        p = Path(candidate)
        checks = []
        if p.is_absolute():
            checks.append(p)
        checks.append(job_dir / p.name)
        checks.append(job_dir / "assets" / "source" / p.name)
        checks.append((Path.home() / "Pictures" / "SceneGen") / p)
        checks.append(Path("/Users/sajal/Pictures/SceneGen") / p)
        checks.append(Path.cwd() / candidate)
        for c in checks:
            if c.exists():
                return c
        return None

    def _collect_reference_examples(self, max_examples: int = 3) -> List[Dict[str, Any]]:
        """Collect high-signal historical examples with scene/layer summaries and source image paths."""
        roots = [
            Path(__file__).resolve().parents[2] / "data" / "jobs",
            Path.home() / "Pictures" / "SceneGen" / "jobs",
        ]
        candidates: List[Dict[str, Any]] = []

        for root in roots:
            if not root.exists():
                continue
            for job_file in root.glob("*/job.json"):
                try:
                    with open(job_file, "r", encoding="utf-8") as f:
                        job_data = json.load(f)
                    plan = job_data.get("plan") or {}
                    steps = job_data.get("steps") or []
                    if not plan or not steps:
                        continue

                    extract_steps = [s for s in steps if str(s.get("type", "")).upper() == "EXTRACT"]
                    if len(extract_steps) < 2:
                        continue

                    successish = sum(
                        1 for s in extract_steps if str(s.get("status", "")).upper() in ("SUCCESS", "NEEDS_REVIEW")
                    )
                    score = successish / max(1, len(extract_steps))
                    if score < 0.6:
                        continue

                    remove_steps = [s for s in steps if str(s.get("type", "")).upper() == "REMOVE"]
                    layer_targets = []
                    for s in (plan.get("steps") or []):
                        if str(s.get("type", "")).upper() == "EXTRACT":
                            name = str(s.get("target") or s.get("name") or "").strip()
                            if name:
                                layer_targets.append(name)
                    if not layer_targets:
                        continue

                    src_path = self._resolve_source_image_path(job_data, job_file.parent)
                    if not src_path:
                        continue

                    candidates.append({
                        "scene_summary": str(plan.get("scene_summary", "")).strip(),
                        "layer_targets": layer_targets[:6],
                        "extract_count": len(extract_steps),
                        "remove_count": len(remove_steps),
                        "score": score,
                        "mtime": job_file.stat().st_mtime,
                        "source_image_path": str(src_path),
                    })
                except Exception:
                    continue

        candidates.sort(
            key=lambda c: (
                -c["score"],
                -int(2 <= c["extract_count"] <= 8),
                -c["mtime"],
            )
        )
        return candidates[:max_examples]

    def _build_reference_examples(self, max_examples: int = 3) -> str:
        """
        Build compact in-context examples from previous generated plans.
        These examples guide cohesive layer decisions in AUTO mode.
        """
        selected = self._collect_reference_examples(max_examples=max_examples)
        if not selected:
            return ""

        lines = [
            "REFERENCE EXAMPLES (use these to improve cohesive layer planning decisions; do not copy verbatim):"
        ]
        for idx, ex in enumerate(selected, start=1):
            summary = ex["scene_summary"] or "Scene with layered foreground/midground/background elements."
            summary = summary[:220]
            targets = ", ".join(ex["layer_targets"][:6])
            lines.append(
                f"- Example {idx}: scene='{summary}' | extracts={ex['extract_count']} | "
                f"plates={ex['remove_count']} | foreground->background layers: {targets}"
            )
        lines.append("")
        return "\n".join(lines)
    
    def generate_plan(
        self, 
        image_path: str, 
        provider: Optional[str] = None,
        model_config: Optional[dict] = None,
        api_key: Optional[str] = None,
        scene_description: Optional[str] = None,
        layer_count: Optional[int] = None,
        layer_map: Optional[list] = None,
        exclude_characters: bool = False,
        log_hook: Optional[Callable[[str], None]] = None
    ) -> Plan:
        """
        Generate a dynamic extraction plan for the image.
        """
        use_provider = provider or self.provider
        config = model_config or {}
        if log_hook:
            log_hook(f"[planner] provider={use_provider}, model={config.get('model', 'default')}")
        selected_examples = self._collect_reference_examples(max_examples=3)
        reference_examples = self._build_reference_examples(max_examples=3)
        if log_hook:
            log_hook(f"[planner] selected {len(selected_examples)} reference example(s)")
        
        # Build layer instructions
        layer_instructions = ""
        if scene_description:
            layer_instructions += f"SCENE DESCRIPTION: {scene_description}\n"
            layer_instructions += "The plan must follow this description exactly.\n\n"

        if exclude_characters:
            layer_instructions += (
                "CHARACTER EXCLUSION MODE:\n"
                "Do NOT create extraction layers for people, characters, or humanoid subjects.\n"
                "Focus only on environment/background elements (ground, props, architecture, foliage, sky, effects).\n"
                "If characters are present, treat them as excluded content and do not target them as separate layers.\n\n"
            )
            if log_hook:
                log_hook("[planner] character exclusion is enabled (environment-only layering)")
        
        if layer_count and layer_map:
            layer_instructions += f"USER LAYER SPECIFICATIONS:\n"
            layer_instructions += f"The user wants exactly {layer_count} layers extracted in this order:\n"
            for layer in sorted(layer_map, key=lambda x: x.get('index', 0)):
                layer_instructions += f"  {layer['index']}. {layer['name']}\n"
            layer_instructions += "\nGenerate extraction steps that match these layer names and ordering.\n"
            # layer_instructions += "After each extraction, create a plate by removing that layer.\n" # REMOVED: Only generate plate if necessary
        else:
            layer_instructions += (
                "AUTO LAYERING MODE:\n"
                "Determine how many extraction layers are needed for this scene (between 2 and 10), "
                "name them clearly from foreground to background, and generate strong prompts for each.\n"
                "Include a strong agentic_analysis block with challenges and recommended next actions.\n"
            )
        
        if use_provider == "openai":
            return self._generate_plan_openai(image_path, config, api_key, layer_instructions, reference_examples, selected_examples, log_hook)
        elif use_provider == "gemini":
            return self._generate_plan_gemini(image_path, config, api_key, layer_instructions, reference_examples, selected_examples, log_hook)
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
        layer_instructions: str = "",
        reference_examples: str = "",
        selected_examples: Optional[List[Dict[str, Any]]] = None,
        log_hook: Optional[Callable[[str], None]] = None
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
        if log_hook:
            log_hook(f"[planner/openai] model={model_name}; example_images={min(2, len(selected_examples or []))}")
        
        formatted_prompt = PLANNER_PROMPT.format(
            layer_instructions=layer_instructions,
            reference_examples=reference_examples
        )
        
        example_content = []
        for idx, ex in enumerate((selected_examples or [])[:2], start=1):
            scene = (ex.get("scene_summary") or "Unknown scene")[:220]
            layers = ", ".join(ex.get("layer_targets", [])[:6])
            example_content.append({
                "type": "text",
                "text": f"Reference Example {idx}: scene='{scene}'. Extract layers foreground->background: {layers}."
            })
            try:
                ex_b64 = self._encode_image(ex["source_image_path"], max_side=512)
                example_content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{ex_b64}"}
                })
            except Exception:
                continue

        # Build arguments dynamically
        completion_args = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": formatted_prompt},
                        *example_content,
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
            if log_hook:
                log_hook("[planner/openai] sending planning request")
            response = client.chat.completions.create(**completion_args)
            content = response.choices[0].message.content
            print(f"DEBUG: OpenAI raw response: {content[:100]}...")
            
            clean_content = self._clean_json_response(content)
            plan_json = json.loads(clean_content)
            if log_hook:
                step_count = len(plan_json.get("steps", [])) if isinstance(plan_json, dict) else 0
                log_hook(f"[planner/openai] received and parsed JSON plan ({step_count} step(s))")
            return self._parse_plan(plan_json)
        except Exception as e:
            print(f"OpenAI Planning Error: {e}")
            if log_hook:
                log_hook(f"[planner/openai] planning failed: {e}")
            raise
    
    def _generate_plan_gemini(
        self, 
        image_path: str, 
        config: dict,
        api_key: Optional[str] = None,
        layer_instructions: str = "",
        reference_examples: str = "",
        selected_examples: Optional[List[Dict[str, Any]]] = None,
        log_hook: Optional[Callable[[str], None]] = None
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
        if log_hook:
            log_hook(f"[planner/gemini] model={model_name}; example_images={min(2, len(selected_examples or []))}")
        
        print(f"DEBUG: Calling Gemini API with model={model_name}")
        
        try:
            img = Image.open(image_path)
            formatted_prompt = PLANNER_PROMPT.format(
                layer_instructions=layer_instructions,
                reference_examples=reference_examples
            )

            contents = [formatted_prompt]
            for idx, ex in enumerate((selected_examples or [])[:2], start=1):
                scene = (ex.get("scene_summary") or "Unknown scene")[:220]
                layers = ", ".join(ex.get("layer_targets", [])[:6])
                contents.append(
                    f"Reference Example {idx}: scene='{scene}'. Extract layers foreground->background: {layers}."
                )
                try:
                    ex_img = Image.open(ex["source_image_path"])
                    contents.append(ex_img)
                except Exception:
                    continue
            contents.append(img)
            
            gen_config = {}
            if "temperature" in config:
                gen_config["temperature"] = float(config["temperature"])
            
            # Use JSON mode defined in types
            gen_config["response_mime_type"] = "application/json"
                
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=gen_config
            )
            
            if not response.text:
                raise ValueError("Empty response from Gemini")
            
            print(f"DEBUG: Gemini raw response: {response.text[:100]}...")
            
            clean_content = self._clean_json_response(response.text)
            plan_json = json.loads(clean_content)
            if log_hook:
                step_count = len(plan_json.get("steps", [])) if isinstance(plan_json, dict) else 0
                log_hook(f"[planner/gemini] received and parsed JSON plan ({step_count} step(s))")
            return self._parse_plan(plan_json)
            
        except Exception as e:
            print(f"Gemini Planning Error: {e}")
            if log_hook:
                log_hook(f"[planner/gemini] planning failed: {e}")
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
            steps=steps,
            agentic_analysis=plan_json.get("agentic_analysis")
        )


# Global planner instance
try:
    planner = Planner()
except Exception as e:
    print(f"Planner service not available: {e}")
    planner = None
