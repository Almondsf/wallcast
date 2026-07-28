from sqlmodel import SQLModel, Field
from typing import Optional


class PaintColor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    hex_code: str
    brand: str
    finish: Optional[str] = None