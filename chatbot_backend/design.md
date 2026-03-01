# Chatbot Backend — Design

## Overview

Location Assistant API: a FastAPI service that powers conversational location discovery and text-to-speech. It can run standalone or be mounted into the main **Groundtruth Census API** (`backend.app.main`).

## Components

- **Chat** — Gemini-based conversation with focus modes (`tenant` | `small_business`), configurable metric weights, optional location ranking, and extraction of map keywords and ranked location IDs from replies.
- **TTS** — Google Cloud Text-to-Speech; returns base64 audio and format for playback.

## API

| Endpoint       | Method | Purpose |
|----------------|--------|--------|
| `/api/chat`    | POST   | Send message + conversation history; get reply, optional `weights`, `rankedIds`, `mapKeywords`. |
| `/api/tts`     | POST   | Synthesize speech from text; returns `audioBase64`, `format`. |
| `/health`      | GET    | Liveness check. |

## Integration

When the main backend runs, it imports and mounts `chat_router` from `chatbot_backend.app`, so the same process serves Census/POI endpoints and the chat/TTS endpoints. Standalone: `uvicorn chatbot_backend.app:app --reload`.

## UI Design

## Purpose, Main
1. give a reason out why the certain score is what it is.
2. Provide feedback on the comparing several locations, based on the given data, specifically, distance to the transportation, safety, distance to the desired location or the places that the user access oftenly, etc.