import cv2
import numpy as np

BARRIER = 1
FILLED = 255


def _edge_barrier(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    median = float(np.median(blurred))
    lower = int(max(0, 0.66 * median))
    upper = int(min(255, 1.33 * median))
    edges = cv2.Canny(blurred, lower, upper)
    return cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)


def generate_mask(image_path: str, points: list[tuple[int, int]], tolerance: int = 20) -> np.ndarray:
    """Flood-fill from each tapped point, bounded by Canny edges, into a single binary mask."""
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at {image_path}")

    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    barrier = _edge_barrier(gray)

    flood_mask = np.zeros((h + 2, w + 2), np.uint8)
    flood_mask[1:-1, 1:-1] = np.where(barrier > 0, BARRIER, 0)

    diff = (tolerance, tolerance, tolerance)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | (FILLED << 8)

    for x, y in points:
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError(f"Point ({x}, {y}) is outside the image bounds ({w}x{h})")
        # Already-filled or barrier pixels are non-zero and simply block re-flooding; harmless.
        # FLOODFILL_MASK_ONLY leaves `image` untouched, so the same array is reused across taps.
        cv2.floodFill(image, flood_mask, (x, y), 0, diff, diff, flags)

    return (flood_mask[1:-1, 1:-1] == FILLED).astype(np.uint8) * 255


def straighten_mask(mask: np.ndarray, strength: float = 0.004, min_area_ratio: float = 0.001) -> np.ndarray:
    """Replace wobbly mask boundaries with straight polygon edges.

    Per-pixel segmentation upsampled from a coarse grid gives ragged outlines, but real
    walls meet ceilings, floors and window frames in straight lines. Douglas-Peucker
    simplification collapses the wobble into line segments. `strength` is expressed as a
    fraction of the image diagonal so the result is resolution-independent.
    """
    if strength <= 0 or not mask.any():
        return mask

    h, w = mask.shape[:2]
    epsilon = strength * float(np.hypot(w, h))
    min_area = mask.size * min_area_ratio

    contours, hierarchy = cv2.findContours(
        (mask > 0).astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    if hierarchy is None:
        return mask

    out = np.zeros_like(mask)
    # RETR_CCOMP gives a two-level hierarchy: parent -1 is an outer boundary, anything
    # else is a hole (a window or door punched out of the wall). Fill the outers first,
    # then knock the holes back out, so ordering can't let a hole be overwritten.
    for is_hole in (False, True):
        for contour, info in zip(contours, hierarchy[0]):
            if (info[3] != -1) != is_hole:
                continue
            if cv2.contourArea(contour) < min_area:
                continue
            approx = cv2.approxPolyDP(contour, epsilon, True)
            cv2.drawContours(out, [approx], -1, 0 if is_hole else 255, thickness=cv2.FILLED)
    return out


def render_preview(image_path: str, mask: np.ndarray, tint_bgr=(0, 0, 255), alpha: float = 0.45) -> bytes:
    """Overlay the mask on the original photo as a translucent tint, for UI confirmation."""
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at {image_path}")

    overlay = image.copy()
    overlay[mask == 255] = tint_bgr
    blended = cv2.addWeighted(overlay, alpha, image, 1 - alpha, 0)

    ok, buf = cv2.imencode(".png", blended)
    if not ok:
        raise ValueError("Failed to encode preview image")
    return buf.tobytes()


def encode_mask(mask: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", mask)
    if not ok:
        raise ValueError("Failed to encode mask image")
    return buf.tobytes()
