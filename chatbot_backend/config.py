# API keys: load from .env at project root when backend starts.
# Fallbacks keep existing behavior if env is unset.

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    _project_root = Path(__file__).resolve().parents[1]
    load_dotenv(_project_root / ".env")
except (ImportError, OSError):
    pass

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
