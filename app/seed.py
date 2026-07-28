from sqlmodel import Session
from app.core.database import engine
from app.models.paint_color import PaintColor

SAMPLE_COLORS = [
    {"name": "Storm Grey", "hex_code": "#8C8C8C", "brand": "Berger", "finish": "Matte"},
    {"name": "Rose White", "hex_code": "#F4F1EA", "brand": "Dulux", "finish": "Silk"},
    {"name": "Ocean Blue", "hex_code": "#2C5F8A", "brand": "Sundure", "finish": "Gloss"},
    {"name": "Warm Beige", "hex_code": "#D8C3A5", "brand": "Berger", "finish": "Matte"},
]

def seed_paint_colors():
    with Session(engine) as session:
        for color_data in SAMPLE_COLORS:
            color = PaintColor(**color_data)
            session.add(color)
        session.commit()
    print(f"Seeded {len(SAMPLE_COLORS)} paint colors.")

if __name__ == "__main__":
    seed_paint_colors()