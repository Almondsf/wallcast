"""Semantic wall segmentation.

The public surface is deliberately just `segment_walls(image_path) -> np.ndarray`,
so the underlying model can be swapped without touching callers. The current
implementation uses SegFormer fine-tuned on ADE20K, whose weights are licensed
for NON-COMMERCIAL use only (NVIDIA Source Code License). Swapping to an
MIT/Apache model (Mask2Former, OneFormer, mmseg UPerNet) means reimplementing
this one function.
"""

import os
import threading

import cv2
import numpy as np

# ADE20K class indices. Windows, doors, ceiling and floor are their own classes,
# so they fall out of the wall mask automatically.
ADE20K_WALL_CLASS = 0

# b0 measured ~14x faster than b2 on a dual-core CPU (2s vs 28s) for the same wall
# coverage to within 0.1% — walls are large smooth regions, so the bigger backbone
# buys nothing here. Override with WALLCAST_SEG_MODEL if you have the hardware.
MODEL_NAME = os.getenv("WALLCAST_SEG_MODEL", "nvidia/segformer-b0-finetuned-ade-512-512")

_model = None
_processor = None
_load_lock = threading.Lock()


def _load():
    """Lazily load the model on first use; importing this module stays cheap."""
    global _model, _processor
    if _model is not None:
        return _model, _processor

    with _load_lock:
        if _model is None:
            import torch
            from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

            # Defaults to physical cores only; on a 2-core/4-thread laptop this is a real gain.
            torch.set_num_threads(os.cpu_count() or 1)

            _processor = SegformerImageProcessor.from_pretrained(MODEL_NAME)
            model = SegformerForSemanticSegmentation.from_pretrained(MODEL_NAME)
            model.eval()
            _model = model
    return _model, _processor


def segment_walls(image_path: str) -> np.ndarray:
    """Return a binary (0/255) mask of the wall pixels in the image."""
    import torch

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at {image_path}")
    h, w = image.shape[:2]

    model, processor = _load()
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    inputs = processor(images=rgb, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits  # (1, 150, H/4, W/4)

    # Only the wall class matters, so collapse 150 channels to a single
    # "wall vs. best alternative" score *before* upsampling. Upsampling all 150
    # channels to full resolution and then taking argmax costs ~5s on a slow CPU
    # for a result that differs by <1% of pixels, all of it at boundaries that
    # refine_mask() smooths anyway.
    wall_logit = logits[:, ADE20K_WALL_CLASS : ADE20K_WALL_CLASS + 1]
    others = torch.cat(
        [logits[:, :ADE20K_WALL_CLASS], logits[:, ADE20K_WALL_CLASS + 1 :]], dim=1
    ).max(dim=1, keepdim=True).values
    score = wall_logit - others

    upsampled = torch.nn.functional.interpolate(
        score, size=(h, w), mode="bilinear", align_corners=False
    )
    return ((upsampled[0, 0] > 0).cpu().numpy().astype(np.uint8)) * 255


def refine_mask(mask: np.ndarray, min_area_ratio: float = 0.005) -> np.ndarray:
    """Drop specks and close small holes left by per-pixel classification."""
    kernel = np.ones((5, 5), np.uint8)
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)

    count, labels, stats, _ = cv2.connectedComponentsWithStats((cleaned > 0).astype(np.uint8), 8)
    min_area = mask.size * min_area_ratio
    keep = np.zeros_like(cleaned)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            keep[labels == label] = 255
    return keep


def select_regions(mask: np.ndarray, points: list[tuple[int, int]]) -> np.ndarray:
    """Keep only the connected wall regions the user tapped on.

    With no points, the whole wall mask is returned — the zero-click default.
    """
    if not points:
        return mask

    count, labels = cv2.connectedComponents((mask > 0).astype(np.uint8), connectivity=8)
    if count <= 1:
        return mask

    h, w = mask.shape[:2]
    wanted = set()
    for x, y in points:
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError(f"Point ({x}, {y}) is outside the image bounds ({w}x{h})")
        label = int(labels[y, x])
        if label != 0:  # 0 is background (non-wall)
            wanted.add(label)

    if not wanted:
        raise ValueError("No wall was detected at the point you selected. Try tapping directly on a wall.")

    selected = np.zeros_like(mask)
    for label in wanted:
        selected[labels == label] = 255
    return selected
