"""Tests for the /api/pois/nearby endpoint.

Uses FastAPI TestClient and monkeypatches the Overpass fetcher so no real
network calls are made.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Minimal Overpass mock response
# ---------------------------------------------------------------------------

_MOCK_OVERPASS_RESPONSE = {
    "counts": {
        "food": 3,
        "retail": 2,
        "grocery": 1,
        "healthcare": 0,
        "parking": 1,
        "transit": 2,
        "nightlife": 1,
        "parks": 1,
    },
    "points": [
        {"type": "food", "lat": 43.074, "lng": -89.384, "weight": 0.6, "name": "Cafe A"},
        {"type": "transit", "lat": 43.075, "lng": -89.385, "weight": 0.9},
    ],
    "meta": {
        "radius_m": 800,
        "total_elements": 11,
        "returned_points": 2,
        "cached": False,
        "ts": 1700000000,
    },
}


@pytest.fixture()
def client(monkeypatch):
    """Return a TestClient with the Overpass fetcher mocked out."""
    import scripts_sumedh.overpass_pois as overpass_module

    async def _mock_get_overpass_pois(lat, lng, radius_m):
        return _MOCK_OVERPASS_RESPONSE

    monkeypatch.setattr(overpass_module, "get_overpass_pois", _mock_get_overpass_pois)

    # Re-import main AFTER monkeypatch so the patched symbol is used
    import importlib
    import backend.app.main as main_module

    importlib.reload(main_module)

    return TestClient(main_module.app)


def test_pois_nearby_returns_200(client):
    resp = client.get("/api/pois/nearby", params={"lat": 43.074, "lon": -89.384})
    assert resp.status_code == 200


def test_pois_nearby_response_shape(client):
    resp = client.get("/api/pois/nearby", params={"lat": 43.074, "lon": -89.384})
    data = resp.json()
    assert "counts" in data
    assert "points" in data
    assert "meta" in data


def test_pois_nearby_counts_contain_expected_categories(client):
    resp = client.get("/api/pois/nearby", params={"lat": 43.074, "lon": -89.384})
    counts = resp.json()["counts"]
    for cat in ("food", "retail", "grocery", "healthcare", "parking", "transit", "nightlife", "parks"):
        assert cat in counts


def test_pois_nearby_default_radius(client):
    resp = client.get("/api/pois/nearby", params={"lat": 43.074, "lon": -89.384})
    assert resp.status_code == 200


def test_pois_nearby_custom_radius(client):
    resp = client.get(
        "/api/pois/nearby", params={"lat": 43.074, "lon": -89.384, "radius_m": 500}
    )
    assert resp.status_code == 200


def test_pois_nearby_rejects_out_of_range_lat(client):
    resp = client.get("/api/pois/nearby", params={"lat": 999, "lon": -89.384})
    assert resp.status_code == 422


def test_pois_nearby_rejects_missing_params(client):
    resp = client.get("/api/pois/nearby")
    assert resp.status_code == 422


def test_pois_nearby_points_have_required_fields(client):
    resp = client.get("/api/pois/nearby", params={"lat": 43.074, "lon": -89.384})
    points = resp.json()["points"]
    assert len(points) > 0
    for pt in points:
        assert "type" in pt
        assert "lat" in pt
        assert "lng" in pt
        assert "weight" in pt
