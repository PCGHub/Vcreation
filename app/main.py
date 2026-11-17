import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# Load environment variables before importing app modules that may read them at import time.
load_dotenv()

from app.api.ai import router as ai_router
from app.api.edit import router as edit_router
from app.api.split import router as split_router
from app.api.upload import router as upload_router
from app.routes.generate import router as generate_router
from app.api.studio import router as studio_router
from app.services import studio
from app.security import PrivateWorkspaceMiddleware


@asynccontextmanager
async def lifespan(app):
    studio.initialize()
    yield

app = FastAPI(
    title="Vcreation",
    description="Local filmmaking studio: storyboards, takes, editing, export and cost records",
    version="0.1.0",
    debug=False,
    lifespan=lifespan,
)

# -----------------------------
# STATIC
# -----------------------------
os.makedirs("static/videos", exist_ok=True)
os.makedirs("static/uploads", exist_ok=True)
os.makedirs("static/source_clips", exist_ok=True)
os.makedirs("static/edit_jobs", exist_ok=True)
os.makedirs("static/_tmp_edits", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
from app.api.music import router as music_router

# -----------------------------
# CORS
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Owner-only protection covers API routes, documentation and media files.
app.add_middleware(PrivateWorkspaceMiddleware)

# -----------------------------
# ROUTERS
# -----------------------------
app.include_router(upload_router)
app.include_router(split_router)
app.include_router(ai_router, prefix="/api")
app.include_router(music_router)
app.include_router(generate_router)
app.include_router(edit_router)
app.include_router(studio_router)


@app.exception_handler(LookupError)
async def missing_record(request, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def invalid_operation(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.get("/")
def home():
    return {"project": "Vcreation", "organization": "PCGH", "status": "running"}
