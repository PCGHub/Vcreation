"""Migration responses for the former nonfunctional generation endpoints."""
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api", tags=["generation migration"])


@router.post("/generate/image")
def image_generation():
    raise HTTPException(410, "Image generation is not configured. Upload approved character images in /studio; image generation needs a separately priced provider integration.")


@router.post("/video/generate")
def video_generation():
    raise HTTPException(410, "Use /studio: create a project and shot, approve the storyboard, then quote and submit a take. This endpoint no longer reports fake generation success.")
