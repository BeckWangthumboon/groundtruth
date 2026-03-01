"""Disaster risk proxy (Phase 4)."""

from __future__ import annotations

import hashlib
from typing import Optional, Dict


def _stable_seed(lat: float, lng: float, seed_key: Optional[str]) -> int:
    base = f"{round(lat,4)}|{round(lng,4)}|{seed_key or 'default'}"
    md5 = hashlib.md5(base.encode()).hexdigest()
    return int(md5[:8], 16)


def _scaled_noise(seed: int, salt: str) -> float:
    mixed = f"{seed}|{salt}".encode()
    md5 = hashlib.md5(mixed).hexdigest()
    return int(md5[:6], 16) / 0xFFFFFF  # 0..1


def compute_disaster_risk(lat: float, lng: float, seed_key: Optional[str] = None) -> Dict[str, float]:
    """
    Return deterministic simulated disaster risks for flood, heat, and storm.

    Args:
        lat, lng: location
        seed_key: optional extra string to vary the seed
    """
    seed = _stable_seed(lat, lng, seed_key)

    flood = round(_scaled_noise(seed, "flood"), 3)
    heat = round(_scaled_noise(seed, "heat"), 3)
    storm = round(_scaled_noise(seed, "storm"), 3)

    overall = round(max(flood, heat, storm), 3)

    return {
        "overallRisk": overall,
        "hazards": {
            "flood": flood,
            "heat": heat,
            "storm": storm,
        },
        "source": "simulated",
    }

