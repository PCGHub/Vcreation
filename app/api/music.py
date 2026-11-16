from pathlib import Path
from threading import Thread
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator

from app.services.music_engine import (
    MusicPaths,
    create_job,
    load_job,
    process_music_job,
    update_job,
)

router = APIRouter(prefix="/api/music", tags=["music"])


def _stage_message(stage: Optional[str]) -> str:
    messages = {
        "queued": "Music job queued.",
        "resolving_audio": "Checking uploaded audio.",
        "normalizing_audio": "Normalizing source audio.",
        "separating_vocals_demucs": "Separating vocals and instrumental with Demucs.",
        "generating_lyrics": "Preparing replacement lyrics.",
        "extracting_lyrics": "Extracting lyrics from the uploaded audio.",
        "synthesizing_voice": "Generating the AI vocal track.",
        "mixing_song": "Mixing AI vocal with the instrumental.",
        "exporting_final_song": "Exporting the final song.",
        "completed": "Final song is ready.",
        "failed": "Music job failed.",
    }
    return messages.get(stage or "", "Music job is processing.")


class MusicRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    audio_ref: str = ""
    prompt: str = ""
    custom_lyrics: Optional[str] = None
    extract_lyrics_only: Optional[bool] = False
    language: Optional[str] = ""
    voice_mode: Optional[str] = "preserve"
    voice_name: Optional[str] = None
    output_format: Optional[str] = "mp3"

    @model_validator(mode="before")
    @classmethod
    def normalize_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        payload = dict(data)

        # Auto-detect audio_ref from multiple keys
        for key in ("audio_ref", "audioRef", "ref", "path", "audio", "audio_url", "url"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                payload["audio_ref"] = val.strip()
                break

        if not payload.get("custom_lyrics") and payload.get("lyrics"):
            payload["custom_lyrics"] = payload["lyrics"]

        if "extract_lyrics_only" not in payload:
            for key in ("extract_lyrics_only", "extractLyricsOnly", "lyrics_only", "extract_only"):
                if key in payload:
                    payload["extract_lyrics_only"] = bool(payload.get(key))
                    break

        if not payload.get("voice_name"):
            for key in ("voice_name", "voiceName", "voice_id", "voiceId"):
                val = payload.get(key)
                if isinstance(val, str) and val.strip():
                    payload["voice_name"] = val.strip()
                    break

        return payload


def get_paths() -> MusicPaths:
    base_dir = Path(__file__).resolve().parents[2]
    static_dir = (base_dir / "static").resolve()

    return MusicPaths(
        static_dir=static_dir,
        uploads_dir=(static_dir / "upload").resolve(),
        jobs_dir=(static_dir / "music_jobs").resolve(),
        outputs_dir=(static_dir / "music_outputs").resolve(),
        temp_dir=(static_dir / "_tmp_music").resolve(),
        sources_dir=(static_dir / "music_sources").resolve(),
        lyrics_dir=(static_dir / "music_lyrics").resolve(),
    )


def _run_music_job_background(paths: MusicPaths, job_id: str) -> None:
    try:
        process_music_job(paths, job_id)
    except Exception as exc:
        update_job(paths, job_id, status="failed", stage="failed", error=str(exc))
        print(f"🔥 BACKGROUND MUSIC JOB FAILED [{job_id}]: {exc}")


@router.post("/run")
def run_music(req: MusicRunRequest):
    paths = get_paths()

    audio_ref = (req.audio_ref or "").strip()

    print("📥 Incoming audio_ref:", audio_ref)

    if not audio_ref:
        raise HTTPException(
            status_code=400,
            detail="audio_ref is required. Example: /static/upload/song.mp3",
        )

    job = create_job(
        paths=paths,
        payload={
            "audio_ref": audio_ref,
            "prompt": req.prompt,
            "custom_lyrics": req.custom_lyrics,
            "extract_lyrics_only": bool(req.extract_lyrics_only),
            "language": (req.language or "").strip(),
            "voice_mode": req.voice_mode,
            "voice_name": req.voice_name,
            "output_format": (req.output_format or "mp3").lower(),
        },
    )

    Thread(
        target=_run_music_job_background,
        args=(paths, job["id"]),
        daemon=True,
    ).start()

    return {
        "job_id": job["id"],
        "status": "processing",
        "stage": "queued",
        "stage_message": _stage_message("queued"),
        "progress": 0,
        "result_ready": False,
        "source_audio_url": job.get("source_audio_url"),
        "output": None,
        "output_url": None,
    }


@router.post("/extract-lyrics")
def extract_lyrics(req: MusicRunRequest):
    req.extract_lyrics_only = True
    return run_music(req)


@router.get("/status/{job_id}")
def music_status(job_id: str):
    paths = get_paths()

    try:
        job = load_job(paths, job_id)
        stage = job.get("stage")
        output_url = job.get("output") or job.get("output_url")
        return {
            "job_id": job["id"],
            "status": job.get("status"),
            "stage": stage,
            "stage_message": _stage_message(stage),
            "progress": job.get("progress", 0),
            "result_ready": bool(output_url) and job.get("status") == "completed",
            "source_audio_url": job.get("source_audio_url"),
            "output": output_url,
            "output_url": job.get("output_url"),
            "lyrics": job.get("lyrics"),
            "lyrics_url": job.get("lyrics_url"),
            "artifacts": job.get("artifacts"),
            "notes": job.get("notes"),
            "error": job.get("error"),
        }
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
