"""Overpass POI fetcher for GroundTruth (Phase 1).

This module fetches nearby OpenStreetMap POIs via Overpass in a single
query, categorizes them, caches results for an hour, and returns
bucketed counts plus a deterministically downsampled list of points.
"""

from __future__ import annotations

import hashlib
import time
import random
from copy import deepcopy
from typing import Dict, List, Tuple, Any

import httpx

CacheKey = Tuple[float, float, int]
CacheValue = Tuple[float, dict]

# In-memory TTL cache
_CACHE: Dict[CacheKey, CacheValue] = {}
_CACHE_TTL = 3600  # seconds

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]

# Category configuration
_CATEGORY_WEIGHTS = {
    "transit": 0.9,
    "parking": 0.85,
    "healthcare": 0.82,
    "grocery": 0.78,
    "parks": 0.70,
    "nightlife": 0.65,
    "food": 0.60,
    "retail": 0.55,
}

_CATEGORY_CAPS = {
    "food": 40,
    "retail": 40,
    "grocery": 25,
    "healthcare": 20,
    "parking": 25,
    "transit": 25,
    "nightlife": 20,
    "parks": 20,
}

_TOTAL_POINTS_CAP = 150


def _make_seed(lat: float, lng: float, radius_m: int) -> int:
    """Stable seed based on rounded coords and radius."""
    key_str = f"{round(lat,3)}|{round(lng,3)}|{radius_m}"
    md5 = hashlib.md5(key_str.encode()).hexdigest()
    return int(md5[:8], 16)


def _build_overpass_query(lat: float, lng: float, radius_m: int) -> str:
    """Construct a single Overpass query covering all categories."""
    amenity_regex = "^(cafe|restaurant|fast_food|bar|pub|nightclub|pharmacy|clinic|hospital|doctors|dentist|parking)$"
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"~"{amenity_regex}"](around:{radius_m},{lat},{lng});
      way["amenity"~"{amenity_regex}"](around:{radius_m},{lat},{lng});
      relation["amenity"~"{amenity_regex}"](around:{radius_m},{lat},{lng});

      node["shop"](around:{radius_m},{lat},{lng});
      way["shop"](around:{radius_m},{lat},{lng});
      relation["shop"](around:{radius_m},{lat},{lng});

      node["highway"="bus_stop"](around:{radius_m},{lat},{lng});
      way["highway"="bus_stop"](around:{radius_m},{lat},{lng});
      relation["highway"="bus_stop"](around:{radius_m},{lat},{lng});

      node["public_transport"="platform"](around:{radius_m},{lat},{lng});
      way["public_transport"="platform"](around:{radius_m},{lat},{lng});
      relation["public_transport"="platform"](around:{radius_m},{lat},{lng});

      node["railway"="station"](around:{radius_m},{lat},{lng});
      way["railway"="station"](around:{radius_m},{lat},{lng});
      relation["railway"="station"](around:{radius_m},{lat},{lng});

      node["leisure"="park"](around:{radius_m},{lat},{lng});
      way["leisure"="park"](around:{radius_m},{lat},{lng});
      relation["leisure"="park"](around:{radius_m},{lat},{lng});
    );
    out center tags;
    """
    return "\n".join(line.strip() for line in query.splitlines() if line.strip())


async def _fetch_overpass(query: str) -> dict:
    """Try Overpass endpoints sequentially until one succeeds."""
    timeout = httpx.Timeout(25.0, connect=10.0)
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = await client.post(endpoint, data={"data": query})
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # broad to allow failover
                last_error = exc
                continue
    raise RuntimeError(
        "Overpass request failed for all endpoints" + (f": {last_error}" if last_error else "")
    )


def _extract_coords(el: dict) -> Tuple[float | None, float | None]:
    if "lat" in el and "lon" in el:
        return el.get("lat"), el.get("lon")
    center = el.get("center") or {}
    lat = center.get("lat")
    lon = center.get("lon")
    return lat, lon


def _categorize(tags: Dict[str, Any]) -> str | None:
    amenity = tags.get("amenity")
    shop = tags.get("shop")
    leisure = tags.get("leisure")
    highway = tags.get("highway")
    public_transport = tags.get("public_transport")
    railway = tags.get("railway")

    # Transit first to avoid mislabeling stations that also have amenities/shops.
    if highway == "bus_stop" or public_transport == "platform" or railway == "station":
        return "transit"

    if amenity == "parking":
        return "parking"

    if leisure == "park":
        return "parks"

    if shop:
        if shop in {"supermarket", "convenience"}:
            return "grocery"
        return "retail"

    if amenity in {"pharmacy", "clinic", "hospital", "doctors", "dentist"}:
        return "healthcare"

    if amenity in {"bar", "pub", "nightclub"}:
        return "nightlife"

    if amenity in {"cafe", "restaurant", "fast_food"}:
        return "food"

    return None


def _downsample_points(points_by_cat: Dict[str, List[dict]], seed: int) -> List[dict]:
    rng = random.Random(seed)
    selected: List[dict] = []

    # Per-category caps with deterministic selection
    for idx, (cat, cap) in enumerate(_CATEGORY_CAPS.items()):
        pts = points_by_cat.get(cat, [])
        if not pts:
            continue
        if len(pts) > cap:
            rng_cat = random.Random(seed + idx + 1)
            pts = rng_cat.sample(pts, cap)
        else:
            rng.shuffle(pts)
        selected.extend(pts)

    # Global cap
    if len(selected) > _TOTAL_POINTS_CAP:
        selected = rng.sample(selected, _TOTAL_POINTS_CAP)

    return selected


def _now_ts() -> int:
    return int(time.time())


async def get_overpass_pois(lat: float, lng: float, radius_m: int) -> dict:
    """Fetch POIs around a location and return categorized counts and points."""
    key: CacheKey = (round(lat, 3), round(lng, 3), radius_m)
    now = _now_ts()

    cached = _CACHE.get(key)
    if cached:
        ts, data = cached
        if now - ts < _CACHE_TTL:
            # Refresh timestamp to extend life a bit on hits
            _CACHE[key] = (now, data)
            data_copy = deepcopy(data)
            data_copy["meta"]["cached"] = True
            data_copy["meta"]["ts"] = now
            return data_copy

    query = _build_overpass_query(lat, lng, radius_m)
    payload = await _fetch_overpass(query)
    elements = payload.get("elements", []) if isinstance(payload, dict) else []

    counts = {cat: 0 for cat in _CATEGORY_CAPS.keys()}
    points_by_cat: Dict[str, List[dict]] = {cat: [] for cat in _CATEGORY_CAPS.keys()}

    for el in elements:
        tags = el.get("tags") or {}
        category = _categorize(tags)
        if not category:
            continue

        lat_el, lon_el = _extract_coords(el)
        if lat_el is None or lon_el is None:
            continue

        counts[category] += 1
        point = {
            "type": category,
            "lat": float(lat_el),
            "lng": float(lon_el),
            "weight": _CATEGORY_WEIGHTS[category],
        }
        name = tags.get("name")
        if name:
            point["name"] = name
        points_by_cat[category].append(point)

    seed = _make_seed(lat, lng, radius_m)
    selected_points = _downsample_points(points_by_cat, seed)

    result = {
        "counts": counts,
        "points": selected_points,
        "meta": {
            "radius_m": radius_m,
            "total_elements": len(elements),
            "returned_points": len(selected_points),
            "cached": False,
            "ts": now,
        },
    }

    _CACHE[key] = (now, deepcopy(result))
    return result
