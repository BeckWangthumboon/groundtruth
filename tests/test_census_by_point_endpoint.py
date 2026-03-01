"""Tests for /api/census/by-point using the shared census profile service."""
from __future__ import annotations

import importlib

from fastapi.testclient import TestClient


TRACT_GEOID = "14000US55025001704"
PLACE_GEOID = "16000US5548000"
COUNTY_GEOID = "05000US55025"
STATE_GEOID = "04000US55"
NATION_GEOID = "01000US"


def _geocoder_payload() -> dict:
    return {
        "result": {
            "geographies": {
                "Census Tracts": [
                    {
                        "GEOID": "55025001704",
                        "NAME": "Census Tract 17.04",
                        "AREALAND": "518210",
                        "STATE": "55",
                        "COUNTY": "025",
                    }
                ],
                "Counties": [{"GEOID": "55025", "NAME": "Dane County"}],
                "2020 Census ZIP Code Tabulation Areas": [{"GEOID": "53711", "NAME": "ZCTA5 53711"}],
            }
        }
    }


def _parents_payload() -> dict:
    return {
        "parents": [
            {"sumlevel": "140", "geoid": TRACT_GEOID, "relation": "this", "display_name": "Census Tract 17.04"},
            {"sumlevel": "160", "geoid": PLACE_GEOID, "relation": "place", "display_name": "Madison city, WI"},
            {"sumlevel": "050", "geoid": COUNTY_GEOID, "relation": "county", "display_name": "Dane County, WI"},
            {"sumlevel": "040", "geoid": STATE_GEOID, "relation": "state", "display_name": "Wisconsin"},
            {"sumlevel": "010", "geoid": NATION_GEOID, "relation": "nation", "display_name": "United States"},
        ]
    }


def _tables_payload(geoids: list[str]) -> dict:
    tables = {
        "B01003": {"simple_table_title": "Total Population", "universe": "Total population"},
        "B01002": {"simple_table_title": "Median age", "universe": "Total population"},
        "B19013": {"simple_table_title": "Median Household Income", "universe": "Households"},
        "B19301": {"simple_table_title": "Per capita income", "universe": "Total population"},
        "B17001": {"simple_table_title": "Poverty status", "universe": "Population for whom poverty status is determined"},
        "B25064": {"simple_table_title": "Median gross rent", "universe": "Renter occupied housing units"},
        "B25077": {"simple_table_title": "Median home value", "universe": "Owner-occupied housing units"},
        "B08301": {"simple_table_title": "Means of transportation", "universe": "Workers 16 years and over"},
        "B08303": {"simple_table_title": "Travel time", "universe": "Workers 16 years and over"},
        "B11001": {"simple_table_title": "Households", "universe": "Households"},
        "B25010": {"simple_table_title": "Average household size", "universe": "Occupied housing units"},
        "B15003": {"simple_table_title": "Educational attainment", "universe": "Population 25 years and over"},
        "B05002": {"simple_table_title": "Nativity", "universe": "Total population"},
        "B07003": {"simple_table_title": "Geographical mobility", "universe": "Population 1 year and over"},
        "B21001": {"simple_table_title": "Veteran status", "universe": "Civilian population 18 years and over"},
    }

    data = {}
    for idx, geoid in enumerate(geoids):
        pop = 9000 + idx * 1000
        poverty_total = pop
        poverty_below = int(pop * 0.15)
        data[geoid] = {
            "B01003": {"estimate": {"B01003001": pop}, "error": {"B01003001": 120}},
            "B01002": {"estimate": {"B01002001": 32.5 + idx}, "error": {"B01002001": 0.8}},
            "B19013": {"estimate": {"B19013001": 70000 + idx * 3000}, "error": {"B19013001": 2800}},
            "B19301": {"estimate": {"B19301001": 42000 + idx * 1000}, "error": {"B19301001": 1500}},
            "B17001": {"estimate": {"B17001001": poverty_total, "B17001002": poverty_below}, "error": {"B17001002": 300}},
            "B25064": {"estimate": {"B25064001": 1450 + idx * 25}, "error": {"B25064001": 75}},
            "B25077": {"estimate": {"B25077001": 360000 + idx * 8000}, "error": {"B25077001": 9000}},
            "B08301": {
                "estimate": {
                    "B08301001": 5000,
                    "B08301003": 3100,
                    "B08301004": 400,
                    "B08301010": 300,
                    "B08301016": 450,
                    "B08301017": 200,
                    "B08301018": 100,
                    "B08301019": 450,
                }
            },
            "B08303": {"estimate": {"B08303001": 19.2 + idx * 0.3}},
            "B11001": {"estimate": {"B11001001": 3000 + idx * 200, "B11001003": 1500, "B11001004": 350, "B11001005": 450, "B11001006": 700}},
            "B25010": {"estimate": {"B25010001": 2.3}},
            "B15003": {
                "estimate": {
                    "B15003001": 6000,
                    "B15003012": 400,
                    "B15003013": 450,
                    "B15003014": 450,
                    "B15003015": 480,
                    "B15003016": 500,
                    "B15003017": 1200,
                    "B15003018": 600,
                    "B15003019": 420,
                    "B15003020": 360,
                    "B15003021": 390,
                    "B15003022": 780,
                    "B15003023": 480,
                    "B15003024": 220,
                    "B15003025": 170,
                }
            },
            "B05002": {"estimate": {"B05002001": pop, "B05002013": int(pop * 0.12)}},
            "B07003": {"estimate": {"B07003001": 8200, "B07003002": 5400, "B07003004": 1600, "B07003005": 500, "B07003006": 480, "B07003007": 220}},
            "B21001": {"estimate": {"B21001001": 6800, "B21001002": 240}},
        }

    return {
        "release": {"id": "acs2024_5yr", "name": "ACS 2024 5-year", "years": "2020-2024"},
        "tables": tables,
        "geography": {geoid: {"name": geoid} for geoid in geoids},
        "data": data,
    }


def test_by_point_returns_profile_payload(monkeypatch):
    import backend.app.census_profile_service as cps

    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        if stage == "geocoder":
            return _geocoder_payload()
        if stage == "parents":
            return _parents_payload()
        if stage == "tract_full":
            return _tables_payload([TRACT_GEOID])
        if stage == "comparisons":
            return _tables_payload([TRACT_GEOID, PLACE_GEOID, COUNTY_GEOID, STATE_GEOID, NATION_GEOID])
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cps, "request_json", fake_request_json)

    import backend.app.main as main_module

    importlib.reload(main_module)
    client = TestClient(main_module.app)

    resp = client.get("/api/census/by-point", params={"lat": 43.074, "lon": -89.384})
    assert resp.status_code == 200
    payload = resp.json()

    assert payload["tract"]["reporter_geoid"] == TRACT_GEOID
    assert "sections" in payload["derived"]
    assert "comparisons" in payload["derived"]
    assert payload["derived"]["profile_summary"]["population"] is not None
    economics = next((section for section in payload["derived"]["sections"] if section["id"] == "economics"), None)
    assert economics is not None
    median_income_metric = next((metric for metric in economics["metrics"] if metric["id"] == "median_household_income"), None)
    assert median_income_metric is not None
    assert isinstance(median_income_metric["high_moe"], bool)
    assert median_income_metric["comparisons"]
    assert "figure in" in median_income_metric["comparisons"][0]["line"]


def test_by_point_include_parents_false(monkeypatch):
    import backend.app.census_profile_service as cps

    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        if stage == "geocoder":
            return _geocoder_payload()
        if stage == "tract_full":
            return _tables_payload([TRACT_GEOID])
        if stage == "comparisons":
            return _tables_payload([TRACT_GEOID])
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cps, "request_json", fake_request_json)

    import backend.app.main as main_module

    importlib.reload(main_module)
    client = TestClient(main_module.app)

    resp = client.get(
        "/api/census/by-point",
        params={"lat": 43.074, "lon": -89.384, "include_parents": "false"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["parents"]["comparison_geoids"] == [TRACT_GEOID]


def test_by_point_rejects_missing_params():
    import backend.app.main as main_module

    client = TestClient(main_module.app)
    resp = client.get("/api/census/by-point")
    assert resp.status_code == 422


def test_by_point_rejects_invalid_lat():
    import backend.app.main as main_module

    client = TestClient(main_module.app)
    resp = client.get("/api/census/by-point", params={"lat": 120, "lon": -89.384})
    assert resp.status_code == 422


def test_by_point_404_when_no_tract(monkeypatch):
    import backend.app.census_profile_service as cps

    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        if stage == "geocoder":
            return {"result": {"geographies": {"Census Tracts": []}}}
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cps, "request_json", fake_request_json)

    import backend.app.main as main_module

    importlib.reload(main_module)
    client = TestClient(main_module.app)

    resp = client.get("/api/census/by-point", params={"lat": 43.074, "lon": -89.384})
    assert resp.status_code == 404
