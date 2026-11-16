import json
import os
import re
import subprocess
import sys
import uuid
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".webm"}
TTS_TEXT_SAFE_MAX = 400
LINE_PAUSE_SECONDS = 0.35
MIN_SLOT_SECONDS = 1.2
MAX_SLOT_SECONDS = 12.0
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_TTS_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"


@dataclass
class MusicPaths:
    static_dir: Path
    uploads_dir: Path
    jobs_dir: Path
    outputs_dir: Path
    temp_dir: Path
    sources_dir: Path
    lyrics_dir: Path


def ensure_dirs(paths: MusicPaths) -> None:
    for path in (
        paths.uploads_dir,
        paths.jobs_dir,
        paths.outputs_dir,
        paths.temp_dir,
        paths.sources_dir,
        paths.lyrics_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)


def job_path(paths: MusicPaths, job_id: str) -> Path:
    return paths.jobs_dir / f"{job_id}.json"


def save_job(paths: MusicPaths, job: Dict[str, Any]) -> None:
    job_path(paths, job["id"]).write_text(json.dumps(job, indent=2), encoding="utf-8")


def load_job(paths: MusicPaths, job_id: str) -> Dict[str, Any]:
    path = job_path(paths, job_id)
    if not path.exists():
        raise FileNotFoundError("Music job not found")
    return json.loads(path.read_text(encoding="utf-8"))


def update_job(paths: MusicPaths, job_id: str, **updates: Any) -> Dict[str, Any]:
    job = load_job(paths, job_id)
    job.update(updates)
    save_job(paths, job)
    return job


def create_job(paths: MusicPaths, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_dirs(paths)
    job_id = uuid.uuid4().hex

    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "queued",
        "input": payload,
        "output_url": None,
        "lyrics": None,
        "error": None,
    }

    save_job(paths, job)
    return job


def save_lyrics_text(paths: MusicPaths, job_id: str, lyrics: str) -> str:
    ensure_dirs(paths)
    lyrics_path = paths.lyrics_dir / f"{job_id}.txt"
    lyrics_path.write_text((lyrics or "").strip() + "\n", encoding="utf-8")
    return f"/static/music_lyrics/{lyrics_path.name}"


def resolve_audio(paths: MusicPaths, audio_ref: str) -> Path:
    audio_ref = (audio_ref or "").strip()
    if not audio_ref:
        raise ValueError("Audio ref is empty")

    if audio_ref.startswith("/static/"):
        rel = audio_ref.split("/static/", 1)[1]
        candidate = (paths.static_dir / rel).resolve()
    else:
        candidate = Path(audio_ref).resolve()

    if not candidate.exists():
        raise ValueError("Audio not found")
    if candidate.suffix.lower() not in AUDIO_EXTS:
        raise ValueError(f"Unsupported audio format: {candidate.suffix}")

    return candidate


def run_ffmpeg(cmd: List[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg failed")


def run_ffmpeg_capture(cmd: List[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg failed")
    return (proc.stdout or "") + (proc.stderr or "")


def extract_lyrics_from_audio(audio_path: Path, temp_dir: Path, language: str = "") -> str:
    from app.services.ai_engine import _clean_caption_text, get_whisper_model

    speech_path = temp_dir / "lyrics_speech.wav"
    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        "highpass=f=120,lowpass=f=4200,loudnorm=I=-16:LRA=11:TP=-1.5",
        str(speech_path),
    ])

    try:
        model = get_whisper_model()
        segments, _ = model.transcribe(
            str(speech_path),
            language=language if language else None,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=250,
                speech_pad_ms=150,
            ),
            beam_size=5,
            best_of=5,
            word_timestamps=False,
            condition_on_previous_text=False,
            temperature=0.0,
            initial_prompt="Transcribe song lyrics line by line. Keep repeated lyrics if they are sung.",
        )

        lines: List[str] = []
        for seg in segments:
            text = _clean_caption_text(getattr(seg, "text", ""))
            text = re.sub(r"\s+", " ", text).strip(" -")
            if not text:
                continue
            if lines and lines[-1].lower() == text.lower():
                continue
            lines.append(text)

        lyrics = "\n".join(lines).strip()
        if not lyrics:
            raise RuntimeError("No lyrics were extracted from the audio.")
        return lyrics
    finally:
        try:
            speech_path.unlink(missing_ok=True)
        except Exception:
            pass


def probe_duration(src: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(src),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "ffprobe failed")
    return float((proc.stdout or "0").strip() or "0")


def normalize_audio(src: Path, out_path: Path) -> None:
    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        str(out_path),
    ])


def extract_stems_with_demucs(input_audio: Path, output_dir: Path) -> Dict[str, Path]:
    import shutil

    temp_out = output_dir / "demucs_out"
    temp_out.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "--two-stems=vocals",
        "--mp3",
        "-o",
        str(temp_out),
        str(input_audio),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "Demucs failed")

    found: Dict[str, Path] = {}
    for root, _, files in os.walk(temp_out):
        for file in files:
            if file not in {"vocals.mp3", "vocals.wav", "no_vocals.mp3", "no_vocals.wav"}:
                continue
            stem_path = Path(root) / file
            if file.startswith("vocals"):
                final = output_dir / f"vocals{stem_path.suffix.lower()}"
                shutil.copy2(stem_path, final)
                found["vocals"] = final
            if file.startswith("no_vocals"):
                final = output_dir / f"instrumental{stem_path.suffix.lower()}"
                shutil.copy2(stem_path, final)
                found["instrumental"] = final

    if "instrumental" not in found or "vocals" not in found:
        raise RuntimeError("Demucs stems not found")

    return found


def safe_tts_text(text: str) -> str:
    cleaned = " ".join((text or "").replace("\r", " ").replace("\n", " ").split())
    if not cleaned:
        cleaned = "Music preview generated."
    return cleaned.replace("\\", " ").replace(":", " ").replace("'", "")[:TTS_TEXT_SAFE_MAX]


def lyric_lines(lyrics: str) -> List[str]:
    lines: List[str] = []
    for raw in (lyrics or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        lowered = line.lower()
        if line.startswith("[") and line.endswith("]"):
            continue
        if lowered.startswith(("verse", "hook", "chorus", "bridge", "outro", "intro")) and line.endswith(":"):
            continue
        if lowered.startswith("hook / chorus"):
            continue
        lines.append(line)

    if not lines:
        return ["Music preview generated."]
    return lines


def split_lyric_line(line: str) -> List[str]:
    chunks: List[str] = []
    coarse_parts = [part.strip(" ,;:-") for part in re.split(r"[,;:]+", line) if part.strip(" ,;:-")]
    if not coarse_parts:
        coarse_parts = [line.strip()]

    for part in coarse_parts:
        words = part.split()
        if not words:
            continue

        current: List[str] = []
        current_syllables = 0
        for word in words:
            word_syllables = estimate_syllables(word)
            projected_words = len(current) + 1
            projected_syllables = current_syllables + word_syllables
            should_break = bool(
                current
                and (
                    projected_words > 4
                    or projected_syllables > 7
                )
            )
            if should_break:
                chunks.append(" ".join(current).strip())
                current = [word]
                current_syllables = word_syllables
            else:
                current.append(word)
                current_syllables = projected_syllables

        if current:
            chunks.append(" ".join(current).strip())

    cleaned = [chunk for chunk in chunks if chunk]
    return cleaned or [line.strip()]


def lyric_phrases(lyrics: str) -> List[Dict[str, Any]]:
    lines = lyric_lines(lyrics)
    phrases: List[Dict[str, Any]] = []
    for line_index, line in enumerate(lines, start=1):
        parts = split_lyric_line(line)
        for phrase_index, phrase in enumerate(parts, start=1):
            phrases.append({
                "text": phrase,
                "source_line": line,
                "line_index": line_index,
                "phrase_index": phrase_index,
                "phrase_count": len(parts),
            })
    return phrases or [{
        "text": "Music preview generated.",
        "source_line": "Music preview generated.",
        "line_index": 1,
        "phrase_index": 1,
        "phrase_count": 1,
    }]


def detect_vocal_segments(vocal_path: Path, total_duration: float) -> List[Dict[str, float]]:
    log = run_ffmpeg_capture([
        "ffmpeg",
        "-hide_banner",
        "-i",
        str(vocal_path),
        "-af",
        "silencedetect=noise=-32dB:d=0.45",
        "-f",
        "null",
        "-",
    ])

    silences: List[Dict[str, float]] = []
    current_start: float | None = None
    for raw in log.splitlines():
        line = raw.strip()
        if "silence_start:" in line:
            current_start = float(line.split("silence_start:", 1)[1].strip())
        elif "silence_end:" in line and current_start is not None:
            silence_end_text = line.split("silence_end:", 1)[1].split("|", 1)[0].strip()
            silences.append({"start": current_start, "end": float(silence_end_text)})
            current_start = None

    segments: List[Dict[str, float]] = []
    cursor = 0.0
    lead_in = min(1.2, max(0.0, total_duration * 0.01))
    for silence in silences:
        start = max(0.0, cursor)
        end = max(start, silence["start"])
        if end - start >= 0.55:
            segments.append({"start": start, "end": end})
        cursor = max(cursor, silence["end"])
    if total_duration - cursor >= 0.55:
        segments.append({"start": cursor, "end": total_duration})

    trimmed: List[Dict[str, float]] = []
    for segment in segments:
        start = max(0.0, segment["start"] + (lead_in if segment["start"] < 2.0 else 0.0))
        end = min(total_duration, segment["end"] - 0.08)
        if end - start >= 0.55:
            trimmed.append({"start": start, "end": end})

    if not trimmed:
        return [{"start": 0.8, "end": max(2.4, total_duration - 0.8)}]

    return trimmed


def estimate_syllables(text: str) -> int:
    words = re.findall(r"[A-Za-z']+", text.lower())
    if not words:
        return 1

    total = 0
    for word in words:
        groups = re.findall(r"[aeiouy]+", word)
        count = len(groups)
        if word.endswith("e") and count > 1:
            count -= 1
        if word.endswith(("le", "ye")) and len(word) > 2:
            count += 1
        total += max(1, count)
    return max(1, total)


def line_weight(text: str) -> float:
    syllables = estimate_syllables(text)
    word_count = len(re.findall(r"[A-Za-z']+", text))
    pause_bonus = 0.35 if re.search(r"[,;:.!?-]", text) else 0.0
    emphasis_bonus = 0.2 if len(text.strip()) <= 12 else 0.0
    return max(1.0, syllables + (0.18 * word_count) + pause_bonus + emphasis_bonus)


def fit_segments_to_count(
    segments: List[Dict[str, float]],
    count: int,
    *,
    line_weights: Optional[List[float]] = None,
) -> List[Dict[str, float]]:
    if count <= 0:
        return []
    if not segments:
        return [{"start": 0.0, "end": MIN_SLOT_SECONDS}] * count

    working = [{"start": s["start"], "end": s["end"]} for s in segments]

    while len(working) > count:
        best_index = 0
        best_gap = float("inf")
        for idx in range(len(working) - 1):
            gap = max(0.0, working[idx + 1]["start"] - working[idx]["end"])
            if gap < best_gap:
                best_gap = gap
                best_index = idx
        working[best_index]["end"] = working[best_index + 1]["end"]
        del working[best_index + 1]

    while len(working) < count:
        split_index = max(
            range(len(working)),
            key=lambda idx: working[idx]["end"] - working[idx]["start"],
        )
        segment = working[split_index]
        duration = segment["end"] - segment["start"]
        if duration < 2 * MIN_SLOT_SECONDS:
            insert_at = split_index + 1
            start = segment["end"] + LINE_PAUSE_SECONDS
            working.insert(insert_at, {"start": start, "end": start + MIN_SLOT_SECONDS})
            continue
        middle = segment["start"] + duration / 2
        first = {"start": segment["start"], "end": middle}
        second = {"start": middle, "end": segment["end"]}
        working[split_index:split_index + 1] = [first, second]

    weights = list(line_weights or [])
    if len(weights) != count:
        weights = [1.0] * count

    original_total = sum(max(0.55, seg["end"] - seg["start"]) for seg in working[:count])
    weight_total = max(0.001, sum(weights))
    target_durations = [
        max(0.55, min(MAX_SLOT_SECONDS, original_total * (weight / weight_total)))
        for weight in weights
    ]

    fitted: List[Dict[str, float]] = []
    cursor = max(0.0, working[0]["start"])
    for idx, segment in enumerate(working[:count]):
        start = max(0.0, segment["start"])
        if idx == 0:
            cursor = start
        else:
            cursor = max(cursor, start)
        desired = target_durations[idx]
        natural = max(0.55, segment["end"] - segment["start"])
        duration = max(0.55, min(MAX_SLOT_SECONDS, (natural * 0.35) + (desired * 0.65)))
        end = max(cursor + 0.5, min(segment["end"], cursor + duration))
        fitted.append({"start": round(cursor, 3), "end": round(end, 3)})
        next_start = working[idx + 1]["start"] if idx + 1 < count else None
        if next_start is not None:
            cursor = min(end + LINE_PAUSE_SECONDS * 0.25, max(end, next_start))
    return fitted


def atempo_filters(speed: float) -> str:
    filters: List[str] = []
    remaining = speed
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    filters.append(f"atempo={remaining:.5f}")
    return ",".join(filters)


def elevenlabs_voice_id(payload: Dict[str, Any]) -> str:
    return (
        (payload.get("voice_name") or "").strip()
        or os.getenv("ELEVENLABS_VOICE_ID", "").strip()
        or DEFAULT_VOICE_ID
    )


def elevenlabs_available(payload: Dict[str, Any]) -> bool:
    voice_mode = (payload.get("voice_mode") or "").strip().lower()
    if voice_mode in {"basic", "flite", "local"}:
        return False
    return bool(os.getenv("ELEVENLABS_API_KEY", "").strip())


def synthesize_with_flite(text: str, raw_path: Path) -> None:
    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"flite=text='{safe_tts_text(text)}':voice=slt",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(raw_path),
    ])


def synthesize_with_elevenlabs(
    text: str,
    raw_path: Path,
    voice_id: str,
    previous_text: Optional[str] = None,
    next_text: Optional[str] = None,
) -> None:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set.")

    query = urllib.parse.urlencode({"output_format": DEFAULT_TTS_OUTPUT_FORMAT})
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?{query}"
    payload: Dict[str, Any] = {
        "text": text,
        "model_id": DEFAULT_TTS_MODEL,
        "voice_settings": {
            "stability": 0.4,
            "similarity_boost": 0.8,
            "style": 0.7,
            "use_speaker_boost": True,
        },
    }
    if previous_text:
        payload["previous_text"] = previous_text
    if next_text:
        payload["next_text"] = next_text

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw_path.write_bytes(response.read())
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ElevenLabs TTS failed: {details}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ElevenLabs TTS connection failed: {exc.reason}") from exc


def synthesize_phrase_for_slot(
    text: str,
    slot: Dict[str, float],
    temp_dir: Path,
    index: int,
    *,
    engine: str,
    voice_id: Optional[str] = None,
    previous_text: Optional[str] = None,
    next_text: Optional[str] = None,
) -> Path:
    raw_ext = ".mp3" if engine == "elevenlabs" else ".wav"
    raw_path = temp_dir / f"phrase_raw_{index:02d}{raw_ext}"
    fitted_path = temp_dir / f"phrase_fit_{index:02d}.wav"

    if engine == "elevenlabs":
        synthesize_with_elevenlabs(
            text=text,
            raw_path=raw_path,
            voice_id=voice_id or DEFAULT_VOICE_ID,
            previous_text=previous_text,
            next_text=next_text,
        )
    else:
        synthesize_with_flite(text, raw_path)

    raw_duration = max(probe_duration(raw_path), 0.1)
    slot_duration = max(MIN_SLOT_SECONDS, min(MAX_SLOT_SECONDS, slot["end"] - slot["start"]))
    speed = max(0.5, min(8.0, raw_duration / slot_duration))
    filter_chain = atempo_filters(speed)

    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(raw_path),
        "-af",
        filter_chain,
        "-ar",
        "44100",
        "-ac",
        "2",
        str(fitted_path),
    ])

    return fitted_path


def generate_arranged_tts_audio(
    lyrics: str,
    vocal_reference: Path,
    temp_dir: Path,
    out_path: Path,
    song_duration: float,
    *,
    payload: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    payload = payload or {}
    phrases = lyric_phrases(lyrics)
    detected_segments = detect_vocal_segments(vocal_reference, song_duration)
    slots = fit_segments_to_count(
        detected_segments,
        len(phrases),
        line_weights=[line_weight(phrase["text"]) for phrase in phrases],
    )
    engine = "elevenlabs" if elevenlabs_available(payload) else "flite"
    voice_id = elevenlabs_voice_id(payload) if engine == "elevenlabs" else None

    bed_path = temp_dir / "tts_bed.wav"
    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        f"{song_duration:.3f}",
        str(bed_path),
    ])

    inputs: List[str] = ["-i", str(bed_path)]
    filters: List[str] = ["[0:a]anull[bed]"]
    mix_inputs: List[str] = ["[bed]"]
    phrase_map: List[Dict[str, Any]] = []

    for index, (phrase, slot) in enumerate(zip(phrases, slots), start=1):
        text = phrase["text"]
        previous_text = phrases[index - 2]["text"] if index > 1 else None
        next_text = phrases[index]["text"] if index < len(phrases) else None
        clip_engine = engine
        try:
            phrase_path = synthesize_phrase_for_slot(
                text,
                slot,
                temp_dir,
                index,
                engine=engine,
                voice_id=voice_id,
                previous_text=previous_text,
                next_text=next_text,
            )
        except RuntimeError:
            if engine != "elevenlabs":
                raise
            clip_engine = "flite"
            phrase_path = synthesize_phrase_for_slot(
                text,
                slot,
                temp_dir,
                index,
                engine="flite",
                previous_text=previous_text,
                next_text=next_text,
            )
        inputs.extend(["-i", str(phrase_path)])
        delay_ms = max(0, int(slot["start"] * 1000))
        filters.append(
            f"[{index}:a]volume=2.4,adelay={delay_ms}|{delay_ms}[v{index}]"
        )
        mix_inputs.append(f"[v{index}]")
        phrase_map.append({
            "text": text,
            "source_line": phrase["source_line"],
            "line_index": phrase["line_index"],
            "phrase_index": phrase["phrase_index"],
            "phrase_count": phrase["phrase_count"],
            "start": round(slot["start"], 3),
            "end": round(slot["end"], 3),
            "slot_duration": round(slot["end"] - slot["start"], 3),
            "file": phrase_path.name,
            "engine": clip_engine,
        })

    filters.append(
        "".join(mix_inputs) + f"amix=inputs={len(mix_inputs)}:duration=first:normalize=0,alimiter=limit=0.95[out]"
    )

    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        *inputs,
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(out_path),
    ])

    return phrase_map


def mix_song(instrumental: Path, vocal: Path, out_path: Path) -> None:
    run_ffmpeg([
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(instrumental),
        "-i",
        str(vocal),
        "-filter_complex",
        "[0:a]volume=1.0[a0];"
        "[1:a]volume=1.5[a1];"
        "[a0][a1]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(out_path),
    ])


def process_music_job(paths: MusicPaths, job_id: str) -> Dict[str, Any]:
    ensure_dirs(paths)
    job = load_job(paths, job_id)
    payload = job["input"]

    try:
        update_job(paths, job_id, status="running", progress=10, stage="resolving_audio")
        src = resolve_audio(paths, payload["audio_ref"])

        temp = paths.temp_dir / job_id
        temp.mkdir(parents=True, exist_ok=True)

        norm = temp / "norm.wav"
        update_job(paths, job_id, progress=22, stage="normalizing_audio")
        normalize_audio(src, norm)
        song_duration = probe_duration(norm)

        update_job(paths, job_id, progress=42, stage="separating_vocals_demucs")
        stems = extract_stems_with_demucs(norm, temp)

        lyrics = (payload.get("custom_lyrics") or "").strip()
        extracted_lyrics = ""
        if not lyrics:
            update_job(paths, job_id, progress=56, stage="extracting_lyrics")
            extracted_lyrics = extract_lyrics_from_audio(
                stems["vocals"],
                temp,
                language=(payload.get("language") or "").strip(),
            )
            lyrics = extracted_lyrics

        lyrics_url = save_lyrics_text(paths, job_id, lyrics)

        if bool(payload.get("extract_lyrics_only")):
            return update_job(
                paths,
                job_id,
                status="completed",
                progress=100,
                stage="completed",
                output_url=None,
                lyrics=lyrics,
                lyrics_url=lyrics_url,
                notes=[
                    "Lyrics extracted from the uploaded audio. Edit these lyrics and submit them back as custom_lyrics for voice generation.",
                ],
                artifacts={
                    "source_audio": str(src),
                    "normalized_audio": str(norm),
                    "vocal_reference": str(stems["vocals"]),
                    "instrumental": str(stems["instrumental"]),
                    "lyrics_source": "whisper_vocals",
                },
            )

        tts = temp / "tts_arranged.wav"
        update_job(paths, job_id, progress=68, stage="synthesizing_voice")
        phrase_map = generate_arranged_tts_audio(
            lyrics,
            stems["vocals"],
            temp,
            tts,
            song_duration,
            payload=payload,
        )

        mixed = temp / "mixed.wav"
        update_job(paths, job_id, progress=86, stage="mixing_song")
        mix_song(stems["instrumental"], tts, mixed)

        out = paths.outputs_dir / f"{job_id}.mp3"
        update_job(paths, job_id, progress=95, stage="exporting_final_song")
        run_ffmpeg([
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mixed),
            "-codec:a",
            "libmp3lame",
            str(out),
        ])

        return update_job(
            paths,
            job_id,
            status="completed",
            progress=100,
            stage="completed",
            output_url=f"/static/music_outputs/{out.name}",
            lyrics=lyrics,
            lyrics_url=lyrics_url,
            notes=[
                "Lyrics were user-supplied." if payload.get("custom_lyrics") else "Lyrics were extracted automatically and then synthesized.",
            ],
            artifacts={
                "source_audio": str(src),
                "normalized_audio": str(norm),
                "instrumental": str(stems["instrumental"]),
                "vocal_reference": str(stems["vocals"]),
                "arranged_tts": str(tts),
                "mixed_audio": str(mixed),
                "phrase_map": phrase_map,
                "voice_engine": phrase_map[0]["engine"] if phrase_map else "unknown",
                "voice_id": elevenlabs_voice_id(payload) if elevenlabs_available(payload) else None,
                "lyrics_source": "user" if payload.get("custom_lyrics") else "whisper_vocals",
            },
        )

    except Exception as e:
        update_job(paths, job_id, status="failed", stage="failed", error=str(e))
        raise
