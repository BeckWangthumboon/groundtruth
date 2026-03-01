# pois_dynamic.py – quick guide

## What it does
`get_pois_by_preferences` fetches nearby points of interest from OpenStreetMap (Overpass API) for a given latitude/longitude and radius. It maps POIs into high-level labels (tenant + business use‑cases), counts them, and (optionally) returns a capped list of representative points per label for visualization. Results are cached in‑memory for an hour and hard‑capped at 150 points to stay UI‑safe.

## Call signature
```python
await get_pois_by_preferences(
    lat: float,
    lng: float,
    radius_m: int,
    selected_labels: list[str],
    business_type: str | None = None,
    include_nodes: bool = True,
) -> dict
```

## Inputs to pass
- `lat`, `lng` – center coordinate.
- `radius_m` – search radius (meters). Clamped to 200–2000; default for most callers is 1200.
- `selected_labels` – up to 10 label keys (see below). Deduped and order‑preserved.
- `business_type` – required only when using `direct_competition` (e.g., `"cafe"`, `"salon"`, `"gym"`, `"grocery"`, `"bar"`, `"restaurant"`, etc.).
- `include_nodes` – `True` to return representative points; `False` to get counts only.

## Labels (tenant + business)
- Tenant/resident: `essentials_nearby`, `healthcare_access`, `transit_access`, `parking_availability`, `green_space`, `nightlife_density`, `noise_nightlife_density`, `family_friendly`, `fitness_recreation`, `personal_care`, `foot_traffic_proxy`.
- Business: `food_corridor_density`, `retail_density`, `anchors_nearby`, `direct_competition` (needs `business_type`), `professional_services`, `finance_services`, `auto_services`, `lodging_tourism`, `education_anchors`, `entertainment_events`.
- Aliases: `parking_access` mirrors `parking_availability`; `noise_nightlife_density` mirrors `nightlife_density`.

Each label is translated into a set of OSM tag filters (see `POI_LABELS` in the file). Per‑label caps are in `DEFAULT_LABEL_CAPS`; priority ordering for point typing is in `PRIMARY_PRIORITY`.

## Return shape
```python
{
  "countsByLabel": {label: int, ...},
  "points": [  # omitted if include_nodes=False
    {
      "type": primary_label,
      "categories": [matched_labels...],
      "lat": float,
      "lng": float,
      "weight": float,
      "name": optional str
    },
    ...
  ],
  "meta": {
    "radius_m": int,
    "requestedLabels": list[str],
    "business_type": str | None,
    "total_elements": int,        # raw Overpass elements scanned
    "returned_points": int,       # after caps/downsampling (<=150)
    "cached": bool,
    "ts": epoch_seconds
  }
}
```

## Behaviors & safeguards
- Radius clamped to 200–2000m; total points capped at 150.
- Label count caps per category to balance map color density.
- Deterministic downsampling seeded by location/radius/labels for stable UI.
- In‑memory cache (1h) keyed by rounded lat/lng, radius, labels, business_type, include_nodes.
- If no filters are derived (e.g., empty labels), returns empty counts and points.

## Typical usage
```python
data = await get_pois_by_preferences(
    lat=43.07437,
    lng=-89.39510,
    radius_m=1200,
    selected_labels=[
        "essentials_nearby",
        "healthcare_access",
        "transit_access",
        "foot_traffic_proxy",
    ],
    business_type=None,
)

print(data["countsByLabel"])
for p in data["points"][:5]:
    print(p["type"], p["name"], (p["lat"], p["lng"]))
```

## Testing helper
Run the bundled sanity script (uses a fallback fixture if Overpass is unreachable):
```
python3 scripts_sumedh/test_pois_dynamic_hub_madison.py
```
