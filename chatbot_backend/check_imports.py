"""Quick sanity check for updatedBackend modules."""
import sys
sys.path.insert(0, ".")
from updatedBackend.chat_config import build_system_instruction, DEFAULT_WEIGHTS, METRIC_IDS
from updatedBackend.rank import rank_locations
from updatedBackend.weights import parse_weights_from_reply
from updatedBackend.keywords import parse_map_keywords_from_reply

w = parse_weights_from_reply('Here are weights: ```json\n{"weights": {"safety": 0.5, "land_cost": 0.5}}\n```')
assert w is not None and abs(sum(w.values()) - 1.0) < 1e-6
ranked = rank_locations(
    [{"id": "a", "safety": 1, "land_cost": 0.5}, {"id": "b", "safety": 0, "land_cost": 0}],
    {"safety": 0.5, "land_cost": 0.5},
    ["safety", "land_cost"],
)
assert ranked[0]["id"] == "a"
kw = parse_map_keywords_from_reply('```json {"map_query_keywords": ["gym", "park"]} ```')
assert kw == ["gym", "park"]
print("All imports and rank/weights/keywords checks OK.")
