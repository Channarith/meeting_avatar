import * as THREE from "three";
import { GLTFLoader } from "/vendor/addons/loaders/GLTFLoader.js";

// Meeting feed uses the headshot only. Chan_Meshy_AI.glb is the unused full-body source.
export const AVATAR_URL = "/assets/Chan_Headshot.glb";
const CHANNEL = "chan-meeting-avatar";

const MOUTH_NAMES = ["mouthOpen", "jawOpen", "jaw_open", "viseme_aa", "MouthOpen", "mouth_open"];

export class AvatarStage {
  constructor(container, options = {}) {
    this.container = container;
    this.url = options.url || AVATAR_URL;
    this.broadcastMode = options.broadcast || "none";
    this.onReady = null;
    this.yaw = 0;
    this.crop = 0.5;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._drag = null;
    this.talk = 0;
    this.talkTarget = 0;
    this.mouthOpen = 0;
    this.pulse = 0;
    this.visemes = [];
    this.visemeRaw = [];
    this.speechNatural = 0;
    this.speechDuration = 0;
    this.speechTime = 0;
    this.speechStamp = 0;
    this.speechLive = false;
    this.singing = false;
    this.singFeel = { loud: 0, phrase: 0, bright: 0.45, punch: 0 };
    this.lipNow = { jaw: 0, upper: 0, lower: 0, funnel: 0, pucker: 0, smile: 0, close: 0, cheek: 0, brow: 0 };
    this.hand = 0;
    this.handTarget = 0;
    this.faceWeights = {};
    this.faceKeys = {};
    this.faceMesh = null;
    this.handMesh = null;
    this.handDown = null;
    this.handUp = null;
    this.blink = 0;
    this.blinkTarget = 0;
    this.nextBlink = 2.6;
    this.blinkRelease = 0;
    this.aceUntil = 0;
    this.ready = false;
    this.bones = {};
    this.rest = {};
    this.morphMeshes = [];
    this.lookTarget = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._delta = new THREE.Quaternion();
    this._clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x243140);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 100);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.container.appendChild(this.renderer.domElement);

    this.hemi = new THREE.HemisphereLight(0xfff4e8, 0x243140, 0.85);
    this.key = new THREE.DirectionalLight(0xfff1df, 1.35);
    this.fill = new THREE.DirectionalLight(0xc9d7ea, 0.45);
    this.rim = new THREE.DirectionalLight(0x9ec4ff, 0.35);
    this.scene.add(this.hemi, this.key, this.fill, this.rim);

    this.channel = null;
    if (typeof BroadcastChannel !== "undefined" && this.broadcastMode !== "none") {
      this.channel = new BroadcastChannel(CHANNEL);
      if (this.broadcastMode === "listen") {
        this.channel.onmessage = (event) => this._onRemote(event.data || {});
      }
    }

    this._resize = () => this.resize();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(this.container);
    const savedYaw = window.localStorage.getItem("avatar-yaw");
    const savedCrop = window.localStorage.getItem("avatar-crop");
    if (savedYaw !== null && !Number.isNaN(parseFloat(savedYaw))) this.yaw = parseFloat(savedYaw);
    if (savedCrop !== null && !Number.isNaN(parseFloat(savedCrop))) this.crop = parseFloat(savedCrop);
    const savedZoom = window.localStorage.getItem("avatar-zoom");
    const savedPanX = window.localStorage.getItem("avatar-pan-x");
    const savedPanY = window.localStorage.getItem("avatar-pan-y");
    this.zoom = savedZoom !== null && !Number.isNaN(parseFloat(savedZoom))
      ? parseFloat(savedZoom)
      : AvatarStage.zoomForCrop(this.crop);
    if (savedPanX !== null && !Number.isNaN(parseFloat(savedPanX))) this.panX = parseFloat(savedPanX);
    if (savedPanY !== null && !Number.isNaN(parseFloat(savedPanY))) this.panY = parseFloat(savedPanY);
    if (window.localStorage.getItem("avatar-hand") === "1") this.handTarget = 1;
    this._bindView();
  }

  static zoomForCrop(crop) {
    return Math.min(2.6, Math.max(0.55, 2 ** ((crop - 0.5) / 0.35)));
  }

  static cropForZoom(zoom) {
    return Math.min(0.9, Math.max(0.2, 0.5 + Math.log2(zoom) * 0.35));
  }

  start() {
    this.resize();
    this._loop();
    const loader = new GLTFLoader();
    loader.load(
      this.url,
      (gltf) => this._onLoad(gltf),
      undefined,
      (error) => {
        this.container.dataset.error = "The headshot could not be loaded.";
        console.error(error);
      }
    );
  }

  setYaw(radians) {
    this.yaw = radians;
    window.localStorage.setItem("avatar-yaw", String(radians));
    if (this.model) this.model.rotation.y = radians;
    this.frame();
    this._send({ type: "yaw", yaw: radians });
  }

  setCrop(crop) {
    this.crop = Math.min(0.9, Math.max(0.2, crop));
    this.zoom = AvatarStage.zoomForCrop(this.crop);
    this._storeView();
    this.frame();
    this._publishView();
  }

  setZoom(zoom) {
    this.zoom = Math.min(2.6, Math.max(0.55, zoom));
    this.crop = AvatarStage.cropForZoom(this.zoom);
    this._storeView();
    this.frame();
    this._publishView();
    if (this.onView) this.onView({ crop: this.crop, zoom: this.zoom, panX: this.panX, panY: this.panY });
  }

  _storeView() {
    window.localStorage.setItem("avatar-crop", String(this.crop));
    window.localStorage.setItem("avatar-zoom", String(this.zoom));
    window.localStorage.setItem("avatar-pan-x", String(this.panX));
    window.localStorage.setItem("avatar-pan-y", String(this.panY));
  }

  _publishView() {
    this._send({ type: "view", crop: this.crop, zoom: this.zoom, panX: this.panX, panY: this.panY });
  }

  _bindView() {
    const el = this.container;
    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this._drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: this.panX,
        panY: this.panY,
      };
      el.classList.add("is-dragging");
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener("pointermove", (event) => {
      if (!this._drag || event.pointerId !== this._drag.id) return;
      const rect = el.getBoundingClientRect();
      const dx = (event.clientX - this._drag.x) / Math.max(1, rect.width);
      const dy = (event.clientY - this._drag.y) / Math.max(1, rect.height);
      this.panX = Math.min(0.65, Math.max(-0.65, this._drag.panX - dx * 1.15));
      this.panY = Math.min(0.65, Math.max(-0.65, this._drag.panY + dy * 1.15));
      this.frame();
    });
    const endDrag = (event) => {
      if (!this._drag || event.pointerId !== this._drag.id) return;
      this._drag = null;
      el.classList.remove("is-dragging");
      this._storeView();
      this._publishView();
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.09;
      this.setZoom(this.zoom * factor);
    }, { passive: false });
    el.addEventListener("dblclick", () => {
      this.panX = 0;
      this.panY = 0;
      this.setZoom(1);
    });
  }

  setTalkEnergy(value) {
    this.talkTarget = Math.max(0, Math.min(1, value));
    this._send({ type: "energy", value: this.talkTarget });
  }

  pulseSyllable() {
    this.talkTarget = Math.max(this.talkTarget, 0.72);
    this._send({ type: "pulse" });
  }

  setSpeech(text) {
    this.singing = false;
    this._loadSpeech(text);
    this._send({ type: "speech", text: text || "" });
  }

  setSpeechDuration(seconds) {
    this._scaleSpeech(seconds);
    this._send({ type: "speechDuration", duration: this.speechDuration });
  }

  setSpeechTime(time) {
    const next = Math.max(0, Number(time) || 0);
    this.speechTime = next;
    this.speechStamp = performance.now();
    this.speechLive = true;
    this._send({ type: "speechTime", time: next });
  }

  clearSpeech() {
    this.speechLive = false;
    this.speechTime = 0;
    this.visemes = [];
    this.visemeRaw = [];
    this._send({ type: "speech", text: "" });
  }

  setSinging(on) {
    this.singing = !!on;
    if (this.singing) {
      this.speechLive = false;
      this.visemes = [];
    } else {
      this._applySingFeel({ loud: 0, phrase: 0, bright: 0, punch: 0 });
      this.talkTarget = 0;
    }
    this._send({ type: "sing", on: this.singing });
  }

  setSingFeel(feel) {
    this._applySingFeel(feel);
    this._send({ type: "singFeel", ...this.singFeel });
  }

  _applySingFeel(feel) {
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    const source = feel || {};
    this.singFeel = {
      loud: clamp(source.loud),
      phrase: clamp(source.phrase),
      bright: clamp(source.bright),
      punch: clamp(source.punch),
    };
    this.talkTarget = Math.max(this.singFeel.phrase, this.singFeel.punch);
  }

  _loadSpeech(text) {
    this.visemeRaw = speechVisemes(text);
    this.speechNatural = this.visemeRaw.length ? this.visemeRaw[this.visemeRaw.length - 1].t1 : 0;
    this.visemes = this.visemeRaw.map((item) => ({ ...item }));
    this.speechDuration = this.speechNatural;
    this.speechTime = 0;
    this.speechLive = false;
  }

  _scaleSpeech(seconds) {
    const duration = Number(seconds);
    if (!this.visemeRaw.length || !Number.isFinite(duration) || duration < 0.2) return;
    const scale = duration / (this.speechNatural || duration);
    this.speechDuration = duration;
    this.visemes = this.visemeRaw.map((item) => ({
      ...item,
      t0: item.t0 * scale,
      t1: item.t1 * scale,
    }));
  }

  _speechClock() {
    if (!this.speechLive) return 0;
    return this.speechTime + Math.max(0, performance.now() - this.speechStamp) / 1000;
  }

  _visemeAt(time) {
    const list = this.visemes;
    if (!list.length) return LIP.rest;
    const index = list.findIndex((item) => time < item.t1);
    if (index < 0) return LIP.rest;
    const current = list[index];
    const next = list[index + 1];
    const span = Math.max(0.04, current.t1 - current.t0);
    const fade = Math.min(0.1, span * 0.4);
    if (next && current.t1 - time < fade) {
      return blendLips(current, next, (fade - (current.t1 - time)) / fade);
    }
    return current;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.ready) this.frame();
  }

  frame() {
    if (!this.model) return;
    const bounds = this._subjectBounds();
    if (!bounds) return;
    const height = Math.max(0.05, bounds.maxY - bounds.minY);
    const width = Math.max(0.05, bounds.maxX - bounds.minX);
    const depth = Math.max(0.05, bounds.maxZ - bounds.minZ);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    // The chest sits closer to the camera than the hair, so aim a little
    // lower to keep the bottom off the window edge.
    const lookY = bounds.minY + height * 0.4;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const shiftX = (this.panX || 0) * width;
    const shiftY = (this.panY || 0) * height;
    this.lookTarget.set(centerX + shiftX, lookY + shiftY, centerZ);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 16 / 9;
    // Margin between the bust and the window edges. Zoom pulls the camera in.
    const pad = 1.58 / (this.zoom || 1);
    const distY = (height * 0.5 * pad) / Math.tan(fov / 2);
    const distX = (width * 0.5 * pad) / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(distY, distX, 0.25);
    this.camera.position.set(centerX, lookY, bounds.maxZ + dist);
    this.camera.near = 0.02;
    this.camera.far = dist + depth + 20;
    this.camera.lookAt(this.lookTarget);
    this.camera.updateProjectionMatrix();
    this.key.position.set(centerX + width * 0.35, lookY + height * 0.2, bounds.maxZ + dist);
    this.fill.position.set(centerX - width * 0.55, lookY, bounds.maxZ + dist * 0.5);
    this.rim.position.set(centerX, lookY + height * 0.35, bounds.minZ - depth);
  }

  _subjectBounds() {
    let mesh = null;
    this.model.traverse((obj) => {
      if (!mesh && obj.isMesh && obj.geometry?.attributes?.position) mesh = obj;
    });
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    const step = Math.max(1, Math.floor(position.count / 5000));
    const xs = [];
    const ys = [];
    const zs = [];
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index += step) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      xs.push(point.x);
      ys.push(point.y);
      zs.push(point.z);
    }
    const quantile = (values, portion) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * portion)))];
    };
    // Include the hair and the shoulders, not only the mid-face, so the
    // head does not run into the window. A higher crop shows more chest.
    const openness = (this.crop - 0.28) / (0.85 - 0.28);
    const yTop = quantile(ys, 0.992);
    const yBottom = quantile(ys, Math.max(0, 0.045 - openness * 0.04));
    return {
      minX: quantile(xs, 0.012),
      maxX: quantile(xs, 0.988),
      minY: Math.min(yBottom, yTop - 0.05),
      maxY: Math.max(yTop, yBottom + 0.05),
      minZ: quantile(zs, 0.06),
      maxZ: quantile(zs, 0.94),
    };
  }

  _onLoad(gltf) {
    this.model = gltf.scene;
    this.scene.add(this.model);
    this.model.traverse((obj) => {
      if (obj.isBone) {
        this.bones[obj.name] = obj;
        this.rest[obj.name] = obj.quaternion.clone();
      }
      if (obj.isMesh && obj.morphTargetDictionary) {
        this.morphMeshes.push(obj);
      }
      if (obj.isMesh) {
        obj.frustumCulled = false;
      }
    });
    const savedYaw = window.localStorage.getItem("avatar-yaw");
    if (savedYaw === null) {
      this.yaw = this._guessYaw();
      window.localStorage.setItem("avatar-yaw", String(this.yaw));
      this._send({ type: "yaw", yaw: this.yaw });
    }
    this.model.rotation.y = this.yaw;
    const face = this._buildFaceAndHand();
    this.ready = true;
    this.frame();
    const note = face
      ? "Headshot loaded. Drag the picture to move it, and scroll or use Zoom to come closer. Double-click resets the view."
      : "Headshot loaded. Drag to move it, and scroll to zoom.";
    if (this.onReady) {
      this.onReady({
        yawDegrees: (this.yaw * 180) / Math.PI,
        crop: this.crop,
        bones: Object.keys(this.bones),
        morphs: Object.keys(this.faceKeys).length,
        note,
      });
    }
  }

  _buildFaceAndHand() {
    let mesh = null;
    this.model.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
      if (!mesh || obj.geometry.attributes.position.count > mesh.geometry.attributes.position.count) mesh = obj;
    });
    if (!mesh) return false;
    const position = mesh.geometry.attributes.position;
    const normal = mesh.geometry.attributes.normal;
    const anchor = this._faceAnchor(position, normal);
    this._addSpeechMorphs(mesh, position, normal, anchor);
    this.faceMesh = mesh;
    this._addRaisedHand(anchor);
    return true;
  }

  _faceAnchor(position, normal) {
    // The beanie brim is the most forward point on this scan. Treating it as
    // the nose parked the speech marker on the forehead.
    const samples = [];
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const nz = normal ? normal.getZ(index) : 1;
      if (y < 0.7 || y > 1.68 || nz < 0.2 || z < 0.12) continue;
      samples.push({ x, y, z });
    }
    const faceX = samples
      .filter((point) => point.y > 0.85 && point.y < 1.25 && point.z > 0.25 && point.z < 0.55)
      .map((point) => point.x)
      .sort((a, b) => a - b);
    const cx = faceX.length ? faceX[Math.floor(faceX.length / 2)] : 0.05;
    const bins = new Map();
    for (const point of samples) {
      if (Math.abs(point.x - cx) > 0.06) continue;
      const band = Math.round(point.y * 50) / 50;
      const current = bins.get(band);
      if (current === undefined || point.z > current) bins.set(band, point.z);
    }
    let brimY = 1.49;
    let brimZ = -Infinity;
    for (const [y, z] of bins) {
      if (z > brimZ) {
        brimZ = z;
        brimY = y;
      }
    }
    let noseY = brimY - 0.5;
    let noseZ = -Infinity;
    for (const [y, z] of bins) {
      if (z > brimZ - 0.1 || y > brimY - 0.2) continue;
      if (z > noseZ) {
        noseZ = z;
        noseY = y;
      }
    }
    if (!Number.isFinite(noseZ)) noseZ = brimZ - 0.16;
    let mouthY = noseY - 0.145;
    let mouthZ = noseZ - 0.07;
    let best = Infinity;
    for (const [y, z] of bins) {
      if (y > noseY - 0.1 || y < noseY - 0.2 || z < noseZ - 0.16) continue;
      const score = Math.abs(y - (noseY - 0.145));
      if (score < best) {
        best = score;
        mouthY = y;
        mouthZ = z;
      }
    }
    return { cx, noseY, noseZ, mouthY, mouthZ, brimY, brimZ };
  }

  _addSpeechMorphs(mesh, position, normal, anchor) {
    const count = position.count;
    const blank = () => new Float32Array(count * 3);
    const shapes = {
      JawOpen: blank(),
      MouthClose: blank(),
      MouthFunnel: blank(),
      MouthPucker: blank(),
      MouthSmileLeft: blank(),
      MouthSmileRight: blank(),
      MouthLowerDownLeft: blank(),
      MouthLowerDownRight: blank(),
      MouthUpperUpLeft: blank(),
      MouthUpperUpRight: blank(),
      EyeBlinkLeft: blank(),
      EyeBlinkRight: blank(),
      CheekRaiseLeft: blank(),
      CheekRaiseRight: blank(),
      BrowRaiseLeft: blank(),
      BrowRaiseRight: blank(),
    };
    const { cx, noseY, noseZ, mouthY, mouthZ } = anchor;
    for (let index = 0; index < count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const nz = normal ? normal.getZ(index) : 0;
      const dx = x - cx;
      const adx = Math.abs(dx);
      const at = index * 3;
      const frontFace = z > mouthZ - 0.12 && nz > 0.02;
      if (y < mouthY && y > mouthY - 0.22 && adx < 0.22 && frontFace) {
        const across = Math.max(0, 1 - adx / 0.22);
        const neck = Math.max(0, 1 - Math.max(0, mouthY - 0.15 - y) / 0.08);
        const hingeY = mouthY - 0.01;
        const hingeZ = mouthZ - 0.2;
        const dy = y - hingeY;
        const dz = z - hingeZ;
        const angle = 0.3 * across * neck;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        let drop = dy * (cosine - 1) - dz * sine;
        let tuck = dy * sine + dz * (cosine - 1);
        const reach = Math.hypot(drop, tuck);
        if (reach > 0.055) {
          drop *= 0.055 / reach;
          tuck *= 0.055 / reach;
        }
        shapes.JawOpen[at + 1] += drop;
        shapes.JawOpen[at + 2] += tuck;
      }
      if (y >= mouthY && y < mouthY + 0.038 && adx < 0.1 && z > mouthZ - 0.05 && nz > 0.2) {
        const lip = Math.max(0, 1 - (y - mouthY) / 0.038);
        const center = Math.max(0, 1 - adx / 0.1);
        const weight = lip * lip * center;
        const upper = dx >= 0 ? shapes.MouthUpperUpLeft : shapes.MouthUpperUpRight;
        upper[at + 1] += 0.026 * weight;
        upper[at + 2] += 0.008 * weight;
      }
      if (y < mouthY && y > mouthY - 0.035 && adx < 0.09 && z > mouthZ - 0.05 && nz > 0.15) {
        const lip = Math.max(0, 1 - (mouthY - y) / 0.035);
        const center = Math.max(0, 1 - adx / 0.09);
        const weight = lip * lip * center;
        const lower = dx >= 0 ? shapes.MouthLowerDownLeft : shapes.MouthLowerDownRight;
        lower[at + 1] -= 0.016 * weight;
      }
      if (y >= mouthY && y < mouthY + 0.03 && adx < 0.09 && z > mouthZ - 0.05 && nz > 0.2) {
        const weight = Math.max(0, 1 - (y - mouthY) / 0.03) * Math.max(0, 1 - adx / 0.09);
        shapes.MouthClose[at + 1] -= 0.018 * weight;
      }
      if (y < mouthY && y > mouthY - 0.03 && adx < 0.09 && z > mouthZ - 0.05 && nz > 0.15) {
        const weight = Math.max(0, 1 - (mouthY - y) / 0.03) * Math.max(0, 1 - adx / 0.09);
        shapes.MouthClose[at + 1] += 0.016 * weight;
      }
      const onLip = Math.abs(y - mouthY) < 0.04 && adx < 0.12 && z > mouthZ - 0.06 && nz > 0.12;
      if (onLip) {
        const center = Math.max(0, 1 - adx / 0.12);
        const edge = Math.min(1, adx / 0.05);
        const lip = Math.max(0, 1 - Math.abs(y - mouthY) / 0.04);
        const sign = Math.sign(dx || 1);
        const weight = center * lip;
        shapes.MouthFunnel[at] += -sign * 0.02 * edge * weight;
        shapes.MouthFunnel[at + 2] += 0.016 * weight;
        if (y >= mouthY) shapes.MouthFunnel[at + 1] -= 0.012 * weight;
        shapes.MouthPucker[at] += -sign * 0.028 * edge * weight;
        shapes.MouthPucker[at + 2] += 0.022 * weight;
      }
      const eyeY = noseY + 0.16;
      if (y > mouthY + 0.015 && y < mouthY + 0.2 && adx > 0.03 && adx < 0.18 && z > mouthZ - 0.1 && nz > 0.04) {
        const along = Math.max(0, 1 - Math.abs(adx - 0.095) / 0.09);
        const rise = Math.max(0, 1 - Math.abs(y - (mouthY + 0.09)) / 0.1);
        const weight = Math.pow(Math.max(0, along * rise), 0.65);
        const cheek = dx >= 0 ? shapes.CheekRaiseLeft : shapes.CheekRaiseRight;
        cheek[at] += Math.sign(dx || 1) * 0.028 * weight;
        cheek[at + 1] += 0.062 * weight;
        cheek[at + 2] += 0.016 * weight;
      }
      if (y > eyeY + 0.008 && y < eyeY + 0.08 && adx > 0.015 && adx < 0.14 && z > noseZ - 0.22 && nz > 0.02) {
        const weight = Math.max(0, 1 - Math.abs(adx - 0.07) / 0.08) * Math.max(0, 1 - Math.abs(y - (eyeY + 0.038)) / 0.04);
        const brow = dx >= 0 ? shapes.BrowRaiseLeft : shapes.BrowRaiseRight;
        brow[at + 1] += 0.04 * weight;
      }
      this._corner(shapes.MouthSmileLeft, shapes.MouthLowerDownLeft, shapes.MouthUpperUpLeft, at, dx, y, z, mouthY, mouthZ, 1);
      this._corner(shapes.MouthSmileRight, shapes.MouthLowerDownRight, shapes.MouthUpperUpRight, at, dx, y, z, mouthY, mouthZ, -1);
      const side = Math.abs(dx);
      if (side > 0.03 && side < 0.17 && Math.abs(y - eyeY) < 0.045 && z > noseZ - 0.35) {
        const weight = Math.max(0, 1 - Math.hypot(side - 0.08, (y - eyeY) * 1.3) / 0.055);
        const target = dx > 0 ? shapes.EyeBlinkLeft : shapes.EyeBlinkRight;
        target[at + 1] -= 0.016 * weight * weight;
      }
    }
    const geometry = mesh.geometry;
    geometry.morphAttributes.position = [];
    geometry.morphTargetsRelative = true;
    for (const [name, values] of Object.entries(shapes)) {
      const attribute = new THREE.Float32BufferAttribute(values, 3);
      attribute.name = name;
      geometry.morphAttributes.position.push(attribute);
    }
    mesh.updateMorphTargets();
    this.faceKeys = {};
    for (const [name, morphIndex] of Object.entries(mesh.morphTargetDictionary || {})) {
      this.faceKeys[name.toLowerCase()] = morphIndex;
    }
  }

  _corner(smile, lower, upper, at, dx, y, z, mouthY, mouthZ, side) {
    if (z < mouthZ - 0.08) return;
    const along = dx * side;
    if (along < 0.02 || along > 0.16 || Math.abs(y - mouthY) > 0.05) return;
    const weight = Math.max(0, 1 - Math.abs(along - 0.08) / 0.08) * Math.max(0, 1 - Math.abs(y - mouthY) / 0.05);
    smile[at + 1] += 0.012 * weight;
    smile[at] += side * 0.008 * weight;
    if (y <= mouthY) lower[at + 1] -= 0.008 * weight;
    else upper[at + 1] += 0.01 * weight;
  }

  _addRaisedHand(anchor) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xad7e67, roughness: 0.58, metalness: 0 });
    // The first hand was about a third of the face. A raised hand should be
    // about as long as the face, from the chin to the brim.
    const chin = (anchor.mouthY ?? anchor.noseY - 0.14) - 0.16;
    const crown = (anchor.brimY ?? anchor.noseY) + 0.16;
    const faceLength = Math.max(0.45, crown - chin);
    const size = faceLength / 0.156;
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048 * size, 18, 14), skin);
    palm.scale.set(0.82, 1.15, 0.42);
    hand.add(palm);
    for (let finger = 0; finger < 4; finger += 1) {
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.011 * size, 0.052 * size, 4, 8), skin);
      bone.position.set((-0.026 + finger * 0.017) * size, 0.064 * size, 0.01 * size);
      hand.add(bone);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012 * size, 0.03 * size, 4, 8), skin);
    thumb.position.set(-0.05 * size, 0.01 * size, 0.016 * size);
    thumb.rotation.z = 0.85;
    hand.add(thumb);
    hand.visible = false;
    hand.frustumCulled = false;
    const crownY = anchor.brimY ?? anchor.noseY;
    const crownZ = anchor.brimZ ?? anchor.noseZ;
    let cheek = anchor.cx - 0.28;
    const position = this.faceMesh?.geometry?.attributes?.position;
    if (position) {
      const y0 = chin + 0.08;
      const y1 = crownY + 0.05;
      for (let index = 0; index < position.count; index += 6) {
        const y = position.getY(index);
        const z = position.getZ(index);
        if (y < y0 || y > y1 || z < 0.05) continue;
        cheek = Math.min(cheek, position.getX(index));
      }
    }
    const palmHalf = 0.048 * size * 0.82;
    this.handDown = new THREE.Vector3(anchor.cx - 0.34, crownY - 0.78, crownZ - 0.42);
    this.handUp = new THREE.Vector3(cheek - palmHalf - 0.03, crownY - 0.08, crownZ - 0.05);
    hand.position.copy(this.handDown);
    this.model.add(hand);
    this.handMesh = hand;
  }

  _poseHand(lift) {
    if (!this.handMesh || !this.handUp) return;
    this.handMesh.position.lerpVectors(this.handDown, this.handUp, lift);
    const scale = 0.2 + 0.8 * lift;
    this.handMesh.scale.setScalar(scale);
    this.handMesh.visible = lift > 0.05;
    this.handMesh.rotation.z = -0.35 * (1 - lift);
  }

  _poseFace(time) {
    if (time > this.nextBlink) {
      this.blinkTarget = 1;
      this.blinkRelease = time + 0.09;
      this.nextBlink = time + 3.1 + Math.random() * 2.2;
    }
    if (this.blinkRelease && time > this.blinkRelease) {
      this.blinkTarget = 0;
      this.blinkRelease = 0;
    }
    this.blink += (this.blinkTarget - this.blink) * 0.45;
    const ace = performance.now() < this.aceUntil;
    const loud = Math.min(1, this.mouthOpen);
    const live = !ace && this.speechLive && this.visemes.length && loud > 0.04;
    const singing = !ace && this.singing && (loud > 0.04 || this.singFeel.phrase > 0.04 || this.singFeel.punch > 0.04);
    const target = singing
      ? singingShape(this.singFeel)
      : live
        ? scaleLips(this._visemeAt(this._speechClock()), loud)
        : { jaw: loud * 0.16, upper: loud * 0.12, lower: loud * 0.08, funnel: 0, pucker: 0, smile: 0, close: 0 };
    const ease = singing
      ? { jaw: 0.34, upper: 0.36, lower: 0.32, funnel: 0.24, pucker: 0.24, smile: 0.1, close: 0.22, cheek: 0.07, brow: 0.06 }
      : { jaw: 0.16, upper: 0.18, lower: 0.16, funnel: 0.18, pucker: 0.18, smile: 0.12, close: 0.42, cheek: 0.25, brow: 0.25 };
    for (const key of Object.keys(this.lipNow)) {
      this.lipNow[key] += ((target[key] || 0) - this.lipNow[key]) * (ease[key] || 0.1);
    }
    if (this.faceMesh?.morphTargetInfluences) {
      for (const [name, index] of Object.entries(this.faceKeys)) {
        let value = ace ? (this.faceWeights[name] || 0) : 0;
        if (!ace && name === "jawopen") value = this.lipNow.jaw;
        if (!ace && (name === "mouthupperupleft" || name === "mouthupperupright")) value = this.lipNow.upper;
        if (!ace && (name === "mouthlowerdownleft" || name === "mouthlowerdownright")) value = this.lipNow.lower;
        if (!ace && name === "mouthfunnel") value = this.lipNow.funnel;
        if (!ace && name === "mouthpucker") value = this.lipNow.pucker;
        if (!ace && (name === "mouthsmileleft" || name === "mouthsmileright")) value = this.lipNow.smile;
        if (!ace && name === "mouthclose") value = this.lipNow.close;
        if (!ace && (name === "cheekraiseleft" || name === "cheekraiseright")) value = this.lipNow.cheek;
        if (!ace && (name === "browraiseleft" || name === "browraiseright")) value = this.lipNow.brow;
        if (loud < 0.08 && (name === "eyeblinkleft" || name === "eyeblinkright")) {
          value = Math.max(value, this.blink);
        }
        const cap = singing ? 1.6 : 1;
        this.faceMesh.morphTargetInfluences[index] = Math.max(0, Math.min(cap, value));
      }
    }
  }

  _guessYaw() {
    let mesh = null;
    this.model.traverse((obj) => {
      if (!mesh && obj.isMesh && obj.geometry?.attributes?.position && obj.geometry.attributes.normal) mesh = obj;
    });
    if (!mesh) return 0;
    const position = mesh.geometry.attributes.position;
    const normal = mesh.geometry.attributes.normal;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const height = box.max.y - box.min.y || 1;
    const scores = { z: 0, nz: 0, x: 0, nx: 0 };
    const vertex = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let index = 0; index < position.count; index += step) {
      vertex.fromBufferAttribute(position, index);
      const yn = (vertex.y - box.min.y) / height;
      if (yn < 0.42 || yn > 0.9) continue;
      nrm.fromBufferAttribute(normal, index);
      if (nrm.z > 0.45) scores.z += 1;
      if (nrm.z < -0.45) scores.nz += 1;
      if (nrm.x > 0.45) scores.x += 1;
      if (nrm.x < -0.45) scores.nx += 1;
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 8) return 0;
    if (best[0] === "z") return 0;
    if (best[0] === "nz") return Math.PI;
    if (best[0] === "x") return -Math.PI / 2;
    return Math.PI / 2;
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const t = this._clock.getElapsedTime();
    const follow = this.singing
      ? (this.talkTarget > this.mouthOpen ? 0.045 : 0.02)
      : (this.talkTarget > this.mouthOpen ? 0.1 : 0.04);
    this.mouthOpen += (this.talkTarget - this.mouthOpen) * follow;
    this.talk = this.mouthOpen;
    this.pulse *= 0.92;
    const speak = Math.min(1, this.mouthOpen);
    const phrase = this.singing ? this.singFeel.phrase : 0;
    const punch = this.singing ? this.singFeel.punch : 0;
    const bright = this.singing ? this.singFeel.bright : 0.5;
    const nod = Math.sin(t * 1.05) * 0.01 + Math.sin(t * 2.2) * 0.005 * speak + phrase * 0.028 + punch * 0.012;
    const turn = Math.sin(t * 0.42) * 0.012 + Math.sin(t * 1.15) * 0.004 * speak;
    const tilt = Math.sin(t * 0.7) * 0.008 + (bright - 0.5) * phrase * 0.035;
    this._apply("Bone_002", nod, turn * 0.35, tilt);
    this._apply("Bone_003", nod * 0.45, turn * 0.4, tilt * 0.3);
    this._apply("Bone_001", Math.sin(t * 1.3) * 0.01 + nod * 0.15, turn * 0.2, 0);
    this._apply("Bone_004", nod * 0.2, 0, 0);
    this._apply("Bone_000", 0, 0, Math.sin(t * 0.45) * 0.008);
    this.hand += (this.handTarget - this.hand) * 0.08;
    if (Math.abs(this.handTarget - this.hand) < 0.004) this.hand = this.handTarget;
    const lift = this.hand;
    // Bone_006 only reaches the shoulder. The visible hand is the mesh beside the head.
    this._apply("Bone_006", 1.134 * lift, 0, 0.14 * lift);
    this._poseHand(lift);
    this._poseFace(t);
    this._driveMouth(speak);
    this.renderer.render(this.scene, this.camera);
  }

  _apply(name, x, y, z) {
    const bone = this.bones[name];
    const rest = this.rest[name];
    if (!bone || !rest) return;
    this._euler.set(x, y, z);
    this._delta.setFromEuler(this._euler);
    bone.quaternion.copy(rest).multiply(this._delta);
  }

  _driveMouth(energy) {
    for (const mesh of this.morphMeshes) {
      const dictionary = mesh.morphTargetDictionary || {};
      const name = MOUTH_NAMES.find((candidate) => candidate in dictionary);
      if (!name || !mesh.morphTargetInfluences) continue;
      mesh.morphTargetInfluences[dictionary[name]] = Math.min(1, energy);
    }
  }

  applyFaceWeights(weights) {
    this._setFaceWeights(weights);
    this._send({ type: "face", weights: this.faceWeights });
  }

  _setFaceWeights(weights) {
    const next = {};
    for (const [name, value] of Object.entries(weights || {})) {
      const number = Number(value);
      if (Number.isFinite(number)) next[name.toLowerCase()] = number;
    }
    this.faceWeights = next;
    const active = Object.values(next).some((value) => value > 0.02);
    this.aceUntil = active ? performance.now() + 500 : 0;
  }

  setHand(raised) {
    const up = !!raised;
    this.handTarget = up ? 1 : 0;
    try {
      window.localStorage.setItem("avatar-hand", up ? "1" : "0");
    } catch (error) {
      /* private mode */
    }
    this._send({ type: "hand", raised: up });
  }

  _send(message) {
    if (this.broadcastMode === "send" && this.channel) this.channel.postMessage(message);
  }

  _onRemote(message) {
    if (message.type === "yaw" && this.model) {
      this.yaw = message.yaw;
      this.model.rotation.y = message.yaw;
      this.frame();
    } else if (message.type === "view") {
      this.crop = message.crop ?? this.crop;
      this.zoom = message.zoom ?? this.zoom;
      this.panX = message.panX ?? this.panX;
      this.panY = message.panY ?? this.panY;
      this.frame();
    } else if (message.type === "crop") {
      this.crop = message.crop;
      this.zoom = AvatarStage.zoomForCrop(this.crop);
      this.frame();
    } else if (message.type === "energy") {
      this.talkTarget = Math.max(0, Math.min(1, message.value || 0));
    } else if (message.type === "pulse") {
      this.talkTarget = Math.max(this.talkTarget, 0.72);
    } else if (message.type === "speech") {
      this.singing = false;
      this._loadSpeech(message.text || "");
    } else if (message.type === "sing") {
      this.singing = !!message.on;
      if (this.singing) {
        this.speechLive = false;
        this.visemes = [];
      } else {
        this._applySingFeel({ loud: 0, phrase: 0, bright: 0, punch: 0 });
        this.talkTarget = 0;
      }
    } else if (message.type === "singFeel") {
      if (message.phrase > 0.02 || message.punch > 0.02 || message.loud > 0.02) this.singing = true;
      if (this.singing) this._applySingFeel(message);
    } else if (message.type === "speechDuration") {
      this._scaleSpeech(message.duration);
    } else if (message.type === "speechTime") {
      this.speechTime = Math.max(0, Number(message.time) || 0);
      this.speechStamp = performance.now();
      this.speechLive = true;
    } else if (message.type === "face") {
      this._setFaceWeights(message.weights || {});
    } else if (message.type === "hand") {
      this.handTarget = message.raised ? 1 : 0;
      try {
        window.localStorage.setItem("avatar-hand", message.raised ? "1" : "0");
      } catch (error) {
        /* private mode */
      }
    }
  }
}

const LIP = {
  aa: { jaw: 0.7, upper: 0.38, lower: 0.34, funnel: 0.06, pucker: 0, smile: 0.04, close: 0, hold: 0.22 },
  ee: { jaw: 0.2, upper: 0.62, lower: 0.08, funnel: 0, pucker: 0, smile: 0.42, close: 0, hold: 0.18 },
  ih: { jaw: 0.28, upper: 0.36, lower: 0.12, funnel: 0.04, pucker: 0, smile: 0.16, close: 0, hold: 0.14 },
  oh: { jaw: 0.56, upper: 0.2, lower: 0.22, funnel: 0.7, pucker: 0.26, smile: 0, close: 0, hold: 0.24 },
  oo: { jaw: 0.24, upper: 0.1, lower: 0.12, funnel: 0.42, pucker: 0.66, smile: 0, close: 0, hold: 0.18 },
  mb: { jaw: 0.05, upper: 0.06, lower: 0.02, funnel: 0, pucker: 0.08, smile: 0, close: 0.82, hold: 0.09 },
  fv: { jaw: 0.1, upper: 0.14, lower: 0.2, funnel: 0.08, pucker: 0.06, smile: 0, close: 0.22, hold: 0.09 },
  th: { jaw: 0.16, upper: 0.2, lower: 0.1, funnel: 0.04, pucker: 0, smile: 0.02, close: 0.06, hold: 0.09 },
  rest: { jaw: 0.06, upper: 0.03, lower: 0.02, funnel: 0, pucker: 0, smile: 0, close: 0.04, hold: 0.1 },
};

function speechVisemes(text) {
  const source = String(text || "").toLowerCase();
  const marks = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    let kind = "";
    let step = 1;
    if (rest.startsWith("ough")) {
      kind = "oh";
      step = 4;
    } else if (/^(oo|ou|ue)/.test(rest)) {
      kind = "oo";
      step = 2;
    } else if (/^(ow|oa|oh|oi|oy|or)/.test(rest)) {
      kind = "oh";
      step = 2;
    } else if (/^(ee|ea|ie)/.test(rest)) {
      kind = "ee";
      step = 2;
    } else if (/^(ai|ay|ah)/.test(rest)) {
      kind = "aa";
      step = 2;
    } else if (/^(sh|ch)/.test(rest)) {
      index += 2;
      continue;
    } else if (rest.startsWith("th")) {
      kind = "th";
      step = 2;
    } else {
      const letter = rest[0];
      if (letter === "o") kind = "oh";
      else if (letter === "a") kind = "aa";
      else if (letter === "e" || letter === "i") kind = "ee";
      else if (letter === "u" || letter === "w") kind = "oo";
      else if (letter === "y") kind = "ee";
      else if ("mbp".includes(letter)) kind = "mb";
      else if ("fv".includes(letter)) kind = "fv";
      else if (" .,!?;:\n".includes(letter)) kind = "rest";
      else if (/[a-z]/.test(letter)) {
        index += 1;
        continue;
      }
      else {
        index += 1;
        continue;
      }
    }
    marks.push(kind);
    index += step;
  }
  let time = 0;
  return marks.map((kind) => {
    const shape = LIP[kind];
    const item = { ...shape, kind, t0: time, t1: time + shape.hold };
    time += shape.hold;
    return item;
  });
}

function blendLips(from, to, mix) {
  const amount = Math.max(0, Math.min(1, mix));
  const next = {};
  for (const key of ["jaw", "upper", "lower", "funnel", "pucker", "smile", "close"]) {
    next[key] = (from[key] || 0) + ((to[key] || 0) - (from[key] || 0)) * amount;
  }
  return next;
}

function scaleLips(shape, loud) {
  const next = {};
  for (const key of ["jaw", "upper", "lower", "funnel", "pucker", "smile", "close"]) {
    next[key] = (shape[key] || 0) * loud;
  }
  return next;
}

function singingShape(feel) {
  const source = typeof feel === "number"
    ? { phrase: feel, bright: 0.45, punch: feel * 0.35 }
    : (feel || {});
  const phrase = Math.max(0, Math.min(1, source.phrase || 0));
  const punch = Math.max(0, Math.min(1, source.punch || 0));
  const bright = Math.max(0, Math.min(1, source.bright ?? 0.45));
  const round = 1 - bright;
  const open = Math.max(0, Math.min(1, phrase * 0.72 + punch * 0.95));
  return {
    jaw: Math.min(1.45, phrase * 0.22 + open * 1.05),
    upper: Math.min(1.6, open * (0.5 + bright * 0.9)),
    lower: Math.min(1.4, open * (0.58 + round * 0.45)),
    funnel: Math.min(1.35, open * (0.18 + round * 1.05)),
    pucker: Math.min(1.15, open * round * 0.9),
    smile: Math.min(0.92, phrase * (0.34 + bright * 0.7)),
    close: Math.min(0.4, (1 - open) * phrase * 0.3),
    cheek: Math.min(1, phrase * (0.62 + bright * 0.38) + punch * 0.2),
    brow: Math.min(0.8, phrase * (0.18 + bright * 0.62)),
  };
}
