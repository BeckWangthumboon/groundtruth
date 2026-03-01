"""Chicago crime fetch + hotspot aggregation (Phase 3)."""

from __future__ import annotations

import math
import time
from collections import Counter, defaultdict
from copy import deepcopy
from typing import Dict, List, Tuple

import httpx

# TTL cache (seconds)
_CACHE: Dict[Tuple[float, float, int, int], Tuple[int, list]] = {}
_CACHE_TTL = 1800  # 30 minutes

DATASET_URL = "https://data.cityofchicago.org/resource/ijzp-q8t2.json"


def _now_ts() -> int:
    return int(time.time())


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _date_filter_iso(days_back: int) -> str:
    # Socrata expects ISO-8601; time.time() in seconds
    cutoff_ts = _now_ts() - days_back * 86400
    return time.strftime("%Y-%m-%dT00:00:00", time.gmtime(cutoff_ts))


async def fetch_chicago_crimes(
    lat: float, lng: float, radius_m: int, days_back: int = 90, limit: int = 1200
) -> List[dict]:
    """
    Fetch recent crimes using Socrata API. Attempts within_circle on the `location` field first.
    Falls back to client-side filtering with lat/lng if needed.
    """
    key = (round(lat, 4), round(lng, 4), radius_m, days_back)
    now = _now_ts()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return deepcopy(cached[1])

    params_base = {
        "$limit": limit,
        "$order": "date DESC",
        "$select": "date,primary_type,description,block,latitude,longitude,location",
    }
    cutoff = _date_filter_iso(days_back)
    params = {
        **params_base,
        "$where": f"within_circle(location,{lat},{lng},{radius_m}) AND date >= '{cutoff}'",
    }

    timeout = httpx.Timeout(20.0, connect=8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        rows: List[dict] = []
        try:
            resp = await client.get(DATASET_URL, params=params)
            resp.raise_for_status()
            rows = resp.json()
        except Exception:
            # Fallback: fetch recent by date only, filter client-side
            params_fallback = {**params_base, "$where": f"date >= '{cutoff}'"}
            resp = await client.get(DATASET_URL, params=params_fallback)
            resp.raise_for_status()
            raw_rows = resp.json()
            rows = []
            for r in raw_rows:
                try:
                    la = float(r.get("latitude"))
                    lo = float(r.get("longitude"))
                except (TypeError, ValueError):
                    continue
                if _haversine_m(lat, lng, la, lo) <= radius_m:
                    rows.append(r)

    _CACHE[key] = (now, deepcopy(rows))
    return rows


def _top_crime_types(rows: List[dict], n: int = 5) -> List[dict]:
    counter = Counter(r.get("primary_type") or "UNKNOWN" for r in rows)
    return [{"type": t, "count": c} for t, c in counter.most_common(n)]


def aggregate_crime_hotspots(rows: List[dict], max_hotspots: int = 80) -> dict:
    """
    Group crimes into hotspots (by block when available, else by rounded coords).
    """
    if not rows:
        return {
            "summary": {"crimeCount": 0, "topCrimeTypes": [], "crimeRateProxy": 0.0},
            "hotspots": [],
        }

    groups: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        block = r.get("block")
        key = block.strip() if isinstance(block, str) and block.strip() else None
        if not key:
            try:
                lat = round(float(r.get("latitude")), 3)
                lng = round(float(r.get("longitude")), 3)
                key = f"{lat},{lng}"
            except Exception:
                continue
        groups[key].append(r)

    hotspots = []
    for key, items in groups.items():
        lat_vals = []
        lng_vals = []
        for r in items:
            try:
                lat_vals.append(float(r.get("latitude")))
                lng_vals.append(float(r.get("longitude")))
            except Exception:
                continue
        if not lat_vals or not lng_vals:
            continue
        lat_mean = sum(lat_vals) / len(lat_vals)
        lng_mean = sum(lng_vals) / len(lng_vals)
        top_types = _top_crime_types(items, n=3)
        hotspots.append(
            {
                "type": "crime_hotspot",
                "lat": lat_mean,
                "lng": lng_mean,
                "count": len(items),
                "block": key if "block" in items[0] and items[0].get("block") else None,
                "topCrimeTypes": top_types,
            }
        )

    hotspots.sort(key=lambda h: h["count"], reverse=True)
    hotspots = hotspots[:max_hotspots]

    # Normalize weight
    max_count = hotspots[0]["count"] if hotspots else 1
    for h in hotspots:
        h["weight"] = round(h["count"] / max_count, 3)

    summary = {
        "crimeCount": len(rows),
        "topCrimeTypes": _top_crime_types(rows, n=5),
        "crimeRateProxy": 0.0,  # filled by bundle helper
    }

    return {"summary": summary, "hotspots": hotspots}


async def get_chicago_crime_bundle(
    lat: float, lng: float, radius_m: int, days_back: int = 90, limit: int = 1200
) -> dict:
    """
    Convenience wrapper returning summary + hotspots + meta.
    """
    rows = await fetch_chicago_crimes(lat, lng, radius_m, days_back=days_back, limit=limit)
    agg = aggregate_crime_hotspots(rows)

    area_km2 = math.pi * (radius_m / 1000) ** 2
    incidents_per_km2 = agg["summary"]["crimeCount"] / area_km2 if area_km2 > 0 else 0
    crime_rate_proxy = min(1.0, incidents_per_km2 / 50.0)  # simple cap
    agg["summary"]["crimeRateProxy"] = round(crime_rate_proxy, 3)

    agg["meta"] = {
        "days_back": days_back,
        "radius_m": radius_m,
        "cached": False,
    }
    return agg

