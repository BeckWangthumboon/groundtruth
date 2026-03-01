"""
Extract weights object from the model reply (markdown code block or raw JSON).
Normalizes so values sum to 1.
"""

import json
import re

try:
    from .chat_config import METRIC_IDS
except ImportError:
    from chat_config import METRIC_IDS

CANONICAL_SET = frozenset(METRIC_IDS)


def _extract_weights_from_object(obj: dict) -> dict[str, float] | None:
    if not obj or "weights" not in obj:
        return None
    w = obj["weights"]
    if not isinstance(w, dict) or not w:
        return None
    out: dict[str, float] = {}
    for key in w:
        if key in CANONICAL_SET:
            v = w[key]
            if isinstance(v, (int, float)) and not (v != v):
                out[key] = float(v)
    return out if out else None


def _normalize_weights(weights: dict[str, float] | None) -> dict[str, float] | None:
    if not weights:
        return None
    total = sum(weights.values())
    if total == 0:
        return None
    return {k: v / total for k, v in weights.items()}


def parse_weights_from_reply(reply: str) -> dict[str, float] | None:
    """
    Extract a "weights" object from the model reply.
    Returns None if none found or invalid. Normalizes so values sum to 1.
    """
    # Try markdown code block first
    code_block = re.search(r"```(?:json)?\s*([\s\S]*?)```", reply)
    to_parse = code_block.group(1).strip() if code_block else reply

    start = to_parse.find('"weights"')
    if start == -1:
        fallback = re.search(r'\{\s*["\']weights["\']\s*:\s*\{[^}]+\}\s*\}', to_parse)
        if not fallback:
            return None
        try:
            obj = json.loads(fallback.group(0))
            return _normalize_weights(_extract_weights_from_object(obj))
        except (json.JSONDecodeError, TypeError):
            return None

    # Find the opening "{" of the object that contains "weights" (outer brace before "weights")
    before = to_parse.rfind("{", 0, start + 1)
    if before == -1:
        return None
    end = before + 1
    count = 1
    while end < len(to_parse) and count > 0:
        c = to_parse[end]
        if c == "{":
            count += 1
        elif c == "}":
            count -= 1
        end += 1
    slice_str = to_parse[before:end]
    try:
        obj = json.loads(slice_str)
        return _normalize_weights(_extract_weights_from_object(obj))
    except (json.JSONDecodeError, TypeError):
        return None
