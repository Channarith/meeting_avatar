import { AvatarStage } from "./avatar.js?v=singfeel2";

const $ = (id) => document.getElementById(id);
const stage = new AvatarStage($("stage"), { broadcast: "send" });
const state = {
  persona: null,
  history: [],
  live: false,
  speaking: false,
  sessionId: null,
  lastSpoken: "",
  lastSpokenAt: 0,
  ear: null,
  recognition: null,
  health: null,
  audio: new Audio(),
  warned: false,
};

stage.onReady = (info) => {
  $("yaw").value = String(Math.round(info.yawDegrees));
  $("crop").value = String(Math.round(info.crop * 100));
  $("model-note").textContent = info.note;
};
stage.onView = (info) => {
  $("crop").value = String(Math.round(info.crop * 100));
};
stage.start();

$("yaw").addEventListener("input", () => {
  stage.setYaw((Number($("yaw").value) * Math.PI) / 180);
});
$("crop").addEventListener("input", () => {
  stage.setCrop(Number($("crop").value) / 100);
});
$("popout").addEventListener("click", () => {
  window.open("/camera", "chan-camera", "width=1280,height=720");
});
$("fullscreen").addEventListener("click", () => {
  const node = $("stage");
  if (document.fullscreenElement) document.exitFullscreen();
  else node.requestFullscreen();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-on", item === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-on", panel.id === tab.dataset.tab);
    });
  });
});

$("platform").addEventListener("change", () => {
  $("platform-label").textContent = $("platform").value;
});
$("open-meeting").addEventListener("click", () => {
  const url = $("meeting-url").value.trim();
  if (!/^https?:\/\//i.test(url)) {
    toast("Paste a full meeting link.");
    return;
  }
  window.open(url, "_blank", "noopener");
});

$("go-live").addEventListener("click", goLive);
$("stop-live").addEventListener("click", stopLive);
$("draft").addEventListener("click", () => draft($("heard").value, true));
$("speak-answer").addEventListener("click", () => speak($("answer").value, "answer"));
$("speak-question").addEventListener("click", () => speak($("question").value, "question"));
$("speak-exact").addEventListener("click", () => speak($("exact").value, "exact"));
$("sing-song").addEventListener("click", singSong);
$("stop-song").addEventListener("click", stopSong);
$("song-file").addEventListener("change", () => {
  state.songPause = null;
  syncSongButton();
  const file = $("song-file").files[0];
  $("song-note").textContent = file ? `${file.name} is ready. It plays from the start.` : "";
});
document.addEventListener("pointerdown", () => state.audioContext?.resume());
$("raise-hand").addEventListener("click", () => {
  const raised = window.localStorage.getItem("avatar-hand") !== "1";
  stage.setHand(raised);
  syncHandButton();
});
$("save-persona").addEventListener("click", savePersona);
$("record-voice").addEventListener("click", toggleRecording);
$("clone-voice").addEventListener("click", cloneVoice);
$("use-voice-id").addEventListener("click", useVoiceId);
$("train-btn").addEventListener("click", trainFromText);
$("rehearse-btn").addEventListener("click", rehearse);
$("add-answer").addEventListener("click", () => addAnswer());
$("add-question").addEventListener("click", () => addQuestion());
$("add-note").addEventListener("click", addNote);
$("save-settings").addEventListener("click", () => saveSettings());
$("test-a2f").addEventListener("click", testAudio2Face);
$("heard").addEventListener("keydown", (event) => {
  if (event.key === "Enter") draft($("heard").value, true);
});
$("exact").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    speak($("exact").value, "exact");
  }
});
$("answer").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    speak($("answer").value, "answer");
  }
});

init();

async function init() {
  syncHandButton();
  try {
    state.health = await api("/api/health");
    $("version").textContent = state.health.version || "";
    renderLlm();
    fillVoices(state.health.voices || []);
    state.persona = await api("/api/persona");
    fillPersona();
    await refreshDevices();
  } catch (error) {
    toast(error.message);
  }
}

function renderLlm() {
  const health = state.health || {};
  const model = health.configured
    ? `${health.provider} · ${health.model} (${health.source})`
    : "No language model is configured, so replies stay on what you have trained.";
  const ears = health.transcribe
    ? "Selected-mic transcription is available."
    : "Selected-mic transcription needs an OpenAI key. Browser dictation will be used instead.";
  const voice = health.custom_voice_id
    ? "Speech uses your xAI voice from the recording."
    : health.tts === "xai"
      ? "Speech uses Rex until your recording is saved as an xAI custom voice."
      : health.tts === "say"
        ? "Speech uses a male Mac voice until an xAI key is set."
        : "Speech uses the browser voice until an xAI key is set.";
  $("llm-status").textContent = `${model} ${ears} ${voice}`;
  renderVoiceNote();
  renderAce();
  $("listen-mode").textContent = ears;
}

function renderAce() {
  const node = $("ace-status");
  if (!node) return;
  const ace = state.health?.ace;
  if (!ace) {
    node.textContent = "This server does not expose Audio2Face yet. Restart it, then set the endpoint below. The local NIM listens on 127.0.0.1:52000.";
    return;
  }
  node.textContent = ace.detail;
  const endpoint = $("s-a2f");
  if (endpoint && !endpoint.dataset.filled && ace.endpoint) {
    endpoint.value = ace.endpoint;
    endpoint.dataset.filled = "1";
  }
  const functionId = $("s-a2f-fn");
  if (functionId && !functionId.dataset.filled && ace.function_id) {
    functionId.value = ace.function_id;
    functionId.dataset.filled = "1";
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  fillDeviceSelect($("mic"), devices.filter((device) => device.kind === "audioinput"), "System default");
  fillDeviceSelect($("speaker"), devices.filter((device) => device.kind === "audiooutput"), "System output");
}

function fillDeviceSelect(select, devices, fallback) {
  const current = select.value;
  select.innerHTML = `<option value="">${fallback}</option>`;
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Device ${index + 1}`;
    select.appendChild(option);
  });
  if (current) select.value = current;
}

function fillVoices(voices) {
  const select = $("p-voice");
  const current = state.persona?.voice || select.value;
  select.innerHTML = "";
  const source = voices && voices.length ? voices : [{ id: "rex", label: "Rex · male, confident and clear" }];
  source.forEach((voice) => {
    const option = document.createElement("option");
    option.value = typeof voice === "string" ? voice : voice.id;
    option.textContent = typeof voice === "string" ? voice : voice.label;
    select.appendChild(option);
  });
  if (current) select.value = current;
}

function renderVoiceNote() {
  const note = $("voice-note");
  const speakNote = $("speak-voice");
  const health = state.health || {};
  const persona = state.persona || {};
  let text = "Rex speaks until your recording is saved as an xAI custom voice.";
  if (health.tts !== "xai") {
    text = "Add an xAI API key in Setup. Until then, a male Mac voice speaks if one is installed.";
  } else if ($("p-voice")?.value === "leo") {
    text = "Speak into the meeting uses Leo.";
  } else if (persona.xai_custom_voice_id || health.custom_voice_id) {
    text = "Speak into the meeting uses your xAI voice from the recording.";
  } else if (health.voice_clone) {
    text = health.voice_clone;
  }
  if (note) note.textContent = text;
  if (speakNote) speakNote.textContent = text;
}

function voiceForSpeech() {
  const selected = $("p-voice")?.value || state.persona?.voice || "";
  const custom = state.persona?.xai_custom_voice_id || state.health?.custom_voice_id || "";
  if (selected === "leo") return "leo";
  if (custom) return custom;
  return selected;
}

function fillPersona() {
  const persona = state.persona;
  $("p-name").value = persona.name || "";
  $("p-role").value = persona.role || "";
  $("p-company").value = persona.company || "";
  $("p-style").value = persona.style || "";
  $("p-priorities").value = (persona.priorities || []).join("\n");
  $("p-expertise").value = (persona.expertise || []).join("\n");
  $("p-avoid").value = (persona.avoid || []).join("\n");
  $("p-phrases").value = (persona.catchphrases || []).join("\n");
  $("p-cues").value = (persona.address_cues || []).join(", ");
  $("p-intro").value = persona.intro || "";
  if (persona.voice) $("p-voice").value = persona.voice;
  if (persona.voice_tone) $("voice-tone").value = persona.voice_tone;
  renderVoiceNote();
  renderExamples();
}

function readPersona() {
  const lines = (id) =>
    $(id).value.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    ...state.persona,
    name: $("p-name").value.trim(),
    role: $("p-role").value.trim(),
    company: $("p-company").value.trim(),
    style: $("p-style").value.trim(),
    priorities: lines("p-priorities"),
    expertise: lines("p-expertise"),
    avoid: lines("p-avoid"),
    catchphrases: lines("p-phrases"),
    address_cues: $("p-cues").value.split(",").map((item) => item.trim()).filter(Boolean),
    intro: $("p-intro").value.trim(),
    voice: $("p-voice").value,
    voice_tone: $("voice-tone").value,
    answer_examples: collectExamples("answers", "situation", "answer"),
    question_examples: collectExamples("questions", "context", "question"),
    notes: [...$("notes").querySelectorAll("[data-note]")].map((node) => node.dataset.note),
  };
}

function renderExamples() {
  const answers = $("answers");
  const questions = $("questions");
  const notes = $("notes");
  answers.innerHTML = "";
  questions.innerHTML = "";
  notes.innerHTML = "";
  (state.persona.answer_examples || []).forEach((row) => addAnswer(row.situation, row.answer));
  (state.persona.question_examples || []).forEach((row) => addQuestion(row.context, row.question));
  (state.persona.notes || []).forEach((note) => appendNote(note));
}

function addAnswer(situation = "", answer = "") {
  $("answers").appendChild(exampleRow("When they say", situation, "You say", answer, "situation", "answer"));
}
function addQuestion(context = "", question = "") {
  $("questions").appendChild(exampleRow("In this situation", context, "You ask", question, "context", "question"));
}
function exampleRow(labelA, valueA, labelB, valueB, keyA, keyB) {
  const wrap = document.createElement("div");
  wrap.className = "example";
  wrap.innerHTML = `
    <div>
      <label class="field"><span>${labelA}</span><input data-key="${keyA}" value="${escapeAttr(valueA)}"></label>
      <label class="field"><span>${labelB}</span><input data-key="${keyB}" value="${escapeAttr(valueB)}"></label>
    </div>`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-quiet";
  button.textContent = "Remove";
  button.addEventListener("click", () => wrap.remove());
  wrap.appendChild(button);
  return wrap;
}
function collectExamples(id, keyA, keyB) {
  return [...$(id).querySelectorAll(".example")].map((row) => ({
    [keyA]: row.querySelector(`[data-key="${keyA}"]`).value.trim(),
    [keyB]: row.querySelector(`[data-key="${keyB}"]`).value.trim(),
  })).filter((row) => row[keyB]);
}
function addNote() {
  const text = $("note-draft").value.trim();
  if (!text) return;
  appendNote(text);
  $("note-draft").value = "";
}
function appendNote(text) {
  const row = document.createElement("div");
  row.className = "example";
  row.dataset.note = text;
  const para = document.createElement("p");
  para.className = "hint";
  para.textContent = text;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-quiet";
  button.textContent = "Remove";
  button.addEventListener("click", () => row.remove());
  row.append(para, button);
  $("notes").appendChild(row);
}

async function savePersona() {
  try {
    state.persona = await api("/api/persona", { method: "PUT", body: JSON.stringify(readPersona()) });
    fillPersona();
    trainToast("Profile saved.");
  } catch (error) {
    trainToast(error.message);
  }
}

async function trainFromText() {
  const transcript = $("transcript").value.trim();
  if (!transcript) {
    trainToast("Paste something you actually said.");
    return;
  }
  trainToast("Training…");
  try {
    const result = await api("/api/train", { method: "POST", body: JSON.stringify({ transcript }) });
    state.persona = result.persona;
    fillPersona();
    const added = result.added || {};
    const warning = result.warning ? ` ${result.warning}` : "";
    trainToast(`Added ${added.answers || 0} answers and ${added.questions || 0} questions.${warning}`);
  } catch (error) {
    trainToast(error.message);
  }
}

async function rehearse() {
  const latest = $("rehearse").value.trim();
  if (!latest) return;
  try {
    const reply = await api("/api/respond", {
      method: "POST",
      body: JSON.stringify({ latest, history: [], intent: "both", force: true }),
    });
    $("answer").value = reply.answer || "";
    $("question").value = reply.question || "";
    $("reason").textContent = [reply.reason, reply.warning].filter(Boolean).join(" ");
    document.querySelector('[data-tab="meeting"]').click();
  } catch (error) {
    trainToast(error.message);
  }
}

async function goLive() {
  if (!state.persona) return;
  await savePersona().catch(() => {});
  state.live = true;
  $("go-live").disabled = true;
  $("stop-live").disabled = false;
  setStatus("Listening", "is-live");
  try {
    const session = await api("/api/sessions", { method: "POST" });
    state.sessionId = session.id;
  } catch (error) {
    toast(error.message);
  }
  if ($("say-intro").checked && state.persona?.intro) {
    await speak(state.persona.intro, "intro");
  }
  if (state.health?.transcribe) startEar();
  else startDictation();
  await refreshDevices();
}

function stopLive() {
  state.live = false;
  $("go-live").disabled = false;
  $("stop-live").disabled = true;
  setStatus("Idle", "");
  stopEar();
  stopDictation();
}

function startDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("This browser has no dictation. Type what was said.");
    return;
  }
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results[event.results.length - 1][0].transcript;
    heard(text);
  };
  recognition.onerror = () => {};
  recognition.onend = () => {
    if (state.live && state.recognition === recognition) {
      try { recognition.start(); } catch (error) { /* already started */ }
    }
  };
  state.recognition = recognition;
  recognition.start();
  $("listen-mode").textContent = "Listening with browser dictation.";
}

function stopDictation() {
  if (!state.recognition) return;
  const recognition = state.recognition;
  state.recognition = null;
  recognition.onend = null;
  try { recognition.stop(); } catch (error) { /* already stopped */ }
}

async function startEar() {
  try {
    const audio = $("mic").value ? { deviceId: { exact: $("mic").value }, channelCount: 1 } : { channelCount: 1 };
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    await refreshDevices();
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    const ear = { stream, context, processor, buffers: [], speaking: false, silence: 0, heard: false };
    processor.onaudioprocess = (event) => capture(ear, event);
    state.ear = ear;
    $("listen-mode").textContent = "Listening on the selected microphone.";
  } catch (error) {
    toast("Microphone permission was blocked. Using browser dictation if it is available.");
    startDictation();
  }
}

function capture(ear, event) {
  if (!state.live || state.speaking || Date.now() - state.lastSpokenAt < 700) {
    ear.buffers = [];
    ear.speaking = false;
    return;
  }
  const data = event.inputBuffer.getChannelData(0);
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) sum += data[index] * data[index];
  const rms = Math.sqrt(sum / data.length);
  const hot = rms > 0.02;
  if (hot) {
    ear.speaking = true;
    ear.heard = true;
    ear.silence = 0;
    ear.buffers.push(new Float32Array(data));
  } else if (ear.speaking) {
    ear.silence += data.length / event.inputBuffer.sampleRate;
    ear.buffers.push(new Float32Array(data));
    const samples = ear.buffers.reduce((total, chunk) => total + chunk.length, 0);
    if (ear.silence > 0.7 || samples > event.inputBuffer.sampleRate * 12) {
      const chunks = ear.buffers;
      ear.buffers = [];
      ear.speaking = false;
      ear.silence = 0;
      if (ear.heard && samples > event.inputBuffer.sampleRate * 0.4) {
        sendClip(chunks, event.inputBuffer.sampleRate);
      }
      ear.heard = false;
    }
  }
}

async function sendClip(chunks, sampleRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });
  const body = new FormData();
  body.append("file", encodeWav(samples, sampleRate), "speech.wav");
  try {
    const response = await fetch("/api/transcribe", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "Transcription failed");
    if (payload.text) heard(payload.text);
  } catch (error) {
    if (!state.warned) {
      state.warned = true;
      toast(error.message);
    }
  }
}

function heard(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean || echoOfLast(clean)) return;
  $("heard").value = clean;
  pushLine("room", clean);
  draft(clean, false);
}

async function draft(latest, force) {
  const text = (latest || "").trim();
  if (!text) return;
  try {
    const reply = await api("/api/respond", {
      method: "POST",
      body: JSON.stringify({ latest: text, history: state.history.slice(-12), intent: "both", force }),
    });
    if (reply.skipped && !force) return;
    $("answer").value = reply.answer || "";
    $("question").value = reply.question || "";
    $("reason").textContent = [reply.reason, reply.warning].filter(Boolean).join(" ");
    if (state.sessionId) {
      api(`/api/sessions/${state.sessionId}/turns`, {
        method: "POST",
        body: JSON.stringify({ who: "room", text, answer: reply.answer || "", question: reply.question || "" }),
      }).catch(() => {});
    }
    if (state.live && $("auto-speak").checked && reply.should_speak && reply.answer) {
      await speak(reply.answer, "answer");
      if ($("volunteer").checked && reply.question) await speak(reply.question, "question");
    }
  } catch (error) {
    toast(error.message);
  }
}

function sentenceGroups(text, size) {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= size) return [text];
  const groups = [];
  for (let index = 0; index < parts.length; index += size) {
    groups.push(parts.slice(index, index + size).join(" "));
  }
  return groups;
}

async function speak(text, kind) {
  const line = (text || "").trim();
  if (!line || state.speaking) return;
  state.speaking = true;
  state.lastSpoken = line;
  state.lastSpokenAt = Date.now();
  setStatus("Speaking", "is-talk");
  pushLine("avatar", line);
  stage.setSpeech(line);
  const releaseMouth = holdMouthOpen();
  const typed = kind === "exact" || kind === "answer" || kind === "question";
  const verbatim = typed && !!state.health?.tts_verbatim;
  const pieces = verbatim ? [line] : sentenceGroups(line, 4);
  if (line.length > 1500) toast("Only the first 1500 characters are spoken.");
  try {
    if (!state.persona?.xai_custom_voice_id && ($("voice-file")?.files?.[0] || state.voiceBlob)) {
      await cloneVoice();
    }
    let usedMac = false;
    for (const piece of pieces) {
      const payload = { text: piece, voice: voiceForSpeech() };
      if (verbatim) payload.verbatim = true;
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const type = response.headers.get("content-type") || "";
      if (!type.includes("audio")) {
        const payload = await response.json().catch(() => ({}));
        if (state.health?.tts === "xai") {
          toast(payload.error || "xAI could not be reached, so the browser voice spoke. Rex is still the voice that will be used when xAI answers.");
        }
        await browserSpeak(line);
        break;
      }
      const engine = response.headers.get("X-Avatar-Voice");
      if (engine === "mac" && state.health?.tts === "xai" && !usedMac) {
        usedMac = true;
        toast("xAI voice was unavailable, so a Mac voice spoke instead.");
      }
      const blob = await response.blob();
      const frames = await requestAce(blob);
      await playWav(blob, frames);
    }
  } catch (error) {
    toast(error.message);
    await browserSpeak(line);
  } finally {
    releaseMouth();
    stage.clearSpeech();
    state.speaking = false;
    state.lastSpokenAt = Date.now();
    setStatus(state.live ? "Listening" : "Idle", state.live ? "is-live" : "");
  }
}

function holdMouthOpen() {
  const timer = window.setInterval(() => {
    if (state.audio && !state.audio.paused && state.audio._heard) return;
    stage.setTalkEnergy(0.78);
  }, 70);
  return () => {
    window.clearInterval(timer);
    stage.setTalkEnergy(0);
  };
}

function syncHandButton() {
  const raised = window.localStorage.getItem("avatar-hand") === "1";
  const button = $("raise-hand");
  button.textContent = raised ? "Lower hand" : "Raise hand";
  button.classList.toggle("is-raised", raised);
  button.setAttribute("aria-pressed", raised ? "true" : "false");
  $("hand-note").textContent = raised
    ? "Your hand is up on the meeting camera. This is the video gesture, separate from the meeting app’s own raise-hand button."
    : "Your hand is down on the meeting camera.";
}

async function requestAce(blob) {
  const ace = state.health?.ace;
  if (!ace) return null;
  if (!ace.library || !ace.listening) return null;
  try {
    const response = await fetch("/api/a2f", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: blob,
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json();
    if (!payload.ok || !payload.frames?.length) {
      toast(payload.error || "Audio2Face returned no face weights.");
      return null;
    }
    return payload.frames;
  } catch (error) {
    toast(error.name === "TimeoutError" ? "Audio2Face timed out, so the mouth was not driven." : "Audio2Face could not be reached, so the mouth was not driven.");
    return null;
  }
}

function playWav(blob, frames, options = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = state.audio;
    const startAt = Math.max(0, Number(options.startAt) || 0);
    audio.src = url;
    const sink = $("speaker").value;
    let frameIndex = -1;
    let settled = false;
    let failed = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      state.stopAudio = null;
      stage.setTalkEnergy(0);
      stage.applyFaceWeights({});
      if (options.sing) stage.setSinging(false);
      URL.revokeObjectURL(url);
      resolve(!failed);
    };
    state.stopAudio = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      finish();
    };
    const trackFace = () => {
      if (!frames?.length || audio.ended) return;
      const time = audio.currentTime;
      let next = frameIndex;
      while (next + 1 < frames.length && frames[next + 1].time <= time + 0.03) next += 1;
      if (next >= 0 && next !== frameIndex) {
        frameIndex = next;
        stage.applyFaceWeights(frames[next].weights || {});
      }
      if (!audio.paused && !audio.ended) requestAnimationFrame(trackFace);
    };
    const begin = () => {
      wireAnalyser(audio);
      if (options.sing) {
        audio._singPeak = 0;
        audio._phrase = 0;
        audio._note = 0;
        audio._bright = 0.45;
        stage.clearSpeech();
        stage.setSinging(true);
      } else if (Number.isFinite(audio.duration)) {
        stage.setSpeechDuration(audio.duration);
      }
      const driveMouth = () => {
        if (settled || audio.ended || audio.paused) return;
        if (!options.sing) stage.setSpeechTime(audio.currentTime || 0);
        if (!frames?.length && !audio._heard) {
          if (options.sing) stage.setSingFeel({ loud: 0.78, phrase: 0.66, bright: 0.55, punch: 0.42 });
          else stage.setTalkEnergy(0.78);
        }
        requestAnimationFrame(driveMouth);
      };
      audio.onended = finish;
      audio.onerror = () => {
        failed = true;
        finish();
      };
      audio.onplaying = () => {
        audio._heard = false;
        requestAnimationFrame(trackFace);
        requestAnimationFrame(driveMouth);
      };
      audio.play().catch(() => {
        failed = true;
        finish();
      });
    };
    const play = () => {
      if (startAt <= 0.05) {
        begin();
        return;
      }
      const seek = () => {
        const duration = audio.duration;
        const at = Number.isFinite(duration) ? Math.min(startAt, Math.max(0, duration - 0.05)) : startAt;
        if (Math.abs((audio.currentTime || 0) - at) < 0.05) {
          begin();
          return;
        }
        audio.addEventListener("seeked", () => begin(), { once: true });
        try {
          audio.currentTime = at;
        } catch (error) {
          begin();
        }
      };
      if (audio.readyState >= 1) seek();
      else audio.addEventListener("loadedmetadata", seek, { once: true });
    };
    if (sink && audio.setSinkId) audio.setSinkId(sink).then(play).catch(play);
    else play();
  });
}

function clockTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function songKey(file) {
  return file ? `${file.name}:${file.size}:${file.lastModified}` : "";
}

function syncSongButton() {
  const file = $("song-file").files[0];
  const pause = state.songPause;
  const canResume = !!(file && pause && pause.key === songKey(file));
  $("sing-song").textContent = canResume ? "Resume song" : "Send song to the meeting";
}

async function singSong() {
  const file = $("song-file").files[0];
  if (!file) {
    toast("Choose a song file first.");
    return;
  }
  if (state.speaking) {
    toast("Wait until the current audio finishes.");
    return;
  }
  const pause = state.songPause;
  const resumeAt = pause && pause.key === songKey(file) ? pause.time : 0;
  state.songPause = null;
  state.speaking = true;
  state.songStopped = false;
  $("sing-song").disabled = true;
  $("stop-song").disabled = false;
  setStatus("Singing", "is-talk");
  const note = $("song-note");
  note.textContent = resumeAt > 0.2
    ? `${file.name} is resuming at ${clockTime(resumeAt)}.`
    : `${file.name} is starting.`;
  const timer = window.setInterval(() => {
    const audio = state.audio;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    note.textContent = `${file.name} · ${clockTime(audio.currentTime)} / ${clockTime(audio.duration)}`;
  }, 250);
  try {
    const played = await playWav(file, null, { sing: true, startAt: resumeAt });
    if (state.songStopped && state.songPause) {
      note.textContent = `${file.name} paused at ${clockTime(state.songPause.time)}. Resume continues from there.`;
    } else if (state.songStopped) note.textContent = `${file.name} stopped.`;
    else if (played) note.textContent = `${file.name} finished.`;
    else toast("That song file could not be played. Use mp3, wav, m4a, or aac.");
  } catch (error) {
    toast(error.message);
  } finally {
    window.clearInterval(timer);
    stage.setSinging(false);
    stage.setTalkEnergy(0);
    $("sing-song").disabled = false;
    $("stop-song").disabled = true;
    syncSongButton();
    state.speaking = false;
    setStatus(state.live ? "Listening" : "Idle", state.live ? "is-live" : "");
  }
}

function stopSong() {
  const audio = state.audio;
  const file = $("song-file").files[0];
  const time = audio?.currentTime || 0;
  const duration = audio?.duration;
  const nearEnd = Number.isFinite(duration) && time >= duration - 0.35;
  if (file && time > 0.2 && !nearEnd) {
    state.songPause = { key: songKey(file), time, name: file.name };
  } else {
    state.songPause = null;
  }
  state.songStopped = true;
  if (state.stopAudio) state.stopAudio();
}

function wireAnalyser(audio) {
  if (audio._wired) return;
  try {
  const context = new AudioContext();
  state.audioContext = context;
  context.resume();
  const source = context.createMediaElementSource(audio);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  analyser.connect(context.destination);
  audio._wired = true;
  const data = new Uint8Array(analyser.fftSize);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const band = (lo, hi) => {
    const nyquist = context.sampleRate / 2;
    const bins = freq.length;
    let start = Math.max(0, Math.floor((lo / nyquist) * bins));
    let end = Math.min(bins, Math.ceil((hi / nyquist) * bins));
    if (end <= start) end = Math.min(bins, start + 1);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += freq[index];
    return sum / (end - start) / 255;
  };
  const pump = () => {
    if (!audio.paused) {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const sample = (data[index] - 128) / 128;
        sum += sample * sample;
      }
      const level = Math.sqrt(sum / data.length);
      if (stage.singing) {
        analyser.getByteFrequencyData(freq);
        const voice = band(200, 3500);
        const low = band(180, 700);
        const high = band(1400, 4200);
        audio._singPeak = Math.max(voice, (audio._singPeak || voice) * 0.9985);
        const loud = Math.min(1, voice / Math.max(0.045, audio._singPeak));
        const brightNow = high / (high + low + 0.02);
        audio._bright = (audio._bright ?? 0.45) + (brightNow - (audio._bright ?? 0.45)) * 0.18;
        const note = audio._note || 0;
        const phrase = audio._phrase || 0;
        audio._note = note + (loud - note) * (loud > note ? 0.52 : 0.2);
        audio._phrase = phrase + (loud - phrase) * (loud > phrase ? 0.07 : 0.03);
        const punch = Math.max(0, Math.min(1, (audio._note - audio._phrase) * 3.4));
        if (loud > 0.08) audio._heard = true;
        stage.setSingFeel({ loud, phrase: audio._phrase, bright: audio._bright, punch });
      } else if (level > 0.015) {
        audio._heard = true;
        stage.setTalkEnergy(Math.min(1, level * 8));
      }
    }
    requestAnimationFrame(pump);
  };
  pump();
  } catch (error) {
    return;
  }
}

function browserSpeak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }
    let started = false;
    const speakNow = () => {
      if (started) return;
      started = true;
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const preferred = ["Reed", "Daniel", "Alex", "Aaron", "Fred"];
      const named = voices.find((item) => item.name === state.persona?.voice);
      const male = preferred.map((name) => voices.find((item) => item.name.includes(name))).find(Boolean);
      const english = voices.find((item) => (item.lang || "").toLowerCase().startsWith("en"));
      if (named || male || english) utterance.voice = named || male || english;
      let timer = 0;
      let finished = false;
      const stop = () => {
        if (finished) return;
        finished = true;
        window.clearInterval(timer);
        stage.setTalkEnergy(0);
        resolve();
      };
      utterance.onstart = () => {
        stage.setSpeechDuration(Math.max(0.45, String(text || "").length / 13));
        stage.setSpeechTime(0);
        timer = window.setInterval(() => {
          stage.setTalkEnergy(0.78);
        }, 70);
      };
      utterance.onboundary = () => stage.pulseSyllable();
      utterance.onend = stop;
      utterance.onerror = stop;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    };
    if (speechSynthesis.getVoices().length) speakNow();
    else {
      speechSynthesis.addEventListener("voiceschanged", speakNow, { once: true });
      window.setTimeout(speakNow, 400);
    }
  });
}

function pushLine(who, text) {
  state.history.push({ who, text });
  const row = document.createElement("div");
  row.className = `line ${who === "avatar" ? "avatar" : ""}`;
  const whoLabel = document.createElement("b");
  whoLabel.textContent = who === "avatar" ? "Avatar" : "Room";
  row.append(whoLabel, document.createTextNode(` ${text}`));
  const box = $("transcript");
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function echoOfLast(text) {
  if (!state.lastSpoken || Date.now() - state.lastSpokenAt > 15000) return false;
  const left = new Set(text.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
  const right = new Set(state.lastSpoken.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
  if (!left.size || !right.size) return false;
  let shared = 0;
  left.forEach((word) => {
    if (right.has(word)) shared += 1;
  });
  return shared / left.size > 0.6;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function stopEar() {
  const ear = state.ear;
  if (!ear) return;
  state.ear = null;
  try { ear.processor.disconnect(); } catch (error) { /* already disconnected */ }
  ear.stream.getTracks().forEach((track) => track.stop());
  ear.context.close();
}

async function toggleRecording() {
  if (state.recorder) {
    state.recorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    trainToast("Microphone permission is needed to record your voice.");
    return;
  }
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    state.recorder = null;
    state.voiceBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const seconds = Math.round((Date.now() - (state.recordStarted || Date.now())) / 1000);
    $("record-voice").textContent = "Record your voice";
    if (seconds < 30) {
      trainToast("That clip is short. About 90 seconds lets xAI keep your tone. Sending it anyway.");
    }
    cloneVoice(state.voiceBlob);
  };
  recorder.start();
  state.recorder = recorder;
  state.recordStarted = Date.now();
  $("record-voice").textContent = "Stop recording";
  window.setTimeout(() => {
    if (state.recorder === recorder && recorder.state === "recording") recorder.stop();
  }, 90000);
}

async function cloneVoice(recording) {
  const chosen = recording instanceof Blob ? recording : ($("voice-file").files[0] || state.voiceBlob);
  if (!chosen) {
    trainToast("Record your voice or choose an audio file first.");
    return;
  }
  const body = new FormData();
  body.append("file", chosen, chosen.name || "chan-voice.webm");
  body.append("tone", $("voice-tone").value || "professional");
  trainToast("Sending your recording to xAI…");
  try {
    const response = await fetch("/api/voice/clone", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "xAI could not clone that recording.");
    state.persona = data.persona;
    state.health = await api("/api/health");
    fillVoices(state.health.voices || []);
    fillPersona();
    const short = data.short_recording ? " A clip closer to 90 seconds matches your tone more closely." : "";
    trainToast(`Your recording is now the voice for Speak into the meeting.${short}`);
  } catch (error) {
    trainToast(error.message);
  }
}

async function useVoiceId() {
  const voiceId = $("voice-id").value.trim();
  if (!voiceId) {
    trainToast("Paste the voice id from xAI.");
    return;
  }
  try {
    const data = await api("/api/voice/select", { method: "POST", body: JSON.stringify({ voice_id: voiceId }) });
    state.persona = data.persona;
    state.health = await api("/api/health");
    fillVoices(state.health.voices || []);
    fillPersona();
    $("voice-id").value = "";
    trainToast("That xAI voice is selected.");
  } catch (error) {
    trainToast(error.message);
  }
}

async function saveSettings(options = {}) {
  try {
    state.health = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        provider: $("s-provider").value.trim(),
        base_url: $("s-base").value.trim(),
        model: $("s-model").value.trim(),
        api_key: $("s-key").value,
        clear_key: $("s-clear").checked,
        xai_api_key: $("s-xai").value,
        clear_xai_key: $("s-clear-xai").checked,
        a2f_url: $("s-a2f").value.trim(),
        a2f_function_id: $("s-a2f-fn").value.trim(),
        a2f_api_key: $("s-a2f-key").value,
        clear_a2f_key: $("s-clear-a2f").checked,
      }),
    });
    state.health.ok = true;
    state.health.version = $("version").textContent;
    $("s-key").value = "";
    $("s-xai").value = "";
    $("s-a2f-key").value = "";
    $("s-clear").checked = false;
    $("s-clear-xai").checked = false;
    $("s-clear-a2f").checked = false;
    fillVoices(state.health.voices || []);
    renderLlm();
    if (!options.quiet) toast("Model settings saved.");
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

async function speakAudio(text) {
  stage.setSpeech(text);
  const releaseMouth = holdMouthOpen();
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: state.persona?.voice || "", verbatim: true }),
    });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("audio")) {
      const payload = await response.json().catch(() => ({}));
      if (state.health?.tts === "xai") {
        toast(payload.error || "xAI could not be reached, so the browser voice spoke. Rex is still the voice that will be used when xAI answers.");
      }
      await browserSpeak(text);
      return;
    }
    const engine = response.headers.get("X-Avatar-Voice");
    if (engine === "mac" && state.health?.tts === "xai") {
      toast("xAI voice was unavailable, so a Mac voice spoke instead.");
    }
    const blob = await response.blob();
    await playWav(blob, await requestAce(blob));
  } finally {
    releaseMouth();
    stage.clearSpeech();
  }
}

async function testAudio2Face() {
  const button = $("test-a2f");
  const note = $("a2f-test");
  if (state.speaking) {
    note.textContent = "Wait until the current line finishes, then test again.";
    return;
  }
  button.disabled = true;
  note.textContent = "Sending a few seconds of voice to Audio2Face…";
  try {
    const faceSettings = {};
    const endpoint = $("s-a2f").value.trim();
    const functionId = $("s-a2f-fn").value.trim();
    if (endpoint) faceSettings.a2f_url = endpoint;
    if (functionId) faceSettings.a2f_function_id = functionId;
    if ($("s-a2f-key").value) faceSettings.a2f_api_key = $("s-a2f-key").value;
    if ($("s-clear-a2f").checked) faceSettings.clear_a2f_key = true;
    if (Object.keys(faceSettings).length) {
      state.health = await api("/api/settings", { method: "PUT", body: JSON.stringify(faceSettings) });
      $("s-a2f-key").value = "";
      $("s-clear-a2f").checked = false;
      renderLlm();
    }
    const response = await fetch("/api/a2f/test", { method: "POST", signal: AbortSignal.timeout(40000) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
      note.textContent = "This server does not have the Audio2Face test. Restart the app, then try again.";
      return;
    }
    if (!response.ok) {
      note.textContent = payload.detail || payload.error || "Audio2Face test failed.";
      return;
    }
    const summary = payload.summary || {};
    if (!payload.ok || !summary.moved) {
      const reason = payload.error || "Audio2Face did not return mouth weights.";
      note.textContent = `${reason} Speaking the line now, and the mouth follows that audio.`;
      state.speaking = true;
      setStatus("Speaking", "is-talk");
      const releaseMouth = holdMouthOpen();
      try {
        if (payload.wav_base64) {
          const binary = atob(payload.wav_base64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          await playWav(new Blob([bytes], { type: "audio/wav" }), payload.frames || []);
        } else {
          await speakAudio("Hello. The mouth follows these words until Audio2Face is running.");
        }
        note.textContent = `${reason} That line was spoken, and the mouth followed the audio.`;
      } finally {
        releaseMouth();
      }
      return;
    }
    const playing = `Audio2Face is working. ${summary.frames} frames over ${summary.duration}s from ${summary.source}. Strongest mouth move: ${summary.strongest} at ${summary.peak}. The avatar is speaking that sample now.`;
    note.textContent = playing;
    const binary = atob(payload.wav_base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    state.speaking = true;
    setStatus("Speaking", "is-talk");
    await playWav(new Blob([bytes], { type: "audio/wav" }), payload.frames || []);
    note.textContent = playing.replace("is speaking that sample now", "finished that sample");
  } catch (error) {
    note.textContent = error.name === "TimeoutError"
      ? "Audio2Face timed out. No face weights came back."
      : (error.message || "Audio2Face test failed.");
  } finally {
    state.speaking = false;
    setStatus(state.live ? "Listening" : "Idle", state.live ? "is-live" : "");
    button.disabled = false;
  }
}

function setStatus(text, className) {
  $("status-text").textContent = text;
  $("status").className = `status ${className || ""}`.trim();
}
function toast(message) { $("toast").textContent = message || ""; }
function trainToast(message) { $("train-toast").textContent = message || ""; }

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || response.statusText);
  return data;
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
