import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Load environment variables before importing app modules that may read them at import time.
load_dotenv()

from app.api.ai import router as ai_router
from app.api.edit import router as edit_router
from app.api.split import router as split_router
from app.api.upload import router as upload_router
from app.routes import transform
from app.routes.generate import router as generate_router

app = FastAPI(
    title="Clayme",
    description="PCGH (Puricasie Creators Growth Hub) - Clayme AI engine",
    version="0.1.0",
    debug=True,
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

# -----------------------------
# ROUTERS
# -----------------------------
app.include_router(upload_router)
app.include_router(split_router)
app.include_router(ai_router, prefix="/api")
app.include_router(music_router)
app.include_router(transform.router)
app.include_router(generate_router)
app.include_router(edit_router)


@app.get("/")
def home():
    return {"project": "clayme", "organization": "PCGH", "status": "running"}
