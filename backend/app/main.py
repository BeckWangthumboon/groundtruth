from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .census_service import (
    CENSUS_GEOCODER_COORDINATES_URL,
    CENSUS_REPORTER_BASE_URL,
    ApiConfig,
    NoGeographyFoundError,
    UpstreamAPIError,
    _extract_first_geography,
    request_json,
)
from .census_profile_service import (
    NoTractFoundError,
    lookup_census_profile_by_point,
)

# Make scripts_sumedh importable from the project root
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from scripts_sumedh.overpass_pois import get_overpass_pois  # noqa: E402

app = FastAPI(title="Groundtruth Census API", version="0.1.0")

raw_origins = os.getenv("CORS_ORIGINS", "*")
allow_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
if not allow_origins:
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/census/by-point")
def census_by_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    acs: str = Query("latest"),
    include_parents: bool = Query(True),
) -> dict:
    try:
        with httpx.Client(follow_redirects=True) as client:
            return lookup_census_profile_by_point(
                client,
                lat=lat,
                lon=lon,
                acs=acs,
                include_parents=include_parents,
            )
    except NoTractFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UpstreamAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/pois/nearby")
async def pois_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: int = Query(800, ge=100, le=5000),
) -> dict:
    """Fetch OpenStreetMap POIs around a location via Overpass API.

    Returns categorised POI counts, a downsampled point list (capped at 150),
    and request metadata.  Results are cached in-memory for 1 hour.
    """
    try:
        return await get_overpass_pois(lat, lon, radius_m)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Overpass error: {exc}") from exc


@app.get("/api/census/tract-geo")
def census_tract_geo(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict:
    """Return the Census tract boundary as GeoJSON for the given coordinates.

    Resolves lat/lon → tract GEOID via Census Geocoder, then fetches the
    TIGER 2022 boundary polygon from Census Reporter.
    """
    config = ApiConfig(acs="latest")

    try:
        with httpx.Client(follow_redirects=True) as client:
            geocoder_payload = request_json(
                client,
                CENSUS_GEOCODER_COORDINATES_URL,
                params={
                    "x": lon,
                    "y": lat,
                    "benchmark": "Public_AR_Current",
                    "vintage": "Current_Current",
                    "layers": "Census Tracts",
                    "format": "json",
                },
                stage="geocoder",
                config=config,
            )

            tract = _extract_first_geography(geocoder_payload, "Census Tracts")
            if not tract:
                raise NoGeographyFoundError(
                    "No Census tract found for the provided coordinates."
                )

            raw_geoid = tract.get("GEOID", "")
            if len(raw_geoid) != 11 or not raw_geoid.isdigit():
                raise NoGeographyFoundError(
                    f"Unexpected tract GEOID format: {raw_geoid!r}"
                )

            reporter_geoid = f"14000US{raw_geoid}"
            geo_url = f"{CENSUS_REPORTER_BASE_URL}/1.0/geo/tiger2022/{reporter_geoid}"
            geojson = request_json(
                client,
                geo_url,
                params={"geom": "true"},
                stage="tract_geo",
                config=config,
            )
            return geojson

    except NoGeographyFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UpstreamAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
