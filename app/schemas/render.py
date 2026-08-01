from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class RenderCreate(BaseModel):
    paint_color_top_id: int
    paint_color_bottom_id: Optional[int] = None
    split_position: Optional[float] = None


class RenderRead(BaseModel):
    id: int
    project_id: int
    paint_color_top_id: int
    paint_color_bottom_id: Optional[int]
    split_position: Optional[float]
    result_image_url: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True