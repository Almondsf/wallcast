import cv2
import numpy as np


def hex_to_hsv(hex_code: str) -> tuple[int, int, int]:
    """Return the OpenCV-scale (H: 0-179, S: 0-255, V: 0-255) for a paint color's hex code."""
    hex_code = hex_code.lstrip("#")
    r, g, b = (int(hex_code[i : i + 2], 16) for i in (0, 2, 4))
    bgr = np.uint8([[[b, g, r]]])
    h, s, v = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[0][0]
    return int(h), int(s), int(v)


def _apply_color(hsv: np.ndarray, region: np.ndarray, hex_code: str, anchor_luminance: bool) -> None:
    """Recolour `region` of an HSV image in place to the given paint colour."""
    if not region.any():
        return

    h, s, v = hex_to_hsv(hex_code)
    hsv[region, 0] = h
    hsv[region, 1] = s

    if not anchor_luminance:
        return  # keep V exactly as photographed

    # Scale brightness so the region's *average* matches the paint chip while the
    # relative variation — shadows, light falloff, texture — is preserved. Replacing
    # V outright would flatten the wall; leaving it untouched renders the wrong colour
    # (a navy on a white wall comes out sky blue).
    original = hsv[region, 2].astype(np.float32)
    mean = float(original.mean())
    if mean <= 1e-6:
        return
    hsv[region, 2] = np.clip(original * (v / mean), 0, 255).astype(np.uint8)


def render_wall_color(
    image_path: str,
    mask_path: str,
    top_hex: str,
    bottom_hex: str | None = None,
    split_position: float | None = None,
    anchor_luminance: bool = True,
) -> bytes:
    """Recolour the masked wall to the target paint colour(s).

    Hue and saturation are taken from the paint's hex code. Brightness is rescaled so
    the wall averages the paint's own lightness while keeping the room's real shadows
    (set anchor_luminance=False to keep the photographed brightness untouched instead).
    """
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at {image_path}")

    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise ValueError(f"Could not read mask at {mask_path}")
    if mask.shape[:2] != image.shape[:2]:
        raise ValueError("Mask and image dimensions do not match")

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    wall = mask == 255

    if bottom_hex:
        split_position = 50.0 if split_position is None else split_position
        split_row = int(image.shape[0] * (split_position / 100))
        row_idx = np.arange(image.shape[0]).reshape(-1, 1)
        _apply_color(hsv, wall & (row_idx < split_row), top_hex, anchor_luminance)
        _apply_color(hsv, wall & (row_idx >= split_row), bottom_hex, anchor_luminance)
    else:
        _apply_color(hsv, wall, top_hex, anchor_luminance)

    result = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    ok, buf = cv2.imencode(".png", result)
    if not ok:
        raise ValueError("Failed to encode result image")
    return buf.tobytes()
