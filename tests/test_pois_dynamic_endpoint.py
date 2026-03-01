"""Tests for the /api/pois/dynamic endpoint."""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


_MOCK_DYNAMIC_RESPONSE = {
    "countsByLabel": {
        "essentials_nearby": 12,
        "transit_access": 42,
    },
    "points": [
        {
            "type": "transit_access",
            "categories": ["transit_access"],
            "lat": 43.074,
            "lng": -89.384,
            "weight": 0.9,
            "name": "State & Johnson",
        }
    ],
    "meta": {
        "radius_m": 1200,
        "requestedLabels": ["essentials_nearby", "transit_access"],
        "business_type": None,
        "total_elements": 100,
        "returned_points": 1,
        "cached": False,
        "ts": 1700000000,
    },
}


@pytest.fixture()
def client(monkeypatch):
    import scripts_sumedh.pois_dynamic as dynamic_module

    async def _mock_get_pois_by_preferences(
        lat,
        lng,
        radius_m,
        selected_labels,
        *,
        business_type=None,
        include_nodes=True,
    ):
        payload = dict(_MOCK_DYNAMIC_RESPONSE)
        payload["meta"] = dict(_MOCK_DYNAMIC_RESPONSE["meta"])
        payload["meta"]["radius_m"] = radius_m
        payload["meta"]["requestedLabels"] = selected_labels
        payload["meta"]["business_type"] = business_type
        if not include_nodes:
            payload["points"] = None
            payload["meta"]["returned_points"] = 0
        return payload

    monkeypatch.setattr(
        dynamic_module,
        "get_pois_by_preferences",
        _mock_get_pois_by_preferences,
    )

    import backend.app.main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_pois_dynamic_returns_200(client):
    resp = client.get(
        "/api/pois/dynamic",
        params={
            "lat": 43.074,
            "lon": -89.384,
            "selected_labels": "essentials_nearby,transit_access",
        },
    )
    assert resp.status_code == 200


def test_pois_dynamic_response_shape(client):
    resp = client.get(
        "/api/pois/dynamic",
        params={
            "lat": 43.074,
            "lon": -89.384,
            "selected_labels": "essentials_nearby,transit_access",
        },
    )
    data = resp.json()
    assert "countsByLabel" in data
    assert "points" in data
    assert "meta" in data


def test_pois_dynamic_include_nodes_false(client):
    resp = client.get(
        "/api/pois/dynamic",
        params={
            "lat": 43.074,
            "lon": -89.384,
            "selected_labels": "essentials_nearby,transit_access",
            "include_nodes": "false",
        },
    )
    data = resp.json()
    assert resp.status_code == 200
    assert data["points"] is None


def test_pois_dynamic_unknown_label_rejected(client):
    resp = client.get(
        "/api/pois/dynamic",
        params={
            "lat": 43.074,
            "lon": -89.384,
            "selected_labels": "essentials_nearby,not_a_real_label",
        },
    )
    assert resp.status_code == 422
    assert "Unknown selected_labels" in resp.json()["detail"]


def test_pois_dynamic_direct_competition_requires_business_type(client):
    resp = client.get(
        "/api/pois/dynamic",
        params={
            "lat": 43.074,
            "lon": -89.384,
            "selected_labels": "direct_competition",
        },
    )
    assert resp.status_code == 422
    assert "business_type is required" in resp.json()["detail"]


def test_pois_dynamic_rejects_missing_params(client):
    resp = client.get("/api/pois/dynamic")
    assert resp.status_code == 422
