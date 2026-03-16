import re
from typing import Iterable, List, Optional, Sequence

from app.models.schemas import StepType


EXACT_OBJECT_ONLY_PROMPT = "Seperate and extract just the `object` on a white bckground from this image, remove everything else"

_EXTRACT_PREFIX_RE = re.compile(r"^\s*extract\s+", re.IGNORECASE)


def _clean_prompt_list(values: Optional[Iterable[str]]) -> List[str]:
    cleaned: List[str] = []
    if not values:
        return cleaned
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if text:
            cleaned.append(text)
    return cleaned


def _dedupe_keep_order(values: Sequence[str]) -> List[str]:
    unique: List[str] = []
    for value in values:
        if value and value not in unique:
            unique.append(value)
    return unique


def _normalize_target_label(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    text = _EXTRACT_PREFIX_RE.sub("", text)
    text = text.strip().strip(".")
    return text or None


def _resolve_target_label(step_target: Optional[str], step_name: Optional[str]) -> str:
    return (
        _normalize_target_label(step_target)
        or _normalize_target_label(step_name)
        or "object"
    )


def build_exact_extract_prompt_variant(step_target: Optional[str], step_name: Optional[str]) -> str:
    target_label = _resolve_target_label(step_target, step_name)
    return f"{EXACT_OBJECT_ONLY_PROMPT}\nTarget object: {target_label}."


def seed_extract_prompt_variations(
    primary_prompt: str,
    original_prompt: str,
    existing_variations: Optional[Iterable[str]],
) -> List[str]:
    seeded = [primary_prompt.strip() if isinstance(primary_prompt, str) else ""]
    if isinstance(original_prompt, str):
        seeded.append(original_prompt.strip())
    seeded.extend(_clean_prompt_list(existing_variations))
    return _dedupe_keep_order([v for v in seeded if v])


def apply_deterministic_extract_prompt_to_step(step) -> bool:
    if getattr(step, "type", None) != StepType.EXTRACT:
        return False

    original_prompt = getattr(step, "prompt", "") or ""
    deterministic_prompt = build_exact_extract_prompt_variant(
        getattr(step, "target", None),
        getattr(step, "name", None),
    )
    step.prompt = deterministic_prompt
    step.prompt_variations = seed_extract_prompt_variations(
        deterministic_prompt,
        original_prompt,
        getattr(step, "prompt_variations", []) or [],
    )
    return True


def step_needs_llm_variation_generation(step) -> bool:
    variations = _clean_prompt_list(getattr(step, "prompt_variations", []) or [])
    return len(variations) < 2


def build_manual_prompt_variations_for_step(
    step,
    current_prompt: str,
    llm_variations: Optional[Iterable[str]],
) -> List[str]:
    llm_clean = _clean_prompt_list(llm_variations)
    if getattr(step, "type", None) != StepType.EXTRACT:
        return _dedupe_keep_order(llm_clean)

    deterministic_prompt = build_exact_extract_prompt_variant(
        getattr(step, "target", None),
        getattr(step, "name", None),
    )
    return seed_extract_prompt_variations(deterministic_prompt, current_prompt or "", llm_clean)
