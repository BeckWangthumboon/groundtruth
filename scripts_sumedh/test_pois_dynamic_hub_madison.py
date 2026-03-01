import asyncio
import json
from collections import Counter
from typing import List, Optional

import pois_dynamic as pd
from pois_dynamic import get_pois_by_preferences


LAT = 43.07437
LNG = -89.39510
RADIUS_M = 1200

USE_FIXTURE = False

# Offline fixture to keep the script runnable when Overpass is unreachable.
FIXTURE_ELEMENTS = [
    {"type": "node", "id": 1, "lat": 43.0745, "lon": -89.3954, "tags": {"shop": "supermarket", "name": "Fresh Market"}},
    {"type": "node", "id": 2, "lat": 43.0742, "lon": -89.3960, "tags": {"amenity": "pharmacy", "name": "Hub Pharmacy"}},
    {"type": "node", "id": 3, "lat": 43.0748, "lon": -89.3945, "tags": {"amenity": "clinic", "name": "State Clinic"}},
    {"type": "node", "id": 4, "lat": 43.0740, "lon": -89.3951, "tags": {"highway": "bus_stop", "name": "State St Stop"}},
    {"type": "node", "id": 5, "lat": 43.0739, "lon": -89.3948, "tags": {"amenity": "parking", "name": "Lot 12"}},
    {"type": "node", "id": 6, "lat": 43.0750, "lon": -89.3956, "tags": {"leisure": "park", "name": "Peace Park"}},
    {"type": "node", "id": 7, "lat": 43.0746, "lon": -89.3942, "tags": {"amenity": "bar", "name": "Local Bar"}},
    {"type": "node", "id": 8, "lat": 43.0737, "lon": -89.3957, "tags": {"amenity": "school", "name": "Prep School"}},
    {"type": "node", "id": 9, "lat": 43.0741, "lon": -89.3962, "tags": {"leisure": "fitness_centre", "name": "Crunch Fitness"}},
    {"type": "node", "id": 10, "lat": 43.0749, "lon": -89.3953, "tags": {"shop": "hairdresser", "name": "Clip Joint"}},
    {"type": "node", "id": 11, "lat": 43.0744, "lon": -89.3949, "tags": {"amenity": "cafe", "name": "Cafe Soleil"}},
    {"type": "node", "id": 12, "lat": 43.0743, "lon": -89.3959, "tags": {"amenity": "restaurant", "name": "Noodles & Co"}},
    {"type": "node", "id": 13, "lat": 43.0738, "lon": -89.3964, "tags": {"shop": "clothes", "name": "Boutique 42"}},
    {"type": "node", "id": 14, "lat": 43.0752, "lon": -89.3950, "tags": {"amenity": "university", "name": "UW Campus Building"}},
    {"type": "node", "id": 15, "lat": 43.0747, "lon": -89.3961, "tags": {"tourism": "hotel", "name": "Campus Inn"}},
    {"type": "node", "id": 16, "lat": 43.0736, "lon": -89.3952, "tags": {"public_transport": "platform", "name": "Transit Platform"}},
    {"type": "node", "id": 17, "lat": 43.0740, "lon": -89.3946, "tags": {"amenity": "parking_entrance", "name": "Garage Entrance"}},
    {"type": "node", "id": 18, "lat": 43.0751, "lon": -89.3960, "tags": {"leisure": "sports_centre", "name": "Rec Center"}},
    {"type": "node", "id": 19, "lat": 43.0742, "lon": -89.3943, "tags": {"shop": "nail_salon", "name": "Nail Studio"}},
    {"type": "node", "id": 20, "lat": 43.0739, "lon": -89.3966, "tags": {"amenity": "fast_food", "name": "Burger Spot"}},
    {"type": "node", "id": 21, "lat": 43.0745, "lon": -89.3944, "tags": {"amenity": "cafe", "name": "Competing Cafe"}},
]


async def _fixture_fetch(_query: str) -> dict:
    return {"elements": FIXTURE_ELEMENTS}

async def run_case(
    *,
    name: str,
    selected_labels: List[str],
    business_type: Optional[str],
    outfile: str,
) -> None:
    global USE_FIXTURE

    if USE_FIXTURE:
        data = await get_pois_by_preferences(
            LAT,
            LNG,
            RADIUS_M,
            selected_labels=selected_labels,
            business_type=business_type,
            include_nodes=True,
        )
    else:
        try:
            data = await get_pois_by_preferences(
                LAT,
                LNG,
                RADIUS_M,
                selected_labels=selected_labels,
                business_type=business_type,
                include_nodes=True,
            )
        except Exception:
            pd._fetch_overpass = _fixture_fetch
            USE_FIXTURE = True
            data = await get_pois_by_preferences(
                LAT,
                LNG,
                RADIUS_M,
                selected_labels=selected_labels,
                business_type=business_type,
                include_nodes=True,
            )

    points = data.get("points") or []
    counts = data.get("countsByLabel") or {}
    meta = data.get("meta") or {}

    meta_summary = {
        "radius_m": meta.get("radius_m"),
        "requestedLabels": meta.get("requestedLabels"),
        "returned_points": meta.get("returned_points"),
        "cached": meta.get("cached"),
        "total_elements": meta.get("total_elements"),
    }

    print(f"\n=== {name} ===")
    print("meta:", meta_summary)

    counts_sorted = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    print("countsByLabel (desc):", counts_sorted)

    print("number of points:", len(points))
    histogram = Counter(p.get("type") for p in points if isinstance(p, dict))
    print("histogram by type:", dict(histogram))

    print("first 10 points:")
    for p in points[:10]:
        print(
            f'{p.get("type")} | ({p.get("lat")},{p.get("lng")}) | '
            f'name={p.get("name")} | categories={p.get("categories")}'
        )

    # Assertions
    assert len(points) <= 150, "returned_points cap exceeded"
    assert meta.get("returned_points", len(points)) <= 150, "meta returned_points cap exceeded"
    meta_labels = meta.get("requestedLabels") or []
    assert all(label in meta_labels for label in selected_labels), "meta requestedLabels missing passed labels"

    for idx, p in enumerate(points):
        for key in ("lat", "lng", "type", "weight"):
            assert key in p, f"point {idx} missing {key}"
        assert isinstance(p["lat"], float), f"point {idx} lat not float"
        assert isinstance(p["lng"], float), f"point {idx} lng not float"
        assert isinstance(p["type"], str) and p["type"], f"point {idx} type invalid"

    with open(outfile, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


async def main():
    case_a_labels = [
        "essentials_nearby",
        "healthcare_access",
        "transit_access",
        "parking_availability",
        "green_space",
        "nightlife_density",
        "family_friendly",
        "fitness_recreation",
        "personal_care",
    ]

    case_b_labels = [
        "food_corridor_density",
        "retail_density",
        "transit_access",
        "parking_availability",
        "anchors_nearby",
        "direct_competition",
        "personal_care",
        "fitness_recreation",
    ]

    await run_case(
        name="Case A (tenant-like)",
        selected_labels=case_a_labels,
        business_type=None,
        outfile="pois_hub_madison_caseA.json",
    )

    await run_case(
        name="Case B (business-like cafe w/ competition)",
        selected_labels=case_b_labels,
        business_type="cafe",
        outfile="pois_hub_madison_caseB.json",
    )


if __name__ == "__main__":
    asyncio.run(main())
