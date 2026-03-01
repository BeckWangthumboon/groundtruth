#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


CENSUS_GEOCODER_COORDINATES_URL = (
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
)
CENSUS_REPORTER_BASE_URL = "https://api.censusreporter.org"

EXIT_INVALID_ARGS = 2
EXIT_NO_TRACT = 3
EXIT_UPSTREAM_FAILURE = 4

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

COMPARISON_TABLES = [
    "B01003",
    "B01002",
    "B19013",
    "B19301",
    "B17001",
    "B25077",
    "B25064",
    "B08301",
    "B15003",
    "B05002",
    "B07003",
    "B03002",
    "B25002",
    "B25003",
]

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


@dataclass(frozen=True)
class ApiConfig:
    acs: str
    timeout: float
    retries: int


class UpstreamAPIError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(f"[{stage}] {message}")
        self.stage = stage
        self.message = message


class NoTractFoundError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Look up census tract data for a coordinate using Census Geocoder and "
            "Census Reporter APIs."
        )
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude in decimal degrees.")
    parser.add_argument(
        "--lon", type=float, required=True, help="Longitude in decimal degrees."
    )
    parser.add_argument(
        "--acs",
        type=str,
        default="latest",
        help="Census Reporter ACS release ID, e.g. latest or acs2024_5yr.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output JSON file path. Defaults to scripts/out/census_<lat>_<lon>.json",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP timeout in seconds (default: 20).",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry count for timeout/429/5xx failures (default: 3).",
    )
    parser.add_argument(
        "--no-parents",
        action="store_true",
        help="Only return tract-level data without parent geography comparisons.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print output JSON with indentation.",
    )
    return parser


def default_output_path(lat: float, lon: float) -> Path:
    return Path("scripts/out") / f"census_{lat:.6f}_{lon:.6f}.json"


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if not -90 <= args.lat <= 90:
        parser.error("--lat must be between -90 and 90.")
    if not -180 <= args.lon <= 180:
        parser.error("--lon must be between -180 and 180.")
    if args.timeout <= 0:
        parser.error("--timeout must be > 0.")
    if args.retries < 0:
        parser.error("--retries must be >= 0.")


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
    headers = {"User-Agent": "groundtruth-census-tools/0.1"}
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
) -> dict[str, Any]:
    url = f"{CENSUS_REPORTER_BASE_URL}/1.0/data/show/{acs}"
    params = {
        "table_ids": ",".join(table_ids),
        "geo_ids": ",".join(geoids),
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
    geoids: list[str],
    stage: str,
    config: ApiConfig,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    try:
        payload = fetch_data_show(
            client,
            acs=acs,
            table_ids=table_ids,
            geoids=geoids,
            stage=stage,
            config=config,
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


def pct(part: float | int | None, whole: float | int | None) -> float | None:
    if part is None or whole in (None, 0):
        return None
    return (float(part) / float(whole)) * 100.0


def compute_highlights_for_geoid(
    payload: dict[str, Any], geoid: str, name: str | None
) -> dict[str, Any]:
    population = get_estimate(payload, geoid, "B01003", "B01003001")
    median_age = get_estimate(payload, geoid, "B01002", "B01002001")
    median_household_income = get_estimate(payload, geoid, "B19013", "B19013001")
    per_capita_income = get_estimate(payload, geoid, "B19301", "B19301001")

    poverty_total = get_estimate(payload, geoid, "B17001", "B17001001")
    poverty_below = get_estimate(payload, geoid, "B17001", "B17001002")
    poverty_rate = pct(poverty_below, poverty_total)

    median_rent = get_estimate(payload, geoid, "B25064", "B25064001")
    median_home_value = get_estimate(payload, geoid, "B25077", "B25077001")

    # Census Reporter can surface sentinel negative values for unavailable medians.
    if isinstance(median_household_income, (int, float)) and median_household_income < 0:
        median_household_income = None
    if isinstance(per_capita_income, (int, float)) and per_capita_income < 0:
        per_capita_income = None
    if isinstance(median_rent, (int, float)) and median_rent < 0:
        median_rent = None
    if isinstance(median_home_value, (int, float)) and median_home_value < 0:
        median_home_value = None

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


def build_derived(
    tract_full_payload: dict[str, Any],
    comparisons_payload: dict[str, Any],
    comparison_geoids: list[str],
    tract_geoid: str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    geography_lookup: dict[str, str | None] = {}
    for source in (tract_full_payload, comparisons_payload):
        for geoid, meta in source.get("geography", {}).items():
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
    return tract_highlights, comparison_highlights


def _fmt_number(value: Any, *, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if value.is_integer():
            return f"{int(value):,}"
        return f"{value:,.{decimals}f}"
    return "N/A"


def _fmt_currency(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"${int(round(value)):,}"
    return "N/A"


def _fmt_pct(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"{value:.1f}%"
    return "N/A"


def print_summary(result: dict[str, Any], output_path: Path) -> None:
    tract = result["tract"]
    tract_highlights = result["derived"]["tract_highlights"]
    comparison_geoids = result["parents"]["comparison_geoids"]
    comparison_highlights = result["derived"]["comparison_highlights_by_geoid"]

    tract_name = tract.get("geocoder_tract_record", {}).get("NAME")
    print(f"Saved: {output_path}")
    print(f"Tract GEOID: {tract['reporter_geoid']}")
    if tract_name:
        print(f"Tract Name: {tract_name}")
    print("")
    print("Tract highlights:")
    print(f"- Population: {_fmt_number(tract_highlights['population'], decimals=0)}")
    print(f"- Median age: {_fmt_number(tract_highlights['median_age'])}")
    print(
        f"- Median household income: "
        f"{_fmt_currency(tract_highlights['median_household_income'])}"
    )
    print(f"- Per capita income: {_fmt_currency(tract_highlights['per_capita_income'])}")
    print(f"- Poverty rate: {_fmt_pct(tract_highlights['poverty']['rate_pct'])}")
    print(f"- Median rent: {_fmt_currency(tract_highlights['housing']['median_rent'])}")
    print(
        f"- Median home value: {_fmt_currency(tract_highlights['housing']['median_home_value'])}"
    )
    print(
        "- Education (25+): "
        f"HS+ {_fmt_pct(tract_highlights['education']['high_school_or_higher_pct'])}, "
        f"Bachelor+ {_fmt_pct(tract_highlights['education']['bachelors_or_higher_pct'])}"
    )

    if len(comparison_geoids) > 1:
        print("")
        print("Comparisons:")
        for geoid in comparison_geoids:
            data = comparison_highlights.get(geoid, {})
            name = data.get("name") or geoid
            population = _fmt_number(data.get("population"), decimals=0)
            mhi = _fmt_currency(data.get("median_household_income"))
            poverty = _fmt_pct((data.get("poverty") or {}).get("rate_pct"))
            print(f"- {name} ({geoid}): pop {population}; MHI {mhi}; poverty {poverty}")


def lookup_census(args: argparse.Namespace) -> dict[str, Any]:
    output_path = args.out or default_output_path(args.lat, args.lon)
    config = ApiConfig(acs=args.acs, timeout=args.timeout, retries=args.retries)
    errors: list[dict[str, str]] = []

    with httpx.Client(follow_redirects=True) as client:
        geocoder_payload = request_json(
            client,
            CENSUS_GEOCODER_COORDINATES_URL,
            params={
                "x": args.lon,
                "y": args.lat,
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
        if args.no_parents:
            comparison_geoids, selected_parents = build_comparison_geoids(
                tract_geoid,
                parents=[],
                include_parents=False,
                required_geoids_by_sumlevel=required_geoids_by_sumlevel,
            )
        else:
            parents_payload = request_json(
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
            acs=args.acs,
            table_ids=FULL_TRACT_TABLES,
            geoids=[tract_geoid],
            stage="tract_full",
            config=config,
        )
        errors.extend(tract_fetch_errors)

        comparisons_payload, comparison_fetch_errors = fetch_data_show_resilient(
            client,
            acs=args.acs,
            table_ids=COMPARISON_TABLES,
            geoids=comparison_geoids,
            stage="comparisons",
            config=config,
        )
        errors.extend(comparison_fetch_errors)

        # Census Reporter API does not expose a /data/profiles endpoint.
        profile_payload: dict[str, Any] | None = None

    tract_highlights, comparison_highlights = build_derived(
        tract_full_payload, comparisons_payload, comparison_geoids, tract_geoid
    )
    release = comparisons_payload.get("release") or tract_full_payload.get("release")

    return {
        "input": {
            "latitude": args.lat,
            "longitude": args.lon,
            "acs": args.acs,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "parameters": {
                "timeout": args.timeout,
                "retries": args.retries,
                "include_parents": not args.no_parents,
                "pretty": bool(args.pretty),
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
            "tract_highlights": tract_highlights,
            "comparison_highlights_by_geoid": comparison_highlights,
        },
        "errors": errors,
        "output_path": str(output_path),
    }


def write_output(payload: dict[str, Any], output_path: Path, pretty: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        if pretty:
            json.dump(payload, f, indent=2, ensure_ascii=True)
            f.write("\n")
        else:
            json.dump(payload, f, ensure_ascii=True)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    validate_args(parser, args)

    output_path = args.out or default_output_path(args.lat, args.lon)

    try:
        result = lookup_census(args)
        write_output(result, output_path, pretty=args.pretty)
        print_summary(result, output_path)
        return 0
    except NoTractFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_NO_TRACT
    except UpstreamAPIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_UPSTREAM_FAILURE
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_INVALID_ARGS


if __name__ == "__main__":
    raise SystemExit(main())
