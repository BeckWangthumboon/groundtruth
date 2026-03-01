#!/usr/bin/env python3
"""Discover OSM POI tag values around a point via Overpass.

This script runs a broad Overpass query and reports distinct values + counts for
these POI-related keys by default:
  - amenity
  - shop
  - leisure
  - tourism
  - office
  - craft

Optionally, --all-tags enables discovery across all tag keys/values.

Usage:
  python3 scripts/poi_discovery/discover_poi_types.py --lat 43.074 --lon -89.384
  python3 scripts/poi_discovery/discover_poi_types.py --lat 43.074 --lon -89.384 --radius-m 5000 --top 50
  python3 scripts/poi_discovery/discover_poi_types.py --lat 43.074 --lon -89.384 --all-tags --top 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections import Counter
from typing import Any

import httpx

DEFAULT_TAG_KEYS = ("amenity", "shop", "leisure", "tourism", "office", "craft")
MAX_DISCOVERY_RADIUS_M = 5000
DEFAULT_DISCOVERY_RADIUS_M = 1000

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]


def _validate_coordinates(lat: float, lon: float) -> None:
    if lat < -90 or lat > 90:
        raise ValueError(f"Latitude must be between -90 and 90. Got: {lat}")
    if lon < -180 or lon > 180:
        raise ValueError(f"Longitude must be between -180 and 180. Got: {lon}")


def _effective_radius(radius_m: int) -> tuple[int, bool]:
    if radius_m <= 0:
        raise ValueError(f"radius_m must be > 0. Got: {radius_m}")
    if radius_m > MAX_DISCOVERY_RADIUS_M:
        return MAX_DISCOVERY_RADIUS_M, True
    return radius_m, False


def _build_overpass_query(
    lat: float,
    lon: float,
    radius_m: int,
    tag_keys: tuple[str, ...],
    *,
    all_tags: bool,
) -> str:
    lines = ["[out:json][timeout:25];", "("]

    if all_tags:
        for osm_type in ("node", "way", "relation"):
            # [~"."~"."] matches any non-empty key and value pair.
            lines.append(f'  {osm_type}[~"."~"."](around:{radius_m},{lat},{lon});')
    else:
        for key in tag_keys:
            for osm_type in ("node", "way", "relation"):
                lines.append(f'  {osm_type}["{key}"](around:{radius_m},{lat},{lon});')

    lines.extend([");", "out center tags;"])
    return "\n".join(lines)


async def _fetch_overpass(query: str) -> tuple[dict[str, Any], str]:
    timeout = httpx.Timeout(25.0, connect=10.0)
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                response = await client.post(endpoint, data={"data": query})
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise RuntimeError("Unexpected Overpass response type (expected JSON object).")
                return payload, endpoint
            except Exception as exc:
                last_error = exc
                continue

    raise RuntimeError(
        "Overpass request failed for all endpoints"
        + (f": {last_error}" if last_error else "")
    )


def _build_tag_summary(
    elements: list[dict[str, Any]],
    top: int,
    tag_keys: tuple[str, ...] | None,
) -> dict[str, Any]:
    counters: dict[str, Counter[str]] = {}
    keys_filter = set(tag_keys) if tag_keys is not None else None

    for element in elements:
        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        for key, value in tags.items():
            if keys_filter is not None and key not in keys_filter:
                continue
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    counters.setdefault(key, Counter())[normalized] += 1

    summary: dict[str, Any] = {}
    keys_to_render = sorted(counters.keys()) if tag_keys is None else tag_keys
    for key in keys_to_render:
        key_counter = counters.get(key, Counter())
        items = sorted(key_counter.items(), key=lambda item: (-item[1], item[0]))
        if top > 0:
            items = items[:top]

        summary[key] = {
            "distinct_values": len(key_counter),
            "tagged_elements": int(sum(key_counter.values())),
            "values": [{"value": value, "count": int(count)} for value, count in items],
        }

    return summary


async def discover_poi_types(
    lat: float,
    lon: float,
    radius_m: int,
    top: int,
    *,
    all_tags: bool,
) -> dict[str, Any]:
    _validate_coordinates(lat, lon)
    effective_radius, radius_was_clamped = _effective_radius(radius_m)
    active_keys = None if all_tags else DEFAULT_TAG_KEYS

    query = _build_overpass_query(
        lat,
        lon,
        effective_radius,
        tag_keys=DEFAULT_TAG_KEYS,
        all_tags=all_tags,
    )
    payload, endpoint = await _fetch_overpass(query)
    elements = payload.get("elements", [])
    if not isinstance(elements, list):
        elements = []

    return {
        "meta": {
            "lat": lat,
            "lon": lon,
            "requested_radius_m": radius_m,
            "effective_radius_m": effective_radius,
            "max_discovery_radius_m": MAX_DISCOVERY_RADIUS_M,
            "radius_was_clamped": radius_was_clamped,
            "top_limit": top,
            "discovery_mode": "all_tags" if all_tags else "selected_keys",
            "query_tag_keys": sorted(DEFAULT_TAG_KEYS) if not all_tags else "ALL",
            "total_elements": len(elements),
            "overpass_endpoint": endpoint,
            "ts": int(time.time()),
        },
        "tag_summary": _build_tag_summary(elements, top=top, tag_keys=active_keys),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Discover distinct OSM POI type values around a point using Overpass. "
            f"Radius is capped at {MAX_DISCOVERY_RADIUS_M} meters."
        )
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude (-90..90).")
    parser.add_argument("--lon", type=float, required=True, help="Longitude (-180..180).")
    parser.add_argument(
        "--radius-m",
        type=int,
        default=DEFAULT_DISCOVERY_RADIUS_M,
        help=(
            "Discovery radius in meters. "
            f"Any value greater than {MAX_DISCOVERY_RADIUS_M} is clamped."
        ),
    )
    parser.add_argument(
        "--top",
        type=int,
        default=0,
        help=(
            "Limit each key's value list to top N by count. "
            "Use 0 to include all distinct values."
        ),
    )
    parser.add_argument(
        "--out",
        type=str,
        default="",
        help="Optional path to write JSON output. If omitted, prints to stdout.",
    )
    parser.add_argument(
        "--all-tags",
        action="store_true",
        help=(
            "Discover all tag keys/values (not limited to default POI keys). "
            "This can return much larger and noisier results."
        ),
    )
    return parser.parse_args()


async def _async_main() -> int:
    args = _parse_args()
    if args.top < 0:
        raise ValueError(f"--top must be >= 0. Got: {args.top}")

    report = await discover_poi_types(
        lat=args.lat,
        lon=args.lon,
        radius_m=args.radius_m,
        top=args.top,
        all_tags=args.all_tags,
    )

    serialized = json.dumps(report, indent=2, sort_keys=True)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(serialized)
            f.write("\n")
        print(f"Wrote discovery report to {args.out}")
    else:
        print(serialized)
    return 0


def main() -> int:
    return asyncio.run(_async_main())


if __name__ == "__main__":
    raise SystemExit(main())
