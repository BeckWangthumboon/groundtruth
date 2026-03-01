"""Quick integrity + data peek for Overpass POI fetcher.

Runs a query around Hub Madison (437 N Frances St, Madison, WI)
and prints the food POIs (names + coordinates) headed to the frontend.

Usage:
    python3 scripts_sumedh/test_overpass.py
"""

import asyncio
import math
from overpass_pois import get_overpass_pois


def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def main():
    # Hub Madison coordinates (approx): 43.07447, -89.39554
    lat, lng = 43.07447, -89.39554
    radius_m = 500
    data = await get_overpass_pois(lat, lng, radius_m=radius_m)

    counts = data.get("counts", {})
    points = data.get("points", [])
    meta = data.get("meta", {})

    print("Meta:", meta)
    print("Counts:", counts)
    print("Returned points:", len(points))

    nightlife_points = [p for p in points if p.get("type") == "nightlife"]
    print(f"\nNightlife POIs (showing all {len(nightlife_points)}):")
    for p in nightlife_points:
        name = p.get("name", "<unnamed>")
        print(f" - {name:40s}  ({p['lat']:.6f}, {p['lng']:.6f})  w={p.get('weight')}")

    # Basic sanity checks
    assert meta.get("radius_m") == radius_m, "Radius mismatch in meta"
    assert isinstance(points, list), "Points not a list"
    assert isinstance(counts, dict), "Counts not a dict"

    total_counts = sum(counts.values())
    assert total_counts >= len(points), "Counts total should be >= returned points (downsampling expected)"

    print("\n✅ Overpass POI fetch complete; nightlife POIs listed above will be sent to the frontend.")


if __name__ == "__main__":
    asyncio.run(main())
