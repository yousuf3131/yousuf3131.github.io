// Sumo Smash: online multiplayer arena brawler.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=3';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=3';
import { play as playMusic, stop as stopMusic } from './music.js?v=3';
import * as gfx from './gfx.js?v=3';

const MAX_PLAYERS = 8;
const BEST_OF = 5;
const ROUND_TIME = 90;
const PLATFORM_R = 20;
const SHRINK_INTERVAL = 15;
const SHRINK_AMT = 2.5;
const MIN_PLATFORM_R = 5;
const SEND_EVERY = 0.05;
const DASH_SPEED = 30;
const DASH_DUR = 0.3;
const DASH_CD = 2;
const PLAYER_R = 0.8;
const MOVE_SPEED = 12;
const ACCEL = 30;
const FRICTION = 20;
const COLORS = ['#e0584f', '#3b82f6', '#2ec495', '#f2c14e', '#a78bfa', '#f97316', '#ec4899', '#e2e8f0'];
const BOT_NAMES = ['Yokozuna', 'Thumper', 'Big Bump', 'Tiny Tank', 'Round Boy', 'Belly Flop', 'Iron Gut', 'Sumo Steve'];

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// Three.js setup
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 200);
camera.position.set(0, 28, 18);
camera.lookAt(0, 0, 0);
const camBase = new THREE.Vector3(0, 28, 18);
const camLook = new THREE.Vector3(0, 0, 0);

gfx.initWorld(renderer, scene, camera);

// ============================================================
// Arena
// ============================================================
let platformR = PLATFORM_R;
let shrinkClock = SHRINK_INTERVAL; // cosmetic only: drives the pre-shrink warning glow

function buildArena() {
    platformR = PLATFORM_R;
    gfx.setMode(true);
    gfx.setRingRadius(PLATFORM_R);
    camBase.set(0, 28, 18);
    camLook.set(0, 0, 0);
}

function updatePlatformSize(r, withFx) {
    platformR = r;
    gfx.setRingRadius(r, withFx);
}

function removeArena() {
    scene.children.filter(c => c._isPlayer || c._isPowerup).forEach(c => scene.remove(c));
    platformR = PLATFORM_R;
    gfx.setMode(false);
}

// ============================================================
// Player and power-up models (see gfx.js)
// ============================================================
function buildPlayerModel(color) {
    return gfx.buildWrestler(color, Math.max(0, COLORS.indexOf(color)));
}

function buildPowerupModel(type) {
    return gfx.buildPowerup(type);
}

// ============================================================
// Game state
// ============================================================
let myName = (() => { try { return localStorage.getItem('sumoName') || ''; } catch { return ''; } })();
let role = null;
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';
let gameActive = false;
let sendTimer = 0;

const players = new Map(); // id -> { x, z, vx, vz, h, alive, dashing, dashCd, dashT, speed: 0, mass: 1, powerup, powerupT, shieldHp, model, wins, ... }
let me = null;
let wantDash = false;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    round: 0,
    roundTimer: 0,
    shrinkTimer: 0,
    currentR: PLATFORM_R,
    powerups: [],
    nextPowerup: 10,
    powerupUid: 0,
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
            // The relay can deliver a message twice; never add the same person twice
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            H.players.push({ id: from, name: msg.name || 'Player', color, ready: false, bot: false, wins: 0 });
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
            const s = msg.s;
            if (!s || !gameActive) return;
            const p = players.get(from);
            if (p && from !== myId) {
                p.x = s[1]; p.z = s[2]; p.vx = s[3]; p.vz = s[4]; p.h = s[5];
                p.dashing = !!s[6];
            }
            break;
        }
        case 'dash': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && p.alive && p.dashCd <= 0) {
                p.dashing = true;
                p.dashT = DASH_DUR;
                p.dashCd = DASH_CD;
                p.vx = msg.dx * DASH_SPEED;
                p.vz = msg.dz * DASH_SPEED;
                emit({ t: 'dashEvt', id: from, dx: msg.dx, dz: msg.dz });
                sfx.dash();
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
        if (p && p.model) { scene.remove(p.model); }
        players.delete(id);
    }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
}

// Host removes someone from the lobby. Bots just go; real players are told why, then disconnected.
function kickPlayer(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || idx < 0 || id === myId) return;
    const p = H.players[idx];
    if (p.bot) { H.players.splice(idx, 1); emitLobby(); return; }
    if (!net) return;
    net.send(id, { t: 'reject', reason: 'The host removed you from the room.' });
    setTimeout(() => net && net.kick(id), 600);
    hostLeave(id);
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    H.players.push({ id: botId, name, color: COLORS[H.players.length % COLORS.length], ready: true, bot: true, wins: 0 });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 2) { setStatus('lobby-status', 'Need at least 2 players.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }
    H.phase = 'game';
    H.round = 0;
    for (const p of H.players) p.wins = 0;
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: 0 })) });
    hostNextRound();
}

function hostNextRound() {
    H.round++;
    H.currentR = PLATFORM_R;
    H.shrinkTimer = SHRINK_INTERVAL;
    H.roundTimer = ROUND_TIME;
    H.powerups = [];
    H.nextPowerup = 10;
    H.powerupUid = 0;

    // Spawn positions in a circle
    const n = H.players.length;
    const spawnR = Math.min(PLATFORM_R * 0.6, 8);
    const spawns = H.players.map((_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: Math.cos(a) * spawnR, z: Math.sin(a) * spawnR };
    });

    emit({
        t: 'roundStart', round: H.round, bestOf: BEST_OF,
        spawns: H.players.map((p, i) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, x: spawns[i].x, z: spawns[i].z, wins: p.wins })),
        platformR: PLATFORM_R,
    });

    // Countdown then go
    setTimeout(() => emit({ t: 'go' }), 3500);
}

function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    H.roundTimer -= dt;
    H.shrinkTimer -= dt;

    // Shrink platform
    if (H.shrinkTimer <= 0 && H.currentR > MIN_PLATFORM_R) {
        H.shrinkTimer = SHRINK_INTERVAL;
        H.currentR = Math.max(MIN_PLATFORM_R, H.currentR - SHRINK_AMT);
        emit({ t: 'shrink', r: H.currentR });
        sfx.shrink();
    }

    // Power-up spawning
    H.nextPowerup -= dt;
    if (H.nextPowerup <= 0 && H.powerups.length < 2) {
        H.nextPowerup = 10;
        const types = ['speed', 'heavy', 'shield'];
        const type = types[Math.floor(Math.random() * types.length)];
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * H.currentR * 0.6;
        const uid = ++H.powerupUid;
        const pu = { uid, type, x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
        H.powerups.push(pu);
        emit({ t: 'powerup', ...pu });
    }

    // Bot AI
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        p.botThinkT -= dt;
        if (p.botThinkT > 0) continue;
        p.botThinkT = 0.3 + Math.random() * 0.5;

        const distFromCenter = Math.hypot(p.x, p.z);
        // Find nearest other player
        let nearDist = Infinity, nearP = null;
        for (const [oid, op] of players) {
            if (oid === id || !op.alive) continue;
            const d = Math.hypot(op.x - p.x, op.z - p.z);
            if (d < nearDist) { nearDist = d; nearP = op; }
        }

        // Decision
        if (distFromCenter > H.currentR - 3) {
            // Near edge: move to center
            const a = Math.atan2(-p.z, -p.x);
            p.botTargetX = Math.cos(a); p.botTargetZ = Math.sin(a);
        } else if (nearP && nearDist < 5 && p.dashCd <= 0) {
            // Attack
            const a = Math.atan2(nearP.z - p.z, nearP.x - p.x);
            if (Math.random() > 0.2) { // 80% accuracy
                act({ t: 'dash', dx: Math.cos(a), dz: Math.sin(a) });
            }
            p.botTargetX = Math.cos(a); p.botTargetZ = Math.sin(a);
        } else if (nearP) {
            // Move toward nearest
            const a = Math.atan2(nearP.z - p.z, nearP.x - p.x);
            p.botTargetX = Math.cos(a); p.botTargetZ = Math.sin(a);
        } else {
            p.botTargetX = 0; p.botTargetZ = 0;
        }
    }

    // Physics for all players (host authoritative for collisions)
    for (const [id, p] of players) {
        if (!p.alive) continue;

        // Bot movement
        if (p.bot) {
            const tx = p.botTargetX || 0, tz = p.botTargetZ || 0;
            const len = Math.hypot(tx, tz);
            if (len > 0.1) {
                p.vx += (tx / len) * ACCEL * dt;
                p.vz += (tz / len) * ACCEL * dt;
            }
        }

        // Dash timer
        if (p.dashT > 0) {
            p.dashT -= dt;
            if (p.dashT <= 0) p.dashing = false;
        }
        if (p.dashCd > 0) p.dashCd -= dt;

        // Friction (when not dashing)
        if (!p.dashing) {
            const speed = Math.hypot(p.vx, p.vz);
            const maxSpd = MOVE_SPEED * (p.powerup === 'speed' ? 1.5 : 1);
            if (speed > maxSpd) { p.vx *= maxSpd / speed; p.vz *= maxSpd / speed; }
            if (speed > 0.1) {
                const fric = FRICTION * dt;
                const newSpd = Math.max(0, speed - fric);
                p.vx *= newSpd / speed; p.vz *= newSpd / speed;
            }
        }

        // Move
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        if (Math.hypot(p.vx, p.vz) > 0.5) p.h = Math.atan2(p.vz, p.vx);

        // Power-up timer
        if (p.powerupT > 0) {
            p.powerupT -= dt;
            if (p.powerupT <= 0) { p.powerup = null; }
        }

        // Fall check
        if (Math.hypot(p.x, p.z) > H.currentR + 0.5) {
            p.alive = false;
            p.fallT = 1;
            emit({ t: 'fell', id });
            sfx.fall();
        }

        // Power-up pickup
        for (let i = H.powerups.length - 1; i >= 0; i--) {
            const pu = H.powerups[i];
            if (Math.hypot(p.x - pu.x, p.z - pu.z) < 1.5) {
                H.powerups.splice(i, 1);
                p.powerup = pu.type;
                p.powerupT = 5;
                if (pu.type === 'shield') p.shieldHp = 1;
                emit({ t: 'grabbed', uid: pu.uid, id, type: pu.type });
                sfx.powerup();
            }
        }
    }

    // Collision between players
    const alive = [...players.values()].filter(p => p.alive);
    for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
            const a = alive[i], b = alive[j];
            const dx = b.x - a.x, dz = b.z - a.z;
            const dist = Math.hypot(dx, dz);
            if (dist < PLAYER_R * 2 && dist > 0.01) {
                const nx = dx / dist, nz = dz / dist;
                const overlap = PLAYER_R * 2 - dist;
                // Push apart
                a.x -= nx * overlap * 0.5;
                a.z -= nz * overlap * 0.5;
                b.x += nx * overlap * 0.5;
                b.z += nz * overlap * 0.5;
                // Knockback
                const aMass = (a.powerup === 'heavy' ? 2 : 1);
                const bMass = (b.powerup === 'heavy' ? 2 : 1);
                const aDash = a.dashing ? 3 : 1;
                const bDash = b.dashing ? 3 : 1;
                const aForce = Math.hypot(a.vx, a.vz) * aMass * aDash;
                const bForce = Math.hypot(b.vx, b.vz) * bMass * bDash;
                if (aForce > bForce) {
                    if (b.powerup === 'shield' && b.shieldHp > 0) { b.shieldHp = 0; b.powerup = null; b.powerupT = 0; sfx.shield(); }
                    else {
                        const f = (aForce - bForce) / bMass * 0.5;
                        b.vx += nx * f; b.vz += nz * f;
                    }
                    emit({ t: 'hitEvt', from: a._id, target: b._id });
                    sfx.hit();
                } else if (bForce > aForce) {
                    if (a.powerup === 'shield' && a.shieldHp > 0) { a.shieldHp = 0; a.powerup = null; a.powerupT = 0; sfx.shield(); }
                    else {
                        const f = (bForce - aForce) / aMass * 0.5;
                        a.vx -= nx * f; a.vz -= nz * f;
                    }
                    emit({ t: 'hitEvt', from: b._id, target: a._id });
                    sfx.hit();
                }
            }
        }
    }

    // Broadcast positions
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const states = [];
        for (const [id, p] of players) {
            states.push([id, p.x, p.z, p.vx, p.vz, p.h, p.dashing ? 1 : 0, p.alive ? 1 : 0]);
        }
        emit({ t: 'sts', a: states });
    }

    // Check round end
    const aliveCount = [...players.values()].filter(p => p.alive).length;
    if (aliveCount <= 1 || H.roundTimer <= 0) {
        let winner = null;
        if (aliveCount === 1) {
            winner = [...players.entries()].find(([, p]) => p.alive);
        } else {
            // Closest to center wins on timeout
            let bestDist = Infinity;
            for (const [id, p] of players) {
                if (!p.alive) continue;
                const d = Math.hypot(p.x, p.z);
                if (d < bestDist) { bestDist = d; winner = [id, p]; }
            }
        }
        if (winner) {
            const hp = H.players.find(p => p.id === winner[0]);
            if (hp) hp.wins++;
        }
        gameActive = false;
        const winnerId = winner ? winner[0] : null;
        const winnerName = winner ? H.players.find(p => p.id === winner[0])?.name : 'Nobody';
        emit({ t: 'roundEnd', winner: winnerId, winnerName, scores: H.players.map(p => ({ id: p.id, name: p.name, wins: p.wins, color: p.color })) });
        sfx.go();

        // Check game end
        const gameWinner = H.players.find(p => p.wins >= Math.ceil(BEST_OF / 2));
        if (gameWinner || H.round >= BEST_OF) {
            setTimeout(() => {
                const sorted = [...H.players].sort((a, b) => b.wins - a.wins);
                emit({ t: 'results', list: sorted.map((p, i) => ({ id: p.id, name: p.name, wins: p.wins, place: i + 1, color: p.color })) });
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
        case 'reject': leave(msg.reason); return;
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
            // Remove old models
            scene.children.filter(c => c._isPlayer || c._isPowerup).forEach(c => scene.remove(c));
            gfx.clearRound();
            updatePlatformSize(msg.platformR);
            shrinkClock = SHRINK_INTERVAL;
            for (const s of msg.spawns) {
                const model = buildPlayerModel(s.color);
                model.position.set(s.x, 0, s.z);
                model.userData.a.yaw = Math.atan2(-s.x, -s.z); // face the centre
                model._isPlayer = true;
                gfx.setMarker(model, s.id === myId);
                scene.add(model);
                const p = { x: s.x, z: s.z, vx: 0, vz: 0, h: 0, alive: true, dashing: false, dashCd: 0, dashT: 0, mass: 1, powerup: null, powerupT: 0, shieldHp: 0, model, bot: s.bot, wins: s.wins, name: s.name, color: s.color, fallT: 0, botThinkT: 0, botTargetX: 0, botTargetZ: 0, _id: s.id };
                players.set(s.id, p);
                if (s.id === myId) me = p;
            }
            $('round-num').textContent = `${msg.round}/${BEST_OF}`;
            showCenterMsg('3', true);
            sfx.count();
            setTimeout(() => { showCenterMsg('2', true); sfx.count(); }, 1000);
            setTimeout(() => { showCenterMsg('1', true); sfx.count(); }, 2000);
            setTimeout(() => { showCenterMsg('GO!', true); }, 3000);
            break;
        }
        case 'go': gameActive = true; shrinkClock = SHRINK_INTERVAL; break;
        case 'sts':
            if (role === 'host') break; // host already has authoritative state
            for (const s of msg.a) {
                const p = players.get(s[0]);
                if (!p || s[0] === myId) continue;
                p.x = s[1]; p.z = s[2]; p.vx = s[3]; p.vz = s[4]; p.h = s[5];
                p.dashing = !!s[6]; p.alive = !!s[7];
            }
            break;
        case 'dashEvt': {
            const p = players.get(msg.id);
            if (p) { p.dashing = true; p.dashT = DASH_DUR; p.vx = msg.dx * DASH_SPEED; p.vz = msg.dz * DASH_SPEED; }
            sfx.dash();
            break;
        }
        case 'fell': {
            const p = players.get(msg.id);
            if (p) { p.alive = false; p.fallT = 1; }
            sfx.fall();
            break;
        }
        case 'shrink':
            updatePlatformSize(msg.r, true);
            shrinkClock = SHRINK_INTERVAL;
            sfx.shrink();
            break;
        case 'powerup': {
            const model = buildPowerupModel(msg.type);
            model.position.set(msg.x, 0, msg.z);
            model._isPowerup = true;
            model._uid = msg.uid;
            scene.add(model);
            break;
        }
        case 'grabbed': {
            const pu = scene.children.find(c => c._isPowerup && c._uid === msg.uid);
            if (pu) { scene.remove(pu); gfx.sparkle(pu.position.x, 1.3, pu.position.z, gfx.puColor(msg.type)); }
            const p = players.get(msg.id);
            if (p) { p.powerup = msg.type; p.powerupT = 5; if (msg.type === 'shield') p.shieldHp = 1; }
            if (p && p.model) gfx.setPowerupVisual(p.model, msg.type);
            sfx.powerup();
            break;
        }
        case 'hitEvt': {
            const a = players.get(msg.from), b = players.get(msg.target);
            const mine = msg.from === myId || msg.target === myId;
            gfx.hit(a && a.model, b && b.model, mine ? 0.4 : 0.15);
            sfx.hit();
            break;
        }
        case 'roundEnd': {
            gameActive = false;
            const w = players.get(msg.winner);
            if (w && w.model && w.alive) gfx.celebrate(w.model);
            showCenterMsg(msg.winnerName + ' wins!', true);
            updateScoreRow(msg.scores);
            break;
        }
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

function updateScoreRow(scores) {
    const row = $('score-row');
    row.innerHTML = '';
    for (const s of scores) {
        const d = document.createElement('span');
        d.className = 'score-dot';
        d.innerHTML = `<i style="background:${s.color}"></i> ${s.wins}`;
        row.appendChild(d);
    }
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (view === 'game' && (e.code === 'Space' || e.code === 'ShiftLeft')) wantDash = true;
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
$('touch-dash').addEventListener('pointerdown', e => { e.preventDefault(); wantDash = true; });

function playerInput() {
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (document.body.classList.contains('touch') && joy.id !== null) {
        ix = joy.x; iz = joy.y;
    }
    return { ix, iz };
}

// ============================================================
// Game loop
// ============================================================
function updateGame(dt) {
    if (!gameActive) return;

    // Host physics always runs (bots, collisions, round logic)
    if (role === 'host') hostUpdate(dt);

    // Player input only when alive
    if (!me || !me.alive) { wantDash = false; return; }

    const { ix, iz } = playerInput();
    const inputLen = Math.hypot(ix, iz);

    // Apply input
    if (inputLen > 0.15) {
        me.vx += (ix / inputLen) * ACCEL * dt;
        me.vz += (iz / inputLen) * ACCEL * dt;
    }

    // Dash
    if (wantDash && me.dashCd <= 0) {
        wantDash = false;
        const dx = inputLen > 0.15 ? ix / inputLen : Math.cos(me.h);
        const dz = inputLen > 0.15 ? iz / inputLen : Math.sin(me.h);
        act({ t: 'dash', dx, dz });
        if (role !== 'host') {
            me.dashing = true; me.dashT = DASH_DUR; me.dashCd = DASH_CD;
            me.vx = dx * DASH_SPEED; me.vz = dz * DASH_SPEED;
        }
    }
    wantDash = false;

    // Local physics (client-side prediction)
    if (role !== 'host') {
        if (me.dashT > 0) { me.dashT -= dt; if (me.dashT <= 0) me.dashing = false; }
        if (me.dashCd > 0) me.dashCd -= dt;
        if (!me.dashing) {
            const spd = Math.hypot(me.vx, me.vz);
            const maxSpd = MOVE_SPEED * (me.powerup === 'speed' ? 1.5 : 1);
            if (spd > maxSpd) { me.vx *= maxSpd / spd; me.vz *= maxSpd / spd; }
            if (spd > 0.1) { const f = FRICTION * dt; const ns = Math.max(0, spd - f); me.vx *= ns / spd; me.vz *= ns / spd; }
        }
        me.x += me.vx * dt; me.z += me.vz * dt;
        if (Math.hypot(me.vx, me.vz) > 0.5) me.h = Math.atan2(me.vz, me.vx);
        if (me.powerupT > 0) { me.powerupT -= dt; if (me.powerupT <= 0) me.powerup = null; }
    }

    // Send position
    sendTimer -= dt;
    if (sendTimer <= 0 && role === 'client') {
        sendTimer = SEND_EVERY;
        act({ t: 'st', s: [myId, me.x, me.z, me.vx, me.vz, me.h, me.dashing ? 1 : 0] });
    }
}

function render(dt) {
    // Update models
    for (const [id, p] of players) {
        const m = p.model;
        if (!m) continue;
        if (p.alive) {
            m.position.x += (p.x - m.position.x) * Math.min(1, dt * 15);
            m.position.z += (p.z - m.position.z) * Math.min(1, dt * 15);
            const d = Math.hypot(m.position.x, m.position.z);
            m.position.y = gfx.edgeLift(d);
            gfx.animateWrestler(m, { speed: Math.hypot(p.vx, p.vz), dashing: p.dashing, yaw: -p.h + Math.PI / 2, edge: gfx.edgeTeeter(d) }, dt);
        } else {
            gfx.startFall(m, p.vx, p.vz);
            gfx.updateFall(m, dt);
        }
    }

    for (const c of scene.children) if (c._isPowerup) gfx.animatePowerup(c, dt);

    // Warning glow over the band that the next shrink will remove
    if (gameActive) shrinkClock -= dt;
    const warn = gameActive && platformR > MIN_PLATFORM_R && shrinkClock < 3 ? 1 - Math.max(0, shrinkClock) / 3 : 0;
    gfx.setDanger(warn, Math.max(MIN_PLATFORM_R, platformR - SHRINK_AMT));

    gfx.update(dt);

    // Camera: follow me while alive, drift back to an overview when out
    const follow = me && me.alive;
    const tx = follow ? me.x * 0.3 : 0, tz = follow ? me.z * 0.3 : 0;
    const k = Math.min(1, dt * (follow ? 3 : 1.2));
    // Pull back on narrow (portrait) screens so the ring still fits
    const far = Math.pow(clamp(1.3 / camera.aspect, 1, 2.2), 0.75);
    camBase.x += (tx - camBase.x) * k;
    camBase.z += (tz + 18 * far - camBase.z) * k;
    camBase.y = 28 * far;
    camLook.x += (tx - camLook.x) * k;
    camLook.z += (tz - camLook.z) * k;
    camera.position.copy(camBase).add(gfx.getShake());
    camera.lookAt(camLook);

    // HUD
    const aliveCount = [...players.values()].filter(p => p.alive).length;
    $('alive-count').textContent = `${aliveCount} alive`;

    // Dash cooldown ring
    if (me) {
        const cdFrac = me.dashCd > 0 ? me.dashCd / DASH_CD : 0;
        $('cd-ring').style.strokeDashoffset = (cdFrac * 138.2).toFixed(1);
    }

    // Power-up HUD
    if (me && me.powerup) {
        $('powerup-hud').classList.remove('hidden');
        const icons = { speed: 'SPEED', heavy: 'HEAVY', shield: 'SHIELD' };
        $('powerup-icon').textContent = icons[me.powerup] || '';
        $('powerup-fill').style.width = `${(me.powerupT / 5) * 100}%`;
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
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span>${p.id === myId ? '<span class="badge host">You</span>' : ''}${p.ready ? '<span class="badge ok">Ready</span>' : ''}${role === 'host' && p.id !== myId && H.phase === 'lobby' ? `<button class="kick" type="button" data-kick="${esc(p.id)}">Remove</button>` : ''}`;
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
        li.innerHTML = `<span class="place">${p.place}</span><span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span><span class="score">${p.wins} wins</span>`;
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
    try { localStorage.setItem('sumoName', myName); } catch {}
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
    try { localStorage.setItem('sumoName', myName); } catch {}
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
    try { localStorage.setItem('sumoName', myName); } catch {}
    role = 'host'; document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 3; i++) addBot();
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
$('players').addEventListener('click', e => {
    const id = e.target && e.target.dataset ? e.target.dataset.kick : null;
    if (!id) return;
    const p = H.players.find(x => x.id === id);
    if (p && (p.bot || confirm(`Remove ${p.name} from the room?`))) kickPlayer(id);
});
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
$('btn-ready').addEventListener('click', () => { const p = players.get(myId); act({ t: 'ready', r: true }); });
$('btn-start').addEventListener('click', () => hostStartGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    for (const p of H.players) { p.ready = p.bot; p.wins = 0; }
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
    else { gfx.update(dt); renderer.render(scene, camera); }
    requestAnimationFrame(frame);
}

$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `Invited to room ${invite}.`; $('invite').classList.remove('hidden'); }

show('menu');
playMusic('menu');
requestAnimationFrame(frame);
