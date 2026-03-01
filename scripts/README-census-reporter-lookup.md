# Census Reporter Lookup Script

This document explains how to use `scripts/census_reporter_lookup.py` to retrieve Census Reporter data from:
- Latitude/longitude coordinates
- A postal address (via a conversion step)

It also documents accepted parameters, returned data, and how to inspect results.

## What this script does

Given a coordinate:
1. Uses the U.S. Census Geocoder to find the containing Census tract.
2. Extracts tract, ZIP Code Tabulation Area (ZCTA), and county identifiers.
3. Calls Census Reporter `data/show` for:
   - A broad tract-level table set (`FULL_TRACT_TABLES`)
   - Comparison geographies (`COMPARISON_TABLES`)
4. Produces:
   - Raw API payloads
   - Derived highlights (income, poverty, rent, home value, education, transportation)
   - Geography metadata and comparison GEOIDs

## Requirements

- Python environment managed by `uv`
- Internet access (calls Census Geocoder + Census Reporter APIs)

Setup:

```bash
cd /Users/bala/Repos/groundtruth
uv sync --dev
```

## Run from latitude/longitude

Basic run:

```bash
uv run python /Users/bala/Repos/groundtruth/scripts/census_reporter_lookup.py \
  --lat 43.074 --lon -89.384 --pretty
```

Write to a custom output path:

```bash
uv run python /Users/bala/Repos/groundtruth/scripts/census_reporter_lookup.py \
  --lat 43.074 --lon -89.384 \
  --out /Users/bala/Repos/groundtruth/scripts/out/my_lookup.json \
  --pretty
```

## Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `--lat` | Yes | n/a | Latitude in decimal degrees. Valid range `[-90, 90]`. |
| `--lon` | Yes | n/a | Longitude in decimal degrees. Valid range `[-180, 180]`. |
| `--acs` | No | `latest` | Census Reporter ACS release (for example `acs2024_5yr`). |
| `--out` | No | `scripts/out/census_<lat>_<lon>.json` | Output JSON file path. |
| `--timeout` | No | `20` | Request timeout in seconds. |
| `--retries` | No | `3` | Retry count for timeout/429/5xx cases. |
| `--no-parents` | No | `false` | If set, disables parent comparison pull. |
| `--pretty` | No | `false` | Pretty-print JSON output. |

## Address to values workflow

The script accepts coordinates, not raw addresses.  
For an address, first convert address -> coordinates using Census Geocoder, then run the script.

### Option A: address -> lat/lon -> run script

```bash
uv run python - <<'PY'
import httpx

address = "1600 Pennsylvania Ave NW, Washington, DC"

r = httpx.get(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
    params={
        "address": address,
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "layers": "all",
        "format": "json",
    },
    timeout=20,
)
r.raise_for_status()
match = r.json()["result"]["addressMatches"][0]
lat = match["coordinates"]["y"]
lon = match["coordinates"]["x"]
print(f"lat={lat} lon={lon}")
PY
```

Then:

```bash
uv run python /Users/bala/Repos/groundtruth/scripts/census_reporter_lookup.py \
  --lat <LAT_FROM_PREVIOUS_STEP> --lon <LON_FROM_PREVIOUS_STEP> --pretty
```

### Option B: one-shot shell function

```bash
ADDRESS="1600 Pennsylvania Ave NW, Washington, DC"
read LAT LON < <(uv run python - <<'PY'
import httpx, os
address = os.environ["ADDRESS"]
r = httpx.get(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
    params={
        "address": address,
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "layers": "all",
        "format": "json",
    },
    timeout=20,
)
m = r.json()["result"]["addressMatches"][0]
print(m["coordinates"]["y"], m["coordinates"]["x"])
PY
)

uv run python /Users/bala/Repos/groundtruth/scripts/census_reporter_lookup.py \
  --lat "$LAT" --lon "$LON" --pretty
```

## Output location

By default:

`/Users/bala/Repos/groundtruth/scripts/out/census_<lat>_<lon>.json`

## Output JSON structure

Top-level fields:

- `input`: runtime inputs and options used
- `tract`: tract FIPS and Census Reporter tract GEOID
- `geography_levels`: explicit level mapping
  - `census_tract`
  - `zip_code_tabulation_area`
  - `county`
- `parents`: parent geographies and selected `comparison_geoids`
- `release`: ACS release metadata returned by Census Reporter
- `tables`: table IDs requested for tract and comparisons
- `data`:
  - `tract_full`
  - `comparisons`
  - `profile` (always `null` in current implementation)
- `derived`:
  - `tract_highlights`
  - `comparison_highlights_by_geoid`
- `errors`: non-fatal fetch/fallback issues
- `output_path`: where the JSON was written

## How to inspect values

Tract highlights:

```bash
jq '.derived.tract_highlights' /Users/bala/Repos/groundtruth/scripts/out/census_43.074000_-89.384000.json
```

All comparison highlights:

```bash
jq '.derived.comparison_highlights_by_geoid' /Users/bala/Repos/groundtruth/scripts/out/census_43.074000_-89.384000.json
```

Geography level mapping (tract/ZIP/county):

```bash
jq '.geography_levels' /Users/bala/Repos/groundtruth/scripts/out/census_43.074000_-89.384000.json
```

## Data included (table IDs)

### Full tract pull

`B01003,B01002,B01001,B03002,B19013,B19301,B19001,B17001,B23025,B25001,B25002,B25003,B25024,B25064,B25077,B25075,B08301,B08303,B08013,B15003,B05002,B05006,B07003,B11001,B25010,B12001,B13016,B21001,B16001`

### Comparison pull

`B01003,B01002,B19013,B19301,B17001,B25077,B25064,B08301,B15003,B05002,B07003,B03002,B25002,B25003`

### Derived metrics computed

- Population (`B01003`)
- Median age (`B01002`)
- Median household income (`B19013`)
- Per-capita income (`B19301`)
- Poverty rate (`B17001`)
- Median rent (`B25064`)
- Median home value (`B25077`)
- Transportation mode shares (`B08301`)
- Education shares (`B15003`)

## Missing values and fallbacks

- Missing/unavailable metrics are expected in some geographies and are allowed.
- Sentinel negative medians from upstream are normalized to `null` for key median fields.
- Per-table fallback is only triggered when the bulk `data/show` call fails with Census Reporter's specific "none of the releases had the requested geo_ids and table_ids" condition.
- For other upstream failures, the script exits with an unrecoverable upstream API error.
- Fallback details are written into `errors`.

## Exit codes

- `0`: success
- `2`: invalid arguments
- `3`: no tract found for coordinate
- `4`: unrecoverable upstream API error

## API endpoints used

- Census Geocoder coordinates endpoint:
  - `https://geocoding.geo.census.gov/geocoder/geographies/coordinates`
- Census Geocoder address endpoint (for conversion):
  - `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress`
- Census Reporter data endpoint:
  - `https://api.censusreporter.org/1.0/data/show/<acs>?table_ids=...&geo_ids=...`
- Census Reporter parent geographies endpoint (used unless `--no-parents`):
  - `https://api.censusreporter.org/1.0/geo/latest/<tract_geoid>/parents`
