"""
Chat config: default weights and system prompt for the location-assistant bot.
See design.md for metrics list and grounding.
"""

from typing import Literal, TypedDict

METRIC_IDS = [
    "population",
    "population_density",
    "income",
    "safety",
    "parking",
    "land_cost",
    "disaster_risk",
]

Focus = Literal["tenant", "small_business"]
Weights = dict[str, float]

# Default weights when user has not set preferences. Values sum to 1.
DEFAULT_WEIGHTS: dict[Focus, Weights] = {
    "tenant": {
        "safety": 0.3,
        "land_cost": 0.28,
        "parking": 0.15,
        "disaster_risk": 0.12,
        "income": 0.06,
        "population": 0.05,
        "population_density": 0.04,
    },
    "small_business": {
        "population": 0.2,
        "population_density": 0.18,
        "parking": 0.2,
        "income": 0.12,
        "land_cost": 0.12,
        "safety": 0.12,
        "disaster_risk": 0.06,
    },
}

SYSTEM_PROMPT_BASE = """You help people decide where to live or open a business. You only use these metrics: population, population_density, income, safety, parking, land_cost, disaster_risk. Do not invent data.

When the user describes priorities (e.g. "safety and affordability"), reply briefly and include a JSON object "weights" with keys from the metric list and values that sum to 1.0. Use only those keys. Format the weights in a markdown code block, e.g.:
```json
{"weights": {"safety": 0.4, "land_cost": 0.3, ...}}
```

When the user mentions interests, hobbies, or preferences (e.g. "working out", "gym", "parks", "schools", "restaurants"), include in your reply a second JSON code block with map_query_keywords: an array of short strings suitable for a map/POI search. Generate 3–8 concrete search terms. Example:
```json
{"map_query_keywords": ["gym", "fitness center", "yoga studio", "running track"]}
```
If the message has no clear interest or preference for map search, omit this block.

When explaining a ranking or comparison, use only the metric values provided in the context. Keep replies to 2-4 sentences unless the user asks for more."""


class LocationWithMetrics(TypedDict, total=False):
    id: str
    label: str
    population: float
    population_density: float
    income: float
    safety: float
    parking: float
    land_cost: float
    disaster_risk: float


def build_system_instruction(
    focus: Focus,
    locations_with_metrics: list[dict] | None = None,
) -> str:
    """Build the full system instruction for Gemini."""
    weights = DEFAULT_WEIGHTS[focus]
    focus_label = "Tenant" if focus == "tenant" else "Small Business"
    out = f"""{SYSTEM_PROMPT_BASE}

Current focus: {focus_label}.
Default weights for this focus: {weights}."""

    if locations_with_metrics and len(locations_with_metrics) > 0:
        out += "\n\nLocations with metrics (use only these values for compare/rank):\n"
        for i, loc in enumerate(locations_with_metrics):
            loc_copy = dict(loc)
            id_ = loc_copy.pop("id", "")
            label = loc_copy.pop("label", None)
            name = label or f"Location {i + 1}"
            out += f"- {name} (id: {id_}): {loc_copy}\n"

    return out
