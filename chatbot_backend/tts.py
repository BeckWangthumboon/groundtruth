"""
PCM to WAV conversion and Google Cloud TTS client logic.
"""

import base64
import struct
from typing import Any

VOICE_NAME = "en-US-Chirp3-HD-Enceladus"
VOICE_LANGUAGE = "en-US"
SPEAKING_RATE = 1.15
VOLUME_GAIN_DB = 0.0
SAMPLE_RATE_HZ = 44100
AUDIO_ENCODING = "LINEAR16"


def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    """Build a WAV file from raw PCM (16-bit mono)."""
    n = len(pcm)
    # RIFF header: 44 bytes
    header = bytearray(44)
    off = 0
    header[off:off+4] = b"RIFF"
    off += 4
    struct.pack_into("<I", header, off, 36 + n)
    off += 4
    header[off:off+4] = b"WAVE"
    off += 4
    header[off:off+4] = b"fmt "
    off += 4
    struct.pack_into("<I", header, off, 16)
    off += 4
    struct.pack_into("<H", header, off, 1)  # PCM
    off += 2
    struct.pack_into("<H", header, off, channels)
    off += 2
    struct.pack_into("<I", header, off, sample_rate)
    off += 4
    struct.pack_into("<I", header, off, sample_rate * channels * 2)
    off += 4
    struct.pack_into("<H", header, off, channels * 2)
    off += 2
    struct.pack_into("<H", header, off, 16)
    off += 2
    header[off:off+4] = b"data"
    off += 4
    struct.pack_into("<I", header, off, n)
    return bytes(header) + pcm


def synthesize_tts(api_key: str, text: str) -> dict[str, Any]:
    """
    Call Google Cloud TTS API. Returns dict with 'audioBase64' (WAV base64) and 'format': 'wav'.
    Raises ValueError on missing key or empty text; raises RuntimeError on API error.
    """
    if not api_key:
        raise ValueError("Missing GOOGLE_CLOUD_TTS_API_KEY")
    text = (text or "").strip()
    if not text:
        raise ValueError("text is required")

    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"
    payload = {
        "input": {"text": text},
        "voice": {"languageCode": VOICE_LANGUAGE, "name": VOICE_NAME},
        "audioConfig": {
            "audioEncoding": AUDIO_ENCODING,
            "speakingRate": SPEAKING_RATE,
            "volumeGainDb": VOLUME_GAIN_DB,
            "sampleRateHertz": SAMPLE_RATE_HZ,
        },
    }

    import requests
    resp = requests.post(
        url,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    if not resp.ok:
        err_msg = resp.text or resp.reason
        try:
            data = resp.json()
            err = data.get("error") if isinstance(data, dict) else None
            if isinstance(err, dict):
                err_msg = err.get("message") or err_msg
                for d in err.get("details") or []:
                    if not isinstance(d, dict):
                        continue
                    if "activationUrl" in d:
                        err_msg = err_msg.rstrip() + "\n" + d.get("activationUrl", "")
                        break
                    links = d.get("links")
                    if links and isinstance(links, list) and links[0].get("url"):
                        err_msg = err_msg.rstrip() + "\n" + links[0].get("url", "")
                        break
        except Exception:
            pass
        raise RuntimeError(err_msg)

    data = resp.json()
    b64 = data.get("audioContent")
    if not b64:
        raise RuntimeError("No audioContent in response")

    pcm = base64.b64decode(b64)
    wav = pcm_to_wav(pcm, SAMPLE_RATE_HZ, 1)
    wav_b64 = base64.b64encode(wav).decode("ascii")
    return {"audioBase64": wav_b64, "format": "wav"}
