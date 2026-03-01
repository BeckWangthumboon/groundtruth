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

### Layout: right-side slide panel

- **Mirror the left census panel** — Same visual language as the existing left bar: glass-style panel (`census-panel`-like: rounded corners, border, backdrop blur, dark fill), header with title and optional subtitle, divider, scrollable body. Use the same BEM-style class pattern and existing design tokens so it feels like one system.
- **Position on the right** — Panel is anchored to the right edge of the map (e.g. `right: 0`; left panel uses `left: 0`). It slides in from the right when open and slides out when collapsed, leaving a narrow strip and a **toggle button** on the left edge of the strip (chevron: right when collapsed to expand, left when expanded to collapse). Reuse the same interaction pattern as the census panel (anchor + shell + toggle + `--collapsed` / `--hidden`).
- **Bot window** — The main content area inside the panel is the **assistant window**: a scrollable conversation thread (user + assistant messages) and a fixed input at the bottom for the user to type. This is the only place the user interacts with the bot.

### Voice agent

- **Toggle button** — A control (e.g. in the panel header or next to the message input) to **enable the voice agent**. When enabled, after each assistant text reply the app calls `/api/tts` with that reply and plays the returned audio (e.g. via an `Audio` element and base64 data URL). When disabled, replies are text-only. The button should clearly indicate on/off (e.g. icon + label or aria-label).

### AI components (no Tailwind)

- **Reasoning / “thinking”** — For models that stream reasoning (e.g. extended thinking), use a pattern similar to [Reasoning \| AI SDK Elements](https://elements.ai-sdk.dev/components/reasoning): a collapsible block with a trigger and content area that shows the reasoning text, opens automatically while streaming and can close when done. Implement with plain CSS and existing BEM-style classes (no Tailwind). If the backend ever streams reasoning as a separate part, the frontend can show it in this block; otherwise it stays optional.
- **Messages** — Render user and assistant messages in the conversation (e.g. distinct bubbles or blocks). Assistant messages can include the optional reasoning block above and the main reply text below. Use the same typography and color tokens as the rest of the app for consistency.

## Purpose, Main
1. give a reason out why the certain score is what it is.
2. Provide feedback on the comparing several locations, based on the given data, specifically, distance to the transportation, safety, distance to the desired location or the places that the user access oftenly, etc.