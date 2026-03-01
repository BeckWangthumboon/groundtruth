"""Quick integrity check for Overpass POI fetcher.

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
    lat, lng = 41.8781, -87.6298  # Chicago Loop
    radius_m = 1800
    data = await get_overpass_pois(lat, lng, radius_m=radius_m)

    counts = data.get("counts", {})
    points = data.get("points", [])
    meta = data.get("meta", {})

    print("Meta:", meta)
    print("Counts:", counts)
    print("Returned points:", len(points))
    if points:
        print("Sample point:", points[0])

    # Basic sanity checks
    assert meta.get("radius_m") == radius_m, "Radius mismatch in meta"
    assert isinstance(points, list), "Points not a list"
    assert isinstance(counts, dict), "Counts not a dict"

    # Sum of counts should be >= number of points (downsampling may reduce points)
    total_counts = sum(counts.values())
    assert total_counts >= len(points), "Counts total should be >= returned points (downsampling expected)"

    # All points should be within radius
    for p in points[:50]:  # sample up to 50 to keep test quick
        d = _haversine_m(lat, lng, p["lat"], p["lng"])
        assert d <= radius_m * 1.05, f"Point outside radius buffer: {d}m"

    print("✅ Overpass POI fetch appears valid.")


if __name__ == "__main__":
    asyncio.run(main())
