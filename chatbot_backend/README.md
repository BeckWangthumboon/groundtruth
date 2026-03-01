# Updated Backend (Python)

Python backend implementing the same behavior as the Next.js API routes: **chat** (Gemini + ranking/weights/keywords) and **TTS** (Google Cloud Text-to-Speech).

## Layout

| File | Purpose |
|------|--------|
| `chat_config.py` | Default weights, metric IDs, system prompt, `build_system_instruction()` |
| `rank.py` | `rank_locations()` – weighted score, lower-is-better for land_cost/disaster_risk |
| `weights.py` | `parse_weights_from_reply()` – extract and normalize weights from LLM reply |
| `keywords.py` | `parse_map_keywords_from_reply()`, `write_keywords_to_file()` |
| `chat.py` | `chat()` – one turn with Gemini, optional ranking, weights/keywords parsing |
| `tts.py` | `pcm_to_wav()`, `synthesize_tts()` – Google Cloud TTS → WAV base64 |
| `app.py` | FastAPI app: `POST /api/chat`, `POST /api/tts`, `GET /health` |
| `config.py` | Hardcoded API keys (replace with your keys) |

## Setup

From the **project root** (so `keywords_llm/` is created at root):

```bash
cd <project-root>
python -m venv .venv
.venv\Scripts\activate   # Windows
# or: source .venv/bin/activate  # Linux/Mac
pip install -r updatedBackend/requirements.txt
```

Edit `updatedBackend/config.py` and set your API keys, or set env vars: `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_CLOUD_TTS_API_KEY`.

## Run

From **project root**:

```bash
uvicorn updatedBackend.app:app --reload --port 8000
```

- **Chat:** `POST http://localhost:8000/api/chat`
- **TTS:** `POST http://localhost:8000/api/tts` with `{"text": "Hello"}`
- **Health:** `GET http://localhost:8000/health`

## Tests

```bash
python updatedBackend/test_backend.py
# or: pytest updatedBackend/test_backend.py -v
```

Install backend deps first (`pip install -r updatedBackend/requirements.txt`) for all tests; tests 1–5 need only stdlib + requests.
