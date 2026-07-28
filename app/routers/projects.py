import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.project import Project
from app.schemas.project import ProjectRead

router = APIRouter(prefix="/projects", tags=["projects"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/", response_model=ProjectRead)
def create_project(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    ext = file.filename.split(".")[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)  # OS-correct, for writing to disk

    with open(filepath, "wb") as f:
        f.write(file.file.read())

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