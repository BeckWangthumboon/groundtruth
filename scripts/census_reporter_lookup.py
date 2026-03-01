#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx

from backend.app.census_profile_service import (
    CENSUS_GEOCODER_COORDINATES_URL,
    CENSUS_REPORTER_BASE_URL,
    COMPARISON_TABLES,
    FULL_TRACT_TABLES,
    NoTractFoundError,
    UpstreamAPIError,
    build_comparison_geoids,
    build_reporter_county_geoid,
    build_reporter_tract_geoid,
    build_reporter_zcta_geoid,
    compute_highlights_for_geoid,
    extract_first_tract,
    extract_optional_first_geography,
    extract_optional_zcta,
    lookup_census_profile_by_point,
    request_json,
)

EXIT_INVALID_ARGS = 2
EXIT_NO_TRACT = 3
EXIT_UPSTREAM_FAILURE = 4


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


def _fmt_number(value: object, *, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if value.is_integer():
            return f"{int(value):,}"
        return f"{value:,.{decimals}f}"
    return "N/A"


def _fmt_currency(value: object) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"${int(round(value)):,}"
    return "N/A"


def _fmt_pct(value: object) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"{value:.1f}%"
    return "N/A"


def print_summary(result: dict[str, object], output_path: Path) -> None:
    tract = result["tract"]
    assert isinstance(tract, dict)
    derived = result["derived"]
    assert isinstance(derived, dict)
    tract_highlights = derived["tract_highlights"]
    assert isinstance(tract_highlights, dict)

    parents = result["parents"]
    assert isinstance(parents, dict)
    comparison_geoids = parents.get("comparison_geoids")
    if not isinstance(comparison_geoids, list):
        comparison_geoids = []

    comparison_highlights = derived.get("comparison_highlights_by_geoid")
    if not isinstance(comparison_highlights, dict):
        comparison_highlights = {}

    geocoder_tract = tract.get("geocoder_tract_record")
    tract_name = geocoder_tract.get("NAME") if isinstance(geocoder_tract, dict) else None

    print(f"Saved: {output_path}")
    print(f"Tract GEOID: {tract.get('reporter_geoid')}")
    if tract_name:
        print(f"Tract Name: {tract_name}")
    print("")
    print("Tract highlights:")
    print(f"- Population: {_fmt_number(tract_highlights.get('population'), decimals=0)}")
    print(f"- Median age: {_fmt_number(tract_highlights.get('median_age'))}")
    print(
        "- Median household income: "
        f"{_fmt_currency(tract_highlights.get('median_household_income'))}"
    )
    print(f"- Per capita income: {_fmt_currency(tract_highlights.get('per_capita_income'))}")
    poverty = tract_highlights.get("poverty")
    poverty_rate = poverty.get("rate_pct") if isinstance(poverty, dict) else None
    print(f"- Poverty rate: {_fmt_pct(poverty_rate)}")
    housing = tract_highlights.get("housing")
    median_rent = housing.get("median_rent") if isinstance(housing, dict) else None
    median_home = housing.get("median_home_value") if isinstance(housing, dict) else None
    print(f"- Median rent: {_fmt_currency(median_rent)}")
    print(f"- Median home value: {_fmt_currency(median_home)}")

    education = tract_highlights.get("education")
    hs_pct = education.get("high_school_or_higher_pct") if isinstance(education, dict) else None
    ba_pct = education.get("bachelors_or_higher_pct") if isinstance(education, dict) else None
    print(f"- Education (25+): HS+ {_fmt_pct(hs_pct)}, Bachelor+ {_fmt_pct(ba_pct)}")

    if len(comparison_geoids) > 1:
        print("")
        print("Comparisons:")
        for geoid in comparison_geoids:
            item = comparison_highlights.get(geoid)
            if not isinstance(item, dict):
                continue
            name = item.get("name") or geoid
            population = _fmt_number(item.get("population"), decimals=0)
            mhi = _fmt_currency(item.get("median_household_income"))
            item_poverty = item.get("poverty")
            item_poverty_rate = item_poverty.get("rate_pct") if isinstance(item_poverty, dict) else None
            poverty_text = _fmt_pct(item_poverty_rate)
            print(f"- {name} ({geoid}): pop {population}; MHI {mhi}; poverty {poverty_text}")


def lookup_census(args: argparse.Namespace) -> dict[str, object]:
    output_path = args.out or default_output_path(args.lat, args.lon)

    with httpx.Client(follow_redirects=True) as client:
        result = lookup_census_profile_by_point(
            client,
            lat=args.lat,
            lon=args.lon,
            acs=args.acs,
            include_parents=not args.no_parents,
            timeout=args.timeout,
            retries=args.retries,
            requester=request_json,
        )

    # Script-only metadata remains local to CLI output.
    input_block = result.get("input")
    if isinstance(input_block, dict):
        parameters = input_block.get("parameters")
        if isinstance(parameters, dict):
            parameters["pretty"] = bool(args.pretty)

    result["output_path"] = str(output_path)
    return result


def write_output(payload: dict[str, object], output_path: Path, pretty: bool) -> None:
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
