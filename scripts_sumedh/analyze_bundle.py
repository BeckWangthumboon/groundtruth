"""Location bundle orchestrator (Phase 5)."""

from __future__ import annotations

import math
from typing import Dict, List

from scripts_sumedh.overpass_pois import get_overpass_pois
from scripts_sumedh.activity import compute_activity
from scripts_sumedh.chicago_crime import get_chicago_crime_bundle
from scripts_sumedh.disaster import compute_disaster_risk


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _norm(val: float, cap: float) -> float:
    return min(1.0, val / cap) if cap > 0 else 0.0


def _pick_radius(mode: str) -> int:
    return 1800 if mode == "business" else 1200


async def analyze_location_bundle(lat: float, lng: float, mode: str) -> dict:
    """
    Compose POIs, activity, crime, and disaster risk into a single bundle.
    """
    mode = (mode or "resident").lower()
    radius_m = _pick_radius(mode)

    pois = await get_overpass_pois(lat, lng, radius_m)
    activity = compute_activity(pois["counts"], pois["points"], lat, lng, mode)
    disaster = compute_disaster_risk(lat, lng)

    # Chicago crime only if near Chicago (~60km)
    dist_chi = _haversine_m(lat, lng, 41.8781, -87.6298)
    if dist_chi <= 60000:
        crime = await get_chicago_crime_bundle(lat, lng, radius_m)
    else:
        crime = {
            "summary": {"crimeCount": 0, "topCrimeTypes": [], "crimeRateProxy": 0.0},
            "hotspots": [],
            "meta": {"note": "outside Chicago coverage", "radius_m": radius_m, "cached": False},
        }

    counts = pois["counts"]
    amenity_density = counts.get("food", 0) + counts.get("retail", 0) + counts.get("grocery", 0) + counts.get("healthcare", 0) + counts.get("nightlife", 0)
    essentials = counts.get("grocery", 0) + counts.get("healthcare", 0)
    nightlife = counts.get("nightlife", 0)
    transit = counts.get("transit", 0)
    parking = counts.get("parking", 0)

    metrics_raw = {
        "amenityDensity": amenity_density,
        "transit": transit,
        "parking": parking,
        "essentials": essentials,
        "nightlife": nightlife,
        "activityIndex": activity["activityIndex"],
        "crimeRateProxy": crime["summary"]["crimeRateProxy"],
        "disasterRisk": disaster["overallRisk"],
    }

    metrics_norm = {
        "amenityDensity": _norm(amenity_density, 120),
        "transitAccess": _norm(transit, 30),
        "parkingAccess": _norm(parking, 20),
        "essentialsAccess": _norm(essentials, 25),
        "nightlifeIndex": _norm(nightlife, 20),
        "activityIndexNorm": _norm(activity["activityIndex"], 100),
        "crimeRisk": crime["summary"]["crimeRateProxy"],
        "disasterRisk": disaster["overallRisk"],
    }

    signals: List[dict] = []
    signals.extend(pois["points"])
    for h in crime.get("hotspots", []):
        signals.append(
            {
                "type": "crime_hotspot",
                "lat": h["lat"],
                "lng": h["lng"],
                "weight": h.get("weight", 0.0),
                "count": h.get("count"),
                "label": h.get("block"),
                "topCrimeTypes": h.get("topCrimeTypes"),
            }
        )
    # optional hazard markers
    for hazard, val in disaster["hazards"].items():
        signals.append(
            {
                "type": f"hazard_{hazard}",
                "lat": lat,
                "lng": lng,
                "weight": val,
            }
        )

    positives = []
    negatives = []

    if metrics_norm["amenityDensity"] > 0.6:
        positives.append("Dense amenity mix nearby.")
    if metrics_norm["transitAccess"] > 0.5:
        positives.append("Good transit access within walking distance.")
    if metrics_norm["essentialsAccess"] > 0.5:
        positives.append("Groceries and healthcare are close.")
    if metrics_norm["activityIndexNorm"] > 0.6:
        positives.append("Overall activity level is strong.")

    if metrics_norm["crimeRisk"] > 0.6:
        negatives.append("Higher recent crime density nearby.")
    if metrics_norm["disasterRisk"] > 0.6:
        negatives.append("Elevated simulated disaster risk.")
    if metrics_norm["parkingAccess"] < 0.3 and mode == "business":
        negatives.append("Limited parking access for visitors.")
    if metrics_norm["transitAccess"] < 0.2:
        negatives.append("Weak transit access in the area.")

    positives = positives[:3] or ["No major positives detected."]
    negatives = negatives[:3] or ["No major negatives detected."]

    bundle = {
        "location": {"lat": lat, "lng": lng},
        "mode": mode,
        "metrics": {
            "raw": metrics_raw,
            "norm": metrics_norm,
        },
        "pois": pois,
        "activity": activity,
        "crime": crime,
        "disaster": disaster,
        "signals": signals,
        "evidence": {
            "positives": positives,
            "negatives": negatives,
        },
        "sources": {
            "pois": "overpass",
            "crime": "chicago_open_data" if dist_chi <= 60000 else "simulated",
            "disaster": disaster.get("source", "simulated"),
        },
    }

    return bundle

