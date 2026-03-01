from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

CENSUS_GEOCODER_COORDINATES_URL = (
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
)
CENSUS_REPORTER_BASE_URL = "https://api.censusreporter.org"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
NO_RELEASES_MARKERS = (
    "none of the releases had",
    "requested geo_ids",
)

TABLE_IDS = [
    "B01003",
    "B01002",
    "B01001",
    "B03002",
    "B19013",
    "B19301",
    "B19001",
    "B17001",
    "B23025",
    "B25001",
    "B25002",
    "B25003",
    "B25024",
    "B25064",
    "B25077",
    "B25075",
    "B08301",
    "B08303",
    "B08013",
    "B15003",
    "B05002",
    "B05006",
    "B07003",
    "B11001",
    "B25010",
    "B12001",
    "B13016",
    "B21001",
    "B16001",
]

KEY_TABLE_EXAMPLES = [
    "B01003",
    "B01002",
    "B19013",
    "B19301",
    "B25077",
    "B25064",
    "B08301",
    "B15003",
    "B17001",
]


@dataclass(frozen=True)
class ApiConfig:
    acs: str
    timeout: float = 20.0
    retries: int = 3


class UpstreamAPIError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(f"[{stage}] {message}")
        self.stage = stage
        self.message = message


class NoGeographyFoundError(RuntimeError):
    pass


def _backoff_seconds(attempt: int) -> float:
    return min(8.0, 0.5 * (2**attempt))


def _short_error_text(text: str, limit: int = 240) -> str:
    one_line = " ".join(text.split())
    if len(one_line) <= limit:
        return one_line
    return one_line[:limit] + "..."


def _looks_like_no_release_error(message: str) -> bool:
    lowered = message.lower()
    return all(marker in lowered for marker in NO_RELEASES_MARKERS)


def request_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None,
    stage: str,
    config: ApiConfig,
) -> dict[str, Any]:
    last_error: Exception | None = None
    headers = {"User-Agent": "groundtruth-fastapi/0.1"}
    for attempt in range(config.retries + 1):
        try:
            response = client.get(url, params=params, timeout=config.timeout, headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            if attempt < config.retries:
                time.sleep(_backoff_seconds(attempt))
                continue
            raise UpstreamAPIError(stage, f"Network error after retries: {exc!s}") from exc

        status = response.status_code
        if status in RETRYABLE_STATUS_CODES:
            last_error = UpstreamAPIError(
                stage, f"HTTP {status}: {_short_error_text(response.text)}"
            )
            if attempt < config.retries:
                time.sleep(_backoff_seconds(attempt))
                continue
            raise last_error

        if 400 <= status < 500:
            raise UpstreamAPIError(stage, f"HTTP {status}: {_short_error_text(response.text)}")

        try:
            return response.json()
        except ValueError as exc:
            raise UpstreamAPIError(
                stage, f"Invalid JSON in upstream response (HTTP {status})"
            ) from exc

    if last_error is not None:
        raise UpstreamAPIError(stage, f"Failed request after retries: {last_error!s}")
    raise UpstreamAPIError(stage, "Failed request after retries.")


def fetch_data_show(
    client: httpx.Client,
    *,
    acs: str,
    table_ids: list[str],
    geoid: str,
    stage: str,
    config: ApiConfig,
) -> dict[str, Any]:
    url = f"{CENSUS_REPORTER_BASE_URL}/1.0/data/show/{acs}"
    params = {
        "table_ids": ",".join(table_ids),
        "geo_ids": geoid,
    }
    return request_json(client, url, params=params, stage=stage, config=config)


def new_empty_data_show_payload() -> dict[str, Any]:
    return {
        "release": None,
        "tables": {},
        "geography": {},
        "data": {},
    }


def merge_data_show_payload(base: dict[str, Any], incoming: dict[str, Any]) -> None:
    if base.get("release") is None and incoming.get("release") is not None:
        base["release"] = incoming.get("release")

    incoming_tables = incoming.get("tables")
    if isinstance(incoming_tables, dict):
        base_tables = base.setdefault("tables", {})
        if isinstance(base_tables, dict):
            base_tables.update(incoming_tables)

    incoming_geography = incoming.get("geography")
    if isinstance(incoming_geography, dict):
        base_geography = base.setdefault("geography", {})
        if isinstance(base_geography, dict):
            base_geography.update(incoming_geography)

    incoming_data = incoming.get("data")
    if isinstance(incoming_data, dict):
        base_data = base.setdefault("data", {})
        if isinstance(base_data, dict):
            for geoid, geoid_tables in incoming_data.items():
                if geoid not in base_data or not isinstance(base_data.get(geoid), dict):
                    base_data[geoid] = {}
                if isinstance(geoid_tables, dict):
                    base_data[geoid].update(geoid_tables)


def fetch_data_show_resilient(
    client: httpx.Client,
    *,
    acs: str,
    table_ids: list[str],
    geoid: str,
    stage: str,
    config: ApiConfig,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    try:
        payload = fetch_data_show(
            client,
            acs=acs,
            table_ids=table_ids,
            geoid=geoid,
            stage=stage,
            config=config,
        )
        return payload, []
    except UpstreamAPIError as exc:
        if not _looks_like_no_release_error(str(exc)):
            raise

    merged = new_empty_data_show_payload()
    errors: list[dict[str, str]] = []
    successful_tables = 0

    for table_id in table_ids:
        table_stage = f"{stage}:{table_id}"
        try:
            payload = fetch_data_show(
                client,
                acs=acs,
                table_ids=[table_id],
                geoid=geoid,
                stage=table_stage,
                config=config,
            )
            merge_data_show_payload(merged, payload)
            successful_tables += 1
        except UpstreamAPIError as table_exc:
            errors.append(
                {
                    "stage": stage,
                    "table_id": table_id,
                    "message": str(table_exc),
                }
            )

    if successful_tables == 0:
        first = errors[0]["message"] if errors else "No fallback requests succeeded."
        raise UpstreamAPIError(stage, f"All per-table fallback requests failed. First error: {first}")

    if errors:
        errors.insert(
            0,
            {
                "stage": stage,
                "message": (
                    "Bulk table request failed; completed with per-table fallback "
                    f"({successful_tables}/{len(table_ids)} tables succeeded)."
                ),
            },
        )

    return merged, errors


def _extract_first_geography(
    geocoder_payload: dict[str, Any],
    geography_name: str,
) -> dict[str, Any] | None:
    values = geocoder_payload.get("result", {}).get("geographies", {}).get(geography_name, [])
    if isinstance(values, list) and values:
        return values[0]
    return None


def _build_reporter_geoid(level: str, geoid: str | None) -> str | None:
    if not geoid:
        return None

    if level == "census_block":
        return f"10000US{geoid}" if len(geoid) == 15 and geoid.isdigit() else None
    if level == "census_block_group":
        return f"15000US{geoid}" if len(geoid) == 12 and geoid.isdigit() else None
    if level == "census_tract":
        return f"14000US{geoid}" if len(geoid) == 11 and geoid.isdigit() else None
    return None


def _list_available_tables(payload: dict[str, Any], geoid: str, requested: list[str]) -> list[str]:
    geoid_tables = payload.get("data", {}).get(geoid, {})
    available: list[str] = []
    for table_id in requested:
        estimate = geoid_tables.get(table_id, {}).get("estimate")
        if isinstance(estimate, dict) and len(estimate) > 0:
            available.append(table_id)
    return available


def _build_table_glossary(payload: dict[str, Any], requested: list[str]) -> dict[str, Any]:
    tables = payload.get("tables", {})
    out: dict[str, Any] = {}

    for table_id in requested:
        meta = tables.get(table_id, {}) if isinstance(tables, dict) else {}
        out[table_id] = {
            "table_id": table_id,
            "title": meta.get("title") or meta.get("simple_table_title") or meta.get("table_title"),
            "table_title": meta.get("table_title"),
            "subject_area": meta.get("subject_area"),
            "universe": meta.get("universe"),
            "denominator_column_id": meta.get("denominator_column_id"),
            "topics": meta.get("topics"),
            "columns": meta.get("columns") if isinstance(meta.get("columns"), dict) else {},
        }
    return out


def _has_estimates(table_data: dict[str, Any] | None) -> bool:
    if not isinstance(table_data, dict):
        return False
    estimate = table_data.get("estimate")
    return isinstance(estimate, dict) and len(estimate) > 0


def _build_effective_tables_payload(
    *,
    requested: list[str],
    selected_level: str,
    candidates_with_payload: list[dict[str, Any]],
) -> dict[str, Any]:
    ordered_levels = ["census_block", "census_block_group", "census_tract"]
    selected_index = ordered_levels.index(selected_level)
    allowed_levels = ordered_levels[selected_index:]
    allowed_set = set(allowed_levels)

    level_to_candidate = {
        candidate["level"]: candidate
        for candidate in candidates_with_payload
        if candidate.get("level") in allowed_set
    }
    merge_candidates = [level_to_candidate[level] for level in allowed_levels if level in level_to_candidate]

    by_table: dict[str, Any] = {}
    tables: dict[str, Any] = {}
    table_sources: dict[str, Any] = {}
    geography: dict[str, Any] = {}

    release = None
    for candidate in merge_candidates:
        payload = candidate.get("payload", {})
        if release is None and payload.get("release") is not None:
            release = payload.get("release")

    for table_id in requested:
        for candidate in merge_candidates:
            payload = candidate.get("payload", {})
            reporter_geoid = candidate.get("reporter_geoid")
            source_geoid = candidate.get("source_geoid")
            level = candidate.get("level")

            geoid_tables = payload.get("data", {}).get(reporter_geoid, {})
            table_data = geoid_tables.get(table_id, {})
            if not _has_estimates(table_data):
                continue

            by_table[table_id] = {
                "estimate": table_data.get("estimate") if isinstance(table_data.get("estimate"), dict) else {},
                "error": table_data.get("error") if isinstance(table_data.get("error"), dict) else {},
            }

            table_meta = payload.get("tables", {}).get(table_id, {})
            tables[table_id] = table_meta if isinstance(table_meta, dict) else {}

            geoid_meta = payload.get("geography", {}).get(reporter_geoid)
            if geoid_meta is not None:
                geography[reporter_geoid] = geoid_meta

            table_sources[table_id] = {
                "level": level,
                "source_geoid": source_geoid,
                "reporter_geoid": reporter_geoid,
                "is_fallback_from_selected": level != selected_level,
            }
            break

    available_table_ids = [table_id for table_id in requested if table_id in by_table]
    unavailable_table_ids = [table_id for table_id in requested if table_id not in by_table]

    return {
        "strategy": "smallest_available_with_larger_level_fallback",
        "selected_level": selected_level,
        "merge_levels": allowed_levels,
        "release": release,
        "table_sources": table_sources,
        "available_count": len(available_table_ids),
        "available_table_ids": available_table_ids,
        "unavailable_count": len(unavailable_table_ids),
        "unavailable_table_ids": unavailable_table_ids,
        "tables": tables,
        "geography": geography,
        "by_table": by_table,
    }


def _first_estimate_column(
    table_data: dict[str, Any],
    denominator_column_id: str | None,
) -> str | None:
    estimate = table_data.get("estimate")
    if not isinstance(estimate, dict) or not estimate:
        return None
    if denominator_column_id and denominator_column_id in estimate:
        return denominator_column_id
    return next(iter(estimate.keys()))


def _build_interpreted_examples(
    by_table_data: dict[str, Any],
    glossary: dict[str, Any],
    requested: list[str],
) -> dict[str, Any]:
    by_table: dict[str, Any] = {}
    for table_id in requested:
        meta = glossary.get(table_id, {})
        table_data = by_table_data.get(table_id, {})

        column_id = _first_estimate_column(table_data, meta.get("denominator_column_id"))
        estimate = table_data.get("estimate", {}).get(column_id) if column_id else None
        margin_of_error = table_data.get("error", {}).get(column_id) if column_id else None

        by_table[table_id] = {
            "table_id": table_id,
            "title": meta.get("title"),
            "column_id": column_id,
            "estimate": estimate,
            "margin_of_error": margin_of_error,
            "column_label": meta.get("columns", {}).get(column_id, {}).get("name") if column_id else None,
            "is_sentinel_negative_median": bool(
                isinstance(estimate, (int, float)) and estimate < 0 and "median" in str(meta.get("title", "")).lower()
            ),
        }

    return {
        "key_examples": {table_id: by_table.get(table_id) for table_id in KEY_TABLE_EXAMPLES},
        "by_table": by_table,
        "notes": [
            "Bxxxxx identifies a Census table.",
            "Bxxxxxyyy identifies a specific table column.",
            "estimate is the ACS estimate value.",
            "margin_of_error is ACS MOE.",
            "negative medians are sentinel values for unavailable medians in some geographies.",
        ],
    }


def lookup_smallest_census_by_point(
    client: httpx.Client,
    *,
    lat: float,
    lon: float,
    acs: str,
) -> dict[str, Any]:
    config = ApiConfig(acs=acs)

    geocoder_payload = request_json(
        client,
        CENSUS_GEOCODER_COORDINATES_URL,
        params={
            "x": lon,
            "y": lat,
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "layers": "all",
            "format": "json",
        },
        stage="geocoder",
        config=config,
    )

    block = _extract_first_geography(geocoder_payload, "2020 Census Blocks")
    block_group = _extract_first_geography(geocoder_payload, "Census Block Groups")
    tract = _extract_first_geography(geocoder_payload, "Census Tracts")

    if not block and not block_group and not tract:
        raise NoGeographyFoundError("No Census block/block-group/tract found for the provided coordinates.")

    attempts = [
        {
            "level": "census_block",
            "source_geoid": block.get("GEOID") if block else None,
            "reporter_geoid": _build_reporter_geoid("census_block", block.get("GEOID") if block else None),
        },
        {
            "level": "census_block_group",
            "source_geoid": block_group.get("GEOID") if block_group else None,
            "reporter_geoid": _build_reporter_geoid(
                "census_block_group", block_group.get("GEOID") if block_group else None
            ),
        },
        {
            "level": "census_tract",
            "source_geoid": tract.get("GEOID") if tract else None,
            "reporter_geoid": _build_reporter_geoid("census_tract", tract.get("GEOID") if tract else None),
        },
    ]

    selected: dict[str, Any] | None = None
    attempt_results: list[dict[str, Any]] = []
    selected_payload: dict[str, Any] | None = None
    selected_errors: list[dict[str, str]] = []
    candidates_with_payload: list[dict[str, Any]] = []

    for candidate in attempts:
        reporter_geoid = candidate.get("reporter_geoid")
        if not reporter_geoid:
            attempt_results.append(
                {
                    **candidate,
                    "status": "skipped_missing_geoid",
                    "available_tables": [],
                    "available_count": 0,
                    "error": "No valid GEOID for this level.",
                }
            )
            continue

        stage = f"data_show:{candidate['level']}"
        try:
            payload, fallback_errors = fetch_data_show_resilient(
                client,
                acs=acs,
                table_ids=TABLE_IDS,
                geoid=reporter_geoid,
                stage=stage,
                config=config,
            )
        except UpstreamAPIError as exc:
            message = str(exc)
            unsupported = _looks_like_no_release_error(message) or (
                "all per-table fallback requests failed" in message.lower()
                and _looks_like_no_release_error(message)
            )
            if unsupported:
                attempt_results.append(
                    {
                        **candidate,
                        "status": "unsupported_level",
                        "available_tables": [],
                        "available_count": 0,
                        "error": message,
                    }
                )
                continue
            raise

        available_tables = _list_available_tables(payload, reporter_geoid, TABLE_IDS)
        if not available_tables:
            attempt_results.append(
                {
                    **candidate,
                    "status": "no_tables_available",
                    "available_tables": [],
                    "available_count": 0,
                    "error": "No table estimates were returned for this geography level.",
                }
            )
            continue

        candidates_with_payload.append(
            {
                **candidate,
                "payload": payload,
                "available_tables": available_tables,
                "fallback_errors": fallback_errors,
            }
        )

        if selected is None:
            selected = candidate
            selected_payload = payload
            selected_errors = fallback_errors
            status = "selected"
        else:
            status = "available_larger_level"

        attempt_results.append(
            {
                **candidate,
                "status": status,
                "available_tables": available_tables,
                "available_count": len(available_tables),
                "error": None,
            }
        )

    if not selected or not selected_payload:
        raise NoGeographyFoundError(
            "No supported Census Reporter table data was available for block, block group, or tract."
        )

    selected_geoid = selected["reporter_geoid"]
    available_table_ids = _list_available_tables(selected_payload, selected_geoid, TABLE_IDS)
    unavailable_table_ids = [table_id for table_id in TABLE_IDS if table_id not in available_table_ids]

    effective_data = _build_effective_tables_payload(
        requested=TABLE_IDS,
        selected_level=selected["level"],
        candidates_with_payload=candidates_with_payload,
    )
    effective_payload_for_glossary = {"tables": effective_data.get("tables", {})}
    table_glossary = _build_table_glossary(effective_payload_for_glossary, TABLE_IDS)
    interpreted = _build_interpreted_examples(
        effective_data.get("by_table", {}),
        table_glossary,
        TABLE_IDS,
    )

    return {
        "input": {
            "latitude": lat,
            "longitude": lon,
            "acs": acs,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        },
        "smallest_geography_found": {
            "block": block,
            "block_group": block_group,
            "tract": tract,
        },
        "selected_for_acs_data": {
            "attempt_order": [attempt["level"] for attempt in attempts],
            "selected_level": selected["level"],
            "source_geoid": selected["source_geoid"],
            "reporter_geoid": selected_geoid,
            "fallback_used": bool(selected_errors),
            "attempts": attempt_results,
        },
        "tables": {
            "requested_count": len(TABLE_IDS),
            "requested_table_ids": TABLE_IDS,
            "available_count": len(available_table_ids),
            "available_table_ids": available_table_ids,
            "unavailable_count": len(unavailable_table_ids),
            "unavailable_table_ids": unavailable_table_ids,
            "effective_available_count": effective_data.get("available_count", 0),
            "effective_available_table_ids": effective_data.get("available_table_ids", []),
            "effective_unavailable_count": effective_data.get("unavailable_count", 0),
            "effective_unavailable_table_ids": effective_data.get("unavailable_table_ids", []),
        },
        "table_glossary": table_glossary,
        "data_raw": {
            "release": selected_payload.get("release"),
            "tables": selected_payload.get("tables"),
            "geography": selected_payload.get("geography"),
            "data": selected_payload.get("data"),
        },
        "data_effective": effective_data,
        "data_interpreted": interpreted,
        "errors": selected_errors,
    }
