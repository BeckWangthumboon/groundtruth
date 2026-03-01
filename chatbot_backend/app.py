"""
FastAPI app: /api/chat and /api/tts endpoints.
Run standalone: uvicorn chatbot_backend.app:app --reload
Also exposes chat_router for mounting in backend.app.main.
"""

from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

try:
    from .config import GOOGLE_CLOUD_TTS_API_KEY
    from .chat import chat
    from .tts import synthesize_tts
except ImportError:
    from config import GOOGLE_CLOUD_TTS_API_KEY
    from chat import chat
    from tts import synthesize_tts

chat_router = APIRouter(prefix="", tags=["chat"])


# --- Request/Response models ---

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequestBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    message: str
    conversationHistory: list[ChatMessage] = Field(default_factory=list, alias="conversationHistory")
    focus: str  # "tenant" | "small_business"
    weights: dict[str, float] | None = None
    useDefaults: bool = Field(True, alias="useDefaults")
    locationsWithMetrics: list[dict] | None = Field(None, alias="locationsWithMetrics")


class ChatResponseBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    reply: str
    weights: dict[str, float] | None = None
    rankedIds: list[str] | None = Field(None, alias="rankedIds")
    mapKeywords: list[str] | None = Field(None, alias="mapKeywords")


class TTSRequestBody(BaseModel):
    text: str | None = None


# --- Routes ---

@chat_router.post("/api/chat", response_model=ChatResponseBody)
def post_chat(body: ChatRequestBody) -> dict[str, Any]:
    """Chat with the location assistant (Gemini)."""
    try:
        result = chat(
            message=body.message,
            conversation_history=[{"role": m.role, "content": m.content} for m in body.conversationHistory],
            focus=body.focus,
            weights=body.weights,
            use_defaults=body.useDefaults,
            locations_with_metrics=body.locationsWithMetrics,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@chat_router.post("/api/tts")
def post_tts(body: TTSRequestBody) -> dict[str, Any]:
    """Text-to-speech via Google Cloud TTS. Returns { audioBase64, format }."""
    try:
        result = synthesize_tts(GOOGLE_CLOUD_TTS_API_KEY or "", body.text or "")
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@chat_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Standalone app (for uvicorn chatbot_backend.app:app)
app = FastAPI(title="Location Assistant API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat_router)
