from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

class ProjectRead(BaseModel):
    id: int
    original_image_url: str
    mask_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MaskPoint(BaseModel):
    x: int
    y: int


# Edge straightening, as a fraction of the image diagonal. 0 disables it.
STRAIGHTEN_DEFAULT = 0.004


class MaskCreate(BaseModel):
    # "auto" segments walls semantically; points then only narrow the result to
    # the tapped wall(s). "flood" is the colour-spread fallback, which needs a seed.
    mode: Literal["auto", "flood"] = "auto"
    points: list[MaskPoint] = []
    tolerance: int = 20
    straighten: float = Field(default=STRAIGHTEN_DEFAULT, ge=0, le=0.05)


class MaskUpdate(BaseModel):
    # A PNG of the hand-edited mask, as a data URL or bare base64. White = wall.
    mask_png: str
    straighten: float = Field(default=STRAIGHTEN_DEFAULT, ge=0, le=0.05)


class MaskRead(BaseModel):
    mask_url: str
    preview_url: str
    coverage: float  # fraction of the image detected as wall, for a UI sanity hint
