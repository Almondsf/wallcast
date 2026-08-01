from sqlmodel import SQLModel, Field
from typing import Optional


class PaintColor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    hex_code: str
    brand: str
    finish: Optional[str] = None
    # The manufacturer's own reference for the colour, e.g. "NF-R06" or "2001-P".
    # This is what you quote at the counter, so it is searchable in the picker.
    code: Optional[str] = None
