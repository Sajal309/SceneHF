from PIL import Image


def load_mask_binary(path: str) -> Image.Image:
    """
    Load a mask image, convert to binary (0/255) using threshold 128.
    Returns an L-mode image.
    """
    mask = Image.open(path).convert("L")
    return mask.point(lambda p: 255 if p >= 128 else 0, mode="L")


def ensure_mask_matches_input(mask: Image.Image, input_img: Image.Image) -> None:
    if mask.size != input_img.size:
        raise ValueError(f"Mask size {mask.size} does not match input size {input_img.size}")


def apply_mask_constraints(output_path: str, input_path: str, mask_path: str, step_type: str) -> None:
    """
    Post-process output using mask to enforce locality.
    - For EXTRACT: keep only masked region from output, set outside to white.
    - For REMOVE: keep outside region from original input, apply output only inside mask.
    """
    base = Image.open(input_path).convert("RGB")
    out = Image.open(output_path).convert("RGB")
    mask = load_mask_binary(mask_path)
    ensure_mask_matches_input(mask, base)

    if step_type == "EXTRACT":
        white = Image.new("RGB", out.size, (255, 255, 255))
        white.paste(out, mask=mask)
        white.save(output_path)
    elif step_type == "REMOVE":
        combined = base.copy()
        combined.paste(out, mask=mask)
        combined.save(output_path)
