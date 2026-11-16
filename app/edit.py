# app/api/edit.py
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.edit_engine import (
    EditPaths,
    ensure_dirs,
    build_default_plan,
    create_job,
    run_edit_job,
    load_job,
    update_job,
)

router = APIRouter(prefix="/api/edit", tags=["edit"])


# -----------------------------
# REQUEST MODELS
# -----------------------------
class ClipIn(BaseModel):
    id: int = Field(..., description="Clip number like 1,2,3...")
    ref: str = Field(..., description="Local path, /static path, /static URL, or external https URL")


class PlanRequest(BaseModel):
    prompt: str
    clip_ids: List[int]


class RunRequest(BaseModel):
    prompt: str = ""
    plan: Optional[Dict[str, Any]] = None
    clips: List[ClipIn]
    viral_mode: bool = False  # ✅ NEW: simple switch to force Dual Export


# -----------------------------
# PATHS (stable, not dependent on cwd)
# -----------------------------
BASE_DIR = Path(__file__).resolve().parents[2]  # project root
STATIC_DIR = (BASE_DIR / "static").resolve()

paths = EditPaths(
    static_dir=STATIC_DIR,
    uploads_dir=(STATIC_DIR / "uploads"),
    sources_dir=(STATIC_DIR / "source_clips"),
    jobs_dir=(STATIC_DIR / "edit_jobs"),
    outputs_dir=(STATIC_DIR / "videos"),
    temp_dir=(STATIC_DIR / "_tmp_edits"),
)
ensure_dirs(paths)


@router.post("/plan")
def make_plan(req: PlanRequest):
    # MVP: simple default plan; later replace with LLM -> JSON plan
    plan = build_default_plan(req.prompt, req.clip_ids)
    return {"plan": plan}


@router.post("/run")
def run(req: RunRequest):
    # Build plan if not supplied
    clip_ids = [c.id for c in req.clips]
    plan = req.plan or build_default_plan(req.prompt, clip_ids)

    # ✅ Viral Mode override: force dual export (16:9 + 9:16)
    if req.viral_mode:
        plan.setdefault("output", {})
        plan["output"]["dual_export"] = True

    # Store job
    job = create_job(
        paths=paths,
        prompt=req.prompt,
        plan=plan,
        clips=[c.model_dump() for c in req.clips],
    )

    # MVP: run synchronously (blocks request until done)
    try:
        update_job(paths, job["id"], status="running", progress=1)
        job = run_edit_job(paths, job["id"])

        # ✅ Backward compatible + new outputs
        return {
            "job_id": job["id"],
            "status": job["status"],
            "progress": job.get("progress", 0),
            "output_url": job.get("output_url"),
            "outputs": job.get("outputs"),  # ✅ NEW
        }
    except Exception as e:
        update_job(paths, job["id"], status="failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{job_id}")
def status(job_id: str):
    try:
        job = load_job(paths, job_id)
        return {
            "job_id": job["id"],
            "status": job["status"],
            "progress": job.get("progress", 0),
            "output_url": job.get("output_url"),
            "outputs": job.get("outputs"),  # ✅ NEW
            "error": job.get("error"),
        }
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
