from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime, timezone

class Render(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    paint_color_top_id: int = Field(foreign_key="paintcolor.id")
    paint_color_bottom_id: Optional[int] = Field(default=None, foreign_key="paintcolor.id")
    prompt_used: Optional[str] = None
    result_image_url: Optional[str] = None
    status: str = Field(default="pending")  # pending | processing | done | failed
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))