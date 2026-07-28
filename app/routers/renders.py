import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.paint_color import PaintColor
from app.models.render import Render
from app.schemas.render import RenderCreate, RenderRead
from app.services.render_service import build_prompt, generate_render

router = APIRouter(prefix="/projects/{project_id}/renders", tags=["renders"])

RESULT_DIR = "uploads/results"
os.makedirs(RESULT_DIR, exist_ok=True)


@router.post("/", response_model=RenderRead)
def create_render(
    project_id: int,
    data: RenderCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = session.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")

    top_color = session.get(PaintColor, data.paint_color_top_id)
    if not top_color:
        raise HTTPException(status_code=400, detail="Invalid top paint color")

    bottom_color = None
    if data.paint_color_bottom_id:
        bottom_color = session.get(PaintColor, data.paint_color_bottom_id)
        if not bottom_color:
            raise HTTPException(status_code=400, detail="Invalid bottom paint color")

    prompt = build_prompt(
        top_color.name, top_color.hex_code,
        bottom_color.name if bottom_color else None,
        bottom_color.hex_code if bottom_color else None,
    )

    local_image_path = project.original_image_url.lstrip("/")

    try:
        image_bytes = generate_render(local_image_path, prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI render failed: {str(e)}")

    result_filename = f"{uuid.uuid4()}.png"
    result_path = os.path.join(RESULT_DIR, result_filename)
    with open(result_path, "wb") as f:
        f.write(image_bytes)

    render = Render(
        project_id=project.id,
        paint_color_top_id=top_color.id,
        paint_color_bottom_id=bottom_color.id if bottom_color else None,
        prompt_used=prompt,
        result_image_url=f"/{RESULT_DIR}/{result_filename}",
        status="done",
    )
    session.add(render)
    session.commit()
    session.refresh(render)
    return render