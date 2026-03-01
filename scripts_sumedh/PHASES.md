# GroundTruth Backend Phases (1–5)

This file is a quick orientation for anyone new to the Phase 1–5 backend utilities. No extra setup files are provided; just use these modules directly.

## What’s implemented

- **Phase 1 — overpass_pois.py**
  - `get_overpass_pois(lat, lng, radius_m) -> dict`
  - Fetches OSM POIs via Overpass in a single query with endpoint failover.
  - Categories: food, nightlife, healthcare, grocery, retail, parking, transit, parks.
  - Returns category counts, a weighted/deterministically downsampled point list (capped per category and globally), and meta info.
  - In-memory cache TTL = 1 hour keyed by rounded coords and radius.

- **Phase 2 — activity.py**
  - `compute_activity(counts, points, lat, lng, mode) -> dict`
  - Computes an activity index (0–100) from POI counts with caps.
  - Simulates 30–80 pedestrian flow paths, biased by mode (`business` or `resident`) and POI types/weights; deterministic seeding.
  - Uses POI spread to estimate a radius for path start points.

- **Phase 3 — chicago_crime.py**
  - `fetch_chicago_crimes(lat, lng, radius_m, days_back=90, limit=1200) -> list`
    - Tries Socrata `within_circle(location, ...)`; falls back to client-side haversine filtering if needed.
    - 30-minute TTL cache keyed by rounded coords, radius, days_back.
  - `aggregate_crime_hotspots(rows, max_hotspots=80) -> dict`
    - Groups by block (fallback to rounded lat/lng), summarizes counts, top crime types, weights.
  - `get_chicago_crime_bundle(...) -> dict`
    - Adds crime density proxy and meta.

- **Phase 4 — disaster.py**
  - `compute_disaster_risk(lat, lng, seed_key=None) -> dict`
  - Deterministic simulated risks for flood, heat, storm; overallRisk = max of hazards.

- **Phase 5 — analyze_bundle.py**
  - `analyze_location_bundle(lat, lng, mode) -> dict` (async)
  - Orchestrates POIs, activity, crime (Chicago-only), and disaster into one bundle with raw/normalized metrics, combined signals, and evidence summaries.

## How to run quick checks

### Overpass sanity / POI listing
```bash
python3 scripts_sumedh/test_overpass.py
```
Current test targets Hub Madison (Madison, WI) with a 1200 m radius and prints all nightlife POIs returned by Overpass. It also prints meta and counts. Requires internet access and `httpx` installed.

### Programmatic usage examples (Python REPL)
```python
from scripts_sumedh.overpass_pois import get_overpass_pois
from scripts_sumedh.activity import compute_activity
import asyncio

async def demo():
    pois = await get_overpass_pois(41.8781, -87.6298, 1800)
    activity = compute_activity(pois["counts"], pois["points"], 41.8781, -87.6298, "business")
    print(activity)

asyncio.run(demo())
```

```python
from scripts_sumedh.chicago_crime import get_chicago_crime_bundle
import asyncio
asyncio.run(get_chicago_crime_bundle(41.8781, -87.6298, 1800))

# Full bundle (Phase 5)
from scripts_sumedh.analyze_bundle import analyze_location_bundle
asyncio.run(analyze_location_bundle(41.8781, -87.6298, "business"))
```

## Notes and assumptions
- No FastAPI wiring is included yet—modules are importable standalone.
- Network calls are live; rate limits/errors fall back where possible but will still surface exceptions if all endpoints fail.
- Caches are in-memory only; restart clears them.
- Dependencies: `httpx` (install via `python3 -m pip install httpx`).

## Notes and assumptions
- No FastAPI wiring is included yet—modules are importable standalone.
- Network calls are live; rate limits/errors fall back where possible but will still surface exceptions if all endpoints fail.
- Caches are in-memory only; restart clears them.
- Dependencies: `httpx` (install via `python3 -m pip install httpx`).
