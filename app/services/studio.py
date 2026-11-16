"""Local-first filmmaking workflow. No provider request without an approved quote."""

import base64
import json
import os
import re
import shutil
import subprocess
import textwrap
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.services import studio_store as store


MEDIA = store.ROOT / "static" / "studio"
POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="vcreation")
TERMINAL = {"succeeded", "failed", "canceled", "interrupted"}


class ConfigurationError(ValueError):
    pass


def micros(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            raise ValueError("Cost must be finite and nonnegative")
        return int((amount * 1_000_000).to_integral_value())
    except InvalidOperation as exc:
        raise ConfigurationError("Invalid cost configuration") from exc


def provider_config():
    version = os.getenv("VCREATION_REPLICATE_VERSION", "").strip()
    raw_rate = os.getenv("VCREATION_VIDEO_USD_PER_SECOND", "").strip()
    rate = micros(raw_rate) if raw_rate else None
    enabled = (
        os.getenv("VCREATION_ENABLE_PAID_GENERATION", "false").lower()
        == "true"
    )

    ready = (
        enabled
        and bool(os.getenv("REPLICATE_API_TOKEN"))
        and bool(re.fullmatch(r"[a-f0-9]{64}", version))
        and rate is not None
        and rate > 0
    )

    return {
        "ready": ready,
        "version": version,
        "rate_micros": rate,
        "duration_field": os.getenv(
            "VCREATION_DURATION_FIELD", "duration"
        ),
        "image_field": os.getenv("VCREATION_IMAGE_FIELD", "image"),
        "image_mode": os.getenv("VCREATION_IMAGE_MODE", "single"),
        "extra_input": os.getenv("VCREATION_VIDEO_EXTRA_INPUT", "{}"),
    }


def capabilities():
    try:
        config = provider_config()
        ready = config["ready"]
        reason = (
            None
            if ready
            else (
                "Paid generation is off until a model version, input "
                "mapping, rate and server-side token are configured."
            )
        )
    except ValueError as exc:
        ready, reason = False, str(exc)

    return {
        "preview": {
            "ready": bool(
                shutil.which("ffmpeg") and shutil.which("ffprobe")
            ),
            "label": (
                "Local animatic — still boards, no AI motion "
                "or generated speech"
            ),
        },
        "replicate": {
            "ready": ready,
            "reason": reason,
        },
        "cost_notice": (
            "USD estimates are operator-configured, not provider quotes "
            "or a billing cap. Actual charges require reconciliation."
        ),
        "deployment": (
            "Local single-user workspace. Do not expose this API publicly "
            "without authentication and private media storage."
        ),
    }


def initialize():
    store.init_database()
    MEDIA.mkdir(parents=True, exist_ok=True)

    # Never automatically resubmit a possibly billable request.
    with store.transaction() as db:
        db.execute(
            """
            UPDATE jobs
            SET status='interrupted', error=?, updated_at=?
            WHERE status IN ('queued','running')
            """,
            (
                "Server restarted. No automatic resubmission was made. "
                "Reconcile any provider prediction before creating "
                "another take.",
                store.now(),
            ),
        )


def local_image(ref):
    if not ref or not ref.startswith("/static/studio/references/"):
        raise ValueError("Choose a reference uploaded to this studio")

    root = (MEDIA / "references").resolve()
    path = (store.ROOT / ref.lstrip("/")).resolve()

    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Reference image not found")

    return path


def save_reference(data):
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError("Upload a PNG, JPEG or WebP image up to 10 MB")

    from io import BytesIO

    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("Upload a PNG, JPEG or WebP image")

            if source.width * source.height > 25_000_000:
                raise ValueError("Image exceeds 25 megapixels")

            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600))

    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Unreadable image") from exc

    directory = MEDIA / "references"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{store.identifier()}.jpg"
    image.save(path, "JPEG", quality=90)

    return f"/static/studio/references/{path.name}"


def snapshot(db, shot_id, provider):
    shot = store.one(db, "shots", shot_id)
    actors = []

    for actor_id in json.loads(shot["character_ids"]):
        actor = store.one(db, "characters", actor_id)

        if actor["project_id"] != shot["project_id"]:
            raise ValueError("Character belongs to another project")

        actors.append(actor)

    config = provider_config() if provider == "replicate" else {}

    if provider == "replicate" and not config["ready"]:
        raise ConfigurationError(
            "Paid generation is not configured or is disabled"
        )

    # Never store API tokens or authorization headers in snapshots.
    return {
        "shot": {
            key: value
            for key, value in shot.items()
            if key not in {"selected_take_id", "approved"}
        },
        "characters": actors,
        "provider": provider,
        "config": config,
    }


def encoded(data):
    return json.dumps(data, sort_keys=True, ensure_ascii=False)


def quote(shot_id, provider):
    with store.transaction() as db:
        data = snapshot(db, shot_id, provider)

        if not store.one(db, "shots", shot_id)["approved"]:
            raise ValueError(
                "Approve the storyboard shot before requesting a take"
            )

        if (
            provider == "preview"
            and not capabilities()["preview"]["ready"]
        ):
            raise ConfigurationError(
                "Install FFmpeg and ffprobe to render local previews"
            )

        if provider == "replicate":
            if not shutil.which("ffprobe"):
                raise ConfigurationError(
                    "Install ffprobe before submitting paid video"
                )

            provider_input(data)

        estimate = (
            0
            if provider == "preview"
            else (
                data["shot"]["duration"]
                * data["config"]["rate_micros"]
            )
        )

        quote_id = store.identifier()

        store.insert(
            db,
            "quotes",
            {
                "id": quote_id,
                "project_id": data["shot"]["project_id"],
                "shot_id": shot_id,
                "provider": provider,
                "estimate_micros": estimate,
                "snapshot": encoded(data),
                "expires_at": time.time() + 600,
            },
        )

    return {
        "id": quote_id,
        "estimated_usd": estimate / 1_000_000,
        "currency": "USD",
        "provider": provider,
        "expires_in_seconds": 600,
        "notice": (
            "No job submitted. This is an estimate, not an actual "
            "charge or billing cap."
        ),
    }


def create_take(shot_id, quote_id, request_id):
    fingerprint = f"take:{shot_id}:{quote_id}"

    with store.transaction() as db:
        previous = db.execute(
            "SELECT * FROM jobs WHERE request_id=?",
            (request_id,),
        ).fetchone()

        if previous:
            if previous["fingerprint"] != fingerprint:
                raise ValueError(
                    "Request ID was already used for a different operation"
                )
            return store.public_job(dict(previous))

        proposal = store.one(db, "quotes", quote_id)

        if (
            proposal["shot_id"] != shot_id
            or proposal["used_by"]
            or proposal["expires_at"] < time.time()
        ):
            raise ValueError(
                "Quote is expired, already used, or belongs to another shot"
            )

        current = snapshot(db, shot_id, proposal["provider"])

        if (
            encoded(current) != proposal["snapshot"]
            or not store.one(db, "shots", shot_id)["approved"]
        ):
            raise ValueError(
                "Shot, cast or provider settings changed. "
                "Review and quote again"
            )

        project = store.one(db, "projects", proposal["project_id"])

        reserved = db.execute(
            """
            SELECT COALESCE(SUM(reserved_micros),0)
            FROM jobs
            WHERE project_id=?
            """,
            (project["id"],),
        ).fetchone()[0]

        if (
            reserved + proposal["estimate_micros"]
            > project["budget_micros"]
        ):
            raise ValueError(
                "This take would exceed the project's "
                "estimated generation budget"
            )

        check_capacity(db)

        job = job_record(
            project["id"],
            "take",
            proposal["provider"],
            request_id,
            fingerprint,
            current,
            shot_id,
            proposal["estimate_micros"],
        )

        store.insert(db, "jobs", job)

        db.execute(
            "UPDATE quotes SET used_by=? WHERE id=?",
            (job["id"], quote_id),
        )

    POOL.submit(run_take, job["id"])
    return store.public_job(job)


def check_capacity(db):
    active = db.execute(
        """
        SELECT COUNT(*)
        FROM jobs
        WHERE status IN ('queued','running')
        """
    ).fetchone()[0]

    if active >= 8:
        raise ValueError(
            "Render queue is full. Wait for a running job to finish"
        )


def job_record(
    project_id,
    kind,
    provider,
    request_id,
    fingerprint,
    data,
    shot_id=None,
    estimate=0,
):
    return {
        "id": store.identifier(),
        "project_id": project_id,
        "shot_id": shot_id,
        "kind": kind,
        "provider": provider,
        "status": "queued",
        "estimate_micros": estimate,
        "reserved_micros": estimate,
        "actual_micros": 0 if provider == "preview" else None,
        "billing_reference": None,
        "provider_id": None,
        "output_url": None,
        "error": None,
        "snapshot": encoded(data),
        "request_id": request_id,
        "fingerprint": fingerprint,
        "created_at": store.now(),
        "updated_at": store.now(),
    }


def get_job(job_id):
    with store.connect() as db:
        return store.public_job(store.one(db, "jobs", job_id))


def run_command(command, timeout=180):
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    if result.returncode:
        raise RuntimeError(
            "Media processing failed. "
            "Check FFmpeg availability and source media."
        )


def board(data, path):
    image = Image.new("RGB", (1280, 720), "#101729")
    draw = ImageDraw.Draw(image)

    def font(size):
        for candidate in ("DejaVuSans.ttf", "Arial.ttf"):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue

        return ImageFont.load_default(size=size)

    draw.text(
        (48, 30),
        "VCREATION / LOCAL ANIMATIC",
        fill="#66e6d1",
        font=font(23),
    )

    draw.text(
        (48, 78),
        data["shot"]["title"][:55],
        fill="white",
        font=font(35),
    )

    actors = data["characters"][:5]

    for index, actor in enumerate(actors):
        x = 48 + index * 237

        if actor.get("image_path"):
            with Image.open(local_image(actor["image_path"])) as source:
                image.paste(
                    ImageOps.fit(source.convert("RGB"), (210, 240)),
                    (x, 160),
                )
        else:
            draw.rounded_rectangle(
                (x, 160, x + 210, 400),
                radius=14,
                fill="#263750",
            )

            draw.text(
                (x + 22, 235),
                actor["name"][:12],
                fill="#b8c9e4",
                font=font(22),
            )

        draw.text(
            (x, 412),
            actor["name"][:17],
            fill="white",
            font=font(20),
        )

    text = data["shot"]["dialogue"] or data["shot"]["prompt"]

    draw.multiline_text(
        (48, 480),
        "\n".join(textwrap.wrap(text, 85)[:5]),
        fill="#d5deed",
        font=font(23),
        spacing=9,
    )

    draw.text(
        (48, 670),
        "Storyboard preview only / No AI motion, acting or speech / "
        "Provider charge: $0",
        fill="#92a6c1",
        font=font(18),
    )

    image.save(path)


def render_preview(data, job_id):
    frame = MEDIA / f"{job_id}.png"
    output = MEDIA / f"{job_id}.mp4"

    board(data, frame)

    run_command([
        "ffmpeg",
        "-v", "error",
        "-y",
        "-loop", "1",
        "-framerate", "24",
        "-i", str(frame),
        "-f", "lavfi",
        "-i", "anullsrc=r=48000:cl=stereo",
        "-t", str(data["shot"]["duration"]),
        "-c:v", "libx264",
        "-threads", "2",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-shortest",
        str(output),
    ])

    return f"/static/studio/{output.name}"


def provider_input(data):
    shot = data["shot"]
    config = data["config"]
    payload = json.loads(config["extra_input"])

    if not isinstance(payload, dict):
        raise ConfigurationError(
            "VCREATION_VIDEO_EXTRA_INPUT must be a JSON object"
        )

    actors = "\n".join(
        f"{actor['name']}: {actor['description']}. "
        f"Wardrobe: {actor['wardrobe']}. "
        f"Voice direction: {actor['voice_notes']}"
        for actor in data["characters"]
    )

    payload.update({
        "prompt": (
            f"{shot['prompt']}\n"
            f"CAST REFERENCES:\n{actors}\n"
            f"EXACT DIALOGUE:\n{shot['dialogue']}"
        ),
        config["duration_field"]: shot["duration"],
    })

    references = []

    for actor in data["characters"]:
        if actor.get("image_path"):
            raw = local_image(actor["image_path"]).read_bytes()

            references.append(
                "data:image/jpeg;base64,"
                + base64.b64encode(raw).decode()
            )

    if references:
        if config["image_mode"] not in {"single", "list"}:
            raise ConfigurationError(
                "Image mode must be single or list"
            )

        if config["image_mode"] == "single" and len(references) > 1:
            raise ConfigurationError(
                "This model mapping accepts one reference. "
                "Configure a documented list input for multiple actor images"
            )

        payload[config["image_field"]] = (
            references
            if config["image_mode"] == "list"
            else references[0]
        )

    return payload


def replicate_video(data, job_id):
    if not provider_config()["ready"]:
        raise ConfigurationError(
            "Paid generation was disabled before this take started"
        )

    payload = provider_input(data)
    token = os.getenv("REPLICATE_API_TOKEN", "")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # A timeout can hide a successfully created, billable prediction.
    store.update_job(
        job_id,
        error="Provider submission pending; billing is not yet reconciled",
    )

    response = requests.post(
        "https://api.replicate.com/v1/predictions",
        headers=headers,
        json={
            "version": data["config"]["version"],
            "input": payload,
        },
        timeout=60,
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Provider rejected the request "
            f"(HTTP {response.status_code}). "
            "No automatic retry was made"
        )

    result = response.json()
    prediction_id = result.get("id", "")

    if not re.fullmatch(r"[a-zA-Z0-9_-]+", prediction_id):
        raise RuntimeError(
            "Provider response did not contain a prediction ID; "
            "inspect provider billing before retrying"
        )

    store.update_job(
        job_id,
        provider_id=prediction_id,
        error=None,
    )

    deadline = time.monotonic() + 900

    while result.get("status") not in {
        "succeeded",
        "failed",
        "canceled",
    }:
        if time.monotonic() > deadline:
            raise RuntimeError(
                "Provider wait timed out. Prediction ID retained; "
                "do not resubmit without checking the provider"
            )

        time.sleep(2)

        response = requests.get(
            f"https://api.replicate.com/v1/predictions/{prediction_id}",
            headers=headers,
            timeout=45,
        )

        response.raise_for_status()
        result = response.json()

    if result["status"] != "succeeded":
        raise RuntimeError(
            "Provider prediction did not succeed. "
            "Check the retained prediction ID and reconcile charges"
        )

    output = result.get("output")

    if isinstance(output, list):
        output = output[0] if output else None

    if isinstance(output, dict):
        output = output.get("video") or output.get("url")

    parsed = urlparse(output or "")

    allowed_host = (
        parsed.hostname == "replicate.delivery"
        or (parsed.hostname or "").endswith(".replicate.delivery")
    )

    if parsed.scheme != "https" or not allowed_host:
        raise RuntimeError(
            "Unsupported provider output. Prediction ID retained; "
            "no arbitrary output URL was fetched"
        )

    destination = MEDIA / f"{job_id}.mp4"

    try:
        with requests.get(
            output,
            stream=True,
            timeout=60,
            allow_redirects=False,
        ) as download:
            download.raise_for_status()

            if download.status_code != 200:
                raise RuntimeError(
                    "Provider output download requires "
                    "an unsupported redirect"
                )

            size = 0

            with destination.open("wb") as stream:
                for chunk in download.iter_content(1024 * 1024):
                    size += len(chunk)

                    if size > 300 * 1024 * 1024:
                        raise RuntimeError(
                            "Provider output exceeds 300 MB"
                        )

                    stream.write(chunk)

        run_command([
            "ffprobe",
            "-v", "error",
            str(destination),
        ])

    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return f"/static/studio/{destination.name}"


def run_take(job_id):
    data = get_job(job_id)["snapshot"]
    store.update_job(job_id, status="running")

    try:
        output = (
            render_preview(data, job_id)
            if data["provider"] == "preview"
            else replicate_video(data, job_id)
        )

        store.update_job(
            job_id,
            status="succeeded",
            output_url=output,
            error=None,
        )

    except Exception as exc:
        # Retain paid reservations after uncertain failures.
        message = (
            str(exc)
            if isinstance(exc, (ValueError, RuntimeError))
            else (
                "Generation failed; check configuration and the "
                "retained provider ID before retrying"
            )
        )

        store.update_job(
            job_id,
            status="failed",
            error=message[:1000],
        )


def create_export(project_id, request_id):
    fingerprint = f"export:{project_id}"

    with store.transaction() as db:
        previous = db.execute(
            "SELECT * FROM jobs WHERE request_id=?",
            (request_id,),
        ).fetchone()

        if previous:
            if previous["fingerprint"] != fingerprint:
                raise ValueError(
                    "Request ID was already used for another operation"
                )

            return store.public_job(dict(previous))

        store.one(db, "projects", project_id)

        shots = [
            dict(row)
            for row in db.execute(
                """
                SELECT * FROM shots
                WHERE project_id=?
                ORDER BY position
                """,
                (project_id,),
            )
        ]

        if not shots:
            raise ValueError("Add and approve at least one shot first")

        takes = []

        for shot in shots:
            if not shot["approved"] or not shot["selected_take_id"]:
                raise ValueError(
                    "Approve every shot and select a successful "
                    "take for each before exporting"
                )

            take = store.one(db, "jobs", shot["selected_take_id"])

            if (
                take["status"] != "succeeded"
                or take["shot_id"] != shot["id"]
            ):
                raise ValueError("Selected take is not ready")

            takes.append({
                "url": take["output_url"],
                "take_id": take["id"],
                "dialogue": json.loads(take["snapshot"])["shot"]["dialogue"],
            })

        check_capacity(db)

        contains_animatic = any(
            store.one(db, "jobs", take["take_id"])["provider"] == "preview"
            for take in takes
        )

        job = job_record(
            project_id,
            "export",
            "preview",
            request_id,
            fingerprint,
            {
                "takes": takes,
                "contains_animatic": contains_animatic,
            },
        )

        store.insert(db, "jobs", job)

    POOL.submit(run_export, job["id"])
    return store.public_job(job)


def media_path(url):
    if not url.startswith("/static/studio/"):
        raise ValueError("Export accepts only studio take files")

    path = (store.ROOT / url.lstrip("/")).resolve()

    if not path.is_relative_to(MEDIA.resolve()) or not path.is_file():
        raise ValueError("Take media is missing")

    return path


def run_export(job_id):
    store.update_job(job_id, status="running")
    directory = MEDIA / f"tmp_{job_id}"
    directory.mkdir(parents=True, exist_ok=True)

    try:
        data = get_job(job_id)["snapshot"]
        clips = []
        captions = []
        offset = 0.0

        for index, take in enumerate(data["takes"]):
            source = media_path(take["url"])

            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v", "error",
                    "-show_streams",
                    "-show_format",
                    "-of", "json",
                    str(source),
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=30,
            )

            meta = json.loads(probe.stdout)
            duration = float(meta["format"]["duration"])
            target = directory / f"clip_{index}.mp4"

            has_audio = any(
                stream["codec_type"] == "audio"
                for stream in meta["streams"]
            )

            command = [
                "ffmpeg",
                "-v", "error",
                "-y",
                "-i", str(source),
            ]

            if not has_audio:
                command += [
                    "-f", "lavfi",
                    "-i", "anullsrc=r=48000:cl=stereo",
                ]

            command += [
                "-map", "0:v:0",
                "-map", "0:a:0" if has_audio else "1:a:0",
                "-t", str(duration),
                "-vf",
                (
                    "scale=1280:720:force_original_aspect_ratio=decrease,"
                    "pad=1280:720:(ow-iw)/2:(oh-ih)/2,"
                    "setsar=1,fps=24"
                ),
                "-c:v", "libx264",
                "-threads", "2",
                "-preset", "ultrafast",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-ar", "48000",
                "-ac", "2",
                str(target),
            ]

            run_command(command)
            clips.append(target)

            if take["dialogue"]:
                captions.append(
                    f"{len(captions) + 1}\n"
                    f"{srt_time(offset)} --> "
                    f"{srt_time(offset + duration)}\n"
                    f"{take['dialogue']}\n"
                )

            offset += duration

        manifest = directory / "list.txt"

        manifest.write_text(
            "\n".join(
                f"file '{clip.name}'"
                for clip in clips
            ),
            encoding="utf-8",
        )

        output = MEDIA / f"{job_id}_film.mp4"

        run_command([
            "ffmpeg",
            "-v", "error",
            "-y",
            "-f", "concat",
            "-safe", "1",
            "-i", str(manifest),
            "-c", "copy",
            "-movflags", "+faststart",
            str(output),
        ])

        (MEDIA / f"{job_id}_dialogue.srt").write_text(
            "\n".join(captions),
            encoding="utf-8",
        )

        store.update_job(
            job_id,
            status="succeeded",
            output_url=f"/static/studio/{output.name}",
            error=None,
        )

    except Exception as exc:
        message = (
            str(exc)
            if isinstance(exc, (ValueError, RuntimeError))
            else (
                "Export failed. Check the selected takes "
                "and FFmpeg installation"
            )
        )

        store.update_job(
            job_id,
            status="failed",
            error=message[:1000],
        )

    finally:
        shutil.rmtree(directory, ignore_errors=True)


def srt_time(seconds):
    millis = round(seconds * 1000)

    return (
        f"{millis // 3600000:02}:"
        f"{millis // 60000 % 60:02}:"
        f"{millis // 1000 % 60:02},"
        f"{millis % 1000:03}"
    )