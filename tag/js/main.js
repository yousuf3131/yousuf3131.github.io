// Tag Royale: online multiplayer tag game.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=1';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=1';
import { play as playMusic, stop as stopMusic } from './music.js?v=1';

const MAX_PLAYERS = 8;
const BEST_OF = 3;
const ROUND_TIME = 90;
const ARENA_W = 40;
const ARENA_D = 30;
const WALK_SPEED = 10;
const SPRINT_SPEED = 16;
const ACCEL = 35;
const FRICTION = 22;
const DODGE_DIST = 8;
const DODGE_DUR = 0.25;
const DODGE_INVULN = 0.3;
const DODGE_CD = 3;
const TAG_RANGE = 1.5;
const GRACE_PERIOD = 1;
const STAMINA_DRAIN = 0.25;
const STAMINA_REGEN = 0.15;
const PLAYER_R = 0.55;
const SEND_EVERY = 0.05;
const POWERUP_INTERVAL = 12;
const COLORS = ['#3b82f6', '#f97316', '#a78bfa', '#f2c14e', '#ec4899', '#e2e8f0', '#34d399', '#f87171'];
const BOT_NAMES = ['Shadow', 'Blitz', 'Phantom', 'Zippy', 'Dash', 'Bolt', 'Specter', 'Flash'];

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// Three.js setup
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1016);
scene.fog = new THREE.Fog(0x0e1016, 40, 80);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 200);
camera.position.set(0, 30, 22);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xc8d4e8, 0x1a2030, 0.8));
const sun = new THREE.DirectionalLight(0xfff4e8, 0.7);
sun.position.set(10, 25, 10);
scene.add(sun);

// ============================================================
// Arena
// ============================================================
const WALLS = [
    // Symmetrical rectangular obstacles
    { x: -8, z: -6, w: 5, d: 0.6 },
    { x: 8, z: -6, w: 5, d: 0.6 },
    { x: -8, z: 6, w: 5, d: 0.6 },
    { x: 8, z: 6, w: 5, d: 0.6 },
    { x: 0, z: 0, w: 0.6, d: 4 },
    { x: -14, z: 0, w: 0.6, d: 3 },
    { x: 14, z: 0, w: 0.6, d: 3 },
];
const PILLARS = [
    { x: -15, z: -10, r: 0.8 },
    { x: 15, z: -10, r: 0.8 },
    { x: -15, z: 10, r: 0.8 },
    { x: 15, z: 10, r: 0.8 },
];

let arenaGroup = null;

function buildArena() {
    arenaGroup = new THREE.Group();

    // Floor
    const floorGeo = new THREE.PlaneGeometry(ARENA_W, ARENA_D);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e2230, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    arenaGroup.add(floor);

    // Grid lines
    const gridMat = new THREE.MeshBasicMaterial({ color: 0x2a3040 });
    for (let x = -ARENA_W / 2; x <= ARENA_W / 2; x += 4) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(0.04, ARENA_D), gridMat);
        g.rotation.x = -Math.PI / 2; g.position.set(x, 0.01, 0);
        arenaGroup.add(g);
    }
    for (let z = -ARENA_D / 2; z <= ARENA_D / 2; z += 4) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, 0.04), gridMat);
        g.rotation.x = -Math.PI / 2; g.position.set(0, 0.01, z);
        arenaGroup.add(g);
    }

    // Perimeter walls
    const wallH = 2, wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.7 });
    const addWall = (x, z, w, d) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
        m.position.set(x, wallH / 2, z); m.castShadow = true;
        arenaGroup.add(m);
    };
    // Perimeter
    addWall(0, -ARENA_D / 2 - 0.3, ARENA_W + 0.6, 0.6);
    addWall(0, ARENA_D / 2 + 0.3, ARENA_W + 0.6, 0.6);
    addWall(-ARENA_W / 2 - 0.3, 0, 0.6, ARENA_D + 0.6);
    addWall(ARENA_W / 2 + 0.3, 0, 0.6, ARENA_D + 0.6);

    // Interior walls
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.6 });
    for (const w of WALLS) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, 1.8, w.d), innerMat);
        m.position.set(w.x, 0.9, w.z); m.castShadow = true;
        arenaGroup.add(m);
    }

    // Pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.5 });
    for (const p of PILLARS) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 2.2, 16), pillarMat);
        m.position.set(p.x, 1.1, p.z); m.castShadow = true;
        arenaGroup.add(m);
    }

    scene.add(arenaGroup);
}

function removeArena() {
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup = null; }
    // Remove player/powerup models
    scene.children.filter(c => c._isPlayer || c._isPowerup).forEach(c => scene.remove(c));
}

// Collision against walls and pillars
function collideTerrain(x, z, r) {
    let nx = x, nz = z;
    // Arena bounds
    const hw = ARENA_W / 2 - r, hd = ARENA_D / 2 - r;
    nx = clamp(nx, -hw, hw);
    nz = clamp(nz, -hd, hd);
    // Interior walls (AABB)
    for (const w of WALLS) {
        const whalf = w.w / 2 + r, dhalf = w.d / 2 + r;
        const dx = nx - w.x, dz = nz - w.z;
        if (Math.abs(dx) < whalf && Math.abs(dz) < dhalf) {
            const overlapX = whalf - Math.abs(dx);
            const overlapZ = dhalf - Math.abs(dz);
            if (overlapX < overlapZ) nx += (dx > 0 ? overlapX : -overlapX);
            else nz += (dz > 0 ? overlapZ : -overlapZ);
        }
    }
    // Pillars (circle)
    for (const p of PILLARS) {
        const dx = nx - p.x, dz = nz - p.z;
        const dist = Math.hypot(dx, dz);
        const minD = p.r + r;
        if (dist < minD && dist > 0.01) {
            nx = p.x + (dx / dist) * minD;
            nz = p.z + (dz / dist) * minD;
        }
    }
    return { x: nx, z: nz };
}

// ============================================================
// Player models
// ============================================================
function buildPlayerModel(color) {
    const group = new THREE.Group();
    // Body cylinder
    const bodyGeo = new THREE.CylinderGeometry(PLAYER_R, PLAYER_R, 1.4, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    group.add(body);
    // Hemisphere cap
    const capGeo = new THREE.SphereGeometry(PLAYER_R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const capMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 1.4;
    group.add(cap);
    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeo = new THREE.SphereGeometry(0.06, 6, 4);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.2, 1.2, 0.45);
        group.add(eye);
        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.set(side * 0.2, 1.2, 0.5);
        group.add(pupil);
    }
    group._bodyMat = bodyMat;
    group._capMat = capMat;
    group._body = body;
    return group;
}

// ============================================================
// Name labels (canvas-textured sprites above each player)
// ============================================================
function makeNameSprite(name, isMe) {
    const canvas2 = document.createElement('canvas');
    const ctx2 = canvas2.getContext('2d');
    canvas2.width = 256; canvas2.height = 64;
    ctx2.clearRect(0, 0, 256, 64);
    // Background pill
    ctx2.fillStyle = isMe ? 'rgba(59,130,246,0.7)' : 'rgba(0,0,0,0.55)';
    const textW = ctx2.measureText(name).width; // measure first for sizing
    ctx2.font = 'bold 28px Inter, sans-serif';
    const tw = ctx2.measureText(name).width;
    const px = (256 - tw) / 2;
    ctx2.beginPath();
    ctx2.roundRect(px - 12, 8, tw + 24, 44, 12);
    ctx2.fill();
    // Border for "you"
    if (isMe) {
        ctx2.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx2.lineWidth = 2;
        ctx2.stroke();
    }
    // Text
    ctx2.fillStyle = '#ffffff';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.font = 'bold 28px Inter, sans-serif';
    ctx2.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(canvas2);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3, 0.75, 1);
    sprite.position.y = 2.3;
    sprite.renderOrder = 999;
    return sprite;
}

const IT_COLOR = new THREE.Color(0xe0584f);
const SAFE_COLOR = new THREE.Color(0x2ec495);

function updatePlayerColor(p) {
    if (!p.model) return;
    const target = p.it ? IT_COLOR : SAFE_COLOR;
    p.model._bodyMat.color.lerp(target, 0.12);
    p.model._capMat.color.lerp(target, 0.12);
}

// ============================================================
// Power-up models
// ============================================================
function buildPowerupModel(type) {
    const group = new THREE.Group();
    const colors = { speed: 0x3b82f6, freeze: 0x67e8f9, invis: 0xa78bfa };
    const mat = new THREE.MeshStandardMaterial({ color: colors[type] || 0xffffff, emissive: colors[type] || 0xffffff, emissiveIntensity: 0.4 });
    const geo = type === 'freeze' ? new THREE.OctahedronGeometry(0.5) : new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    group.position.y = 1.2;
    return group;
}

// ============================================================
// Game state
// ============================================================
let myName = (() => { try { return localStorage.getItem('tagName') || ''; } catch { return ''; } })();
let role = null;
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';
let gameActive = false;
let sendTimer = 0;

const players = new Map();
let me = null;
let wantDodge = false;
let wantSprint = false;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    round: 0,
    roundTimer: 0,
    nextPowerup: POWERUP_INTERVAL,
    powerups: [],
    powerupUid: 0,
    frozenTimer: 0,
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
}

function setStatus(el, msg, err) { const s = $(el); s.textContent = msg; s.classList.toggle('error', !!err); }
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Messaging
// ============================================================
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

// ============================================================
// Host logic
// ============================================================
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            H.players.push({ id: from, name: msg.name || 'Player', color, ready: false, bot: false, score: 0, tags: 0 });
            if (net) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            toast(`${msg.name || 'Player'} joined`);
            sfx.join();
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === from);
            if (p) { p.ready = !!msg.r; emitLobby(); }
            break;
        }
        case 'st': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && from !== myId) {
                p.x = msg.s[1]; p.z = msg.s[2]; p.vx = msg.s[3]; p.vz = msg.s[4]; p.h = msg.s[5];
                p.sprinting = !!msg.s[6];
            }
            break;
        }
        case 'dodge': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && !p.tagged && p.dodgeCd <= 0) {
                p.dodging = true;
                p.dodgeT = DODGE_DUR;
                p.invulnT = DODGE_INVULN;
                p.dodgeCd = DODGE_CD;
                const spd = DODGE_DIST / DODGE_DUR;
                p.vx = msg.dx * spd;
                p.vz = msg.dz * spd;
                emit({ t: 'dodgeEvt', id: from, dx: msg.dx, dz: msg.dz });
                sfx.dodge();
            }
            break;
        }
    }
}

function hostLeave(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const name = H.players[idx].name;
    H.players.splice(idx, 1);
    toast(`${name} left`);
    if (H.phase === 'lobby') emitLobby();
    else {
        const p = players.get(id);
        if (p && p.model) scene.remove(p.model);
        players.delete(id);
    }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, score: p.score })) });
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    H.players.push({ id: botId, name, color: COLORS[H.players.length % COLORS.length], ready: true, bot: true, score: 0, tags: 0 });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 2) { setStatus('lobby-status', 'Need at least 2 players.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }
    H.phase = 'game';
    H.round = 0;
    for (const p of H.players) { p.score = 0; p.tags = 0; }
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot })) });
    hostNextRound();
}

function hostNextRound() {
    H.round++;
    H.roundTimer = ROUND_TIME;
    H.powerups = [];
    H.nextPowerup = POWERUP_INTERVAL;
    H.powerupUid = 0;
    H.frozenTimer = 0;

    // Pick random "it" player
    const itIdx = Math.floor(Math.random() * H.players.length);

    // Spawn positions spread around arena
    const n = H.players.length;
    const spawns = H.players.map((_, i) => {
        const angle = (i / n) * Math.PI * 2;
        const r = 8;
        return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    });

    for (const p of H.players) p.tags = 0;

    emit({
        t: 'roundStart', round: H.round, bestOf: BEST_OF,
        itIdx,
        spawns: H.players.map((p, i) => ({
            id: p.id, name: p.name, color: p.color, bot: p.bot,
            x: spawns[i].x, z: spawns[i].z,
            it: i === itIdx, score: p.score,
        })),
    });

    setTimeout(() => emit({ t: 'go' }), 3500);
}

function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    H.roundTimer -= dt;

    // Frozen timer
    if (H.frozenTimer > 0) H.frozenTimer -= dt;

    // Power-up spawning
    H.nextPowerup -= dt;
    if (H.nextPowerup <= 0 && H.powerups.length < 2) {
        H.nextPowerup = POWERUP_INTERVAL;
        const types = ['speed', 'freeze', 'invis'];
        const type = types[Math.floor(Math.random() * types.length)];
        const x = (Math.random() - 0.5) * (ARENA_W - 6);
        const z = (Math.random() - 0.5) * (ARENA_D - 6);
        const uid = ++H.powerupUid;
        const pu = { uid, type, x, z };
        H.powerups.push(pu);
        emit({ t: 'powerup', ...pu });
    }

    // Bot AI
    for (const [id, p] of players) {
        if (!p.bot) continue;
        p.botThinkT -= dt;
        if (p.botThinkT > 0) continue;
        p.botThinkT = 0.3 + Math.random() * 0.3;

        if (p.it) {
            // "It" bot: chase nearest non-it
            let nearDist = Infinity, nearP = null;
            for (const [oid, op] of players) {
                if (oid === id || op.it || op.tagged) continue;
                const d = Math.hypot(op.x - p.x, op.z - p.z);
                if (d < nearDist) { nearDist = d; nearP = op; }
            }
            if (nearP && H.frozenTimer <= 0) {
                const a = Math.atan2(nearP.z - p.z, nearP.x - p.x);
                p.botTargetX = Math.cos(a); p.botTargetZ = Math.sin(a);
                p.botSprint = nearDist < 12;
            } else {
                p.botTargetX = 0; p.botTargetZ = 0;
                p.botSprint = false;
            }
        } else {
            // Survivor bot: flee from nearest "it"
            let nearDist = Infinity, nearP = null;
            for (const [oid, op] of players) {
                if (oid === id || !op.it) continue;
                const d = Math.hypot(op.x - p.x, op.z - p.z);
                if (d < nearDist) { nearDist = d; nearP = op; }
            }
            if (nearP) {
                if (nearDist < 3 && p.dodgeCd <= 0 && Math.random() > 0.3) {
                    // Dodge away
                    const a = Math.atan2(p.z - nearP.z, p.x - nearP.x);
                    act({ t: 'dodge', dx: Math.cos(a), dz: Math.sin(a) });
                }
                const flee = Math.atan2(p.z - nearP.z, p.x - nearP.x);
                // Add some randomness to avoid getting cornered
                const jitter = (Math.random() - 0.5) * 0.8;
                p.botTargetX = Math.cos(flee + jitter);
                p.botTargetZ = Math.sin(flee + jitter);
                p.botSprint = nearDist < 8;
            } else {
                // Wander toward center
                const a = Math.atan2(-p.z, -p.x);
                p.botTargetX = Math.cos(a) * 0.3;
                p.botTargetZ = Math.sin(a) * 0.3;
                p.botSprint = false;
            }

            // Bot tries to pick up power-ups if near
            for (const pu of H.powerups) {
                const d = Math.hypot(pu.x - p.x, pu.z - p.z);
                if (d < 6) {
                    const a = Math.atan2(pu.z - p.z, pu.x - p.x);
                    p.botTargetX = Math.cos(a); p.botTargetZ = Math.sin(a);
                    break;
                }
            }
        }
    }

    // Physics for all players (host authoritative)
    for (const [id, p] of players) {
        // Dodge timers
        if (p.dodgeT > 0) { p.dodgeT -= dt; if (p.dodgeT <= 0) p.dodging = false; }
        if (p.invulnT > 0) p.invulnT -= dt;
        if (p.dodgeCd > 0) p.dodgeCd -= dt;
        if (p.graceT > 0) p.graceT -= dt;

        // Power-up timer
        if (p.powerupT > 0) {
            p.powerupT -= dt;
            if (p.powerupT <= 0) { p.powerup = null; }
        }

        // Invisible timer
        if (p.invisT > 0) {
            p.invisT -= dt;
            if (p.invisT <= 0) p.invisible = false;
        }

        // Frozen "it" can't move
        if (p.it && H.frozenTimer > 0 && !p.dodging) continue;

        // Bot movement
        if (p.bot && !p.dodging) {
            const tx = p.botTargetX || 0, tz = p.botTargetZ || 0;
            const len = Math.hypot(tx, tz);
            if (len > 0.1) {
                p.vx += (tx / len) * ACCEL * dt;
                p.vz += (tz / len) * ACCEL * dt;
            }
            p.sprinting = p.botSprint && p.stamina > 0.1;
        }

        // Stamina
        if (p.sprinting && !p.dodging) {
            p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
            if (p.stamina <= 0) p.sprinting = false;
        } else {
            p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * dt);
        }

        // Friction + speed clamp
        if (!p.dodging) {
            const maxSpd = (p.sprinting ? SPRINT_SPEED : WALK_SPEED) * (p.powerup === 'speed' ? 1.8 : 1);
            const speed = Math.hypot(p.vx, p.vz);
            if (speed > maxSpd) { p.vx *= maxSpd / speed; p.vz *= maxSpd / speed; }
            if (speed > 0.1) {
                const fric = FRICTION * dt;
                const ns = Math.max(0, speed - fric);
                p.vx *= ns / speed; p.vz *= ns / speed;
            }
        }

        // Move + collide terrain
        const newX = p.x + p.vx * dt;
        const newZ = p.z + p.vz * dt;
        const col = collideTerrain(newX, newZ, PLAYER_R);
        p.x = col.x; p.z = col.z;
        if (Math.hypot(p.vx, p.vz) > 0.5) p.h = Math.atan2(p.vz, p.vx);

        // Power-up pickup (survivors only)
        if (!p.it) {
            for (let i = H.powerups.length - 1; i >= 0; i--) {
                const pu = H.powerups[i];
                if (Math.hypot(p.x - pu.x, p.z - pu.z) < 1.5) {
                    H.powerups.splice(i, 1);
                    if (pu.type === 'speed') {
                        p.powerup = 'speed'; p.powerupT = 4;
                        emit({ t: 'grabbed', uid: pu.uid, id, type: pu.type });
                        sfx.powerup();
                    } else if (pu.type === 'freeze') {
                        H.frozenTimer = 2.5;
                        emit({ t: 'freezeEvt', uid: pu.uid, id, dur: 2.5 });
                        sfx.freeze();
                    } else if (pu.type === 'invis') {
                        p.invisible = true; p.invisT = 3;
                        emit({ t: 'invisEvt', uid: pu.uid, id, dur: 3 });
                        sfx.invisible();
                    }
                }
            }
        }
    }

    // Tagging check (host only)
    for (const [itId, itP] of players) {
        if (!itP.it || (H.frozenTimer > 0 && !itP.dodging)) continue;
        for (const [rId, rP] of players) {
            if (rId === itId || rP.it || rP.tagged) continue;
            if (rP.invulnT > 0 || rP.invisible) continue;
            if (itP.graceT > 0) continue;
            const dist = Math.hypot(itP.x - rP.x, itP.z - rP.z);
            if (dist < TAG_RANGE) {
                rP.it = true;
                rP.tagged = true;
                rP.graceT = GRACE_PERIOD;
                itP.graceT = GRACE_PERIOD;
                // Track who tagged whom
                const hp = H.players.find(p => p.id === itId);
                if (hp) hp.tags++;
                emit({ t: 'tagged', tagger: itId, target: rId });
                sfx.tag();
            }
        }
    }

    // Broadcast positions
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const states = [];
        for (const [id, p] of players) {
            states.push([id, p.x, p.z, p.vx, p.vz, p.h, p.it ? 1 : 0, p.sprinting ? 1 : 0, p.dodging ? 1 : 0, p.invisible ? 1 : 0]);
        }
        emit({ t: 'sts', a: states, timer: Math.ceil(H.roundTimer), frozen: H.frozenTimer > 0 ? 1 : 0 });
    }

    // Check round end
    const survivors = [...players.values()].filter(p => !p.it);
    if (survivors.length <= 1 || H.roundTimer <= 0) {
        gameActive = false;
        // Score: survivors get 3 pts, "it" members get 1 pt per personal tag
        for (const hp of H.players) {
            const p = players.get(hp.id);
            if (p && !p.it) hp.score += 3;
            hp.score += hp.tags;
        }
        const winnerName = survivors.length === 1 ? (H.players.find(p => p.id === [...players.entries()].find(([, p]) => !p.it)?.[0])?.name || 'Nobody') : 'Time\'s up!';
        emit({
            t: 'roundEnd', winnerName,
            scores: H.players.map(p => ({ id: p.id, name: p.name, score: p.score, color: p.color })),
        });

        // Check game end
        if (H.round >= BEST_OF) {
            setTimeout(() => {
                const sorted = [...H.players].sort((a, b) => b.score - a.score);
                emit({ t: 'results', list: sorted.map((p, i) => ({ id: p.id, name: p.name, score: p.score, place: i + 1, color: p.color })) });
            }, 4000);
        } else {
            setTimeout(() => hostNextRound(), 4000);
        }
    }
}

// ============================================================
// Client logic
// ============================================================
function clientHandle(msg) {
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; break;
        case 'reject': setStatus('menu-status', msg.reason, true); leave(); return;
        case 'lobby': renderLobby(msg.players); break;
        case 'toast': toast(msg.text); break;
        case 'gameStart':
            view = 'game';
            show('hud');
            buildArena();
            playMusic('game');
            break;
        case 'roundStart': {
            gameActive = false;
            players.clear();
            scene.children.filter(c => c._isPlayer || c._isPowerup).forEach(c => scene.remove(c));
            for (const s of msg.spawns) {
                const model = buildPlayerModel(s.color);
                const nameLabel = makeNameSprite(s.name, s.id === myId);
                model.add(nameLabel);
                model.position.set(s.x, 0, s.z);
                model._isPlayer = true;
                scene.add(model);
                const p = {
                    x: s.x, z: s.z, vx: 0, vz: 0, h: 0,
                    it: s.it, tagged: false,
                    sprinting: false, stamina: 1,
                    dodging: false, dodgeT: 0, invulnT: 0, dodgeCd: 0,
                    graceT: 0,
                    powerup: null, powerupT: 0,
                    invisible: false, invisT: 0,
                    model, bot: s.bot, name: s.name, color: s.color,
                    botThinkT: 0, botTargetX: 0, botTargetZ: 0, botSprint: false,
                    _id: s.id,
                };
                players.set(s.id, p);
                if (s.id === myId) me = p;
            }
            $('round-num').textContent = `${msg.round}/${BEST_OF}`;
            updateRoleBadge();
            showCenterMsg('3', true);
            sfx.count();
            setTimeout(() => { showCenterMsg('2', true); sfx.count(); }, 1000);
            setTimeout(() => { showCenterMsg('1', true); sfx.count(); }, 2000);
            setTimeout(() => { showCenterMsg('GO!', true); sfx.go(); }, 3000);
            break;
        }
        case 'go': gameActive = true; break;
        case 'sts':
            if (role === 'host') break;
            for (const s of msg.a) {
                const p = players.get(s[0]);
                if (!p || s[0] === myId) continue;
                p.x = s[1]; p.z = s[2]; p.vx = s[3]; p.vz = s[4]; p.h = s[5];
                p.it = !!s[6]; p.sprinting = !!s[7]; p.dodging = !!s[8]; p.invisible = !!s[9];
            }
            if (msg.timer !== undefined) $('timer').textContent = msg.timer;
            break;
        case 'dodgeEvt': {
            const p = players.get(msg.id);
            if (p) {
                p.dodging = true; p.dodgeT = DODGE_DUR; p.invulnT = DODGE_INVULN;
                const spd = DODGE_DIST / DODGE_DUR;
                p.vx = msg.dx * spd; p.vz = msg.dz * spd;
            }
            sfx.dodge();
            break;
        }
        case 'tagged': {
            const target = players.get(msg.target);
            if (target) { target.it = true; target.tagged = true; target.graceT = GRACE_PERIOD; }
            const tagger = players.get(msg.tagger);
            if (tagger) tagger.graceT = GRACE_PERIOD;
            if (msg.target === myId) {
                sfx.tagged();
                showCenterMsg('TAGGED!', true);
                updateRoleBadge();
            } else {
                sfx.tag();
                const tName = target?.name || '?';
                toast(`${tName} was tagged!`);
            }
            updateHudCounts();
            break;
        }
        case 'powerup': {
            const model = buildPowerupModel(msg.type);
            model.position.set(msg.x, 1.2, msg.z);
            model._isPowerup = true;
            model._uid = msg.uid;
            scene.add(model);
            break;
        }
        case 'grabbed': {
            const pu = scene.children.find(c => c._isPowerup && c._uid === msg.uid);
            if (pu) scene.remove(pu);
            const p = players.get(msg.id);
            if (p) { p.powerup = msg.type; p.powerupT = 4; }
            sfx.powerup();
            if (msg.id === myId) toast('Speed Boost!');
            break;
        }
        case 'freezeEvt': {
            const pu = scene.children.find(c => c._isPowerup && c._uid === msg.uid);
            if (pu) scene.remove(pu);
            sfx.freeze();
            toast('All taggers frozen!');
            break;
        }
        case 'invisEvt': {
            const pu = scene.children.find(c => c._isPowerup && c._uid === msg.uid);
            if (pu) scene.remove(pu);
            const p = players.get(msg.id);
            if (p) { p.invisible = true; p.invisT = msg.dur; }
            sfx.invisible();
            if (msg.id === myId) toast('Invisible!');
            break;
        }
        case 'roundEnd':
            gameActive = false;
            showCenterMsg(msg.winnerName, true);
            updatePlayerTags();
            break;
        case 'results': showResults(msg.list); break;
        case 'toLobby':
            view = 'lobby';
            show('lobby');
            removeArena();
            players.clear();
            playMusic('menu');
            break;
    }
}

// ============================================================
// HUD helpers
// ============================================================
function showCenterMsg(text, pop) {
    const el = $('center-msg');
    el.textContent = text;
    el.className = pop ? 'pop' : '';
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2000);
}

function updateRoleBadge() {
    if (!me) return;
    const badge = $('role-badge');
    if (me.it) {
        badge.textContent = 'IT!';
        badge.className = 'role-badge tagger';
    } else {
        badge.textContent = 'RUN!';
        badge.className = 'role-badge runner';
    }
}

function updateHudCounts() {
    const survivors = [...players.values()].filter(p => !p.it).length;
    $('survivor-count').textContent = `${survivors} survivor${survivors !== 1 ? 's' : ''}`;
    // Update player tags
    updatePlayerTags();
}

function updatePlayerTags() {
    const el = $('player-tags');
    el.innerHTML = '';
    for (const [, p] of players) {
        const span = document.createElement('span');
        span.className = 'ptag ' + (p.it ? 'it' : 'safe');
        span.textContent = p.name;
        el.appendChild(span);
    }
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (view === 'game' && e.code === 'Space') wantDodge = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// Touch joystick
const JOY_R = 55;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function resetJoy() { joy.id = null; joy.x = joy.y = 0; $('joy').classList.remove('on'); $('joy-knob').style.transform = ''; }
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    e.preventDefault();
    if (joy.id !== null || view !== 'game') return;
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
    const j = $('joy'); j.style.left = `${joy.ox}px`; j.style.top = `${joy.oy}px`; j.classList.add('on');
});
canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    joy.x = dx / JOY_R; joy.y = dy / JOY_R;
    $('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
});
const endJoy = e => { if (e.pointerId === joy.id) resetJoy(); };
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

// Touch buttons
$('touch-dodge').addEventListener('pointerdown', e => { e.preventDefault(); wantDodge = true; });
let sprintTouchId = null;
$('touch-sprint').addEventListener('pointerdown', e => { e.preventDefault(); sprintTouchId = e.pointerId; wantSprint = true; });
addEventListener('pointerup', e => { if (e.pointerId === sprintTouchId) { sprintTouchId = null; wantSprint = false; } });
addEventListener('pointercancel', e => { if (e.pointerId === sprintTouchId) { sprintTouchId = null; wantSprint = false; } });

function playerInput() {
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (document.body.classList.contains('touch') && joy.id !== null) {
        ix = joy.x; iz = joy.y;
    }
    const sprint = keys.ShiftLeft || keys.ShiftRight || wantSprint;
    return { ix, iz, sprint };
}

// ============================================================
// Game loop
// ============================================================
function updateGame(dt) {
    if (!gameActive) return;

    // Host physics always runs (bots, tagging, round logic)
    if (role === 'host') hostUpdate(dt);

    if (!me) { wantDodge = false; return; }

    const { ix, iz, sprint } = playerInput();
    const inputLen = Math.hypot(ix, iz);

    // Apply input
    if (inputLen > 0.15 && !me.dodging) {
        me.vx += (ix / inputLen) * ACCEL * dt;
        me.vz += (iz / inputLen) * ACCEL * dt;
    }

    // Sprint
    me.sprinting = sprint && inputLen > 0.15 && me.stamina > 0;

    // Dodge
    if (wantDodge && me.dodgeCd <= 0) {
        wantDodge = false;
        const dx = inputLen > 0.15 ? ix / inputLen : Math.cos(me.h);
        const dz = inputLen > 0.15 ? iz / inputLen : Math.sin(me.h);
        act({ t: 'dodge', dx, dz });
        if (role !== 'host') {
            me.dodging = true; me.dodgeT = DODGE_DUR; me.invulnT = DODGE_INVULN; me.dodgeCd = DODGE_CD;
            const spd = DODGE_DIST / DODGE_DUR;
            me.vx = dx * spd; me.vz = dz * spd;
        }
    }
    wantDodge = false;

    // Client-side prediction
    if (role !== 'host') {
        if (me.dodgeT > 0) { me.dodgeT -= dt; if (me.dodgeT <= 0) me.dodging = false; }
        if (me.invulnT > 0) me.invulnT -= dt;
        if (me.dodgeCd > 0) me.dodgeCd -= dt;
        if (me.graceT > 0) me.graceT -= dt;
        // Stamina
        if (me.sprinting && !me.dodging) {
            me.stamina = Math.max(0, me.stamina - STAMINA_DRAIN * dt);
            if (me.stamina <= 0) me.sprinting = false;
        } else {
            me.stamina = Math.min(1, me.stamina + STAMINA_REGEN * dt);
        }
        if (!me.dodging) {
            const maxSpd = (me.sprinting ? SPRINT_SPEED : WALK_SPEED) * (me.powerup === 'speed' ? 1.8 : 1);
            const speed = Math.hypot(me.vx, me.vz);
            if (speed > maxSpd) { me.vx *= maxSpd / speed; me.vz *= maxSpd / speed; }
            if (speed > 0.1) { const f = FRICTION * dt; const ns = Math.max(0, speed - f); me.vx *= ns / speed; me.vz *= ns / speed; }
        }
        const nx = me.x + me.vx * dt, nz = me.z + me.vz * dt;
        const col = collideTerrain(nx, nz, PLAYER_R);
        me.x = col.x; me.z = col.z;
        if (Math.hypot(me.vx, me.vz) > 0.5) me.h = Math.atan2(me.vz, me.vx);
        if (me.powerupT > 0) { me.powerupT -= dt; if (me.powerupT <= 0) me.powerup = null; }
        if (me.invisT > 0) { me.invisT -= dt; if (me.invisT <= 0) me.invisible = false; }
    }

    // Send position
    sendTimer -= dt;
    if (sendTimer <= 0 && role === 'client') {
        sendTimer = SEND_EVERY;
        act({ t: 'st', s: [myId, me.x, me.z, me.vx, me.vz, me.h, me.sprinting ? 1 : 0] });
    }
}

function render(dt) {
    // Update models
    for (const [id, p] of players) {
        if (!p.model) continue;
        // Smooth position interpolation
        p.model.position.x += (p.x - p.model.position.x) * Math.min(1, dt * 15);
        p.model.position.z += (p.z - p.model.position.z) * Math.min(1, dt * 15);
        p.model.position.y = 0;
        p.model.rotation.y = -p.h + Math.PI / 2;

        // Update color (green/red based on it status)
        updatePlayerColor(p);

        // Dodge visual
        if (p.dodging) {
            p.model.scale.set(0.7, 1.2, 1.3);
        } else {
            p.model.scale.lerp(new THREE.Vector3(1, 1, 1), dt * 8);
        }

        // Sprint tilt
        if (p.sprinting && !p.dodging) {
            p.model.rotation.z = Math.sin(Date.now() * 0.015) * 0.05;
        }

        // Invisible: low opacity
        if (p.invisible) {
            const isMe = id === myId;
            p.model._bodyMat.transparent = true;
            p.model._capMat.transparent = true;
            p.model._bodyMat.opacity = isMe ? 0.15 : 0.05;
            p.model._capMat.opacity = isMe ? 0.15 : 0.05;
        } else {
            p.model._bodyMat.transparent = false;
            p.model._capMat.transparent = false;
            p.model._bodyMat.opacity = 1;
            p.model._capMat.opacity = 1;
        }
    }

    // Rotate power-ups
    for (const c of scene.children) {
        if (c._isPowerup) {
            c.rotation.y += dt * 2;
            c.position.y = 1.2 + Math.sin(Date.now() * 0.003) * 0.3;
        }
    }

    // Camera follows local player
    if (me) {
        const tx = me.x * 0.4;
        const tz = me.z * 0.4 + 22;
        camera.position.x += (tx - camera.position.x) * dt * 3;
        camera.position.z += (tz - camera.position.z) * dt * 3;
        camera.lookAt(me.x * 0.4, 0, me.z * 0.4);
    }

    // HUD updates
    updateHudCounts();

    // Stamina bar
    if (me) {
        $('stamina-fill').style.width = `${me.stamina * 100}%`;
    }

    // Dodge cooldown ring
    if (me) {
        const cdFrac = me.dodgeCd > 0 ? me.dodgeCd / DODGE_CD : 0;
        $('cd-ring').style.strokeDashoffset = (cdFrac * 138.2).toFixed(1);
    }

    // Power-up HUD
    if (me && me.powerup) {
        $('powerup-hud').classList.remove('hidden');
        const icons = { speed: 'SPEED' };
        $('powerup-icon').textContent = icons[me.powerup] || '';
    } else {
        $('powerup-hud').classList.add('hidden');
    }

    renderer.render(scene, camera);
}

// ============================================================
// Lobby UI
// ============================================================
function renderLobby(plist) {
    $('room-code').textContent = roomCode;
    $('count').textContent = `${plist.length}/${MAX_PLAYERS}`;
    const list = $('players');
    list.innerHTML = '';
    for (const p of plist) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span>${p.id === myId ? '<span class="badge host">You</span>' : ''}${p.ready ? '<span class="badge ok">Ready</span>' : ''}`;
        list.appendChild(li);
    }
}

// ============================================================
// Results
// ============================================================
function showResults(list) {
    view = 'results';
    show('results');
    removeArena();
    players.clear();
    playMusic('results');
    sfx.go();
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = p.id === myId ? 'me' : '';
        li.innerHTML = `<span class="place">${p.place}</span><span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span><span class="score">${p.score} pts</span>`;
        ol.appendChild(li);
    }
    $('results-title').textContent = list[0]?.id === myId ? 'You Win!' : 'Game Over';
}

// ============================================================
// Room management
// ============================================================
async function createRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    setStatus('menu-status', 'Creating room...');
    roomCode = makeCode();
    role = 'host';
    document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try { await hn.open(roomCode); } catch (e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return createRoom(); }
        setStatus('menu-status', e.message, true); role = null; document.body.classList.remove('is-host'); return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    enterLobby();
}

async function joinRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining...');
    role = 'client'; document.body.classList.remove('is-host');
    const cn = new ClientNet({ onMessage: clientHandle, onClose: () => leave('Lost connection.'), onStatus: msg => setStatus('menu-status', msg), forceRelay: new URLSearchParams(location.search).get('net') === 'relay' });
    try { myId = await cn.connect(code); } catch (e) { setStatus('menu-status', e.message, true); role = null; return; }
    net = cn; roomCode = code;
    cn.send({ t: 'hello', name: myName });
    enterLobby();
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    role = 'host'; document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 5; i++) addBot();
    enterLobby();
}

function enterLobby() { view = 'lobby'; show('lobby'); playMusic('menu'); setStatus('menu-status', ''); }
function leave(reason) {
    const n = net; net = null; if (n) n.close();
    role = null; myId = null; roomCode = ''; gameActive = false;
    H.players = []; H.phase = 'lobby';
    removeArena(); players.clear(); me = null;
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

// ============================================================
// Event listeners
// ============================================================
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-exit').addEventListener('click', () => {
    if (view === 'menu') location.href = '../projects.html';
    else if (confirm(role === 'host' ? 'Leave and close this room?' : 'Leave this room?')) leave();
});
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => addBot());
$('btn-ready').addEventListener('click', () => { act({ t: 'ready', r: true }); });
$('btn-start').addEventListener('click', () => hostStartGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    for (const p of H.players) { p.ready = p.bot; p.score = 0; p.tags = 0; }
    emitLobby();
    emit({ t: 'toLobby' });
});

function syncMute() { $('icon-sound').classList.toggle('hidden', isMuted()); $('icon-muted').classList.toggle('hidden', !isMuted()); }
syncMute();
$('btn-mute').addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); syncMute(); });

// ============================================================
// Main loop
// ============================================================
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (view === 'game' || gameActive) { updateGame(dt); render(dt); }
    else { renderer.render(scene, camera); }
    requestAnimationFrame(frame);
}

$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `Invited to room ${invite}.`; $('invite').classList.remove('hidden'); }

show('menu');
playMusic('menu');
requestAnimationFrame(frame);
