import os


def build_timed_lyrics_prompt(user_lyrics: str) -> str:
    lyrics = (user_lyrics or "").strip()
    return f"""Rewrite these lyrics to match musical timing.

Rules:
- Each line must be SHORT (4-7 syllables)
- Keep rhythm consistent
- Make it singable
- Add natural pauses
- Group into verse/chorus

Lyrics:
{lyrics}
"""


def rewrite_lyrics(prompt: str) -> str:
    try:
        import anthropic
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "The 'anthropic' package is not installed. Install it in the active environment to use lyric rewriting."
        ) from exc

    api_key = os.getenv("ANTHROPIC_API_KEY" )
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-3-opus-20240229",
        max_tokens=300,
        messages=[
            {"role": "user", "content": prompt}
        ],
    )
    return response.content[0].text
