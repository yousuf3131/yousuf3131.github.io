// Deadline — Tron lightcycle arena for up to 8 players.
// Host-authoritative, PeerJS + MQTT relay networking.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HostNet, ClientNet, makeCode } from './net.js';
import { sfx, isMuted, setMuted, unlockAudio, startEngine, updateEngine, stopEngine } from './audio.js';
import { startMusic, stopMusic, setMusicVolume } from './music.js';
import { tiltAmount, tiltToSteer } from './tilt.js';

/* ── constants ─────────────────────────────────────────── */
const MAX_PLAYERS = 8;
const BEST_OF     = 5;
const BASE_SPEED  = 20;
const BOOST_SPEED = 30;
const BOOST_DUR   = 2;
const BOOST_MAX   = 3;
const TURN_RATE   = 3.0;
const TURN_RATE_BOOST = 2.1;
const TRAIL_H     = 1.2;
const TRAIL_SAMPLE_DIST = 1.5;
const TRAIL_TURN_THRESH = 0.04;
const MAX_TRAIL_PTS = 2000;
const SKIP_SELF_SEGS = 5;
const GRID_SIZE   = 5;
const SEND_EVERY  = 0.05;
const COUNTDOWN_S = 3;
const POWERUP_MIN = 8;
const POWERUP_MAX = 12;
const MAX_POWERUPS = 2;
const GAP_SEGS    = 15;
const CYCLE_R     = 0.6;

const COLORS = ['#00e5ff','#ff0055','#39ff14','#ffea00','#bf5fff','#ff6d00','#ff69b4','#e0e0e0'];
const BOT_NAMES = ['Tron','Quorra','Rinzler','CLU','Flynn','Sark','Ram','Yori'];

/* ── arenas ────────────────────────────────────────────── */
const ARENAS = [
    { id:'classic', name:'Classic Grid', w:80, h:60, walls:[], theme:{ grid:0x00ccff, wall:0x00ffff, floor:0x060618, fog:0x020210 } },
    { id:'maze', name:'The Maze', w:90, h:70,
      walls:[ {x1:-15,z1:-25,x2:-15,z2:5},{x1:15,z1:-5,x2:15,z2:25},{x1:-30,z1:10,x2:-10,z2:10},{x1:10,z1:-10,x2:30,z2:-10},{x1:0,z1:-20,x2:0,z2:-5},{x1:-5,z1:15,x2:10,z2:15} ],
      theme:{ grid:0xff00ff, wall:0xff44ff, floor:0x0a0418, fog:0x060210 } },
    { id:'corridors', name:'Corridors', w:100, h:80,
      walls:[ {x1:-20,z1:-30,x2:-20,z2:-5},{x1:20,z1:5,x2:20,z2:30},{x1:-35,z1:0,x2:-10,z2:0},{x1:10,z1:0,x2:35,z2:0},{x1:-20,z1:20,x2:20,z2:20},{x1:-20,z1:-20,x2:20,z2:-20} ],
      theme:{ grid:0xffaa00, wall:0xff8800, floor:0x0a0800, fog:0x060400 } },
    { id:'shift', name:'Moving Walls', w:85, h:65, walls:'dynamic',
      theme:{ grid:0x44ff44, wall:0x22ff66, floor:0x040a04, fog:0x020602 } },
];

/* ── DOM ───────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const canvas   = $('c');
const elMenu   = $('menu');
const elLobby  = $('lobby');
const elHud    = $('hud');
const elPause  = $('pause');
const elResult = $('results');

/* ── renderer & scene ──────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x020208);
scene.fog = new THREE.Fog(0x020208, 80, 200);

const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.5, 500);
camera.position.set(0, 50, 35);
camera.lookAt(0, 0, 0);

/* bloom */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.4, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* lighting */
scene.add(new THREE.HemisphereLight(0x0a0a2a, 0x000008, 0.3));
scene.add(new THREE.AmbientLight(0x111133, 0.4));
const sun = new THREE.DirectionalLight(0x4444aa, 0.5);
sun.position.set(20, 40, 10);
scene.add(sun);

/* resize */
function onResize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
}
addEventListener('resize', onResize);
onResize();

/* ── game state ────────────────────────────────────────── */
let myName = '', role = '', myId = '', roomCode = '', view = 'menu';
let net = null, gameActive = false, paused = false;
const players = new Map();
let me = null;
let shake = 0;

/* host-only state */
const H = {
    players: [],
    phase: 'lobby',
    round: 0,
    arena: null,
    powerups: [],
    nextPowerup: 10,
    powerupUid: 0,
    grid: new Map(),
};

/* arena scene objects */
let arenaGroup = null;
let floorMesh = null;
let currentArena = null;

/* ── trail shader ──────────────────────────────────────── */
const TRAIL_VERT = `
varying float vHeight;
void main(){
    vHeight = position.y / ${TRAIL_H.toFixed(1)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const TRAIL_FRAG = `
uniform vec3 uColor;
varying float vHeight;
void main(){
    float core = smoothstep(0.8,0.0,vHeight)*0.8+0.2;
    vec3 col = uColor * core * 2.5;
    gl_FragColor = vec4(col, core);
}`;

/* ── floor grid shader ─────────────────────────────────── */
const FLOOR_VERT = `
varying vec2 vWorld;
void main(){
    vWorld = (modelMatrix * vec4(position,1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const FLOOR_FRAG = `
uniform vec3 uGridColor;
uniform float uAlpha;
varying vec2 vWorld;
void main(){
    vec2 g = abs(fract(vWorld/5.0-0.5)-0.5)/fwidth(vWorld/5.0);
    float line = 1.0 - min(min(g.x,g.y),1.0);
    vec2 bg = abs(fract(vWorld/20.0-0.5)-0.5)/fwidth(vWorld/20.0);
    float bline = (1.0 - min(min(bg.x,bg.y),1.0))*0.5;
    float a = max(line*uAlpha, bline*uAlpha);
    gl_FragColor = vec4(uGridColor*1.5, a);
}`;

/* ── helpers ───────────────────────────────────────────── */
function show(id) {
    for (const el of [elMenu, elLobby, elHud, elResult, elPause]) el.classList.add('hidden');
    if (id === 'menu') elMenu.classList.remove('hidden');
    if (id === 'lobby') elLobby.classList.remove('hidden');
    if (id === 'game') elHud.classList.remove('hidden');
    if (id === 'results') elResult.classList.remove('hidden');
    view = id;
}

function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3400);
}

function centerMsg(txt, dur = 1.5) {
    const el = $('center-msg');
    el.textContent = txt;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    if (dur > 0) setTimeout(() => { if (el.textContent === txt) el.textContent = ''; }, dur * 1000);
}

/* ── networking ────────────────────────────────────────── */
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

/* ── host handle ───────────────────────────────────────── */
function hostHandle(from, msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
        case 'hello': {
            if (H.phase !== 'lobby') return emit({ t: 'reject', reason: 'Game in progress.' });
            if (H.players.length >= MAX_PLAYERS) return;
            const idx = H.players.length;
            H.players.push({ id: from, name: msg.name || 'Player', color: COLORS[idx % COLORS.length], ready: from === myId, bot: false, wins: 0 });
            if (net) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
            if (from !== myId) toast(`${msg.name} joined`);
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === from);
            if (p) { p.ready = !!msg.r; emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) }); }
            break;
        }
        case 'input': {
            const p = players.get(from);
            if (p && p.alive) {
                p.turnInput = msg.turn || 0;
                if (msg.boost && !p.boosting && p.boostCharges > 0) {
                    p.boosting = true;
                    p.boostT = BOOST_DUR;
                    p.boostCharges--;
                    emit({ t: 'boost', id: from, charges: p.boostCharges });
                }
            }
            break;
        }
        case 'kick': {
            if (from !== myId) return;
            const target = msg.id;
            if (net) net.kick(target);
            H.players = H.players.filter(p => p.id !== target);
            emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
            break;
        }
    }
}

/* ── client handle ─────────────────────────────────────── */
function clientHandle(msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
        case 'welcome':
            myId = msg.you;
            roomCode = msg.code;
            break;
        case 'reject':
            alert(msg.reason);
            backToMenu();
            break;
        case 'lobby':
            renderLobby(msg.players);
            break;
        case 'gameStart':
            startGame(msg.players);
            break;
        case 'roundStart':
            roundStart(msg);
            break;
        case 'go':
            gameActive = true;
            centerMsg('GO!', 1);
            sfx.go();
            startEngine();
            break;
        case 'sts':
            receiveStates(msg);
            break;
        case 'died': {
            const p = players.get(msg.id);
            if (p) {
                p.alive = false;
                deathEffect(p);
                if (msg.id === myId) { shake = 0.6; stopEngine(); }
                else shake = Math.max(shake, 0.2);
            }
            updateAliveCount();
            break;
        }
        case 'boost': {
            const p = players.get(msg.id);
            if (p) { p.boosting = true; p.boostT = BOOST_DUR; p.boostCharges = msg.charges; sfx.boost(); }
            break;
        }
        case 'powerup':
            spawnPowerupModel(msg);
            break;
        case 'grabbed': {
            removePowerupModel(msg.uid);
            const p = players.get(msg.id);
            if (p) {
                if (msg.type === 'boost') { p.boostCharges = Math.min(BOOST_MAX, p.boostCharges + 1); }
                if (msg.type === 'shield') { p.shielded = true; }
            }
            if (msg.id === myId) sfx.powerup();
            break;
        }
        case 'gap': {
            const p = players.get(msg.id);
            if (p) applyGap(p, msg.from, msg.to);
            if (msg.id === myId) sfx.gap();
            break;
        }
        case 'shieldBreak': {
            const p = players.get(msg.id);
            if (p) p.shielded = false;
            sfx.shield();
            break;
        }
        case 'roundEnd':
            gameActive = false;
            stopEngine();
            if (msg.winnerName) centerMsg(`${msg.winnerName} wins!`, 2.5);
            else centerMsg('Draw!', 2);
            if (msg.scores) {
                for (const s of msg.scores) {
                    const p = players.get(s.id);
                    if (p) p.wins = s.wins;
                }
            }
            updateScoreRow();
            if (role === 'host') setTimeout(() => nextRound(), 3500);
            break;
        case 'results':
            showResults(msg.list);
            break;
        case 'toLobby':
            backToLobby(msg.players);
            break;
        case 'count':
            centerMsg(msg.n.toString(), 0.9);
            sfx.count();
            break;
    }
}

/* ── lobby ─────────────────────────────────────────────── */
function renderLobby(list) {
    $('count').textContent = `${list.length}/${MAX_PLAYERS}`;
    const ul = $('players');
    ul.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        let badges = '';
        if (p.id === myId) badges += '<span class="badge ok">You</span>';
        else if (p.ready) badges += '<span class="badge ok">Ready</span>';
        if (p.bot) badges += '<span class="badge">Bot</span>';
        let kick = '';
        if (role === 'host' && p.id !== myId) kick = `<button class="kick" data-id="${p.id}">Remove</button>`;
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><div class="who"><b>${esc(p.name)}</b></div>${badges}${kick}`;
        ul.appendChild(li);
    }
    ul.querySelectorAll('.kick').forEach(btn => btn.onclick = () => act({ t: 'kick', id: btn.dataset.id }));
    $('btn-start').disabled = list.length < 2 || !list.filter(p => p.id !== myId && !p.bot).every(p => p.ready);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ── game start ────────────────────────────────────────── */
function startGame(playerList) {
    show('game');
    players.clear();
    for (const p of playerList) {
        players.set(p.id, {
            id: p.id, name: p.name, color: p.color, bot: p.bot,
            x: 0, z: 0, h: 0, speed: 0,
            alive: true, wins: p.wins || 0,
            trail: { points: [], lastBroadcast: 0 },
            trailMesh: null, glowMesh: null,
            boostCharges: BOOST_MAX, boosting: false, boostT: 0,
            shielded: false, turnInput: 0,
            botThinkT: 0, botTurn: 0,
            model: null,
        });
    }
    me = players.get(myId) || null;
    if (role === 'host') {
        H.round = 0;
        H.arena = pickArena();
        nextRound();
    }
    startMusic('game');
}

function pickArena() {
    return ARENAS[Math.floor(Math.random() * ARENAS.length)];
}

function nextRound() {
    H.round++;
    if (H.round > BEST_OF) {
        const list = [...players.values()].sort((a, b) => b.wins - a.wins).map((p, i) => ({ place: i + 1, id: p.id, name: p.name, color: p.color, wins: p.wins }));
        emit({ t: 'results', list });
        return;
    }
    // Check if someone already won majority
    const majority = Math.ceil(BEST_OF / 2);
    for (const p of players.values()) {
        if (p.wins >= majority) {
            const list = [...players.values()].sort((a, b) => b.wins - a.wins).map((p, i) => ({ place: i + 1, id: p.id, name: p.name, color: p.color, wins: p.wins }));
            emit({ t: 'results', list });
            return;
        }
    }
    // Pick new arena for moving walls
    if (H.round > 1) H.arena = pickArena();
    let arenaWalls = H.arena.walls;
    if (arenaWalls === 'dynamic') {
        arenaWalls = generateDynamicWalls(H.arena);
    }
    const spawns = spawnPositions(H.arena, players.size);
    let i = 0;
    const spawnList = [];
    for (const [id, p] of players) {
        const s = spawns[i++];
        p.x = s.x; p.z = s.z; p.h = s.h;
        p.alive = true; p.speed = 0; p.boosting = false; p.boostT = 0;
        p.boostCharges = BOOST_MAX; p.shielded = false; p.turnInput = 0;
        p.trail = { points: [{ x: s.x, z: s.z }], lastBroadcast: 0 };
        p.botThinkT = 0; p.botTurn = 0;
        spawnList.push({ id, x: s.x, z: s.z, h: s.h, color: p.color, name: p.name });
    }
    H.powerups = [];
    H.nextPowerup = POWERUP_MIN + Math.random() * (POWERUP_MAX - POWERUP_MIN);
    H.powerupUid = 0;
    H.grid = new Map();

    emit({
        t: 'roundStart',
        round: H.round,
        bestOf: BEST_OF,
        arena: { id: H.arena.id, w: H.arena.w, h: H.arena.h, walls: arenaWalls, theme: H.arena.theme },
        spawns: spawnList,
    });
    // Countdown
    let count = COUNTDOWN_S;
    const iv = setInterval(() => {
        if (count > 0) { emit({ t: 'count', n: count }); count--; }
        else { clearInterval(iv); emit({ t: 'go' }); }
    }, 1000);
}

function generateDynamicWalls(arena) {
    const walls = [];
    for (let i = 0; i < 4; i++) {
        const vertical = Math.random() > 0.5;
        const len = 10 + Math.random() * 15;
        const cx = (Math.random() - 0.5) * (arena.w - 20);
        const cz = (Math.random() - 0.5) * (arena.h - 20);
        if (vertical) walls.push({ x1: cx, z1: cz - len / 2, x2: cx, z2: cz + len / 2 });
        else walls.push({ x1: cx - len / 2, z1: cz, x2: cx + len / 2, z2: cz });
    }
    return walls;
}

function spawnPositions(arena, count) {
    const r = Math.min(arena.w, arena.h) * 0.15;
    return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, h: angle };
    });
}

/* ── round start (client-side) ─────────────────────────── */
function roundStart(msg) {
    currentArena = msg.arena;
    buildArena(msg.arena);
    clearAllTrails();
    clearPowerupModels();

    $('round-num').textContent = `${msg.round}/${msg.bestOf}`;

    for (const s of msg.spawns) {
        let p = players.get(s.id);
        if (!p) continue;
        p.x = s.x; p.z = s.z; p.h = s.h;
        p.alive = true; p.speed = 0; p.boosting = false; p.boostT = 0;
        p.boostCharges = BOOST_MAX; p.shielded = false; p.turnInput = 0;
        p.trail = { points: [{ x: s.x, z: s.z }], lastBroadcast: 0 };

        // Build or reset model
        if (p.model) scene.remove(p.model);
        p.model = buildCycle(s.color);
        p.model.position.set(s.x, 0, s.z);
        p.model.rotation.y = -s.h + Math.PI / 2;
        scene.add(p.model);

        // Build trail mesh
        if (p.trailMesh) scene.remove(p.trailMesh);
        if (p.glowMesh) scene.remove(p.glowMesh);
        p.trailMesh = createTrailMesh(s.color);
        p.glowMesh = createGlowMesh(s.color);
        scene.add(p.trailMesh);
        scene.add(p.glowMesh);
    }

    gameActive = false;
    updateAliveCount();
    updateScoreRow();
    updateBoostHud();
}

/* ── arena building ────────────────────────────────────── */
function buildArena(arena) {
    if (arenaGroup) { scene.remove(arenaGroup); }
    arenaGroup = new THREE.Group();

    const theme = arena.theme;
    const gridColor = new THREE.Color(theme.grid);
    scene.background = new THREE.Color(theme.fog);
    scene.fog.color.set(theme.fog);

    // floor
    const floorGeo = new THREE.PlaneGeometry(arena.w + 30, arena.h + 30);
    const floorMat = new THREE.ShaderMaterial({
        uniforms: { uGridColor: { value: gridColor }, uAlpha: { value: 0.3 } },
        vertexShader: FLOOR_VERT,
        fragmentShader: FLOOR_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.01;
    arenaGroup.add(floorMesh);

    // dark floor base
    const baseMat = new THREE.MeshBasicMaterial({ color: theme.floor });
    const baseGeo = new THREE.PlaneGeometry(arena.w + 30, arena.h + 30);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.02;
    arenaGroup.add(base);

    // boundary walls
    const wallColor = new THREE.Color(theme.wall);
    const wallMat = new THREE.MeshBasicMaterial({ color: wallColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const hw = arena.w / 2, hh = arena.h / 2;
    const boundarySegs = [
        [-hw, -hh, hw, -hh], [hw, -hh, hw, hh], [hw, hh, -hw, hh], [-hw, hh, -hw, -hh],
    ];
    for (const [x1, z1, x2, z2] of boundarySegs) {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const geo = new THREE.PlaneGeometry(len, TRAIL_H * 2);
        const w = new THREE.Mesh(geo, wallMat);
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        w.position.set(mx, TRAIL_H, mz);
        w.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        arenaGroup.add(w);
    }

    // Wall top edge glow
    const edgeMat = new THREE.MeshBasicMaterial({ color: wallColor });
    for (const [x1, z1, x2, z2] of boundarySegs) {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const geo = new THREE.BoxGeometry(len, 0.15, 0.15);
        const e = new THREE.Mesh(geo, edgeMat);
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        e.position.set(mx, TRAIL_H * 2, mz);
        e.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        arenaGroup.add(e);
    }

    // interior walls
    const iwalls = arena.walls || [];
    for (const w of iwalls) {
        const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
        const geo = new THREE.PlaneGeometry(len, TRAIL_H * 2);
        const mesh = new THREE.Mesh(geo, wallMat.clone());
        const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
        mesh.position.set(mx, TRAIL_H, mz);
        mesh.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
        arenaGroup.add(mesh);
        // glow edge
        const eGeo = new THREE.BoxGeometry(len, 0.15, 0.15);
        const e = new THREE.Mesh(eGeo, edgeMat);
        e.position.set(mx, TRAIL_H * 2, mz);
        e.rotation.y = mesh.rotation.y;
        arenaGroup.add(e);
    }

    scene.add(arenaGroup);
}

/* ── trail mesh creation ───────────────────────────────── */
function createTrailMesh(color) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_TRAIL_PTS * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAX_TRAIL_PTS - 1; i++) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) } },
        vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
}

function createGlowMesh(color) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_TRAIL_PTS * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAX_TRAIL_PTS - 1; i++) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const c = new THREE.Color(color);
    const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
}

function updateTrailMesh(p) {
    const pts = p.trail.points;
    if (pts.length < 2) return;
    // Wall ribbon
    const pos = p.trailMesh.geometry.attributes.position.array;
    const gpos = p.glowMesh.geometry.attributes.position.array;
    const n = Math.min(pts.length, MAX_TRAIL_PTS);
    for (let i = 0; i < n; i++) {
        const pt = pts[i];
        const vi = i * 6; // 2 verts * 3 components
        // bottom
        pos[vi] = pt.x; pos[vi + 1] = 0; pos[vi + 2] = pt.z;
        // top
        pos[vi + 3] = pt.x; pos[vi + 4] = TRAIL_H; pos[vi + 5] = pt.z;
        // glow on floor
        // Compute perpendicular offset for glow width
        let nx = 0, nz = 0;
        if (i < n - 1) {
            const dx = pts[i + 1].x - pt.x, dz = pts[i + 1].z - pt.z;
            const l = Math.hypot(dx, dz) || 1;
            nx = -dz / l * 0.4; nz = dx / l * 0.4;
        } else if (i > 0) {
            const dx = pt.x - pts[i - 1].x, dz = pt.z - pts[i - 1].z;
            const l = Math.hypot(dx, dz) || 1;
            nx = -dz / l * 0.4; nz = dx / l * 0.4;
        }
        gpos[vi] = pt.x - nx; gpos[vi + 1] = 0.01; gpos[vi + 2] = pt.z - nz;
        gpos[vi + 3] = pt.x + nx; gpos[vi + 4] = 0.01; gpos[vi + 5] = pt.z + nz;
    }
    p.trailMesh.geometry.attributes.position.needsUpdate = true;
    p.trailMesh.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    p.glowMesh.geometry.attributes.position.needsUpdate = true;
    p.glowMesh.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
}

function clearAllTrails() {
    for (const p of players.values()) {
        if (p.trailMesh) scene.remove(p.trailMesh);
        if (p.glowMesh) scene.remove(p.glowMesh);
        p.trailMesh = null; p.glowMesh = null;
    }
}

function applyGap(p, from, to) {
    // Remove trail points in range [from, to)
    const pts = p.trail.points;
    for (let i = from; i < to && i < pts.length; i++) {
        pts[i] = null;
    }
    // Rebuild trail mesh skipping nulls
    updateTrailMeshWithGaps(p);
}

function updateTrailMeshWithGaps(p) {
    // For simplicity, just update normally — gaps will cause visual breaks
    const pts = p.trail.points.filter(pt => pt !== null);
    p.trail.points = pts;
    updateTrailMesh(p);
}

/* ── lightcycle model ──────────────────────────────────── */
function buildCycle(color) {
    const group = new THREE.Group();
    const c = new THREE.Color(color);

    const bodyMat = new THREE.MeshStandardMaterial({
        color: c, emissive: c, emissiveIntensity: 0.8,
        metalness: 0.7, roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({
        color: 0x111122, emissive: c, emissiveIntensity: 0.15,
        metalness: 0.5, roughness: 0.5,
    });

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 2.2), bodyMat);
    body.position.y = 0.55;
    group.add(body);

    // Front fairing (narrower wedge)
    const frontGeo = new THREE.BoxGeometry(0.3, 0.3, 0.8);
    const front = new THREE.Mesh(frontGeo, bodyMat);
    front.position.set(0, 0.55, 1.3);
    group.add(front);

    // Front wheel
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.3 });
    const fw = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 16), wheelMat);
    fw.rotation.y = Math.PI / 2;
    fw.position.set(0, 0.32, 1.1);
    group.add(fw);

    // Rear wheel
    const rw = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.08, 8, 16), wheelMat);
    rw.rotation.y = Math.PI / 2;
    rw.position.set(0, 0.35, -0.8);
    group.add(rw);

    // Rider torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.45), darkMat);
    torso.position.set(0, 1.05, -0.05);
    torso.rotation.x = -0.3;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), darkMat);
    head.position.set(0, 1.38, 0.12);
    group.add(head);

    // Visor
    const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: c })
    );
    visor.position.set(0, 1.36, 0.27);
    group.add(visor);

    // Engine glow (rear)
    const engineGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.15, 0.1),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 })
    );
    engineGlow.position.set(0, 0.5, -1.25);
    group.add(engineGlow);

    group.userData = { wheelFront: fw, wheelRear: rw, color: c, engineGlow };
    return group;
}

/* ── powerups ──────────────────────────────────────────── */
const powerupModels = new Map();

function spawnPowerupModel(msg) {
    const colors = { boost: 0x4d9bff, shield: 0x33d69f, gap: 0xff8a2a };
    const c = colors[msg.type] || 0xffffff;
    const mat = new THREE.MeshStandardMaterial({
        color: c, emissive: c, emissiveIntensity: 1.5,
        transparent: true, opacity: 0.85,
    });
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat);
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.05, 8, 24),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4 })
    );
    group.add(sphere, ring);
    group.position.set(msg.x, 0.8, msg.z);
    group.userData = { uid: msg.uid, type: msg.type };
    scene.add(group);
    powerupModels.set(msg.uid, group);
}

function removePowerupModel(uid) {
    const m = powerupModels.get(uid);
    if (m) { scene.remove(m); powerupModels.delete(uid); }
}

function clearPowerupModels() {
    for (const m of powerupModels.values()) scene.remove(m);
    powerupModels.clear();
}

/* ── death effect ──────────────────────────────────────── */
function deathEffect(p) {
    sfx.die();
    if (p.model) {
        // Simple explosion: scale up and fade
        const m = p.model;
        let t = 0;
        const anim = () => {
            t += 0.03;
            if (t > 1) { scene.remove(m); return; }
            m.scale.setScalar(1 + t * 3);
            m.traverse(c => { if (c.material) { c.material.opacity = 1 - t; c.material.transparent = true; } });
            requestAnimationFrame(anim);
        };
        anim();
        p.model = null;
    }
    // Flash trail
    if (p.trailMesh && p.trailMesh.material.uniforms) {
        const orig = p.trailMesh.material.uniforms.uColor.value.clone();
        p.trailMesh.material.uniforms.uColor.value.set(1, 1, 1);
        setTimeout(() => {
            if (p.trailMesh && p.trailMesh.material.uniforms) {
                p.trailMesh.material.uniforms.uColor.value.copy(orig);
            }
        }, 200);
    }
}

/* ── collision detection ───────────────────────────────── */
function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    const denom = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(denom) < 1e-10) return false;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denom;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denom;
    return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

function checkCollision(id, px, pz, nx, nz) {
    const arena = currentArena;
    if (!arena) return false;
    const hw = arena.w / 2, hh = arena.h / 2;

    // Wall collision
    if (nx < -hw || nx > hw || nz < -hh || nz > hh) return true;

    // Interior wall collision
    const iwalls = arena.walls || [];
    for (const w of iwalls) {
        if (segIntersect(px, pz, nx, nz, w.x1, w.z1, w.x2, w.z2)) return true;
    }

    // Trail collision — check all players' trails
    for (const [pid, p] of players) {
        const pts = p.trail.points;
        if (!pts || pts.length < 2) continue;
        const skipEnd = (pid === id) ? Math.max(0, pts.length - SKIP_SELF_SEGS) : pts.length - 1;
        for (let i = 0; i < skipEnd; i++) {
            const a = pts[i], b = pts[i + 1];
            if (!a || !b) continue;
            if (segIntersect(px, pz, nx, nz, a.x, a.z, b.x, b.z)) return true;
        }
    }

    return false;
}

/* ── bot AI ────────────────────────────────────────────── */
function botThink(bot, dt) {
    bot.botThinkT -= dt;
    if (bot.botThinkT > 0) return;
    bot.botThinkT = 0.15 + Math.random() * 0.25;

    const lookAhead = 15 + Math.random() * 10;

    const dirs = [
        { turn: 0, h: bot.h },
        { turn: -1, h: bot.h - Math.PI / 4 },
        { turn: 1, h: bot.h + Math.PI / 4 },
        { turn: -1, h: bot.h - Math.PI / 2 },
        { turn: 1, h: bot.h + Math.PI / 2 },
    ];

    let bestTurn = 0, bestDist = 0;
    for (const d of dirs) {
        const dist = castRay(bot, bot.x, bot.z, d.h, lookAhead);
        if (dist > bestDist) { bestDist = dist; bestTurn = d.turn; }
    }
    bot.botTurn = bestTurn;

    // Use boost if lots of open space
    if (bestDist > lookAhead * 0.8 && bot.boostCharges > 0 && Math.random() < 0.08) {
        bot.boosting = true;
        bot.boostT = BOOST_DUR;
        bot.boostCharges--;
        emit({ t: 'boost', id: bot.id, charges: bot.boostCharges });
    }
}

function castRay(self, x, z, heading, maxDist) {
    const dx = Math.cos(heading), dz = Math.sin(heading);
    const step = 0.8;
    for (let d = 1.5; d < maxDist; d += step) {
        const tx = x + dx * d, tz = z + dz * d;
        // Arena bounds
        if (currentArena) {
            const hw = currentArena.w / 2, hh = currentArena.h / 2;
            if (tx < -hw + 1 || tx > hw - 1 || tz < -hh + 1 || tz > hh - 1) return d;
        }
        // Trail collision (point proximity check for speed)
        for (const [pid, p] of players) {
            const pts = p.trail.points;
            if (!pts) continue;
            const skip = (pid === self.id) ? Math.max(0, pts.length - SKIP_SELF_SEGS) : pts.length;
            for (let i = 0; i < skip - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                if (!a || !b) continue;
                // Point-to-segment distance
                const abx = b.x - a.x, abz = b.z - a.z;
                const abl = abx * abx + abz * abz;
                if (abl < 0.001) continue;
                const t = Math.max(0, Math.min(1, ((tx - a.x) * abx + (tz - a.z) * abz) / abl));
                const cx = a.x + t * abx, cz = a.z + t * abz;
                if (Math.hypot(tx - cx, tz - cz) < 1.0) return d;
            }
        }
        // Interior walls
        if (currentArena && currentArena.walls) {
            for (const w of currentArena.walls) {
                const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1;
                const wl = wdx * wdx + wdz * wdz;
                if (wl < 0.001) continue;
                const t = Math.max(0, Math.min(1, ((tx - w.x1) * wdx + (tz - w.z1) * wdz) / wl));
                const cx = w.x1 + t * wdx, cz = w.z1 + t * wdz;
                if (Math.hypot(tx - cx, tz - cz) < 1.0) return d;
            }
        }
    }
    return maxDist;
}

/* ── host update ───────────────────────────────────────── */
let sendTimer = 0;

function hostUpdate(dt) {
    let aliveCount = 0;

    for (const [id, p] of players) {
        if (!p.alive) continue;
        aliveCount++;

        // Bot AI
        if (p.bot) {
            botThink(p, dt);
            p.turnInput = p.botTurn;
        }

        // Turn
        const tr = p.boosting ? TURN_RATE_BOOST : TURN_RATE;
        p.h += p.turnInput * tr * dt;

        // Move
        const spd = p.boosting ? BOOST_SPEED : BASE_SPEED;
        const prevX = p.x, prevZ = p.z;
        p.x += Math.cos(p.h) * spd * dt;
        p.z += Math.sin(p.h) * spd * dt;
        p.speed = spd;

        // Record trail point
        const pts = p.trail.points;
        const lastPt = pts[pts.length - 1];
        const dist = Math.hypot(p.x - lastPt.x, p.z - lastPt.z);
        if (dist >= TRAIL_SAMPLE_DIST) {
            pts.push({ x: p.x, z: p.z });
        }

        // Collision
        if (checkCollision(id, prevX, prevZ, p.x, p.z)) {
            if (p.shielded) {
                p.shielded = false;
                emit({ t: 'shieldBreak', id });
            } else {
                p.alive = false;
                // Add final trail point
                pts.push({ x: p.x, z: p.z });
                emit({ t: 'died', id, x: p.x, z: p.z, color: p.color });
                aliveCount--;
            }
        }

        // Boost timer
        if (p.boosting) {
            p.boostT -= dt;
            if (p.boostT <= 0) p.boosting = false;
        }

        // Powerup pickup
        for (let i = H.powerups.length - 1; i >= 0; i--) {
            const pu = H.powerups[i];
            if (Math.hypot(p.x - pu.x, p.z - pu.z) < 1.5) {
                H.powerups.splice(i, 1);
                if (pu.type === 'gap') {
                    // Erase last GAP_SEGS of own trail
                    const from = Math.max(0, pts.length - GAP_SEGS);
                    const to = pts.length;
                    emit({ t: 'grabbed', uid: pu.uid, id, type: 'gap' });
                    emit({ t: 'gap', id, from, to });
                } else {
                    emit({ t: 'grabbed', uid: pu.uid, id, type: pu.type });
                }
            }
        }
    }

    // Spawn powerups
    H.nextPowerup -= dt;
    if (H.nextPowerup <= 0 && H.powerups.length < MAX_POWERUPS) {
        H.nextPowerup = POWERUP_MIN + Math.random() * (POWERUP_MAX - POWERUP_MIN);
        const types = ['boost', 'shield', 'gap'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (currentArena) {
            const hw = currentArena.w / 2 - 5, hh = currentArena.h / 2 - 5;
            const x = (Math.random() - 0.5) * hw * 2;
            const z = (Math.random() - 0.5) * hh * 2;
            const uid = ++H.powerupUid;
            H.powerups.push({ uid, type, x, z });
            emit({ t: 'powerup', uid, type, x, z });
        }
    }

    // Broadcast state
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const a = [];
        const tr = {};
        for (const [id, p] of players) {
            a.push([id, +p.x.toFixed(2), +p.z.toFixed(2), +p.h.toFixed(3), p.speed, p.alive ? 1 : 0, p.boostCharges, p.boosting ? 1 : 0, p.shielded ? 1 : 0]);
            const newPts = p.trail.points.slice(p.trail.lastBroadcast);
            if (newPts.length > 0) {
                tr[id] = newPts.map(pt => [+pt.x.toFixed(2), +pt.z.toFixed(2)]);
                p.trail.lastBroadcast = p.trail.points.length;
            }
        }
        emit({ t: 'sts', a, tr });
    }

    // Round end
    if (aliveCount <= 1 && gameActive && players.size > 1) {
        gameActive = false;
        const alive = [...players.values()].filter(p => p.alive);
        const winner = alive[0] || null;
        if (winner) winner.wins++;
        const scores = [...players.values()].map(p => ({ id: p.id, wins: p.wins }));
        emit({ t: 'roundEnd', winner: winner ? winner.id : null, winnerName: winner ? winner.name : null, scores });
    }
}

/* ── receive states (client) ───────────────────────────── */
function receiveStates(msg) {
    for (const s of msg.a) {
        const [id, x, z, h, spd, alive, charges, boosting, shielded] = s;
        const p = players.get(id);
        if (!p) continue;
        if (id !== myId || role !== 'host') {
            p.x = x; p.z = z; p.h = h; p.speed = spd;
            p.alive = !!alive;
            p.boostCharges = charges;
            p.boosting = !!boosting;
            p.shielded = !!shielded;
        }
    }
    // Trail deltas
    if (msg.tr) {
        for (const [id, newPts] of Object.entries(msg.tr)) {
            const p = players.get(id);
            if (!p) continue;
            if (id === myId && role === 'host') continue;
            for (const [x, z] of newPts) {
                p.trail.points.push({ x, z });
            }
        }
    }
    updateAliveCount();
}

/* ── input ─────────────────────────────────────────────── */
const keys = {};
let touchLeft = false, touchRight = false, touchBoost = false;
let tiltZero = 0, tiltVal = 0, tiltActive = false;

addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key === 'Escape') togglePause(); });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Touch
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add('touch');
}
$('touch-left').addEventListener('touchstart', e => { e.preventDefault(); touchLeft = true; unlockAudio(); }, { passive: false });
$('touch-left').addEventListener('touchend', () => { touchLeft = false; });
$('touch-right').addEventListener('touchstart', e => { e.preventDefault(); touchRight = true; unlockAudio(); }, { passive: false });
$('touch-right').addEventListener('touchend', () => { touchRight = false; });
$('touch-boost').addEventListener('touchstart', e => { e.preventDefault(); touchBoost = true; unlockAudio(); }, { passive: false });
$('touch-boost').addEventListener('touchend', () => { touchBoost = false; });

// Tilt
addEventListener('deviceorientation', e => {
    if (e.beta == null || e.gamma == null) return;
    tiltVal = tiltAmount(e.beta, e.gamma, screen.orientation?.angle || 0);
    if (!tiltActive) { tiltZero = tiltVal; tiltActive = true; }
});

function getTurnInput() {
    let turn = 0;
    if (keys['a'] || keys['arrowleft'] || touchLeft) turn -= 1;
    if (keys['d'] || keys['arrowright'] || touchRight) turn += 1;
    if (turn === 0 && tiltActive) {
        const t = tiltToSteer(tiltVal, tiltZero);
        if (Math.abs(t) > 0.3) turn = t > 0 ? 1 : -1;
    }
    return turn;
}

function getBoostInput() {
    const b = keys[' '] || touchBoost;
    touchBoost = false;
    return b;
}

/* ── pause ─────────────────────────────────────────────── */
function togglePause() {
    if (view !== 'game') return;
    paused = !paused;
    if (paused) elPause.classList.remove('hidden');
    else elPause.classList.add('hidden');
}
$('btn-resume').onclick = togglePause;

/* ── game update ───────────────────────────────────────── */
function updateGame(dt) {
    if (!gameActive) return;

    // Host physics always runs
    if (role === 'host') hostUpdate(dt);

    if (!me || !me.alive) return;

    // Local input
    const turn = getTurnInput();
    const wantBoost = getBoostInput();

    act({ t: 'input', turn, boost: wantBoost && !me.boosting && me.boostCharges > 0 });

    // Client-side prediction
    if (role !== 'host') {
        const tr = me.boosting ? TURN_RATE_BOOST : TURN_RATE;
        me.h += turn * tr * dt;
        const spd = me.boosting ? BOOST_SPEED : BASE_SPEED;
        me.x += Math.cos(me.h) * spd * dt;
        me.z += Math.sin(me.h) * spd * dt;
        me.speed = spd;
        // Trail point
        const pts = me.trail.points;
        const last = pts[pts.length - 1];
        if (Math.hypot(me.x - last.x, me.z - last.z) >= TRAIL_SAMPLE_DIST) {
            pts.push({ x: me.x, z: me.z });
        }
    }

    // Engine sound
    updateEngine(me.speed, me.boosting);

    // Update boost HUD
    updateBoostHud();
}

/* ── render ────────────────────────────────────────────── */
function render(dt) {
    // Update player models
    for (const p of players.values()) {
        if (!p.model) continue;
        if (p.alive) {
            p.model.position.set(p.x, 0, p.z);
            p.model.rotation.y = -p.h + Math.PI / 2;
            // Wheel spin
            const spinRate = p.speed * 2.5;
            if (p.model.userData.wheelFront) p.model.userData.wheelFront.rotation.x += spinRate * dt;
            if (p.model.userData.wheelRear) p.model.userData.wheelRear.rotation.x += spinRate * dt;
            // Lean
            const lean = p.turnInput * 0.25;
            p.model.rotation.z += (lean - p.model.rotation.z) * (1 - Math.exp(-8 * dt));
            // Shield glow
            if (p.shielded && p.model.userData.engineGlow) {
                p.model.userData.engineGlow.material.color.set(0x33d69f);
            } else if (p.model.userData.engineGlow) {
                p.model.userData.engineGlow.material.color.copy(p.model.userData.color);
            }
        }
        // Update trail mesh
        updateTrailMesh(p);
    }

    // Rotate powerups
    for (const m of powerupModels.values()) {
        m.rotation.y += dt * 2;
        m.position.y = 0.8 + Math.sin(performance.now() / 400) * 0.2;
    }

    // Camera
    if (me && me.alive) {
        const aspect = camera.aspect;
        const camDist = aspect < 1 ? 55 : 45;
        const camH = aspect < 1 ? 50 : 40;
        const lookX = me.x + Math.cos(me.h) * 5;
        const lookZ = me.z + Math.sin(me.h) * 5;
        camera.position.x += (me.x - Math.cos(me.h) * 8 - camera.position.x) * (1 - Math.exp(-4 * dt));
        camera.position.z += (me.z - Math.sin(me.h) * 8 + 15 - camera.position.z) * (1 - Math.exp(-4 * dt));
        camera.position.y += (camH - camera.position.y) * (1 - Math.exp(-4 * dt));
        camera.lookAt(lookX, 0, lookZ);
        // FOV expansion on boost
        const targetFov = me.boosting ? 65 : 55;
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-5 * dt));
        camera.updateProjectionMatrix();
    } else if (currentArena) {
        // Overview
        const cx = 0, cz = 0;
        camera.position.x += (cx - camera.position.x) * (1 - Math.exp(-2 * dt));
        camera.position.z += (cz + 20 - camera.position.z) * (1 - Math.exp(-2 * dt));
        camera.position.y += (60 - camera.position.y) * (1 - Math.exp(-2 * dt));
        camera.lookAt(cx, 0, cz);
    }

    // Screen shake
    if (shake > 0.01) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.8;
        camera.position.z += (Math.random() - 0.5) * shake * 0.8;
        shake *= Math.exp(-5 * dt);
    }

    composer.render();
}

/* ── HUD updates ───────────────────────────────────────── */
function updateAliveCount() {
    const alive = [...players.values()].filter(p => p.alive).length;
    $('alive-count').textContent = `${alive} alive`;
}

function updateScoreRow() {
    const row = $('score-row');
    row.innerHTML = '';
    for (const p of players.values()) {
        const d = document.createElement('span');
        d.className = 'score-dot';
        d.innerHTML = `<i style="background:${p.color}"></i>${p.wins}`;
        row.appendChild(d);
    }
}

function updateBoostHud() {
    if (!me) return;
    const charges = $('boost-charges');
    if (!charges) return;
    charges.innerHTML = '';
    for (let i = 0; i < BOOST_MAX; i++) {
        const s = document.createElement('span');
        s.className = 'charge' + (i < me.boostCharges ? ' full' : '');
        charges.appendChild(s);
    }
    // Powerup HUD
    const puHud = $('powerup-hud');
    if (me.shielded) {
        puHud.classList.remove('hidden');
        $('powerup-icon').textContent = '';
        $('powerup-name').textContent = 'SHIELD';
    } else {
        puHud.classList.add('hidden');
    }
}

/* ── results ───────────────────────────────────────────── */
function showResults(list) {
    show('results');
    gameActive = false;
    stopEngine();
    startMusic('results');
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        if (p.id === myId) li.className = 'me';
        li.innerHTML = `<span class="place">${p.place}</span><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b><span class="score">${p.wins} wins</span>`;
        ol.appendChild(li);
    }
    $('results-title').textContent = list[0]?.name + ' wins!';
}

/* ── lobby / menu ──────────────────────────────────────── */
function backToMenu() {
    show('menu');
    if (net) { net.close(); net = null; }
    players.clear(); me = null;
    gameActive = false; paused = false;
    role = '';
    document.body.classList.remove('is-host');
    // Clean scene
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup = null; }
    clearAllTrails();
    clearPowerupModels();
    for (const p of players.values()) { if (p.model) scene.remove(p.model); }
    stopEngine();
    startMusic('menu');
}

function backToLobby(playerList) {
    gameActive = false;
    paused = false;
    stopEngine();
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup = null; }
    clearAllTrails();
    clearPowerupModels();
    for (const p of players.values()) { if (p.model) { scene.remove(p.model); p.model = null; } }
    players.clear(); me = null;
    show('lobby');
    startMusic('menu');
    if (playerList) renderLobby(playerList);
    else if (role === 'host') {
        // Reset wins
        for (const p of H.players) { p.wins = 0; p.ready = p.id === myId || p.bot; }
        H.phase = 'lobby'; H.round = 0;
        emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
    }
}

/* ── menu buttons ──────────────────────────────────────── */
$('name').value = localStorage.getItem('deadlineName') || '';

$('btn-create').onclick = async () => {
    myName = $('name').value.trim() || 'Player';
    localStorage.setItem('deadlineName', myName);
    unlockAudio();
    sfx.click();
    $('menu-status').textContent = 'Creating room...';
    role = 'host';
    document.body.classList.add('is-host');
    roomCode = makeCode();
    try {
        net = new HostNet({
            onMessage: (from, msg) => hostHandle(from, msg),
            onLeave: id => {
                H.players = H.players.filter(p => p.id !== id);
                if (H.phase === 'lobby') emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
                toast('A player left');
            }
        });
        await net.open(roomCode);
    } catch (e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return $('btn-create').onclick(); }
        $('menu-status').textContent = e.message;
        $('menu-status').className = 'status error';
        return;
    }
    myId = 'host';
    H.players = [];
    H.phase = 'lobby';
    show('lobby');
    $('room-code').textContent = roomCode;
    startMusic('menu');
    act({ t: 'hello', name: myName });
};

$('btn-join').onclick = async () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length < 3) return;
    myName = $('name').value.trim() || 'Player';
    localStorage.setItem('deadlineName', myName);
    unlockAudio();
    sfx.click();
    $('menu-status').textContent = 'Connecting...';
    role = 'client';
    document.body.classList.remove('is-host');
    const forceRelay = new URLSearchParams(location.search).has('relay');
    net = new ClientNet({
        onMessage: msg => clientHandle(msg),
        onClose: () => { toast('Connection lost'); backToMenu(); },
        onStatus: s => { $('menu-status').textContent = s; },
        forceRelay,
    });
    try {
        myId = await net.connect(code);
    } catch (e) {
        $('menu-status').textContent = e.message;
        $('menu-status').className = 'status error';
        return;
    }
    roomCode = code;
    show('lobby');
    $('room-code').textContent = roomCode;
    startMusic('menu');
    net.send({ t: 'hello', name: myName });
};

$('btn-solo').onclick = () => {
    myName = $('name').value.trim() || 'Player';
    localStorage.setItem('deadlineName', myName);
    unlockAudio();
    sfx.click();
    role = 'host';
    document.body.classList.add('is-host');
    myId = 'host';
    roomCode = 'SOLO';
    net = null;
    H.players = [];
    H.phase = 'lobby';

    // Add self
    H.players.push({ id: myId, name: myName, color: COLORS[0], ready: true, bot: false, wins: 0 });
    // Add bots
    for (let i = 0; i < 7; i++) {
        const botId = 'bot' + i;
        H.players.push({ id: botId, name: BOT_NAMES[i], color: COLORS[(i + 1) % COLORS.length], ready: true, bot: true, wins: 0 });
    }
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: 0 })) });
};

$('btn-start').onclick = () => {
    sfx.click();
    H.phase = 'game';
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: p.wins })) });
};

$('btn-ready').onclick = () => {
    sfx.click();
    const btn = $('btn-ready');
    const ready = btn.textContent === 'Ready up';
    btn.textContent = ready ? 'Cancel ready' : 'Ready up';
    act({ t: 'ready', r: ready });
};

$('btn-copy').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
        $('btn-copy').textContent = 'Copied!';
        setTimeout(() => { $('btn-copy').textContent = 'Copy invite link'; }, 2000);
    });
};

$('btn-bot').onclick = () => {
    if (H.players.length >= MAX_PLAYERS) return;
    sfx.click();
    const idx = H.players.length;
    const botId = 'bot' + Math.random().toString(36).slice(2, 8);
    const nameIdx = H.players.filter(p => p.bot).length;
    H.players.push({ id: botId, name: BOT_NAMES[nameIdx % BOT_NAMES.length], color: COLORS[idx % COLORS.length], ready: true, bot: true, wins: 0 });
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
};

$('btn-again').onclick = () => {
    sfx.click();
    // Reset wins
    for (const p of H.players) { p.wins = 0; p.ready = p.id === myId || p.bot; }
    H.phase = 'lobby'; H.round = 0;
    emit({ t: 'toLobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
    backToLobby();
};

$('btn-exit').onclick = () => {
    if (net) net.close();
    location.href = '../projects.html';
};

// Sound toggle
$('btn-mute').onclick = () => {
    const m = !isMuted();
    setMuted(m);
    $('icon-sound').classList.toggle('hidden', m);
    $('icon-muted').classList.toggle('hidden', !m);
};

// Handle invite links
const params = new URLSearchParams(location.search);
if (params.has('room')) {
    $('code').value = params.get('room');
    const inviteBox = $('invite');
    inviteBox.textContent = `You've been invited to room ${params.get('room')}. Enter your name and click Join!`;
    inviteBox.classList.remove('hidden');
}

/* ── frame loop ────────────────────────────────────────── */
let last = performance.now();

function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if ((view === 'game' || gameActive) && !paused) {
        updateGame(dt);
        render(dt);
    } else {
        // Menu/lobby idle render
        composer.render();
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Start menu music
startMusic('menu');

// First interaction unlock
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });
