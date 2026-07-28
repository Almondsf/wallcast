from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.core.database import create_db_and_tables
from app.models.user import User
from app.models.paint_color import PaintColor
from app.models.project import Project
from app.models.render import Render
from app.routers import auth, paint_colors, projects, renders
from fastapi.staticfiles import StaticFiles



@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield  # app runs while paused here
    # any shutdown/cleanup code would go after yield

app = FastAPI(title="WallCast", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(paint_colors.router)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.include_router(projects.router)
app.include_router(renders.router)


@app.get("/")
def root():
    return {"status": "WallCast API is running"}