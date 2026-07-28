from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.paint_color import PaintColor

router = APIRouter(prefix="/paint-colors", tags=["paint-colors"])

@router.get("/")
def list_paint_colors(session: Session = Depends(get_session)):
    colors = session.exec(select(PaintColor)).all()
    return colors