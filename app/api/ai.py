from fastapi import APIRouter, HTTPException
from app.services.claude_service import build_timed_lyrics_prompt, rewrite_lyrics

router = APIRouter()

@router.post("/ai/rewrite-lyrics")
def ai_rewrite(data: dict):
    lyrics = (data.get("lyrics") or data.get("user_lyrics") or "").strip()
    prompt = data.get("prompt")
    if lyrics:
        prompt = build_timed_lyrics_prompt(lyrics)
    if not prompt:
        prompt = build_timed_lyrics_prompt("Rewrite this song lyrics")
    try:
        result = rewrite_lyrics(prompt)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {
        "status": "success",
        "lyrics": result
    }
