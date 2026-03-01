"""Tests for POST /api/pois/report-card."""

from __future__ import annotations

from fastapi.testclient import TestClient

REQUEST_PAYLOAD = {
    "location_label": "Madison, WI",
    "isochrone_profile": "driving",
    "total_places": 368,
    "groups": [
        {"key": "transit", "label": "Transit", "count": 120},
        {"key": "shopping", "label": "Shopping", "count": 88},
        {"key": "restaurant", "label": "Restaurant", "count": 64},
        {"key": "recreation", "label": "Recreation", "count": 40},
    ],
    "reachability": {"5": 52, "10": 199, "15": 308},
}

MOCK_REPORT = {
    "model": "gemini-3-flash-preview",
    "generated_at": "2026-03-01T15:20:00+00:00",
    "overall": {"score": 8, "reason": "Balanced mix of amenities with strong transit and shopping."},
    "dimensions": {
        "food_availability": {"score": 7, "reason": "Restaurant categories are broadly represented."},
        "nightlife": {"score": 6, "reason": "Moderate nightlife signal relative to other categories."},
        "stores": {"score": 8, "reason": "Shopping density is high in the POI mix."},
        "walkability": {"score": 7, "reason": "Short-reach counts indicate nearby place concentration."},
        "public_services": {"score": 6, "reason": "Service-oriented categories are present but not dominant."},
        "transit_access": {"score": 9, "reason": "Transit is one of the highest-count categories."},
        "recreation": {"score": 7, "reason": "Recreation is materially represented."},
        "healthcare_access": {"score": 5, "reason": "Healthcare appears, but less strongly than transit/shopping."},
    },
    "poi_categories": [
        {
            "category": "Transit",
            "count": 120,
            "share_pct": 32.6,
            "reason": "Transit dominates the nearby category profile.",
        },
        {
            "category": "Shopping",
            "count": 88,
            "share_pct": 23.9,
            "reason": "Shopping has substantial representation in local POIs.",
        },
    ],
}


def _build_client_with_generator(mock_generator) -> TestClient:
    import backend.app.main as main_module

    setattr(main_module, "generate_poi_report_card", mock_generator)
    return TestClient(main_module.app)


def test_poi_report_card_returns_200_and_expected_shape():
    async def _mock_generate(_payload):
        return MOCK_REPORT

    client = _build_client_with_generator(_mock_generate)
    resp = client.post("/api/pois/report-card", json=REQUEST_PAYLOAD)
    assert resp.status_code == 200

    data = resp.json()
    assert data["model"] == "gemini-3-flash-preview"
    assert data["overall"]["score"] == 8
    assert "generated_at" in data

    expected_dimensions = {
        "food_availability",
        "nightlife",
        "stores",
        "walkability",
        "public_services",
        "transit_access",
        "recreation",
        "healthcare_access",
    }
    assert set(data["dimensions"].keys()) == expected_dimensions
    for dim in expected_dimensions:
        score = data["dimensions"][dim]["score"]
        assert isinstance(score, int)
        assert 1 <= score <= 10
        assert data["dimensions"][dim]["reason"]


def test_poi_report_card_rejects_invalid_payload():
    async def _mock_generate(_payload):
        return MOCK_REPORT

    client = _build_client_with_generator(_mock_generate)
    invalid_payload = dict(REQUEST_PAYLOAD)
    invalid_payload["groups"] = []

    resp = client.post("/api/pois/report-card", json=invalid_payload)
    assert resp.status_code == 422


def test_poi_report_card_returns_503_when_gemini_key_missing():
    import backend.app.main as main_module

    async def _raise_missing_key(_payload):
        raise main_module.MissingAPIKeyError("GEMINI_API_KEY is not configured on the backend.")

    client = _build_client_with_generator(_raise_missing_key)
    resp = client.post("/api/pois/report-card", json=REQUEST_PAYLOAD)
    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_poi_report_card_returns_502_on_provider_error():
    import backend.app.main as main_module

    async def _raise_provider_error(_payload):
        raise main_module.ReportCardProviderError("Gemini request failed")

    client = _build_client_with_generator(_raise_provider_error)
    resp = client.post("/api/pois/report-card", json=REQUEST_PAYLOAD)
    assert resp.status_code == 502
    assert "Gemini request failed" in resp.json()["detail"]
