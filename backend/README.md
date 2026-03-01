# FastAPI Census Backend

## Run locally

```bash
uv sync
uv run uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

## Endpoint

- `GET /api/census/by-point?lat=<LAT>&lon=<LON>&acs=latest&include_parents=true`

Example:

```bash
curl 'http://127.0.0.1:8000/api/census/by-point?lat=43.074&lon=-89.384'
```

## Frontend integration

Vite proxies `/api/*` requests to `http://127.0.0.1:8000` by default.

To override backend origin for dev:

```bash
VITE_FASTAPI_ORIGIN=http://127.0.0.1:8000 bun run dev
```
