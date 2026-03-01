"""
Parse map_query_keywords from the LLM reply and persist to keywords_llm/.
"""

import json
import re
from datetime import datetime
from pathlib import Path

KEYWORDS_DIR = "keywords_llm"


def parse_map_keywords_from_reply(reply: str) -> list[str] | None:
    """
    Extract map_query_keywords from a markdown code block in the reply.
    Looks for ```json { "map_query_keywords": [...] } ``` or similar.
    """
    for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", reply):
        raw = (match.group(1) or "").strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and "map_query_keywords" in obj:
                arr = obj["map_query_keywords"]
                if isinstance(arr, list) and arr:
                    keywords = [k.strip() for k in arr if isinstance(k, str) and k.strip()]
                    return keywords if keywords else None
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def write_keywords_to_file(
    keywords: list[str],
    options: dict | None = None,
) -> str | None:
    """
    Write keywords to keywords_llm/<timestamp>.json and optionally keywords_llm/latest.json.
    Returns the filepath of the timestamped file, or None on failure.
    """
    options = options or {}
    dir_path = Path(KEYWORDS_DIR)
    try:
        dir_path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
    payload = {
        "map_query_keywords": keywords,
        "source": options.get("source"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    filename = f"keywords_{timestamp}.json"
    filepath = dir_path / filename
    try:
        filepath.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        return None

    latest_path = dir_path / "latest.json"
    try:
        latest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass  # non-fatal

    return str(filepath)
