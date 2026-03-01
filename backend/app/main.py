from __future__ import annotations

import os

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .census_service import NoGeographyFoundError, UpstreamAPIError, lookup_smallest_census_by_point

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
) -> dict:
    try:
        with httpx.Client(follow_redirects=True) as client:
            return lookup_smallest_census_by_point(client, lat=lat, lon=lon, acs=acs)
    except NoGeographyFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UpstreamAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
