"""Local meeting-avatar server. The camera feed is the headshot, not the full body."""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .a2f_client import ace_status, animate_wav_async, clip_wav, face_motion_summary
from .persona_engine import VERSION, PersonaStore

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
ASSETS = Path(os.environ.get("ASSETS_DIR", ROOT / "assets"))
FRONTEND = Path(os.environ.get("FRONTEND_DIR", ROOT / "frontend"))
HEADSHOT = "Chan_Headshot.glb"

store = PersonaStore(DATA)
app = FastAPI(title="Chan meeting avatar", version=VERSION)


class PersonaIn(BaseModel):
    name: str | None = None
    role: str | None = None
    company: str | None = None
    style: str | None = None
    priorities: list[str] | None = None
    expertise: list[str] | None = None
    avoid: list[str] | None = None
    catchphrases: list[str] | None = None
    answer_examples: list[dict] | None = None
    question_examples: list[dict] | None = None
    notes: list[str] | None = None
    address_cues: list[str] | None = None
    intro: str | None = None
    voice: str | None = None
    voice_tone: str | None = None
    xai_custom_voice_id: str | None = None
    xai_voice_name: str | None = None


class TrainIn(BaseModel):
    transcript: str = ""


class RespondIn(BaseModel):
    latest: str = ""
    history: list[dict] = Field(default_factory=list)
    intent: str = "both"
    force: bool = False


class TtsIn(BaseModel):
    text: str = ""
    voice: str | None = None
    verbatim: bool = False


class SettingsIn(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    clear_key: bool = False
    xai_api_key: str | None = None
    clear_xai_key: bool = False
    a2f_url: str | None = None
    a2f_function_id: str | None = None
    a2f_api_key: str | None = None
    clear_a2f_key: bool = False


class VoiceIdIn(BaseModel):
    voice_id: str = ""


class TurnIn(BaseModel):
    who: str = "room"
    text: str = ""
    answer: str = ""
    question: str = ""


_clone_block = ""
_clone_next = 0.0


@app.get("/api/health")
def health():
    global _clone_block, _clone_next
    now = time.monotonic()
    if not store.load().get("xai_custom_voice_id") and now >= _clone_next:
        _clone_next = now + 30
        try:
            store.adopt_account_voice()
        except RuntimeError:
            pass
        if store.load().get("xai_custom_voice_id"):
            _clone_block = ""
        elif not _clone_block:
            try:
                store.clone_reference_if_needed()
            except RuntimeError as exc:
                message = str(exc)
                if "reach" not in message.lower():
                    _clone_block = message
    elif store.load().get("xai_custom_voice_id"):
        _clone_block = ""
    status = store.public_llm_status()
    if _clone_block:
        status["voice_clone"] = _clone_block
    return _with_runtime(status)


@app.get("/api/persona")
def get_persona():
    return store.load()


@app.put("/api/persona")
def put_persona(body: PersonaIn):
    current = store.load()
    incoming = body.model_dump(exclude_unset=True)
    current.update(incoming)
    return store.save(current)


@app.post("/api/train")
def train(body: TrainIn):
    return store.train(body.transcript)


@app.post("/api/respond")
def respond(body: RespondIn):
    return store.respond(body.latest, body.history, body.intent, body.force)


@app.post("/api/tts")
def tts(body: TtsIn):
    result = store.synthesize(body.text, body.voice or store.load().get("voice"), body.verbatim)
    if not result:
        return JSONResponse({
            "ok": False,
            "fallback": "browser",
            "error": store.last_speech_error or "Speech could not be generated.",
        })
    audio, media_type, engine = result
    return Response(content=audio, media_type=media_type, headers={"X-Avatar-Voice": engine})


@app.post("/api/voice/clone")
async def clone_voice(file: UploadFile = File(...), tone: str = Form("professional")):
    payload = await file.read()
    try:
        return store.clone_voice(payload, file.filename or "voice.wav", file.content_type or "application/octet-stream", tone)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None


@app.post("/api/voice/select")
def select_voice(body: VoiceIdIn):
    try:
        return store.adopt_voice(body.voice_id)
    except RuntimeError as exc:
        status = 400 if "voice id" in str(exc).lower() or "no xai" in str(exc).lower() else 502
        raise HTTPException(status_code=status, detail=str(exc)) from None


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not store.openai_key():
        raise HTTPException(status_code=409, detail="No transcription key is configured.")
    payload = await file.read()
    try:
        text = store.transcribe(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return {"text": text}


def _with_runtime(status: dict) -> dict:
    status["ok"] = True
    status["avatar"] = HEADSHOT
    status["full_body_loaded"] = False
    status["tts_verbatim"] = True
    status["ace"] = ace_status(store.load_settings())
    return status


@app.post("/api/a2f")
async def a2f(request: Request):
    wav = await request.body()
    if len(wav) < 44:
        return {"ok": False, "connected": False, "frames": [], "error": "Send the speech wav from /api/tts."}
    return await animate_wav_async(wav, store.load_settings())


def _test_speech() -> bytes | None:
    sample = DATA / "chan-voice.wav"
    if sample.exists() and sample.stat().st_size > 44:
        return clip_wav(sample.read_bytes(), 4.0)
    spoken = store.synthesize(
        "Hello. The mouth follows these words until Audio2Face is running.",
        store.load().get("voice"),
        True,
    )
    if not spoken:
        return None
    return clip_wav(spoken[0], 4.0)


@app.post("/api/a2f/test")
async def a2f_test():
    settings = store.load_settings()
    status = ace_status(settings)
    empty = face_motion_summary([])
    if not status["library"] or not status["listening"]:
        spoken = _test_speech()
        payload = {"ok": False, "connected": False, "frames": [], "error": status["detail"], "summary": empty}
        if spoken:
            payload["wav_base64"] = base64.b64encode(spoken).decode("ascii")
            payload["summary"] = {**empty, "source": "a short spoken line"}
        return payload
    sample = DATA / "chan-voice.wav"
    source = "your saved voice sample"
    if sample.exists() and sample.stat().st_size > 44:
        wav = clip_wav(sample.read_bytes(), 4.0)
    else:
        spoken = store.synthesize(
            "Hello. This is an Audio2Face test. The mouth should open with these words.",
            store.load().get("voice"),
            True,
        )
        if not spoken:
            return {
                "ok": False,
                "connected": False,
                "frames": [],
                "error": "No voice sample is on this machine, and speech could not make one, so Audio2Face was not tested.",
                "summary": empty,
            }
        wav = clip_wav(spoken[0], 4.0)
        source = "a short spoken line"
    outcome = await animate_wav_async(wav, settings)
    summary = face_motion_summary(outcome.get("frames") or [])
    summary["source"] = source
    outcome["summary"] = summary
    if outcome.get("ok") and not summary["moved"]:
        outcome["ok"] = False
        outcome["error"] = "Audio2Face answered, but the mouth weights stayed closed, so the face was not driven."
    if outcome.get("ok"):
        outcome["wav_base64"] = base64.b64encode(wav).decode("ascii")
    return outcome


@app.get("/api/settings")
def get_settings():
    return _with_runtime(store.public_llm_status())


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    status = store.save_settings(body.model_dump(exclude_unset=True))
    return _with_runtime(status)


@app.post("/api/sessions")
def start_session():
    session_id = uuid.uuid4().hex[:12]
    path = DATA / "sessions" / f"{session_id}.jsonl"
    path.write_text("")
    return {"id": session_id}


@app.post("/api/sessions/{session_id}/turns")
def add_turn(session_id: str, body: TurnIn):
    if not session_id.isalnum():
        raise HTTPException(status_code=400, detail="Bad session id.")
    path = DATA / "sessions" / f"{session_id}.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found.")
    line = json.dumps(
        {
            "who": body.who[:40],
            "text": body.text[:4000],
            "answer": body.answer[:2000],
            "question": body.question[:500],
        }
    )
    with path.open("a") as handle:
        handle.write(line + "\n")
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/camera")
def camera():
    return FileResponse(FRONTEND / "camera.html")


app.mount("/vendor", StaticFiles(directory=FRONTEND / "vendor"), name="vendor")
app.mount("/js", StaticFiles(directory=FRONTEND / "js"), name="js")
app.mount("/css", StaticFiles(directory=FRONTEND / "css"), name="css")
app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")
