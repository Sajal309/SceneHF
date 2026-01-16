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
