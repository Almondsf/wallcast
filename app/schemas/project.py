from pydantic import BaseModel
from datetime import datetime

class ProjectRead(BaseModel):
    id: int
    original_image_url: str
    created_at: datetime

    class Config:
        from_attributes = True