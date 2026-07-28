from io import BytesIO
from PIL import Image
from google import genai
from google.genai.types import GenerateContentConfig, Modality
from app.core.config import settings

client = genai.Client(api_key=settings.gemini_api_key)


def build_prompt(top_color_name: str, top_hex: str, bottom_color_name: str | None = None, bottom_hex: str | None = None) -> str:
    if bottom_color_name:
        return (
            f"Repaint the walls in this room with two colors: {top_color_name} ({top_hex}) "
            f"on the upper portion of the wall and {bottom_color_name} ({bottom_hex}) on the "
            f"lower portion, divided by a horizontal line roughly 40% up from the floor. "
            f"Keep the ceiling, floor, doors, windows, and furniture exactly unchanged. "
            f"Preserve the original lighting and shadows."
        )
    return (
        f"Repaint only the wall surfaces in this room to {top_color_name} ({top_hex}). "
        f"Keep the ceiling, floor, doors, windows, and furniture exactly unchanged. "
        f"Preserve the original lighting and shadows."
    )


def generate_render(image_path: str, prompt: str) -> bytes:
    source_image = Image.open(image_path)

    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=[source_image, prompt],
        config=GenerateContentConfig(response_modalities=[Modality.TEXT, Modality.IMAGE]),
    )

    for part in response.candidates[0].content.parts:
        if part.inline_data:
            return part.inline_data.data

    raise ValueError("No image returned from Gemini")