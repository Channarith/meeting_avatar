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
    this.talk = 0;
    this.pulse = 0;
    this.hand = 0;
    this.handTarget = 0;
    this.faceWeights = {};
    this.faceKeys = {};
    this.faceMesh = null;
    this.mouthInterior = null;
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
    if (window.localStorage.getItem("avatar-hand") === "1") this.handTarget = 1;
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
    this.crop = Math.min(0.85, Math.max(0.28, crop));
    window.localStorage.setItem("avatar-crop", String(this.crop));
    this.frame();
    this._send({ type: "crop", crop: this.crop });
  }

  setTalkEnergy(value) {
    this.talk = Math.max(this.talk, Math.min(1, value));
    this._send({ type: "energy", value: this.talk });
  }

  pulseSyllable() {
    this.pulse = 1;
    this.talk = Math.min(1, this.talk + 0.55);
    this._send({ type: "pulse" });
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
    this.lookTarget.set(centerX, lookY, centerZ);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 16 / 9;
    // Margin between the bust and the window edges.
    const pad = 1.58;
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
      ? "Headshot loaded. Audio2Face weights move the mouth on this face. Blinks between lines stay local."
      : "Headshot loaded.";
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
    this._addMouthCavity(anchor);
    this._addRaisedHand(anchor);
    return true;
  }

  _faceAnchor(position, normal) {
    const xs = [];
    let noseZ = -Infinity;
    let noseY = 1.46;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const nz = normal ? normal.getZ(index) : 1;
      if (y > 1.25 && y < 1.62 && nz > 0.4) xs.push(x);
      if (y > 1.4 && y < 1.52 && Math.abs(x - 0.05) < 0.08 && z > noseZ) {
        noseZ = z;
        noseY = y;
      }
    }
    xs.sort((a, b) => a - b);
    const cx = xs.length ? xs[Math.floor(xs.length / 2)] : 0.05;
    if (!Number.isFinite(noseZ)) noseZ = 0.6;
    return { cx, noseY, noseZ, mouthY: noseY - 0.13, mouthZ: noseZ - 0.2 };
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
      if (y < mouthY + 0.02 && y > mouthY - 0.34 && adx < 0.26 && z > 0.02) {
        const across = Math.max(0, 1 - adx / 0.26);
        const drop = Math.max(0, Math.min(1, (mouthY + 0.02 - y) / 0.16));
        const weight = across * drop;
        shapes.JawOpen[at + 1] -= 0.07 * weight;
        shapes.JawOpen[at + 2] -= 0.018 * weight;
      }
      if (y >= mouthY && y < mouthY + 0.04 && adx < 0.13 && z > mouthZ - 0.08 && nz > 0.1) {
        const weight = Math.max(0, 1 - adx / 0.13) * (1 - (y - mouthY) / 0.04);
        shapes.JawOpen[at + 1] += 0.018 * weight;
      }
      if (y < mouthY && y > mouthY - 0.055 && adx < 0.12 && z > mouthZ - 0.08) {
        const weight = Math.max(0, 1 - adx / 0.12);
        shapes.MouthClose[at + 1] += 0.028 * weight;
      }
      if (Math.abs(y - mouthY) < 0.045 && adx < 0.14 && z > mouthZ - 0.1 && nz > 0.05) {
        const edge = Math.min(1, adx / 0.09);
        const weight = Math.max(0, 1 - Math.abs(y - mouthY) / 0.045);
        shapes.MouthFunnel[at] += -Math.sign(dx || 1) * 0.018 * edge * weight;
        shapes.MouthFunnel[at + 2] += 0.016 * weight;
        shapes.MouthPucker[at] += -Math.sign(dx || 1) * 0.028 * edge * weight;
        shapes.MouthPucker[at + 2] += 0.022 * weight;
      }
      this._corner(shapes.MouthSmileLeft, shapes.MouthLowerDownLeft, shapes.MouthUpperUpLeft, at, dx, y, mouthY, 1);
      this._corner(shapes.MouthSmileRight, shapes.MouthLowerDownRight, shapes.MouthUpperUpRight, at, dx, y, mouthY, -1);
      const eyeY = noseY + 0.03;
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

  _corner(smile, lower, upper, at, dx, y, mouthY, side) {
    const along = dx * side;
    if (along < 0.02 || along > 0.16 || Math.abs(y - mouthY) > 0.05) return;
    const weight = Math.max(0, 1 - Math.abs(along - 0.08) / 0.08) * Math.max(0, 1 - Math.abs(y - mouthY) / 0.05);
    smile[at + 1] += 0.022 * weight;
    smile[at] += side * 0.012 * weight;
    if (y <= mouthY) lower[at + 1] -= 0.02 * weight;
    else upper[at + 1] += 0.016 * weight;
  }

  _addMouthCavity(anchor) {
    const cavity = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a1418, roughness: 0.9, metalness: 0 })
    );
    cavity.position.set(anchor.cx, anchor.mouthY - 0.005, anchor.mouthZ - 0.012);
    cavity.scale.set(1.2, 0.12, 0.45);
    cavity.visible = false;
    cavity.frustumCulled = false;
    this.model.add(cavity);
    this.mouthInterior = cavity;
  }

  _addRaisedHand(anchor) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xad7e67, roughness: 0.58, metalness: 0 });
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), skin);
    palm.scale.set(0.82, 1.15, 0.4);
    hand.add(palm);
    for (let finger = 0; finger < 4; finger += 1) {
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.052, 3, 6), skin);
      bone.position.set(-0.026 + finger * 0.017, 0.064, 0.01);
      hand.add(bone);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.03, 3, 6), skin);
    thumb.position.set(-0.05, 0.01, 0.016);
    thumb.rotation.z = 0.85;
    hand.add(thumb);
    hand.visible = false;
    hand.frustumCulled = false;
    this.handDown = new THREE.Vector3(anchor.cx - 0.3, anchor.mouthY - 0.55, anchor.mouthZ - 0.18);
    this.handUp = new THREE.Vector3(anchor.cx - 0.5, anchor.noseY + 0.02, anchor.mouthZ + 0.04);
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
    const speaking = performance.now() < this.aceUntil;
    if (this.faceMesh?.morphTargetInfluences) {
      for (const [name, index] of Object.entries(this.faceKeys)) {
        let value = this.faceWeights[name] || 0;
        if (!speaking && (name === "eyeblinkleft" || name === "eyeblinkright")) {
          value = Math.max(value, this.blink);
        }
        this.faceMesh.morphTargetInfluences[index] = Math.max(0, Math.min(1.25, value));
      }
    }
    if (!this.mouthInterior) return;
    const jaw = this.faceWeights.jawopen || 0;
    const close = this.faceWeights.mouthclose || 0;
    const funnel = this.faceWeights.mouthfunnel || 0;
    const open = Math.max(0, Math.min(1, jaw * (1 - close * 0.8) + funnel * 0.4));
    this.mouthInterior.visible = open > 0.06;
    this.mouthInterior.scale.set(1.15, 0.12 + open * 1.45, 0.5);
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
    this.talk *= 0.9;
    this.pulse *= 0.82;
    const energy = Math.min(1, this.talk + this.pulse);
    const nod = Math.sin(t * 1.7) * 0.012 + Math.sin(t * 8.5) * 0.035 * energy;
    const turn = Math.sin(t * 0.55) * 0.018 + Math.sin(t * 5.2) * 0.012 * energy;
    const tilt = Math.sin(t * 0.9) * 0.01;
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
    this._driveMouth(energy);
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
    } else if (message.type === "crop") {
      this.crop = message.crop;
      this.frame();
    } else if (message.type === "energy") {
      this.talk = Math.max(this.talk, message.value || 0);
    } else if (message.type === "pulse") {
      this.pulse = 1;
      this.talk = Math.min(1, this.talk + 0.55);
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
