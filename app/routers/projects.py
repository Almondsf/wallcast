import base64
import binascii
import os
import uuid
import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.project import Project
from app.schemas.project import ProjectRead, MaskCreate, MaskRead, MaskUpdate
from app.services import mask_service, segmentation_service

router = APIRouter(prefix="/projects", tags=["projects"])

UPLOAD_DIR = "uploads"
MASK_DIR = "uploads/masks"
AUTO_MASK_DIR = "uploads/masks/auto"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(MASK_DIR, exist_ok=True)
os.makedirs(AUTO_MASK_DIR, exist_ok=True)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/", response_model=ProjectRead)
def create_project(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}",
        )

    contents = file.file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    ext = ALLOWED_CONTENT_TYPES[file.content_type]
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)  # OS-correct, for writing to disk

    with open(filepath, "wb") as f:
        f.write(contents)

    project = Project(user_id=current_user.id, original_image_url=f"/{UPLOAD_DIR}/{filename}")  # URL-correct, always forward slashes
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.get("/", response_model=list[ProjectRead])
def list_projects(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    projects = session.exec(
        select(Project).where(Project.user_id == current_user.id)
    ).all()
    return projects


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = session.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _persist_mask(session: Session, project: Project, image_path: str, mask) -> MaskRead:
    """Write the mask plus a tinted preview to disk and point the project at it."""
    mask_filename = f"{uuid.uuid4()}.png"
    with open(os.path.join(MASK_DIR, mask_filename), "wb") as f:
        f.write(mask_service.encode_mask(mask))

    preview_filename = f"{uuid.uuid4()}_preview.png"
    with open(os.path.join(MASK_DIR, preview_filename), "wb") as f:
        f.write(mask_service.render_preview(image_path, mask))

    project.mask_url = f"/{MASK_DIR}/{mask_filename}"
    session.add(project)
    session.commit()
    session.refresh(project)

    return MaskRead(
        mask_url=project.mask_url,
        preview_url=f"/{MASK_DIR}/{preview_filename}",
        coverage=float((mask == 255).sum()) / mask.size,
    )


def _cached_wall_mask(project_id: int, image_path: str):
    """Run wall segmentation once per project, then reuse it for later taps."""
    cache_path = os.path.join(AUTO_MASK_DIR, f"{project_id}.png")
    cached = cv2.imread(cache_path, cv2.IMREAD_GRAYSCALE)
    if cached is not None:
        return cached

    mask = segmentation_service.segment_walls(image_path)
    mask = segmentation_service.refine_mask(mask)
    cv2.imwrite(cache_path, mask)
    return mask


@router.post("/{project_id}/mask", response_model=MaskRead)
def create_mask(
    project_id: int,
    data: MaskCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = session.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")

    local_image_path = project.original_image_url.lstrip("/")
    points = [(p.x, p.y) for p in data.points]

    try:
        if data.mode == "auto":
            # Segmentation is deterministic for a given photo, so cache it and let
            # subsequent taps just re-slice the cached mask instead of re-running the model.
            all_walls = _cached_wall_mask(project.id, local_image_path)
            if not all_walls.any():
                raise ValueError("No wall could be detected in this photo. Try the manual selection mode.")
            mask = segmentation_service.select_regions(all_walls, points)
        else:
            if not points:
                raise ValueError("Manual mode needs at least one point to start from")
            mask = mask_service.generate_mask(local_image_path, points, data.tolerance)
        mask = mask_service.straighten_mask(mask, data.straighten)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _persist_mask(session, project, local_image_path, mask)


@router.put("/{project_id}/mask", response_model=MaskRead)
def update_mask(
    project_id: int,
    data: MaskUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Replace the mask with a hand-edited one from the brush/eraser tool."""
    project = session.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")

    payload = data.mask_png.split(",", 1)[-1]  # tolerate a data: URL prefix
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="mask_png is not valid base64")

    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    if decoded is None:
        raise HTTPException(status_code=400, detail="mask_png could not be decoded as an image")

    local_image_path = project.original_image_url.lstrip("/")
    image = cv2.imread(local_image_path)
    if image is None:
        raise HTTPException(status_code=404, detail="Project image is missing from disk")
    if decoded.shape[:2] != image.shape[:2]:
        raise HTTPException(
            status_code=400,
            detail=f"Mask is {decoded.shape[1]}x{decoded.shape[0]} but the image is {image.shape[1]}x{image.shape[0]}",
        )

    mask = np.where(decoded > 127, 255, 0).astype(np.uint8)
    mask = mask_service.straighten_mask(mask, data.straighten)
    return _persist_mask(session, project, local_image_path, mask)
