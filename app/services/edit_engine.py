import os
import json
import uuid
import shutil
import subprocess
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

import requests

from app.services.ai_engine import ensure_srt_for_job, generate_hook_from_srt
from app.services.job_files import write_json_atomic


DEFAULT_MAX_DOWNLOAD_MB = 300
DEFAULT_TIMEOUT = 45

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
TEXT_SAFE_MAX = 2000


@dataclass
class EditPaths:
    static_dir: Path
    uploads_dir: Path
    sources_dir: Path
    jobs_dir: Path
    outputs_dir: Path
    temp_dir: Path


def ensure_dirs(paths: EditPaths) -> None:
    paths.uploads_dir.mkdir(parents=True, exist_ok=True)
    paths.sources_dir.mkdir(parents=True, exist_ok=True)
    paths.jobs_dir.mkdir(parents=True, exist_ok=True)
    paths.outputs_dir.mkdir(parents=True, exist_ok=True)
    paths.temp_dir.mkdir(parents=True, exist_ok=True)


# -----------------------------
# JOB STORE
# -----------------------------
def job_path(paths: EditPaths, job_id: str) -> Path:
    return paths.jobs_dir / f"{job_id}.json"


def load_job(paths: EditPaths, job_id: str) -> Dict[str, Any]:
    p = job_path(paths, job_id)
    if not p.exists():
        raise FileNotFoundError("Job not found")
    return json.loads(p.read_text(encoding="utf-8"))


def save_job(paths: EditPaths, job: Dict[str, Any]) -> None:
    p = job_path(paths, job["id"])
    write_json_atomic(p, job)


def update_job(paths: EditPaths, job_id: str, **updates) -> Dict[str, Any]:
    job = load_job(paths, job_id)
    job.update(updates)
    save_job(paths, job)
    return job


def create_job(paths: EditPaths, prompt: str, plan: Dict[str, Any], clips: List[Dict[str, Any]]) -> Dict[str, Any]:
    ensure_dirs(paths)
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "prompt": prompt,
        "plan": plan,
        "clips": clips,
        "output": None,
        "output_url": None,
        "outputs": None,
        "error": None,
    }
    save_job(paths, job)
    return job


# -----------------------------
# UTIL
# -----------------------------
def is_url(s: str) -> bool:
    try:
        u = urlparse(s)
        return u.scheme in ("http", "https")
    except Exception:
        return False


def _run_ffmpeg(cmd: List[str]) -> None:
    # Bound CPU/memory and runtime for the small pilot instance.
    cmd = cmd[:1] + ["-filter_threads", "2", "-filter_complex_threads", "2"] + cmd[1:-1] + ["-threads", "2"] + cmd[-1:]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=900)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed:\n{proc.stderr[-4000:]}")


def _ffprobe_duration_seconds(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    try:
        return float(out)
    except Exception:
        return 0.0

def split_video_into_chunks(
    paths: EditPaths,
    src: Path,
    job_id: str,
    chunk_seconds: int = 45,
) -> List[Path]:
    """
    Split one long video into fixed-duration chunks.
    Returns list of chunk file paths.
    """
    ensure_dirs(paths)

    duration = _ffprobe_duration_seconds(src)
    if duration <= 0:
        raise ValueError("Could not determine video duration")

    out_dir = paths.temp_dir / f"{job_id}_chunks"
    out_dir.mkdir(parents=True, exist_ok=True)

    chunks: List[Path] = []
    start = 0.0
    idx = 1

    while start < duration:
        out_path = out_dir / f"chunk_{idx:03d}.mp4"
        dur = min(float(chunk_seconds), max(0.01, duration - start))

        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", str(start),
            "-i", str(src),
            "-t", str(dur),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "2",
            "-movflags", "+faststart",
            str(out_path),
        ]
        _run_ffmpeg(cmd)

        if out_path.exists() and out_path.stat().st_size > 0:
            chunks.append(out_path)

        start += chunk_seconds
        idx += 1

    if not chunks:
        raise RuntimeError("No chunks were created from the source video")

    return chunks

def _chunk_has_enough_speech(
    chunk_path: Path,
    min_speech_seconds: float = 6.0,
) -> bool:
    """
    Uses ffmpeg silencedetect to estimate whether a chunk has enough speech/audio activity.
    Simple MVP filter: keeps chunks that are not mostly silence.
    """
    duration = _ffprobe_duration_seconds(chunk_path)
    if duration <= 0:
        return False

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "info",
        "-i", str(chunk_path),
        "-af", "silencedetect=noise=-35dB:d=0.35",
        "-f", "null",
        "-",
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    log = proc.stderr or ""

    silence_total = 0.0
    current_start = None

    for line in log.splitlines():
        m1 = _SILENCE_START_RE.search(line)
        if m1:
            current_start = float(m1.group(1))
            continue

        m2 = _SILENCE_END_RE.search(line)
        if m2 and current_start is not None:
            silence_end = float(m2.group(1))
            silence_total += max(0.0, silence_end - current_start)
            current_start = None

    speech_estimate = max(0.0, duration - silence_total)
    return speech_estimate >= float(min_speech_seconds)

def _score_chunk_transcript(
    chunk_path: Path,
    language: str = "en",
) -> float:
    """
    Score a chunk using transcript richness.
    Higher score = more likely useful spoken content.
    """
    try:
        from app.services.ai_engine import get_whisper_model, _clean_caption_text

        model = get_whisper_model()

        segments, info = model.transcribe(
            str(chunk_path),
            language=language if language else None,
            vad_filter=True,
            word_timestamps=False,
            condition_on_previous_text=False,
            temperature=0.0,
        )

        total_words = 0
        total_chars = 0
        segment_count = 0

        for seg in segments:
            text = _clean_caption_text(seg.text)
            if not text:
                continue

            words = [w for w in text.split() if w.strip()]
            total_words += len(words)
            total_chars += len(text)
            segment_count += 1

        duration = _ffprobe_duration_seconds(chunk_path)
        if duration <= 0:
            return 0.0

        words_per_second = total_words / duration
        chars_per_second = total_chars / duration

        # weighted score
        score = (
            total_words * 1.5
            + total_chars * 0.08
            + segment_count * 2.0
            + words_per_second * 25.0
            + chars_per_second * 8.0
        )

        return float(score)

    except Exception as e:
        print(f"TRANSCRIPT SCORE ERROR [{chunk_path}]: {e}")
        return 0.0

def _score_chunk_hookiness(
    chunk_path: Path,
    language: str = "en",
) -> float:
    """
    Score a chunk by presence of hook-like transcript phrases.
    """

    HOOK_PHRASES = [
        "wait",
        "listen",
        "look",
        "okay",
        "now",
        "here's the thing",
        "the truth is",
        "what happened",
        "what happened was",
        "let me show you",
        "let me tell you",
        "this is why",
        "the reason is",
        "you won't believe",
        "you will not believe",
        "guess what",
        "the problem is",
        "the crazy part",
        "the interesting part",
        "watch this",
        "pay attention",
        "so basically",
        "in fact",
        "but here's the thing",
    ]

    try:
        from app.services.ai_engine import get_whisper_model, _clean_caption_text

        model = get_whisper_model()

        segments, info = model.transcribe(
            str(chunk_path),
            language=language if language else None,
            vad_filter=True,
            word_timestamps=False,
            condition_on_previous_text=False,
            temperature=0.0,
        )

        text_parts = []
        for seg in segments:
            txt = _clean_caption_text(seg.text).lower()
            if txt:
                text_parts.append(txt)

        full_text = " ".join(text_parts)

        if not full_text:
            return 0.0

        score = 0.0

        # hook phrase scoring
        for phrase in HOOK_PHRASES:
            if phrase in full_text:
                score += 20

        # question hooks
        question_words = ["why", "how", "what", "when", "who"]
        for q in question_words:
            if q + " " in full_text:
                score += 6

        # early hook bonus
        first_160 = full_text[:160]
        for phrase in HOOK_PHRASES:
            if phrase in first_160:
                score += 10

        return score

    except Exception as e:
        print(f"HOOK SCORE ERROR [{chunk_path}]: {e}")
        return 0.0
        
def _score_chunk_emotion(
    chunk_path: Path,
    language: str = "en",
) -> float:
    """
    Score a chunk by emotional / high-interest language.
    """

    EMOTION_WORDS = [
        "crazy", "shocking", "unbelievable", "amazing", "serious",
        "important", "dangerous", "powerful", "painful", "hard",
        "difficult", "massive", "huge", "big", "deep", "truth",
        "secret", "warning", "mistake", "problem", "risk",
        "fear", "angry", "upset", "excited", "surprised", "wow",
        "finally", "suddenly", "immediately", "actually", "honestly",
        "listen", "attention", "must", "need", "never", "always"
    ]

    EMOTION_PHRASES = [
        "i was shocked",
        "this changed everything",
        "this is serious",
        "you need to hear this",
        "this is important",
        "i could not believe",
        "this is crazy",
        "this is dangerous",
        "that was the mistake",
        "this is the truth",
        "here is the secret",
        "this is the problem",
        "what surprised me",
        "what scared me",
        "the crazy part is",
        "the truth is",
    ]

    try:
        from app.services.ai_engine import get_whisper_model, _clean_caption_text

        model = get_whisper_model()

        segments, info = model.transcribe(
            str(chunk_path),
            language=language if language else None,
            vad_filter=True,
            word_timestamps=False,
            condition_on_previous_text=False,
            temperature=0.0,
        )

        text_parts = []
        for seg in segments:
            txt = _clean_caption_text(seg.text).lower()
            if txt:
                text_parts.append(txt)

        full_text = " ".join(text_parts).strip()
        if not full_text:
            return 0.0

        score = 0.0

        words = full_text.split()
        for w in words:
            clean_w = re.sub(r"[^a-z0-9']", "", w)
            if clean_w in EMOTION_WORDS:
                score += 4.0

        for phrase in EMOTION_PHRASES:
            if phrase in full_text:
                score += 18.0

        # stronger early-emotion bonus
        first_180 = full_text[:180]
        for phrase in EMOTION_PHRASES:
            if phrase in first_180:
                score += 8.0

        return score

    except Exception as e:
        print(f"EMOTION SCORE ERROR [{chunk_path}]: {e}")
        return 0.0
    
def _score_chunk_speech_density(chunk_path: Path) -> float:
    """
    Score a chunk by estimated speech density.
    Higher score = more useful speaking content.
    """
    duration = _ffprobe_duration_seconds(chunk_path)
    if duration <= 0:
        return 0.0

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "info",
        "-i", str(chunk_path),
        "-af", "silencedetect=noise=-35dB:d=0.35",
        "-f", "null",
        "-",
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    log = proc.stderr or ""

    silence_total = 0.0
    current_start = None

    for line in log.splitlines():
        m1 = _SILENCE_START_RE.search(line)
        if m1:
            current_start = float(m1.group(1))
            continue

        m2 = _SILENCE_END_RE.search(line)
        if m2 and current_start is not None:
            silence_end = float(m2.group(1))
            silence_total += max(0.0, silence_end - current_start)
            current_start = None

    speech_estimate = max(0.0, duration - silence_total)

    # density ratio + absolute speech time
    density = speech_estimate / duration if duration > 0 else 0.0
    score = (density * 100.0) + speech_estimate
    return score
    
    
def run_multi_edit_job(
    paths: EditPaths,
    src_ref: str,
    prompt: str,
    mode: str = "viral",
    chunk_seconds: int = 45,
    max_chunks: int = 5,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Split one long video into chunks, rank them, filter weak ones,
    run Clayme edit on the selected chunks, and return all outputs together.
    """
    ensure_dirs(paths)

    parent_job_id = job_id or uuid.uuid4().hex
    allowed_roots = [
        paths.static_dir,
        paths.uploads_dir,
        paths.sources_dir,
        paths.temp_dir,
        paths.outputs_dir,
    ]

    try:
        update_job(
            paths,
            parent_job_id,
            status="running",
            progress=5,
            stage="resolving_source",
        )

        src = resolve_clip_to_local(paths, src_ref, allowed_roots)
        if not src:
            raise RuntimeError(f"Could not resolve video path: {src_ref}")

        update_job(
            paths,
            parent_job_id,
            progress=15,
            stage="splitting_video",
        )

        chunks = split_video_into_chunks(
            paths=paths,
            src=src,
            job_id=parent_job_id,
            chunk_seconds=int(chunk_seconds),
        )

        update_job(
            paths,
            parent_job_id,
            progress=30,
            stage="ranking_chunks",
        )

        scored_chunks: List[tuple[Path, float]] = []

        for ch in chunks:
            if _chunk_has_enough_speech(ch, min_speech_seconds=6.0):
                speech_score = _score_chunk_speech_density(ch)
                transcript_score = _score_chunk_transcript(ch, language="en")
                hook_score = _score_chunk_hookiness(ch, language="en")
                emotion_score = _score_chunk_emotion(ch, language="en")

                total_score = speech_score + transcript_score + hook_score + emotion_score
                scored_chunks.append((ch, total_score))

        if not scored_chunks:
            raise RuntimeError("No useful speech-heavy chunks found in the video")

        scored_chunks.sort(key=lambda x: x[1], reverse=True)

        print(
            f"[MULTI {parent_job_id}] RANKED CHUNKS: "
            f"{[(p.name, round(s, 2)) for p, s in scored_chunks]}"
        )

        MIN_SCORE_THRESHOLD = 350.0
        filtered_chunks = [(p, s) for (p, s) in scored_chunks if s >= MIN_SCORE_THRESHOLD]

        if not filtered_chunks and scored_chunks:
            filtered_chunks = [scored_chunks[0]]

        print(
            f"[MULTI {parent_job_id}] FILTERED CHUNKS: "
            f"{[(p.name, round(s, 2)) for p, s in filtered_chunks]}"
        )

        if max_chunks and max_chunks > 0:
            selected_chunks = filtered_chunks[:max_chunks]
        else:
            selected_chunks = filtered_chunks

        update_job(
            paths,
            parent_job_id,
            progress=40,
            stage="processing_chunks",
            outputs=[],
        )

        results: List[Dict[str, Any]] = []
        total_selected = max(1, len(selected_chunks))

        for idx, (chunk_path, score) in enumerate(selected_chunks, start=1):
            print(f"[MULTI {parent_job_id}] Processing chunk {idx}: {chunk_path}")

            clip_id = 1
            clip_dicts = [{"id": clip_id, "ref": str(chunk_path)}]

            if str(mode).lower().strip() == "viral" or str(prompt).lower().strip() in ("viral", "viral_mode"):
                plan = build_viral_plan(
                    clip_ids=[clip_id],
                    watermark_path="static/branding/pcgh_logo.png",
                )

                plan["pacing"]["remove_silence"] = False
                plan["subtitles"]["burn"] = False
                plan["subtitles"]["auto"] = False
                plan["camera"]["punch_in"] = False

                plan["overlays"] = [
                    ov for ov in plan.get("overlays", [])
                    if str(ov.get("type", "")).lower() != "text"
                ]
            else:
                plan = build_default_plan(prompt, [clip_id])

            child_prompt = "viral_mode" if str(mode).lower().strip() == "viral" else prompt

            child_job = create_job(
                paths=paths,
                prompt=child_prompt,
                plan=plan,
                clips=clip_dicts,
            )

            done = run_edit_job(paths, child_job["id"])
            if not done:
                raise RuntimeError(f"Chunk {idx} returned no result from run_edit_job")

            results.append({
                "index": idx,
                "score": round(score, 2),
                "source_chunk": chunk_path.name,
                "job_id": done.get("id"),
                "status": done.get("status"),
                "stage": done.get("stage"),
                "progress": done.get("progress", 0),
                "output": done.get("output") or done.get("output_url"),
                "output_url": done.get("output_url"),
                "outputs": done.get("outputs"),
                "error": done.get("error"),
            })

            progress = 40 + int(55 * (idx / total_selected))
            update_job(
                paths,
                parent_job_id,
                progress=progress,
                stage="processing_chunks",
                outputs=results,
            )

        return update_job(
            paths,
            parent_job_id,
            status="succeeded",
            progress=100,
            stage="completed",
            output=results[0].get("output_url") if results else None,
            output_url=results[0].get("output_url") if results else None,
            outputs=results,
            count=len(results),
        )
    except Exception as e:
        update_job(
            paths,
            parent_job_id,
            status="failed",
            stage="failed",
            error=str(e),
        )
        raise
def _has_audio_stream(src: Path) -> bool:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a",
                "-show_entries", "stream=index",
                "-of", "csv=p=0",
                str(src),
            ],
            text=True,
        ).strip()
        return bool(out)
    except Exception:
        return False


def _to_static_url(paths: EditPaths, disk_path: Path) -> str:
    rel = disk_path.resolve().relative_to(paths.static_dir.resolve())
    return f"/static/{rel.as_posix()}"


def _validate_local_video_path(p: Path, allowed_roots: List[Path]) -> None:
    if not p.exists() or not p.is_file():
        raise ValueError(f"Video not found: {p}")
    if p.suffix.lower() not in VIDEO_EXTS:
        raise ValueError(f"Unsupported video extension: {p.suffix}")

    rp = p.resolve()
    ok = any(
        str(rp).startswith(str(root.resolve()) + os.sep) or rp == root.resolve()
        for root in allowed_roots
    )
    if not ok:
        raise ValueError("Invalid path: outside allowed storage directories")


def _validate_local_image_path(p: Path, allowed_roots: List[Path]) -> None:
    if not p.exists() or not p.is_file():
        raise ValueError(f"Image not found: {p}")
    if p.suffix.lower() not in IMAGE_EXTS:
        raise ValueError(f"Unsupported image extension: {p.suffix}")

    rp = p.resolve()
    ok = any(
        str(rp).startswith(str(root.resolve()) + os.sep) or rp == root.resolve()
        for root in allowed_roots
    )
    if not ok:
        raise ValueError("Invalid image path: outside allowed storage directories")


# -----------------------------
# DOWNLOAD / RESOLVE
# -----------------------------
def download_clip_to_local(
    paths: EditPaths,
    url: str,
    max_mb: int = DEFAULT_MAX_DOWNLOAD_MB,
    timeout: int = DEFAULT_TIMEOUT,
) -> Path:
    ensure_dirs(paths)
    dest = paths.sources_dir / f"{uuid.uuid4().hex}.mp4"

    max_bytes = int(max_mb) * 1024 * 1024
    with requests.get(url, stream=True, timeout=timeout, headers={"User-Agent": "ClaymeEditEngine/1.0"}) as r:
        r.raise_for_status()
        size = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > max_bytes:
                    f.close()
                    dest.unlink(missing_ok=True)
                    raise ValueError(f"File too large (> {max_mb}MB)")
                f.write(chunk)

    _ = _ffprobe_duration_seconds(dest)
    if dest.stat().st_size < 50_000:
        dest.unlink(missing_ok=True)
        raise ValueError("Downloaded file seems invalid/too small")

    return dest


def resolve_clip_to_local(paths: EditPaths, clip_ref: str, allowed_roots: List[Path]) -> Path:
    ensure_dirs(paths)

    if isinstance(clip_ref, str) and clip_ref.startswith("/static/"):
        rel = clip_ref.split("/static/", 1)[1]
        candidate = (paths.static_dir / rel).resolve()
        _validate_local_video_path(candidate, allowed_roots)
        return candidate

    if is_url(clip_ref):
        u = urlparse(clip_ref)
        if "/static/" in u.path:
            rel = u.path.split("/static/", 1)[1]
            candidate = (paths.static_dir / rel).resolve()
            _validate_local_video_path(candidate, allowed_roots)
            return candidate
        return download_clip_to_local(paths, clip_ref)

    p = Path(clip_ref)

    if not p.is_absolute():
        s = str(clip_ref).replace("\\", "/")

        if s.startswith("static/"):
            p = (paths.static_dir.parent / s).resolve()
        elif s.startswith(("videos/", "uploads/", "source_clips/", "edit_jobs/", "_tmp_edits/")):
            p = (paths.static_dir / s).resolve()
        else:
            p = (Path.cwd() / p).resolve()

    _validate_local_video_path(p, allowed_roots)
    return p


def resolve_image_to_local(paths: EditPaths, img_ref: str, allowed_roots: List[Path]) -> Path:
    if is_url(img_ref):
        raise ValueError("Watermark image must be a local path or /static/... reference")

    p = Path(img_ref)
    if not p.is_absolute():
        s = str(img_ref).replace("\\", "/")
        if s.startswith("/static/"):
            rel = s.split("/static/", 1)[1]
            p = (paths.static_dir / rel).resolve()
        elif s.startswith("static/"):
            p = (paths.static_dir.parent / s).resolve()
        else:
            p = (Path.cwd() / p).resolve()

    _validate_local_image_path(p, allowed_roots)
    return p


def _resolve_subtitle_to_local(paths: EditPaths, srt_path: str, allowed_roots: List[Path]) -> Path:
    if not srt_path:
        raise ValueError("Missing srt_path")

    sp = Path(srt_path)

    if str(srt_path).startswith("/static/"):
        rel = str(srt_path).split("/static/", 1)[1]
        sp = (paths.static_dir / rel).resolve()
    elif not sp.is_absolute():
        s = str(srt_path).replace("\\", "/")
        if s.startswith("static/"):
            sp = (paths.static_dir.parent / s).resolve()
        else:
            sp = (Path.cwd() / sp).resolve()

    rp = sp.resolve()
    ok = any(
        str(rp).startswith(str(root.resolve()) + os.sep) or rp == root.resolve()
        for root in allowed_roots
    )
    if not ok or not rp.exists():
        raise ValueError(f"Invalid subtitles path: {rp}")

    return rp


# -----------------------------
# PLANS
# -----------------------------
def build_default_plan(prompt: str, clip_ids: List[int]) -> Dict[str, Any]:
    return {
        "order": clip_ids,
        "timeline": [{"clip": cid} for cid in clip_ids],
        "audio": {"normalize": True},
        "output": {
            "resolution": "1080p",
            "fps": 30,
            "format": "mp4",
            "dual_export": False,
        },
        "transitions": {"type": "none"},
        "overlays": [],
        "subtitles": None,
        "prompt": prompt,
        "version": 1,
    }

def build_viral_plan(clip_ids: List[int], watermark_path: str) -> Dict[str, Any]:
    return {
        "order": clip_ids,
        "timeline": [{"clip": cid, "speed": 1.03} for cid in clip_ids],
        "audio": {"normalize": True},
        "output": {
            "resolution": "1080p",
            "fps": 30,
            "format": "mp4",
            "dual_export": True,
        },
        "pacing": {
            "remove_silence": True,
            "silence_db": -35,
            "min_silence": 0.25,
            "keep_padding": 0.08,
        },
        "transitions": {"type": "crossfade", "duration": 0.35},
        "overlays": [
            {
                "type": "text",
                "text": "WAIT FOR IT… 👀",
                "start": 0,
                "end": 8.0,
                "x": "(w-text_w)/2",
                "y": "h*0.18",
                "fontsize": 78,
                "fontcolor": "white",
                "box": True,
                "boxcolor": "black@0.55",
            },
            {
                "type": "text",
                "text": "PCGH x CLAYME",
                "start": 0,
                "end": 2,
                "x": "(w-text_w)/2",
                "y": "h*0.10",
                "fontsize": 56,
                "fontcolor": "white",
                "box": True,
                "boxcolor": "black@0.45",
            },
            {
                "type": "watermark",
                "path": watermark_path,
                "opacity": 0.60,
                "width": 180,
                "x": "w-overlay_w-40",
                "y": "h-overlay_h-40",
            },
        ],
        "camera": {
            "punch_in": True,
            "strength": 1.06,
            "start": 0.0,
            "end": None,
        },
        "subtitles": {
            "burn": True,
            "auto": True,
            "lang": "en",
            "model": "small",
        },
        "prompt": "viral_mode",
        "version": 1,
    }

def build_merge_fast_plan(clip_ids: List[int]) -> Dict[str, Any]:
    return {
        "order": clip_ids,
        "timeline": [{"clip": cid} for cid in clip_ids],
        "audio": {"normalize": True},
        "output": {
            "resolution": "1080p",
            "fps": 30,
            "format": "mp4",
            "dual_export": False,
        },
        "transitions": {"type": "none"},
        "pacing": {
            "remove_silence": False,
        },
        "camera": {
            "punch_in": False,
        },
        "overlays": [],
        "subtitles": {
            "burn": False,
            "auto": False,
        },
        "prompt": "merge_fast",
        "version": 1,
    }
# -----------------------------
# NORMALIZE / CONCAT
# -----------------------------
def _chain_atempo(speed: float) -> str:
    if speed <= 0:
        return ""
    parts = []
    s = float(speed)
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        parts.append("atempo=0.5")
        s /= 0.5
    parts.append(f"atempo={s}")
    return ",".join(parts)


def _norm_clip(
    paths: EditPaths,
    src: Path,
    out: Path,
    resolution: str = "1080p",
    fps: int = 30,
    trim: Optional[Dict[str, float]] = None,
    speed: Optional[float] = None,
    color: Optional[Dict[str, float]] = None,
    audio_normalize: bool = True,
) -> None:
    ensure_dirs(paths)

    # Fixed output canvas size so all clips match exactly for concat / xfade
    if resolution == "1080p":
        target_w, target_h = 1920, 1080
    elif resolution == "720p":
        target_w, target_h = 1280, 720
    elif resolution == "4k":
        target_w, target_h = 3840, 2160
    else:
        target_w, target_h = 1920, 1080

    vf_parts: List[str] = [
        f"scale=w={target_w}:h={target_h}:force_original_aspect_ratio=decrease",
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2",
        f"fps={int(fps)}",
    ]

    # Optional color adjustments
    if isinstance(color, dict):
        b = float(color.get("brightness", 0.0))
        c = float(color.get("contrast", 1.0))
        s = float(color.get("saturation", 1.0))
        vf_parts.append(f"eq=brightness={b}:contrast={c}:saturation={s}")

    # Optional speed (video)
    if speed is not None and float(speed) > 0:
        sp = float(speed)
        vf_parts.append(f"setpts=PTS/{sp}")

    vf = ",".join(vf_parts)

    # Audio filters
    af_parts: List[str] = []

    # Optional speed (audio)
    if speed is not None and float(speed) > 0:
        at = _chain_atempo(float(speed))
        if at:
            af_parts.append(at)

    if audio_normalize:
        af_parts.append("loudnorm=I=-16:LRA=11:TP=-1.5")

    af = ",".join(af_parts) if af_parts else None

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]

    # Optional trim start
    if trim and "start" in trim:
        cmd += ["-ss", str(float(trim["start"]))]

    cmd += ["-i", str(src)]

    # Optional trim end
    if trim and "end" in trim:
        start = float(trim.get("start", 0.0))
        end = float(trim["end"])
        dur = max(0.01, end - start)
        cmd += ["-t", str(dur)]

    has_audio = _has_audio_stream(src)

    if not has_audio:
        # Add silent audio if none exists
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        cmd += ["-vf", vf]
        if af:
            cmd += ["-af", af]
        cmd += [
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "2",
            "-movflags", "+faststart",
            str(out),
        ]
    else:
        cmd += ["-vf", vf]
        if af:
            cmd += ["-af", af]
        cmd += [
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "2",
            "-movflags", "+faststart",
            str(out),
        ]

    _run_ffmpeg(cmd)


def _concat_simple(norm_paths: List[Path], out: Path) -> None:
    if not norm_paths:
        raise ValueError("No clips to concatenate")

    if len(norm_paths) == 1:
        shutil.copyfile(norm_paths[0], out)
        return

    list_file = out.parent / f"{out.stem}_concat.txt"

    lines = []
    for p in norm_paths:
        safe_path = str(p.resolve()).replace("'", r"'\''")
        lines.append(f"file '{safe_path}'")

    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_file),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out),
    ]
    _run_ffmpeg(cmd)
    list_file.unlink(missing_ok=True)

def _concat_with_crossfade(norm_paths: List[Path], out: Path, duration: float = 0.5) -> None:
    if len(norm_paths) == 1:
        shutil.copyfile(norm_paths[0], out)
        return

    durs = [_ffprobe_duration_seconds(p) for p in norm_paths]

    offsets = []
    acc = 0.0
    for i in range(len(norm_paths) - 1):
        acc += durs[i]
        offsets.append(max(0.0, acc - duration * (i + 1)))

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for p in norm_paths:
        cmd += ["-i", str(p)]

    filter_lines = []
    v_prev = "[0:v]"
    a_prev = "[0:a]"

    for i in range(1, len(norm_paths)):
        v_in = f"[{i}:v]"
        a_in = f"[{i}:a]"
        v_out = f"[v{i}]"
        a_out = f"[a{i}]"
        off = offsets[i - 1]

        filter_lines.append(
            f"{v_prev}{v_in}xfade=transition=fade:duration={duration}:offset={off}{v_out}"
        )
        filter_lines.append(
            f"{a_prev}{a_in}acrossfade=d={duration}{a_out}"
        )

        v_prev = v_out
        a_prev = a_out

    filter_complex = ";".join(filter_lines)

    cmd += [
        "-filter_complex", filter_complex,
        "-map", v_prev,
        "-map", a_prev,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out),
    ]
    _run_ffmpeg(cmd)


# -----------------------------
# VIRAL CAMERA
# -----------------------------
def _apply_punch_in_zoom(
    src: Path,
    out: Path,
    strength: float = 1.06,
    start: float = 0.0,
    end: Optional[float] = None,
) -> None:
    # A bounded, static center crop gives a subtle punch-in without zoompan loops.
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(src)], capture_output=True, text=True, check=True, timeout=30)
    stream = json.loads(probe.stdout)["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    factor = max(1.01, min(float(strength), 1.15))
    crop_width = max(2, int(width / factor) // 2 * 2)
    crop_height = max(2, int(height / factor) // 2 * 2)
    vf = f"crop={crop_width}:{crop_height}:(iw-ow)/2:(ih-oh)/2,scale={width}:{height}"
    _run_ffmpeg(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf", vf, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(out)])


# -----------------------------
# OVERLAYS
# -----------------------------
def _escape_drawtext_text(s: str) -> str:
    s = s[:TEXT_SAFE_MAX]
    s = s.replace("\\", "\\\\")
    s = s.replace(":", "\\:")
    s = s.replace("'", "\\'")
    s = s.replace("\n", "\\n")
    return s


def _apply_overlays_and_subtitles(
    paths: EditPaths,
    src_video: Path,
    out_video: Path,
    overlays: List[Dict[str, Any]],
    subtitles: Optional[Dict[str, Any]],
    allowed_roots: List[Path],
) -> None:
    overlays = overlays or []
    subtitles = subtitles or {}

    burn_subs = bool(subtitles.get("burn", False))
    srt_path = subtitles.get("srt_path")

    if not overlays and not (burn_subs and srt_path):
        shutil.copyfile(src_video, out_video)
        return

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src_video)]
    filter_parts: List[str] = []
    inputs_for_filter_complex = 1

    watermark_items = [ov for ov in overlays if str(ov.get("type", "")).lower() in ("watermark", "logo", "image")]
    text_items = [ov for ov in overlays if str(ov.get("type", "")).lower() in ("text", "caption")]

    current_v = "[0:v]"

    for idx, ov in enumerate(text_items, start=1):
        text = _escape_drawtext_text(str(ov.get("text", "")))
        if not text:
            continue

        start = ov.get("start", None)
        end = ov.get("end", None)
        x = str(ov.get("x", "(w-text_w)/2"))
        y = str(ov.get("y", "h*0.12"))
        fontsize = int(ov.get("fontsize", 48))
        fontcolor = str(ov.get("fontcolor", "white"))
        box = bool(ov.get("box", False))
        boxcolor = str(ov.get("boxcolor", "black@0.4"))

        enable = ""
        if start is not None and end is not None:
            enable = f":enable='between(t,{float(start)},{float(end)})'"
        elif start is not None:
            enable = f":enable='gte(t,{float(start)})'"
        elif end is not None:
            enable = f":enable='lte(t,{float(end)})'"

        box_part = f":box=1:boxcolor={boxcolor}" if box else ":box=0"

        filter_parts.append(
            f"{current_v}drawtext=text='{text}':fontsize={fontsize}:fontcolor={fontcolor}:x={x}:y={y}"
            f"{box_part}{enable}[vtxt{idx}]"
        )
        current_v = f"[vtxt{idx}]"

    for idx, ov in enumerate(watermark_items, start=1):
        img_ref = ov.get("path") or ov.get("ref")
        if not img_ref:
            continue

        img_str = str(img_ref)
        if img_str.startswith("/static/"):
            rel = img_str.split("/static/", 1)[1]
            img_path = (paths.static_dir / rel).resolve()
            _validate_local_image_path(img_path, allowed_roots)
        else:
            img_path = resolve_image_to_local(paths, img_str, allowed_roots)

        cmd += ["-i", str(img_path)]
        img_in_index = inputs_for_filter_complex
        inputs_for_filter_complex += 1

        start = ov.get("start", None)
        end = ov.get("end", None)
        x = str(ov.get("x", "w-overlay_w-40"))
        y = str(ov.get("y", "h-overlay_h-40"))
        opacity = float(ov.get("opacity", 0.85))
        width = ov.get("width", None)
        height = ov.get("height", None)

        wm_label = f"[{img_in_index}:v]"
        if width or height:
            w = int(width) if width else -1
            h = int(height) if height else -1
            filter_parts.append(f"{wm_label}scale={w}:{h}[wm{idx}]")
            wm_label = f"[wm{idx}]"

        filter_parts.append(f"{wm_label}format=rgba,colorchannelmixer=aa={opacity}[wma{idx}]")
        wm_label = f"[wma{idx}]"

        enable = ""
        if start is not None and end is not None:
            enable = f":enable='between(t,{float(start)},{float(end)})'"
        elif start is not None:
            enable = f":enable='gte(t,{float(start)})'"
        elif end is not None:
            enable = f":enable='lte(t,{float(end)})'"

        filter_parts.append(f"{current_v}{wm_label}overlay=x={x}:y={y}{enable}[vwm{idx}]")
        current_v = f"[vwm{idx}]"

    if not filter_parts:
        shutil.copyfile(src_video, out_video)
        return

    filter_complex = ";".join(filter_parts)

    cmd += [
        "-filter_complex", filter_complex,
        "-map", current_v,
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out_video),
    ]
    _run_ffmpeg(cmd)


# -----------------------------
# VIRAL SUBS
# -----------------------------
def _srt_ts_to_seconds(ts: str) -> float:
    ts = ts.strip()
    hh, mm, rest = ts.split(":")
    ss, ms = rest.split(",")
    return int(hh) * 3600 + int(mm) * 60 + int(ss) + (int(ms) / 1000.0)


def _seconds_to_ass_ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    cs = int(round(seconds * 100.0))
    h = cs // (3600 * 100)
    cs %= (3600 * 100)
    m = cs // (60 * 100)
    cs %= (60 * 100)
    s = cs // 100
    cc = cs % 100
    return f"{h}:{m:02d}:{s:02d}.{cc:02d}"


def _srt_to_viral_ass(
    srt_path: Path,
    ass_path: Path,
    video_w: int = 1080,
    video_h: int = 1920,
    font: str = "Arial Black",
    font_size: int = 72,
    outline: int = 8,
    shadow: int = 2,
    margin_v: int = 260,
) -> None:
    """
    Create clean TikTok-style ASS captions from SRT.
    No karaoke word highlight for now — better sync, more stable.
    """
    def safe(s: str) -> str:
        return (
            s.replace("{", r"\{")
             .replace("}", r"\}")
             .replace("\u202a", "")
             .replace("\u202c", "")
        )

    def wrap_text(text: str, max_chars: int = 18, max_lines: int = 3) -> str:
        words = text.strip().split()
        if not words:
            return ""

        lines = []
        cur = ""

        for w in words:
            if not cur:
                cur = w
            elif len(cur) + 1 + len(w) <= max_chars:
                cur += " " + w
            else:
                lines.append(cur)
                cur = w
                if len(lines) >= max_lines:
                    break

        if cur and len(lines) < max_lines:
            lines.append(cur)

        return r"\N".join(lines)

    srt_text = srt_path.read_text(encoding="utf-8", errors="ignore")
    lines = [ln.rstrip("\n") for ln in srt_text.splitlines()]

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Viral,{font},{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,{outline},{shadow},2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events: List[str] = []
    i = 0
    n = len(lines)

    while i < n:
        if not lines[i].strip():
            i += 1
            continue

        if lines[i].strip().isdigit():
            i += 1
            if i >= n:
                break

        if i >= n or "-->" not in lines[i]:
            i += 1
            continue

        time_line = lines[i].strip()
        i += 1

        try:
            left, right = [x.strip() for x in time_line.split("-->")]
            start_s = _srt_ts_to_seconds(left)
            end_s = _srt_ts_to_seconds(right.split()[0])
        except Exception:
            continue

        text_lines = []
        while i < n and lines[i].strip():
            text_lines.append(lines[i].strip())
            i += 1

        raw = safe(" ".join(text_lines).strip())
        wrapped = wrap_text(raw, max_chars=18, max_lines=3)
        if not wrapped:
            continue

        start_ass = _seconds_to_ass_ts(start_s)
        end_ass = _seconds_to_ass_ts(end_s)

        text = r"{\an2\bord8\shad2\t(0,100,\fscx106\fscy106)\t(100,180,\fscx100\fscy100)}" + wrapped
        events.append(f"Dialogue: 0,{start_ass},{end_ass},Viral,,0,0,0,,{text}")

    ass_path.parent.mkdir(parents=True, exist_ok=True)
    ass_path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


# -----------------------------
# DUAL EXPORT
# -----------------------------
def _dual_export_from_final(
    paths: EditPaths,
    final_path: Path,
    job_id: str,
    enabled: bool,
    job: Optional[Dict[str, Any]] = None,
    allowed_roots: Optional[List[Path]] = None,
) -> Optional[Dict[str, str]]:
    if not enabled:
        return None

    ensure_dirs(paths)
    roots = allowed_roots or [paths.static_dir, paths.uploads_dir, paths.sources_dir, paths.temp_dir, paths.outputs_dir]

    out_16 = paths.outputs_dir / f"{job_id}_16x9.mp4"
    out_9 = paths.outputs_dir / f"{job_id}_9x16.mp4"

    vf_16 = (
        "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,"
        "pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2"
    )

    cmd_16 = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(final_path),
        "-vf", vf_16,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out_16),
    ]
    _run_ffmpeg(cmd_16)

    vf_9 = (
        "scale=w=-2:h=1920,"
        "crop=w=1080:h=1920:x=(in_w-1080)/2:y=(in_h-1920)/2"
    )

    subs = ((job or {}).get("plan") or {}).get("subtitles") or {}
    burn_subs = bool(subs.get("burn", False))
    srt_path = subs.get("srt_path")

    if burn_subs and srt_path:
        rp = _resolve_subtitle_to_local(paths, str(srt_path), roots)

        ass_path = paths.temp_dir / f"{job_id}_viral_subs.ass"
        _srt_to_viral_ass(
            srt_path=rp,
            ass_path=ass_path,
            video_w=1080,
            video_h=1920,
            font="Arial Black",
            font_size=72,
            outline=8,
            shadow=2,
            margin_v=260,
        )

        ass_escaped = str(ass_path.resolve()).replace("\\", "/")
        ass_escaped = ass_escaped.replace(":", "\\:").replace("'", "\\'")
        vf_9 = vf_9 + f",ass='{ass_escaped}'"

    cmd_9 = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(final_path),
        "-vf", vf_9,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out_9),
    ]
    _run_ffmpeg(cmd_9)

    return {
        "landscape_16_9": _to_static_url(paths, out_16),
        "vertical_9_16": _to_static_url(paths, out_9),
    }


# -----------------------------
# SILENCE REMOVAL
# -----------------------------
_SILENCE_START_RE = re.compile(r"silence_start:\s*([0-9.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)")


def _detect_silences(
    src: Path,
    silence_db: float = -35.0,
    min_silence: float = 0.25,
) -> List[Dict[str, float]]:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "info",
        "-i", str(src),
        "-af", f"silencedetect=noise={silence_db}dB:d={min_silence}",
        "-f", "null",
        "-",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    log = proc.stderr or ""

    silences: List[Dict[str, float]] = []
    current_start: Optional[float] = None

    for line in log.splitlines():
        m1 = _SILENCE_START_RE.search(line)
        if m1:
            current_start = float(m1.group(1))
            continue

        m2 = _SILENCE_END_RE.search(line)
        if m2 and current_start is not None:
            end = float(m2.group(1))
            dur = float(m2.group(2))
            silences.append({"start": current_start, "end": end, "dur": dur})
            current_start = None

    return silences


def _compute_keep_intervals(
    duration: float,
    silences: List[Dict[str, float]],
    keep_padding: float = 0.08,
    min_silence: float = 0.25,
) -> List[Dict[str, float]]:
    if duration <= 0:
        return [{"start": 0.0, "end": 0.0}]

    sils = [s for s in silences if float(s.get("dur", 0)) >= float(min_silence)]
    if not sils:
        return [{"start": 0.0, "end": float(duration)}]

    sils.sort(key=lambda x: x["start"])
    merged = []
    cur = sils[0].copy()

    for s in sils[1:]:
        if s["start"] <= cur["end"]:
            cur["end"] = max(cur["end"], s["end"])
        else:
            merged.append(cur)
            cur = s.copy()
    merged.append(cur)

    keep: List[Dict[str, float]] = []
    t = 0.0
    for s in merged:
        s_start = max(0.0, float(s["start"]) - keep_padding)
        s_end = min(float(duration), float(s["end"]) + keep_padding)

        if s_start > t + 0.01:
            keep.append({"start": t, "end": s_start})
        t = max(t, s_end)

    if t < float(duration) - 0.01:
        keep.append({"start": t, "end": float(duration)})

    keep = [k for k in keep if (k["end"] - k["start"]) >= 0.08]

    if not keep:
        keep = [{"start": 0.0, "end": float(duration)}]

    return keep


def _apply_silence_removal(
    src: Path,
    out: Path,
    silence_db: float = -35.0,
    min_silence: float = 0.25,
    keep_padding: float = 0.08,
) -> None:
    if not _has_audio_stream(src):
        shutil.copyfile(src, out)
        return

    dur = _ffprobe_duration_seconds(src)
    silences = _detect_silences(src, silence_db=silence_db, min_silence=min_silence)
    keep = _compute_keep_intervals(dur, silences, keep_padding=keep_padding, min_silence=min_silence)

    if len(keep) == 1 and abs(keep[0]["start"] - 0.0) < 0.01 and abs(keep[0]["end"] - dur) < 0.05:
        shutil.copyfile(src, out)
        return

    parts = []
    concat_inputs = []

    for idx, seg in enumerate(keep):
        s = float(seg["start"])
        e = float(seg["end"])
        parts.append(f"[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{idx}]")
        parts.append(f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{idx}]")
        concat_inputs.append(f"[v{idx}]")
        concat_inputs.append(f"[a{idx}]")

    n = len(keep)
    parts.append("".join(concat_inputs) + f"concat=n={n}:v=1:a=1[v][a]")
    fc = ";".join(parts)

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-filter_complex", fc,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        str(out),
    ]
    _run_ffmpeg(cmd)


# -----------------------------
# RUN JOB
# -----------------------------
def run_edit_job(paths: EditPaths, job_id: str) -> Dict[str, Any]:
    job = load_job(paths, job_id)
    plan = job["plan"]
    clips = job["clips"]

    allowed_roots = [paths.static_dir, paths.uploads_dir, paths.sources_dir, paths.temp_dir, paths.outputs_dir]

    print(f"[{job_id}] STEP 1: resolving clips")
    update_job(paths, job_id, status="running", progress=5, stage="resolving_clips")

    clip_map: Dict[int, Path] = {}
    for c in clips:
        cid = int(c["id"])
        ref = str(c["ref"])
        clip_map[cid] = resolve_clip_to_local(paths, ref, allowed_roots)

    order: List[int] = [int(x) for x in plan.get("order", [])] or [int(c["id"]) for c in clips]

    timeline = plan.get("timeline", [])
    tl_by_id: Dict[int, Dict[str, Any]] = {}
    for item in timeline:
        if "clip" in item:
            tl_by_id[int(item["clip"])] = item

    out_res = plan.get("output", {}).get("resolution", "1080p")
    out_fps = int(plan.get("output", {}).get("fps", 30))
    audio_norm = bool(plan.get("audio", {}).get("normalize", True))

    dual_export_enabled = bool(plan.get("output", {}).get("dual_export", False)) or str(job.get("prompt", "")).lower().strip() in ("viral", "viral_mode")

    temp_job_dir = paths.temp_dir / job_id
    temp_job_dir.mkdir(parents=True, exist_ok=True)

    print(f"[{job_id}] STEP 2: normalizing clips")
    update_job(paths, job_id, progress=10, stage="normalizing_clips")

    norm_paths: List[Path] = []
    total = len(order)

    for idx, cid in enumerate(order, start=1):
        if cid not in clip_map:
            raise ValueError(f"Clip id {cid} not provided")

        src = clip_map[cid]
        item = tl_by_id.get(cid, {})

        trim = item.get("trim")
        speed = item.get("speed")
        color = item.get("color")

        norm_out = temp_job_dir / f"{idx:02d}_clip{cid}_norm.mp4"

        _norm_clip(
            paths=paths,
            src=src,
            out=norm_out,
            resolution=str(out_res),
            fps=int(out_fps),
            trim=trim if isinstance(trim, dict) else None,
            speed=float(speed) if speed is not None else None,
            color=color if isinstance(color, dict) else None,
            audio_normalize=audio_norm,
        )

        norm_paths.append(norm_out)
        prog = 10 + int(25 * (idx / max(1, total)))
        update_job(paths, job_id, progress=prog, stage="normalizing_clips")

    print(f"[{job_id}] STEP 3: merging clips")
    update_job(paths, job_id, progress=40, stage="merging_clips")

    merged = temp_job_dir / "merged.mp4"
    transitions = plan.get("transitions", {"type": "none"})
    ttype = str(transitions.get("type", "none")).lower()

    if ttype == "crossfade":
        dur = float(transitions.get("duration", 0.5))
        _concat_with_crossfade(norm_paths, merged, duration=dur)
    else:
        _concat_simple(norm_paths, merged)

    pacing = plan.get("pacing", {}) or {}
    if bool(pacing.get("remove_silence", False)):
        print(f"[{job_id}] STEP 4: silence removal")
        update_job(paths, job_id, progress=50, stage="removing_silence")

        paced = temp_job_dir / "paced.mp4"
        _apply_silence_removal(
            src=merged,
            out=paced,
            silence_db=float(pacing.get("silence_db", -35)),
            min_silence=float(pacing.get("min_silence", 0.25)),
            keep_padding=float(pacing.get("keep_padding", 0.08)),
        )
        merged = paced

    # Apply the bounded static punch-in when requested.
    camera = plan.get("camera", {}) or {}
    if camera.get("punch_in"):
        print(f"[{job_id}] STEP 5: punch zoom")
        update_job(paths, job_id, progress=60, stage="applying_punch_zoom")

        zoomed = temp_job_dir / "zoomed.mp4"
        _apply_punch_in_zoom(
            src=merged,
            out=zoomed,
            strength=float(camera.get("strength", 1.06)),
            start=float(camera.get("start", 0.0)),
            end=camera.get("end", None),
        )
        merged = zoomed

    print(f"[{job_id}] STEP 6: overlays / final master")
    update_job(paths, job_id, progress=70, stage="rendering_master")

    overlays = plan.get("overlays", []) or []
    final_name = f"{job_id}_final.mp4"
    final_path = paths.outputs_dir / final_name

    _apply_overlays_and_subtitles(
        paths=paths,
        src_video=merged,
        out_video=final_path,
        overlays=overlays,
        subtitles=None,
        allowed_roots=allowed_roots,
    )

    plan_subs = ((job.get("plan") or {}).get("subtitles") or {})
    burn = bool(plan_subs.get("burn", False))
    auto = bool(plan_subs.get("auto", False))
    srt_path = plan_subs.get("srt_path")

    if burn and (auto or not srt_path):
        print(f"[{job_id}] STEP 7: auto subtitles")
        update_job(paths, job_id, progress=82, stage="generating_subtitles")

        try:
            srt_static_url = ensure_srt_for_job(
                job_id=job_id,
                final_video_path=final_path,
                language=str(plan_subs.get("lang", "")),
                model_size=str(plan_subs.get("model", "")) or "small",
            )

            job["plan"]["subtitles"] = {
                **plan_subs,
                "burn": True,
                "srt_path": srt_static_url,
            }

            try:
                rel = str(srt_static_url).split("/static/", 1)[1]
                srt_local = (paths.static_dir / rel).resolve()
                hook_text = generate_hook_from_srt(str(srt_local))

                overlays = job["plan"].get("overlays", []) or []
                overlays.insert(0, {
                    "type": "text",
                    "text": hook_text,
                    "start": 0,
                    "end": 8.0,
                    "x": "(w-text_w)/2",
                    "y": "h*0.18",
                    "fontsize": 82,
                    "fontcolor": "white",
                    "box": True,
                    "boxcolor": "black@0.60",
                })
                job["plan"]["overlays"] = overlays
            except Exception as e:
                print(f"[{job_id}] HOOK ERROR: {e}")

            save_job(paths, job)

            print(f"[{job_id}] STEP 7B: rerendering master with hook")
            update_job(paths, job_id, progress=88, stage="rerendering_master_with_hook")

            _apply_overlays_and_subtitles(
                paths=paths,
                src_video=merged,
                out_video=final_path,
                overlays=job["plan"].get("overlays", []) or [],
                subtitles=None,
                allowed_roots=allowed_roots,
            )

        except Exception as e:
            update_job(paths, job_id, status="failed", error=f"Auto subtitles failed: {e}", stage="failed")
            raise

    if dual_export_enabled:
        print(f"[{job_id}] STEP 8: dual export")
        update_job(paths, job_id, progress=94, stage="dual_exporting")

    outputs = _dual_export_from_final(
        paths=paths,
        final_path=final_path,
        job_id=job_id,
        enabled=dual_export_enabled,
        job=job,
        allowed_roots=allowed_roots,
    )

    print(f"[{job_id}] STEP 9: cleanup / done")
    update_job(paths, job_id, progress=98, stage="cleaning_up")

    shutil.rmtree(temp_job_dir, ignore_errors=True)

    out_url = _to_static_url(paths, final_path)
    print(f"[{job_id}] FINAL OUTPUT PATH: {out_url}")

    if outputs:
        return update_job(
            paths,
            job_id,
            status="succeeded",
            progress=100,
            output=out_url,
            output_url=out_url,
            outputs=outputs,
            stage="completed",
        )

    return update_job(
        paths,
        job_id,
        status="succeeded",
        progress=100,
        output=out_url,
        output_url=out_url,
        stage="completed",
    )

    
