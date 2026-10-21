"""NVIDIA ACE Audio2Face-3D client.

Sends 16-bit PCM audio to A2FControllerService.ProcessAudioStream and returns
ARKit blendshape frames. This is the facial-animation lineup: audio in,
lip and jaw weights out. A closed port or a missing key is reported as not
connected. Nothing here invents weights.
"""

from __future__ import annotations

import asyncio
import os
import re
import socket
import sys
from array import array
from io import BytesIO
from pathlib import Path

VENDOR = Path(__file__).resolve().parent / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

DEFAULT_ENDPOINT = "127.0.0.1:52000"
NVCF_ENDPOINT = "grpc.nvcf.nvidia.com:443"

FACE_PARAMETERS = {
    "upperFaceStrength": 1.0,
    "upperFaceSmoothing": 0.001,
    "lowerFaceStrength": 1.3,
    "lowerFaceSmoothing": 0.0023,
    "faceMaskLevel": 0.6,
    "faceMaskSoftness": 0.0085,
    "skinStrength": 1.0,
    "eyelidOpenOffset": 0.06,
    "lipOpenOffset": 0.0,
    "tongueStrength": 0.0,
    "tongueHeightOffset": 0.0,
    "tongueDepthOffset": 0.0,
}

NEUTRAL_EMOTION = {
    "amazement": 0.0,
    "anger": 0.0,
    "cheekiness": 0.0,
    "disgust": 0.0,
    "fear": 0.0,
    "grief": 0.0,
    "joy": 0.15,
    "outofbreath": 0.0,
    "pain": 0.0,
    "sadness": 0.0,
}


def _scrub(text: str) -> str:
    cleaned = re.sub(r"(?i)bearer\s+[A-Za-z0-9._\-]+", "Bearer [redacted]", text or "")
    cleaned = re.sub(r"\b(nvapi-|sk-|eyJ)[A-Za-z0-9._\-]+", "[redacted]", cleaned)
    return cleaned[:500]


def parse_endpoint(raw: str) -> tuple[str, int, bool]:
    text = (raw or "").strip()
    if not text:
        text = DEFAULT_ENDPOINT
    secure = "nvcf.nvidia.com" in text or text.startswith("grpcs://")
    for prefix in ("grpcs://", "grpc://", "https://", "http://"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
    text = text.strip("/")
    if ":" in text:
        host, port_text = text.rsplit(":", 1)
        try:
            port = int(port_text)
        except ValueError:
            host, port = text, 443 if secure else 52000
    else:
        host, port = text, 443 if secure else 52000
    return host or "127.0.0.1", port, secure


def _listening(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def library_ready() -> tuple[bool, str]:
    try:
        import grpc  # noqa: F401
        from nvidia_ace.services.a2f_controller.v1_pb2_grpc import A2FControllerServiceStub  # noqa: F401
    except Exception as exc:
        return False, _scrub(f"{type(exc).__name__}: {exc}")
    return True, ""


def endpoint_settings(settings: dict | None) -> dict:
    settings = settings or {}
    raw = str(settings.get("a2f_url") or os.environ.get("A2F_URL") or DEFAULT_ENDPOINT).strip()
    host, port, secure = parse_endpoint(raw)
    function_id = str(settings.get("a2f_function_id") or os.environ.get("A2F_FUNCTION_ID") or "").strip()
    key = str(settings.get("a2f_api_key") or os.environ.get("NGC_API_KEY") or os.environ.get("NVIDIA_API_KEY") or "").strip()
    return {
        "host": host,
        "port": port,
        "secure": secure,
        "function_id": function_id,
        "api_key": key,
    }


def ace_status(settings: dict | None, timeout: float = 0.4) -> dict:
    cfg = endpoint_settings(settings)
    ready, library_error = library_ready()
    listening = _listening(cfg["host"], cfg["port"], timeout) if ready else False
    if not ready:
        detail = "The Audio2Face-3D client could not be loaded, so audio cannot be sent. " + library_error
    elif cfg["secure"] and not (cfg["api_key"] and cfg["function_id"]):
        detail = "NVIDIA Cloud Functions needs an API key and an Audio2Face-3D function id in Setup. Audio has not been sent."
        listening = False
    elif not listening:
        detail = f"Nothing is listening for Audio2Face-3D at {cfg['host']}:{cfg['port']}. Audio has not been sent."
    else:
        detail = "Audio2Face-3D accepted a connection. Weights are applied only after a spoken line is sent and frames come back."
    return {
        "component": "Audio2Face-3D",
        "service": "A2FControllerService.ProcessAudioStream",
        "endpoint": f"{cfg['host']}:{cfg['port']}",
        "secure": cfg["secure"],
        "library": ready,
        "listening": listening,
        "connected": False,
        "key_set": bool(cfg["api_key"]),
        "function_id_set": bool(cfg["function_id"]),
        "function_id": cfg["function_id"],
        "detail": detail,
    }


def pcm16_mono(wav: bytes) -> tuple[int, bytes]:
    import wave

    with wave.open(BytesIO(wav), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError("Audio2Face-3D needs 16-bit PCM audio.")
    if channels == 2:
        samples = array("h")
        samples.frombytes(frames)
        if sys.byteorder != "little":
            samples.byteswap()
        mixed = array("h", ((samples[index] + samples[index + 1]) // 2 for index in range(0, len(samples) - 1, 2)))
        if sys.byteorder != "little":
            mixed.byteswap()
        frames = mixed.tobytes()
    elif channels != 1:
        raise ValueError("Audio2Face-3D needs mono audio.")
    if rate <= 0 or not frames:
        raise ValueError("The speech audio was empty.")
    max_samples = rate * 30
    sample_count = len(frames) // 2
    if sample_count > max_samples:
        frames = frames[: max_samples * 2]
    return rate, frames


async def animate_wav_async(wav: bytes, settings: dict | None) -> dict:
    status = ace_status(settings)
    if not status["library"] or not status["listening"]:
        return {"ok": False, "connected": False, "frames": [], "error": status["detail"]}
    try:
        rate, pcm = pcm16_mono(wav)
        frames = await asyncio.wait_for(_exchange(endpoint_settings(settings), rate, pcm), 30)
    except Exception as exc:
        return {"ok": False, "connected": False, "frames": [], "error": _scrub(str(exc)) or "Audio2Face-3D did not return face weights."}
    if not frames:
        return {
            "ok": False,
            "connected": False,
            "frames": [],
            "error": "Audio2Face-3D returned no blendshape frames.",
        }
    return {"ok": True, "connected": True, "frames": frames, "error": ""}


def animate_wav(wav: bytes, settings: dict | None) -> dict:
    return asyncio.run(animate_wav_async(wav, settings))


def clip_wav(wav: bytes, seconds: float = 4.0) -> bytes:
    import wave

    with wave.open(BytesIO(wav), "rb") as source:
        rate = source.getframerate() or 1
        frames = source.readframes(max(1, int(rate * seconds)))
        channels = source.getnchannels()
        width = source.getsampwidth()
    out = BytesIO()
    with wave.open(out, "wb") as dest:
        dest.setnchannels(channels)
        dest.setsampwidth(width)
        dest.setframerate(rate)
        dest.writeframes(frames)
    return out.getvalue()


def face_motion_summary(frames: list | None) -> dict:
    peaks: dict[str, float] = {}
    duration = 0.0
    for frame in frames or []:
        if not isinstance(frame, dict):
            continue
        try:
            duration = max(duration, float(frame.get("time") or 0))
        except (TypeError, ValueError):
            pass
        weights = frame.get("weights") or {}
        if not isinstance(weights, dict):
            continue
        for name, value in weights.items():
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            key = str(name)
            peaks[key] = max(peaks.get(key, 0.0), number)
    mouth = {
        name: value
        for name, value in peaks.items()
        if any(hint in name.lower() for hint in ("jaw", "mouth", "viseme"))
    }
    strongest = max(mouth, key=mouth.get) if mouth else ""
    peak = mouth.get(strongest, 0.0) if strongest else 0.0
    count = len(frames or [])
    return {
        "frames": count,
        "duration": round(duration, 2),
        "strongest": strongest,
        "peak": round(peak, 2),
        "moved": count >= 2 and peak >= 0.08,
    }


async def _exchange(cfg: dict, rate: int, pcm: bytes) -> list[dict]:
    import grpc
    from nvidia_ace.a2f.v1_pb2 import (
        AudioWithEmotion,
        BlendShapeParameters,
        EmotionPostProcessingParameters,
        FaceParameters,
    )
    from nvidia_ace.audio.v1_pb2 import AudioHeader
    from nvidia_ace.controller.v1_pb2 import AudioStream, AudioStreamHeader
    from nvidia_ace.emotion_with_timecode.v1_pb2 import EmotionWithTimeCode
    from nvidia_ace.services.a2f_controller.v1_pb2_grpc import A2FControllerServiceStub

    target = f"{cfg['host']}:{cfg['port']}"
    options = [("grpc.max_receive_message_length", 32 * 1024 * 1024)]
    if cfg["secure"]:
        metadata = [("function-id", cfg["function_id"]), ("authorization", "Bearer " + cfg["api_key"])]

        def _metadata(context, callback):
            callback(metadata, None)

        credentials = grpc.composite_channel_credentials(
            grpc.ssl_channel_credentials(),
            grpc.metadata_call_credentials(_metadata),
        )
        channel = grpc.aio.secure_channel(target, credentials, options=options)
    else:
        channel = grpc.aio.insecure_channel(target, options=options)
    try:
        stub = A2FControllerServiceStub(channel)
        call = stub.ProcessAudioStream()
        reader = asyncio.create_task(_read_frames(call))
        try:
            await _write_audio(call, AudioStream, AudioStreamHeader, AudioHeader, AudioWithEmotion, EmotionWithTimeCode, FaceParameters, EmotionPostProcessingParameters, BlendShapeParameters, rate, pcm)
        except Exception:
            reader.cancel()
            raise
        frames = await asyncio.wait_for(reader, 25)
        return frames
    finally:
        await channel.close()


async def _write_audio(call, AudioStream, AudioStreamHeader, AudioHeader, AudioWithEmotion, EmotionWithTimeCode, FaceParameters, EmotionPostProcessingParameters, BlendShapeParameters, rate, pcm):
    header = AudioStream(
        audio_stream_header=AudioStreamHeader(
            audio_header=AudioHeader(
                samples_per_second=rate,
                bits_per_sample=16,
                channel_count=1,
                audio_format=AudioHeader.AUDIO_FORMAT_PCM,
            ),
            face_params=FaceParameters(float_params=FACE_PARAMETERS),
            emotion_post_processing_params=EmotionPostProcessingParameters(
                emotion_contrast=1.0,
                live_blend_coef=0.7,
                enable_preferred_emotion=False,
                preferred_emotion_strength=0.5,
                emotion_strength=0.45,
                max_emotions=3,
            ),
            blendshape_params=BlendShapeParameters(),
        )
    )
    await call.write(header)
    emotion = [EmotionWithTimeCode(emotion=NEUTRAL_EMOTION, time_code=0.0)]
    chunk_size = max(2, rate * 2)
    for index in range(0, len(pcm), chunk_size):
        chunk = pcm[index : index + chunk_size]
        message = AudioWithEmotion(audio_buffer=chunk)
        if index == 0:
            message.emotions.extend(emotion)
        await call.write(AudioStream(audio_with_emotion=message))
    await call.write(AudioStream(end_of_audio=AudioStream.EndOfAudio()))


async def _read_frames(call) -> list[dict]:
    import grpc

    names: list[str] = []
    frames: list[dict] = []
    while True:
        message = await call.read()
        if message == grpc.aio.EOF:
            return frames
        if message.HasField("animation_data_stream_header"):
            header = message.animation_data_stream_header
            names = list(header.skel_animation_header.blend_shapes)
        elif message.HasField("animation_data"):
            for blend in message.animation_data.skel_animation.blend_shape_weights:
                weights = {name: float(value) for name, value in zip(names, blend.values)}
                frames.append({"time": float(blend.time_code), "weights": weights})
                if len(frames) >= 2400:
                    return frames
        elif message.HasField("status") and message.status.code not in (0,):
            if frames:
                return frames
            raise RuntimeError(message.status.message or "Audio2Face-3D failed")
