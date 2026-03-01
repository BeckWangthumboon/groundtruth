# FastAPI Backend (Census + optional Chat/TTS)

Single API served by `backend.app.main`. When chatbot dependencies are installed and `chatbot_backend` is importable, the same process also serves:

- `POST /api/chat` – location assistant (Gemini)
- `POST /api/tts` – text-to-speech (Google Cloud TTS)
- `GET /health` – chatbot health (main app uses `GET /healthz`)

## Run locally

```bash
uv sync
uv run uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

With `npm run dev`, the API runs automatically (port 8000); Vite proxies `/api` to it.

## Endpoints (Census)

- `GET /healthz`
- `GET /api/census/by-point?lat=<LAT>&lon=<LON>&acs=latest&include_parents=true`
- `GET /api/pois/nearby?lat=&lon=&radius_m=800`
- `GET /api/pois/dynamic?lat=&lon=&selected_labels=essentials_nearby,transit_access&radius_m=1200&include_nodes=true`
  - If `selected_labels` includes `direct_competition`, include `business_type=<type>`.
- `GET /api/census/tract-geo?lat=&lon=`

## Endpoints (Chat, when chatbot_backend is available)

- `GET /health`
- `POST /api/chat` – body: `{ message, conversationHistory, focus, useDefaults, ... }`
- `POST /api/tts` – body: `{ text }`

Set `GOOGLE_GENERATIVE_AI_API_KEY` and `GOOGLE_CLOUD_TTS_API_KEY` for chat/TTS.

## Frontend integration

Vite proxies `/api/*` requests to `http://127.0.0.1:8000` by default.

To override backend origin for dev:

```bash
VITE_FASTAPI_ORIGIN=http://127.0.0.1:8000 bun run dev
```
