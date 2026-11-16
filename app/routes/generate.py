from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["generate"])

class ImageRequest(BaseModel):
    prompt: str

class VideoRequest(BaseModel):
    prompt: str


@router.post("/generate/image")
def generate_image(payload: ImageRequest):
    return {
        "type": "image",
        "prompt": payload.prompt,
        "status": "image generation started"
    }


@router.post("/video/generate")
def generate_video(payload: VideoRequest):
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt required")

    return {
        "type": "video",
        "prompt": prompt,
        "status": "video generation started",
        "engine": "clayme"
    }
