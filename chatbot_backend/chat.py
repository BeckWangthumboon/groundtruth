"""
Chat API logic: Gemini conversation, ranking, weights/keywords parsing.
"""

import re
from typing import Any

try:
    from .config import GOOGLE_GENERATIVE_AI_API_KEY
    from .chat_config import (
        DEFAULT_WEIGHTS,
        METRIC_IDS,
        build_system_instruction,
        Focus,
        Weights,
    )
    from .rank import rank_locations
    from .weights import parse_weights_from_reply
    from .keywords import parse_map_keywords_from_reply, write_keywords_to_file
except ImportError:
    from config import GOOGLE_GENERATIVE_AI_API_KEY
    from chat_config import (
        DEFAULT_WEIGHTS,
        METRIC_IDS,
        build_system_instruction,
        Focus,
        Weights,
    )
    from rank import rank_locations
    from weights import parse_weights_from_reply
    from keywords import parse_map_keywords_from_reply, write_keywords_to_file

MAX_HISTORY_TURNS = 10


def _is_rank_request(message: str) -> bool:
    lower = message.lower().strip()
    if re.search(r"rank\s*(them|these|my|the)", lower):
        return True
    if re.search(r"what'?s\s+the\s+best", lower):
        return True
    if re.search(r"which\s+(one\s+)?(best|first)", lower):
        return True
    if re.search(r"order\s+(them|these)", lower):
        return True
    return False


def chat(
    message: str,
    conversation_history: list[dict[str, str]],
    focus: str,
    weights: Weights | None = None,
    use_defaults: bool = True,
    locations_with_metrics: list[dict] | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """
    Process one chat turn. Returns dict with:
      reply: str
      weights?: Weights
      rankedIds?: list[str]
      mapKeywords?: list[str]
    """
    key = api_key or GOOGLE_GENERATIVE_AI_API_KEY
    if not key:
        raise ValueError("Missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY")

    if not message or not isinstance(message, str):
        raise ValueError("message is required")
    if focus not in ("tenant", "small_business"):
        raise ValueError("focus must be tenant or small_business")

    focus_typed: Focus = focus
    if use_defaults or not weights or len(weights) == 0:
        weights = DEFAULT_WEIGHTS[focus_typed].copy()
    else:
        weights = dict(weights)

    import google.generativeai as genai
    genai.configure(api_key=key)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=build_system_instruction(focus_typed, locations_with_metrics),
    )

    history = conversation_history[-MAX_HISTORY_TURNS * 2 :] if conversation_history else []
    history_for_api = []
    for msg in history:
        role = "model" if msg.get("role") == "assistant" else "user"
        history_for_api.append({"role": role, "parts": [msg.get("content", "")]})
    history_for_api.append({"role": "user", "parts": [message]})

    ranked_ids: list[str] | None = None

    if (
        locations_with_metrics
        and len(locations_with_metrics) >= 2
        and _is_rank_request(message)
    ):
        metric_ids = list(METRIC_IDS)
        ranked = rank_locations(locations_with_metrics, weights, metric_ids)
        ranked_ids = [loc.get("id", "") for loc in ranked]
        rank_summary = ", ".join(
            f"#{i+1}: {loc.get('label') or loc.get('id', '')}" for i, loc in enumerate(ranked)
        )
        prompt_why = (
            f"The user asked to rank these locations. Here is the ranked order: {rank_summary}. "
            f"In 2-3 sentences, explain why the first location ranks best given their priorities "
            f"(weights: {weights}). Use only the metric values from the context."
        )
        chat_session = model.start_chat(history=history_for_api[:-1])
        response = chat_session.send_message(prompt_why)
        reply = (response.text or f"Ranked order: {rank_summary}.").strip()
    else:
        chat_session = model.start_chat(history=history_for_api[:-1])
        response = chat_session.send_message(message)
        reply = (response.text or "").strip()

    parsed_weights = parse_weights_from_reply(reply)
    map_keywords = parse_map_keywords_from_reply(reply)
    if map_keywords:
        write_keywords_to_file(map_keywords, {"source": message})

    result: dict[str, Any] = {"reply": reply}
    if parsed_weights:
        result["weights"] = parsed_weights
    if ranked_ids is not None:
        result["rankedIds"] = ranked_ids
    if map_keywords:
        result["mapKeywords"] = map_keywords
    return result
