import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles


# Load configuration before importing application services.
load_dotenv()

from app.api.ai import router as ai_router
from app.api.edit import router as edit_router
from app.api.split import router as split_router
from app.api.upload import router as upload_router
from app.api.studio import router as studio_router
from app.routes.generate import router as generate_router
from app.services import studio


@asynccontextmanager
async def lifespan(app):
    studio.initialize()
    yield


app = FastAPI(
    title="Vcreation",
    description=(
        "Filmmaking studio: storyboards, takes, editing, "
        "export and cost records"
    ),
    version="0.1.0",
    debug=False,
    lifespan=lifespan,
)


# Prepare media directories.
for directory in (
    "static/videos",
    "static/uploads",
    "static/source_clips",
    "static/edit_jobs",
    "static/_tmp_edits",
):
    os.makedirs(directory, exist_ok=True)


app.mount(
    "/static",
    StaticFiles(directory="static"),
    name="static",
)


from app.api.music import router as music_router


# Production browser requests will use the Vercel same-origin proxy.
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


# Register application endpoints.
app.include_router(upload_router)
app.include_router(split_router)
app.include_router(ai_router, prefix="/api")
app.include_router(music_router)
app.include_router(generate_router)
app.include_router(edit_router)
app.include_router(studio_router)


@app.exception_handler(LookupError)
async def missing_record(request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": str(exc)},
    )


@app.exception_handler(ValueError)
async def invalid_operation(request, exc):
    return JSONResponse(
        status_code=409,
        content={"detail": str(exc)},
    )


@app.get("/")
def home():
    return {
        "project": "Vcreation",
        "organization": "PCGH",
        "status": "running",
    }