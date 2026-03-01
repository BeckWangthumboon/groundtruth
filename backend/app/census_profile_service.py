from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import httpx


CENSUS_GEOCODER_COORDINATES_URL = (
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
)
CENSUS_REPORTER_BASE_URL = "https://api.censusreporter.org"

FULL_TRACT_TABLES = [
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

# Keep comparisons as rich as tract data so frontend can render contextual lines.
COMPARISON_TABLES = FULL_TRACT_TABLES.copy()

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

TRANSPORT_COLUMNS = {
    "drove_alone": "B08301003",
    "carpooled": "B08301004",
    "public_transit": "B08301010",
    "walked": "B08301016",
    "bicycle": "B08301017",
    "other": "B08301018",
    "worked_from_home": "B08301019",
}

B15003_HIGH_SCHOOL_PLUS = [f"B15003{i:03d}" for i in range(12, 21)]
B15003_BACHELORS_PLUS = [f"B15003{i:03d}" for i in range(15, 21)]

METRIC_RELATIONS_DEFAULT = ("place", "county", "state", "nation")

RequestJsonFn = Callable[
    [httpx.Client, str],
    dict[str, Any],
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


class NoTractFoundError(RuntimeError):
    pass


def _backoff_seconds(attempt: int) -> float:
    return min(8.0, 0.5 * (2**attempt))


def _short_error_text(text: str, limit: int = 240) -> str:
    one_line = " ".join(text.split())
    if len(one_line) <= limit:
        return one_line
    return one_line[:limit] + "..."


def request_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None,
    stage: str,
    config: ApiConfig,
) -> dict[str, Any]:
    last_error: Exception | None = None
    headers = {"User-Agent": "groundtruth-census-tools/0.2"}
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


def extract_first_tract(geocoder_payload: dict[str, Any]) -> dict[str, Any]:
    tracts = (
        geocoder_payload.get("result", {})
        .get("geographies", {})
        .get("Census Tracts", [])
    )
    if not tracts:
        raise NoTractFoundError("No census tract found for the provided coordinates.")
    return tracts[0]


def extract_optional_first_geography(
    geocoder_payload: dict[str, Any], geography_name: str
) -> dict[str, Any] | None:
    geographies = geocoder_payload.get("result", {}).get("geographies", {})
    values = geographies.get(geography_name, [])
    if isinstance(values, list) and values:
        return values[0]
    return None


def extract_optional_zcta(geocoder_payload: dict[str, Any]) -> dict[str, Any] | None:
    geographies = geocoder_payload.get("result", {}).get("geographies", {})
    for key, values in geographies.items():
        if "ZIP Code Tabulation Areas" not in key:
            continue
        if isinstance(values, list) and values:
            return values[0]
    return None


def build_reporter_tract_geoid(tract_fips: str) -> str:
    if len(tract_fips) != 11 or not tract_fips.isdigit():
        raise ValueError(f"Unexpected tract GEOID format: {tract_fips!r}")
    return f"14000US{tract_fips}"


def build_reporter_county_geoid(county_fips: str) -> str:
    if len(county_fips) != 5 or not county_fips.isdigit():
        raise ValueError(f"Unexpected county GEOID format: {county_fips!r}")
    return f"05000US{county_fips}"


def build_reporter_zcta_geoid(zcta: str) -> str:
    if len(zcta) != 5 or not zcta.isdigit():
        raise ValueError(f"Unexpected ZIP/ZCTA format: {zcta!r}")
    return f"86000US{zcta}"


def normalize_sumlevel(value: Any) -> str:
    text = str(value or "").strip()
    if text.isdigit():
        return text.zfill(3)
    return text


def build_comparison_geoids(
    tract_geoid: str,
    parents: list[dict[str, Any]],
    include_parents: bool,
    required_geoids_by_sumlevel: dict[str, str] | None = None,
) -> tuple[list[str], list[dict[str, Any]]]:
    if not include_parents:
        return [tract_geoid], [
            {"sumlevel": "140", "relation": "this", "geoid": tract_geoid, "display_name": None}
        ]

    by_sumlevel: dict[str, dict[str, Any]] = {}
    for parent in parents:
        geoid = parent.get("geoid") or parent.get("full_geoid")
        if not geoid:
            continue
        sumlevel = normalize_sumlevel(parent.get("sumlevel"))
        if not sumlevel:
            continue
        if sumlevel not in by_sumlevel:
            normalized = dict(parent)
            normalized["sumlevel"] = sumlevel
            normalized["geoid"] = geoid
            by_sumlevel[sumlevel] = normalized

    required = dict(required_geoids_by_sumlevel or {})
    required["140"] = tract_geoid
    default_relations = {"140": "this", "860": "zcta", "050": "county"}
    for sumlevel, geoid in required.items():
        if not geoid:
            continue
        record = dict(by_sumlevel.get(sumlevel, {}))
        record["sumlevel"] = sumlevel
        record["geoid"] = geoid
        if "relation" not in record:
            record["relation"] = default_relations.get(sumlevel, "related")
        by_sumlevel[sumlevel] = record

    order = ["140", "860", "050", "160", "310", "040", "010"]
    selected_geoids: list[str] = []
    selected_records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for sumlevel in order:
        record = by_sumlevel.get(sumlevel)
        if not record:
            continue
        geoid = record.get("geoid")
        if not geoid or geoid in seen:
            continue
        selected_geoids.append(geoid)
        selected_records.append(record)
        seen.add(geoid)

    if tract_geoid not in seen:
        selected_geoids.insert(0, tract_geoid)
        selected_records.insert(
            0,
            {"sumlevel": "140", "relation": "this", "geoid": tract_geoid, "display_name": None},
        )

    return selected_geoids, selected_records


def fetch_data_show(
    client: httpx.Client,
    *,
    acs: str,
    table_ids: list[str],
    geoids: list[str],
    stage: str,
    config: ApiConfig,
    requester: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    requester_fn = requester or request_json
    url = f"{CENSUS_REPORTER_BASE_URL}/1.0/data/show/{acs}"
    params = {
        "table_ids": ",".join(table_ids),
        "geo_ids": ",".join(geoids),
    }
    return requester_fn(client, url, params=params, stage=stage, config=config)


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
    geoids: list[str],
    stage: str,
    config: ApiConfig,
    requester: Callable[..., dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    requester_fn = requester or request_json
    try:
        payload = fetch_data_show(
            client,
            acs=acs,
            table_ids=table_ids,
            geoids=geoids,
            stage=stage,
            config=config,
            requester=requester_fn,
        )
        return payload, []
    except UpstreamAPIError as exc:
        message = str(exc).lower()
        marker = "none of the releases had the requested geo_ids and table_ids"
        if marker not in message:
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
                geoids=geoids,
                stage=table_stage,
                config=config,
                requester=requester_fn,
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


def get_estimate(
    payload: dict[str, Any], geoid: str, table_id: str, column_id: str
) -> float | int | None:
    value = (
        payload.get("data", {})
        .get(geoid, {})
        .get(table_id, {})
        .get("estimate", {})
        .get(column_id)
    )
    if isinstance(value, (int, float)):
        return value
    return None


def get_moe(
    payload: dict[str, Any], geoid: str, table_id: str, column_id: str
) -> float | int | None:
    value = (
        payload.get("data", {})
        .get(geoid, {})
        .get(table_id, {})
        .get("error", {})
        .get(column_id)
    )
    if isinstance(value, (int, float)):
        return value
    return None


def sum_estimates(
    payload: dict[str, Any], geoid: str, table_id: str, column_ids: list[str]
) -> float | None:
    total = 0.0
    has_any = False
    for column_id in column_ids:
        value = get_estimate(payload, geoid, table_id, column_id)
        if value is None:
            continue
        total += float(value)
        has_any = True
    if not has_any:
        return None
    return total


def sum_moe_rss(
    payload: dict[str, Any], geoid: str, table_id: str, column_ids: list[str]
) -> float | None:
    components: list[float] = []
    for column_id in column_ids:
        value = get_moe(payload, geoid, table_id, column_id)
        if value is None:
            continue
        components.append(float(value))
    if not components:
        return None
    return math.sqrt(sum(v * v for v in components))


def pct(part: float | int | None, whole: float | int | None) -> float | None:
    if part is None or whole in (None, 0):
        return None
    return (float(part) / float(whole)) * 100.0


def _normalize_median(value: float | int | None) -> float | int | None:
    if isinstance(value, (int, float)) and value < 0:
        return None
    return value


def _table_meta(payload: dict[str, Any], table_id: str) -> dict[str, Any]:
    tables = payload.get("tables", {})
    if not isinstance(tables, dict):
        return {}
    table = tables.get(table_id, {})
    return table if isinstance(table, dict) else {}


def _metric_block(
    payload: dict[str, Any],
    geoid: str,
    *,
    metric_id: str,
    label: str,
    table_id: str,
    column_id: str,
    format_hint: str = "number",
    value_override: float | int | None = None,
    moe_override: float | int | None = None,
    universe_override: str | None = None,
    treat_negative_as_null: bool = False,
) -> dict[str, Any]:
    estimate = get_estimate(payload, geoid, table_id, column_id) if value_override is None else value_override
    moe = get_moe(payload, geoid, table_id, column_id) if moe_override is None else moe_override
    if treat_negative_as_null:
        estimate = _normalize_median(estimate)
    if estimate is not None and isinstance(estimate, float) and estimate.is_integer():
        estimate = int(estimate)

    moe_ratio: float | None = None
    if isinstance(estimate, (int, float)) and isinstance(moe, (int, float)) and estimate != 0:
        moe_ratio = abs(float(moe) / float(estimate))

    table = _table_meta(payload, table_id)
    universe = universe_override or table.get("universe")

    return {
        "id": metric_id,
        "label": label,
        "table_id": table_id,
        "column_id": column_id,
        "title": table.get("simple_table_title") or table.get("table_title"),
        "estimate": estimate,
        "moe": moe,
        "moe_ratio": moe_ratio,
        "high_moe": bool(moe_ratio is not None and moe_ratio >= 0.10),
        "universe": universe,
        "format": format_hint,
    }


def _format_for_comparison(metric: dict[str, Any], value: float | int | None) -> str:
    if value is None:
        return "N/A"

    fmt = metric.get("format")
    numeric = float(value)

    if fmt == "currency":
        return f"${int(round(numeric)):,}"
    if fmt == "percent":
        return f"{numeric:.1f}%"
    if fmt == "minutes":
        return f"{numeric:.1f}"
    if float(value).is_integer():
        return f"{int(round(numeric)):,}"
    return f"{numeric:,.1f}"


def _ratio_phrase(ratio: float) -> str:
    if ratio >= 2.0:
        return "more than double"
    if ratio >= 1.5:
        return "about one-and-a-half times"
    if ratio >= 1.2:
        return "about 20 percent higher than"
    if ratio >= 0.9:
        return "about the same as"
    if ratio >= 0.75:
        return "about three-quarters of"
    if ratio >= 0.6:
        return "about two-thirds of"
    if ratio >= 0.45:
        return "about half"
    if ratio >= 0.3:
        return "about one-third of"
    if ratio >= 0.15:
        return "about one-fifth of"
    return "less than 20 percent of"


def _comparison_lines_for_metric(
    metric: dict[str, Any],
    *,
    tract_value: float | int | None,
    comparison_values: dict[str, float | int | None],
    selected_parents: list[dict[str, Any]],
    geography_lookup: dict[str, str | None],
    allowed_relations: tuple[str, ...] = METRIC_RELATIONS_DEFAULT,
) -> list[dict[str, Any]]:
    if tract_value is None:
        return []

    relation_seen: set[str] = set()
    lines: list[dict[str, Any]] = []
    for parent in selected_parents:
        relation = str(parent.get("relation") or "").lower().strip()
        geoid = str(parent.get("geoid") or "")
        if relation not in allowed_relations or relation in relation_seen:
            continue
        relation_seen.add(relation)

        compare_value = comparison_values.get(geoid)
        if compare_value in (None, 0):
            continue

        ratio = float(tract_value) / float(compare_value)
        phrase = _ratio_phrase(ratio)
        place_name = geography_lookup.get(geoid) or geoid

        if phrase in {"more than double", "about one-and-a-half times"}:
            sentence = f"{phrase} the figure in {place_name}: {_format_for_comparison(metric, compare_value)}"
        elif phrase == "about the same as":
            sentence = f"{phrase} the figure in {place_name}: {_format_for_comparison(metric, compare_value)}"
        elif phrase == "about half":
            sentence = f"{phrase} the figure in {place_name}: {_format_for_comparison(metric, compare_value)}"
        else:
            sentence = f"{phrase} the figure in {place_name}: {_format_for_comparison(metric, compare_value)}"

        lines.append(
            {
                "geoid": geoid,
                "relation": relation,
                "place_name": place_name,
                "comparison_value": compare_value,
                "ratio": ratio,
                "phrase": phrase,
                "line": sentence,
            }
        )

    return lines


def _series_from_columns(
    payload: dict[str, Any],
    geoid: str,
    *,
    table_id: str,
    total_column_id: str,
    buckets: list[tuple[str, list[str]]],
) -> list[dict[str, Any]]:
    total = get_estimate(payload, geoid, table_id, total_column_id)
    series: list[dict[str, Any]] = []
    for label, cols in buckets:
        count = sum_estimates(payload, geoid, table_id, cols)
        value_pct = pct(count, total)
        series.append({
            "label": label,
            "count": count,
            "value_pct": value_pct,
        })
    return series


def _b01001_col(n: int) -> str:
    return f"B01001{n:03d}"


def _b19001_col(n: int) -> str:
    return f"B19001{n:03d}"


def _b25075_col(n: int) -> str:
    return f"B25075{n:03d}"


def _b15003_col(n: int) -> str:
    return f"B15003{n:03d}"


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _build_demographics_section(payload: dict[str, Any], geoid: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metrics: dict[str, dict[str, Any]] = {}

    metrics["median_age"] = _metric_block(
        payload,
        geoid,
        metric_id="median_age",
        label="Median age",
        table_id="B01002",
        column_id="B01002001",
        format_hint="number",
    )

    male_count = get_estimate(payload, geoid, "B01001", _b01001_col(2))
    female_count = get_estimate(payload, geoid, "B01001", _b01001_col(26))
    total_population = get_estimate(payload, geoid, "B01001", _b01001_col(1))
    male_pct = pct(male_count, total_population)
    female_pct = pct(female_count, total_population)
    metrics["male_share"] = _metric_block(
        payload,
        geoid,
        metric_id="male_share",
        label="Male",
        table_id="B01001",
        column_id=_b01001_col(2),
        format_hint="percent",
        value_override=male_pct,
        universe_override="Total population",
    )
    metrics["female_share"] = _metric_block(
        payload,
        geoid,
        metric_id="female_share",
        label="Female",
        table_id="B01001",
        column_id=_b01001_col(26),
        format_hint="percent",
        value_override=female_pct,
        universe_override="Total population",
    )

    age_range_buckets = [
        ("0-9", [_b01001_col(3), _b01001_col(4), _b01001_col(27), _b01001_col(28)]),
        ("10-19", [_b01001_col(5), _b01001_col(6), _b01001_col(7), _b01001_col(29), _b01001_col(30), _b01001_col(31)]),
        ("20-29", [_b01001_col(8), _b01001_col(9), _b01001_col(10), _b01001_col(11), _b01001_col(32), _b01001_col(33), _b01001_col(34), _b01001_col(35)]),
        ("30-39", [_b01001_col(12), _b01001_col(13), _b01001_col(36), _b01001_col(37)]),
        ("40-49", [_b01001_col(14), _b01001_col(15), _b01001_col(38), _b01001_col(39)]),
        ("50-59", [_b01001_col(16), _b01001_col(17), _b01001_col(40), _b01001_col(41)]),
        ("60-69", [_b01001_col(18), _b01001_col(19), _b01001_col(20), _b01001_col(21), _b01001_col(42), _b01001_col(43), _b01001_col(44), _b01001_col(45)]),
        ("70-79", [_b01001_col(22), _b01001_col(23), _b01001_col(46), _b01001_col(47)]),
        ("80+", [_b01001_col(24), _b01001_col(25), _b01001_col(48), _b01001_col(49)]),
    ]
    age_category_buckets = [
        ("Under 18", [_b01001_col(3), _b01001_col(4), _b01001_col(5), _b01001_col(6), _b01001_col(7), _b01001_col(27), _b01001_col(28), _b01001_col(29), _b01001_col(30), _b01001_col(31)]),
        ("18 to 64", [_b01001_col(8), _b01001_col(9), _b01001_col(10), _b01001_col(11), _b01001_col(12), _b01001_col(13), _b01001_col(14), _b01001_col(15), _b01001_col(16), _b01001_col(17), _b01001_col(18), _b01001_col(19), _b01001_col(42), _b01001_col(43), _b01001_col(32), _b01001_col(33), _b01001_col(34), _b01001_col(35), _b01001_col(36), _b01001_col(37), _b01001_col(38), _b01001_col(39), _b01001_col(40), _b01001_col(41)]),
        ("65 and over", [_b01001_col(20), _b01001_col(21), _b01001_col(22), _b01001_col(23), _b01001_col(24), _b01001_col(25), _b01001_col(44), _b01001_col(45), _b01001_col(46), _b01001_col(47), _b01001_col(48), _b01001_col(49)]),
    ]

    race_buckets = [
        ("White", ["B03002003"]),
        ("Black", ["B03002004"]),
        ("Native", ["B03002005"]),
        ("Asian", ["B03002006"]),
        ("Islander", ["B03002007"]),
        ("Other", ["B03002008"]),
        ("Two+", ["B03002009"]),
        ("Hispanic", ["B03002012"]),
    ]

    charts = [
        {
            "id": "age_ranges",
            "label": "Population by age range",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B01001",
                total_column_id="B01001001",
                buckets=age_range_buckets,
            ),
            "universe": "Total population",
        },
        {
            "id": "age_category",
            "label": "Population by age category",
            "type": "donut",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B01001",
                total_column_id="B01001001",
                buckets=age_category_buckets,
            ),
            "universe": "Total population",
        },
        {
            "id": "sex_split",
            "label": "Sex",
            "type": "donut",
            "series": [
                {"label": "Male", "count": male_count, "value_pct": male_pct},
                {"label": "Female", "count": female_count, "value_pct": female_pct},
            ],
            "universe": "Total population",
        },
        {
            "id": "race_ethnicity",
            "label": "Race & Ethnicity",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B03002",
                total_column_id="B03002001",
                buckets=race_buckets,
            ),
            "universe": "Total population",
            "note": "Hispanic includes respondents of any race. Other categories are non-Hispanic.",
        },
    ]

    section = {
        "id": "demographics",
        "title": "Demographics",
        "metrics": [metrics["median_age"]],
        "charts": charts,
    }
    return section, metrics


def _build_economics_section(payload: dict[str, Any], geoid: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metrics: dict[str, dict[str, Any]] = {}

    metrics["per_capita_income"] = _metric_block(
        payload,
        geoid,
        metric_id="per_capita_income",
        label="Per capita income",
        table_id="B19301",
        column_id="B19301001",
        format_hint="currency",
        treat_negative_as_null=True,
    )
    metrics["median_household_income"] = _metric_block(
        payload,
        geoid,
        metric_id="median_household_income",
        label="Median household income",
        table_id="B19013",
        column_id="B19013001",
        format_hint="currency",
        treat_negative_as_null=True,
    )

    poverty_total = get_estimate(payload, geoid, "B17001", "B17001001")
    poverty_below = get_estimate(payload, geoid, "B17001", "B17001002")
    poverty_rate = pct(poverty_below, poverty_total)
    metrics["poverty_rate"] = _metric_block(
        payload,
        geoid,
        metric_id="poverty_rate",
        label="Persons below poverty line",
        table_id="B17001",
        column_id="B17001002",
        format_hint="percent",
        value_override=poverty_rate,
        universe_override="Population for whom poverty status is determined",
    )

    metrics["mean_travel_time"] = _metric_block(
        payload,
        geoid,
        metric_id="mean_travel_time",
        label="Mean travel time to work",
        table_id="B08303",
        column_id="B08303001",
        format_hint="minutes",
    )

    income_buckets = [
        ("Under $50K", [_b19001_col(i) for i in range(2, 11)]),
        ("$50K - $100K", [_b19001_col(i) for i in range(11, 14)]),
        ("$100K - $200K", [_b19001_col(i) for i in range(14, 17)]),
        ("Over $200K", [_b19001_col(17)]),
    ]

    transport_series = [
        ("Drove alone", [TRANSPORT_COLUMNS["drove_alone"]]),
        ("Carpooled", [TRANSPORT_COLUMNS["carpooled"]]),
        ("Public transit", [TRANSPORT_COLUMNS["public_transit"]]),
        ("Bicycle", [TRANSPORT_COLUMNS["bicycle"]]),
        ("Walked", [TRANSPORT_COLUMNS["walked"]]),
        ("Other", [TRANSPORT_COLUMNS["other"]]),
        ("Worked at home", [TRANSPORT_COLUMNS["worked_from_home"]]),
    ]

    charts = [
        {
            "id": "household_income_distribution",
            "label": "Household income",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B19001",
                total_column_id="B19001001",
                buckets=income_buckets,
            ),
            "universe": "Households",
        },
        {
            "id": "transport_modes",
            "label": "Means of transportation to work",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B08301",
                total_column_id="B08301001",
                buckets=transport_series,
            ),
            "universe": "Workers 16 years and over",
        },
    ]

    section = {
        "id": "economics",
        "title": "Economics",
        "metrics": [
            metrics["per_capita_income"],
            metrics["median_household_income"],
            metrics["poverty_rate"],
            metrics["mean_travel_time"],
        ],
        "charts": charts,
    }
    return section, metrics


def _build_families_section(payload: dict[str, Any], geoid: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metrics: dict[str, dict[str, Any]] = {}

    metrics["households"] = _metric_block(
        payload,
        geoid,
        metric_id="households",
        label="Number of households",
        table_id="B11001",
        column_id="B11001001",
        format_hint="number",
    )
    metrics["persons_per_household"] = _metric_block(
        payload,
        geoid,
        metric_id="persons_per_household",
        label="Persons per household",
        table_id="B25010",
        column_id="B25010001",
        format_hint="number",
    )

    marital_total = get_estimate(payload, geoid, "B12001", "B12001001")
    married_count = sum_estimates(payload, geoid, "B12001", ["B12001004", "B12001010"])
    married_share = pct(married_count, marital_total)
    metrics["married_share"] = _metric_block(
        payload,
        geoid,
        metric_id="married_share",
        label="Married",
        table_id="B12001",
        column_id="B12001004",
        format_hint="percent",
        value_override=married_share,
        universe_override="Population 15 years and over",
    )

    fertility_total = get_estimate(payload, geoid, "B13016", "B13016001")
    fertility_birth = get_estimate(payload, geoid, "B13016", "B13016002")
    fertility_rate = pct(fertility_birth, fertility_total)
    metrics["fertility_rate"] = _metric_block(
        payload,
        geoid,
        metric_id="fertility_rate",
        label="Women 15-50 who gave birth during past year",
        table_id="B13016",
        column_id="B13016002",
        format_hint="percent",
        value_override=fertility_rate,
        universe_override="Women 15 to 50 years",
    )

    household_type_buckets = [
        ("Married couples", ["B11001003"]),
        ("Male householder", ["B11001004"]),
        ("Female householder", ["B11001005"]),
        ("Non-family", ["B11001006"]),
    ]

    marital_buckets = [
        ("Never married Male", ["B12001003"]),
        ("Never married Female", ["B12001009"]),
        ("Now married Male", ["B12001004"]),
        ("Now married Female", ["B12001010"]),
        ("Divorced Male", ["B12001007"]),
        ("Divorced Female", ["B12001013"]),
        ("Widowed Male", ["B12001006"]),
        ("Widowed Female", ["B12001012"]),
    ]

    fertility_buckets = [
        ("15-19", ["B13016004"]),
        ("20-24", ["B13016006"]),
        ("25-29", ["B13016008"]),
        ("30-35", ["B13016010"]),
        ("35-39", ["B13016012"]),
        ("40-44", ["B13016014"]),
        ("45-50", ["B13016016"]),
    ]

    charts = [
        {
            "id": "household_type",
            "label": "Population by household type",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B11001",
                total_column_id="B11001001",
                buckets=household_type_buckets,
            ),
            "universe": "Households",
        },
        {
            "id": "marital_status_by_sex",
            "label": "Marital status, by sex",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B12001",
                total_column_id="B12001001",
                buckets=marital_buckets,
            ),
            "universe": "Population 15 years and over",
        },
        {
            "id": "fertility_by_age",
            "label": "Women who gave birth during past year, by age group",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B13016",
                total_column_id="B13016001",
                buckets=fertility_buckets,
            ),
            "universe": "Women 15 to 50 years",
        },
    ]

    section = {
        "id": "families",
        "title": "Families",
        "metrics": [
            metrics["households"],
            metrics["persons_per_household"],
            metrics["married_share"],
            metrics["fertility_rate"],
        ],
        "charts": charts,
    }
    return section, metrics


def _build_housing_section(payload: dict[str, Any], geoid: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metrics: dict[str, dict[str, Any]] = {}

    metrics["housing_units"] = _metric_block(
        payload,
        geoid,
        metric_id="housing_units",
        label="Number of housing units",
        table_id="B25001",
        column_id="B25001001",
        format_hint="number",
    )
    metrics["median_home_value"] = _metric_block(
        payload,
        geoid,
        metric_id="median_home_value",
        label="Median value of owner-occupied housing units",
        table_id="B25077",
        column_id="B25077001",
        format_hint="currency",
        treat_negative_as_null=True,
    )
    metrics["median_rent"] = _metric_block(
        payload,
        geoid,
        metric_id="median_rent",
        label="Median gross rent",
        table_id="B25064",
        column_id="B25064001",
        format_hint="currency",
        treat_negative_as_null=True,
    )

    occupancy_buckets = [
        ("Occupied", ["B25002002"]),
        ("Vacant", ["B25002003"]),
    ]
    tenure_buckets = [
        ("Owner occupied", ["B25003002"]),
        ("Renter occupied", ["B25003003"]),
    ]
    structure_buckets = [
        ("Single unit", ["B25024002", "B25024003"]),
        ("Multi-unit", ["B25024004", "B25024005", "B25024006", "B25024007", "B25024008", "B25024009"]),
        ("Mobile home", ["B25024010"]),
        ("Boat, RV, van", ["B25024011"]),
    ]

    value_bins = [
        ("Under $100K", [_b25075_col(i) for i in range(2, 13)]),
        ("$100K - $200K", [_b25075_col(i) for i in range(13, 17)]),
        ("$200K - $300K", [_b25075_col(i) for i in range(17, 19)]),
        ("$300K - $400K", [_b25075_col(19)]),
        ("$400K - $500K", [_b25075_col(20)]),
        ("$500K - $1M", [_b25075_col(21), _b25075_col(22)]),
        ("Over $1M", [_b25075_col(23), _b25075_col(24), _b25075_col(25)]),
    ]

    charts = [
        {
            "id": "occupied_vs_vacant",
            "label": "Occupied vs. Vacant",
            "type": "donut",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B25002",
                total_column_id="B25002001",
                buckets=occupancy_buckets,
            ),
            "universe": "Housing units",
        },
        {
            "id": "ownership",
            "label": "Ownership of occupied units",
            "type": "donut",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B25003",
                total_column_id="B25003001",
                buckets=tenure_buckets,
            ),
            "universe": "Occupied housing units",
        },
        {
            "id": "structure_types",
            "label": "Types of structure",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B25024",
                total_column_id="B25024001",
                buckets=structure_buckets,
            ),
            "universe": "Housing units",
        },
        {
            "id": "home_value_bins",
            "label": "Value of owner-occupied housing units",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B25075",
                total_column_id="B25075001",
                buckets=value_bins,
            ),
            "universe": "Owner-occupied housing units",
        },
    ]

    section = {
        "id": "housing",
        "title": "Housing",
        "metrics": [
            metrics["housing_units"],
            metrics["median_home_value"],
            metrics["median_rent"],
        ],
        "charts": charts,
    }
    return section, metrics


def _build_social_section(payload: dict[str, Any], geoid: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metrics: dict[str, dict[str, Any]] = {}

    education_total = get_estimate(payload, geoid, "B15003", "B15003001")
    hs_plus = sum_estimates(payload, geoid, "B15003", B15003_HIGH_SCHOOL_PLUS)
    bachelors_plus = sum_estimates(payload, geoid, "B15003", B15003_BACHELORS_PLUS)

    metrics["hs_or_higher_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="hs_or_higher_pct",
        label="High school grad or higher",
        table_id="B15003",
        column_id="B15003001",
        format_hint="percent",
        value_override=pct(hs_plus, education_total),
        universe_override="Population 25 years and over",
    )
    metrics["bachelors_or_higher_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="bachelors_or_higher_pct",
        label="Bachelor's degree or higher",
        table_id="B15003",
        column_id="B15003001",
        format_hint="percent",
        value_override=pct(bachelors_plus, education_total),
        universe_override="Population 25 years and over",
    )

    foreign_total = get_estimate(payload, geoid, "B05002", "B05002001")
    foreign_born = get_estimate(payload, geoid, "B05002", "B05002013")
    metrics["foreign_born_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="foreign_born_pct",
        label="Foreign-born population",
        table_id="B05002",
        column_id="B05002013",
        format_hint="percent",
        value_override=pct(foreign_born, foreign_total),
        universe_override="Total population",
    )

    veteran_total = get_estimate(payload, geoid, "B21001", "B21001001")
    veteran_count = get_estimate(payload, geoid, "B21001", "B21001002")
    metrics["veteran_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="veteran_pct",
        label="Population with veteran status",
        table_id="B21001",
        column_id="B21001002",
        format_hint="percent",
        value_override=pct(veteran_count, veteran_total),
        universe_override="Civilian population 18 years and over",
    )

    language_total = get_estimate(payload, geoid, "B16001", "B16001001")
    english_only = get_estimate(payload, geoid, "B16001", "B16001002")
    other_language = None
    if isinstance(language_total, (int, float)) and isinstance(english_only, (int, float)):
        other_language = language_total - english_only

    metrics["language_other_than_english_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="language_other_than_english_pct",
        label="Persons with language other than English spoken at home",
        table_id="B16001",
        column_id="B16001001",
        format_hint="percent",
        value_override=pct(other_language, language_total),
        universe_override="Population 5 years and over",
    )

    mobility_total = get_estimate(payload, geoid, "B07003", "B07003001")
    moved = sum_estimates(payload, geoid, "B07003", ["B07003004", "B07003005", "B07003006", "B07003007"])
    metrics["moved_last_year_pct"] = _metric_block(
        payload,
        geoid,
        metric_id="moved_last_year_pct",
        label="Moved since previous year",
        table_id="B07003",
        column_id="B07003001",
        format_hint="percent",
        value_override=pct(moved, mobility_total),
        universe_override="Population 1 year and over",
    )

    education_buckets = [
        ("No degree", [_b15003_col(i) for i in range(2, 17)]),
        ("High school", [_b15003_col(17), _b15003_col(18)]),
        ("Some college", [_b15003_col(19), _b15003_col(20), _b15003_col(21)]),
        ("Bachelor's", [_b15003_col(22)]),
        ("Post-grad", [_b15003_col(23), _b15003_col(24), _b15003_col(25)]),
    ]

    birth_region_buckets = [
        ("Europe", ["B05006002"]),
        ("Asia", ["B05006020"]),
        ("Africa", ["B05006031"]),
        ("Oceania", ["B05006040"]),
        ("Latin America", ["B05006045"]),
        ("Northern America", ["B05006047"]),
    ]

    migration_buckets = [
        ("Same house year ago", ["B07003002"]),
        ("From same county", ["B07003004"]),
        ("From different county", ["B07003005"]),
        ("From different state", ["B07003006"]),
        ("From abroad", ["B07003007"]),
    ]

    charts = [
        {
            "id": "education_distribution",
            "label": "Population by highest level of education",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B15003",
                total_column_id="B15003001",
                buckets=education_buckets,
            ),
            "universe": "Population 25 years and over",
        },
        {
            "id": "birth_region",
            "label": "Place of birth for foreign-born population",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B05006",
                total_column_id="B05006001",
                buckets=birth_region_buckets,
            ),
            "universe": "Foreign-born population",
        },
        {
            "id": "migration",
            "label": "Population migration since previous year",
            "type": "bar",
            "series": _series_from_columns(
                payload,
                geoid,
                table_id="B07003",
                total_column_id="B07003001",
                buckets=migration_buckets,
            ),
            "universe": "Population 1 year and over",
        },
    ]

    section = {
        "id": "social",
        "title": "Social",
        "metrics": [
            metrics["hs_or_higher_pct"],
            metrics["bachelors_or_higher_pct"],
            metrics["foreign_born_pct"],
            metrics["veteran_pct"],
            metrics["language_other_than_english_pct"],
            metrics["moved_last_year_pct"],
        ],
        "charts": charts,
    }
    return section, metrics


def compute_highlights_for_geoid(
    payload: dict[str, Any], geoid: str, name: str | None
) -> dict[str, Any]:
    population = get_estimate(payload, geoid, "B01003", "B01003001")
    median_age = get_estimate(payload, geoid, "B01002", "B01002001")
    median_household_income = _normalize_median(get_estimate(payload, geoid, "B19013", "B19013001"))
    per_capita_income = _normalize_median(get_estimate(payload, geoid, "B19301", "B19301001"))

    poverty_total = get_estimate(payload, geoid, "B17001", "B17001001")
    poverty_below = get_estimate(payload, geoid, "B17001", "B17001002")
    poverty_rate = pct(poverty_below, poverty_total)

    median_rent = _normalize_median(get_estimate(payload, geoid, "B25064", "B25064001"))
    median_home_value = _normalize_median(get_estimate(payload, geoid, "B25077", "B25077001"))

    transport_total = get_estimate(payload, geoid, "B08301", "B08301001")
    transport: dict[str, dict[str, float | int | None]] = {}
    for label, column_id in TRANSPORT_COLUMNS.items():
        count = get_estimate(payload, geoid, "B08301", column_id)
        transport[label] = {
            "count": count,
            "share_pct": pct(count, transport_total),
        }

    education_total = get_estimate(payload, geoid, "B15003", "B15003001")
    high_school_plus_count = sum_estimates(payload, geoid, "B15003", B15003_HIGH_SCHOOL_PLUS)
    bachelors_plus_count = sum_estimates(payload, geoid, "B15003", B15003_BACHELORS_PLUS)

    return {
        "geoid": geoid,
        "name": name,
        "population": population,
        "median_age": median_age,
        "median_household_income": median_household_income,
        "per_capita_income": per_capita_income,
        "poverty": {
            "below_count": poverty_below,
            "total_count": poverty_total,
            "rate_pct": poverty_rate,
        },
        "housing": {
            "median_rent": median_rent,
            "median_home_value": median_home_value,
        },
        "transportation": {
            "total_workers": transport_total,
            "modes": transport,
        },
        "education": {
            "total_population_25_plus": education_total,
            "high_school_or_higher_count": high_school_plus_count,
            "high_school_or_higher_pct": pct(high_school_plus_count, education_total),
            "bachelors_or_higher_count": bachelors_plus_count,
            "bachelors_or_higher_pct": pct(bachelors_plus_count, education_total),
        },
    }


def _metric_extractors() -> dict[str, Callable[[dict[str, Any], str], float | int | None]]:
    return {
        "median_age": lambda payload, geoid: get_estimate(payload, geoid, "B01002", "B01002001"),
        "per_capita_income": lambda payload, geoid: _normalize_median(get_estimate(payload, geoid, "B19301", "B19301001")),
        "median_household_income": lambda payload, geoid: _normalize_median(get_estimate(payload, geoid, "B19013", "B19013001")),
        "poverty_rate": lambda payload, geoid: pct(
            get_estimate(payload, geoid, "B17001", "B17001002"),
            get_estimate(payload, geoid, "B17001", "B17001001"),
        ),
        "mean_travel_time": lambda payload, geoid: get_estimate(payload, geoid, "B08303", "B08303001"),
        "households": lambda payload, geoid: get_estimate(payload, geoid, "B11001", "B11001001"),
        "persons_per_household": lambda payload, geoid: get_estimate(payload, geoid, "B25010", "B25010001"),
        "median_home_value": lambda payload, geoid: _normalize_median(get_estimate(payload, geoid, "B25077", "B25077001")),
        "hs_or_higher_pct": lambda payload, geoid: pct(
            sum_estimates(payload, geoid, "B15003", B15003_HIGH_SCHOOL_PLUS),
            get_estimate(payload, geoid, "B15003", "B15003001"),
        ),
        "bachelors_or_higher_pct": lambda payload, geoid: pct(
            sum_estimates(payload, geoid, "B15003", B15003_BACHELORS_PLUS),
            get_estimate(payload, geoid, "B15003", "B15003001"),
        ),
        "foreign_born_pct": lambda payload, geoid: pct(
            get_estimate(payload, geoid, "B05002", "B05002013"),
            get_estimate(payload, geoid, "B05002", "B05002001"),
        ),
        "veteran_pct": lambda payload, geoid: pct(
            get_estimate(payload, geoid, "B21001", "B21001002"),
            get_estimate(payload, geoid, "B21001", "B21001001"),
        ),
        "moved_last_year_pct": lambda payload, geoid: pct(
            sum_estimates(payload, geoid, "B07003", ["B07003004", "B07003005", "B07003006", "B07003007"]),
            get_estimate(payload, geoid, "B07003", "B07003001"),
        ),
    }


def _build_profile_summary(
    *,
    tract_record: dict[str, Any],
    tract_geoid: str,
    selected_parents: list[dict[str, Any]],
    geography_lookup: dict[str, str | None],
    tract_metrics: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    area_sq_m = _safe_float(tract_record.get("AREALAND") or tract_record.get("ALAND") or tract_record.get("aland"))
    area_sq_mi: float | None = None
    density: float | None = None
    population_value = tract_metrics.get("population", {}).get("estimate") if tract_metrics.get("population") else None
    if area_sq_m and area_sq_m > 0:
        area_sq_mi = area_sq_m / 2_589_988.110336
        if isinstance(population_value, (int, float)) and area_sq_mi > 0:
            density = float(population_value) / area_sq_mi

    hierarchy_geoids: list[str] = [tract_geoid]
    for parent in selected_parents:
        geoid = str(parent.get("geoid") or "")
        if geoid and geoid not in hierarchy_geoids:
            hierarchy_geoids.append(geoid)

    hierarchy = [
        {
            "geoid": geoid,
            "name": geography_lookup.get(geoid),
        }
        for geoid in hierarchy_geoids
    ]

    return {
        "tract_geoid": tract_geoid,
        "tract_name": geography_lookup.get(tract_geoid) or tract_record.get("NAME"),
        "hierarchy": hierarchy,
        "population": population_value,
        "area_sq_m": area_sq_m,
        "area_sq_miles": area_sq_mi,
        "density_per_sq_mile": density,
    }


def build_derived(
    tract_full_payload: dict[str, Any],
    comparisons_payload: dict[str, Any],
    comparison_geoids: list[str],
    tract_geoid: str,
    selected_parents: list[dict[str, Any]],
    tract_record: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, Any]]:
    geography_lookup: dict[str, str | None] = {}
    for source in (tract_full_payload, comparisons_payload):
        for geoid, meta in source.get("geography", {}).items():
            if isinstance(meta, dict):
                geography_lookup[geoid] = meta.get("name")

    tract_name = geography_lookup.get(tract_geoid)
    tract_highlights = compute_highlights_for_geoid(
        tract_full_payload, tract_geoid, name=tract_name
    )

    comparison_highlights: dict[str, dict[str, Any]] = {}
    for geoid in comparison_geoids:
        comparison_highlights[geoid] = compute_highlights_for_geoid(
            comparisons_payload, geoid, name=geography_lookup.get(geoid)
        )

    # Build section-level content.
    sections: list[dict[str, Any]] = []
    metric_map: dict[str, dict[str, Any]] = {}

    population_metric = _metric_block(
        tract_full_payload,
        tract_geoid,
        metric_id="population",
        label="Population",
        table_id="B01003",
        column_id="B01003001",
        format_hint="number",
    )
    metric_map["population"] = population_metric

    demographics_section, demographics_metrics = _build_demographics_section(tract_full_payload, tract_geoid)
    economics_section, economics_metrics = _build_economics_section(tract_full_payload, tract_geoid)
    families_section, families_metrics = _build_families_section(tract_full_payload, tract_geoid)
    housing_section, housing_metrics = _build_housing_section(tract_full_payload, tract_geoid)
    social_section, social_metrics = _build_social_section(tract_full_payload, tract_geoid)

    sections.extend(
        [
            demographics_section,
            economics_section,
            families_section,
            housing_section,
            social_section,
        ]
    )

    for source in [demographics_metrics, economics_metrics, families_metrics, housing_metrics, social_metrics]:
        metric_map.update(source)

    extractors = _metric_extractors()
    comparison_values_by_metric: dict[str, dict[str, float | int | None]] = {}
    for metric_id, extractor in extractors.items():
        comparison_values_by_metric[metric_id] = {
            geoid: extractor(comparisons_payload, geoid) for geoid in comparison_geoids
        }

    comparisons: dict[str, list[dict[str, Any]]] = {}
    for metric_id, metric in metric_map.items():
        if metric_id not in comparison_values_by_metric:
            continue
        tract_value = metric.get("estimate")
        lines = _comparison_lines_for_metric(
            metric,
            tract_value=tract_value,
            comparison_values=comparison_values_by_metric[metric_id],
            selected_parents=selected_parents,
            geography_lookup=geography_lookup,
        )
        if lines:
            comparisons[metric_id] = lines

    for section in sections:
        for metric in section.get("metrics", []):
            metric_id = metric.get("id")
            metric["comparisons"] = comparisons.get(metric_id, [])

    profile_summary = _build_profile_summary(
        tract_record=tract_record,
        tract_geoid=tract_geoid,
        selected_parents=selected_parents,
        geography_lookup=geography_lookup,
        tract_metrics=metric_map,
    )

    return tract_highlights, comparison_highlights, sections, comparisons, profile_summary


def lookup_census_profile_by_point(
    client: httpx.Client,
    *,
    lat: float,
    lon: float,
    acs: str = "latest",
    include_parents: bool = True,
    timeout: float = 20.0,
    retries: int = 3,
    requester: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    requester_fn = requester or request_json
    config = ApiConfig(acs=acs, timeout=timeout, retries=retries)
    errors: list[dict[str, str]] = []

    geocoder_payload = requester_fn(
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
    tract_record = extract_first_tract(geocoder_payload)
    tract_fips = str(tract_record["GEOID"])
    tract_geoid = build_reporter_tract_geoid(tract_fips)
    county_record = extract_optional_first_geography(geocoder_payload, "Counties")
    zcta_record = extract_optional_zcta(geocoder_payload)

    county_geoid: str | None = None
    if county_record and county_record.get("GEOID"):
        county_geoid = build_reporter_county_geoid(str(county_record["GEOID"]))

    zcta_geoid: str | None = None
    if zcta_record:
        zcta_candidate = str(zcta_record.get("GEOID") or zcta_record.get("ZCTA5") or "")
        if zcta_candidate:
            zcta_geoid = build_reporter_zcta_geoid(zcta_candidate)

    required_geoids_by_sumlevel: dict[str, str] = {}
    if zcta_geoid:
        required_geoids_by_sumlevel["860"] = zcta_geoid
    if county_geoid:
        required_geoids_by_sumlevel["050"] = county_geoid

    parents_available: list[dict[str, Any]] = []
    if not include_parents:
        comparison_geoids, selected_parents = build_comparison_geoids(
            tract_geoid,
            parents=[],
            include_parents=False,
            required_geoids_by_sumlevel=required_geoids_by_sumlevel,
        )
    else:
        parents_payload = requester_fn(
            client,
            f"{CENSUS_REPORTER_BASE_URL}/1.0/geo/latest/{tract_geoid}/parents",
            params=None,
            stage="parents",
            config=config,
        )
        parents_available = parents_payload.get("parents", [])
        comparison_geoids, selected_parents = build_comparison_geoids(
            tract_geoid,
            parents_available,
            include_parents=True,
            required_geoids_by_sumlevel=required_geoids_by_sumlevel,
        )

    tract_full_payload, tract_fetch_errors = fetch_data_show_resilient(
        client,
        acs=acs,
        table_ids=FULL_TRACT_TABLES,
        geoids=[tract_geoid],
        stage="tract_full",
        config=config,
        requester=requester_fn,
    )
    errors.extend(tract_fetch_errors)

    comparisons_payload, comparison_fetch_errors = fetch_data_show_resilient(
        client,
        acs=acs,
        table_ids=COMPARISON_TABLES,
        geoids=comparison_geoids,
        stage="comparisons",
        config=config,
        requester=requester_fn,
    )
    errors.extend(comparison_fetch_errors)

    # Census Reporter API does not expose a /data/profiles endpoint.
    profile_payload: dict[str, Any] | None = None

    (
        tract_highlights,
        comparison_highlights,
        sections,
        comparisons,
        profile_summary,
    ) = build_derived(
        tract_full_payload,
        comparisons_payload,
        comparison_geoids,
        tract_geoid,
        selected_parents,
        tract_record,
    )
    release = comparisons_payload.get("release") or tract_full_payload.get("release")

    return {
        "input": {
            "latitude": lat,
            "longitude": lon,
            "acs": acs,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "parameters": {
                "timeout": timeout,
                "retries": retries,
                "include_parents": include_parents,
            },
        },
        "tract": {
            "tract_fips": tract_fips,
            "reporter_geoid": tract_geoid,
            "geocoder_tract_record": tract_record,
        },
        "geography_levels": {
            "census_tract": {
                "reporter_geoid": tract_geoid,
                "geocoder_record": tract_record,
            },
            "zip_code_tabulation_area": {
                "reporter_geoid": zcta_geoid,
                "geocoder_record": zcta_record,
            },
            "county": {
                "reporter_geoid": county_geoid,
                "geocoder_record": county_record,
            },
        },
        "parents": {
            "available": parents_available,
            "selected": selected_parents,
            "comparison_geoids": comparison_geoids,
        },
        "release": release,
        "tables": {
            "tract_full": FULL_TRACT_TABLES,
            "comparisons": COMPARISON_TABLES,
        },
        "data": {
            "tract_full": tract_full_payload,
            "comparisons": comparisons_payload,
            "profile": profile_payload,
        },
        "derived": {
            "profile_summary": profile_summary,
            "tract_highlights": tract_highlights,
            "comparison_highlights_by_geoid": comparison_highlights,
            "sections": sections,
            "comparisons": comparisons,
        },
        "errors": errors,
    }


__all__ = [
    "ApiConfig",
    "CENSUS_GEOCODER_COORDINATES_URL",
    "CENSUS_REPORTER_BASE_URL",
    "COMPARISON_TABLES",
    "FULL_TRACT_TABLES",
    "NoTractFoundError",
    "UpstreamAPIError",
    "build_comparison_geoids",
    "build_reporter_county_geoid",
    "build_reporter_tract_geoid",
    "build_reporter_zcta_geoid",
    "compute_highlights_for_geoid",
    "extract_first_tract",
    "extract_optional_first_geography",
    "extract_optional_zcta",
    "fetch_data_show_resilient",
    "lookup_census_profile_by_point",
    "request_json",
]
