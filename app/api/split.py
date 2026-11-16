from pathlib import Path
from uuid import uuid4
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

STATIC_DIR = Path("static")
UPLOAD_DIR = STATIC_DIR / "upload"
CHUNKS_DIR = STATIC_DIR / "chunks"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)


class SplitRequest(BaseModel):
    ref: str
    chunk_seconds: int = 30


@router.post("/api/video/split")
async def split_video(payload: SplitRequest):
    ref = payload.ref.strip()
    chunk_seconds = payload.chunk_seconds

    if not ref:
        raise HTTPException(status_code=400, detail="Video ref is required")

    if chunk_seconds <= 0:
        raise HTTPException(status_code=400, detail="chunk_seconds must be greater than 0")

    if not ref.startswith("/static/"):
        raise HTTPException(status_code=400, detail="ref must start with /static/")

    input_path = Path(ref.lstrip("/"))

    if not input_path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {input_path}")

    split_id = uuid4().hex
    out_dir = CHUNKS_DIR / split_id
    out_dir.mkdir(parents=True, exist_ok=True)

    output_pattern = out_dir / "chunk_%03d.mp4"

    cmd = [
        "ffmpeg",
        "-i",
        str(input_path),
        "-c",
        "copy",
        "-map",
        "0",
        "-f",
        "segment",
        "-segment_time",
        str(chunk_seconds),
        "-reset_timestamps",
        "1",
        str(output_pattern),
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            status_code=500,
            detail=f"FFmpeg split failed: {e.stderr or e.stdout or str(e)}",
        )

    chunk_files = sorted(out_dir.glob("chunk_*.mp4"))
    chunk_refs = [f"/static/chunks/{split_id}/{p.name}" for p in chunk_files]

    return {
        "status": "succeeded",
        "split_id": split_id,
        "chunk_count": len(chunk_refs),
        "chunks": chunk_refs,
    }