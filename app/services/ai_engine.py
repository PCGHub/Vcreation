import os
import json
import time
import uuid
import subprocess
import re
from pathlib import Path
from typing import Any, Dict, Optional, List


# =============================
# CAPTION CLEANING HELPERS
# =============================
_CTRL = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
_WS = re.compile(r"\s+")


def _clean_caption_text(s: str) -> str:
    s = (s or "")
    s = s.replace("\ufeff", "")
    s = _CTRL.sub("", s)
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = s.replace("\u00a0", " ")
    s = _WS.sub(" ", s).strip()
    return s


# Replicate is optional
try:
    import replicate  # noqa: F401
except Exception:
    replicate = None


# Faster-whisper
try:
    from faster_whisper import WhisperModel
    HAS_FASTER_WHISPER = True
except Exception:
    WhisperModel = Any  # type: ignore[assignment]
    HAS_FASTER_WHISPER = False


# -----------------------------
# STORAGE / CONSTANTS
# -----------------------------
BASE_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = (BASE_DIR / "static").resolve()

VIDEOS_DIR = (STATIC_DIR / "videos").resolve()
IMAGES_DIR = (STATIC_DIR / "images").resolve()
JOBS_DIR = (STATIC_DIR / "jobs").resolve()
SUBTITLES_DIR = (STATIC_DIR / "subtitles").resolve()

LOCAL_WHISPER_MODEL_DIR = (STATIC_DIR / "models" / "faster-whisper-base").resolve()

VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)
SUBTITLES_DIR.mkdir(parents=True, exist_ok=True)


# -----------------------------
# JOB STORE HELPERS
# -----------------------------
def _save_job(job_id: str, data: Dict[str, Any]) -> None:
    (JOBS_DIR / f"{job_id}.json").write_text(
        json.dumps(data, indent=2),
        encoding="utf-8",
    )


def _load_job(job_id: str) -> Dict[str, Any]:
    p = JOBS_DIR / f"{job_id}.json"
    if not p.exists():
        raise FileNotFoundError("Job not found")
    return json.loads(p.read_text(encoding="utf-8"))


def _update_job(job_id: str, **updates) -> Dict[str, Any]:
    job = _load_job(job_id)
    job.update(updates)
    _save_job(job_id, job)
    return job


def _public_url_for(path: Path) -> str:
    rel = path.resolve().relative_to(STATIC_DIR.resolve())
    return f"/static/{rel.as_posix()}"


def _run(cmd: List[str]) -> None:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-4000:])


# -----------------------------
# REQUIRED FUNCTIONS (so imports don't break)
# -----------------------------
def generate_image(prompt: str, **kwargs):
    """
    Placeholder so `from app.services.ai_engine import generate_image` doesn't crash.
    """
    raise NotImplementedError("generate_image is not implemented yet.")


def start_video_job(prompt: str, engine: str = "replicate+ffmpeg", **kwargs) -> Dict[str, Any]:
    """
    Placeholder job creation so transform route stays alive.
    """
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "type": "video",
        "prompt": prompt,
        "engine": engine,
        "status": "queued",
        "progress": 0,
        "created_at": int(time.time()),
        "url": None,
        "error": None,
        "meta": kwargs or {},
    }
    _save_job(job_id, job)
    _update_job(job_id, status="running", progress=5)
    return {"job_id": job_id, "status": "running"}


def check_video_job(job_id: str) -> Dict[str, Any]:
    job = _load_job(job_id)
    return {
        "id": job["id"],
        "type": job.get("type", "video"),
        "prompt": job.get("prompt"),
        "status": job.get("status", "unknown"),
        "url": job.get("url"),
        "engine": job.get("engine"),
        "progress": job.get("progress", 0),
        "error": job.get("error"),
    }


# -----------------------------
# LOCAL WHISPER MODEL (OFFLINE)
# -----------------------------
_whisper_model: Optional[WhisperModel] = None


def get_whisper_model() -> WhisperModel:
    """
    Load once, from local directory, never downloads from HF.
    """
    global _whisper_model

    if not HAS_FASTER_WHISPER:
        raise RuntimeError(
            "faster_whisper is not installed. Install it in your backend environment "
            "to enable subtitle transcription."
        )

    if _whisper_model is None:
        if not LOCAL_WHISPER_MODEL_DIR.exists():
            raise RuntimeError(
                f"Local whisper model folder missing: {LOCAL_WHISPER_MODEL_DIR}\n"
                f"Expected files like model.bin, config.json, tokenizer.json."
            )

        _whisper_model = WhisperModel(
            str(LOCAL_WHISPER_MODEL_DIR),
            device="cpu",
            compute_type="int8",
        )

    return _whisper_model


def _format_timestamp(seconds: float) -> str:
    ms = int(seconds * 1000)

    hh = ms // 3600000
    ms %= 3600000
    mm = ms // 60000
    ms %= 60000
    ss = ms // 1000
    ms %= 1000

    return f"{hh:02}:{mm:02}:{ss:02},{ms:03}"


# -----------------------------
# SUBTITLE CLEANUP HELPERS
# -----------------------------
KEEP_FILLERS = {
    "hmm", "hmmm", "hm",
    "ah", "ahh", "ahhh",
    "uh", "uhh", "uhhh",
    "um", "umm", "ummm",
    "yeah", "yea", "yes",
    "okay", "ok", "no",
    "wait", "oh", "wow", "hey"
}


def _normalize_token(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9']", "", s)
    return s


def _is_filler_only(text: str) -> bool:
    words = [_normalize_token(w) for w in (text or "").split()]
    words = [w for w in words if w]
    if not words:
        return False
    return all(w in KEEP_FILLERS for w in words)


def _is_strong_speech_text(text: str) -> bool:
    """
    Strong speech = more likely real spoken content, not intro noise.
    """
    cleaned = _clean_caption_text(text)
    if not cleaned:
        return False

    words = [_normalize_token(w) for w in cleaned.split()]
    words = [w for w in words if w]

    if len(words) >= 4:
        return True

    if len(cleaned) >= 16 and len(words) >= 3:
        return True

    if _is_filler_only(cleaned):
        return False

    return False


def _should_keep_segment(
    text: str,
    start: float,
    end: float,
    first_strong_start: Optional[float],
) -> bool:
    """
    Cleanup rules:
    - drop empty lines
    - drop ultra-short junk
    - keep useful fillers
    - drop fake intro subtitles before first strong speech
    """
    cleaned = _clean_caption_text(text)
    if not cleaned:
        return False

    dur = max(0.0, float(end) - float(start))
    norm_words = [_normalize_token(w) for w in cleaned.split()]
    norm_words = [w for w in norm_words if w]

    if _is_filler_only(cleaned):
        return dur >= 0.18

    if len(norm_words) == 1 and len(cleaned) <= 2 and dur < 0.25:
        return False

    if first_strong_start is not None and start < first_strong_start:
        if not _is_strong_speech_text(cleaned):
            return False

    return True


def _merge_close_srt_segments(
    rows: List[Dict[str, Any]],
    gap_threshold: float = 0.18,
    max_merge_chars: int = 60,
) -> List[Dict[str, Any]]:
    """
    Merge tiny adjacent caption rows to reduce broken fragments.
    """
    if not rows:
        return rows

    merged = [rows[0]]

    for row in rows[1:]:
        prev = merged[-1]
        gap = float(row["start"]) - float(prev["end"])

        prev_text = _clean_caption_text(prev["text"])
        row_text = _clean_caption_text(row["text"])

        if (
            gap <= gap_threshold
            and len(prev_text) + 1 + len(row_text) <= max_merge_chars
            and not _is_filler_only(prev_text)
            and not _is_filler_only(row_text)
        ):
            prev["end"] = row["end"]
            prev["text"] = f"{prev_text} {row_text}".strip()
        else:
            merged.append(row)

    return merged


def _extract_speech_audio_for_transcription(video_path: Path, audio_out: Path) -> Path:
    """
    Create a speech-focused mono WAV for Whisper.
    Helps when music is competing with voice.
    """
    audio_out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-af", "highpass=f=120,lowpass=f=3800,loudnorm=I=-16:LRA=11:TP=-1.5",
        str(audio_out),
    ]
    _run(cmd)
    return audio_out


# -----------------------------
# TRANSCRIBE TO SRT
# -----------------------------
def transcribe_video_to_srt(
    video_path: Path,
    output_srt: Path,
    language: str = "",
) -> Path:
    """
    Transcribe audio to SRT using local faster-whisper model.
    Includes subtitle cleanup:
    - removes fake early intro subtitles
    - preserves useful fillers better
    - merges tiny fragments
    """
    model = get_whisper_model()

    temp_audio = output_srt.parent / f"{output_srt.stem}_speech.wav"
    _extract_speech_audio_for_transcription(video_path, temp_audio)

    try:
        segments, info = model.transcribe(
            str(temp_audio),
            language=language if language else None,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=120,
            ),
            beam_size=5,
            best_of=5,
            word_timestamps=False,
            condition_on_previous_text=False,
            temperature=0.0,
            initial_prompt="Keep natural spoken fillers like hmm, ah, yeah, okay, wait, oh.",
        )

        cached_segments = list(segments)
        raw_rows: List[Dict[str, Any]] = []

        first_strong_start: Optional[float] = None
        for seg in cached_segments:
            txt = _clean_caption_text(seg.text)
            if _is_strong_speech_text(txt):
                first_strong_start = float(seg.start)
                break

        for seg in cached_segments:
            text = _clean_caption_text(seg.text)
            start = float(seg.start)
            end = float(seg.end)

            if not _should_keep_segment(text, start, end, first_strong_start):
                continue

            raw_rows.append({
                "start": start,
                "end": end,
                "text": text,
            })

        final_rows = _merge_close_srt_segments(raw_rows)

        output_srt.parent.mkdir(parents=True, exist_ok=True)

        with open(output_srt, "w", encoding="utf-8") as f:
            i = 1
            for row in final_rows:
                text = _clean_caption_text(row["text"])
                if not text:
                    continue

                start_ts = _format_timestamp(float(row["start"]))
                end_ts = _format_timestamp(float(row["end"]))

                f.write(f"{i}\n")
                f.write(f"{start_ts} --> {end_ts}\n")
                f.write(f"{text}\n\n")
                i += 1

        return output_srt

    finally:
        try:
            temp_audio.unlink(missing_ok=True)
        except Exception:
            pass


def ensure_srt_for_job(
    job_id: str,
    final_video_path: Path,
    language: str = "",
    model_size: str = "base",  # kept for compatibility
) -> str:
    """
    Generates /static/subtitles/{job_id}.srt if missing and returns its static URL.
    """
    srt_path = (SUBTITLES_DIR / f"{job_id}.srt").resolve()

    if srt_path.exists() and srt_path.stat().st_size > 20:
        return f"/static/subtitles/{job_id}.srt"

    transcribe_video_to_srt(
        video_path=final_video_path,
        output_srt=srt_path,
        language=language,
    )

    return f"/static/subtitles/{job_id}.srt"


# -----------------------------
# VIRAL HOOK GENERATOR (from SRT)
# -----------------------------
def generate_hook_from_srt(srt_file: str) -> str:
    """
    Take the first subtitle line and turn it into a short viral hook.
    """
    try:
        p = Path(srt_file)
        if not p.exists():
            return "WAIT FOR IT 👀"

        text = p.read_text(encoding="utf-8", errors="ignore")

        lines = [
            l.strip()
            for l in text.splitlines()
            if l.strip() and "-->" not in l and not l.strip().isdigit()
        ]

        if not lines:
            return "WAIT FOR IT 👀"

        first_line = lines[0]
        first_line = re.sub(r"[^\w\s]", "", first_line).strip()

        words = first_line.split()[:6]
        hook = " ".join(words).upper()

        if len(hook) < 6:
            return "WAIT FOR IT 👀"

        return hook + " 👀"

    except Exception:
        return "WAIT FOR IT 👀"


# -----------------------------
# SIMPLE SRT -> ASS HELPER
# -----------------------------
def _srt_time_to_seconds(t: str) -> float:
    hh, mm, rest = t.split(":")
    ss, ms = rest.split(",")
    return int(hh) * 3600 + int(mm) * 60 + int(ss) + int(ms) / 1000.0


def _sec_to_ass(ts: float) -> str:
    if ts < 0:
        ts = 0
    h = int(ts // 3600)
    m = int((ts % 3600) // 60)
    s = ts % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def srt_to_viral_ass(srt_path: Path, ass_path: Path) -> Path:
    """
    Create a clean ASS for 1080x1920 vertical.
    """
    srt_path = Path(srt_path).resolve()
    ass_path = Path(ass_path).resolve()
    ass_path.parent.mkdir(parents=True, exist_ok=True)

    raw = srt_path.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", raw.strip())

    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Viral,Arial Black,62,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,8,2,2,90,90,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines_out = [header]

    for b in blocks:
        lines = [x.strip("\r") for x in b.splitlines() if x.strip()]
        if len(lines) < 3:
            continue

        time_line = lines[1]
        if "-->" not in time_line:
            continue

        start_s, end_s = [x.strip() for x in time_line.split("-->")]
        start = _sec_to_ass(_srt_time_to_seconds(start_s))
        end = _sec_to_ass(_srt_time_to_seconds(end_s))

        text = " ".join(lines[2:])
        text = text.replace("{", "").replace("}", "")
        text = re.sub(r"\s+", " ", text).strip()

        if not text:
            continue

        ass_text = r"{\an2\q2}" + text
        lines_out.append(f"Dialogue: 0,{start},{end},Viral,,0,0,0,,{ass_text}\n")

    ass_path.write_text("".join(lines_out), encoding="utf-8")
    return ass_path
