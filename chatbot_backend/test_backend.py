"""
Tester for chatbot_backend functionalities.
Run from project root: python chatbot_backend/test_backend.py
Or with pytest: pytest chatbot_backend/test_backend.py -v
"""

import base64
import json
import sys
from pathlib import Path

# Allow running from project root or from updatedBackend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Core modules (no FastAPI); test6/test7/test8 import chat/app only when run
try:
    from chatbot_backend.chat_config import (
        METRIC_IDS,
        DEFAULT_WEIGHTS,
        build_system_instruction,
    )
    from chatbot_backend.rank import rank_locations
    from chatbot_backend.weights import parse_weights_from_reply
    from chatbot_backend.keywords import parse_map_keywords_from_reply, write_keywords_to_file
    from chatbot_backend.tts import pcm_to_wav, synthesize_tts
except ImportError:
    from chat_config import METRIC_IDS, DEFAULT_WEIGHTS, build_system_instruction
    from rank import rank_locations
    from weights import parse_weights_from_reply
    from keywords import parse_map_keywords_from_reply, write_keywords_to_file
    from tts import pcm_to_wav, synthesize_tts


def test1():
    # Test chat_config: METRIC_IDS, DEFAULT_WEIGHTS sum to 1, build_system_instruction for both focuses and with locations
    assert len(METRIC_IDS) == 7
    assert "safety" in METRIC_IDS and "land_cost" in METRIC_IDS
    for focus in ("tenant", "small_business"):
        w = DEFAULT_WEIGHTS[focus]
        assert abs(sum(w.values()) - 1.0) < 1e-6
    out_tenant = build_system_instruction("tenant")
    assert "Tenant" in out_tenant
    assert "Default weights" in out_tenant
    out_sb = build_system_instruction("small_business")
    assert "Small Business" in out_sb
    locs = [{"id": "loc1", "label": "Downtown", "safety": 0.9, "land_cost": 0.3}]
    out_with_locs = build_system_instruction("tenant", locs)
    assert "Downtown" in out_with_locs
    assert "loc1" in out_with_locs
    assert "safety" in out_with_locs


def test2():
    # Test rank_locations: ordering by weighted score and lower-is-better for land_cost/disaster_risk
    locations = [
        {"id": "a", "label": "A", "safety": 1.0, "land_cost": 0.2},
        {"id": "b", "label": "B", "safety": 0.0, "land_cost": 0.8},
        {"id": "c", "label": "C", "safety": 0.5, "land_cost": 0.5},
    ]
    weights = {"safety": 0.5, "land_cost": 0.5}
    metric_ids = ["safety", "land_cost"]
    ranked = rank_locations(locations, weights, metric_ids)
    assert [r["id"] for r in ranked] == ["a", "c", "b"]
    # Empty input
    assert rank_locations([], weights, metric_ids) == []
    # Lower-is-better: higher land_cost should rank lower
    two = [{"id": "x", "safety": 0.5, "land_cost": 0.1}, {"id": "y", "safety": 0.5, "land_cost": 0.9}]
    r2 = rank_locations(two, {"safety": 0.0, "land_cost": 1.0}, ["safety", "land_cost"])
    assert r2[0]["id"] == "x"


def test3():
    # Test parse_weights_from_reply: extraction from code block, nested weights object, normalization to sum 1
    reply = 'Here are your weights: ```json\n{"weights": {"safety": 0.4, "land_cost": 0.6}}\n```'
    w = parse_weights_from_reply(reply)
    assert w is not None
    assert abs(sum(w.values()) - 1.0) < 1e-6
    assert "safety" in w and "land_cost" in w
    # Non-normalized input
    reply2 = '```json {"weights": {"safety": 2, "land_cost": 2}} ```'
    w2 = parse_weights_from_reply(reply2)
    assert w2 is not None and abs(sum(w2.values()) - 1.0) < 1e-6
    # No weights in reply
    assert parse_weights_from_reply("No JSON here") is None


def test4():
    # Test keywords: parse_map_keywords_from_reply and write_keywords_to_file (writes to keywords_llm, read back)
    reply = 'Interests: ```json {"map_query_keywords": ["gym", "park", "cafe"]} ```'
    kw = parse_map_keywords_from_reply(reply)
    assert kw == ["gym", "park", "cafe"]
    assert parse_map_keywords_from_reply("No keywords") is None
    path = write_keywords_to_file(["test_a", "test_b"], {"source": "test4"})
    assert path is not None
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    assert data["map_query_keywords"] == ["test_a", "test_b"]
    assert data.get("source") == "test4"
    assert "timestamp" in data


def test5():
    # Test TTS: pcm_to_wav produces valid WAV bytes; synthesize_tts raises ValueError for empty key/text
    pcm = b"\x00\x00" * 100
    wav = pcm_to_wav(pcm, 44100, 1)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert len(wav) == 44 + len(pcm)
    try:
        synthesize_tts("", "hello")
    except ValueError as e:
        assert "Missing" in str(e) or "key" in str(e).lower()
    try:
        synthesize_tts("dummy-key", "")
    except ValueError as e:
        assert "text" in str(e).lower()


def test6():
    # Test chat input validation and rank-request detection; skip real Gemini call if key is placeholder
    try:
        from chatbot_backend.chat import chat, _is_rank_request, _parse_reasoning_from_reply
    except ImportError:
        from chat import chat, _is_rank_request, _parse_reasoning_from_reply
    assert _is_rank_request("Rank them by safety") is True
    assert _is_rank_request("What's the best location?") is True
    assert _is_rank_request("I want to live somewhere safe") is False
    # Reasoning parser: no block -> (unchanged, None); with block -> (clean reply, reasoning text)
    no_reason, r_none = _parse_reasoning_from_reply("Just a normal reply.")
    assert no_reason == "Just a normal reply." and r_none is None
    with_reason = "Here is why.\n\n```reasoning\nSafety is top for you.\n```\n\nSo I recommend A."
    clean, r_text = _parse_reasoning_from_reply(with_reason)
    assert r_text == "Safety is top for you."
    assert "So I recommend A." in clean and "```reasoning" not in clean
    try:
        chat("", [], "tenant")
    except ValueError as e:
        assert "message" in str(e).lower()
    try:
        chat("hi", [], "invalid_focus")
    except ValueError as e:
        assert "focus" in str(e).lower()
    # Optional: if real API key is set, run one chat turn (comment out or set HAS_REAL_KEY to test live)
    try:
        from updatedBackend.config import GOOGLE_GENERATIVE_AI_API_KEY
    except ImportError:
        from config import GOOGLE_GENERATIVE_AI_API_KEY
    if GOOGLE_GENERATIVE_AI_API_KEY and "YOUR_" not in GOOGLE_GENERATIVE_AI_API_KEY:
        result = chat("Say hello in one word.", [], "tenant", api_key=GOOGLE_GENERATIVE_AI_API_KEY)
        assert "reply" in result
        assert isinstance(result["reply"], str)


def test7():
    # Test FastAPI app: GET /health, POST /api/chat and /api/tts request validation (400 for bad/missing body)
    try:
        from fastapi.testclient import TestClient
    except Exception as e:
        if "httpx" in str(e).lower():
            raise RuntimeError("Install httpx to run test7: pip install httpx") from e
        raise
    try:
        from updatedBackend.app import app
    except ImportError:
        from app import app
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    r_chat_bad = client.post("/api/chat", json={})
    assert r_chat_bad.status_code == 422
    r_chat_focus = client.post("/api/chat", json={"message": "hi", "focus": "invalid"})
    assert r_chat_focus.status_code in (400, 422)
    r_tts_empty = client.post("/api/tts", json={})
    assert r_tts_empty.status_code in (400, 422)
    r_tts_no_text = client.post("/api/tts", json={"text": ""})
    assert r_tts_no_text.status_code == 400


def test8():
    # Test full chat request shape and TTS request shape (happy path if keys are valid; else expect 500/502)
    try:
        from fastapi.testclient import TestClient
    except Exception as e:
        if "httpx" in str(e).lower():
            raise RuntimeError("Install httpx to run test8: pip install httpx") from e
        raise
    try:
        from updatedBackend.app import app
    except ImportError:
        from app import app
    client = TestClient(app)
    r = client.post(
        "/api/chat",
        json={
            "message": "I care about safety",
            "conversationHistory": [],
            "focus": "tenant",
            "useDefaults": True,
        },
    )
    if r.status_code == 200:
        data = r.json()
        assert "reply" in data
    else:
        assert r.status_code in (400, 500)
    r_tts = client.post("/api/tts", json={"text": "Hello"})
    if r_tts.status_code == 200:
        data = r_tts.json()
        assert "audioBase64" in data and data.get("format") == "wav"
        raw = base64.b64decode(data["audioBase64"])
        assert raw[:4] == b"RIFF"
    else:
        assert r_tts.status_code in (400, 502)


def run_all():
    tests = [test1, test2, test3, test4, test5, test6, test7, test8]
    failed = []
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:
            print(f"FAIL {t.__name__}: {e}")
            failed.append(t.__name__)
    if failed:
        print(f"\nFailed: {failed}")
        return 1
    print("\nAll tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(run_all())
