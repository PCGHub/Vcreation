import os
import uuid
import time
import shutil
import random
import subprocess
from pathlib import Path
from typing import List

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.ai_engine import generate_image, start_video_job, check_video_job

router = APIRouter(prefix="/api", tags=["generate"])

# -----------------------------
# STORAGE / CONSTANTS
# -----------------------------
STATIC_DIR = os.path.join("static", "videos")
os.makedirs(STATIC_DIR, exist_ok=True)

# MiniMax Director performs best at native short clips
CHUNK_SECONDS = 6

VIDEO_JOBS = {}  # job_id -> job dict
FFMPEG_BIN = os.getenv("FFMPEG_BIN")

# -----------------------------
# SCENE BIBLE (POV DRONE CAMERA)
# -----------------------------
SCENE_BIBLE = """SCENE BIBLE (must follow exactly)
Shot type: POV DRONE SHOT (camera is on the drone). Do NOT show the drone body.
Camera: stable 3-axis gimbal, smooth forward motion, gentle banking turns only, no sudden accelerations.
Lens: wide-angle drone lens, realistic perspective, clear parallax on buildings.
Clarity: SHARP focus, crisp edges, readable details.
NO heavy haze, NO fog, NO smeary motion blur.
NO depth-of-field blur. NO glow bloom. NO overbloom.
Lighting: neon night lighting but keep scene readable (controlled highlights).
Style: cinematic realism, clean image, not abstract, not painterly, no melted textures.
Forbidden: hard cuts, flicker, shaky cam, text overlays, watermarks, unreadable mush.
Continuity: keep the same city layout throughout the clip.
"""

# -----------------------------
# HELPERS
# -----------------------------
def _download_file(url: str, out_path: str):
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)

def _get_ffmpeg_bin() -> str:
    ffmpeg_bin = FFMPEG_BIN or shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg not found. Set env var FFMPEG_BIN to full path of ffmpeg.exe")
    return ffmpeg_bin

def _cleanup_files(paths: List[str]):
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass
def _ffmpeg_clarity_pass(input_path: str, output_path: str) -> None:
    """
    Clean sharp pass (less shimmer):
    - mild denoise first (reduces flicker/noise)
    - very light sharpen (avoid halos)
    - upscale to 1080p
    """
    ffmpeg_bin = _get_ffmpeg_bin()

    # Less aggressive than before:
    # - Remove deband (it can sometimes cause texture crawl)
    # - Increase denoise slightly
    # - Reduce unsharp strength
    vf = "hqdn3d=2.0:2.0:6:6,unsharp=3:3:0.45,scale=1920:1080:flags=lanczos"


    cmd = [
        ffmpeg_bin, "-y",
        "-i", input_path,
        "-vf", vf,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-preset", "medium",
        "-an",
        output_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg clarity pass failed: {proc.stderr[:1200]}")


def _make_keyframe_prompt(user_prompt: str) -> str:
    # Keyframe should match POV drone shot (no drone visible)
    return f"""{SCENE_BIBLE}

STILL IMAGE KEYFRAME (ultra sharp, high realism):
POV drone camera view above a futuristic neon city at night.
Wide skyline + river + bridge visible.
Crisp readable buildings and roads, clean night sky (no banding), controlled highlights.

User intent:
{user_prompt}
"""

def _make_video_prompt(user_prompt: str) -> str:
    # MiniMax director supports camera instruction; we enforce POV drone motion
    return f"""{SCENE_BIBLE}

[POV drone, Wide-angle lens, Tracking shot]
Start EXACTLY from the provided first frame image.
Smooth forward flight with gentle banking turns and clear parallax.
0-2s: establish skyline + river
2-4s: glide over bridge with visible traffic lights below
4-6s: approach one central tower, hold steady, keep sharp focus

User intent:
{user_prompt}
"""

def _start_video_job_i2v(prompt: str, seed: int | None, first_frame_image: str | None):
    try:
        return start_video_job(prompt, seed=seed, first_frame_image=first_frame_image)
    except TypeError:
        return start_video_job(prompt)
    except Exception:
        try:
            return start_video_job(prompt, first_frame_image=first_frame_image)
        except Exception:
            return start_video_job(prompt)

# -----------------------------
# IMAGE ROUTE
# -----------------------------
class ImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    aspect_ratio: str = "16:9"

@router.post("/generate/image")
def generate_image_route(payload: ImageRequest):
    try:
        url = generate_image(payload.prompt, payload.aspect_ratio)
        return {
            "type": "image",
            "prompt": payload.prompt,
            "status": "done",
            "url": url,
            "engine": "replicate-image",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------
# VIDEO ROUTES (I2V)
# -----------------------------
class VideoRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    duration_seconds: int = Field(6, ge=6, le=6)

@router.post("/video/generate")
def generate_video_route(payload: VideoRequest):
    try:
        user_prompt = payload.prompt
        duration = int(payload.duration_seconds)

        job_id = str(uuid.uuid4())
        job_seed = random.randint(1, 10_000_000)

        # 1) Generate sharp keyframe (Seedream 4K handled in ai_engine)
        keyframe_prompt = _make_keyframe_prompt(user_prompt)
        keyframe_url = generate_image(keyframe_prompt, "16:9")
        if not keyframe_url:
            raise RuntimeError("Failed to generate keyframe image")

        # 2) Generate video from keyframe
        video_prompt = _make_video_prompt(user_prompt)
        pred_id = _start_video_job_i2v(video_prompt, job_seed, keyframe_url)

        VIDEO_JOBS[job_id] = {
            "prompt": user_prompt,
            "duration_seconds": duration,
            "prediction_id": pred_id,
            "final_url": None,
            "status": "processing",
            "error": None,
            "created_at": time.time(),
            "seed": job_seed,
            "keyframe_url": keyframe_url,
        }

        return {
            "type": "video",
            "prompt": user_prompt,
            "status": "started",
            "job_id": job_id,
            "duration_seconds": duration,
            "engine": "replicate-i2v",
            "keyframe_url": keyframe_url,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/video/status/{job_id}")
def video_status(job_id: str):
    job = VIDEO_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        if job.get("final_url"):
            return {
                "type": "video",
                "prompt": job["prompt"],
                "status": "succeeded",
                "url": job["final_url"],
                "engine": "replicate-i2v",
                "keyframe_url": job.get("keyframe_url"),
            }

        result = check_video_job(job["prediction_id"])
        s = result.get("status")

        if s in ("starting", "processing"):
            return {
                "type": "video",
                "prompt": job["prompt"],
                "status": "processing",
                "engine": "replicate-i2v",
                "keyframe_url": job.get("keyframe_url"),
            }

        if s == "failed":
            job["status"] = "failed"
            job["error"] = result.get("error") or "Video generation failed"
            return {
                "type": "video",
                "prompt": job["prompt"],
                "status": "failed",
                "error": job["error"],
                "engine": "replicate-i2v",
                "keyframe_url": job.get("keyframe_url"),
            }

        if s == "succeeded" and result.get("url"):
            url = result["url"]

            raw_name = f"{job_id}_raw.mp4"
            raw_path = os.path.join(STATIC_DIR, raw_name)
            _download_file(url, raw_path)

            out_name = f"{job_id}_final.mp4"
            out_path = os.path.join(STATIC_DIR, out_name)

            # ✅ clarity pass
            _ffmpeg_clarity_pass(raw_path, out_path)
            _cleanup_files([raw_path])

            job["final_url"] = f"http://127.0.0.1:8000/static/videos/{out_name}"
            job["status"] = "succeeded"

            return {
                "type": "video",
                "prompt": job["prompt"],
                "status": "succeeded",
                "url": job["final_url"],
                "engine": "replicate-i2v",
                "keyframe_url": job.get("keyframe_url"),
            }

        return {
            "type": "video",
            "prompt": job["prompt"],
            "status": "processing",
            "engine": "replicate-i2v",
            "keyframe_url": job.get("keyframe_url"),
        }

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        return {
            "type": "video",
            "prompt": job["prompt"],
            "status": "failed",
            "error": job["error"],
            "engine": "replicate-i2v",
            "keyframe_url": job.get("keyframe_url"),
        }
