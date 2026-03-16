import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.prompt_variants import (  # noqa: E402
    EXACT_OBJECT_ONLY_PROMPT,
    apply_deterministic_extract_prompt_to_step,
    build_exact_extract_prompt_variant,
    build_manual_prompt_variations_for_step,
    seed_extract_prompt_variations,
    step_needs_llm_variation_generation,
)
from app.models.schemas import StepType  # noqa: E402


def _step(**kwargs):
    defaults = dict(
        type=StepType.EXTRACT,
        target="chair",
        name="Extract chair",
        prompt="Extract the chair only on a solid white background.",
        prompt_variations=[],
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_build_exact_extract_prompt_variant_uses_target():
    prompt = build_exact_extract_prompt_variant("chair", "Extract chair")
    assert prompt == f"{EXACT_OBJECT_ONLY_PROMPT}\nTarget object: chair."


def test_build_exact_extract_prompt_variant_falls_back_to_name():
    prompt = build_exact_extract_prompt_variant("", "Extract hanging lamp.")
    assert prompt.endswith("Target object: hanging lamp.")


def test_build_exact_extract_prompt_variant_falls_back_to_object():
    prompt = build_exact_extract_prompt_variant(None, " ")
    assert prompt.endswith("Target object: object.")


def test_seed_extract_prompt_variations_dedupes_and_keeps_order():
    primary = "P1"
    original = "P2"
    seeded = seed_extract_prompt_variations(primary, original, ["P1", "P3", " ", "P2"])
    assert seeded == ["P1", "P2", "P3"]


def test_apply_deterministic_extract_prompt_rewrites_prompt_and_preserves_original():
    step = _step(
        target="chair",
        prompt="Detailed planner prompt for chair extraction.",
        prompt_variations=["Detailed planner prompt for chair extraction.", "Variant A"],
    )

    changed = apply_deterministic_extract_prompt_to_step(step)

    assert changed is True
    assert step.prompt == f"{EXACT_OBJECT_ONLY_PROMPT}\nTarget object: chair."
    assert step.prompt_variations[0] == step.prompt
    assert "Detailed planner prompt for chair extraction." in step.prompt_variations
    assert step.prompt_variations.count("Detailed planner prompt for chair extraction.") == 1


def test_apply_deterministic_extract_prompt_skips_remove_steps():
    step = _step(type=StepType.REMOVE, prompt="Remove object on white background.", prompt_variations=["v1"])
    original_prompt = step.prompt
    original_variations = list(step.prompt_variations)

    changed = apply_deterministic_extract_prompt_to_step(step)

    assert changed is False
    assert step.prompt == original_prompt
    assert step.prompt_variations == original_variations


def test_seeded_extract_step_skips_llm_variation_backfill():
    step = _step(prompt="Planner prompt", prompt_variations=[])
    apply_deterministic_extract_prompt_to_step(step)

    assert len(step.prompt_variations) >= 2
    assert step_needs_llm_variation_generation(step) is False


def test_manual_extract_variations_include_deterministic_first_and_strings_only():
    step = _step(target="chair", name="Extract chair")
    current_prompt = "Custom retry prompt for chair."
    variations = build_manual_prompt_variations_for_step(
        step,
        current_prompt,
        ["Another variation", "", 123, current_prompt],
    )

    assert variations[0] == f"{EXACT_OBJECT_ONLY_PROMPT}\nTarget object: chair."
    assert current_prompt in variations
    assert all(isinstance(v, str) for v in variations)


def test_manual_remove_variations_do_not_inject_deterministic_prompt():
    step = _step(type=StepType.REMOVE)
    variations = build_manual_prompt_variations_for_step(step, "Remove prompt", ["v1", "", "v1"])
    assert variations == ["v1"]
