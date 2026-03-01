# pois_dynamic.py
from __future__ import annotations

import hashlib
import random
import time
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

import httpx

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]

# Hard caps (demo-safe)
MAX_RADIUS_M = 2000
MAX_SELECTED_LABELS = 10
MAX_TOTAL_POINTS = 150

# Cache: key -> (ts, data)
_CACHE: Dict[Tuple[float, float, int, str], Tuple[int, dict]] = {}
_CACHE_TTL = 3600  # 1 hour


def _now_ts() -> int:
    return int(time.time())


def _stable_seed(*parts) -> int:
    s = "|".join(map(str, parts)).encode()
    return int(hashlib.md5(s).hexdigest()[:8], 16)


def _clamp_radius(radius_m: int) -> int:
    return max(200, min(int(radius_m), MAX_RADIUS_M))


# -------------------------------------------------------------------
# Label catalog (UI/agent labels -> Overpass filters)
# Each filter = (osm_key, value_or_regex, match_type)
# match_type: "eq" or "re" (regex uses ^(a|b|c)$)
# -------------------------------------------------------------------

POI_LABELS: Dict[str, List[Tuple[str, str, str]]] = {
    # ---------------- Tenant / Resident ----------------
    "essentials_nearby": [
        ("shop", "supermarket|convenience", "re"),
        ("amenity", "pharmacy", "eq"),
        ("shop", "pharmacy", "eq"),
    ],
    "healthcare_access": [
        ("amenity", "clinic|hospital|doctors|dentist", "re"),
    ],
    "transit_access": [
        ("highway", "bus_stop", "eq"),
        ("public_transport", "platform", "eq"),
        ("railway", "station", "eq"),
    ],
    "parking_availability": [
        ("amenity", "parking", "eq"),
        ("amenity", "parking_entrance", "eq"),
    ],
    "green_space": [
        ("leisure", "park", "eq"),
    ],
    "nightlife_density": [
        ("amenity", "bar|pub|nightclub", "re"),
    ],
    "family_friendly": [
        ("amenity", "school|kindergarten", "re"),
        ("leisure", "playground", "eq"),
    ],
    "fitness_recreation": [
        ("leisure", "fitness_centre|sports_centre|swimming_pool", "re"),
    ],
    "personal_care": [
        ("shop", "hairdresser|barber|beauty|massage|tattoo|nail_salon", "re"),
    ],
    # Activity / proxy for busier corridors (tenant + business)
    "foot_traffic_proxy": [
        ("amenity", "cafe|restaurant|fast_food", "re"),
        ("shop", "clothes|shoes|electronics|department_store|hardware|books|bakery", "re"),
        ("public_transport", "platform", "eq"),
        ("highway", "bus_stop", "eq"),
        ("railway", "station", "eq"),
    ],

    # ---------------- Business ----------------
    "food_corridor_density": [
        ("amenity", "cafe|restaurant|fast_food", "re"),
    ],
    "retail_density": [
        ("shop", "clothes|shoes|electronics|department_store|hardware|books|bakery", "re"),
    ],
    "anchors_nearby": [
        ("amenity", "university|hospital", "re"),
        ("tourism", "attraction|museum|zoo", "re"),
        ("tourism", "hotel", "eq"),
        ("leisure", "stadium", "eq"),
    ],

    # Extra business-friendly (optional but useful)
    "professional_services": [
        ("office", "accountant|lawyer|estate_agent|insurance|consulting|it", "re"),
    ],
    "finance_services": [
        ("amenity", "bank|atm", "re"),
    ],
    "auto_services": [
        ("amenity", "fuel|car_wash", "re"),
        ("shop", "car_repair", "eq"),
    ],
    "lodging_tourism": [
        ("tourism", "hotel|museum|attraction", "re"),
    ],
    "education_anchors": [
        ("amenity", "university|college|school", "re"),
    ],
    "entertainment_events": [
        ("amenity", "cinema|theatre", "re"),
        ("leisure", "stadium", "eq"),
    ],

    # Aliases for UX wording (reuse existing filters)
    "noise_nightlife_density": [
        ("amenity", "bar|pub|nightclub", "re"),
    ],
    "parking_access": [
        ("amenity", "parking", "eq"),
        ("amenity", "parking_entrance", "eq"),
    ],
}

# Direct competition depends on business_type (TOP 5 supported + a few extras)
BUSINESS_TYPE_TO_COMPETITION: Dict[str, List[Tuple[str, str, str]]] = {
    # TOP 5 businesses
    "cafe": [("amenity", "cafe", "eq")],
    "salon": [("shop", "hairdresser|barber|beauty|nail_salon", "re")],
    "gym": [("leisure", "fitness_centre|sports_centre", "re")],
    "grocery": [("shop", "supermarket|convenience", "re")],
    "bar": [("amenity", "bar|pub|nightclub", "re")],

    # Extras (optional)
    "restaurant": [("amenity", "restaurant|fast_food", "re")],
    "pharmacy": [("amenity", "pharmacy", "eq"), ("shop", "pharmacy", "eq")],
    "tattoo": [("shop", "tattoo", "eq")],
    "massage": [("shop", "massage", "eq"), ("amenity", "spa", "eq")],
}

# Per-label caps (visual)
DEFAULT_LABEL_CAPS: Dict[str, int] = {
    # tenant
    "essentials_nearby": 30,
    "healthcare_access": 20,
    "transit_access": 25,
    "parking_availability": 25,
    "green_space": 20,
    "nightlife_density": 20,
    "noise_nightlife_density": 20,
    "family_friendly": 20,
    "fitness_recreation": 20,
    "personal_care": 25,
    "foot_traffic_proxy": 40,

    # business
    "food_corridor_density": 40,
    "retail_density": 40,
    "anchors_nearby": 25,
    "direct_competition": 40,

    # extra business
    "professional_services": 25,
    "finance_services": 25,
    "auto_services": 20,
    "lodging_tourism": 25,
    "education_anchors": 25,
    "entertainment_events": 20,
}

# Node weights (visual)
LABEL_WEIGHTS: Dict[str, float] = {
    "transit_access": 0.90,
    "parking_availability": 0.85,
    "healthcare_access": 0.80,
    "essentials_nearby": 0.75,

    "anchors_nearby": 0.78,
    "education_anchors": 0.75,
    "lodging_tourism": 0.72,
    "entertainment_events": 0.72,

    "food_corridor_density": 0.65,
    "retail_density": 0.60,
    "nightlife_density": 0.62,
    "green_space": 0.60,

    "family_friendly": 0.58,
    "fitness_recreation": 0.60,
    "personal_care": 0.60,

    "finance_services": 0.70,
    "professional_services": 0.62,
    "auto_services": 0.68,

    "direct_competition": 0.70,
}

# Priority if a POI matches multiple labels
PRIMARY_PRIORITY = [
    "transit_access",
    "parking_availability",
    "healthcare_access",
    "essentials_nearby",
    "foot_traffic_proxy",

    "anchors_nearby",
    "education_anchors",
    "lodging_tourism",
    "entertainment_events",

    "family_friendly",
    "fitness_recreation",
    "personal_care",

    "food_corridor_density",
    "retail_density",
    "nightlife_density",
    "green_space",

    "finance_services",
    "professional_services",
    "auto_services",

    "direct_competition",
    "noise_nightlife_density",
    "parking_access",
]


def _build_overpass_query(lat: float, lng: float, radius_m: int, filters: List[Tuple[str, str, str]]) -> str:
    lines = ["[out:json][timeout:25];", "("]
    for key, value, match_type in filters:
        if match_type == "eq":
            clause = f'["{key}"="{value}"]'
        else:
            clause = f'["{key}"~"^({value})$"]'
        for osm_type in ("node", "way", "relation"):
            lines.append(f"  {osm_type}{clause}(around:{radius_m},{lat},{lng});")
    lines.extend([");", "out center tags;"])
    return "\n".join(lines)


async def _fetch_overpass(query: str) -> dict:
    timeout = httpx.Timeout(25.0, connect=10.0)
    last_err: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = await client.post(
                    endpoint,
                    data={"data": query},
                    headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                )
                resp.raise_for_status()
                payload = resp.json()
                if not isinstance(payload, dict):
                    raise RuntimeError("Unexpected Overpass response type.")
                return payload
            except Exception as e:
                last_err = e
                continue
    raise RuntimeError(f"Overpass failed on all endpoints: {last_err}")


def _extract_coords(el: dict) -> Optional[Tuple[float, float]]:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center")
    if isinstance(center, dict) and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _matches_filter(tags: Dict[str, Any], key: str, value: str, match_type: str) -> bool:
    v = tags.get(key)
    if not isinstance(v, str):
        return False
    if match_type == "eq":
        return v == value
    allowed = value.split("|")
    return v in allowed


def _labels_for_tags(tags: Dict[str, Any], selected_labels: List[str], business_type: Optional[str]) -> List[str]:
    matched: List[str] = []

    for label in selected_labels:
        if label == "direct_competition":
            continue
        for key, val, mtype in POI_LABELS.get(label, []):
            if _matches_filter(tags, key, val, mtype):
                matched.append(label)
                break

    if "direct_competition" in selected_labels and business_type:
        comp_filters = BUSINESS_TYPE_TO_COMPETITION.get(business_type.lower(), [])
        for key, val, mtype in comp_filters:
            if _matches_filter(tags, key, val, mtype):
                matched.append("direct_competition")
                break

    # Dedup preserve order
    seen = set()
    out = []
    for x in matched:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _pick_primary(labels: List[str]) -> str:
    if not labels:
        return "other"
    for p in PRIMARY_PRIORITY:
        if p in labels:
            return p
    return labels[0]


def _downsample(points_by_label: Dict[str, List[dict]], seed: int, label_caps: Dict[str, int]) -> List[dict]:
    rng = random.Random(seed)
    selected: List[dict] = []

    # deterministic order so sampling stable across runs
    ordered_labels = sorted(points_by_label.keys())
    for idx, label in enumerate(ordered_labels):
        pts = points_by_label[label]
        cap = label_caps.get(label, 20)
        if len(pts) > cap:
            rng_cat = random.Random(seed + idx + 1)
            pts = rng_cat.sample(pts, cap)
        else:
            rng.shuffle(pts)
        selected.extend(pts)

    if len(selected) > MAX_TOTAL_POINTS:
        selected = rng.sample(selected, MAX_TOTAL_POINTS)
    return selected


async def get_pois_by_preferences(
    lat: float,
    lng: float,
    radius_m: int,
    selected_labels: List[str],
    *,
    business_type: Optional[str] = None,
    include_nodes: bool = True,
) -> dict:
    """
    Preference-driven POI fetch.
    Returns countsByLabel + (optional) points (<=150) for visualization.
    """
    radius_m = _clamp_radius(radius_m)

    # clean selection
    selected_labels = [s.strip() for s in selected_labels if isinstance(s, str) and s.strip()]
    selected_labels = list(dict.fromkeys(selected_labels))  # dedup keep order
    if len(selected_labels) > MAX_SELECTED_LABELS:
        selected_labels = selected_labels[:MAX_SELECTED_LABELS]

    # build filters list
    filters: List[Tuple[str, str, str]] = []
    for label in selected_labels:
        if label == "direct_competition":
            continue
        filters.extend(POI_LABELS.get(label, []))

    if "direct_competition" in selected_labels and business_type:
        filters.extend(BUSINESS_TYPE_TO_COMPETITION.get(business_type.lower(), []))

    if not filters:
        return {
            "countsByLabel": {label: 0 for label in selected_labels},
            "points": [] if include_nodes else None,
            "meta": {"radius_m": radius_m, "requestedLabels": selected_labels, "cached": False, "ts": _now_ts()},
        }

    # cache key must include labels + business_type + include_nodes
    cache_sig = "|".join(selected_labels) + f"|bt={business_type or ''}|nodes={include_nodes}"
    key = (round(lat, 3), round(lng, 3), radius_m, cache_sig)
    now = _now_ts()

    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        data = deepcopy(cached[1])
        data["meta"]["cached"] = True
        data["meta"]["ts"] = now
        return data

    query = _build_overpass_query(lat, lng, radius_m, filters)
    payload = await _fetch_overpass(query)
    elements = payload.get("elements", []) if isinstance(payload, dict) else []
    if not isinstance(elements, list):
        elements = []

    counts = {label: 0 for label in selected_labels}
    points_by_label: Dict[str, List[dict]] = {label: [] for label in selected_labels}

    seen = set()  # dedup by (type,id)
    for el in elements:
        et = el.get("type")
        eid = el.get("id")
        if et and eid is not None:
            k = (et, int(eid))
            if k in seen:
                continue
            seen.add(k)

        tags = el.get("tags") or {}
        if not isinstance(tags, dict):
            continue

        matched_labels = _labels_for_tags(tags, selected_labels, business_type)
        if not matched_labels:
            continue

        coords = _extract_coords(el)
        if not coords:
            continue

        # increment counts for all matched labels
        for lab in matched_labels:
            if lab in counts:
                counts[lab] += 1

        if not include_nodes:
            continue

        primary = _pick_primary(matched_labels)
        point = {
            "type": primary,
            "categories": matched_labels,
            "lat": coords[0],
            "lng": coords[1],
            "weight": LABEL_WEIGHTS.get(primary, 0.6),
        }
        name = tags.get("name")
        if isinstance(name, str) and name.strip():
            point["name"] = name.strip()

        points_by_label.setdefault(primary, []).append(point)

    seed = _stable_seed(round(lat, 3), round(lng, 3), radius_m, "|".join(selected_labels), business_type or "")
    label_caps = {k: DEFAULT_LABEL_CAPS.get(k, 20) for k in selected_labels}
    points = _downsample(points_by_label, seed, label_caps) if include_nodes else None

    result = {
        "countsByLabel": counts,
        "points": points if include_nodes else None,
        "meta": {
            "radius_m": radius_m,
            "requestedLabels": selected_labels,
            "business_type": business_type,
            "total_elements": len(elements),
            "returned_points": len(points) if include_nodes and points else 0,
            "cached": False,
            "ts": now,
        },
    }

    _CACHE[key] = (now, deepcopy(result))
    return result
