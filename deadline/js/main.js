// Deadline — Tron lightcycle arena for up to 8 players.
// Host-authoritative, PeerJS + MQTT relay networking.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HostNet, ClientNet, makeCode } from './net.js?v=8';
import { sfx, isMuted, setMuted, unlockAudio, startEngine, updateEngine, stopEngine } from './audio.js?v=5';
import { startMusic, stopMusic, setMusicVolume } from './music.js?v=5';
import { tiltAmount, tiltToSteer } from './tilt.js?v=5';

/* ── constants ─────────────────────────────────────────── */
const MAX_PLAYERS = 8;
const BEST_OF     = 5;
const BASE_SPEED  = 40;
const BOOST_SPEED = 60;
const BOOST_DUR   = 2;
const BOOST_MAX   = 3;
const TURN_RATE   = 3.0;
const TURN_RATE_BOOST = 2.1;
const TRAIL_H     = 2.5;
const TRAIL_SAMPLE_DIST = 2.5;
const TRAIL_TURN_THRESH = 0.04;
const MAX_TRAIL_PTS = 6000;
const SKIP_SELF_SEGS = 5;
const GRID_SIZE   = 5;
const SEND_EVERY  = 0.05;
const COUNTDOWN_S = 3;
const POWERUP_MIN = 8;
const POWERUP_MAX = 12;
const MAX_POWERUPS = 2;
const GAP_SEGS    = 15;
const TRAIL_MAX_LEN = 300;
const TRAIL_FADE_LEN = 40;
const CYCLE_R     = 0.6;

const COLORS = ['#00e5ff','#ff0055','#39ff14','#ffea00','#bf5fff','#ff6d00','#ff69b4','#e0e0e0'];
const BOT_NAMES = ['Tron','Quorra','Rinzler','CLU','Flynn','Sark','Ram','Yori'];

/* ── arenas ────────────────────────────────────────────── */
const ARENAS = [
    { id:'classic', name:'Classic Grid', w:240, h:180, walls:[], theme:{ grid:0x00ccff, wall:0x00ffff, floor:0x060618, fog:0x020210 } },
    { id:'maze', name:'The Maze', w:260, h:200,
      walls:[ {x1:-45,z1:-75,x2:-45,z2:15},{x1:45,z1:-15,x2:45,z2:75},{x1:-90,z1:30,x2:-30,z2:30},{x1:30,z1:-30,x2:90,z2:-30},{x1:0,z1:-60,x2:0,z2:-15},{x1:-15,z1:45,x2:30,z2:45} ],
      theme:{ grid:0xff00ff, wall:0xff44ff, floor:0x0a0418, fog:0x060210 } },
    { id:'corridors', name:'Corridors', w:300, h:240,
      walls:[ {x1:-60,z1:-90,x2:-60,z2:-15},{x1:60,z1:15,x2:60,z2:90},{x1:-105,z1:0,x2:-30,z2:0},{x1:30,z1:0,x2:105,z2:0},{x1:-60,z1:60,x2:60,z2:60},{x1:-60,z1:-60,x2:60,z2:-60} ],
      theme:{ grid:0xffaa00, wall:0xff8800, floor:0x0a0800, fog:0x060400 } },
    { id:'shift', name:'Moving Walls', w:250, h:200, walls:'dynamic',
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
scene.fog = new THREE.Fog(0x020208, 120, 400);

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
attribute float aFade;
varying float vHeight;
varying float vFade;
void main(){
    vHeight = position.y / ${TRAIL_H.toFixed(1)};
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const TRAIL_FRAG = `
uniform vec3 uColor;
varying float vHeight;
varying float vFade;
void main(){
    float core = smoothstep(0.8,0.0,vHeight)*0.8+0.2;
    vec3 col = uColor * core * 2.5;
    gl_FragColor = vec4(col, core * vFade);
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
            // The relay can deliver a message twice; never add the same person twice
            if (H.players.some(p => p.id === from)) return;
            // Turn away only the person joining (emit would send this to everyone, host included)
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'A game is in progress in that room. Try again when it ends.' }); return; }
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: `That room is full (${MAX_PLAYERS} players max).` }); return; }
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
            if (net) {
                net.send(target, { t: 'reject', reason: 'The host removed you from the room.' });
                setTimeout(() => net && net.kick(target), 600);
            }
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
            enterJoinedLobby();
            break;
        case 'reject':
            backToMenu();
            setMenuStatus(msg.reason, true);
            break;
        case 'lobby':
            if (role === 'client') enterJoinedLobby();
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
    for (let i = 0; i < 6; i++) {
        const vertical = Math.random() > 0.5;
        const len = 30 + Math.random() * 45;
        const cx = (Math.random() - 0.5) * (arena.w - 60);
        const cz = (Math.random() - 0.5) * (arena.h - 60);
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
        p.model.rotation.y = -s.h;
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
    const floorGeo = new THREE.PlaneGeometry(arena.w + 60, arena.h + 60);
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
    const baseGeo = new THREE.PlaneGeometry(arena.w + 60, arena.h + 60);
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
    const fade = new Float32Array(MAX_TRAIL_PTS * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage));
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
    const fadeAttr = p.trailMesh.geometry.attributes.aFade.array;
    const gpos = p.glowMesh.geometry.attributes.position.array;
    const n = Math.min(pts.length, MAX_TRAIL_PTS);
    for (let i = 0; i < n; i++) {
        const pt = pts[i];
        const vi = i * 6; // 2 verts * 3 components
        // Fade: oldest points fade out over TRAIL_FADE_LEN
        const fadeVal = Math.min(1, i / TRAIL_FADE_LEN);
        fadeAttr[i * 2] = fadeVal;
        fadeAttr[i * 2 + 1] = fadeVal;
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
    p.trailMesh.geometry.attributes.aFade.needsUpdate = true;
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

/* ── lightcycle model (inspired by Bonk Racers dirt bike) ─ */
function buildCycle(color) {
    const group = new THREE.Group();
    const c = new THREE.Color(color);
    const S = 1.8; // scale up for visibility at chase cam distance

    const paint = new THREE.MeshStandardMaterial({
        color: c, emissive: c, emissiveIntensity: 0.7,
        metalness: 0.5, roughness: 0.35,
    });
    const chrome = new THREE.MeshStandardMaterial({
        color: 0xd8dde3, emissive: c, emissiveIntensity: 0.15,
        roughness: 0.15, metalness: 0.9,
    });
    const dark = new THREE.MeshStandardMaterial({
        color: 0x111122, emissive: c, emissiveIntensity: 0.1,
        metalness: 0.4, roughness: 0.6,
    });
    const tireMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, roughness: 0.9, metalness: 0,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 });

    // Frame tubes (main spine)
    const frameTube = (x1,y1,z1,x2,y2,z2,r) => {
        const len = Math.hypot(x2-x1,y2-y1,z2-z1);
        const geo = new THREE.CylinderGeometry(r*S, r*S, len, 8);
        const m = new THREE.Mesh(geo, chrome);
        m.position.set((x1+x2)/2*S,(y1+y2)/2*S,(z1+z2)/2*S);
        const dir = new THREE.Vector3(x2-x1,y2-y1,z2-z1).normalize();
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
        return m;
    };

    // Main frame
    group.add(frameTube(-0.8,0.5,0, 0.5,0.7,0, 0.03));  // lower tube
    group.add(frameTube(-0.4,0.5,0, 0.2,1.1,0, 0.03));   // seat tube
    group.add(frameTube(0.2,1.1,0, 0.7,1.0,0, 0.025));   // top tube to steering
    group.add(frameTube(0.7,1.0,0, 0.9,0.45,0, 0.025));   // fork

    // Tank (fuel tank shape)
    const tank = new THREE.Mesh(
        new THREE.SphereGeometry(0.22*S, 10, 8),
        paint
    );
    tank.scale.set(1.6, 0.7, 0.9);
    tank.position.set(0.15*S, 0.85*S, 0);
    group.add(tank);

    // Seat
    const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.5*S, 0.08*S, 0.28*S, 1, 1, 1),
        dark
    );
    seat.position.set(-0.15*S, 0.78*S, 0);
    group.add(seat);

    // Engine block
    const engine = new THREE.Mesh(
        new THREE.BoxGeometry(0.28*S, 0.22*S, 0.24*S),
        dark
    );
    engine.position.set(0.05*S, 0.45*S, 0);
    group.add(engine);

    // Exhaust pipe glow
    const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03*S, 0.04*S, 0.6*S, 8),
        glowMat
    );
    exhaust.position.set(-0.65*S, 0.38*S, 0.13*S);
    exhaust.rotation.z = Math.PI/2 + 0.15;
    group.add(exhaust);

    // Front wheel
    const wheelR = 0.38 * S;
    const fwTire = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.06*S, 10, 24), tireMat);
    fwTire.rotation.y = Math.PI/2;
    fwTire.position.set(0.9*S, wheelR, 0);
    group.add(fwTire);
    const fwRim = new THREE.Mesh(new THREE.TorusGeometry(wheelR*0.65, 0.02*S, 6, 20), chrome);
    fwRim.rotation.y = Math.PI/2;
    fwRim.position.copy(fwTire.position);
    group.add(fwRim);
    // Spokes
    for (let i = 0; i < 8; i++) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008*S,0.008*S,wheelR*1.6,4), chrome);
        spoke.rotation.z = (i/8)*Math.PI;
        spoke.position.copy(fwTire.position);
        spoke.rotation.y = Math.PI/2;
        group.add(spoke);
    }

    // Rear wheel
    const rwR = 0.4 * S;
    const rwTire = new THREE.Mesh(new THREE.TorusGeometry(rwR, 0.08*S, 10, 24), tireMat);
    rwTire.rotation.y = Math.PI/2;
    rwTire.position.set(-0.85*S, rwR, 0);
    group.add(rwTire);
    const rwRim = new THREE.Mesh(new THREE.TorusGeometry(rwR*0.6, 0.025*S, 6, 20), chrome);
    rwRim.rotation.y = Math.PI/2;
    rwRim.position.copy(rwTire.position);
    group.add(rwRim);
    for (let i = 0; i < 8; i++) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008*S,0.008*S,rwR*1.5,4), chrome);
        spoke.rotation.z = (i/8)*Math.PI;
        spoke.position.copy(rwTire.position);
        spoke.rotation.y = Math.PI/2;
        group.add(spoke);
    }

    // Front fender
    const fender = new THREE.Mesh(
        new THREE.SphereGeometry(wheelR + 0.04*S, 8, 6, 0, Math.PI),
        paint
    );
    fender.scale.set(0.5, 1, 1);
    fender.rotation.x = Math.PI;
    fender.position.copy(fwTire.position);
    fender.position.y += 0.12*S;
    group.add(fender);

    // Handlebars
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015*S,0.015*S,0.5*S,6), chrome);
    bar.rotation.z = Math.PI/2;
    bar.position.set(0.72*S, 1.08*S, 0);
    group.add(bar);
    // Handlebar grips
    const gripL = new THREE.Mesh(new THREE.CylinderGeometry(0.025*S,0.025*S,0.08*S,6), dark);
    gripL.rotation.z = Math.PI/2;
    gripL.position.set(0.72*S, 1.08*S, 0.27*S);
    group.add(gripL);
    const gripR = gripL.clone();
    gripR.position.z = -0.27*S;
    group.add(gripR);

    // Headlight
    const headlight = new THREE.Mesh(
        new THREE.SphereGeometry(0.06*S, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 })
    );
    headlight.position.set(0.82*S, 0.95*S, 0);
    group.add(headlight);

    // Rider
    const suitMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a14, emissive: c, emissiveIntensity: 0.08,
        roughness: 0.7, metalness: 0.2,
    });
    // Rider torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12*S, 0.3*S, 4, 8), suitMat);
    torso.position.set(-0.0*S, 1.15*S, 0);
    torso.rotation.z = 0.35; // lean forward
    group.add(torso);
    // Head with helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.11*S, 8, 8), paint);
    helmet.position.set(0.18*S, 1.4*S, 0);
    group.add(helmet);
    // Visor
    const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.04*S, 0.05*S, 0.2*S),
        new THREE.MeshBasicMaterial({ color: c })
    );
    visor.position.set(0.28*S, 1.38*S, 0);
    group.add(visor);
    // Arms (simple capsules reaching to handlebars)
    const armMat = suitMat;
    for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04*S, 0.35*S, 3, 6), armMat);
        arm.position.set(0.35*S, 1.2*S, side*0.14*S);
        arm.rotation.z = 0.8;
        group.add(arm);
    }
    // Legs
    for (const side of [-1, 1]) {
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05*S, 0.25*S, 3, 6), suitMat);
        thigh.position.set(-0.15*S, 0.72*S, side*0.12*S);
        thigh.rotation.z = -0.3;
        group.add(thigh);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12*S, 0.06*S, 0.08*S),
            new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.7 }));
        boot.position.set(0.05*S, 0.42*S, side*0.13*S);
        group.add(boot);
    }

    // Neon underglow strip
    const underglow = new THREE.Mesh(
        new THREE.BoxGeometry(1.6*S, 0.02*S, 0.04*S),
        glowMat
    );
    underglow.position.set(0, 0.08*S, 0);
    group.add(underglow);

    // Engine glow (rear exhaust tip)
    const engineGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.05*S, 6, 6),
        glowMat
    );
    engineGlow.position.set(-0.95*S, 0.35*S, 0.13*S);
    group.add(engineGlow);

    group.userData = { wheelFront: fwTire, wheelRear: rwTire, color: c, engineGlow, fwRim, rwRim };
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
            // Trim old trail from the back
            if (pts.length > TRAIL_MAX_LEN) {
                const excess = pts.length - TRAIL_MAX_LEN;
                pts.splice(0, excess);
                p.trail.lastBroadcast = Math.max(0, p.trail.lastBroadcast - excess);
            }
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
            // Trim old trail
            if (p.trail.points.length > TRAIL_MAX_LEN) {
                p.trail.points.splice(0, p.trail.points.length - TRAIL_MAX_LEN);
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
            if (pts.length > TRAIL_MAX_LEN) {
                pts.splice(0, pts.length - TRAIL_MAX_LEN);
            }
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
            p.model.rotation.y = -p.h;
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

    // Chase camera — locked behind bike
    if (me && me.alive) {
        const spd01 = Math.min(me.speed / BOOST_SPEED, 1.4);
        const boostKick = me.boosting ? 1 : 0;

        // Distance behind and height
        const back = 10 + spd01 * 2 - boostKick * 2;
        const height = 4.5 - boostKick * 0.4;

        // Place camera directly behind the bike using me.h
        const tx = me.x - Math.cos(me.h) * back;
        const tz = me.z - Math.sin(me.h) * back;
        const ty = height;

        // Smooth position follow
        const posSmooth = 1 - Math.exp(-10 * dt);
        camera.position.x += (tx - camera.position.x) * posSmooth;
        camera.position.y += (ty - camera.position.y) * posSmooth;
        camera.position.z += (tz - camera.position.z) * posSmooth;

        // Look ahead of the cycle
        const lookX = me.x + Math.cos(me.h) * 8;
        const lookZ = me.z + Math.sin(me.h) * 8;
        camera.lookAt(lookX, 1.5, lookZ);

        // Dynamic FOV
        const targetFov = 62 + spd01 * 11 + boostKick * 11;
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-5 * dt));
        camera.updateProjectionMatrix();
    } else if (currentArena) {
        // Overview when dead
        const cx = 0, cz = 0;
        camera.position.x += (cx - camera.position.x) * (1 - Math.exp(-2 * dt));
        camera.position.z += (cz + 40 - camera.position.z) * (1 - Math.exp(-2 * dt));
        camera.position.y += (100 - camera.position.y) * (1 - Math.exp(-2 * dt));
        camera.lookAt(cx, 0, cz);
        camera.fov += (55 - camera.fov) * (1 - Math.exp(-3 * dt));
        camera.updateProjectionMatrix();
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
    $('results-title').textContent = (list[0] ? list[0].name : 'Nobody') + ' wins!';
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

// Status line on the main menu
function setMenuStatus(text, isError) {
    $('menu-status').textContent = text || '';
    $('menu-status').className = isError ? 'status error' : 'status';
}

// A joining player waits on the menu until the host answers (welcome or lobby), then enters the lobby
let joinTimer = null;
const NO_ANSWER = 'No answer from that room. Check the code, and ask the host to keep the game open (or reload and create a new room).';
function enterJoinedLobby() {
    if (view !== 'menu' || role !== 'client') return;
    clearTimeout(joinTimer);
    show('lobby');
    $('room-code').textContent = roomCode;
    setMenuStatus('');
    startMusic('menu');
}

$('btn-join').onclick = async () => {
    const code = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return setMenuStatus('Room codes are 5 letters or numbers.', true);
    myName = $('name').value.trim() || 'Player';
    localStorage.setItem('deadlineName', myName);
    unlockAudio();
    sfx.click();
    $('menu-status').textContent = 'Connecting...';
    role = 'client';
    document.body.classList.remove('is-host');
    // ?net=relay (or ?relay) skips the direct attempt; handy when a network is known to block it
    const q = new URLSearchParams(location.search);
    const forceRelay = q.get('net') === 'relay' || q.has('relay');
    const cn = new ClientNet({
        onMessage: msg => clientHandle(msg),
        onClose: () => {
            if (net !== cn) return;
            const neverAnswered = view === 'menu'; // still waiting for the host's first reply
            clearTimeout(joinTimer);
            backToMenu();
            setMenuStatus(neverAnswered ? NO_ANSWER : 'Lost connection to the host. The room may have closed.', true);
        },
        onStatus: s => { $('menu-status').textContent = s; },
        forceRelay,
    });
    try {
        myId = await cn.connect(code);
    } catch (e) {
        role = '';
        return setMenuStatus(e.message, true);
    }
    net = cn;
    roomCode = code;
    setMenuStatus('Connected. Waiting for the host to answer...');
    net.send({ t: 'hello', name: myName });
    // If the host never answers (wrong code, closed room, host's tab asleep), say so instead of an empty lobby
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
        if (net !== cn || view !== 'menu') return;
        backToMenu();
        setMenuStatus(NO_ANSWER, true);
    }, 15000);
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
    $('code').value = params.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
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
