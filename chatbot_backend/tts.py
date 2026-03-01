"""
PCM to WAV conversion and Google Cloud TTS client logic.

Uses the TTS REST API with an API key (no ADC required). Matches the
googletts.py demo: urllib, same payload, Chirp 3 HD Enceladus.
"""

import base64
import json
import struct
import urllib.error
import urllib.request
from typing import Any

VOICE_NAME = "en-US-Chirp3-HD-Enceladus"
VOICE_LANGUAGE = "en-US"
SPEAKING_RATE = 1.0
VOLUME_GAIN_DB = 0.0
SAMPLE_RATE_HZ = 44100
AUDIO_ENCODING = "LINEAR16"


def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    """Build a WAV file from raw PCM (16-bit mono)."""
    n = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + n,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        sample_rate * channels * 2,
        channels * 2,
        16,
        b"data",
        n,
    )
    return header + pcm


def synthesize_tts(api_key: str, text: str) -> dict[str, Any]:
    """
    Call Google Cloud TTS REST API with API key. Returns dict with
    'audioBase64' (WAV base64) and 'format': 'wav'.
    Raises ValueError on missing key or empty text; raises RuntimeError on API error.
    """
    if not api_key:
        raise ValueError("Missing GOOGLE_CLOUD_TTS_API_KEY")
    text = (text or "").strip()
    if not text:
        raise ValueError("text is required")

    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"
    body = {
        "input": {"text": text},
        "voice": {"languageCode": VOICE_LANGUAGE, "name": VOICE_NAME},
        "audioConfig": {
            "audioEncoding": AUDIO_ENCODING,
            "speakingRate": SPEAKING_RATE,
            "volumeGainDb": VOLUME_GAIN_DB,
            "sampleRateHertz": SAMPLE_RATE_HZ,
        },
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        try:
            err_json = json.loads(err_body)
            err = err_json.get("error") if isinstance(err_json, dict) else None
            if isinstance(err, dict):
                msg = err.get("message") or err_body
                for d in err.get("details") or []:
                    if isinstance(d, dict) and "activationUrl" in d:
                        msg = msg.rstrip() + "\n" + d.get("activationUrl", "")
                        break
            else:
                msg = err_body
        except Exception:
            msg = err_body
        raise RuntimeError(msg)

    b64 = result.get("audioContent")
    if not b64:
        raise RuntimeError("No audioContent in response")

    pcm = base64.b64decode(b64)
    wav = pcm_to_wav(pcm, SAMPLE_RATE_HZ, 1)
    wav_b64 = base64.b64encode(wav).decode("ascii")
    return {"audioBase64": wav_b64, "format": "wav"}
