# Vcreation backend

FastAPI backend for video uploads, splitting, editing, transcription, and music workflows. The existing API still uses the Clayme project name internally.

## Local setup (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload
```

Fill in `.env` with your own provider credentials. Never commit this file.
Install FFmpeg and ensure both `ffmpeg` and `ffprobe` are on PATH.
Run commands from this repository's root directory.

API documentation: http://127.0.0.1:8000/docs

The API allows local frontend origins on port 3000. The current application enables debug mode and is intended for local development; review authentication, CORS, and static file access before exposing it publicly.

## Optional media features

Install `faster-whisper` for subtitles and transcription. Place a compatible converted base model (including `model.bin`, `config.json`, and tokenizer files) in `static/models/faster-whisper-base/`. The application loads this model locally and does not download it automatically.

Install `demucs` for music stem separation. These features may also require PyTorch and additional model downloads. `replicate` supports Replicate integrations; provider calls require the corresponding environment variables. Some image and video generation functions currently remain placeholders.

The optional Node dependency in `package.json` can be installed with `npm ci` if needed; the FastAPI server runs through Python.

## Repository contents

Application code and branding assets are tracked. Virtual environments, Node dependencies, API keys, uploads, generated media, job records, temporary files, and downloaded models stay local. Runtime directories are created by the application.

`test_ai.py`, `test_ai_http.py`, and `app/test_ai.py` are manual integration scripts that can call paid external services. They are not an automated unit test suite; inspect and configure them before running.
