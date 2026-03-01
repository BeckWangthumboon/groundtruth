"""
Rank locations by weighted score. Lower-is-better metrics use 1 - normalized.
design.md: "for lower is better (land_cost, disaster_risk), use 1 - normalized"
"""

LOWER_IS_BETTER = frozenset({"land_cost", "disaster_risk"})


def rank_locations(
    locations: list[dict],
    weights: dict[str, float],
    metric_ids: list[str],
) -> list[dict]:
    """
    Rank locations by weighted normalized score.
    Accepts list of dicts with 'id', optional 'label', and numeric metric keys.
    """
    if not locations:
        return []

    by_metric: dict[str, list[float]] = {}
    for mid in metric_ids:
        by_metric[mid] = []
        for loc in locations:
            v = loc.get(mid)
            if isinstance(v, (int, float)) and not (v != v):  # not NaN
                by_metric[mid].append(float(v))
            else:
                by_metric[mid].append(0.0)

    min_max: dict[str, tuple[float, float]] = {}
    for mid in metric_ids:
        arr = by_metric[mid]
        mn, mx = min(arr), max(arr)
        min_max[mid] = (mn, mx if mx > mn else 1.0)

    scores: list[tuple[int, float]] = []
    for i, loc in enumerate(locations):
        score = 0.0
        for mid in metric_ids:
            w = weights.get(mid, 0)
            if w == 0:
                continue
            raw = by_metric[mid][i]
            mn, mx = min_max[mid]
            normalized = (raw - mn) / (mx - mn) if mx > mn else 0.0
            value = 1.0 - normalized if mid in LOWER_IS_BETTER else normalized
            score += w * value
        scores.append((i, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    return [locations[s[0]] for s in scores]
