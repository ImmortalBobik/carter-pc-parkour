import * as THREE from 'three';

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY = new THREE.Color('#e9eef5');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 35, 130);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);

scene.add(new THREE.HemisphereLight('#ffffff', '#aab6c8', 1.6));
const sun = new THREE.DirectionalLight('#fff3e3', 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------- face texture ----------
const FACE_KEY = 'carterpc-face-v2';
const faceCanvas = document.createElement('canvas');
faceCanvas.width = faceCanvas.height = 512;
const faceTex = new THREE.CanvasTexture(faceCanvas);
faceTex.colorSpace = THREE.SRGBColorSpace;
faceTex.anisotropy = 8;

// The face texture is wrapped onto the front of a round head, so it's drawn on a
// transparent canvas and the head's own skin/hair show around it.
function drawDefaultFace() {
  const c = faceCanvas.getContext('2d');
  c.clearRect(0, 0, 512, 512);
  c.fillStyle = '#3a2a22';
  c.beginPath(); c.ellipse(170, 175, 48, 11, -0.1, 0, Math.PI * 2); c.fill(); // brows
  c.beginPath(); c.ellipse(342, 175, 48, 11, 0.1, 0, Math.PI * 2); c.fill();
  for (const x of [170, 342]) {
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(x, 235, 34, 22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4a3324';
    c.beginPath(); c.arc(x, 235, 17, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111';
    c.beginPath(); c.arc(x, 235, 8, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = 'rgba(120,70,50,0.45)'; // nose
  c.lineWidth = 8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(256, 250); c.quadraticCurveTo(240, 320, 262, 328); c.stroke();
  c.strokeStyle = '#8a3b33'; // smile
  c.lineWidth = 10;
  c.beginPath(); c.arc(256, 340, 56, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
  faceTex.needsUpdate = true;
}

function drawImageFace(img) {
  const c = faceCanvas.getContext('2d');
  const s = 512;
  // the face patch on the head is a bit taller than wide, so crop to that shape
  const ASPECT = 0.875;
  let w = img.width, h = img.height;
  if (w / h > ASPECT) w = h * ASPECT; else h = w / ASPECT;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, s, s);
  c.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, s, s);
  // feather the edges so the photo blends into the head instead of showing a square
  c.save();
  c.globalCompositeOperation = 'destination-in';
  c.translate(256, 256);
  c.scale(0.78, 1);
  const g = c.createRadialGradient(0, 0, 130, 0, 0, 256);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(-310, -256, 620, 512);
  c.restore();
  faceTex.needsUpdate = true;
}

function updateFacePreview() {
  const el = document.getElementById('face-preview');
  el.style.backgroundImage = `url(${faceCanvas.toDataURL()})`;
  el.style.backgroundColor = '#' + skin.color.getHexString(THREE.SRGBColorSpace);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function initFace() {
  drawDefaultFace();
  let saved = null;
  try { saved = localStorage.getItem(FACE_KEY); } catch {}
  // Priority: uploaded face > public/carter.(png|jpg) > drawn default
  const sources = [saved, 'public/carter.png', 'public/carter.jpg'].filter(Boolean);
  for (const src of sources) {
    try {
      drawImageFace(await loadImage(src));
      break;
    } catch {}
  }
  updateFacePreview();
}
initFace();

document.getElementById('face-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const img = await loadImage(reader.result);
    drawImageFace(img);
    updateFacePreview();
    try { localStorage.setItem(FACE_KEY, reader.result); } catch {}
  };
  reader.readAsDataURL(file);
});

// ---------- level ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(7331);
const rr = (a, b) => a + rand() * (b - a);

const COLORS = {
  start: '#ffffff',
  static: '#ffffff',
  tiny: '#ffc8dd',
  move: '#9bd0ff',
  bounce: '#a8e6a1',
  checkpoint: '#ffe08a',
  reached: '#7ee0b0',
  goal: '#ffb703',
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);
const edgeMat = new THREE.LineBasicMaterial({ color: '#1d2433', transparent: true, opacity: 0.12 });
const platforms = [];

function addPlatform(x, top, z, sx, sy, sz, type = 'static', move = null) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS[type], roughness: 0.9 });
  const mesh = new THREE.Mesh(boxGeo, mat);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, top - sy / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
  scene.add(mesh);
  const p = {
    mesh, type, move,
    half: new THREE.Vector3(sx / 2, sy / 2, sz / 2),
    pos: mesh.position.clone(),
    base: mesh.position.clone(),
    delta: new THREE.Vector3(),
    reached: false,
  };
  platforms.push(p);
  return p;
}

function addFlag(p) {
  const top = p.pos.y + p.half.y;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 2.2),
    new THREE.MeshStandardMaterial({ color: '#1d2433' })
  );
  pole.position.set(p.pos.x + p.half.x - 0.4, top + 1.1, p.pos.z + p.half.z - 0.4);
  pole.castShadow = true;
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.45, 0.04),
    new THREE.MeshStandardMaterial({ color: '#ff6b4a' })
  );
  flag.position.set(0.37, 0.8, 0);
  pole.add(flag);
  scene.add(pole);
  p.flag = flag;
}

const checkpoints = [];
let cursor = { x: 0, y: 0, z: 0, half: 4 };
let heading = 0;

function next({ size = [2.4, 3.4], gap = [2.0, 3.0], dy = [-0.6, 1.0], type = 'static', thick = 1, move = null } = {}) {
  heading = THREE.MathUtils.clamp(heading + rr(-0.55, 0.55), -1.1, 1.1);
  const s = rr(size[0], size[1]);
  const dist = cursor.half + rr(gap[0], gap[1]) + s / 2;
  const dir = { x: Math.sin(heading), z: -Math.cos(heading) };
  const x = cursor.x + dir.x * dist;
  const z = cursor.z + dir.z * dist;
  const y = cursor.y + rr(dy[0], dy[1]);
  let mv = null;
  if (move === 'side') mv = { axis: new THREE.Vector3(dir.z, 0, -dir.x), amp: rr(2, 3), speed: rr(1.0, 1.6), phase: rand() * 6.28 };
  if (move === 'up') mv = { axis: new THREE.Vector3(0, 1, 0), amp: rr(1, 1.5), speed: rr(1.2, 1.8), phase: rand() * 6.28 };
  const p = addPlatform(x, y, z, s, thick, s, type, mv);
  cursor = { x, y, z, half: s / 2 };
  return p;
}

function checkpoint() {
  const p = next({ size: [4, 4], dy: [0, 0.5], type: 'checkpoint' });
  addFlag(p);
  checkpoints.push(p);
}

const start = addPlatform(0, 0, 0, 8, 1, 8, 'start');
checkpoints.push(start);
start.reached = true;

// 1 — warm up
for (let i = 0; i < 7; i++) next();
checkpoint();
// 2 — pillars
for (let i = 0; i < 7; i++) next({ size: [1.2, 1.6], gap: [1.8, 2.6], dy: [-0.3, 0.8], type: 'tiny', thick: 8 });
checkpoint();
// 3 — sliding platforms
for (let i = 0; i < 6; i++) next({ size: [2.4, 2.8], gap: [2.2, 2.8], dy: [-0.3, 0.6], type: 'move', move: 'side' });
checkpoint();
// 4 — bounce pads up a cliff
for (let i = 0; i < 3; i++) {
  next({ size: [2.4, 2.8], gap: [2.0, 2.6], dy: [-0.8, -0.2], type: 'bounce' });
  next({ size: [2.6, 3.2], gap: [1.4, 2.0], dy: [3.8, 4.4] });
}
checkpoint();
// 5 — the gauntlet
for (let i = 0; i < 9; i++) {
  if (i % 3 === 0) next({ size: [2.2, 2.6], gap: [2.2, 2.8], dy: [-0.2, 0.4], type: 'move', move: 'up' });
  else if (i % 3 === 1) next({ size: [1.1, 1.4], gap: [2.0, 2.8], dy: [-0.4, 0.6], type: 'tiny', thick: 8 });
  else next({ size: [2.0, 2.6], gap: [3.2, 4.0], dy: [-0.8, 0.2] });
}
// goal tower
const goal = next({ size: [5, 5], gap: [2.2, 2.6], dy: [0.5, 0.8], type: 'goal', thick: 14 });

const LOWEST = Math.min(...platforms.map((p) => p.pos.y - p.half.y));

// ambient floating cubes
const decor = [];
for (let i = 0; i < 70; i++) {
  const s = rr(0.6, 3);
  const m = new THREE.Mesh(
    boxGeo,
    new THREE.MeshStandardMaterial({ color: ['#ffffff', '#ffc8dd', '#9bd0ff', '#ffe08a', '#a8e6a1'][i % 5], roughness: 1 })
  );
  m.scale.setScalar(s);
  const a = rand() * Math.PI * 2;
  const r = rr(30, 90);
  m.position.set(Math.cos(a) * r, rr(-30, 25), Math.sin(a) * r - 60);
  m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
  m.userData.spin = new THREE.Vector3(rr(-0.3, 0.3), rr(-0.3, 0.3), 0);
  scene.add(m);
  decor.push(m);
}

// ---------- player ----------
// Matched to Carter's photo — tweak if needed.
const LOOK = {
  skin: '#a86a4c',
  hair: '#1a1214',
  shirt: '#1f2a52',
  pants: '#2b2f3a',
  shoes: '#f4f4f4',
};

const mat = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
const skin = mat(LOOK.skin, 0.6), hair = mat(LOOK.hair, 0.95), shirt = mat(LOOK.shirt), pants = mat(LOOK.pants), shoes = mat(LOOK.shoes, 0.5);
const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, emissiveMap: faceTex, emissive: '#ffffff', emissiveIntensity: 0.35, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 });

function add(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 16);
// joints are empty groups; rotating one swings everything below it
function joint(parent, x, y, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Feet at y = 0, facing +z, ~1.9 tall.
const playerGroup = new THREE.Group();
const body = joint(playerGroup, 0, 0); // squash/stretch + lean target

function makeLeg(side) {
  const hip = joint(body, side * 0.1, 0.9);
  add(capsule(0.085, 0.3), pants, hip, 0, -0.22);
  const knee = joint(hip, 0, -0.43);
  add(capsule(0.072, 0.3), pants, knee, 0, -0.2);
  const shoe = add(capsule(0.065, 0.14), shoes, knee, 0, -0.41, 0.04);
  shoe.rotation.x = Math.PI / 2;
  shoe.scale.set(1.15, 1, 0.8);
  return { hip, knee };
}
function makeArm(side) {
  const shoulder = joint(body, side * 0.25, 1.45);
  add(new THREE.SphereGeometry(0.075, 16, 12), shirt, shoulder); // rounded shoulder
  add(capsule(0.062, 0.2), shirt, shoulder, 0, -0.15);
  const elbow = joint(shoulder, 0, -0.3);
  add(capsule(0.05, 0.18), skin, elbow, 0, -0.13);
  const hand = add(new THREE.SphereGeometry(0.058, 16, 12), skin, elbow, 0, -0.3);
  hand.scale.set(0.85, 1.2, 1);
  return { shoulder, elbow };
}

const legL = makeLeg(-1), legR = makeLeg(1);
const hips = add(new THREE.SphereGeometry(1, 20, 14), pants, body, 0, 0.92);
hips.scale.set(0.2, 0.12, 0.13);
const torso = add(capsule(0.17, 0.3), shirt, body, 0, 1.18);
torso.scale.set(1.3, 1, 0.78);
const armL = makeArm(-1), armR = makeArm(1);
add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 16), skin, body, 0, 1.55);

// head: a slightly tall sphere, with the face wrapped onto its front
const headPivot = joint(body, 0, 1.6);
const head = add(new THREE.SphereGeometry(1, 32, 24), skin, headPivot, 0, 0.16);
head.scale.set(0.135, 0.165, 0.15);
// sphere patch centred on +z; its UVs span the full texture so the photo fills the face
const facePatch = new THREE.SphereGeometry(1.012, 32, 24, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.18, Math.PI * 0.62);
add(facePatch, faceMat, head).castShadow = false;
// hair cap tilted back so it covers the crown and back of the head
const hairCap = add(new THREE.SphereGeometry(1.06, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, head, 0, 0.04, -0.03);
hairCap.rotation.x = -0.35;
add(new THREE.SphereGeometry(1.04, 32, 16, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.42), hair, head);
// curly hair: a cloud of little spheres over the crown, fuller on top and at the back
const curlGeo = new THREE.SphereGeometry(1, 10, 8);
const curlRand = mulberry32(42);
for (let i = 0; i < 90; i++) {
  const theta = Math.acos(1 - curlRand() * 0.95); // 0 = top of head
  const phi = curlRand() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
  dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.4); // tilt back off the face
  if (dir.z > 0.55 && dir.y < 0.55) continue; // keep the forehead clear
  const curl = add(curlGeo, hair, head, dir.x * 1.05, dir.y * 1.05 + 0.05, dir.z * 1.05);
  curl.scale.setScalar(0.17 + curlRand() * 0.12);
}
for (const side of [-1, 1]) {
  const ear = add(new THREE.SphereGeometry(0.2, 12, 10), skin, head, side * 0.98, -0.05, 0);
  ear.scale.set(0.5, 1, 0.8);
}
scene.add(playerGroup);

const blob = new THREE.Mesh(
  new THREE.CircleGeometry(0.5, 32),
  new THREE.MeshBasicMaterial({ color: '#1d2433', transparent: true, opacity: 0.25, depthWrite: false })
);
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

const player = {
  pos: new THREE.Vector3(),
  prev: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  half: new THREE.Vector3(0.3, 0.95, 0.3),
  grounded: false,
  ground: null,
  coyote: 0,
  jumpBuf: 0,
  facing: 0,
  squash: 0,
  walk: 0,
};

const WALK = 7, SPRINT = 10.5, ACCEL_G = 70, ACCEL_A = 28;
const JUMP = 9.5, BOUNCE = 17, GRAVITY = 26, MAX_FALL = 32;

// ---------- particles ----------
const particles = [];
const partMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const partGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
function burst(pos, color = '#ffffff', n = 10) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, color === '#ffffff' ? partMat : new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2;
    m.userData = { vel: new THREE.Vector3(Math.cos(a) * rr(1, 3), rr(1, 3), Math.sin(a) * rr(1, 3)), life: 0.6 };
    scene.add(m);
    particles.push(m);
  }
}

// ---------- input ----------
const keys = new Set();
let yaw = 0, pitch = 0.4;
// Minecraft-style F5 views
const VIEWS = ['Third person', 'First person', 'Front view'];
let view = 0;
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') { player.jumpBuf = 0.12; e.preventDefault(); }
  if (e.code === 'KeyR' && state === 'playing') respawn(false);
  if ((e.code === 'F5' || e.code === 'KeyV') && state === 'playing') {
    e.preventDefault(); // stop F5 from reloading the page
    view = (view + 1) % VIEWS.length;
    toast(VIEWS[view]);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function lockPointer() {
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
}

// Mouse is locked to the centre like Roblox/Minecraft. Where the browser refuses
// pointer lock (e.g. embedded previews), the cursor is hidden and plain mouse
// movement still turns the camera.
let lockBlocked = false;
canvas.addEventListener('mousedown', () => {
  if (state === 'playing' && document.pointerLockElement !== canvas) lockPointer();
});
window.addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // ignore jumps when the cursor re-enters
  yaw -= e.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.0025, -1.4, 1.4);
});
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (wasLocked && !locked && state === 'playing') pause();
  wasLocked = locked;
  updateLockHint();
});
document.addEventListener('pointerlockerror', () => {
  lockBlocked = true;
  updateLockHint();
});
window.addEventListener('keydown', (e) => {
  // with a real lock the browser eats Esc and pointerlockchange pauses instead
  if (e.code === 'Escape' && state === 'playing' && document.pointerLockElement !== canvas) pause();
});
function updateLockHint() {
  const show = state === 'playing' && !lockBlocked && document.pointerLockElement !== canvas;
  document.getElementById('lock-hint').classList.toggle('hidden', !show);
}

// ---------- game state ----------
let state = 'menu';
let elapsed = 0, falls = 0, cpIndex = 0, timerStarted = false;
const $ = (id) => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), win = $('win'), toastEl = $('toast');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

function respawn(fell) {
  const cp = checkpoints[cpIndex];
  player.pos.set(cp.pos.x, cp.pos.y + cp.half.y + 1.5, cp.pos.z);
  player.vel.set(0, 0, 0);
  player.ground = null;
  player.grounded = false;
  if (fell) {
    falls++;
    toast(['Carter fell 💀', 'Try again', 'Unlucky', 'So close'][falls % 4]);
  }
}

function resetGame() {
  elapsed = 0; falls = 0; cpIndex = 0; timerStarted = false;
  checkpoints.forEach((c, i) => {
    c.reached = i === 0;
    if (i > 0) c.mesh.material.color.set(COLORS.checkpoint);
  });
  yaw = 0; pitch = 0.4;
  respawn(false);
}

function play() {
  if (state === 'won' || state === 'menu') resetGame();
  state = 'playing';
  menu.classList.add('hidden');
  win.classList.add('hidden');
  hud.classList.remove('hidden');
  document.body.classList.add('playing');
  lockPointer();
  updateLockHint();
}

function pause() {
  state = 'paused';
  $('play').textContent = 'RESUME';
  menu.classList.remove('hidden');
  document.body.classList.remove('playing');
  updateLockHint();
}

function finish() {
  state = 'won';
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  updateLockHint();
  hud.classList.add('hidden');
  let best = Infinity;
  try { best = parseFloat(localStorage.getItem('carterpc-best')) || Infinity; } catch {}
  const isBest = elapsed < best;
  if (isBest) { best = elapsed; try { localStorage.setItem('carterpc-best', String(elapsed)); } catch {} }
  $('win-time').textContent = elapsed.toFixed(2) + 's';
  $('win-stats').textContent = `${falls} fall${falls === 1 ? '' : 's'}`;
  $('win-best').textContent = isBest ? 'New personal best!' : `Best: ${best.toFixed(2)}s`;
  win.classList.remove('hidden');
  burst(player.pos, '#ffb703', 40);
}

$('play').addEventListener('click', play);
$('again').addEventListener('click', () => { state = 'won'; play(); });

// ---------- physics ----------
let simTime = 0;
const tmpWish = new THREE.Vector3();

function step(dt) {
  simTime += dt;

  for (const p of platforms) {
    if (!p.move) continue;
    const off = Math.sin(simTime * p.move.speed + p.move.phase) * p.move.amp;
    const np = p.base.clone().addScaledVector(p.move.axis, off);
    p.delta.subVectors(np, p.pos);
    p.pos.copy(np);
    p.mesh.position.copy(np);
  }

  if (player.ground) player.pos.add(player.ground.delta);

  // input → horizontal velocity
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  tmpWish.set(-Math.sin(yaw) * f + Math.cos(yaw) * r, 0, -Math.cos(yaw) * f - Math.sin(yaw) * r);
  if (tmpWish.lengthSq() > 0) {
    tmpWish.normalize();
    if (!timerStarted) timerStarted = true;
  }
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK;
  const accel = (player.grounded ? ACCEL_G : ACCEL_A) * dt;
  const dvx = tmpWish.x * speed - player.vel.x;
  const dvz = tmpWish.z * speed - player.vel.z;
  const dl = Math.hypot(dvx, dvz);
  const k = dl > accel ? accel / dl : 1;
  player.vel.x += dvx * k;
  player.vel.z += dvz * k;

  // jump
  player.coyote = player.grounded ? 0.1 : player.coyote - dt;
  player.jumpBuf -= dt;
  if (player.jumpBuf > 0 && player.coyote > 0) {
    player.vel.y = JUMP;
    player.coyote = 0;
    player.jumpBuf = 0;
    player.grounded = false;
    player.ground = null;
    player.squash = -0.6;
    timerStarted = true;
    burst(player.pos.clone().setY(player.pos.y - player.half.y), '#ffffff', 6);
  }

  // gravity (short hop when space released)
  const g = player.vel.y > 0 && !keys.has('Space') ? GRAVITY * 2 : GRAVITY;
  player.vel.y = Math.max(player.vel.y - g * dt, -MAX_FALL);

  player.prev.copy(player.pos);
  player.pos.addScaledVector(player.vel, dt);

  // collide
  const wasGrounded = player.grounded;
  const impact = player.vel.y;
  player.grounded = false;
  player.ground = null;
  const h = player.half, pos = player.pos;
  for (const p of platforms) {
    const ox = h.x + p.half.x - Math.abs(pos.x - p.pos.x);
    if (ox <= 0) continue;
    const oz = h.z + p.half.z - Math.abs(pos.z - p.pos.z);
    if (oz <= 0) continue;
    const oy = h.y + p.half.y - Math.abs(pos.y - p.pos.y);
    if (oy <= 0) continue;

    const top = p.pos.y + p.half.y;
    const bottom = p.pos.y - p.half.y;
    const prevTop = top - p.delta.y, prevBottom = bottom - p.delta.y;

    if (player.prev.y - h.y >= prevTop - 0.05) {
      pos.y = top + h.y;
      if (p.type === 'bounce') {
        player.vel.y = BOUNCE;
        player.squash = -0.8;
        burst(pos.clone().setY(top), COLORS.bounce, 12);
      } else {
        if (player.vel.y < 0) player.vel.y = 0;
        player.grounded = true;
        player.ground = p;
      }
    } else if (player.prev.y + h.y <= prevBottom + 0.05) {
      pos.y = bottom - h.y;
      if (player.vel.y > 0) player.vel.y = 0;
    } else if (ox < oz) {
      pos.x += pos.x > p.pos.x ? ox : -ox;
      player.vel.x = 0;
    } else {
      pos.z += pos.z > p.pos.z ? oz : -oz;
      player.vel.z = 0;
    }
  }

  if (player.grounded && !wasGrounded) {
    player.squash = Math.min(1, -impact / 18);
    if (impact < -6) burst(pos.clone().setY(pos.y - h.y), '#ffffff', 8);
    const p = player.ground;
    if (p.type === 'checkpoint' && !p.reached) {
      p.reached = true;
      p.mesh.material.color.set(COLORS.reached);
      cpIndex = checkpoints.indexOf(p);
      toast(`Checkpoint ${cpIndex} / ${checkpoints.length - 1}`);
      burst(pos.clone(), COLORS.reached, 20);
    }
    if (p === goal) finish();
  }

  if (pos.y < LOWEST - 12) respawn(true);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let acc = 0;
const FIXED = 1 / 120;
const camTarget = new THREE.Vector3();
respawn(false);
camTarget.copy(player.pos);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    acc += dt;
    while (acc >= FIXED) { step(FIXED); acc -= FIXED; if (state !== 'playing') break; }
    if (timerStarted) elapsed += dt;
    if (keys.has('KeyQ')) yaw += dt * 2.2;
    if (keys.has('KeyE')) yaw -= dt * 2.2;
  } else if (state === 'menu') {
    yaw += dt * 0.25;
  }

  // player visuals
  player.squash += (0 - player.squash) * Math.min(1, dt * 10);
  const sy = 1 - 0.25 * player.squash, sxz = 1 + 0.18 * player.squash;
  body.scale.set(sxz, sy, sxz);
  playerGroup.position.set(player.pos.x, player.pos.y - player.half.y, player.pos.z);

  // limb animation: run cycle with bending knees/elbows on the ground, arms up in the air
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  const ease = Math.min(1, dt * 14);
  const pose = {};
  if (player.grounded || state !== 'playing') {
    player.walk += dt * hSpeed * 1.5;
    const amt = Math.min(1, hSpeed / WALK);
    const w = player.walk;
    pose.hipL = -Math.sin(w) * 0.8 * amt;
    pose.hipR = Math.sin(w) * 0.8 * amt;
    pose.kneeL = (0.15 + Math.max(0, Math.cos(w)) * 1.1) * amt;
    pose.kneeR = (0.15 + Math.max(0, -Math.cos(w)) * 1.1) * amt;
    pose.shL = Math.sin(w) * 0.7 * amt;
    pose.shR = -Math.sin(w) * 0.7 * amt;
    pose.elL = pose.elR = -0.25 - 0.8 * amt;
    pose.spread = 0.08;
    pose.lean = 0.15 * amt;
  } else {
    const up = player.vel.y > 0;
    pose.hipL = up ? -1.0 : -0.4;
    pose.hipR = up ? 0.2 : -0.1;
    pose.kneeL = up ? 1.4 : 0.6;
    pose.kneeR = up ? 0.9 : 0.4;
    pose.shL = pose.shR = up ? -2.5 : -1.6;
    pose.elL = pose.elR = -0.3;
    pose.spread = 0.35;
    pose.lean = 0.08;
  }
  const to = (obj, key, v) => { obj[key] += (v - obj[key]) * ease; };
  to(legL.hip.rotation, 'x', pose.hipL); to(legR.hip.rotation, 'x', pose.hipR);
  to(legL.knee.rotation, 'x', pose.kneeL); to(legR.knee.rotation, 'x', pose.kneeR);
  to(armL.shoulder.rotation, 'x', pose.shL); to(armR.shoulder.rotation, 'x', pose.shR);
  to(armL.elbow.rotation, 'x', pose.elL); to(armR.elbow.rotation, 'x', pose.elR);
  to(armL.shoulder.rotation, 'z', -pose.spread); to(armR.shoulder.rotation, 'z', pose.spread);
  to(body.rotation, 'x', pose.lean);
  headPivot.rotation.x = -body.rotation.x * 0.6;
  // like Minecraft, Carter always turns to face where you're looking
  if (state !== 'menu') player.facing = yaw + Math.PI;
  let da = player.facing - playerGroup.rotation.y;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  playerGroup.rotation.y += da * Math.min(1, dt * 18);

  // blob shadow
  let best = -Infinity;
  for (const p of platforms) {
    if (Math.abs(player.pos.x - p.pos.x) > p.half.x || Math.abs(player.pos.z - p.pos.z) > p.half.z) continue;
    const top = p.pos.y + p.half.y;
    if (top <= player.pos.y - player.half.y + 0.01 && top > best) best = top;
  }
  blob.visible = best > -Infinity;
  if (blob.visible) {
    const d = player.pos.y - player.half.y - best;
    blob.position.set(player.pos.x, best + 0.02, player.pos.z);
    blob.scale.setScalar(Math.max(0.3, 1 - d * 0.08));
    blob.material.opacity = Math.max(0.05, 0.3 - d * 0.02);
  }

  // checkpoint flags wave
  for (const c of checkpoints) if (c.flag) c.flag.rotation.y = Math.sin(simTime * 4 + c.pos.x) * 0.3;

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const m = particles[i];
    m.userData.life -= dt;
    m.userData.vel.y -= 12 * dt;
    m.position.addScaledVector(m.userData.vel, dt);
    m.scale.setScalar(Math.max(0, m.userData.life / 0.6));
    if (m.userData.life <= 0) { scene.remove(m); particles.splice(i, 1); }
  }

  for (const m of decor) {
    m.rotation.x += m.userData.spin.x * dt;
    m.rotation.y += m.userData.spin.y * dt;
  }

  // camera
  camTarget.lerp(player.pos, 1 - Math.exp(-10 * dt));
  const mode = state === 'menu' ? 0 : view;
  headPivot.visible = mode !== 1; // don't see the inside of your own head
  if (mode === 1) {
    // first person: eyes at head height, looking along yaw/pitch
    const eye = playerGroup.position.clone().add(new THREE.Vector3(0, 1.78, 0));
    camera.position.copy(eye);
    camera.lookAt(
      eye.x - Math.sin(yaw) * Math.cos(pitch),
      eye.y - Math.sin(pitch),
      eye.z - Math.cos(yaw) * Math.cos(pitch)
    );
  } else {
    // third person sits behind you; front view swings round to face Carter
    const p = THREE.MathUtils.clamp(pitch, -0.3, 1.3);
    const side = mode === 2 ? -1 : 1;
    const dist = state === 'menu' ? 4.2 : mode === 2 ? 2.8 : 5.8;
    camera.position.set(
      camTarget.x + side * Math.sin(yaw) * Math.cos(p) * dist,
      camTarget.y + 0.8 + Math.sin(p) * dist,
      camTarget.z + side * Math.cos(yaw) * Math.cos(p) * dist
    );
    camera.lookAt(camTarget.x, camTarget.y + 0.8, camTarget.z);
  }

  sun.position.set(player.pos.x + 12, player.pos.y + 30, player.pos.z + 8);
  sun.target.position.copy(player.pos);

  // HUD
  if (state === 'playing') {
    $('time').textContent = elapsed.toFixed(2);
    $('cp').textContent = `${cpIndex} / ${checkpoints.length - 1}`;
    $('falls').textContent = falls;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
