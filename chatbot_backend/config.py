# API keys: load from .env at project root when backend starts.
# Uses same .env loading as googletts.py demo so TTS key is found reliably.

import os
from pathlib import Path

_project_root = Path(__file__).resolve().parents[1]


def _load_dotenv() -> None:
    """Load .env from project root or cwd (matches googletts.py behavior)."""
    for path in (_project_root / ".env", Path.cwd() / ".env"):
        if path.is_file():
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        v = v.strip().strip('"').strip("'")
                        os.environ.setdefault(k.strip(), v)
            break


_load_dotenv()

GOOGLE_GENERATIVE_AI_API_KEY = (os.getenv(
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "YOUR_GEMINI_OR_GENERATIVE_AI_KEY_HERE",
) or "").strip()
GOOGLE_CLOUD_TTS_API_KEY = (os.getenv(
    "GOOGLE_CLOUD_TTS_API_KEY",
    "YOUR_GOOGLE_CLOUD_TTS_API_KEY_HERE",
) or "").strip()

# Chat model. For faster responses use gemini-2.5-flash-lite or gemini-2.0-flash (set in .env).
# Default: gemini-2.5-flash
GEMINI_CHAT_MODEL = (os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash").strip()  # noqa: E501

# When True, we use reasoning UI (prompt for ```reasoning block, return it). Set from model name.
SUPPORTS_REASONING_UI = "pro" in GEMINI_CHAT_MODEL.lower()
