from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import census_reporter_lookup as cr  # noqa: E402


TRACT_GEOID = "14000US55025001704"
PLACE_GEOID = "16000US5548000"
COUNTY_GEOID = "05000US55025"
CBSA_GEOID = "31000US31540"
STATE_GEOID = "04000US55"
NATION_GEOID = "01000US"
ZCTA_GEOID = "86000US53711"


def _geocoder_payload() -> dict:
    return {
        "result": {
            "geographies": {
                "2020 Census ZIP Code Tabulation Areas": [
                    {
                        "GEOID": "53711",
                        "ZCTA5": "53711",
                        "NAME": "ZCTA5 53711",
                    }
                ],
                "Counties": [
                    {
                        "GEOID": "55025",
                        "NAME": "Dane County",
                    }
                ],
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


def _parents_payload() -> dict:
    return {
        "parents": [
            {
                "sumlevel": "140",
                "geoid": TRACT_GEOID,
                "relation": "this",
                "display_name": "Census Tract 17.04",
            },
            {
                "sumlevel": "050",
                "geoid": COUNTY_GEOID,
                "relation": "county",
                "display_name": "Dane County, WI",
            },
            {
                "sumlevel": "160",
                "geoid": PLACE_GEOID,
                "relation": "place",
                "display_name": "Madison city, WI",
            },
            {
                "sumlevel": "310",
                "geoid": CBSA_GEOID,
                "relation": "CBSA",
                "display_name": "Madison, WI Metro Area",
            },
            {
                "sumlevel": "040",
                "geoid": STATE_GEOID,
                "relation": "state",
                "display_name": "Wisconsin",
            },
            {
                "sumlevel": "010",
                "geoid": NATION_GEOID,
                "relation": "nation",
                "display_name": "United States",
            },
        ]
    }


def _geo_tables(population: int, mhi: int, poverty_below: int, poverty_total: int) -> dict:
    return {
        "B01003": {"estimate": {"B01003001": population}},
        "B01002": {"estimate": {"B01002001": 34.2}},
        "B19013": {"estimate": {"B19013001": mhi}},
        "B19301": {"estimate": {"B19301001": 28000}},
        "B17001": {"estimate": {"B17001001": poverty_total, "B17001002": poverty_below}},
        "B25064": {"estimate": {"B25064001": 1200}},
        "B25077": {"estimate": {"B25077001": 280000}},
        "B08301": {
            "estimate": {
                "B08301001": 1000,
                "B08301003": 500,
                "B08301004": 70,
                "B08301010": 120,
                "B08301016": 80,
                "B08301017": 40,
                "B08301018": 30,
                "B08301019": 160,
            }
        },
        "B15003": {
            "estimate": {
                "B15003001": 2000,
                "B15003012": 210,
                "B15003013": 200,
                "B15003014": 240,
                "B15003015": 210,
                "B15003016": 190,
                "B15003017": 480,
                "B15003018": 210,
                "B15003019": 80,
                "B15003020": 50,
            }
        },
    }


def _tract_full_payload() -> dict:
    return {
        "release": {"id": "acs2024_5yr", "name": "ACS 2024 5-year", "years": "2020-2024"},
        "tables": {
            "B01003": {"title": "Total Population"},
            "B01002": {"title": "Median Age"},
            "B19013": {"title": "Median Household Income"},
            "B19301": {"title": "Per Capita Income"},
            "B17001": {"title": "Poverty Status"},
            "B25064": {"title": "Median Rent"},
            "B25077": {"title": "Median Home Value"},
            "B08301": {"title": "Means of Transportation to Work"},
            "B15003": {"title": "Educational Attainment"},
        },
        "geography": {TRACT_GEOID: {"name": "Census Tract 17.04"}},
        "data": {TRACT_GEOID: _geo_tables(8835, 30683, 5960, 8835)},
    }


def _comparison_payload() -> dict:
    geoids = [TRACT_GEOID, PLACE_GEOID, COUNTY_GEOID, CBSA_GEOID, STATE_GEOID, NATION_GEOID]
    names = {
        TRACT_GEOID: "Census Tract 17.04",
        PLACE_GEOID: "Madison city, WI",
        COUNTY_GEOID: "Dane County, WI",
        CBSA_GEOID: "Madison, WI Metro Area",
        STATE_GEOID: "Wisconsin",
        NATION_GEOID: "United States",
    }
    pops = {
        TRACT_GEOID: 8835,
        PLACE_GEOID: 275000,
        COUNTY_GEOID: 585000,
        CBSA_GEOID: 710000,
        STATE_GEOID: 5900000,
        NATION_GEOID: 334000000,
    }
    mhi = {
        TRACT_GEOID: 30683,
        PLACE_GEOID: 78050,
        COUNTY_GEOID: 89975,
        CBSA_GEOID: 86000,
        STATE_GEOID: 73000,
        NATION_GEOID: 78000,
    }
    poverty_below = {
        TRACT_GEOID: 5960,
        PLACE_GEOID: 45000,
        COUNTY_GEOID: 62000,
        CBSA_GEOID: 74000,
        STATE_GEOID: 640000,
        NATION_GEOID: 42000000,
    }
    poverty_total = {
        TRACT_GEOID: 8835,
        PLACE_GEOID: 275000,
        COUNTY_GEOID: 585000,
        CBSA_GEOID: 710000,
        STATE_GEOID: 5900000,
        NATION_GEOID: 334000000,
    }
    return {
        "release": {"id": "acs2024_5yr", "name": "ACS 2024 5-year", "years": "2020-2024"},
        "tables": {
            "B01003": {"title": "Total Population"},
            "B01002": {"title": "Median Age"},
            "B19013": {"title": "Median Household Income"},
            "B19301": {"title": "Per Capita Income"},
            "B17001": {"title": "Poverty Status"},
            "B25064": {"title": "Median Rent"},
            "B25077": {"title": "Median Home Value"},
            "B08301": {"title": "Means of Transportation to Work"},
            "B15003": {"title": "Educational Attainment"},
        },
        "geography": {geoid: {"name": names[geoid]} for geoid in geoids},
        "data": {
            geoid: _geo_tables(
                population=pops[geoid],
                mhi=mhi[geoid],
                poverty_below=poverty_below[geoid],
                poverty_total=poverty_total[geoid],
            )
            for geoid in geoids
        },
    }


def test_extract_tract_and_build_geoid() -> None:
    tract = cr.extract_first_tract(_geocoder_payload())
    assert tract["GEOID"] == "55025001704"
    assert cr.build_reporter_tract_geoid(tract["GEOID"]) == TRACT_GEOID


def test_build_comparison_geoids_priority_order() -> None:
    geoids, selected = cr.build_comparison_geoids(
        tract_geoid=TRACT_GEOID,
        parents=_parents_payload()["parents"],
        include_parents=True,
        required_geoids_by_sumlevel={"860": ZCTA_GEOID, "050": COUNTY_GEOID},
    )
    assert geoids == [
        TRACT_GEOID,
        ZCTA_GEOID,
        COUNTY_GEOID,
        PLACE_GEOID,
        CBSA_GEOID,
        STATE_GEOID,
        NATION_GEOID,
    ]
    assert [x["sumlevel"] for x in selected] == ["140", "860", "050", "160", "310", "040", "010"]


def test_extract_zip_and_county_geographies() -> None:
    payload = _geocoder_payload()
    county = cr.extract_optional_first_geography(payload, "Counties")
    zcta = cr.extract_optional_zcta(payload)
    assert county is not None
    assert county["GEOID"] == "55025"
    assert zcta is not None
    assert zcta["GEOID"] == "53711"
    assert cr.build_reporter_county_geoid("55025") == COUNTY_GEOID
    assert cr.build_reporter_zcta_geoid("53711") == ZCTA_GEOID


def test_derived_metrics_with_missing_values() -> None:
    payload = {
        "geography": {"14000US00000000000": {"name": "Example Tract"}},
        "data": {
            "14000US00000000000": {
                "B17001": {"estimate": {"B17001001": 400, "B17001002": 100}},
                "B15003": {
                    "estimate": {
                        "B15003001": 1000,
                        "B15003012": 100,
                        "B15003013": 100,
                        "B15003014": 100,
                        "B15003015": 100,
                        "B15003016": 100,
                        "B15003017": 100,
                        "B15003018": 100,
                        "B15003019": 50,
                        "B15003020": 50,
                    }
                },
            }
        },
    }
    result = cr.compute_highlights_for_geoid(payload, "14000US00000000000", "Example Tract")
    assert result["poverty"]["rate_pct"] == pytest.approx(25.0)
    assert result["housing"]["median_rent"] is None
    assert result["education"]["high_school_or_higher_pct"] == pytest.approx(80.0)
    assert result["education"]["bachelors_or_higher_pct"] == pytest.approx(50.0)


def test_bulk_failure_falls_back_to_per_table_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    tract_payload = _tract_full_payload()
    seen_stages: list[str] = []

    def single_table_tract_payload(table_id: str) -> dict:
        table_data = tract_payload["data"][TRACT_GEOID].get(table_id, {"estimate": {}})
        return {
            "release": tract_payload["release"],
            "tables": {table_id: {"title": table_id}},
            "geography": tract_payload["geography"],
            "data": {TRACT_GEOID: {table_id: table_data}},
        }

    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        seen_stages.append(stage)
        if stage == "geocoder":
            return _geocoder_payload()
        if stage == "parents":
            return _parents_payload()
        if stage == "tract_full":
            raise cr.UpstreamAPIError(
                "tract_full", 'HTTP 400: {"error":"None of the releases had the requested geo_ids and table_ids"}'
            )
        if stage.startswith("tract_full:"):
            table_id = stage.split(":", 1)[1]
            return single_table_tract_payload(table_id)
        if stage == "comparisons":
            return _comparison_payload()
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cr, "request_json", fake_request_json)
    args = cr.build_parser().parse_args(["--lat", "43.074", "--lon", "-89.384"])
    cr.validate_args(cr.build_parser(), args)
    result = cr.lookup_census(args)
    assert result["data"]["tract_full"]["tables"]
    assert "tract_full" in seen_stages
    assert any(stage.startswith("tract_full:") for stage in seen_stages)
    assert result["geography_levels"]["zip_code_tabulation_area"]["reporter_geoid"] == ZCTA_GEOID
    assert result["geography_levels"]["county"]["reporter_geoid"] == COUNTY_GEOID


def test_no_tract_returns_exit_3(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        if stage == "geocoder":
            return {"result": {"geographies": {"Census Tracts": []}}}
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cr, "request_json", fake_request_json)
    out_file = tmp_path / "result.json"
    exit_code = cr.main(["--lat", "43.074", "--lon", "-89.384", "--out", str(out_file)])
    assert exit_code == cr.EXIT_NO_TRACT
    assert not out_file.exists()


def test_cli_smoke_valid_run_writes_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_request_json(client, url, *, params, stage, config):  # type: ignore[no-untyped-def]
        if stage == "geocoder":
            return _geocoder_payload()
        if stage == "parents":
            return _parents_payload()
        if stage == "tract_full":
            return _tract_full_payload()
        if stage == "comparisons":
            return _comparison_payload()
        raise AssertionError(f"Unexpected stage: {stage}")

    monkeypatch.setattr(cr, "request_json", fake_request_json)
    out_file = tmp_path / "lookup.json"
    exit_code = cr.main(
        ["--lat", "43.074", "--lon", "-89.384", "--out", str(out_file), "--pretty"]
    )
    assert exit_code == 0
    assert out_file.exists()
    payload = out_file.read_text(encoding="utf-8")
    assert "comparison_highlights_by_geoid" in payload
    assert "tract_full" in payload


def test_invalid_latitude_rejected() -> None:
    with pytest.raises(SystemExit) as exc_info:
        cr.main(["--lat", "120", "--lon", "-89.384"])
    assert exc_info.value.code == 2
