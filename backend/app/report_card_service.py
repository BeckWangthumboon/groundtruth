from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from difflib import get_close_matches
from typing import Any

from .schemas import (
    PoiCategoryBreakdown,
    PoiReportCardRequest,
    PoiReportCardResponse,
    PoiReportDimensions,
    ReportScore,
)

REPORT_CARD_MODEL = "gemini-3-flash-preview"
DEFAULT_TIMEOUT_SECONDS = 25.0

DIMENSION_LABELS = {
    "food_availability": "Food Availability",
    "nightlife": "Nightlife",
    "stores": "Stores",
    "walkability": "Walkability",
    "public_services": "Public Services",
    "transit_access": "Transit Access",
    "recreation": "Recreation",
    "healthcare_access": "Healthcare Access",
}

SCORE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 1, "maximum": 10},
        "reason": {"type": "string", "minLength": 1, "maxLength": 300},
    },
    "required": ["score", "reason"],
    "additionalProperties": False,
}

REPORT_CARD_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "overall": SCORE_SCHEMA,
        "dimensions": {
            "type": "object",
            "properties": {key: SCORE_SCHEMA for key in DIMENSION_LABELS},
            "required": list(DIMENSION_LABELS.keys()),
            "additionalProperties": False,
        },
        "poi_categories": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "minLength": 1, "maxLength": 120},
                    "count": {"type": "integer", "minimum": 0},
                    "share_pct": {"type": "number", "minimum": 0, "maximum": 100},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 260},
                },
                "required": ["category", "count", "share_pct", "reason"],
                "additionalProperties": False,
            },
            "minItems": 1,
            "maxItems": 15,
        },
    },
    "required": ["overall", "dimensions", "poi_categories"],
    "additionalProperties": False,
}


class MissingAPIKeyError(RuntimeError):
    """Raised when GEMINI_API_KEY is not configured."""


class ReportCardTimeoutError(RuntimeError):
    """Raised when Gemini response times out."""


class ReportCardProviderError(RuntimeError):
    """Raised when Gemini request/response handling fails."""


def _build_prompt(payload: PoiReportCardRequest) -> str:
    grouped = [
        {
            "key": group.key,
            "label": group.label,
            "count": group.count,
            "share_pct": round((group.count / payload.total_places) * 100, 1)
            if payload.total_places > 0
            else 0.0,
        }
        for group in sorted(payload.groups, key=lambda item: (-item.count, item.label.lower()))
    ]

    rubric = (
        "Score meaning (1-10 integers only): "
        "1-2 very weak, 3-4 weak, 5-6 moderate, 7-8 strong, 9-10 exceptional."
    )

    return (
        "You are evaluating neighborhood amenities from aggregated POI counts only.\n"
        "Use ONLY the provided data. Do not use outside knowledge, geography assumptions, or demographics.\n"
        "Return JSON that matches the provided schema exactly.\n"
        "Each reason must be concise, one sentence, and grounded in observed POI distribution.\n"
        "For poi_categories, category must match one of the provided group labels exactly.\n\n"
        f"{rubric}\n\n"
        "Dimensions to score exactly:\n"
        "- food_availability\n"
        "- nightlife\n"
        "- stores\n"
        "- walkability\n"
        "- public_services\n"
        "- transit_access\n"
        "- recreation\n"
        "- healthcare_access\n\n"
        "Input data:\n"
        + json.dumps(
            {
                "location_label": payload.location_label,
                "isochrone_profile": payload.isochrone_profile,
                "total_places": payload.total_places,
                "groups": grouped,
                "reachability": payload.reachability,
            },
            ensure_ascii=True,
            indent=2,
        )
    )


def _extract_text_from_response(response: Any) -> str | None:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text

    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        if isinstance(parsed, str):
            return parsed
        if isinstance(parsed, dict):
            return json.dumps(parsed)

    candidates = getattr(response, "candidates", None)
    if not isinstance(candidates, list):
        return None

    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None)
        if not isinstance(parts, list):
            continue
        for part in parts:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                return part_text
    return None


def _call_gemini_structured(prompt: str, api_key: str, model_name: str) -> dict[str, Any]:
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:  # pragma: no cover - import environment specific
        raise ReportCardProviderError(
            "google-genai dependency is not available. Install `google-genai`."
        ) from exc

    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
                response_json_schema=REPORT_CARD_JSON_SCHEMA,
            ),
        )
    except Exception as exc:
        raise ReportCardProviderError(f"Gemini request failed: {exc}") from exc

    response_text = _extract_text_from_response(response)
    if not response_text:
        raise ReportCardProviderError("Gemini returned an empty response body.")

    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ReportCardProviderError("Gemini returned non-JSON structured output.") from exc

    if not isinstance(payload, dict):
        raise ReportCardProviderError("Gemini response JSON must be an object.")
    return payload


def _to_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def _normalize_reason(value: Any, fallback: str, max_len: int) -> str:
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned:
            return cleaned[:max_len]
    return fallback


def _normalize_score_block(
    raw_value: Any,
    fallback_reason: str,
) -> ReportScore:
    raw = raw_value if isinstance(raw_value, dict) else {}
    score_value = _to_int(raw.get("score"))
    if score_value is None:
        score_value = 5
    score_value = min(10, max(1, score_value))

    return ReportScore(
        score=score_value,
        reason=_normalize_reason(raw.get("reason"), fallback_reason, 300),
    )


def _resolve_category_name(candidate: Any, allowed_labels: list[str]) -> str | None:
    if not isinstance(candidate, str):
        return None
    cleaned = candidate.strip()
    if not cleaned:
        return None

    exact = {label: label for label in allowed_labels}
    if cleaned in exact:
        return cleaned

    lower_map = {label.lower(): label for label in allowed_labels}
    lower = cleaned.lower()
    if lower in lower_map:
        return lower_map[lower]

    close = get_close_matches(lower, lower_map.keys(), n=1, cutoff=0.82)
    if close:
        return lower_map[close[0]]
    return None


def _normalize_poi_categories(
    raw_entries: Any,
    request_payload: PoiReportCardRequest,
) -> list[PoiCategoryBreakdown]:
    groups_by_label = {group.label: group for group in request_payload.groups}
    allowed_labels = list(groups_by_label.keys())
    total_places = request_payload.total_places

    normalized: dict[str, PoiCategoryBreakdown] = {}
    if isinstance(raw_entries, list):
        for entry in raw_entries:
            if not isinstance(entry, dict):
                continue
            category = _resolve_category_name(entry.get("category"), allowed_labels)
            if not category or category in normalized:
                continue

            default_count = groups_by_label[category].count
            count = _to_int(entry.get("count"))
            if count is None or count < 0:
                count = default_count
            if total_places > 0:
                count = min(count, total_places)

            share = _to_float(entry.get("share_pct"))
            if share is None:
                share = round((count / total_places) * 100, 1) if total_places > 0 else 0.0
            share = min(100.0, max(0.0, round(share, 1)))

            normalized[category] = PoiCategoryBreakdown(
                category=category,
                count=count,
                share_pct=share,
                reason=_normalize_reason(
                    entry.get("reason"),
                    f"{category} is meaningfully represented in nearby POIs.",
                    260,
                ),
            )

    if normalized:
        return sorted(normalized.values(), key=lambda item: (-item.count, item.category.lower()))

    fallbacks = []
    for group in sorted(request_payload.groups, key=lambda item: (-item.count, item.label.lower()))[:8]:
        share = round((group.count / total_places) * 100, 1) if total_places > 0 else 0.0
        fallbacks.append(
            PoiCategoryBreakdown(
                category=group.label,
                count=group.count,
                share_pct=share,
                reason=f"{group.label} appears frequently in the nearby place mix.",
            )
        )
    return fallbacks


def _normalize_report_payload(
    raw_payload: dict[str, Any],
    request_payload: PoiReportCardRequest,
    model_name: str,
) -> PoiReportCardResponse:
    overall = _normalize_score_block(
        raw_payload.get("overall"),
        "Overall score estimated from the provided POI distribution.",
    )

    raw_dimensions = raw_payload.get("dimensions", {})
    if not isinstance(raw_dimensions, dict):
        raw_dimensions = {}

    dimension_payload = {
        key: _normalize_score_block(
            raw_dimensions.get(key),
            f"{label} score derived from available POI categories.",
        )
        for key, label in DIMENSION_LABELS.items()
    }
    dimensions = PoiReportDimensions(**dimension_payload)

    poi_categories = _normalize_poi_categories(raw_payload.get("poi_categories"), request_payload)

    return PoiReportCardResponse(
        model=model_name,
        generated_at=datetime.now(timezone.utc),
        overall=overall,
        dimensions=dimensions,
        poi_categories=poi_categories,
    )


async def generate_poi_report_card(
    request_payload: PoiReportCardRequest,
    *,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    model_name: str = REPORT_CARD_MODEL,
) -> PoiReportCardResponse:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise MissingAPIKeyError("GEMINI_API_KEY is not configured on the backend.")

    prompt = _build_prompt(request_payload)
    try:
        raw_payload = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_structured, prompt, api_key, model_name),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise ReportCardTimeoutError(
            f"Gemini report card request timed out after {timeout_seconds:.0f}s."
        ) from exc

    return _normalize_report_payload(raw_payload, request_payload, model_name)
