import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PEOPLE, MEETINGS, READS } from './data.js';
import { meetingsFromResponse, freshMeetings, latestMeeting, whenOf, statusOf } from './script.js';
import { onScene } from './feed.js';
import { ambient } from './sound.js';
import { lowEnd, mannequinUrl } from './quality.js';

// The holo war room (owner 2026-11-19). People are life-size holograms that beam in around a projection table; the
// indicator analysts are holographic constructs, each with its own form; the platform agents are drones on patrol.
// It follows the real rooms: the page's one feed of GET /api/public/warroom-scene (feed.js, every minute), and a room
// that has just concluded meets
// here; between rooms the hall idles. Phones and small GPUs get the same scene without bloom at pixel ratio 1;
// prefers-reduced-motion stops the camera drift, the spins and the flicker.
const $ = (id) => document.getElementById(id);
const media = (q) => window.matchMedia?.(q).matches ?? false;
const TOUCH = media('(pointer: coarse)'), CALM = media('(prefers-reduced-motion: reduce)');
const LOW = lowEnd();
const MOTION = CALM ? 0.12 : 1, GAP_S = 4;
// Phones and small GPUs take the lighter mannequin; the file's hash is in the URL (site/room/quality.js).
const MANNEQUIN_URL = mannequinUrl(LOW);
const HOLO = 0x55c8ff, WARM = 0xffb454, BIAS = { neutral: 0xffb454, bearish: 0xff4d5e, bullish: 0x3ee08f }; // owner 2026-11-20: bearish red, bullish green, neutral amber
const CONSTRUCTS = ['prophet', 'trade_management', 'interstellar_eyes', 'kinetic_engine', 'fabio_amt', 'chronos_matrix', 'tactical_muscles', 'macro_aether', 'decision_matrix', 'supertrend', 'aegis_footprint', 'order_blocks'];
const LABEL = { hall: 'Analyst', lead: 'Leader', research: 'Research', content: 'Content studio', ops: 'Platform', knowledge: 'Knowledge' };
const Y = new THREE.Vector3(0, 1, 0), CORE = new THREE.Vector3(0, 2.75, 0);

let renderer, scene, camera, controls, clock, composer, mannequin;
const agents = [], byId = {}, hits = [], things = [], spinners = [];
const state = { bias: 'neutral', speaker: null, hover: null, card: null, meet: null, queue: [], pending: [], nextAt: 0, live: {}, polled: false, touched: 0, tween: null, sealed: 0, visible: true };
const time = { value: 0 }, tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), cA = new THREE.Color(), biasNow = new THREE.Color(BIAS.neutral);
const pol = (deg, r, y = 0) => { const t = THREE.MathUtils.degToRad(deg); return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r); };

/* ---------- the hologram material: rim light, scan lines, and a wipe that beams a figure in ---------- */
function holoMaterial(color = HOLO, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uReveal: { value: 1 }, uBase: { value: 0 }, uHeight: { value: 2 }, uTime: time, uBoost: { value: 0 } },
    vertexShader: `#include <common>\n#include <skinning_pars_vertex>\nvarying vec3 vN; varying vec3 vV; varying float vY;
void main(){\n#include <beginnormal_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\n#include <project_vertex>
vN = normalize(transformedNormal); vV = normalize(-mvPosition.xyz); vY = (modelMatrix * vec4(transformed, 1.0)).y; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uReveal, uBase, uHeight, uTime, uBoost; varying vec3 vN; varying vec3 vV; varying float vY;
void main(){ float h = (vY - uBase) / uHeight; if (h > uReveal) discard;
float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
float scan = 0.72 + 0.28 * sin(vY * 110.0 - uTime * 5.0);
float edge = smoothstep(0.06, 0.0, uReveal - h) * step(uReveal, 0.999);
float flick = 0.93 + 0.07 * sin(uTime * 23.0 + vY * 3.0);
float a = (0.07 + fres * 0.85 + uBoost * 0.12) * scan * flick + edge * 0.9;
gl_FragColor = vec4(uColor * (0.75 + fres * 0.9 + uBoost * 0.6) + edge, a * uOpacity); }`
  });
}
const lineMat = (color, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const edges = (geo, mat) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
function canvasTexture(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function screenTexture(seed) {
  return canvasTexture(512, 256, (g, w, h) => { g.fillStyle = 'rgba(8,24,44,.55)'; g.fillRect(0, 0, w, h); let s = seed * 9301 + 49297; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    g.strokeStyle = 'rgba(120,200,255,.25)'; g.lineWidth = 1; for (let y = 32; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } for (let x = 64; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.strokeStyle = '#8fdcff'; g.lineWidth = 3; g.beginPath(); let y = 70 + r() * 60; for (let x = 10; x < w - 10; x += 16) { y = Math.max(24, Math.min(h - 60, y + (r() - 0.42) * 30)); x === 10 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.fillStyle = 'rgba(143,220,255,.55)'; for (let i = 0; i < 22; i++) g.fillRect(14 + i * 22, h - 12 - r() * 44, 12, 60); });
}

function init() {
  const canvas = $('scene');
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: LOW ? 'default' : 'high-performance' }); } catch (e) { $('nogl').hidden = false; $('loading').hidden = true; return; }
  renderer.setPixelRatio(LOW ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x04060a); scene.fog = new THREE.FogExp2(0x04060a, 0.028);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.16;
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200); camera.position.set(0, 5.4, 16.5);
  controls = new OrbitControls(camera, canvas); controls.target.set(0, 2.0, 0); controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false; controls.minDistance = 5; controls.maxDistance = 24; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.5; controls.autoRotate = !CALM; controls.autoRotateSpeed = 0.28;
  // On a touch screen a drag scrolls the page (the scene still answers a tap); the camera drifts on its own.
  if (TOUCH) { controls.enableRotate = false; canvas.closest('.room')?.classList.add('touch'); canvas.style.touchAction = 'pan-y'; }
  controls.addEventListener('start', () => { state.touched = performance.now(); });
  clock = new THREE.Clock();
  scene.add(new THREE.AmbientLight(0x35507a, 0.5));
  state.coreLight = new THREE.PointLight(BIAS.bearish, 120, 40, 1.8); state.coreLight.position.copy(CORE); scene.add(state.coreLight);
  scene.add(new THREE.HemisphereLight(0x5b7fb5, 0x05070b, 0.55));
  // The bloom pass is the costly part: phones and small GPUs render without it.
  if (!LOW) { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.5, 0.55)); composer.addPass(new OutputPass()); }
  buildRoom(); buildTable(); buildAether(); buildCorpus(); buildVault(); bindUi(); resize(); window.addEventListener('resize', resize);
  // The page starts the mannequin's download with the scene's (site/home/home.js); without it the loader fetches it here.
  const loader = new GLTFLoader();
  Promise.resolve(window.__mannequin ?? null).then((buf) => (buf ? loader.parseAsync(buf, '/room/') : loader.loadAsync(MANNEQUIN_URL))).then((g) => { mannequin = g.scene; buildAgents(); $('loading').hidden = true; onScene(take); }).catch((e) => { console.error(e); $('loading').textContent = 'The scene did not load.'; });
  // Draw only while the room is on screen and the tab is visible.
  const run = () => renderer.setAnimationLoop(state.visible && !document.hidden ? frame : null);
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; run(); }).observe(canvas);
  document.addEventListener('visibilitychange', run); run();
}

/* ---------- the room ---------- */
function buildRoom() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x0a0e15, metalness: 0.55, roughness: 0.62 }), dark = new THREE.MeshStandardMaterial({ color: 0x080b11, metalness: 0.6, roughness: 0.55 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(19, 96), metal); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  [6.4, 9.2, 14.2].forEach((r, i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 160), new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: [0.7, 0.3, 0.22][i] })); t.rotation.x = Math.PI / 2; t.position.y = 0.012; scene.add(t); });
  for (let i = 0; i < 24; i++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 4.6), new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.16 })); const p = pol(i * 15, 11.6, 0.01); l.position.copy(p); l.rotation.x = -Math.PI / 2; l.rotation.z = -THREE.MathUtils.degToRad(i * 15) + Math.PI / 2; scene.add(l); }
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(18.5, 18.5, 9, 72, 1, true), new THREE.MeshStandardMaterial({ color: 0x0a0e15, metalness: 0.7, roughness: 0.5, side: THREE.BackSide })); wall.position.y = 4.5; scene.add(wall);
  for (let i = 0; i < 36; i++) { const a = i * 10, rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.35), dark); rib.position.copy(pol(a, 18.2, 4.5)); rib.lookAt(0, 4.5, 0); scene.add(rib);
    if (i % 3 === 0) { const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 6.5), new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.75 })); strip.position.copy(pol(a + 5, 18.1, 4.2)); strip.lookAt(0, 4.2, 0); scene.add(strip); } }
  const ceil = new THREE.Mesh(new THREE.RingGeometry(4.2, 19, 72), dark); ceil.rotation.x = Math.PI / 2; ceil.position.y = 9; scene.add(ceil);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.09, 8, 120), new THREE.MeshBasicMaterial({ color: 0xbfe4ff })); halo.rotation.x = Math.PI / 2; halo.position.y = 8.95; scene.add(halo);
  // wall screens the research desk works at
  for (let i = 0; i < 7; i++) { const a = 228 + i * 14, s = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), new THREE.MeshBasicMaterial({ map: screenTexture(i + 3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); s.position.copy(pol(a, 13.4, 2.5)); s.lookAt(0, 2.5, 0); scene.add(s); }
}
function buildTable() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x0d121b, metalness: 0.9, roughness: 0.25 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, 0.95, 64), metal); base.position.y = 0.475; scene.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x05080d, metalness: 0.7, roughness: 0.45 })); top.position.y = 0.99; scene.add(top);
  state.accent = [];
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.03, 8, 128), new THREE.MeshBasicMaterial({ color: BIAS.bearish })); rim.rotation.x = Math.PI / 2; rim.position.y = 1.04; scene.add(rim); state.accent.push(rim.material);
  for (let r = 0.8; r < 3; r += 0.7) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 96), new THREE.MeshBasicMaterial({ color: BIAS.bearish, transparent: true, opacity: 0.6 })); t.rotation.x = Math.PI / 2; t.position.y = 1.035; scene.add(t); state.accent.push(t.material); }
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.5, 2.6, 48, 1, true), new THREE.MeshBasicMaterial({ color: BIAS.bearish, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); cone.position.y = 2.3; scene.add(cone); state.accent.push(cone.material);
  // the Cerebrum core: a wire brain of nodes and links inside two shells
  const g = new THREE.Group(); g.position.copy(CORE); scene.add(g); state.core = g;
  const shellM = holoMaterial(BIAS.bearish, 0.9); state.coreShell = shellM; g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 3), shellM));
  const wm = lineMat(BIAS.bearish, 0.5); state.accent.push(wm); const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.27, 1)), wm); g.add(wire); spinners.push({ o: wire, y: 0.12, x: 0.04 });
  const N = 70, pts = [], links = []; for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, t = Math.random() * 6.283, r = 0.25 + Math.random() * 0.8, s = Math.sqrt(1 - u * u); pts.push(new THREE.Vector3(s * Math.cos(t) * r, u * r, s * Math.sin(t) * r)); }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (pts[i].distanceTo(pts[j]) < 0.42) links.push(pts[i], pts[j]);
  const nm = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }); const net = new THREE.Group(); net.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), nm));
  const lm = lineMat(BIAS.bearish, 0.55); state.accent.push(lm); net.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(links), lm)); g.add(net); spinners.push({ o: net, y: -0.2 }); state.net = net;
  [1.6, 1.85].forEach((r, i) => { const m = lineMat(BIAS.bearish, 0.8); state.accent.push(m); const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 120), new THREE.MeshBasicMaterial({ color: BIAS.bearish, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); state.accent.push(ring.material); ring.rotation.x = 1.2 + i * 0.6; g.add(ring); spinners.push({ o: ring, y: i ? -0.35 : 0.5, x: i ? 0.2 : -0.12 }); });
  // the seal that closes over the core during a huddle
  state.seal = new THREE.Group(); g.add(state.seal); state.seal.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.34, 1), new THREE.MeshStandardMaterial({ color: 0x05070a, metalness: 1, roughness: 0.22, flatShading: true }))); state.seal.add(edges(new THREE.IcosahedronGeometry(1.35, 1), lineMat(WARM, 0.9))); state.seal.scale.setScalar(0.001);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshBasicMaterial()); hit.visible = false; g.add(hit); addThing(hit, g, 'Cerebrum', 'Core', 'The core every meeting gathers around. It glows red when the room reads gold as bearish, green when bullish and amber when undecided, and seals itself for the final huddle.', 2.1);
  state.link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(0xffffff, 0.75)); state.link.frustumCulled = false; state.link.visible = false; scene.add(state.link);
}
function addThing(hit, group, name, kind, role, h) { const t = { name, kind, role, group, h, thing: true }; hit.userData.thing = t; hits.push(hit); things.push(t); return t; }
function buildAether() {
  const tilt = new THREE.Group(); tilt.position.set(0, 5.1, 0); tilt.rotation.set(0.22, 0, 0.08); scene.add(tilt); const ring = new THREE.Group(); tilt.add(ring); state.aether = ring;
  const m = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const t1 = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.018, 6, 160), m); t1.rotation.x = Math.PI / 2; ring.add(t1);
  const tk = []; for (let d = 0; d < 360; d += 6) { const a = THREE.MathUtils.degToRad(d), l = d % 30 === 0 ? 0.22 : 0.09; tk.push(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4, Math.cos(a) * (3.4 + l), 0, Math.sin(a) * (3.4 + l)); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tk, 3)); ring.add(new THREE.LineSegments(tg, lineMat(0xbfe9ff, 0.7)));
  state.pointer = new THREE.Group(); tilt.add(state.pointer); const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute([2.3, 0, 0, 3.75, 0, 0, 3.75, 0, 0, 3.5, 0, 0.13, 3.75, 0, 0, 3.5, 0, -0.13], 3)); state.pointer.add(new THREE.LineSegments(pg, lineMat(WARM, 1)));
  const hit = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.35, 6, 40), new THREE.MeshBasicMaterial()); hit.rotation.x = Math.PI / 2; hit.visible = false; ring.add(hit); addThing(hit, tilt, 'Aether', 'Navigator', 'The navigator: a compass ring above the table whose pointer swings to whoever is speaking.', 0.5);
}
function buildCorpus() {
  const P = pol(205, 12.6), g = new THREE.Group(); g.position.copy(P); scene.add(g); state.corpus = g;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x0d121b, metalness: 0.9, roughness: 0.3 })); pad.position.y = 0.15; g.add(pad);
  state.slabs = []; for (let i = 0; i < 9; i++) { const geo = new THREE.CylinderGeometry(1.05 - (i % 2) * 0.18, 1.05 - (i % 2) * 0.18, 0.34, 6); const s = new THREE.Group(); s.add(new THREE.Mesh(geo, holoMaterial(0x9a8cff, 0.55))); s.add(edges(geo, lineMat(0xc6bcff, 0.8))); s.position.y = 0.75 + i * 0.52; g.add(s); state.slabs.push(s); }
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 5.2, 8), new THREE.MeshBasicMaterial()); hit.position.y = 2.9; hit.visible = false; g.add(hit); addThing(hit, g, 'Corpus', 'Oracle', 'The oracle: the store of market data every analyst reads, from the 15-minute chart to the daily one.', 5.6);
  const a = P.clone().setY(0.02), b = new THREE.Vector3(P.x * 0.24, 0.02, P.z * 0.24); state.feed = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: 0xc6bcff, dashSize: 0.3, gapSize: 0.5, transparent: true, opacity: 0.85 })); state.feed.computeLineDistances(); scene.add(state.feed);
}
function buildVault() {
  const P = pol(335, 18.0, 3.4), g = new THREE.Group(); g.position.copy(P); g.lookAt(0, 3.4, 0); scene.add(g);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 48), new THREE.MeshStandardMaterial({ color: 0x06080c, metalness: 1, roughness: 0.3 })); door.rotation.x = Math.PI / 2; g.add(door);
  [2.6, 1.9, 1.1].forEach((r) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 8, 96), new THREE.MeshBasicMaterial({ color: WARM })); t.position.z = 0.27; g.add(t); });
  state.vaultBars = new THREE.Group(); state.vaultBars.position.z = 0.28; g.add(state.vaultBars); for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.04), new THREE.MeshBasicMaterial({ color: WARM })); b.position.set(Math.sin(i * 1.047) * 1.5, Math.cos(i * 1.047) * 1.5, 0); b.rotation.z = -i * 1.047; state.vaultBars.add(b); }
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.8, 16), new THREE.MeshBasicMaterial()); hit.rotation.x = Math.PI / 2; hit.visible = false; g.add(hit); addThing(hit, g, 'Sealed vault', 'Never shown', 'What stays private stays behind this door. Past readings are published only as a recap of the last 24 hours.', 3.0);
}


/* ---------- role icons: one badge above every agent ---------- */
const SHIELD = 'M12 3l7 3v5c0 5-3 8-7 10c-4-2-7-5-7-10V6z', CIRCLE = 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18';
const ICON = {
  news: CIRCLE + 'M3 12h18M12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18', technical: 'M12 2v4M12 18v4M8 6h8v12H8z', risk: SHIELD, projection: 'M4 12L20 5M4 12L20 19M20 5v14',
  prophet: 'M12 2l7 7l-7 13l-7-13zM5 9h14M9 9l3 13l3-13', trade_management: 'M7 3.5h10l5 8.5-5 8.5H7L2 12zM9 12h6', interstellar_eyes: 'M2 12c3-6 17-6 20 0c-3 6-17 6-20 0M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6',
  kinetic_engine: 'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16M3 12c0-3 18-3 18 0c0 3-18 3-18 0M12 3c-3 0-3 18 0 18c3 0 3-18 0-18', fabio_amt: 'M5 20v-6M10 20V8M15 20V10M20 20V4', chronos_matrix: CIRCLE + 'M12 7v5l4 2',
  tactical_muscles: 'M13 2L5 13h6l-1 9l8-11h-6z', macro_aether: 'M12 6a6 6 0 1 0 0 12a6 6 0 0 0 0-12M2 15c3 3 17-3 20-6', decision_matrix: 'M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  supertrend: 'M3 17l6-6l4 4l8-9M15 6h6v6', aegis_footprint: 'M4 7l8-4l8 4M4 12l8-4l8 4M4 17l8-4l8 4', order_blocks: 'M4 16h10v4H4zM8 10h10v4H8zM5 4h10v4H5z',
  moderator: 'M12 3l2.7 5.8l6.3.8l-4.6 4.3l1.2 6.2L12 17l-5.6 3.1l1.2-6.2L3 9.6l6.3-.8z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5', dollar: 'M12 2v20M17 7c-1-3-10-3-10 1.5S17 11 17 15.5S8 20 7 17', rates: 'M5 19L19 5M7 5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M17 14a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5',
  silver: 'M7 8h10l4 10H3zM7 8l-1.5 5h13L17 8', oil: 'M12 3c4 5 7 8 7 12a7 7 0 0 1-14 0c0-4 3-7 7-12', correlation: 'M9 12a4 4 0 0 1 4-4h4a4 4 0 0 1 0 8h-2M15 12a4 4 0 0 1-4 4H7a4 4 0 0 1 0-8h2',
  syn_analyst: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M15.5 15.5L21 21', syn_counselor: 'M4 5h16v11H11l-5 4v-4H4z', syn_reasoner: 'M5 4v5c0 3 7 3 7 7v4M19 4v5c0 3-7 3-7 7',
  cta_editor: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4', cta_guardian: SHIELD + 'M8.5 12l2.5 2.5l4.5-5',
  ae_auditor: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M15.5 15.5L21 21M8 10.5l2 2l3.5-4', ae_calibrator: 'M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M7 15v4', ae_curator: 'M4 5c3-1 6-1 8 1c2-2 5-2 8-1v14c-3-1-6-1-8 1c-2-2-5-2-8-1zM12 6v14',
  ae_guardian: SHIELD + 'M12 8.5l1 2.3l2.5.2l-1.9 1.6l.6 2.4L12 13.7l-2.2 1.3l.6-2.4l-1.9-1.6l2.5-.2z', ae_council: 'M12 4a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M5 14a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M19 14a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M10 9l-3 5M14 9l3 5M8 17h8',
  supervisor: 'M12 12L19 5M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5', auditor: 'M9 3L7 21M17 3l-2 18M4 9h17M3 15h17', signal_analyst: 'M12 12v.01M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  adr_steward: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7', evolver: 'M4 11a8 8 0 0 1 14-4M20 4v4h-4M20 13a8 8 0 0 1-14 4M4 20v-4h4', audit_ledger: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  orchestrator: 'M12 15V3M7 8l5-5l5 5M5 20h14', drift: CIRCLE + 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8M16 8l4-4', platform_api: 'M8 7l-5 5l5 5M16 7l5 5l-5 5M13.5 5l-3 14',
  registry: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01', policy: 'M12 4v16M7 20h10M5 8h14M5 8l-2.5 6h5zM19 8l-2.5 6h5z', recovery: 'M4 8v5h5M4.5 13a8 8 0 1 0 2.5-6'
};
const MARK = { m15: '15', h1: '1H', h4: '4H', d1: '1D' };
// One word per agent, shown everywhere a name appears (site/room/data.js `name`).
const nameOf = (def) => def.name;
// Badge colours are the obsidian console's six accents, given by what the agent works on.
const OBS = { green: '#3fb950', red: '#f85149', amber: '#e3b341', blue: '#58a6ff', purple: '#bc8cff', cyan: '#39d0d8' };
const TINT = {
  news: 'amber', macro_aether: 'amber', calendar: 'amber', dollar: 'amber', rates: 'amber', silver: 'amber', oil: 'amber', correlation: 'amber',
  prophet: 'blue', supertrend: 'blue', kinetic_engine: 'blue', decision_matrix: 'blue',
  technical: 'cyan', chronos_matrix: 'cyan', interstellar_eyes: 'cyan', projection: 'cyan',
  fabio_amt: 'purple', aegis_footprint: 'purple', order_blocks: 'purple', risk: 'red', tactical_muscles: 'green', trade_management: 'green',
  m15: 'amber', h1: 'amber', h4: 'amber', d1: 'amber', moderator: 'amber', syn_analyst: 'purple', syn_counselor: 'purple', syn_reasoner: 'purple', cta_editor: 'cyan', cta_guardian: 'green',
  ae_auditor: 'amber', ae_calibrator: 'blue', ae_curator: 'purple', ae_guardian: 'green', ae_council: 'cyan',
  supervisor: 'blue', auditor: 'amber', signal_analyst: 'cyan', adr_steward: 'purple', evolver: 'green', audit_ledger: 'amber', orchestrator: 'blue', drift: 'red', platform_api: 'cyan', registry: 'purple', policy: 'green', recovery: 'red'
};
function badge(def) {
  const c = OBS[TINT[def.id] || 'blue'];
  const tex = canvasTexture(128, 128, (g) => { g.fillStyle = 'rgba(13,17,23,.92)'; g.beginPath(); g.arc(64, 64, 57, 0, 7); g.fill(); g.globalAlpha = 0.16; g.fillStyle = c; g.fill(); g.globalAlpha = 1; g.lineWidth = 5; g.strokeStyle = c; g.stroke();
    if (MARK[def.id]) { g.fillStyle = c; g.font = '700 54px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(MARK[def.id], 64, 68); }
    else { g.translate(64 - 12 * 3.3, 64 - 12 * 3.3); g.scale(3.3, 3.3); g.lineWidth = 1.9; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = c; g.stroke(new Path2D(ICON[def.id] || CIRCLE)); } });
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
}

/* ---------- constructs: one form per indicator analyst ---------- */
function construct(id, mat, lm) {
  const g = new THREE.Group(), add = (geo, p, s) => { const o = new THREE.Group(); o.add(new THREE.Mesh(geo, mat)); o.add(edges(geo, lm)); if (p) o.position.set(...p); if (s) o.scale.set(...s); g.add(o); return o; }, spin = (o, y = 0, x = 0, z = 0) => { spinners.push({ o, y, x, z }); return o; };
  const ring = (r, rot) => { const o = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 6, 64), new THREE.MeshBasicMaterial({ color: lm.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); if (rot) o.rotation.set(...rot); g.add(o); return o; };
  if (id === 'prophet') { spin(add(new THREE.TetrahedronGeometry(0.42)), 0.6, 0.2); const orb = new THREE.Group(); g.add(orb); for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat); s.position.set(Math.cos(i * 2.09) * 0.62, 0, Math.sin(i * 2.09) * 0.62); orb.add(s); } spin(orb, -1.1); }
  else if (id === 'trade_management') { for (let i = 0; i < 3; i++) spin(add(new THREE.CylinderGeometry(0.42 - i * 0.07, 0.42 - i * 0.07, 0.1, 6), [0, -0.24 + i * 0.24, 0]), i % 2 ? 0.5 : -0.5); }
  else if (id === 'interstellar_eyes') { ring(0.5, [0, 0, 0]); ring(0.36, [0, 0, 0]); const eye = add(new THREE.SphereGeometry(0.17, 16, 12)); g.userData.look = eye; }
  else if (id === 'kinetic_engine') { spin(ring(0.5), 0, 1.1); spin(ring(0.4), 1.3, 0, 0.4); spin(ring(0.3), 0, -1.7, 0.9); add(new THREE.OctahedronGeometry(0.12)); }
  else if (id === 'fabio_amt') { g.userData.bars = []; for (let i = 0; i < 6; i++) g.userData.bars.push(add(new THREE.BoxGeometry(0.11, 1, 0.11), [-0.4 + i * 0.16, 0, 0], [1, 0.4, 1])); }
  else if (id === 'chronos_matrix') { ring(0.5); const h1 = add(new THREE.BoxGeometry(0.03, 0.42, 0.02), [0, 0.19, 0]), p1 = new THREE.Group(); p1.add(h1); g.add(p1); spin(p1, 0, 0, -0.9); const h2 = add(new THREE.BoxGeometry(0.035, 0.28, 0.02), [0, 0.12, 0]), p2 = new THREE.Group(); p2.add(h2); g.add(p2); spin(p2, 0, 0, -0.12); for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(0.02, 0.07, 0.02), [Math.sin(i * 0.5236) * 0.5, Math.cos(i * 0.5236) * 0.5, 0]).rotation.z = -i * 0.5236; }
  else if (id === 'tactical_muscles') { const n = 40, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)); const l = new THREE.Line(geo, lm); g.add(l); g.userData.wave = l; ring(0.52); }
  else if (id === 'macro_aether') { const s = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(0.4, 10, 7)), lm); g.add(s); spin(s, 0.5); g.add(new THREE.Mesh(new THREE.SphereGeometry(0.39, 16, 12), mat)); spin(ring(0.58, [1.2, 0, 0.3]), 0, 0, 0.6); }
  else if (id === 'decision_matrix') { const c = new THREE.Group(); g.add(c); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const b = edges(new THREE.BoxGeometry(0.15, 0.15, 0.15), lm); b.position.set(x * 0.24, y * 0.24, z * 0.24); c.add(b); } spin(c, 0.4, 0.25); }
  else if (id === 'supertrend') { const pts = [[-0.5, -0.3], [-0.2, -0.3], [-0.2, -0.05], [0.1, -0.05], [0.1, 0.2], [0.42, 0.2]].map(([x, y]) => new THREE.Vector3(x, y, 0)); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm)); const head = add(new THREE.ConeGeometry(0.11, 0.24, 4), [0.5, 0.2, 0]); head.rotation.z = -Math.PI / 2; spin(g, 0.35); }
  else if (id === 'aegis_footprint') { const sh = new THREE.Shape(); sh.moveTo(0, 0.52); sh.lineTo(0.4, 0.34); sh.lineTo(0.4, -0.05); sh.quadraticCurveTo(0.36, -0.38, 0, -0.55); sh.quadraticCurveTo(-0.36, -0.38, -0.4, -0.05); sh.lineTo(-0.4, 0.34); sh.closePath(); const geo = new THREE.ShapeGeometry(sh); g.add(new THREE.Mesh(geo, mat)); g.add(edges(geo, lm)); for (let i = -1; i <= 1; i++) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.36, i * 0.2 + 0.05, 0.01), new THREE.Vector3(0.36, i * 0.2 + 0.05, 0.01)]), lm)); g.userData.sway = true; }
  else if (id === 'order_blocks') { for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.5, 0.16, 0.34), [(i % 2 ? 0.1 : -0.1), -0.33 + i * 0.22, 0]); spin(g, 0.3); }
  else if (id === 'sat') { spin(add(new THREE.OctahedronGeometry(0.16)), 1.2, 0.4); }
  else { const body = add(new THREE.OctahedronGeometry(0.2), null, [1.5, 0.55, 1.5]); ring(0.36, [Math.PI / 2, 0, 0]); const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: WARM, transparent: true })); eye.position.set(0, -0.05, 0.3); g.add(eye); g.userData.eye = eye; }
  return g;
}

/* ---------- people: one mannequin, posed by aiming its bones ---------- */
function aim(bone, child, dir) {
  bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false); bone.getWorldPosition(tmpV); child.getWorldPosition(tmpV2); tmpV2.sub(tmpV).normalize();
  tmpQ.setFromUnitVectors(tmpV2, tmpV.copy(dir).normalize()); bone.parent.getWorldQuaternion(tmpQ2); bone.quaternion.premultiply(tmpQ2.clone().invert().multiply(tmpQ).multiply(tmpQ2));
}
const POSE = {
  stand: { ua: [0.14, -1, 0.02], fa: [0.06, -1, 0.14] }, crossed: { ua: [0.12, -1, 0.3], fa: [-0.9, 0.12, 0.45] }, hips: { ua: [0.6, -0.8, -0.12], fa: [-0.5, -0.6, 0.3] },
  tablet: { ua: [0.1, -1, 0.18], fa: [-0.28, 0.16, 1] }, lean: { ua: [0.2, -0.72, 0.68], fa: [0.04, -0.8, 0.6], spine: 0.2 },
  point: { ua: [0.14, -1, 0.02], fa: [0.06, -1, 0.14], rua: [0.3, -0.15, 1], rfa: [0.12, 0.05, 1] }, chin: { ua: [0.12, -1, 0.28], fa: [-0.9, 0.08, 0.5], rua: [0.1, -0.9, 0.42], rfa: [-0.3, 0.95, 0.22] },
  talk: { ua: [0.14, -1, 0.02], fa: [0.06, -1, 0.14], rua: [0.2, -0.85, 0.5], rfa: [0.05, 0.35, 0.95] }
};
function applyPose(a, name) {
  const p = POSE[name], B = a.bones; a.pose = name; for (const [k, q] of Object.entries(a.rest)) B[k].quaternion.copy(q);
  a.root.updateWorldMatrix(true, true); a.root.getWorldQuaternion(a.rootQ = a.rootQ || new THREE.Quaternion());
  const d = (v, s) => new THREE.Vector3(v[0] * s, v[1], v[2]).applyQuaternion(a.rootQ);
  if (p.spine) { B.spine_01.rotateOnWorldAxis(tmpV.set(1, 0, 0).applyQuaternion(a.rootQ), p.spine); }
  for (const side of ['l', 'r']) { const s = (side === 'l' ? 1 : -1) * a.sideSign, ua = side === 'r' && p.rua ? p.rua : p.ua, fa = side === 'r' && p.rfa ? p.rfa : p.fa;
    aim(B['upperarm_' + side], B['lowerarm_' + side], d(ua, s)); aim(B['lowerarm_' + side], B['hand_' + side], d(fa, s)); }
}
function makePerson(def, i) {
  const body = SkeletonUtils.clone(mannequin), root = new THREE.Group(); root.add(body);
  const lead = def.dept === 'lead', mat = holoMaterial(lead ? 0xffd9a0 : HOLO, 0.95); body.traverse((o) => { if (o.isMesh) { o.material = mat; o.frustumCulled = false; } });
  const h = lead ? 1.06 : 0.94 + ((i * 37) % 11) / 100, w = 0.92 + ((i * 53) % 17) / 100; body.scale.set(h * w, h, h * w); mat.uniforms.uHeight.value = 1.95 * h;
  const bones = {}, rest = {}; body.traverse((o) => { if (o.isBone) { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); } });
  // a little gear so silhouettes differ: a visor, a collar, or shoulder plates, each riding a bone
  const lm = lineMat(lead ? 0xffd9a0 : 0x9fe0ff, 0.9), gear = i % 3;
  if (gear === 0) { const v = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 32, Math.PI), new THREE.MeshBasicMaterial({ color: lm.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); v.position.set(0, 0.09, 0.02); v.rotation.x = -Math.PI / 2; bones.Head.add(v); }
  else if (gear === 1) { const c = edges(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 8, 1, true), lm); c.position.set(0, 0.2, 0); bones.spine_03.add(c); }
  else { for (const s of ['l', 'r']) { const pl = edges(new THREE.BoxGeometry(0.2, 0.05, 0.16), lm); pl.position.set(0, 0.1, 0); bones['clavicle_' + s].add(pl); } }
  if (lead) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 6, 48), new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); band.rotation.x = Math.PI / 2; band.position.y = 0.04; root.add(band); }
  scene.add(root); return { root, mat, bones, rest, human: true };
}

function buildAgents() {
  const of = (d) => PEOPLE.filter((p) => p.dept === d);
  mannequin.updateWorldMatrix(true, true); const probe = {}; mannequin.traverse((o) => { if (o.isBone) probe[o.name] = o; }); const side = Math.sign(probe.upperarm_l.getWorldPosition(new THREE.Vector3()).x) || 1;
  const add = (def, home, face, o) => { const a = { id: def.id, def, dept: def.dept, home: home.clone(), face, pos: home.clone(), reveal: 1, want: 1, seed: agents.length * 1.31, sideSign: side, ...o }; agents.push(a); byId[a.id] = a;
    const hit = new THREE.Mesh(a.human ? new THREE.CapsuleGeometry(0.34, 1.2, 2, 6) : new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial()); hit.visible = false; hit.userData.person = a; scene.add(hit); a.hit = hit; hits.push(hit);
    const ic = badge(def), sz = a.human ? 0.46 : a.rides ? 0.3 : a.drone ? 0.38 : 0.46; ic.scale.setScalar(sz); ic.position.y = a.human ? a.tall + 0.2 : a.rides ? 0.42 : a.drone ? 0.6 : 0.98; a.root.add(ic); a.icon = ic; a.iconSize = sz; return a; };
  const faceTo = (p, target = CORE) => Math.atan2(target.x - p.x, target.z - p.z);
  // the analysts' ring: four people and twelve constructs, alternating around the table
  const hall = of('hall'), humans = hall.filter((p) => !CONSTRUCTS.includes(p.id)), cons = hall.filter((p) => CONSTRUCTS.includes(p.id)), order = []; let hi = 0, ci = 0;
  for (let k = 0; k < 16; k++) order.push(k % 4 === 0 ? humans[hi++] : cons[ci++]);
  order.forEach((def, k) => { const deg = 90 + k * 22.5;
    if (CONSTRUCTS.includes(def.id)) { const mat = holoMaterial(HOLO, 0.8), lm = lineMat(0x9fe0ff, 0.95), g = construct(def.id, mat, lm), p = pol(deg, 5.3, 1.55); g.position.copy(p); g.rotation.y = faceTo(p); scene.add(g);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.16, 1.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.set(p.x, 0.6, p.z); scene.add(beam);
      add(def, p, g.rotation.y, { root: g, mat, lm, tall: 0.75 }); }
    else { const p = pol(deg, 5.3), m = makePerson(def, k); m.root.position.copy(p); m.root.rotation.y = faceTo(p); const a = add(def, p, m.root.rotation.y, { ...m, tall: 1.95, basePose: ['tablet', 'crossed', 'chin', 'hips'][hi % 4] }); applyPose(a, a.basePose); } });
  // the leaders wait in their own bays along the wall, and beam to the table for a meeting
  of('lead').forEach((def, k) => { const p = pol(350 + k * 18, 13.2), m = makePerson(def, k + 20); m.root.position.copy(p); m.root.rotation.y = faceTo(p); const a = add(def, p, m.root.rotation.y, { ...m, tall: 2.05, basePose: k % 2 ? 'hips' : 'stand' }); applyPose(a, a.basePose);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.02, 6, 48), new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.7 })); pad.rotation.x = Math.PI / 2; pad.position.set(p.x, 0.02, p.z); scene.add(pad); });
  // research works the wall screens; content shares a console
  of('research').forEach((def, k) => { const p = pol(226 + k * 10.6, 11.4), m = makePerson(def, k + 30); m.root.position.copy(p); const out = p.clone().multiplyScalar(2); m.root.rotation.y = faceTo(p, out); const a = add(def, p, m.root.rotation.y, { ...m, tall: 1.95, basePose: ['point', 'tablet', 'crossed', 'chin'][k % 4] }); applyPose(a, a.basePose); });
  of('content').forEach((def, k) => { const p = pol(150 + k * 9, 10.6), m = makePerson(def, k + 40); m.root.position.copy(p); m.root.rotation.y = faceTo(p, pol(154.5, 12.5)); const a = add(def, p, m.root.rotation.y, { ...m, tall: 1.95, basePose: k ? 'tablet' : 'point' }); applyPose(a, a.basePose); });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.7), new THREE.MeshStandardMaterial({ color: 0x0d121b, metalness: 0.9, roughness: 0.3 })); desk.position.copy(pol(154.5, 12.2, 0.475)); desk.lookAt(0, 0.475, 0); scene.add(desk);
  // Aether's agents ride the compass ring; the backend agents patrol as drones
  of('knowledge').forEach((def, k) => { const mat = holoMaterial(0xbfe9ff, 0.85), g = construct('sat', mat, lineMat(0xdff4ff, 1)); state.aether.add(g); g.position.set(Math.cos(k * 1.2566) * 3.4, 0, Math.sin(k * 1.2566) * 3.4); add(def, new THREE.Vector3(), 0, { root: g, mat, tall: 0.4, rides: true }); });
  of('ops').forEach((def, k) => { const mat = holoMaterial(0x8fb4ff, 0.8), g = construct('drone', mat, lineMat(0xb9d2ff, 0.95)); scene.add(g); add(def, pol(k * 30, 14.6, 4.2), 0, { root: g, mat, tall: 0.5, drone: { a: THREE.MathUtils.degToRad(k * 30), r: 9.4 + (k % 3) * 1.1, y: 5.6 + (k % 4) * 0.55, w: 0.05 + (k % 3) * 0.012 } }); });
}

/* ---------- meetings: the real rooms, as they conclude ---------- */
function take(body) {
  if (!body) { syncUi(); return; } // the feed failed before any answer: the scene keeps idling
  const next = meetingsFromResponse(body);
  // The first answer meets the room that concluded last; later answers meet every room that concluded since.
  const fresh = state.polled ? freshMeetings(state.live, next) : [latestMeeting(next)].filter(Boolean);
  state.live = next; state.polled = true;
  for (const id of fresh) if (!state.pending.includes(id) && state.meet?.type !== id) state.pending.push(id);
  syncUi();
}
function beam(a, to, pose) { a.jump = { to: to ? to.clone() : a.home.clone(), pose: pose || a.basePose, face: null }; a.want = 0; }
function startMeeting(type) {
  const live = state.live[type], def = MEETINGS[type];
  if (!agents.length || !live || !def) return; endMeeting(true);
  state.pending = state.pending.filter((id) => id !== type);
  const bearings = [270, 242, 298, 214, 326], cast = [byId[def.lead], byId.moderator, ...def.leaders.filter((id) => id !== def.lead).map((id) => byId[id])];
  cast.forEach((a, i) => beam(a, pol(bearings[i], 3.95), i === 0 ? 'lean' : 'crossed'));
  let extra = []; if (def.everyone) { extra = agents.filter((a) => a.human && (a.dept === 'research' || a.dept === 'content')); extra.forEach((a, i) => beam(a, pol(200 + i * 13, 7.6), 'stand')); }
  state.meet = { type, def, live, cast, extra }; state.bias = live.bias; const q = state.queue = []; let t = clock.elapsedTime + 3.2;
  for (const s of live.talk) { const who = byId[s.agent]; if (!who) continue; const dur = Math.min(9, 3.4 + s.text.length / 28); q.push({ at: t, fn: () => say(who, s.text, s.to) }); t += dur; }
  for (const r of live.reasons) { const dur = Math.min(9, 3.6 + r.length / 28); q.push({ at: t, fn: () => say(byId.moderator, r) }); t += dur; }
  q.push({ at: t, fn: () => { say(null); state.sealing = true; } }); q.push({ at: t + 6, fn: () => endMeeting(false) }); syncUi();
}
function endMeeting(fast) {
  const mt = state.meet; if (!mt) return; [...mt.cast, ...mt.extra].forEach((a) => beam(a, null)); say(null); state.sealing = false; state.meet = null; state.queue = []; state.nextAt = clock.elapsedTime + (fast ? 0 : GAP_S); syncUi();
}
function say(a, text, to) {
  const prev = state.speaker; if (prev && prev.human && prev !== a) applyPose(prev, prev.meetPose || prev.basePose);
  state.speaker = a; const sub = $('sub'); if (!a) { sub.classList.remove('on'); return; }
  if (a.human) { a.meetPose = a.pose === 'talk' ? a.meetPose : a.pose; applyPose(a, 'talk'); }
  const toNames = (to ?? []).map((id) => byId[id]).filter(Boolean).map((b) => nameOf(b.def));
  $('sub-name').textContent = toNames.length ? `${nameOf(a.def)}, in reply to ${toNames.join(' and ')}` : nameOf(a.def); $('sub-text').textContent = text; sub.classList.remove('on'); void sub.offsetWidth; sub.classList.add('on');
  sound?.blip();
}

/* ---------- frame ---------- */
function tick(dt, t) {
  while (state.queue.length && t >= state.queue[0].at) state.queue.shift().fn();
  if (!state.meet && agents.length && state.pending.length && t >= state.nextAt) startMeeting(state.pending[0]);
  cA.setHex(BIAS[state.bias] ?? BIAS.neutral); biasNow.lerp(cA, 1 - Math.exp(-dt * 3)); state.accent.forEach((m) => m.color.copy(biasNow)); state.coreShell.uniforms.uColor.value.copy(biasNow); state.coreLight.color.copy(biasNow);
  state.sealed += ((state.sealing ? 1 : 0) - state.sealed) * Math.min(1, dt * 2.2); state.seal.scale.setScalar(Math.max(0.001, state.sealed)); state.seal.rotation.y += dt * 0.3; state.net.scale.setScalar(1 - state.sealed * 0.9); state.coreLight.intensity = 120 * (1 - state.sealed * 0.75);
  state.core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.02 + (state.speaker ? Math.sin(t * 8) * 0.012 : 0));
  const md = dt * MOTION; spinners.forEach((s) => { if (s.y) s.o.rotation.y += md * s.y; if (s.x) s.o.rotation.x += md * s.x; if (s.z) s.o.rotation.z += md * s.z; });
  state.aether.rotation.y += dt * 0.07; state.slabs.forEach((s, i) => { s.rotation.y += dt * (i % 2 ? 0.5 : -0.35); s.position.y = 0.75 + i * 0.52 + Math.sin(t * 1.3 + i) * 0.04; }); state.feed.material.dashOffset = -t * 1.4; state.vaultBars.rotation.z += dt * 0.05;
  for (const a of agents) {
    if (a.drone) { a.drone.a += dt * a.drone.w; a.pos.set(Math.cos(a.drone.a) * a.drone.r, a.drone.y + Math.sin(t * 0.8 + a.seed) * 0.25, Math.sin(a.drone.a) * a.drone.r); a.root.position.copy(a.pos); a.root.rotation.y = -a.drone.a; a.root.userData.eye.material.opacity = 0.5 + Math.sin(t * 3 + a.seed) * 0.5; }
    else if (a.rides) a.root.getWorldPosition(a.pos);
    else if (!a.human) { a.root.position.y = a.home.y + Math.sin(t * 1.1 + a.seed) * 0.07; const u = a.root.userData;
      if (u.bars) u.bars.forEach((b, i) => { b.scale.y = 0.25 + (Math.sin(t * 1.7 + i * 1.3 + a.seed) * 0.5 + 0.5) * 0.75; });
      if (u.wave) { const p = u.wave.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = -0.5 + i / (p.count - 1); p.setXYZ(i, x, Math.sin(x * 14 + t * 6) * 0.2 * Math.exp(-x * x * 9) * 2.2, 0); } p.needsUpdate = true; }
      if (u.look) u.look.position.set(Math.sin(t * 0.9) * 0.12, Math.cos(t * 1.3) * 0.08, 0.05); if (u.sway) a.root.rotation.y = a.face + Math.sin(t * 0.7) * 0.5; }
    // beaming: fade out where it stands, jump, fade in
    const speed = a.want > a.reveal ? 1.1 : 2.2; a.reveal += Math.sign(a.want - a.reveal) * Math.min(Math.abs(a.want - a.reveal), dt * speed);
    if (a.jump && a.reveal <= 0.001) { a.pos.copy(a.jump.to); a.root.position.copy(a.pos); a.root.rotation.y = Math.atan2(-a.pos.x, -a.pos.z) + (a.pos.equals(a.home) ? 0 : 0); if (a.pos.equals(a.home)) a.root.rotation.y = a.face; applyPose(a, a.jump.pose); a.jump = null; a.want = 1; }
    const speaking = state.speaker === a, hov = state.hover === a || state.card === a, U = a.mat.uniforms; U.uReveal.value = a.human ? a.reveal : 1; U.uBase.value = a.human ? a.pos.y : -99; if (!a.human) U.uHeight.value = 999;
    U.uBoost.value += (((speaking ? 1.6 : hov ? 0.9 : 0)) - U.uBoost.value) * Math.min(1, dt * 6);
    a.icon.material.opacity = a.human ? a.reveal : 1; a.icon.scale.setScalar(a.iconSize * (speaking ? 1.55 : hov ? 1.3 : 1));
    if (a.human && speaking) { const d = (v) => tmpV.set(v[0] * -a.sideSign, v[1], v[2]).applyQuaternion(a.rootQ).clone(); const k = Math.sin(t * 4.2 + a.seed) * 0.25, B = a.bones; B.lowerarm_r.quaternion.copy(a.rest.lowerarm_r); B.upperarm_r.quaternion.copy(a.rest.upperarm_r); aim(B.upperarm_r, B.lowerarm_r, d([0.2 + k * 0.3, -0.85, 0.5])); aim(B.lowerarm_r, B.hand_r, d([0.05 - k, 0.35 + k * 0.5, 0.95])); }
    if (!a.rides && !a.drone) a.hit.position.set(a.pos.x, a.human ? a.pos.y + 0.95 : a.home.y, a.pos.z); else a.hit.position.copy(a.pos);
  }
  const sk = state.speaker; let want = state.pointer.rotation.y + dt * 0.2;
  if (sk) { tmpV.copy(sk.pos); want = -Math.atan2(tmpV.z, tmpV.x) - state.pointer.parent.rotation.y * 0; const p = state.link.geometry.attributes.position; p.setXYZ(0, sk.pos.x, sk.pos.y + (sk.human ? 1.45 : 0), sk.pos.z); p.setXYZ(1, CORE.x, CORE.y, CORE.z); p.needsUpdate = true; state.link.visible = true; } else state.link.visible = false;
  let diff = want - state.pointer.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); state.pointer.rotation.y += diff * Math.min(1, dt * (sk ? 3 : 1));
}
function tickCamera() {
  const tw = state.tween;
  if (tw) { const x = Math.min(1, (performance.now() - tw.at) / 1000 / tw.dur), e = x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.q0, tw.q1, e); camera.lookAt(controls.target); if (x >= 1) { state.tween = null; controls.enabled = true; } }
  else { controls.autoRotate = !state.card && performance.now() - state.touched > 6000; controls.update(); }
}
function flyTo(pos, target) { state.tween = { dur: CALM ? 0.01 : 1.5, at: performance.now(), p0: camera.position.clone(), p1: pos.clone(), q0: controls.target.clone(), q1: target.clone() }; controls.enabled = false; state.touched = performance.now(); }
function place(el, world, dy) { const c = renderer.domElement; tmpV.copy(world); tmpV.y += dy; tmpV.project(camera); if (tmpV.z > 1) { el.hidden = true; return; } el.hidden = false; el.style.transform = `translate(-50%,-100%) translate(${((tmpV.x + 1) / 2) * c.clientWidth}px,${((1 - tmpV.y) / 2) * c.clientHeight}px)`; }
function resize() { const c = renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
function frame() {
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime; time.value += dt * MOTION; tick(dt, t); tickCamera();
  const h = state.hover, tag = $('tag'); if (h && !state.card) { tag.textContent = h.thing ? h.name : nameOf(h.def); if (h.thing) { h.group.getWorldPosition(tmpV2); place(tag, tmpV2, h.h); } else place(tag, h.pos, (h.human ? h.tall : h.tall) + 0.25); } else tag.hidden = true;
  if (composer) composer.render(); else renderer.render(scene, camera);
}

/* ---------- ui ---------- */
let sound = null;
function syncUi() {
  document.querySelectorAll('[data-meet]').forEach((b) => { const id = b.dataset.meet; b.disabled = !state.live[id] || !agents.length; b.setAttribute('aria-pressed', String(state.meet?.type === id)); });
  // The hero's status (one element, also written by the page before the scene loads): the meeting replaying, else
  // the 15-minute room's reading.
  const st = statusOf(state.live, state.meet?.type ?? null); if (st) window.dispatchEvent(new CustomEvent('warroom-status', { detail: st }));
}
function latestOf(id) {
  // The newest public excerpt of this agent across the rooms, and the metrics it weighed there.
  const rooms = Object.values(state.live).sort((a, b) => b.at.localeCompare(a.at));
  if (id === 'moderator') { const r = rooms.find((x) => x.reasons.length); return r ? { latest: r.reasons[0], where: r } : null; }
  for (const r of rooms) { const a = r.analysts[id]; if (a && (a.latest || a.metrics.length)) return { ...a, where: r }; }
  return null;
}
function openCard(o) {
  state.card = o; const rows = $('card-rows'); rows.textContent = ''; const row = (k, v) => { const h = document.createElement('div'); h.className = 'k'; h.textContent = k; rows.appendChild(h); if (Array.isArray(v)) { const ul = document.createElement('ul'); v.forEach((x) => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); }); rows.appendChild(ul); } else { const d = document.createElement(k.startsWith('Latest') ? 'blockquote' : 'div'); d.textContent = v; rows.appendChild(d); } };
  if (o.thing) { $('card-kind').textContent = o.kind; $('card-name').textContent = o.name; $('card-title').textContent = ''; $('card-role').textContent = o.role; o.group.getWorldPosition(tmpV2); const p = tmpV2.clone(), far = Math.hypot(p.x, p.z) > 6; flyTo(far ? new THREE.Vector3(p.x * 0.5, 4, p.z * 0.5) : new THREE.Vector3(0, 4.6, 9.5), p.clone().setY(Math.max(1.6, p.y))); }
  else { const d = o.def, live = latestOf(d.id); $('card-kind').textContent = LABEL[d.dept]; $('card-name').textContent = nameOf(d); $('card-title').textContent = d.title; $('card-role').textContent = d.role;
    if (live?.metrics?.length) row(`Weighed in the ${MEETINGS[live.where.id].label}`, live.metrics); else if (READS[d.id] && !d.role.startsWith('Reads ')) row('Reads', READS[d.id]);
    if (live?.latest) row(`Latest, in the ${MEETINGS[live.where.id].label} of ${whenOf(live.where.at)}`, live.latest);
    const p = o.pos.clone(), inward = p.clone().setY(0).normalize().multiplyScalar(-1), dist = o.human ? 4.2 : 3.2; const side = new THREE.Vector3(inward.z, 0, -inward.x), cam = p.clone().addScaledVector(side, dist * 0.8).addScaledVector(inward, dist * 0.45).add(new THREE.Vector3(0, o.human ? 1.6 : 0.5, 0)); flyTo(cam, p.clone().add(new THREE.Vector3(0, o.human ? 1.1 : 0, 0))); }
  $('card').hidden = false; syncUi();
}
function bindUi() {
  Object.entries(MEETINGS).forEach(([id, m]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.meet = id; b.textContent = m.short; b.setAttribute('aria-label', `Replay the latest ${m.label} (it meets ${m.cadence})`); b.setAttribute('aria-pressed', 'false'); b.disabled = true; b.addEventListener('click', () => startMeeting(id)); $('meets').appendChild(b); });
  const close = () => { state.card = null; $('card').hidden = true; flyTo(new THREE.Vector3(0, 5.4, 16.5), new THREE.Vector3(0, 2.0, 0)); }; $('card-close').addEventListener('click', close); window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.card) close(); });
  // The navigator below the scene: selecting an agent shows it here.
  document.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', () => { const a = byId[b.dataset.agent]; if (!a) return; $('room').scrollIntoView({ behavior: CALM ? 'auto' : 'smooth', block: 'start' }); openCard(a); }));
  // Ambient sound: generated here (no file), off until the visitor turns it on.
  const sb = $('sound'); if (window.AudioContext || window.webkitAudioContext) { sb.hidden = false; sb.addEventListener('click', () => { sound = sound || ambient(); const on = sb.getAttribute('aria-pressed') !== 'true'; sound.set(on); sb.setAttribute('aria-pressed', String(on)); sb.textContent = on ? 'Sound on' : 'Sound off'; }); }
  const canvas = $('scene'), ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  const pick = (ev) => { const r = canvas.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); const h = ray.intersectObjects(hits, false); const p = h.find((x) => x.object.userData.person); return p ? p.object.userData.person : h[0] ? h[0].object.userData.thing : null; };
  canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'mouse') return; state.hover = pick(ev); canvas.style.cursor = state.hover ? 'pointer' : 'grab'; });
  canvas.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', (ev) => { if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 8) return; const o = pick(ev); if (o) openCard(o); });
  syncUi();
}
init();
