"""Tests for the /api/census/tract-geo endpoint.

Monkeypatches Census Geocoder and Census Reporter calls to avoid network I/O.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Mock payloads
# ---------------------------------------------------------------------------

_GEOCODER_PAYLOAD = {
    "result": {
        "geographies": {
            "Census Tracts": [
                {
                    "GEOID": "55025001704",
                    "NAME": "Census Tract 17.04",
                    "STATE": "55",
                    "COUNTY": "025",
                    "TRACT": "001704",
                }
            ]
        }
    }
}

_TIGER_GEOJSON = {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [
                [-89.40, 43.07],
                [-89.38, 43.07],
                [-89.38, 43.08],
                [-89.40, 43.08],
                [-89.40, 43.07],
            ]
        ],
    },
    "properties": {
        "geoid": "14000US55025001704",
        "display_name": "Census Tract 17.04, Dane County, WI",
    },
}


@pytest.fixture()
def client(monkeypatch):
    """Return a TestClient with Geocoder + Census Reporter mocked."""
    import backend.app.census_service as cs

    _call_count = {"n": 0}

    def _mock_request_json(http_client, url, *, params, stage, config):
        _call_count["n"] += 1
        if "geocoding.geo.census.gov" in url:
            return _GEOCODER_PAYLOAD
        if "tiger2022" in url:
            return _TIGER_GEOJSON
        raise AssertionError(f"Unexpected URL in mock: {url}")

    monkeypatch.setattr(cs, "request_json", _mock_request_json)

    import importlib
    import backend.app.main as main_module

    importlib.reload(main_module)

    return TestClient(main_module.app)


def test_tract_geo_returns_200(client):
    resp = client.get("/api/census/tract-geo", params={"lat": 43.074, "lon": -89.384})
    assert resp.status_code == 200


def test_tract_geo_returns_geojson_feature(client):
    resp = client.get("/api/census/tract-geo", params={"lat": 43.074, "lon": -89.384})
    data = resp.json()
    assert data["type"] == "Feature"
    assert "geometry" in data
    assert "properties" in data


def test_tract_geo_geometry_is_polygon(client):
    resp = client.get("/api/census/tract-geo", params={"lat": 43.074, "lon": -89.384})
    geometry = resp.json()["geometry"]
    assert geometry["type"] == "Polygon"


def test_tract_geo_rejects_missing_params(client):
    resp = client.get("/api/census/tract-geo")
    assert resp.status_code == 422


def test_tract_geo_rejects_invalid_lat(client):
    resp = client.get("/api/census/tract-geo", params={"lat": 200, "lon": -89.384})
    assert resp.status_code == 422


def test_tract_geo_404_when_no_tract(monkeypatch):
    """Returns 404 when the geocoder finds no Census Tract."""
    import backend.app.census_service as cs

    def _mock_no_tract(http_client, url, *, params, stage, config):
        if "geocoding.geo.census.gov" in url:
            return {"result": {"geographies": {"Census Tracts": []}}}
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(cs, "request_json", _mock_no_tract)

    import importlib
    import backend.app.main as main_module

    importlib.reload(main_module)

    c = TestClient(main_module.app)
    resp = c.get("/api/census/tract-geo", params={"lat": 0.0, "lon": 0.0})
    assert resp.status_code == 404
