from pathlib import Path
from uuid import uuid4
import shutil

from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter()

# 🔥 ALWAYS resolve absolute path (important)
BASE_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = STATIC_DIR / "upload"

# Ensure folder exists
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file uploaded")

        ext = Path(file.filename).suffix.lower()

        allowed = {
            # video
            ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
            # audio
            ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg",
        }

        if ext not in allowed:
            raise HTTPException(status_code=400, detail="Unsupported media format")

        filename = f"{uuid4().hex}{ext}"
        save_path = UPLOAD_DIR / filename

        # 🔥 SAFE WRITE (no memory overload)
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 🔥 DEBUG LOG (important for troubleshooting)
        print("✅ Uploaded file saved at:", save_path)

        return {
            "path": f"/static/upload/{filename}",  # 🔥 THIS MUST MATCH music_engine
            "filename": filename,
            "kind": "audio" if ext in {
                ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"
            } else "video",
        }

    except Exception as e:
        print("🔥 UPLOAD ERROR:", e)
        raise HTTPException(status_code=500, detail=str(e))