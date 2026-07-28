from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime, timezone

class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    original_image_url: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))