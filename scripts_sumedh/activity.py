"""Activity index and simulated flow paths (Phase 2)."""

from __future__ import annotations

import math
import random
import hashlib
from typing import Dict, List

# Caps used for normalization
_AMENITY_CAP = 120
_TRANSIT_CAP = 30
_PARKS_CAP = 10
_PARKING_CAP = 20

def _stable_seed(*parts) -> int:
    s = "|".join(map(str, parts)).encode()
    return int(hashlib.md5(s).hexdigest()[:8], 16)


def _norm(x: float, cap: float) -> float:
    return min(1.0, x / cap) if cap > 0 else 0.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _derive_radius(lat: float, lng: float, points: List[dict]) -> float:
    """Estimate radius from farthest point; fallback to 1000m."""
    if not points:
        return 1000.0
    max_dist = 0.0
    for p in points:
        max_dist = max(max_dist, _haversine_m(lat, lng, p.get("lat", lat), p.get("lng", lng)))
    return max(400.0, max_dist * 1.1)


def _pick_destinations(points: List[dict], mode: str, rng: random.Random, max_pool: int = 60) -> List[dict]:
    """Return a biased, shuffled pool of candidate destinations (size-limited)."""
    if not points:
        return []
    boosted: List[dict] = []
    for p in points:
        t = p.get("type")
        weight_val = p.get("weight", 1.0)
        weight_factor = max(1, int(round(weight_val * 2)))  # leverage POI weight softly
        base = 1
        if mode == "business" and t in {"food", "retail", "transit"}:
            base = 3
        elif mode == "resident" and t in {"grocery", "healthcare", "parks", "transit"}:
            base = 3
        boosted.extend([p] * max(1, base * weight_factor))

    rng.shuffle(boosted)
    return boosted[:max_pool] if len(boosted) > max_pool else boosted


def compute_activity(counts: Dict[str, int], points: List[dict], lat: float, lng: float, mode: str) -> dict:
    """
    Compute activity index (0-100) and generate simulated pedestrian flow paths.

    Args:
        counts: categorized POI counts.
        points: POI point list.
        lat, lng: center location.
        mode: "business" or "resident".
    """
    mode = (mode or "").lower()

    food = counts.get("food", 0)
    retail = counts.get("retail", 0)
    grocery = counts.get("grocery", 0)
    healthcare = counts.get("healthcare", 0)
    nightlife = counts.get("nightlife", 0)
    transit = counts.get("transit", 0)
    parks = counts.get("parks", 0)
    parking = counts.get("parking", 0)

    amenity_density = food + retail + grocery + healthcare + nightlife

    activity_score = (
        0.50 * _norm(amenity_density, _AMENITY_CAP)
        + 0.30 * _norm(transit, _TRANSIT_CAP)
        + 0.15 * _norm(parks, _PARKS_CAP)
        + 0.05 * _norm(parking, _PARKING_CAP)
    )
    activity_index = max(0, min(100, round(100 * activity_score)))

    if activity_index < 35:
        level = "Low"
    elif activity_index <= 70:
        level = "Med"
    else:
        level = "High"

    # Flow simulation
    seed = _stable_seed(round(lat, 4), round(lng, 4), activity_index, mode)
    rng = random.Random(seed)

    radius_m = _derive_radius(lat, lng, points)
    path_count = rng.randint(30, 80)

    destinations = _pick_destinations(points or [{"lat": lat, "lng": lng, "type": "transit"}], mode, rng)
    if not destinations:
        destinations = [{"lat": lat, "lng": lng, "type": "transit"}]

    paths = []
    for _ in range(path_count):
        ang = rng.random() * 2 * math.pi
        r = rng.uniform(0.4 * radius_m, radius_m)
        dlat = (r / 111320) * math.cos(ang)
        cos_lat = max(0.2, abs(math.cos(math.radians(lat))))
        dlng = (r / (111320 * cos_lat)) * math.sin(ang)
        start_lat = lat + dlat
        start_lng = lng + dlng
        dest = rng.choice(destinations)
        to_lat = float(dest.get("lat", lat))
        to_lng = float(dest.get("lng", lng))
        base_intensity = 0.3 + 0.7 * (activity_index / 100)
        intensity = min(1.0, max(0.2, base_intensity + rng.uniform(-0.1, 0.1)))
        paths.append(
            {
                "from": [start_lat, start_lng],
                "to": [to_lat, to_lng],
                "intensity": round(intensity, 3),
            }
        )

    return {
        "activityIndex": activity_index,
        "activityLevel": level,
        "activityFlow": {
            "type": "simulated",
            "paths": paths,
        },
    }
