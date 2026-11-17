from pathlib import Path
from typing import Any, Dict, List, Optional
from threading import Thread

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict, model_validator

from app.services.edit_engine import (
    EditPaths,
    build_default_plan,
    build_viral_plan,
    build_merge_fast_plan,
    create_job,
    update_job,
    run_edit_job,
    run_multi_edit_job,
    load_job,
)
router = APIRouter(prefix="/api/edit", tags=["edit"])


class ClipRef(BaseModel):
    id: int = Field(..., description="Clip numeric id")
    ref: str = Field(..., description="Local path or /static/... or external URL")


class EditRunRequest(BaseModel):
    prompt: str = Field(..., description="User prompt")
    clips: List[ClipRef] = Field(..., min_length=1)
    plan: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None
    branding: Optional[Dict[str, Any]] = None

class MultiEditRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    prompt: str = ""
    clip_ref: Optional[str] = None
    clips: List[ClipRef] = Field(default_factory=list, max_length=30)
    num_outputs: int = Field(default=1, ge=1, le=3)
    mode: Optional[str] = "viral"
    chunk_seconds: int = Field(default=45, ge=5, le=300)
    max_chunks: int = Field(default=5, ge=1, le=10)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        payload = dict(data)

        if not payload.get("clip_ref"):
            for key in ("ref", "clip", "clip_url", "clipUrl", "video_url", "videoUrl", "source", "source_url"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    payload["clip_ref"] = value
                    break

        if not payload.get("clip_ref"):
            clip_obj = payload.get("clip")
            if isinstance(clip_obj, dict):
                clip_ref = clip_obj.get("ref") or clip_obj.get("clip_ref")
                if isinstance(clip_ref, str) and clip_ref.strip():
                    payload["clip_ref"] = clip_ref

        if payload.get("chunk_seconds") is None and payload.get("chunkSeconds") is not None:
            payload["chunk_seconds"] = payload.get("chunkSeconds")

        if payload.get("max_chunks") is None and payload.get("maxChunks") is not None:
            payload["max_chunks"] = payload.get("maxChunks")

        if not payload.get("mode") and payload.get("viral_mode") is True:
            payload["mode"] = "viral"

        return payload

    @model_validator(mode="after")
    def require_source(self):
        if not self.clips and not self.clip_ref:
            raise ValueError("Provide clips or a source clip_ref")
        if len({clip.id for clip in self.clips}) != len(self.clips):
            raise ValueError("Clip IDs must be unique")
        return self

def get_paths() -> EditPaths:
    base_dir = Path(__file__).resolve().parents[2]
    static_dir = (base_dir / "static").resolve()

    return EditPaths(
        static_dir=static_dir,
        uploads_dir=(static_dir / "uploads").resolve(),
        sources_dir=(static_dir / "source_clips").resolve(),
        jobs_dir=(static_dir / "edit_jobs").resolve(),
        outputs_dir=(static_dir / "videos").resolve(),
        temp_dir=(static_dir / "_tmp_edits").resolve(),
    )


def _is_viral(req: EditRunRequest) -> bool:
    mode = (req.mode or "").strip().lower()
    prompt = (req.prompt or "").strip().lower()
    return mode == "viral" or prompt in ("viral", "viral_mode")


def _normalize_watermark_path(wm: str) -> str:
    wm = (wm or "").strip()
    if not wm:
        return "static/branding/pcgh_logo.png"
    return wm


def _run_job_background(paths: EditPaths, job_id: str) -> None:
    try:
        run_edit_job(paths, job_id)
    except Exception as e:
        update_job(paths, job_id, status="failed", stage="failed", error="This edit did not finish. Check the source clips and try again.")
        print(f"BACKGROUND JOB FAILED [{job_id}]: {e}")


def _run_multi_job_background(
    paths: EditPaths,
    job_id: str,
    req: MultiEditRunRequest,
) -> None:
    try:
        if req.clips:
            # Multi-clip editing is distinct from extracting highlights from one long source.
            results = []
            clip_ids = [clip.id for clip in req.clips]
            styles = ["clean", "crossfade", "punch-in"]
            start = styles.index(req.mode) if req.mode in styles else 0
            for index in range(req.num_outputs):
                style = styles[(start + index) % 3]
                plan = build_merge_fast_plan(clip_ids)
                plan["output"].update({"resolution": "720p", "fps": 24})
                plan["audio"]["normalize"] = False  # Silent animatics must not enter loudnorm.
                if style == "crossfade":
                    plan["transitions"] = {"type": "crossfade", "duration": 0.25}
                elif style == "punch-in":
                    plan["camera"] = {"punch_in": True, "strength": 1.04}
                plan["prompt"] = req.prompt
                child = create_job(paths, req.prompt, plan, [clip.model_dump() for clip in req.clips])
                try:
                    done = run_edit_job(paths, child["id"])
                except Exception as exc:
                    update_job(paths, child["id"], status="failed", stage="failed", error=str(exc))
                    raise
                results.append({"job_id": done["id"], "output_url": done["output_url"],
                                "preset": {"clean": "clean cut", "crossfade": "crossfade", "punch-in": "subtle punch-in"}[style]})
                update_job(paths, job_id, status="running", stage="editing_variants",
                           progress=int((index+1)/req.num_outputs*95), outputs=results)
            update_job(paths, job_id, status="succeeded", stage="completed", progress=100,
                       output_url=results[0]["output_url"], outputs=results)
            return
        run_multi_edit_job(
            paths=paths,
            src_ref=req.clip_ref or "",
            prompt=req.prompt,
            mode=req.mode or "viral",
            chunk_seconds=int(req.chunk_seconds or 45),
            max_chunks=int(req.max_chunks or 5),
            job_id=job_id,
        )
    except Exception as e:
        update_job(paths, job_id, status="failed", stage="failed", error="This edit did not finish. Check the source clips and try again.")
        print(f"BACKGROUND MULTI JOB FAILED [{job_id}]: {e}")

@router.post("/run-multi")
def run_multi_edit(req: MultiEditRunRequest):
    try:
        paths = get_paths()
        job = create_job(
            paths=paths,
            prompt=req.prompt,
            plan={
                "type": "multi_edit",
                "mode": req.mode or "viral",
                "chunk_seconds": int(req.chunk_seconds or 45),
                "max_chunks": int(req.max_chunks or 5),
            },
            clips=[clip.model_dump() for clip in req.clips] or [{"id": 1, "ref": req.clip_ref}],
        )

        Thread(
            target=_run_multi_job_background,
            args=(paths, job["id"], req),
            daemon=True,
        ).start()

        return {
            "job_id": job["id"],
            "status": "processing",
            "stage": "queued",
            "progress": 0,
            "output": None,
            "output_url": None,
            "outputs": [],
            "error": None,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/run")
def run_edit(req: EditRunRequest):
    try:
        paths = get_paths()

        clip_dicts = [{"id": c.id, "ref": c.ref} for c in req.clips]
        clip_ids = [c.id for c in req.clips]

        if isinstance(req.plan, dict) and req.plan:
            plan = req.plan
        else:
            prompt_lc = (req.prompt or "").strip().lower()

            if prompt_lc == "merge_fast":
                plan = build_merge_fast_plan(clip_ids)

            elif _is_viral(req):
                wm = _normalize_watermark_path(
                    (req.branding or {}).get("watermark_path", "static/branding/pcgh_logo.png")
                )
                plan = build_viral_plan(
                    clip_ids=clip_ids,
                    watermark_path=wm,
                )

            else:
                plan = build_default_plan(req.prompt, clip_ids)

        job_prompt = "viral_mode" if _is_viral(req) else req.prompt

        job = create_job(paths, prompt=job_prompt, plan=plan, clips=clip_dicts)

        Thread(
            target=_run_job_background,
            args=(paths, job["id"]),
            daemon=True,
        ).start()

        return {
            "job_id": job["id"],
            "status": "processing",
            "progress": 0,
            "output": None,
            "output_url": None,
            "outputs": None,
            "error": None,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/status/{job_id}")
def status(job_id: str):
    try:
        paths = get_paths()
        job = load_job(paths, job_id)

        return {
            "job_id": job["id"],
            "status": job["status"],
            "stage": job.get("stage"),
            "progress": job.get("progress", 0),
            "output": job.get("output") or job.get("output_url"),
            "output_url": job.get("output_url"),
            "outputs": job.get("outputs"),
            "error": job.get("error"),
        }
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
