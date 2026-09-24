// Bonk Racers: online multiplayer arcade racing.
//
// Networking model: one player hosts the room in their browser, everyone else connects to them.
// Every browser simulates its own vehicle and shares where it is; the host runs the lobby,
// the vote, the bots and the results, and relays everyone's positions to everyone else.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HostNet, ClientNet, makeCode } from './net.js?v=7';
import { COURSES, COURSE_BY_ID, buildTrack, drawCourseMap, findOverlaps } from './track.js?v=7';
import { VEHICLES, VEHICLE_BY_ID, ATK_TIME, NITRO_MIN, buildVehicleModel, animateModel, stepPhysics, findAttackTarget, PAINT_COLORS, PATTERNS, HATS, applyCustomization, setModelQuality } from './vehicles.js?v=7';
import { ITEMS, ICONS, rollItem, buildItemBoxes, spawnProjectile, stepProjectile, spawnTrap, stepTrap, trapRadius, SHIELD_TIME, BOX_RESPAWN, ROULETTE_TIME, TRAP_ARM_TIME } from './items.js?v=7';
import { createPost, Particles, SkidMarks, Streaks } from './fx.js?v=7';
import { sfx, engine, driftSound, nitroSound, rumble, unlockAudio, setMuted, isMuted } from './audio.js?v=7';
import { play as playMusic, stop as stopMusic, setMusicVolume, getMusicVolume } from './music.js?v=7';
import { tiltAmount, tiltToSteer } from './tilt.js?v=7';

// ============================================================
// Constants and helpers
// ============================================================
const MAX_PLAYERS = 8;
const VOTE_MS = 12000;
const COUNTDOWN_MS = 4000;
const FINISH_GRACE_MS = 30000;
const SEND_EVERY = 0.05;
const COLORS = ['#2ec495', '#e0584f', '#3b82f6', '#f2c14e', '#a78bfa', '#f97316', '#ec4899', '#e2e8f0'];
const BOT_NAMES = ['Turbo Gran', 'Sir Skids', 'Captain Crash', 'Noodle', 'Lil Wheelie', 'Pothole Pete', 'Mrs Bonkers', 'Dave'];

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
const ordinal = n => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
function fmtTime(s) {
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Racer';
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function toast(text) {
    const t = el('div', 'toast', text);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3300);
}
function setStatus(id, text, isError) {
    const s = $(id);
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
}

// ============================================================
// Renderer, quality, scene, sky, lights
// ============================================================
const canvas = $('c');
const isTouchDevice = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
// Graphics quality: full effects on desktops, lighter on phones. Changeable in the pause menu.
let quality = ['low', 'high'].includes(store.get('bonkGfx')) ? store.get('bonkGfx') : (isTouchDevice ? 'low' : 'high');
setModelQuality(quality);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25);
renderer.setPixelRatio(pixelRatio());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 160, 680);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

// Sky dome: a vertical gradient we can recolour per course
const sky = (() => {
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(mesh);
    return mesh;
})();
function paintSky(topHex, midHex, horHex) {
    const pos = sky.geometry.attributes.position, col = sky.geometry.attributes.color;
    const top = new THREE.Color(topHex), mid = new THREE.Color(midHex), hor = new THREE.Color(horHex), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 1000;
        if (y > 0.22) c.copy(mid).lerp(top, (y - 0.22) / 0.78);
        else c.copy(hor).lerp(mid, clamp((y + 0.02) / 0.24, 0, 1));
        col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
}
const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x3d5a3a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// Reflections for car paint, chrome and glass: a soft studio room, or a neon-lit street at night
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const neonEnv = (() => {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x05040c);
    const cols = [0xff2a9a, 0x22ffd0, 0x7a44ff, 0xffb020, 0x3a8cff];
    for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(rand(2, 5), rand(0.4, 1.5), 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(3) }));
        const a = (i / 14) * Math.PI * 2;
        m.position.set(Math.cos(a) * 9, rand(-1, 4), Math.sin(a) * 9);
        m.lookAt(0, m.position.y, 0);
        s.add(m);
    }
    return pmrem.fromScene(s, 0.02).texture;
})();

// Default look (menu, garage, and courses without their own lighting)
const DEFAULT_LOOK = { skyTop: '#4a86d8', skyMid: '#9fcaf2', skyHor: '#ffd9b0', sun: 0xfff1dc, sunInt: 2.3, hemiSky: 0xe8f4ff, hemiGround: 0x3d5a3a, hemiInt: 1.1, exposure: 1 };
function applyLook(T) {
    const L = { ...DEFAULT_LOOK, ...(T || {}) };
    paintSky(L.skyTop, L.skyMid, L.skyHor);
    sun.color.set(L.sun);
    sun.intensity = L.sunInt;
    hemi.color.set(L.hemiSky);
    hemi.groundColor.set(L.hemiGround);
    hemi.intensity = L.hemiInt;
    renderer.toneMappingExposure = L.exposure;
    scene.environment = T && T.wetRoad ? neonEnv : roomEnv;
}
applyLook(null);

// Post-processing (bloom) and pooled effects
const post = createPost(renderer, scene, camera);
const soft = new Particles(scene, 800, false, 0.1);   // smoke, dust, confetti, snow
const glow = new Particles(scene, 700, true, 0.25);   // sparks, embers, bursts
const skids = new SkidMarks(scene, 900);
const streaks = new Streaks(scene, 40);
function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
}
function applyQuality() {
    setModelQuality(quality);
    renderer.setPixelRatio(pixelRatio());
    const size = quality === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    post.enabled = quality === 'high';
    soft.budget = glow.budget = quality === 'high' ? 1 : 0.45;
    resize();
    $('gfx-toggle').textContent = quality === 'high' ? 'High' : 'Low';
}
addEventListener('resize', resize);
applyQuality();

// ============================================================
// Garage: the turntable you see on the menu and in the lobby
// ============================================================
const garage = new THREE.Group();
{
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x33443c, roughness: 0.95, envMapIntensity: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x1b2420, roughness: 0.35, metalness: 0.3, envMapIntensity: 0.5 }));
    plate.position.y = 0.15;
    plate.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.05, 8, 72), new THREE.MeshStandardMaterial({ color: 0x2ec495, emissive: 0x2ec495, emissiveIntensity: 1.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    garage.add(floor, plate, ring);
}
scene.add(garage);
let showcase = null;
let showDemoT = 0;

// ============================================================
// State
// ============================================================
let role = null;              // 'host' | 'client' | 'solo'
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';            // 'menu' | 'lobby' | 'vote' | 'race' | 'results'
let lobby = { players: [], phase: 'lobby', votes: {} };
let myName = store.get('bonkName') || '';
let myVehicle = VEHICLE_BY_ID[store.get('bonkVehicle')] ? store.get('bonkVehicle') : 'bubble';
let garageTab = VEHICLE_BY_ID[myVehicle].kind;
let myCustom = (() => {
    try { return JSON.parse(localStorage.getItem('bonkCustom')) || {}; } catch { return {}; }
})();
function saveCustom() {
    try { localStorage.setItem('bonkCustom', JSON.stringify(myCustom)); } catch {}
}

let track = null;
const racers = new Map();
let me = null;
let raceClock = 0, lastCount = null, sendAcc = 0, wantAttack = false, wantFire = false, wantNitro = false, fireBack = false;
let camH = 0, shake = 0, wrongT = 0, centerT = 0, voteEnds = 0, fovKick = 0, camSide = 0;
const camPos = new THREE.Vector3();

// Weapons in flight and traps on the road (every browser simulates the same ones)
let boxes = null;
const projectiles = new Map();
const traps = new Map();
// Events already handled, so a message delivered twice over the relay never counts twice
const seen = { fire: new Set(), hit: new Set(), credit: new Set(), atk: new Set(), trap: new Set(), gone: new Set() };
let eventSeq = 0;
const newId = owner => `${owner}.${(eventSeq++).toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
const stats = { hitsApplied: 0, firesSpawned: 0, trapsPlaced: 0, trapsRemoved: 0, blocked: 0 };

// Host-only state
const H = {
    players: new Map(), phase: 'lobby', votes: new Map(), states: new Map(),
    finished: [], bonks: {}, course: null,
    voteTimer: null, endTimer: null, doneTimer: null,
    traps: new Map(), seen: new Set(),
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'vote', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
}

// ============================================================
// Pause menu
// ============================================================
let paused = false;

function togglePause() {
    if (view !== 'race') return;
    paused = !paused;
    $('pause').classList.toggle('hidden', !paused);
    // Sync settings UI when opening
    if (paused) {
        $('music-vol').value = Math.round(getMusicVolume() * 100);
        $('pause-mute').textContent = isMuted() ? 'Unmute' : 'Mute';
        $('gfx-toggle').textContent = quality === 'high' ? 'High' : 'Low';
        nitroSound.set(false);
        rumble.set(0);
        driftSound.set(0, false);
    }
}

$('btn-resume').addEventListener('click', togglePause);
$('gfx-toggle').addEventListener('click', () => {
    quality = quality === 'high' ? 'low' : 'high';
    store.set('bonkGfx', quality);
    applyQuality();
});

// Tab switching
for (const tab of document.querySelectorAll('.pause-tab')) {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.pause-tab').forEach(t => t.classList.remove('on'));
        tab.classList.add('on');
        $('pause-controls').classList.toggle('hidden', tab.dataset.tab !== 'controls');
        $('pause-settings').classList.toggle('hidden', tab.dataset.tab !== 'settings');
    });
}

// Settings controls
$('music-vol').addEventListener('input', e => {
    setMusicVolume(parseInt(e.target.value, 10) / 100);
});
$('pause-mute').addEventListener('click', () => {
    setMuted(!isMuted());
    syncMute();
    $('pause-mute').textContent = isMuted() ? 'Unmute' : 'Mute';
});

// ============================================================
// Menu
// ============================================================
$('name').value = myName;
{
    const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (invite) {
        $('code').value = invite;
        $('invite').textContent = `You've been invited to room ${invite}. Enter your name and hit Join.`;
        $('invite').classList.remove('hidden');
    }
}
let busy = false;
function setBusy(b) {
    busy = b;
    for (const id of ['btn-create', 'btn-join', 'btn-solo']) $(id).disabled = b;
}
function readName() {
    if (!$('name').value.trim()) {
        setStatus('menu-status', 'Enter your name first.', true);
        $('name').focus();
        return false;
    }
    myName = cleanName($('name').value);
    store.set('bonkName', myName);
    return true;
}

async function createRoom() {
    if (busy || !readName()) return;
    unlockAudio();
    playMusic('menu');
    setBusy(true);
    setStatus('menu-status', 'Creating your room...');
    let err = null;
    for (let attempt = 0; attempt < 3 && !net; attempt++) {
        const code = makeCode();
        const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
        try {
            await hn.open(code);
            net = hn;
            roomCode = code;
        } catch (e) {
            hn.close();
            err = e;
            if (e.message !== 'code-taken') break;
        }
    }
    setBusy(false);
    if (!net) return setStatus('menu-status', err && err.message !== 'code-taken' ? err.message : 'Could not create a room. Try again.', true);
    role = 'host';
    myId = 'host';
    hostInit();
    enterLobby();
}

async function joinRoom() {
    if (busy || !readName()) return;
    const code = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return setStatus('menu-status', 'Room codes are 5 characters.', true);
    unlockAudio();
    playMusic('menu');
    setBusy(true);
    setStatus('menu-status', `Joining room ${code}...`);
    const cn = new ClientNet({
        onMessage: clientHandle,
        onClose: () => { if (net === cn) leave('Lost connection to the host. The room may have closed.'); },
        onStatus: text => setStatus('menu-status', text),
        // ?net=relay skips the direct attempt; handy when a network is known to block it
        forceRelay: new URLSearchParams(location.search).get('net') === 'relay',
    });
    try {
        myId = await cn.connect(code);
    } catch (e) {
        cn.close();
        setBusy(false);
        return setStatus('menu-status', e.message, true);
    }
    setBusy(false);
    net = cn;
    role = 'client';
    roomCode = code;
    act({ t: 'hello', name: myName, vehicle: myVehicle, custom: myCustom });
    setStatus('menu-status', 'Connected. Loading the garage...');
    // If the host never answers (e.g. they closed the room), don't leave the player hanging
    setTimeout(() => {
        if (net === cn && view === 'menu') leave("The host didn't answer. Ask them to refresh the page (Ctrl+Shift+R), create a new room and send you the new code.");
    }, 15000);
}

function startSolo() {
    if (busy || !readName()) return;
    unlockAudio();
    playMusic('menu');
    role = 'solo';
    myId = 'host';
    roomCode = 'SOLO';
    hostInit();
    for (let i = 0; i < 5; i++) addBot();
    enterLobby();
}

function leave(reason) {
    const n = net;
    net = null;
    if (n) n.close();
    clearTimeout(H.voteTimer);
    clearTimeout(H.endTimer);
    clearTimeout(H.doneTimer);
    role = null;
    myId = null;
    roomCode = '';
    lobby = { players: [], phase: 'lobby', votes: {} };
    teardownRace();
    garage.visible = true;
    view = 'menu';
    show('menu');
    setStatus('menu-status', reason || '', !!reason);
    engine.set(0, false);
    driftSound.set(0, false);
    nitroSound.set(false);
    rumble.set(0);
    playMusic('menu');
}

$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-exit').addEventListener('click', () => {
    if (view === 'menu') location.href = '../projects.html';
    else if (confirm(role === 'host' ? 'Leave and close this room for everyone?' : 'Leave this room?')) leave();
});
function syncMute() {
    $('icon-sound').classList.toggle('hidden', isMuted());
    $('icon-muted').classList.toggle('hidden', !isMuted());
}
syncMute();
$('btn-mute').addEventListener('click', e => {
    unlockAudio();
    setMuted(!isMuted());
    syncMute();
    e.currentTarget.blur();
});

// ============================================================
// Messaging: act() sends to the host, emit() is the host telling everyone
// ============================================================
function act(msg) {
    if (role === 'client') net.send(msg);
    else hostHandle(myId, msg);
}
function emit(msg) {
    if (role === 'host' && net) net.broadcast(msg);
    clientHandle(msg);
}

// ============================================================
// Host logic
// ============================================================
function hostInit() {
    H.players.clear();
    H.votes.clear();
    H.states.clear();
    H.phase = 'lobby';
    H.players.set(myId, { id: myId, name: myName, vehicle: myVehicle, ready: true, bot: false, host: true, color: COLORS[0] });
    broadcastLobby();
}

function nextColor() {
    const used = new Set([...H.players.values()].map(p => p.color));
    return COLORS.find(c => !used.has(c)) || COLORS[H.players.size % COLORS.length];
}

function broadcastLobby() {
    emit({ t: 'lobby', code: roomCode, phase: H.phase, players: [...H.players.values()], votes: Object.fromEntries(H.votes) });
}

function hostHandle(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
        if (H.players.has(from)) return;
        if (H.players.size >= MAX_PLAYERS) return rejectPeer(from, 'That room is full (8 racers max).');
        if (H.phase !== 'lobby') return rejectPeer(from, 'A race is in progress. Try again in a minute.');
        const p = { id: from, name: cleanName(msg.name), vehicle: VEHICLE_BY_ID[msg.vehicle] ? msg.vehicle : 'bubble', ready: false, bot: false, color: nextColor(), custom: msg.custom || {} };
        H.players.set(from, p);
        net.send(from, { t: 'welcome', you: from, code: roomCode });
        emit({ t: 'toast', text: `${p.name} joined the room` });
        broadcastLobby();
        return;
    }
    const p = H.players.get(from);
    if (!p) return;
    switch (msg.t) {
        case 'pick':
            if (H.phase === 'lobby' && VEHICLE_BY_ID[msg.v]) { p.vehicle = msg.v; p.custom = msg.custom || p.custom; broadcastLobby(); }
            break;
        case 'ready':
            if (H.phase === 'lobby') { p.ready = !!msg.r; broadcastLobby(); }
            break;
        case 'vote':
            if (H.phase === 'vote' && COURSE_BY_ID[msg.c] && COURSE_BY_ID[msg.c].available) {
                H.votes.set(from, msg.c);
                broadcastLobby();
                if (allHumansVoted()) setTimeout(finishVote, 700);
            }
            break;
        case 'st':
            if (Array.isArray(msg.s) && msg.s[0] === from) {
                H.states.set(from, msg.s);
                applyStates([msg.s]);
            }
            break;
        case 'atk':
            if (H.phase === 'race' && !hostSeen('a', msg.id)) {
                const target = msg.target && H.players.has(msg.target) ? msg.target : null;
                if (target) H.bonks[from] = (H.bonks[from] || 0) + 1;
                emit({ t: 'atk', id: msg.id, from, target, side: msg.side === -1 ? -1 : 1 });
            }
            break;
        case 'fire':
            // Someone used a weapon: everybody simulates it from the same starting point
            if (H.phase === 'race' && ITEMS[msg.k] && !ITEMS[msg.k].trap && !hostSeen('f', msg.id)) {
                emit({
                    t: 'fire', id: msg.id, k: msg.k, o: from, x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0, h: +msg.h || 0,
                    sp: +msg.sp || 0, tgt: msg.tgt && H.players.has(msg.tgt) ? msg.tgt : null, back: msg.back ? 1 : 0,
                });
            }
            break;
        case 'ihit':
            // A racer's own browser says it was hit (only ever about itself)
            if (H.phase === 'race' && msg.v === from && !hostSeen('h', `${msg.pid}|${from}`)) {
                const o = H.players.has(msg.o) ? msg.o : null;
                if (o && o !== from && !msg.blk) H.bonks[o] = (H.bonks[o] || 0) + 1;
                emit({ t: 'ihit', pid: msg.pid, v: from, k: msg.k, o, blk: msg.blk ? 1 : 0 });
            }
            break;
        case 'trap':
            if (H.phase === 'race' && (msg.k === 'gum' || msg.k === 'oil') && !hostSeen('t', msg.id)) {
                H.traps.set(msg.id, from);
                emit({ t: 'trap', id: msg.id, k: msg.k, o: from, x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0, fx: +msg.fx || 0, fy: +msg.fy || 0, fz: +msg.fz || 0 });
            }
            break;
        case 'trapHit':
            // First racer to report driving over a trap removes it for everyone
            if (H.phase === 'race' && msg.v === from && H.traps.has(msg.id)) {
                const o = H.traps.get(msg.id);
                H.traps.delete(msg.id);
                if (o && o !== from && !msg.blk) H.bonks[o] = (H.bonks[o] || 0) + 1;
                emit({ t: 'trapGone', id: msg.id, v: from, o, blk: msg.blk ? 1 : 0 });
            }
            break;
        case 'fin':
            recordFinish(from, +msg.time || 0);
            break;
    }
}

// True if the host already handled this event (the relay can deliver a message twice)
function hostSeen(kind, id) {
    if (typeof id !== 'string' || !id) return true;
    const key = kind + id;
    if (H.seen.has(key)) return true;
    H.seen.add(key);
    return false;
}

function rejectPeer(id, reason) {
    net.send(id, { t: 'reject', reason });
    setTimeout(() => net && net.kick(id), 600);
}

function hostLeave(id, how = 'left') {
    const p = H.players.get(id);
    if (!p) return;
    H.players.delete(id);
    H.votes.delete(id);
    H.states.delete(id);
    emit({ t: 'toast', text: `${p.name} ${how}` });
    broadcastLobby();
    if (H.phase === 'vote' && allHumansVoted()) finishVote();
    if (H.phase === 'race') checkRaceDone();
}

function addBot() {
    if (H.players.size >= MAX_PLAYERS || H.phase !== 'lobby') return;
    const used = new Set([...H.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${H.players.size}`;
    const id = `bot-${Math.random().toString(36).slice(2, 8)}`;
    H.players.set(id, { id, name, vehicle: VEHICLES[Math.floor(Math.random() * VEHICLES.length)].id, ready: true, bot: true, color: nextColor() });
    broadcastLobby();
}
function removeBot(id) {
    const p = H.players.get(id);
    if (p && p.bot && H.phase === 'lobby') {
        H.players.delete(id);
        broadcastLobby();
    }
}
// Host removes a real player from the lobby: tell them why, then drop their connection
function kickPlayer(id) {
    const p = H.players.get(id);
    if (!p || p.bot || p.host || H.phase !== 'lobby' || !net) return;
    rejectPeer(id, 'The host removed you from the room.');
    hostLeave(id, 'was removed');
}

const allHumansVoted = () => [...H.players.values()].filter(p => !p.bot).every(p => H.votes.has(p.id));

function hostStart() {
    if (H.phase !== 'lobby') return;
    const waiting = [...H.players.values()].filter(p => !p.bot && !p.host && !p.ready);
    if (waiting.length) return toast(`Waiting for ${waiting.map(p => p.name).join(', ')}`);
    H.phase = 'vote';
    H.votes.clear();
    const open = COURSES.filter(c => c.available);
    for (const p of H.players.values()) if (p.bot) H.votes.set(p.id, open[Math.floor(Math.random() * open.length)].id);
    emit({ t: 'vote', ms: VOTE_MS });
    broadcastLobby();
    clearTimeout(H.voteTimer);
    H.voteTimer = setTimeout(finishVote, VOTE_MS);
}

function finishVote() {
    if (H.phase !== 'vote') return;
    clearTimeout(H.voteTimer);
    const tally = {};
    for (const c of H.votes.values()) tally[c] = (tally[c] || 0) + 1;
    const open = COURSES.filter(c => c.available);
    const top = Math.max(0, ...Object.values(tally));
    const winners = open.filter(c => (tally[c.id] || 0) === top);
    const course = winners[Math.floor(Math.random() * winners.length)].id;
    H.phase = 'race';
    H.course = course;
    H.finished = [];
    H.bonks = {};
    H.states.clear();
    H.traps.clear();
    H.seen.clear();
    clearTimeout(H.endTimer);
    clearTimeout(H.doneTimer);
    H.doneTimer = null;
    emit({ t: 'countdown', course, grid: shuffle([...H.players.keys()]), players: [...H.players.values()], ms: COUNTDOWN_MS });
    broadcastLobby();
}

function recordFinish(id, time) {
    if (H.phase !== 'race' || H.finished.some(f => f.id === id)) return;
    H.finished.push({ id, time });
    if (H.finished.length === 1) H.endTimer = setTimeout(endRace, FINISH_GRACE_MS);
    emit({ t: 'finish', id, place: H.finished.length, time });
    checkRaceDone();
}

function checkRaceDone() {
    if (H.phase !== 'race' || H.doneTimer) return;
    const everyone = [...H.players.keys()];
    if (everyone.every(id => H.finished.some(f => f.id === id))) H.doneTimer = setTimeout(endRace, 2500);
}

function endRace() {
    if (H.phase !== 'race') return;
    clearTimeout(H.endTimer);
    clearTimeout(H.doneTimer);
    H.phase = 'results';
    const T = track ? track.total : 1;
    const done = H.finished.filter(f => H.players.has(f.id));
    const rest = [...H.players.keys()].filter(id => !done.some(f => f.id === id));
    const progress = id => { const r = racers.get(id); return r ? r.lap * T + r.dist : 0; };
    rest.sort((a, b) => progress(b) - progress(a));
    const order = [...done.map(f => f.id), ...rest];
    const list = order.map((id, i) => {
        const p = H.players.get(id);
        const f = done.find(x => x.id === id);
        return { id, name: p.name, color: p.color, vehicle: p.vehicle, place: i + 1, time: f ? f.time : null, bonks: H.bonks[id] || 0 };
    });
    emit({ t: 'results', list });
    broadcastLobby();
}

function hostBackToLobby() {
    if (H.phase !== 'results') return;
    H.phase = 'lobby';
    H.votes.clear();
    for (const p of H.players.values()) p.ready = p.bot || !!p.host;
    emit({ t: 'toLobby' });
    broadcastLobby();
}

// ============================================================
// Messages everyone handles (the host handles its own emits too)
// ============================================================
function clientHandle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
        case 'welcome':
            myId = msg.you;
            roomCode = msg.code;
            break;
        case 'reject':
            leave(msg.reason);
            break;
        case 'toast':
            toast(msg.text);
            sfx.join();
            break;
        case 'lobby':
            lobby = msg;
            if (view === 'menu' && msg.phase === 'lobby' && role === 'client') enterLobby();
            else if (view === 'lobby') renderLobby();
            else if (view === 'vote') renderVote();
            for (const id of [...racers.keys()]) if (!msg.players.some(p => p.id === id)) removeRacer(id);
            break;
        case 'vote':
            showVote(msg.ms);
            break;
        case 'countdown':
            startRace(msg);
            break;
        case 'sts':
            applyStates(msg.a);
            break;
        case 'atk':
            onAttack(msg);
            break;
        case 'fire':
            if (view === 'race' && track) fireProjectile(msg);
            break;
        case 'ihit':
            if (view === 'race' && track) onItemHit(msg);
            break;
        case 'trap':
            if (view === 'race' && track) placeTrap(msg);
            break;
        case 'trapGone':
            if (view === 'race' && track) onTrapGone(msg);
            break;
        case 'finish':
            onFinish(msg);
            break;
        case 'results':
            showResults(msg.list);
            break;
        case 'toLobby':
            teardownRace();
            enterLobby();
            break;
    }
}

// ============================================================
// Lobby / garage UI
// ============================================================
function enterLobby() {
    view = 'lobby';
    document.body.classList.toggle('is-host', role !== 'client');
    show('lobby');
    garage.visible = true;
    playMusic('menu');
    buildVehicleCards();
    buildCustomUI();
    renderLobby();
}

function statList(v) {
    return [['Speed', v.top / 44], ['Accel', v.accel / 28], ['Grip', v.grip / 8.5], ['Weight', v.mass / 2.8]];
}

function buildVehicleCards() {
    for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.kind === garageTab);
    const grid = $('vehicles');
    grid.innerHTML = '';
    for (const v of VEHICLES.filter(x => x.kind === garageTab)) {
        const card = el('button', 'vcard' + (v.id === myVehicle ? ' on' : ''));
        card.type = 'button';
        const head = el('div', 'vcard-head');
        head.append(el('b', null, v.name), el('span', null, v.attack.name));
        const stats = el('div', 'stats');
        for (const [label, val] of statList(v)) {
            const bar = el('div', 'bar'), fill = el('i');
            fill.style.width = `${Math.round(clamp(val, 0.05, 1) * 100)}%`;
            bar.append(fill);
            stats.append(el('span', null, label), bar);
        }
        card.append(head, stats);
        card.addEventListener('click', () => pickVehicle(v.id));
        grid.append(card);
    }
}
$('tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    garageTab = b.dataset.kind;
    buildVehicleCards();
});

function pickVehicle(id) {
    if (lobby.phase !== 'lobby') return;
    myVehicle = id;
    store.set('bonkVehicle', id);
    sfx.click();
    act({ t: 'pick', v: id, custom: myCustom });
    buildVehicleCards();
    updateShowcase();
}

function buildCustomUI() {
    // Color swatches
    const cRow = $('color-swatches');
    cRow.innerHTML = '';
    for (const c of PAINT_COLORS) {
        const sw = el('button', 'swatch' + (myCustom.color === c ? ' on' : ''));
        sw.type = 'button';
        sw.style.background = c;
        sw.addEventListener('click', () => {
            myCustom.color = c;
            saveCustom();
            buildCustomUI();
            updateShowcase();
            sfx.click();
        });
        cRow.append(sw);
    }
    // Pattern buttons
    const pRow = $('pattern-btns');
    pRow.innerHTML = '';
    for (const p of PATTERNS) {
        const b = el('button', 'pat-btn' + ((myCustom.pattern || 'solid') === p ? ' on' : ''), p);
        b.type = 'button';
        b.addEventListener('click', () => {
            myCustom.pattern = p;
            saveCustom();
            buildCustomUI();
            updateShowcase();
            sfx.click();
        });
        pRow.append(b);
    }
    // Hat buttons
    const hRow = $('hat-btns');
    hRow.innerHTML = '';
    for (const h of HATS) {
        const b = el('button', 'hat-btn' + ((myCustom.hat || 'none') === h ? ' on' : ''), h);
        b.type = 'button';
        b.addEventListener('click', () => {
            myCustom.hat = h;
            saveCustom();
            buildCustomUI();
            updateShowcase();
            sfx.click();
        });
        hRow.append(b);
    }
}

function renderLobby() {
    const isHost = role !== 'client';
    $('room-code').textContent = role === 'solo' ? 'SOLO' : roomCode;
    $('btn-copy').classList.toggle('hidden', role === 'solo');
    const list = $('players');
    list.innerHTML = '';
    for (const p of lobby.players) {
        const li = el('li', 'player' + (p.id === myId ? ' me' : ''));
        const dot = el('span', 'dot');
        dot.style.background = p.color;
        const who = el('div', 'who');
        who.append(el('b', null, p.name + (p.id === myId ? ' (you)' : '')), el('small', null, VEHICLE_BY_ID[p.vehicle] ? VEHICLE_BY_ID[p.vehicle].name : ''));
        li.append(dot, who);
        if (p.host) li.append(el('span', 'badge host', 'Host'));
        else if (p.bot) li.append(el('span', 'badge', 'Bot'));
        else li.append(el('span', 'badge' + (p.ready ? ' ok' : ''), p.ready ? 'Ready' : 'Picking'));
        if (isHost && !p.host && lobby.phase === 'lobby') {
            const x = el('button', 'kick', '×');
            x.type = 'button';
            x.title = p.bot ? 'Remove bot' : `Remove ${p.name}`;
            x.addEventListener('click', () => {
                if (p.bot) removeBot(p.id);
                else if (confirm(`Remove ${p.name} from the room?`)) kickPlayer(p.id);
            });
            li.append(x);
        }
        list.append(li);
    }
    for (let i = lobby.players.length; i < MAX_PLAYERS; i++) list.append(el('li', 'player empty', 'Open slot'));
    $('count').textContent = `${lobby.players.length}/${MAX_PLAYERS}`;
    $('btn-bot').disabled = lobby.players.length >= MAX_PLAYERS;

    const mine = lobby.players.find(p => p.id === myId);
    if (isHost) {
        const waiting = lobby.players.filter(p => !p.bot && !p.host && !p.ready).map(p => p.name);
        $('btn-start').disabled = waiting.length > 0;
        setStatus('lobby-status', waiting.length
            ? `Waiting for ${waiting.join(', ')} to ready up`
            : lobby.players.length < 2 ? 'Invite friends or add bots, then start.' : 'Everyone is ready. Start when you like!');
    } else {
        $('btn-ready').textContent = mine && mine.ready ? 'Not ready' : 'Ready up';
        setStatus('lobby-status', mine && mine.ready ? 'Waiting for the host to start...' : 'Pick a ride, then ready up.');
    }
    updateShowcase();
}

function updateShowcase() {
    const mine = lobby.players.find(p => p.id === myId);
    const color = mine ? mine.color : COLORS[0];
    const v = VEHICLE_BY_ID[myVehicle];
    const customKey = JSON.stringify(myCustom);
    if (!showcase || showcase.vid !== v.id || showcase.color !== color || showcase.customKey !== customKey) {
        const h = showcase ? showcase.state.h : 0.5;
        if (showcase) garage.remove(showcase.model.root);
        const model = buildVehicleModel(v, color);
        applyCustomization(model, myCustom);
        garage.add(model.root);
        const size = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
        showcase = { vid: v.id, color, customKey, model, size: Math.max(size.x, size.y * 1.6), state: { x: 0, z: 0, y: 0, h, steer: 0, lean: 0, wheelSpin: 0, atkT: 0, atkSide: 1, stunT: 0, speed: 0 } };
        showDemoT = 1.8;
    }
    $('show-name').textContent = v.name;
    $('show-desc').textContent = v.desc;
    $('show-attack').textContent = `Special move: ${v.attack.name}`;
}

$('btn-copy').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    try {
        await navigator.clipboard.writeText(url);
        toast('Invite link copied. Send it to your friends!');
    } catch (e) {
        prompt('Copy this invite link:', url);
    }
});
$('btn-ready').addEventListener('click', () => {
    const mine = lobby.players.find(p => p.id === myId);
    sfx.click();
    act({ t: 'ready', r: !(mine && mine.ready) });
});
$('btn-start').addEventListener('click', () => { sfx.click(); hostStart(); });
$('btn-bot').addEventListener('click', () => { sfx.click(); addBot(); });
$('btn-again').addEventListener('click', () => { sfx.click(); hostBackToLobby(); });

// ============================================================
// Vote UI
// ============================================================
function showVote(ms) {
    view = 'vote';
    show('vote');
    voteEnds = performance.now() + ms;
    const bar = $('vote-bar');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${ms}ms linear`;
    bar.style.transform = 'scaleX(0)';
    renderVote();
}

function renderVote() {
    const grid = $('courses');
    grid.innerHTML = '';
    const votes = lobby.votes || {};
    for (const c of COURSES) {
        const card = el('button', 'course' + (votes[myId] === c.id ? ' on' : '') + (c.available ? '' : ' locked'));
        card.type = 'button';
        const cv = el('canvas');
        cv.width = 440;
        cv.height = 260;
        drawCourseMap(cv.getContext('2d'), c, 440, 260);
        const dots = el('div', 'votes');
        for (const p of lobby.players) {
            if (votes[p.id] !== c.id) continue;
            const d = el('i');
            d.style.background = p.color;
            d.title = p.name;
            dots.append(d);
        }
        card.append(cv, el('b', null, c.name), el('p', null, c.available ? `${c.desc} ${c.laps} laps.` : c.desc), dots);
        if (c.available) card.addEventListener('click', () => { sfx.click(); act({ t: 'vote', c: c.id }); });
        else card.append(el('span', 'soon', 'COMING SOON'));
        grid.append(card);
    }
}

// ============================================================
// Race setup and teardown
// ============================================================
function makeRacer(p, g) {
    const cfg = VEHICLE_BY_ID[p.vehicle] || VEHICLES[0];
    const model = buildVehicleModel(cfg, p.color);
    if (p.custom) applyCustomization(model, p.custom);
    else if (p.id === myId) applyCustomization(model, myCustom);
    scene.add(model.root);
    let tag = null;
    if (p.id !== myId) {
        tag = el('div', 'tag', p.name);
        tag.style.color = p.color;
        $('tags').append(tag);
    }
    return {
        id: p.id, name: p.name, color: p.color, bot: p.bot, cfg, model, tag,
        owned: p.id === myId || (role !== 'client' && p.bot),
        x: g.x, z: g.z, y: 0, vy: 0, airborne: false, h: g.h, vx: 0, vz: 0, speed: 0, steer: 0, lean: 0, wheelSpin: 0,
        idx: g.i, dist: g.dist, lat: 0, fwdDot: 0, lap: 0, half: true, fin: false, finTime: 0, place: 0, rank: 1,
        atkT: 0, atkSide: 1, cd: 1.5, stunT: 0, spin: 0, boostT: 0, catchup: 1,
        drifting: false, driftDir: 0, driftCharge: 0, driftLevel: 0,
        nitro: 0, nitroOn: false, drafting: false, draftT: 0, near: {},
        item: null, itemAmmo: 0, itemRoll: 0, itemHeld: 0, botItemT: 0,
        shieldT: 0, gumT: 0, spinVisT: 0, spinVis: 0, braking: false, offroadVis: false, jolt: 0, scrapeT: 0,
        botLane: rand(-4, 4), laneT: rand(1, 4), botSkill: rand(0.9, 0.97), stuckT: 0, reverseT: 0,
        net: null,
    };
}

function removeRacer(id) {
    const r = racers.get(id);
    if (!r) return;
    scene.remove(r.model.root);
    if (r.tag) r.tag.remove();
    racers.delete(id);
}

function teardownRace() {
    paused = false;
    $('pause').classList.add('hidden');
    for (const id of [...racers.keys()]) removeRacer(id);
    me = null;
    for (const id of [...projectiles.keys()]) removeProjectile(id);
    for (const id of [...traps.keys()]) removeTrap(id);
    for (const k in seen) seen[k].clear();
    trapOwner.clear();
    if (boxes) { scene.remove(boxes.group); boxes = null; }
    if (track) {
        scene.remove(track.group);
        track.dispose();
        track = null;
    }
    scene.fog = null;
    applyLook(null);
    soft.clear();
    glow.clear();
    skids.clear();
    streaks.lines.visible = false;
    confettiT = 0;
    $('pops').innerHTML = '';
    $('center-msg').textContent = '';
    $('wrong-way').classList.add('hidden');
    $('splat').classList.remove('on');
    $('speedlines').style.opacity = '0';
    $('bonus').innerHTML = '';
    centerT = 0;
}

function startRace(msg) {
    teardownRace();
    const course = COURSE_BY_ID[msg.course] || COURSES[0];
    track = buildTrack(course);
    scene.add(track.group);
    if (track.fog) scene.fog = track.fog;
    applyLook(track.theme);
    boxes = buildItemBoxes(track);
    scene.add(boxes.group);
    sandRGB = new THREE.Color(track.theme.sand);
    garage.visible = false;
    msg.grid.forEach((id, slot) => {
        const p = msg.players.find(q => q.id === id);
        if (p) racers.set(id, makeRacer(p, track.gridPos(slot)));
    });
    me = racers.get(myId) || null;
    raceClock = -msg.ms / 1000;
    lastCount = null;
    sendAcc = 0;
    wrongT = 0;
    if (me) {
        camH = me.h;
        camPos.set(me.x - Math.cos(me.h) * 9, 3.8, me.z - Math.sin(me.h) * 9);
        $('ability-name').textContent = me.cfg.attack.name;
        const atkLabels = { car: 'SLAM', truck: 'CRUSH', kart: 'BASH' };
        $('touch-attack').textContent = atkLabels[me.cfg.kind] || (me.cfg.shape === 'dirt' ? 'KICK' : 'WHACK');
        hudItem = undefined;
    }
    setupMinimap();
    view = 'race';
    show('hud');
    toast(`${course.name}: ${course.laps} laps`);
    playMusic('race');
}

// ============================================================
// Race simulation
// ============================================================
function playerInput() {
    let steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let brake = !!(keys.KeyS || keys.ArrowDown);
    if (document.body.classList.contains('touch')) {
        brake = joy.id !== null && joy.y > 0.5;
        throttle = brake ? -1 : 1;
        if (joy.id !== null) steer = clamp(joy.x * 1.4, -1, 1);
        else if (tilt.on && tilt.got) steer = tiltToSteer(tilt.amount, tilt.zero);
    }
    // Holding back/brake while using an item throws it the other way
    return { steer, throttle, brake, back: brake };
}

let testFreezeBots = false, testAutopilot = false, testSteps = 1;   // only ever set by the #debug test hooks
function botInput(r, dt, list) {
    if (testFreezeBots && r !== me) return { steer: 0, throttle: 0 };
    const la = 8 + Math.abs(r.speed) * 0.5;
    const tp = track.pointAhead(r.idx, la, r.botLane);
    const d = angleDiff(r.h, Math.atan2(tp.z - r.z, tp.x - r.x));
    let steer = clamp(d * 2.4, -1, 1);
    const curve = track.curvatureAhead(r.idx, 18 + Math.abs(r.speed) * 0.6);
    const skill = r.fin ? 0.75 : r.botSkill;
    const maxSpeed = r.cfg.top * skill * (r.catchup || 1) * (r.nitroOn ? 1.35 : 1) * (1 - clamp(curve * 0.55, 0, 0.5));
    let throttle = r.speed < maxSpeed ? 1 : r.speed > maxSpeed + 5 ? -0.7 : 0.2;

    if (Math.abs(r.speed) < 2 && raceClock > 2) r.stuckT += dt; else r.stuckT = 0;
    if (r.stuckT > 1.2) { r.reverseT = 1; r.stuckT = 0; }
    if (r.reverseT > 0) {
        r.reverseT -= dt;
        throttle = -1;
        steer = -steer;
    }
    r.laneT -= dt;
    if (r.laneT <= 0) { r.botLane = rand(-4.5, 4.5); r.laneT = rand(2, 5); }

    if (r !== me && !r.fin && r.cd <= 0 && Math.random() < dt * 1.5) {
        if (findAttackTarget(r, list.filter(o => o !== r)).target) tryAttack(r, list);
    }
    // Nitro on the straights, sooner when behind
    if (!r.nitroOn && !r.fin && r.nitro >= (r.rank > 1 ? 45 : 90) && curve < 0.22 && r.stunT <= 0) tryNitro(r);
    const shouldDrift = curve > 0.45 && r.speed > 18 && r.botSkill > 0.93;
    return { steer, throttle, brake: shouldDrift };
}

function tryAttack(r, list) {
    if (r.cd > 0 || r.stunT > 0 || raceClock < 0) return;
    const hit = findAttackTarget(r, list.filter(o => o !== r));
    r.cd = r.cfg.attack.cd;
    r.atkT = ATK_TIME;
    r.atkSide = hit.side;
    sendAs(r, { t: 'atk', id: newId(r.id), target: hit.target ? hit.target.id : null, side: hit.side });
    if (!hit.target && r === me) sfx.whoosh();
}

function onAttack(msg) {
    if (msg.id) {
        if (seen.atk.has(msg.id)) return;
        seen.atk.add(msg.id);
    }
    const a = racers.get(msg.from);
    if (!a) return;
    if (!a.owned) { a.atkT = ATK_TIME; a.atkSide = msg.side; }
    if (!msg.target) return;
    const v = racers.get(msg.target);
    if (!v) return;
    const vol = soundVol(v);
    if (v.shieldT > 0) {
        // The bubble shield soaks it up
        sfx.shieldPop(vol);
        popWord(v, 'BLOCKED!', '#5adcff');
        burst(v.x, (v.y || 0) + 1.2, v.z, [0.4, 0.9, 1.4], 18, 7);
        if (v.owned) { v.shieldT = 0; stats.blocked++; }
        return;
    }
    (sfx[a.cfg.attack.sound] || sfx.bonk)(vol);
    popWord(v, a.cfg.attack.word, a.color);
    burst(v.x, (v.y || 0) + 1.2, v.z, [1.6, 1.3, 0.5], 14, 8);
    if (a.owned && !seen.credit.has('a' + msg.id)) {
        seen.credit.add('a' + msg.id);
        addNitro(a, 15, a === me ? 'BONK' : null);
    }
    if (v.owned) {
        // Shove the victim sideways, away from the attacker, and set them spinning (briefly)
        const f = a.cfg.attack.force / v.cfg.mass;
        const rx = -Math.sin(a.h), rz = Math.cos(a.h);
        v.vx += rx * msg.side * f;
        v.vz += rz * msg.side * f;
        v.speed *= 0.65;
        v.stunT = 0.8;
        v.driftLevel = 0;
        v.spin = msg.side * rand(3, 4.5) * (v.cfg.kind === 'bike' ? 1.25 : 1);
    }
    if (v === me) hitMe(0.8);
}

function hitMe(amount) {
    shake = Math.max(shake, amount);
    const f = $('hit-flash');
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 60);
}
const soundVol = v => (me ? clamp(1 - Math.hypot(v.x - me.x, v.z - me.z) / 90, 0.12, 1) : 1);

// Send an event about one of our own racers (us, or a bot the host runs) to the host
function sendAs(r, msg) {
    if (r === me) act(msg);
    else hostHandle(r.id, msg);
}

// ============================================================
// Nitro
// ============================================================
function addNitro(r, amount, label) {
    if (r.nitroOn || r.fin) return;
    const before = r.nitro;
    r.nitro = Math.min(100, r.nitro + amount);
    if (r === me) {
        if (label) bonusPop(`${label} +${Math.round(r.nitro - before)}`);
        if (before < 100 && r.nitro >= 100) sfx.itemGet();
    }
}

function tryNitro(r) {
    if (r.nitroOn || r.nitro < NITRO_MIN || r.stunT > 0 || raceClock < 0 || r.fin) return false;
    r.nitroOn = true;
    if (r === me) {
        sfx.nitro();
        shake = Math.max(shake, 0.3);
    } else if (me && Math.hypot(r.x - me.x, r.z - me.z) < 40) sfx.whoosh();
    return true;
}

// Everything that fills the nitro meter, apart from hits and hoops (handled where they happen)
function nitroSources(r, list, dt, ev) {
    if (raceClock < 0 || r.fin) return;
    if (!r.nitroOn) {
        r.nitro = Math.min(100, r.nitro + dt * 1.2);                       // slow trickle
        if (r.drifting && r.speed > 12) r.nitro = Math.min(100, r.nitro + dt * (9 + r.driftLevel * 3));
    }
    if (ev.miniturbo) addNitro(r, [0, 6, 11, 18][ev.miniturbo], 'MINI-TURBO');
    if (ev.hoopPass) addNitro(r, 25, 'HOOP');
    // Slipstream: tuck in close behind someone. Near-miss: pass within 1.5 of them without touching.
    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    let drafting = false;
    for (const o of list) {
        if (o === r || Math.abs((o.y || 0) - (r.y || 0)) > 2.5) continue;
        const dx = o.x - r.x, dz = o.z - r.z;
        const along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        if (r.speed > 18 && (o.speed || 0) > 12 && along > 2 && along < 16 && Math.abs(lat) < 2.2 + along * 0.05) drafting = true;
        const gap = Math.hypot(dx, dz) - r.cfg.radius - o.cfg.radius;
        const nm = r.near[o.id] || (r.near[o.id] = { close: false, touched: false, rel: 0, cd: 0 });
        nm.cd = Math.max(0, nm.cd - dt);
        if (gap < 1.5 && r.speed > 20) {
            if (!nm.close) { nm.close = true; nm.touched = false; nm.rel = 0; }
            nm.rel = Math.max(nm.rel, Math.abs(r.speed - (o.speed || 0)));
            if (gap <= 0.02 || ev.touched === o.id) nm.touched = true;
        } else if (nm.close && gap > 3.2) {
            if (!nm.touched && nm.cd <= 0 && nm.rel > 3) {
                addNitro(r, 10, 'NEAR MISS');
                nm.cd = 1.5;
                if (r === me) sfx.nearMiss();
            }
            nm.close = false;
        }
    }
    r.draftT = drafting ? r.draftT + dt : 0;
    const was = r.drafting;
    r.drafting = r.draftT > 0.5;
    if (r.drafting && !r.nitroOn) r.nitro = Math.min(100, r.nitro + dt * 16);
    if (r === me && r.drafting && !was) bonusPop('SLIPSTREAM');
}

// ============================================================
// Items and weapons
// ============================================================
const trapOwner = new Map();
const HIT_WORDS = { chicken: 'BAWK!', tomato: 'SPLAT!', glove: 'POW!', gum: 'STUCK!', oil: 'WHOOPS!' };
const progressOf = r => r.lap * track.total + r.dist;

// 0 = leading, 1 = dead last and/or a long way behind the leader
function backness(r, list) {
    if (list.length < 2) return 0.35;
    let lead = -Infinity;
    for (const o of list) lead = Math.max(lead, progressOf(o));
    return clamp(Math.max((r.rank - 1) / (list.length - 1), (lead - progressOf(r)) / 220), 0, 1);
}

// Drive through a box to get a random item. Boxes are local: each browser hides its own copy
// for a few seconds, and only a racer's own browser rolls their item, so nobody fights over them.
function checkBoxes(list) {
    if (!boxes) return;
    for (const b of boxes.boxes) {
        if (b.hideT > 0) continue;
        for (const r of list) {
            const dx = r.x - b.x, dz = r.z - b.z;
            if (dx * dx + dz * dz > 2.7 * 2.7 || Math.abs((r.y || 0) - b.y) > 2.6) continue;
            b.hideT = BOX_RESPAWN;
            burst(b.x, b.y + 1.4, b.z, [1.4, 1.1, 1.8], 16, 7);
            if (r.owned && !r.fin && !r.item && r.itemRoll <= 0 && raceClock >= 0) {
                r.item = rollItem(backness(r, list));
                r.itemAmmo = ITEMS[r.item].ammo || 1;
                r.itemRoll = ROULETTE_TIME;
                r.itemHeld = 0;
                r.botItemT = rand(0.5, 2.5);
                if (r === me) sfx.pickup();
            }
            break;
        }
    }
}

// The racer directly ahead (or behind) in the race order
function neighbourInOrder(r, list, behind) {
    const mine = progressOf(r);
    let best = null, bestD = Infinity;
    for (const o of list) {
        if (o === r || o.fin) continue;
        const d = behind ? mine - progressOf(o) : progressOf(o) - mine;
        if (d > 0 && d < bestD) { bestD = d; best = o; }
    }
    return best;
}

function useItem(r, back, list) {
    if (!r.item || r.itemRoll > 0 || r.stunT > 0 || raceClock < 0 || r.fin) return false;
    const k = r.item;
    const y = r.y || 0;
    if (k === 'shield') {
        r.shieldT = SHIELD_TIME;
        if (r === me) sfx.shieldUp();
    } else if (k === 'mega') {
        r.nitro = 100;
        if (r === me) { sfx.itemGet(); bonusPop('MEGA NITRO'); }
    } else if (ITEMS[k].trap) {
        // Dropped behind, or lobbed well ahead if you're holding back/brake
        let x, z, ty;
        if (back) {
            const a = track.pointAhead(r.idx, 22, clamp(r.lat, -6, 6));
            x = a.x; z = a.z; ty = a.y;
        } else {
            const d = r.cfg.radius + 1.8;
            x = r.x - Math.cos(r.h) * d; z = r.z - Math.sin(r.h) * d; ty = y;
        }
        const msg = { t: 'trap', id: newId(r.id), k, x, y: ty, z, fx: r.x, fy: y, fz: r.z };
        placeTrap({ ...msg, o: r.id });
        sendAs(r, msg);
    } else {
        // Projectiles go forward, or backwards if you're holding back/brake
        const dirH = back ? r.h + Math.PI : r.h;
        const tgt = k === 'chicken' ? neighbourInOrder(r, list, back) : null;
        const nose = r.cfg.radius + 1.3;
        const msg = {
            t: 'fire', id: newId(r.id), k, x: r.x + Math.cos(dirH) * nose, y: y + 1, z: r.z + Math.sin(dirH) * nose, h: dirH,
            sp: k === 'tomato' ? (back ? 30 : Math.max(0, r.speed) + 46) : 0, tgt: tgt ? tgt.id : null, back: back ? 1 : 0,
        };
        fireProjectile({ ...msg, o: r.id });
        sendAs(r, msg);
    }
    r.itemAmmo--;
    if (r.itemAmmo <= 0) r.item = null;
    return true;
}

// Bots: missiles when someone's ahead, traps when someone's close behind, shields and nitro straight away
function botItems(r, list, dt) {
    if (!r.item || r.itemRoll > 0 || r.fin || raceClock < 0 || testFreezeBots) return;
    r.itemHeld += dt;
    r.botItemT -= dt;
    if (r.botItemT > 0) return;
    r.botItemT = rand(0.3, 0.7);
    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    const near = (minA, maxA, w) => list.some(o => {
        if (o === r || o.fin) return false;
        const dx = o.x - r.x, dz = o.z - r.z, along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        return along > minA && along < maxA && Math.abs(lat) < w;
    });
    let use = false, back = false;
    switch (r.item) {
        case 'chicken': use = r.rank > 1 || r.itemHeld > 12; break;
        case 'tomato': use = near(3, 40, 4) || (back = near(-30, -3, 4)) || r.itemHeld > 10; break;
        case 'glove': use = near(1, 9, 2.6) || (back = near(-9, -1, 2.6)) || r.itemHeld > 14; break;
        case 'gum': case 'oil': use = near(-22, -3, 5) || r.itemHeld > 9; break;
        default: use = true;
    }
    if (use) useItem(r, back, list);
}

function fireProjectile(msg) {
    if (!msg || typeof msg.id !== 'string' || seen.fire.has(msg.id) || !ITEMS[msg.k] || !track) return;
    seen.fire.add(msg.id);
    const p = spawnProjectile(msg, track);
    projectiles.set(p.id, p);
    if (p.mesh) {
        p.mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(p.mesh);
    }
    stats.firesSpawned++;
    const o = racers.get(p.o);
    const vol = o ? soundVol(o) : 1;
    if (p.k === 'chicken') sfx.squawk(vol);
    else if (p.k === 'glove') sfx.boing(vol);
    else sfx.throw();
}
function removeProjectile(id) {
    const p = projectiles.get(id);
    if (!p) return;
    if (p.mesh) scene.remove(p.mesh);
    projectiles.delete(id);
}

function placeTrap(msg) {
    if (!msg || typeof msg.id !== 'string' || seen.trap.has(msg.id) || seen.gone.has(msg.id) || !track) return;
    seen.trap.add(msg.id);
    trapOwner.set(msg.id, msg.o);
    const t = spawnTrap(msg);
    traps.set(t.id, t);
    if (t.mesh) scene.add(t.mesh);
    stats.trapsPlaced++;
    const o = racers.get(msg.o);
    sfx.throw(o ? soundVol(o) : 1);
}
function removeTrap(id) {
    const t = traps.get(id);
    seen.gone.add(id);
    if (!t) return;
    if (t.mesh) scene.remove(t.mesh);
    traps.delete(id);
    stats.trapsRemoved++;
}

// A hit on one of OUR racers (us, or a bot the host runs). Returns true if a shield blocked it.
function applyItemHit(v, k, ownerId, back) {
    if (v.shieldT > 0) {
        v.shieldT = 0;
        stats.blocked++;
        return true;
    }
    stats.hitsApplied++;
    v.driftLevel = 0;
    if (k === 'gum') {
        v.gumT = 1.0;
        v.speed *= 0.6;
    } else if (k === 'glove') {
        const o = racers.get(ownerId);
        const dir = o ? o.h + (back ? Math.PI : 0) : v.h;
        const f = 20 / v.cfg.mass;
        v.vx += Math.cos(dir) * f;
        v.vz += Math.sin(dir) * f;
        v.speed *= 0.55;
        v.stunT = 0.6;
        v.spin = (Math.random() < 0.5 ? -1 : 1) * rand(3, 4.5);
    } else {
        // Missile, tomato, oil: a quick spin-out
        v.speed *= k === 'tomato' ? 0.55 : 0.45;
        v.stunT = 0.8;
        v.spinVisT = 0.8;
        if (k === 'tomato' && v === me) showSplat();
    }
    if (v === me) hitMe(0.7);
    v.jolt = 1.5;
    return false;
}

function hitFx(v, k, blocked) {
    const vol = soundVol(v);
    const y = (v.y || 0) + 1.2;
    if (blocked) {
        sfx.shieldPop(vol);
        popWord(v, 'BLOCKED!', '#5adcff');
        burst(v.x, y, v.z, [0.4, 0.9, 1.4], 22, 8);
        return;
    }
    popWord(v, HIT_WORDS[k] || 'BONK!', k === 'gum' ? '#ff7ec8' : k === 'oil' ? '#b9a8ff' : '#ffd23f');
    if (k === 'tomato') { sfx.splat(vol); splatBurst(v.x, y, v.z); }
    else if (k === 'chicken') { sfx.squawk(vol); sfx.bonk(vol); burst(v.x, y, v.z, [1.8, 1.4, 0.3], 26, 10); feathers(v.x, y, v.z); }
    else if (k === 'glove') { sfx.punch(vol); burst(v.x, y, v.z, [1.8, 0.5, 0.4], 24, 11); }
    else if (k === 'gum') { sfx.gum(vol); }
    else if (k === 'oil') { sfx.slip(vol); }
}

// Our own browser decides whether our racers got hit
function reportHit(p, v) {
    const key = `${p.id}|${v.id}`;
    if (seen.hit.has(key)) return;
    seen.hit.add(key);
    const blocked = applyItemHit(v, p.k, p.o, p.back);
    removeProjectile(p.id);
    hitFx(v, p.k, blocked);
    sendAs(v, { t: 'ihit', pid: p.id, v: v.id, k: p.k, o: p.o, blk: blocked ? 1 : 0 });
}
function onItemHit(msg) {
    const key = `${msg.pid}|${msg.v}`;
    const v = racers.get(msg.v);
    if (!seen.hit.has(key)) {
        seen.hit.add(key);
        removeProjectile(msg.pid);
        if (v) {
            if (!v.owned) {
                if (msg.blk) v.shieldT = 0;
                else if (msg.k !== 'gum' && msg.k !== 'glove') v.spinVisT = 0.8;
            }
            hitFx(v, msg.k, msg.blk);
        }
    }
    const a = racers.get(msg.o);
    if (a && a.owned && !msg.blk && msg.o !== msg.v && !seen.credit.has(key)) {
        seen.credit.add(key);
        addNitro(a, 15, 'DIRECT HIT');
    }
}

function trapHit(t, v) {
    if (seen.gone.has(t.id)) return;
    const blocked = applyItemHit(v, t.k, t.o, false);
    removeTrap(t.id);
    hitFx(v, t.k, blocked);
    sendAs(v, { t: 'trapHit', id: t.id, v: v.id, blk: blocked ? 1 : 0 });
}
function onTrapGone(msg) {
    const t = traps.get(msg.id);
    if (!seen.gone.has(msg.id)) {
        removeTrap(msg.id);
        const v = racers.get(msg.v);
        if (v && t) {
            if (!v.owned && !msg.blk && t.k === 'oil') v.spinVisT = 0.8;
            hitFx(v, t.k, msg.blk);
        }
    }
    const owner = msg.o || trapOwner.get(msg.id);
    const a = racers.get(owner);
    if (a && a.owned && !msg.blk && owner !== msg.v && !seen.credit.has('t' + msg.id)) {
        seen.credit.add('t' + msg.id);
        addNitro(a, 15, 'TRAPPED ONE');
    }
}

// Move every projectile and trap, and check them against the racers this browser owns
function updateWeapons(dt, list) {
    for (const [id, p] of projectiles) {
        if (!stepProjectile(p, dt, track, racers)) {
            if (p.splat) splatBurst(p.x, p.y, p.z);
            removeProjectile(id);
            continue;
        }
        if (raceClock < 0) continue;
        const reach = p.k === 'chicken' ? 1.3 : p.k === 'tomato' ? 0.8 : 1.1;
        if (p.k === 'glove' && !(p.ext > 1.5)) continue;
        for (const v of list) {
            if (!v.owned || v.fin || v.id === p.o) continue;
            const R = v.cfg.radius + reach;
            const dx = v.x - p.x, dz = v.z - p.z;
            if (dx * dx + dz * dz < R * R && Math.abs((v.y || 0) + 1 - p.y) < 2.4) { reportHit(p, v); break; }
        }
    }
    for (const [id, t] of traps) {
        if (!stepTrap(t, dt)) { removeTrap(id); continue; }
        if (!t.landed || raceClock < 0) continue;
        for (const v of list) {
            if (!v.owned || v.fin || v.airborne) continue;
            if (v.id === t.o && t.age < TRAP_ARM_TIME) continue;
            const R = trapRadius(t.k) + v.cfg.radius * 0.5;
            const dx = v.x - t.x, dz = v.z - t.z;
            if (dx * dx + dz * dz < R * R && Math.abs((v.y || 0) - t.y) < 1.6) { trapHit(t, v); break; }
        }
    }
}

function updateLap(r, prev) {
    const T = track.total, d = r.dist;
    if (d > T * 0.3 && d < T * 0.7) r.half = true;
    if (prev - d > T * 0.5 && r.half) {
        r.lap++;
        r.half = false;
        if (r.lap > track.laps && !r.fin) finishRacer(r);
        else if (r === me && r.lap > 1) {
            centerMsg(r.lap === track.laps ? 'FINAL LAP' : `LAP ${r.lap}`, null, r.lap === track.laps ? 'gold' : '', 1.4);
            sfx.lap();
        }
    } else if (d - prev > T * 0.5) {
        // Crossed the line backwards
        r.lap--;
        r.half = true;
    }
}

function finishRacer(r) {
    r.fin = true;
    r.finTime = raceClock;
    const msg = { t: 'fin', time: raceClock };
    if (r === me) { sfx.finish(); act(msg); }
    else hostHandle(r.id, msg);
}

function onFinish(msg) {
    const r = racers.get(msg.id);
    if (!r) return;
    r.fin = true;
    r.place = msg.place;
    r.finTime = msg.time;
    r.nitroOn = false;
    if (msg.place === 1) {
        // Confetti for the winner (and a shower around your screen if that's you)
        for (let i = 0; i < 90; i++) confettiBit(r.x + rand(-3, 3), (r.y || 0) + rand(1, 4), r.z + rand(-3, 3), true);
        if (msg.id === myId) { confettiT = 3.5; sfx.cheer(); }
    }
    if (msg.id === myId) centerMsg(`${msg.place}${ordinal(msg.place)}`, msg.place === 1 ? 'YOU WIN! WAITING FOR THE OTHERS...' : 'FINISHED! WAITING FOR THE OTHERS...', msg.place === 1 ? 'gold' : 'go', Infinity);
    else toast(`${r.name} finished ${msg.place}${ordinal(msg.place)}`);
}

// Compact position packet:
// [id, x, z, heading, vx, vz, lap, dist, steer, attacking, stunned, finished, y, flags, driftLevel]
// flags: 1 nitro, 2 boosting, 4 drifting, 8 braking, 16 shield, 32 off-road, 64 gummed, 128 drifting left
function pack(r) {
    const flags = (r.nitroOn ? 1 : 0) | (r.boostT > 0 ? 2 : 0) | (r.drifting ? 4 : 0) | (r.braking ? 8 : 0)
        | (r.shieldT > 0 ? 16 : 0) | (r.offroadVis ? 32 : 0) | (r.gumT > 0 ? 64 : 0) | (r.driftDir < 0 ? 128 : 0);
    return [r.id, +r.x.toFixed(2), +r.z.toFixed(2), +r.h.toFixed(3), +r.vx.toFixed(2), +r.vz.toFixed(2), r.lap, Math.round(r.dist * 10) / 10, +r.steer.toFixed(2), r.atkT > 0 ? 1 : 0, r.stunT > 0 ? 1 : 0, r.fin ? 1 : 0, +(r.y || 0).toFixed(2), flags, r.driftLevel || 0];
}

function applyStates(arr) {
    const now = performance.now();
    for (const s of arr) {
        const r = racers.get(s[0]);
        if (!r || r.owned) continue;
        const [, x, z, h, vx, vz, lap, dist, steer, , stun, fin] = s;
        const y = s[12] || 0, flags = s[13] | 0;
        if (!r.net) { r.x = x; r.z = z; r.h = h; }
        r.net = { x, z, h, vx, vz, y, t: now };
        r.lap = lap;
        r.dist = dist;
        r.steer = steer;
        r.stunT = stun ? 0.2 : 0;
        if (fin) r.fin = true;
        r.nitroOn = !!(flags & 1);
        r.boostT = flags & 2 ? 0.3 : 0;
        r.drifting = !!(flags & 4);
        r.driftDir = flags & 128 ? -1 : 1;
        r.driftLevel = s[14] | 0;
        r.braking = !!(flags & 8);
        r.shieldT = flags & 16 ? 0.5 : 0;
        r.offroadVis = !!(flags & 32);
        r.gumT = flags & 64 ? 0.3 : 0;
    }
}

function interpolateRemote(r, dt) {
    const n = r.net;
    const age = Math.min(0.25, (performance.now() - n.t) / 1000);
    const px = n.x + n.vx * age, pz = n.z + n.vz * age;
    const k = 1 - Math.exp(-12 * dt);
    if (Math.hypot(px - r.x, pz - r.z) > 12) { r.x = px; r.z = pz; }
    else { r.x += (px - r.x) * k; r.z += (pz - r.z) * k; }
    r.y = r.y || 0;
    r.y += ((n.y || 0) - r.y) * k;
    r.h = lerpAngle(r.h, n.h, k);
    r.vx = n.vx;
    r.vz = n.vz;
    r.speed = Math.hypot(n.vx, n.vz);
    r.wheelSpin += (r.speed * dt) / 0.42;
    const sf = clamp(r.speed / r.cfg.top, 0, 1);
    r.lean = r.cfg.kind === 'bike' ? r.steer * sf * 0.5 : r.cfg.kind === 'atv' ? r.steer * sf * 0.15 : -r.steer * sf * 0.06;
    if (r.stunT > 0) r.stunT = Math.max(0, r.stunT - dt * 0.2);
    // Keep a local idea of where they are on the course (for homing missiles and effects)
    if (track) {
        const q = track.project(r.x, r.z, r.idx, r.y);
        r.idx = q.i;
        r.lat = q.lat;
    }
}

function sendStates(dt) {
    sendAcc += dt;
    if (sendAcc < SEND_EVERY) return;
    sendAcc = 0;
    if (role === 'client') {
        if (me) act({ t: 'st', s: pack(me) });
    } else if (net) {
        const a = [];
        for (const r of racers.values()) if (r.owned) a.push(pack(r));
        for (const [id, s] of H.states) if (racers.has(id)) a.push(s);
        net.broadcast({ t: 'sts', a });
    }
}

function rankRacers(list) {
    const T = track.total;
    return [...list].sort((a, b) => {
        if (a.fin !== b.fin) return a.fin ? -1 : 1;
        if (a.fin && b.fin) return (a.place || 99) - (b.place || 99) || a.finTime - b.finTime;
        return (b.lap * T + b.dist) - (a.lap * T + a.dist);
    });
}

function updateRace(dt) {
    raceClock += dt;
    if (raceClock < 0) {
        const n = Math.ceil(-raceClock);
        if (n <= 3 && n !== lastCount) {
            lastCount = n;
            centerMsg(String(n), null, '', 0.9);
            sfx.count();
        }
    } else if (lastCount !== 0) {
        lastCount = 0;
        centerMsg('GO!', null, 'go', 1);
        sfx.go();
        recenterTilt(); // however you're holding the phone at GO counts as straight ahead
    }
    const racing = raceClock >= 0;
    const list = [...racers.values()];
    const ranked = rankRacers(list);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    track.update(dt);
    if (boxes) boxes.update(dt);
    // Catch-up: the further behind the leader you are, the higher your top speed (up to +10%).
    // The leader never gets slowed down.
    let lead = -Infinity;
    for (const r of list) if (!r.fin) lead = Math.max(lead, progressOf(r));
    const field = clamp((list.length - 1) / 7, 0.4, 1);

    for (const r of list) {
        if (r.atkT > 0) r.atkT = Math.max(0, r.atkT - dt);
        if (r.spinVisT > 0) {
            r.spinVisT = Math.max(0, r.spinVisT - dt);
            const t = 1 - r.spinVisT / 0.8;
            r.spinVis = r.spinVisT > 0 ? Math.PI * 2 * (1 - (1 - t) * (1 - t)) : 0;
        }
        if (r.owned) {
            r.cd = Math.max(0, r.cd - dt);
            if (r.shieldT > 0) r.shieldT = Math.max(0, r.shieldT - dt);
            if (r.itemRoll > 0) {
                r.itemRoll = Math.max(0, r.itemRoll - dt);
                if (r === me && r.itemRoll === 0) sfx.itemGet();
            }
            let input = { steer: 0, throttle: 0 };
            if (racing) input = r === me && !r.fin && !testAutopilot ? playerInput() : botInput(r, dt, list);
            if (r === me && racing && !r.fin) {
                if (wantAttack) tryAttack(r, list);
                if (wantFire) useItem(r, input.back || fireBack, list);
                if (wantNitro) tryNitro(r);
            }
            if (r !== me && racing) botItems(r, list, dt);
            const gap = r.fin ? 0 : Math.max(0, lead - progressOf(r));
            r.catchup = 1 + 0.1 * field * clamp(gap / 180, 0, 1);
            const prev = r.dist;
            const ev = stepPhysics(r, input, dt, track, list.filter(o => o !== r));
            r.offroadVis = ev.offroad;
            nitroSources(r, list, dt, ev);
            if (ev.land) r.jolt = Math.min(2.5, ev.land / 6);
            if (ev.bump > 4) r.jolt = Math.min(2, ev.bump / 12);
            if (ev.scrape > 6) {
                // Sparks where we rub the barrier
                const n = quality === 'high' ? 3 : 1;
                for (let i = 0; i < n; i++) glow.emit({ x: ev.wallX, y: (r.y || 0) + rand(0.3, 0.9), z: ev.wallZ, vx: r.vx * 0.5 + rand(-4, 4), vy: rand(2, 6), vz: r.vz * 0.5 + rand(-4, 4), size: rand(0.12, 0.22), life: rand(0.25, 0.5), r: 3, g: 1.1, b: 0.25, a: 1, grav: 14, drag: 1 });
            }
            if (r === me) {
                if (ev.boost) sfx.boost();
                if (ev.miniturbo) sfx.miniturbo(ev.miniturbo);
                if (ev.bump > 6) { sfx.bump(); shake = Math.max(shake, Math.min(0.5, ev.bump / 30)); }
                if (ev.hoop) sfx.boost();
                if (ev.land) { sfx.bump(); shake = Math.max(shake, clamp(ev.land / 40, 0.15, 0.45)); }
                r.scrapeT = Math.max(0, r.scrapeT - dt);
                if (ev.scrape > 6 && r.scrapeT <= 0) { sfx.scrape(clamp(ev.scrape / 40, 0.3, 1)); r.scrapeT = 0.11; }
            }
            if (racing) updateLap(r, prev);
        } else if (r.net) {
            interpolateRemote(r, dt);
        }
        animateModel(r.model, r, dt);
        racerFx(r, dt);
    }
    checkBoxes(list);
    updateWeapons(dt, list);
    wantAttack = wantFire = wantNitro = fireBack = false;
    updateAmbientFx(dt);
    soft.update(dt, camera, renderer.domElement.height);
    glow.update(dt, camera, renderer.domElement.height);
    streaks.update(dt, me, me && !me.fin ? (me.nitroOn ? 1 : me.drafting ? 0.7 : 0) : 0);
    sendStates(dt);
    updateCamera(dt);
    updateTags();
    if (view === 'race') updateHud(ranked, dt);
    const live = view === 'race' && !!me;
    engine.set(me ? clamp(Math.abs(me.speed) / me.cfg.top, 0, 1.4) : 0, live);
    driftSound.set(me ? me.driftLevel : 0, live && me.drifting);
    nitroSound.set(live && me.nitroOn);
    rumble.set(live && me.offroadVis && !me.airborne ? 0.5 + clamp(Math.abs(me.speed) / me.cfg.top, 0, 1) * 0.5 : 0);
}

// ============================================================
// Effects: smoke, skids, dust, sparks, bursts, confetti, embers
// ============================================================
let sandRGB = new THREE.Color(0xe2c48e), confettiT = 0;
const DRIFT_TINT = [[0.8, 0.8, 0.84], [0.5, 0.75, 1.3], [1.4, 0.75, 0.4], [1.1, 0.5, 1.4]];
const CONFETTI = [[1, 0.3, 0.4], [1, 0.85, 0.2], [0.3, 0.9, 0.6], [0.3, 0.6, 1], [0.8, 0.4, 1], [1, 1, 1]];

function racerFx(r, dt) {
    const far = Math.hypot(r.x - camera.position.x, r.z - camera.position.z) > 95;
    const fx = Math.cos(r.h), fz = Math.sin(r.h), rx = -fz, rz = fx;
    const y = r.y || 0;
    const back = r.cfg.radius * 0.85, side = r.cfg.kind === 'bike' ? 0.05 : r.cfg.radius * 0.62;
    const grounded = !r.airborne && !(r.net && Math.abs(r.net.y - y) > 0.8);
    if (r.drifting && grounded && !far && Math.abs(r.speed) > 8) {
        const tint = DRIFT_TINT[r.driftLevel || 0];
        for (const s of r.cfg.kind === 'bike' ? [0] : [1, -1]) {
            const wx = r.x - fx * back + rx * s * side, wz = r.z - fz * back + rz * s * side;
            if (Math.random() < dt * 34) {
                soft.emit({ x: wx, y: y + 0.3, z: wz, vx: -fx * 3 + rand(-1.2, 1.2), vy: rand(0.6, 1.8), vz: -fz * 3 + rand(-1.2, 1.2), size: rand(0.7, 1.1), grow: 3.4, life: rand(0.7, 1.1), r: tint[0] * 0.8, g: tint[1] * 0.8, b: tint[2] * 0.8, a: 0.42, drag: 1.4 });
            }
            if (r.driftLevel > 0 && Math.random() < dt * 22) {
                glow.emit({ x: wx, y: y + 0.2, z: wz, vx: -fx * 4 + rand(-2, 2), vy: rand(1, 3), vz: -fz * 4 + rand(-2, 2), size: 0.16, life: 0.35, r: tint[0] * 2, g: tint[1] * 2, b: tint[2] * 2, a: 1, grav: 9 });
            }
            skids.add(`${r.id}${s}`, wx, y + 0.035, wz, r.cfg.kind === 'bike' ? 0.2 : 0.3, 0.55);
        }
    } else {
        skids.lift(`${r.id}1`);
        skids.lift(`${r.id}-1`);
        skids.lift(`${r.id}0`);
    }
    if (far) return;
    // Dust off the road
    if (r.offroadVis && grounded && Math.abs(r.speed) > 7 && Math.random() < dt * 30) {
        soft.emit({ x: r.x - fx * back + rand(-0.8, 0.8), y: y + 0.3, z: r.z - fz * back + rand(-0.8, 0.8), vx: -fx * 2 + rand(-1.5, 1.5), vy: rand(0.8, 2.2), vz: -fz * 2 + rand(-1.5, 1.5), size: rand(0.8, 1.4), grow: 3, life: rand(0.8, 1.3), r: sandRGB.r, g: sandRGB.g, b: sandRGB.b, a: 0.5, drag: 1.2, grav: -0.2 });
    }
    // Hot sparks spitting out of the flames
    if ((r.nitroOn || r.boostT > 0) && Math.random() < dt * (r.nitroOn ? 30 : 10)) {
        const c = new THREE.Color(r.color);
        glow.emit({ x: r.x - fx * (back + 0.6), y: y + 0.5, z: r.z - fz * (back + 0.6), vx: -fx * 8 + rand(-2, 2), vy: rand(0.5, 2.5), vz: -fz * 8 + rand(-2, 2), size: rand(0.15, 0.3), life: rand(0.25, 0.45), r: c.r * 2.5 + 0.6, g: c.g * 2.5 + 0.3, b: c.b * 2.5, a: 1, grav: 3, drag: 2 });
    }
}

// A burst of glowing bits (hits, pickups, blocks)
function burst(x, y, z, col, n, speed) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = rand(-0.3, 1);
        glow.emit({ x, y, z, vx: Math.cos(a) * speed * rand(0.4, 1), vy: e * speed * 0.8, vz: Math.sin(a) * speed * rand(0.4, 1), size: rand(0.2, 0.45), life: rand(0.35, 0.7), r: col[0], g: col[1], b: col[2], a: 1, grav: 8, drag: 2.5 });
    }
}
function splatBurst(x, y, z) {
    for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        soft.emit({ x, y, z, vx: Math.cos(a) * rand(2, 7), vy: rand(1, 6), vz: Math.sin(a) * rand(2, 7), size: rand(0.25, 0.55), life: rand(0.5, 0.9), r: 0.85, g: 0.1, b: 0.06, a: 0.95, grav: 16, drag: 1 });
    }
}
function feathers(x, y, z) {
    for (let i = 0; i < 16; i++) soft.emit({ x, y, z, vx: rand(-4, 4), vy: rand(1, 5), vz: rand(-4, 4), size: rand(0.25, 0.4), life: rand(1, 1.8), r: 1, g: 0.9, b: 0.4, a: 0.95, grav: 2, drag: 2.5 });
}
function confettiBit(x, y, z, pop) {
    const c = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
    soft.emit({ x, y, z, vx: rand(-5, 5), vy: pop ? rand(4, 12) : rand(-1, 1), vz: rand(-5, 5), size: rand(0.2, 0.34), life: rand(1.8, 3), r: c[0], g: c[1], b: c[2], a: 1, grav: 4, drag: 1.6 });
}

// Weather and atmosphere around the camera: embers on the volcano, snow on the summit, confetti
function updateAmbientFx(dt) {
    if (!track) return;
    const T = track.theme, cx = camera.position.x, cz = camera.position.z;
    const fx = Math.cos(camH), fz = Math.sin(camH);
    if (T.embers && Math.random() < dt * 50) {
        const d = rand(4, 45), l = rand(-25, 25);
        glow.emit({ x: cx + fx * d - fz * l, y: camera.position.y + rand(-4, 2), z: cz + fz * d + fx * l, vx: rand(-0.8, 0.8), vy: rand(1.2, 3), vz: rand(-0.8, 0.8), size: rand(0.12, 0.26), life: rand(2, 3.5), r: 3, g: 1.1, b: 0.25, a: 1, grav: -0.2, drag: 0.3 });
    }
    if (T.snow && Math.random() < dt * 70) {
        const d = rand(2, 40), l = rand(-22, 22);
        soft.emit({ x: cx + fx * d - fz * l, y: camera.position.y + rand(4, 10), z: cz + fz * d + fx * l, vx: rand(-1, 1), vy: -rand(1.5, 3), vz: rand(-1, 1), size: rand(0.12, 0.22), life: 4, r: 1, g: 1, b: 1, a: 0.9, drag: 0.2 });
    }
    if (confettiT > 0) {
        confettiT -= dt;
        for (let i = 0; i < 3; i++) confettiBit(cx + fx * rand(4, 12) + rand(-6, 6), camera.position.y + rand(3, 6), cz + fz * rand(4, 12) + rand(-6, 6), false);
    }
}

// ============================================================
// Camera, HUD, minimap, floating text
// ============================================================
const camTmp = new THREE.Vector3();
function updateCamera(dt) {
    const target = me || racers.values().next().value;
    if (!target) return;
    if (camera.view && camera.view.enabled) camera.clearViewOffset();
    // The camera swings round a little late in turns, which sells the speed
    camH = lerpAngle(camH, target.h, 1 - Math.exp(-3.6 * dt));
    const sp = clamp(Math.abs(target.speed) / target.cfg.top, 0, 1.4);
    fovKick += ((target.nitroOn ? 1 : 0) - fovKick) * (1 - Math.exp(-(target.nitroOn ? 6 : 2.5) * dt));
    const big = target.cfg.kind === 'truck' ? 1.25 : 1;
    const back = (target.cfg.kind === 'bike' ? 8 : 9) * big + sp * 0.5 - fovKick * 1.4;
    const ty = target.y || 0;
    camSide += (-(target.steer || 0) * sp * 1.1 - camSide) * (1 - Math.exp(-3 * dt));
    const rx = -Math.sin(camH), rz = Math.cos(camH);
    camTmp.set(target.x - Math.cos(camH) * back + rx * camSide, ty + 3.7 * big - fovKick * 0.25, target.z - Math.sin(camH) * back + rz * camSide);
    camPos.lerp(camTmp, 1 - Math.exp(-8 * dt));
    camera.position.copy(camPos);
    if (target.nitroOn) shake = Math.max(shake, 0.1);
    if (shake > 0) {
        camera.position.x += rand(-shake, shake) * 0.4;
        camera.position.y += rand(-shake, shake) * 0.4;
        shake = Math.max(0, shake - dt * 2);
    }
    camera.lookAt(target.x + Math.cos(camH) * 6, ty + 1.3 * big, target.z + Math.sin(camH) * 6);
    const fov = 62 + sp * 11 + fovKick * 11;
    if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-5 * dt));
        camera.updateProjectionMatrix();
    }
    sun.position.set(target.x - 30, ty + 70, target.z + 25);
    sun.target.position.set(target.x, ty, target.z);
}

const projV = new THREE.Vector3();
function toScreen(x, y, z) {
    projV.set(x, y, z).project(camera);
    return { x: ((projV.x + 1) / 2) * innerWidth, y: ((1 - projV.y) / 2) * innerHeight, visible: projV.z < 1 && Math.abs(projV.x) < 1.15 && Math.abs(projV.y) < 1.15 };
}

function updateTags() {
    for (const r of racers.values()) {
        if (!r.tag) continue;
        const d = Math.hypot(r.x - camera.position.x, r.z - camera.position.z);
        const s = toScreen(r.x, (r.y || 0) + (r.model.starY || 2.4) + 0.4, r.z);
        const vis = s.visible && d < 110;
        r.tag.style.display = vis ? '' : 'none';
        if (vis) {
            r.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
            r.tag.style.opacity = d > 70 ? String((110 - d) / 40) : '1';
        }
    }
}

function popWord(r, word, color) {
    const s = toScreen(r.x, (r.y || 0) + 2.6, r.z);
    if (!s.visible || view !== 'race') return;
    const w = el('div', 'pop-word', word);
    w.style.left = `${s.x}px`;
    w.style.top = `${s.y}px`;
    w.style.color = color;
    $('pops').append(w);
    setTimeout(() => w.remove(), 1000);
}

function centerMsg(text, sub, cls, hold) {
    const c = $('center-msg');
    c.className = '';
    c.textContent = text;
    if (sub) c.append(el('small', null, sub));
    if (cls) c.classList.add(cls);
    void c.offsetWidth;
    c.classList.add('pop');
    centerT = hold;
}

const RING = 2 * Math.PI * 22;
function updateHud(ranked, dt) {
    if (!me) return;
    const L = track.laps;
    $('pos').textContent = me.rank;
    $('pos-suf').textContent = ordinal(me.rank);
    $('pos-of').textContent = `/${racers.size}`;
    $('lap').textContent = me.fin ? 'Done' : `${clamp(me.lap, 1, L)}/${L}`;
    $('time').textContent = fmtTime(Math.max(0, me.fin ? me.finTime : raceClock));

    const ol = $('standings');
    if (ol.children.length !== ranked.length) {
        ol.innerHTML = '';
        for (let i = 0; i < ranked.length; i++) {
            const li = el('li');
            li.append(el('span', 'n'), el('i'), el('em'), el('span', 'fin'));
            ol.append(li);
        }
    }
    ranked.forEach((r, i) => {
        const li = ol.children[i];
        li.className = r === me ? 'me' : '';
        li.children[0].textContent = i + 1;
        li.children[1].style.background = r.color;
        li.children[2].textContent = r.name;
        li.children[3].textContent = r.fin ? 'FIN' : '';
    });

    const frac = me.cd / me.cfg.attack.cd;
    $('cd-ring').style.strokeDashoffset = String(RING * frac);
    $('ability').classList.toggle('ready', me.cd <= 0);
    $('touch-attack').style.opacity = me.cd <= 0 ? '1' : '0.45';
    $('speed').textContent = Math.round(Math.abs(me.speed) * 3.6);

    // Drift indicator
    $('drift-bar').style.opacity = me.drifting ? '1' : '0';
    const di = $('drift-indicator');
    if (me.drifting) {
        di.classList.remove('hidden');
        const pct = clamp(me.driftCharge / 3.5, 0, 1) * 100;
        di.style.width = `${pct}%`;
        di.classList.toggle('level1', me.driftLevel === 1);
        di.classList.toggle('level2', me.driftLevel === 2);
        di.classList.toggle('level3', me.driftLevel === 3);
    } else {
        di.classList.add('hidden');
        di.style.width = '0';
        di.classList.remove('level1', 'level2', 'level3');
    }

    if (raceClock > 1 && !me.fin && me.fwdDot < -4) wrongT += dt; else wrongT = 0;
    $('wrong-way').classList.toggle('hidden', wrongT < 0.8);

    // Nitro meter (bar on desktop, ring around the NITRO button on touch)
    const n = Math.round(me.nitro);
    const nm = $('nitro');
    $('nitro-fill').style.transform = `scaleX(${me.nitro / 100})`;
    $('nitro-num').textContent = me.nitroOn ? 'BURN' : n >= 100 ? 'FULL' : n >= NITRO_MIN ? 'READY' : `${n}%`;
    nm.classList.toggle('ready', !me.nitroOn && n >= NITRO_MIN);
    nm.classList.toggle('full', !me.nitroOn && n >= 100);
    nm.classList.toggle('on', me.nitroOn);
    const tn = $('touch-nitro');
    tn.style.setProperty('--fill', `${me.nitro * 3.6}deg`);
    tn.classList.toggle('ready', !me.nitroOn && n >= NITRO_MIN);
    tn.classList.toggle('on', me.nitroOn);

    // Item slot, with a roulette spin after picking up a box
    let shown = me.item;
    if (me.itemRoll > 0) {
        shown = ROLL_ORDER[Math.floor(performance.now() / 75) % ROLL_ORDER.length];
        if (shown !== hudItem) sfx.tick();
    }
    const key = `${shown}|${me.itemRoll > 0}|${me.itemAmmo}`;
    if (key !== hudItemKey) {
        hudItemKey = key;
        hudItem = shown;
        const icon = shown ? ICONS[shown] : '';
        $('item-icon').innerHTML = icon;
        $('fire-icon').innerHTML = icon;
        $('item-name').textContent = shown && me.itemRoll <= 0 ? ITEMS[shown].short : me.itemRoll > 0 ? '...' : 'NO ITEM';
        $('item-count').textContent = shown && me.itemRoll <= 0 && me.itemAmmo > 1 ? `x${me.itemAmmo}` : '';
        $('item-slot').classList.toggle('has', !!shown && me.itemRoll <= 0);
        $('item-slot').classList.toggle('rolling', me.itemRoll > 0);
        $('touch-fire').classList.toggle('has', !!shown && me.itemRoll <= 0);
    }
    $('item-slot').classList.toggle('shielded', me.shieldT > 0);

    // Speed lines while the nitro burns (a lighter version while slipstreaming)
    const lines = me.nitroOn ? 0.85 : me.drafting ? 0.3 : 0;
    const sl = $('speedlines');
    sl.style.opacity = String(lines);
    if (lines) sl.style.setProperty('--rot', `${Math.floor(Math.random() * 360)}deg`);
    $('vignette').style.opacity = String(clamp((Math.abs(me.speed) / me.cfg.top - 0.7) * 1.4, 0, 0.7) + fovKick * 0.3);
    drawMinimap();
}
const ROLL_ORDER = ['chicken', 'tomato', 'gum', 'glove', 'oil', 'shield', 'mega'];
let hudItem, hudItemKey = '';

// Little "+10 NEAR MISS" style messages above the nitro meter
function bonusPop(text) {
    const b = $('bonus');
    const e = el('div', 'bonus', text);
    b.prepend(e);
    while (b.children.length > 3) b.lastChild.remove();
    setTimeout(() => e.remove(), 1400);
}

// Tomato on the windscreen: only ever shown on the victim's own screen
let splatTimer = null;
function showSplat() {
    const s = $('splat');
    s.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        const b = el('i');
        b.style.left = `${rand(5, 80)}%`;
        b.style.top = `${rand(5, 70)}%`;
        const size = rand(14, 34);
        b.style.width = b.style.height = `${size}vmin`;
        b.style.transform = `rotate(${rand(0, 360)}deg)`;
        s.append(b);
    }
    s.classList.remove('on');
    void s.offsetWidth;
    s.classList.add('on');
    clearTimeout(splatTimer);
    splatTimer = setTimeout(() => s.classList.remove('on'), 1500);
}

let mm = null;
function setupMinimap() {
    const c = $('minimap'), size = 170, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.N; i += 5) {
        minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
        minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    const pad = 22, sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * sc) / 2 - minX * sc, oz = (size - (maxZ - minZ) * sc) / 2 - minZ * sc;
    const path = new Path2D();
    for (let i = 0; i < track.N; i += 5) {
        const x = track.px[i] * sc + ox, y = track.pz[i] * sc + oz;
        if (i) path.lineTo(x, y); else path.moveTo(x, y);
    }
    path.closePath();
    // Bridge decks get drawn again on top, so you can see which road goes over
    const upper = new Path2D();
    let on = false;
    for (let i = 0; i <= track.N; i += 2) {
        const k = i % track.N;
        const x = track.px[k] * sc + ox, y = track.pz[k] * sc + oz;
        if (track.py[k] > 3) { if (on) upper.lineTo(x, y); else upper.moveTo(x, y); on = true; } else on = false;
    }
    mm = { ctx: c.getContext('2d'), dpr, sc, ox, oz, path, upper, size };
}

function drawMinimap() {
    const { ctx, dpr, sc, ox, oz, path, upper, size } = mm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 9;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(10,14,12,0.9)';
    ctx.lineWidth = 8;
    ctx.stroke(upper);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3.5;
    ctx.stroke(upper);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(track.px[0] * sc + ox - 3, track.pz[0] * sc + oz - 3, 6, 6);
    const dot = (r, rad) => {
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x * sc + ox, r.z * sc + oz, rad, 0, Math.PI * 2);
        ctx.fill();
    };
    for (const r of racers.values()) if (r !== me) dot(r, 3.6);
    if (me) {
        dot(me, 5.5);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// ============================================================
// Results
// ============================================================
function showResults(list) {
    view = 'results';
    show('results');
    $('center-msg').textContent = '';
    centerT = 0;
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const r of list) {
        const li = el('li', r.id === myId ? 'me' : '');
        const dot = el('span', 'dot');
        dot.style.background = r.color;
        const who = el('div', 'who');
        who.append(el('b', null, r.name), el('small', null, VEHICLE_BY_ID[r.vehicle] ? VEHICLE_BY_ID[r.vehicle].name : ''));
        const time = el('div', 'time', r.time != null ? fmtTime(r.time) : 'DNF');
        time.append(el('small', null, r.bonks ? `${r.bonks} bonk${r.bonks > 1 ? 's' : ''}` : ''));
        li.append(el('span', 'place', String(r.place)), dot, who, time);
        ol.append(li);
    }
    const mine = list.find(r => r.id === myId);
    $('results-title').textContent = mine ? (mine.place === 1 ? 'You win!' : `You came ${mine.place}${ordinal(mine.place)}`) : 'Results';
    const bonker = [...list].sort((a, b) => b.bonks - a.bonks)[0];
    $('results-award').textContent = bonker && bonker.bonks ? `Most bonks: ${bonker.name} with ${bonker.bonks}` : 'A remarkably polite race. Nobody bonked anybody.';
    engine.set(0, false);
    driftSound.set(0, false);
    nitroSound.set(false);
    rumble.set(0);
    $('speedlines').style.opacity = '0';
    playMusic('results');
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') { togglePause(); return; }
    if (paused) return;
    keys[e.code] = true;
    if (view === 'race' && !e.repeat) {
        if (e.code === 'Space') wantAttack = true;
        if (e.code === 'KeyE' || e.code === 'KeyQ') { wantFire = true; fireBack = !!(keys.KeyS || keys.ArrowDown); }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyN') wantNitro = true;
    }
    if (view === 'race' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
// Right mouse button fires your item
canvas.addEventListener('mousedown', e => { if (e.button === 2 && view === 'race' && !paused) { wantFire = true; fireBack = !!(keys.KeyS || keys.ArrowDown); } });
addEventListener('contextmenu', e => { if (view === 'race') e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    resetJoy();
});

// Touch: floating joystick anywhere on screen, plus a big attack button
const JOY_R = 55;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function resetJoy() {
    joy.id = null;
    joy.x = joy.y = 0;
    $('joy').classList.remove('on');
    $('joy-knob').style.transform = '';
}
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    e.preventDefault();
    if (joy.id !== null || view !== 'race') return;
    joy.id = e.pointerId;
    joy.ox = e.clientX;
    joy.oy = e.clientY;
    const j = $('joy');
    j.style.left = `${joy.ox}px`;
    j.style.top = `${joy.oy}px`;
    j.classList.add('on');
});
canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    joy.x = dx / JOY_R;
    joy.y = dy / JOY_R;
    $('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
});
const endJoy = e => { if (e.pointerId === joy.id) resetJoy(); };
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);
$('touch-attack').addEventListener('pointerdown', e => {
    e.preventDefault();
    wantAttack = true;
});
$('touch-fire').addEventListener('pointerdown', e => {
    e.preventDefault();
    wantFire = true;
    fireBack = joy.id !== null && joy.y > 0.5;
});
$('touch-nitro').addEventListener('pointerdown', e => {
    e.preventDefault();
    wantNitro = true;
});

// Tilt steering (optional, phones only)
const tilt = { on: store.get('bonkTilt') === '1', amount: 0, zero: 0, got: false, needsPermission: false };
const needsMotionPermission = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
}
function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    tilt.amount = tiltAmount(e.beta, e.gamma, screenAngle());
    tilt.got = true;
}
function recenterTilt() {
    if (tilt.on && tilt.got) tilt.zero = clamp(tilt.amount, -0.3, 0.3);
}
function syncTiltUi() {
    $('tilt-toggle').checked = tilt.on;
    $('btn-tilt').textContent = tilt.on ? 'Tilt on' : 'Tilt off';
    $('btn-tilt').classList.toggle('on', tilt.on);
}
// Must be called from a tap: iPhones only allow asking for motion access in response to one
async function setTilt(on) {
    if (on) {
        if (typeof DeviceOrientationEvent === 'undefined') {
            toast("This device doesn't support tilt steering.");
            on = false;
        } else if (needsMotionPermission()) {
            try {
                if (await DeviceOrientationEvent.requestPermission() !== 'granted') {
                    toast('Motion access was denied, so tilt steering is off.');
                    on = false;
                }
            } catch (e) {
                toast('Could not turn on tilt steering.');
                on = false;
            }
        }
    }
    tilt.on = on;
    tilt.needsPermission = false;
    store.set('bonkTilt', on ? '1' : '0');
    removeEventListener('deviceorientation', onOrient);
    if (on) {
        tilt.got = false;
        addEventListener('deviceorientation', onOrient);
        setTimeout(() => {
            if (!tilt.on) return;
            if (!tilt.got) {
                toast('No motion sensor found, so tilt steering is off.');
                setTilt(false);
            } else {
                recenterTilt();
            }
        }, 3000);
        toast('Tilt steering on. Turn your phone like a wheel.');
    }
    syncTiltUi();
}
$('tilt-toggle').addEventListener('change', e => setTilt(e.target.checked));
$('btn-tilt').addEventListener('click', e => { setTilt(!tilt.on); e.currentTarget.blur(); });
// Remembered from last time: re-attach, asking iPhones for permission on the first tap
if (tilt.on) {
    if (needsMotionPermission()) {
        tilt.needsPermission = true;
        addEventListener('pointerdown', () => { if (tilt.on && tilt.needsPermission) setTilt(true); }, { once: true });
    } else {
        addEventListener('deviceorientation', onOrient);
    }
}
syncTiltUi();

// ============================================================
// Main loop
// ============================================================
const compactLayout = () => innerWidth <= 1000 || innerHeight <= 560;

function updateGarage(dt) {
    const compact = view === 'lobby' && compactLayout();
    // Step the camera back for the big trucks so the whole thing fits
    const fit = showcase ? Math.max(1, showcase.size / 4.6) : 1;
    camera.position.set(0, 2.3 * fit, (compact ? 12 : 8.6) * fit);
    camera.lookAt(0, 0.95 * fit, 0);
    if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix(); }
    // On phones the lobby stacks vertically with the car in the top band, so shift the render up
    const lift = compact ? Math.max(0, innerHeight / 2 - (70 + innerHeight * 0.22)) : 0;
    if (lift) camera.setViewOffset(innerWidth, innerHeight, 0, lift, innerWidth, innerHeight);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    sun.position.set(-8, 16, 10);
    sun.target.position.set(0, 0, 0);
    if (!showcase) updateShowcase();
    const s = showcase.state;
    if (!showcase.fixed) s.h += dt * 0.45;
    showDemoT -= dt;
    if (showDemoT <= 0) {
        // Show off the special move every few seconds
        showDemoT = 3.2;
        s.atkT = ATK_TIME;
        s.atkSide = -s.atkSide;
    }
    s.atkT = Math.max(0, s.atkT - dt);
    animateModel(showcase.model, s, dt);
    showcase.model.root.position.y = 0.3;
    engine.set(0, false);
    driftSound.set(0, false);
}

let last = performance.now(), debugFps = 0;
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    debugFps += ((1000 / Math.max(1, now - last)) - debugFps) * 0.05;
    last = now;
    if (track && racers.size && (view === 'race' || view === 'results') && !paused) for (let i = 0; i < testSteps && track; i++) updateRace(dt);
    else if (!paused) updateGarage(dt);
    if (view === 'vote') $('vote-timer').textContent = Math.max(0, Math.ceil((voteEnds - now) / 1000));
    if (centerT > 0 && centerT !== Infinity) {
        centerT -= dt;
        if (centerT <= 0) $('center-msg').textContent = '';
    }
    post.render();
    requestAnimationFrame(frame);
}

// Test hooks for automated tests; they only exist with #debug in the URL.
// bonkDebug() is a read-only snapshot; bonkTest has test-only helpers (grant items, fill nitro, move racers).
if (location.hash === '#debug') {
    const snap = r => r && {
        id: r.id, name: r.name, bot: !!r.bot, owned: r.owned, radius: r.cfg.radius, x: r.x, y: r.y || 0, z: r.z, h: r.h, speed: r.speed, lat: r.lat, dist: r.dist, lap: r.lap,
        rank: r.rank, fin: r.fin, stunT: r.stunT, spinVisT: r.spinVisT, shieldT: r.shieldT, gumT: r.gumT, nitro: r.nitro, nitroOn: r.nitroOn,
        drafting: r.drafting, drifting: r.drifting, driftLevel: r.driftLevel, item: r.item, itemAmmo: r.itemAmmo, itemRoll: r.itemRoll,
        offroad: r.offroadVis, airborne: !!r.airborne, catchup: r.catchup, boostT: r.boostT, idx: r.idx,
        flames: r.model.flames.some(f => f.visible), shieldVisible: r.model.shield.visible,
        hat: r.model._hat ? r.model._hat.parent === r.model.hatAnchor : false, patterned: !!r.model.paintMat.map, paint: '#' + r.model.paintMat.color.getHexString(),
    };
    window.bonkDebug = () => (me ? { ...snap(me), steer: me.steer, tilt: { ...tilt }, view, course: track && track.course.id, raceClock, quality, fps: debugFps } : null);
    window.bonkTest = {
        racers: () => [...racers.values()].map(snap),
        projectiles: () => [...projectiles.values()].map(p => ({ id: p.id, k: p.k, o: p.o, x: p.x, y: p.y, z: p.z, age: p.age, tgt: p.tgt })),
        traps: () => [...traps.values()].map(t => ({ id: t.id, k: t.k, o: t.o, x: t.x, y: t.y, z: t.z, landed: t.landed })),
        stats: () => ({ ...stats, seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size])) }),
        splat: () => $('splat').classList.contains('on'),
        give(k, who) { const r = who ? racers.get(who) : me; if (r && ITEMS[k]) { r.item = k; r.itemAmmo = ITEMS[k].ammo || 1; r.itemRoll = 0; r.itemHeld = 0; r.botItemT = 99; } },
        nitro(v, who) { const r = who ? racers.get(who) : me; if (r) r.nitro = v; },
        use(back, who) { const r = who ? racers.get(who) : me; return r ? useItem(r, !!back, [...racers.values()]) : false; },
        put(o) {
            const r = o.id ? racers.get(o.id) : me;
            if (!r || !track) return null;
            const q = track.project(o.x, o.z, null, o.y);
            Object.assign(r, { x: o.x, z: o.z, y: q.y, _prevGroundY: q.y, h: o.h ?? r.h, speed: o.speed || 0, idx: q.i, dist: q.dist, airborne: false, vy: 0, stunT: 0, spin: 0 });
            r.vx = Math.cos(r.h) * r.speed;
            r.vz = Math.sin(r.h) * r.speed;
            return snap(r);
        },
        freezeBots(on) { testFreezeBots = !!on; },
        autopilot(on) { testAutopilot = !!on; },
        speedUp(n) { testSteps = Math.max(1, Math.min(12, n | 0)); },
        // Put a racer at a fraction of the lap, `lat` across the road, heading offset `dh`, moving at `speed`
        place(o) {
            const r = o.id ? racers.get(o.id) : me;
            if (!r || !track) return null;
            const j = Math.floor(((o.frac % 1) + 1) % 1 * track.N);
            const h = track.heading[j] + (o.dh || 0);
            r.x = track.px[j] + track.nx[j] * (o.lat || 0);
            r.z = track.pz[j] + track.nz[j] * (o.lat || 0);
            r.y = track.py[j];
            r._prevGroundY = r.y;
            r.airborne = false;
            r.vy = 0;
            r.h = h;
            r.speed = o.speed || 0;
            r.vx = Math.cos(h) * r.speed;
            r.vz = Math.sin(h) * r.speed;
            r.idx = j;
            r.dist = track.cum[j];
            r.stunT = 0;
            r.spin = 0;
            if (r.net) r.net = { ...r.net, x: r.x, z: r.z, h, t: performance.now() };
            return snap(r);
        },
        client: msg => clientHandle(msg),
        host: (from, msg) => hostHandle(from, msg),
        overlaps: () => COURSES.map(c => ({ id: c.id, problems: findOverlaps(c) })),
        // Host only: everyone "votes" for this course and the vote ends now
        pickCourse(id) {
            if (H.phase !== 'vote' || !COURSE_BY_ID[id]) return false;
            for (const p of H.players.values()) H.votes.set(p.id, id);
            finishVote();
            return true;
        },
        showcase: () => showcase && showcase.model,
        // Draw calls and triangles for one of each vehicle
        vehicleStats: () => VEHICLES.map(v => {
            const m = buildVehicleModel(v, '#ff0000');
            let calls = 0, tris = 0;
            m.root.traverse(o => {
                if (!o.isMesh || !o.visible) return;
                let vis = true;
                for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
                if (!vis) return;
                calls += Array.isArray(o.material) ? o.material.length : 1;
                const g = o.geometry;
                tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
            });
            return { id: v.id, drawCalls: calls, triangles: Math.round(tris) };
        }),
        spinGarage(h) { if (showcase) { showcase.state.h = h; showcase.fixed = true; } },
        setQuality(q) { quality = q; applyQuality(); },
        pick(nx, ny) {
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
            return rc.intersectObjects(scene.children, true).slice(0, 6).map(h => ({ type: h.object.type, geo: h.object.geometry.type, y: +h.point.y.toFixed(3), d: +h.distance.toFixed(2), mat: h.object.material && h.object.material.map ? 'textured' : (h.object.material && h.object.material.color ? h.object.material.color.getHexString() : '?'), vis: h.object.visible }));
        },
        hideGround() { scene.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width === 2400) o.visible = false; }); },
        pose(id) {
            const r = id ? racers.get(id) : me;
            const a = r && r.model.anim;
            if (!a) return null;
            const m = r.model;
            return { pitch: +m.susp.rotation.z.toFixed(4), roll: +m.susp.rotation.x.toFixed(4), heave: +m.susp.position.y.toFixed(4), squash: +(1 - m.susp.scale.y).toFixed(4), slide: +a.slide.toFixed(3), frontSteer: m.front[0] ? +m.front[0].rotation.y.toFixed(3) : null, tuck: +a.tuck.toFixed(3), look: +a.look.toFixed(3), bodyLean: +m.body.rotation.x.toFixed(3), riderLean: m.rider ? +m.rider.rotation.x.toFixed(3) : null, wheelY: m.wheels[0] ? +m.wheels[0].pivot.position.y.toFixed(3) : null };
        },
        sceneInfo() {
            const grounds = [];
            scene.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width === 2400) grounds.push(o.position.y); });
            return { children: scene.children.length, grounds, trackInScene: !!(track && track.group.parent), cam: camera.position.toArray().map(v => +v.toFixed(2)), near: camera.near, fov: +camera.fov.toFixed(1) };
        },
        fx(name, on) { const o = { skids: skids.mesh, soft: soft.points, glow: glow.points, streaks: streaks.lines }[name]; if (o) o.visible = !!on; },
    };
}

show('menu');
updateShowcase();
requestAnimationFrame(frame);
