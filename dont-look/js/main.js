// Don't Look — horror multiplayer game
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=2';
import { sfx, unlockAudio, setMuted, isMuted, tickAudio,
         startHeartbeat, stopHeartbeat, setHeartbeatRate,
         startMonsterRumble, stopMonsterRumble } from './audio.js?v=2';
import { play as playMusic, stop as stopMusic, setTension } from './music.js?v=2';
import * as gfx from './gfx.js?v=3';

const track = (name, p) => { if (window.track) window.track(name, p); };
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_PLAYERS   = 8;
const MOVE_SPEED    = 5.5;
const ACCEL         = 18;
const FRICTION      = 14;
const PLAYER_R      = 0.3;
const PLAYER_HEIGHT = 1.7;
const RITUAL_R      = 1.8;    // radius to start ritual
const RITUAL_TIME   = 3.0;    // seconds to complete ritual
const EXIT_R        = 2.0;
const MONSTER_R     = 1.5;    // catch radius
const SEND_EVERY    = 0.05;
const MONSTER_BASE_SPEED = 2.0;
const BATTERY_DRAIN = 0.007;
const BATTERY_REGEN = 0.012;
const COLORS = ['#e0584f','#3b82f6','#2ec495','#f2c14e','#a78bfa','#f97316','#ec4899','#e2e8f0'];
const BOT_NAMES = ['The Brave','Shadow One','Last Hope','Echo','Phantom','Wraith','Cipher','Nomad'];

// ── State ──────────────────────────────────────────────────────────────────
let myName = (() => { try { return localStorage.getItem('dlName') || ''; } catch { return ''; } })();
let role = null, net = null, myId = null, roomCode = '', view = 'menu';
let gameActive = false, sendTimer = 0;

const players  = new Map(); // id → { x, z, yaw, alive, escaped, fear, vx, vz, bot, name, color, model }
let me = null;

// Monster shared state (clients receive from host)
const monster = { x: 0, z: 0, yaw: 0, frozen: true, speed: MONSTER_BASE_SPEED };

// Rituals
const ritualsDone = [false, false, false];
let ritualsComplete = 0;
let exitUnlocked = false;

// My ritual progress
let myRitualT   = 0;      // 0–RITUAL_TIME
let myRitualIdx = -1;     // which ritual I'm activating
let nearRitual  = -1;     // which ritual I'm standing near
let nearExit    = false;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    monster: { x: 0, z: 0, yaw: 0, frozen: true },
    ritualsComplete: 0,
    ritualsDone: [false, false, false],
    monsterSendTimer: 0,
};

// FPS input state
let vx = 0, vz = 0;
let battery = 1.0;
let fear = 0;
let lastStepT = 0;
let stepClock = 0;

// ── Utilities ──────────────────────────────────────────────────────────────
function show(id) {
    for (const s of ['menu','lobby','results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
}
function toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500);
}
function setStatus(el, msg, err = false) { const s = $(el); s.textContent = msg; s.classList.toggle('error', err); }
function showCenter(text, duration = 2000) {
    const el = $('center-msg');
    el.textContent = text; el.classList.add('show');
    setTimeout(() => { if (el.textContent === text) el.classList.remove('show'); }, duration);
}

// ── Networking helpers ─────────────────────────────────────────────────────
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

// ── Line of Sight ──────────────────────────────────────────────────────────
function segAABB(ax, az, bx, bz, wall) {
    // Simple AABB vs line segment check
    const { minX, maxX, minZ, maxZ } = wall;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const hx = Math.abs(bx - ax) / 2, hz = Math.abs(bz - az) / 2;
    const wx = (maxX - minX) / 2, wz = (maxZ - minZ) / 2;
    const ex = cx - (minX + maxX) / 2, ez = cz - (minZ + maxZ) / 2;
    if (Math.abs(ex) > wx + hx + 0.1 || Math.abs(ez) > wz + hz + 0.1) return false;
    // Separating axis test (approximate)
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return false;
    // Project AABB onto ray direction
    const rLen = Math.abs(dx / len * wx) + Math.abs(dz / len * wz);
    const proj = (ex * dx / len) + (ez * dz / len);
    return Math.abs(proj) < rLen + hx * Math.abs(dx / len) + hz * Math.abs(dz / len);
}

function hasLOS(ax, az, bx, bz) {
    for (const w of gfx.getWalls()) {
        if (segAABB(ax, az, bx, bz, w)) return false;
    }
    return true;
}

// ── "Looking" check ────────────────────────────────────────────────────────
function amLookingAtMonster() {
    if (!me || !me.alive) return false;
    const mx = monster.x - me.x, mz = monster.z - me.z;
    const dist = Math.hypot(mx, mz);
    if (dist > 24) return false;
    // Camera forward (yaw only)
    const fwdX = -Math.sin(gfx.camState.yaw), fwdZ = -Math.cos(gfx.camState.yaw);
    const dot = (mx / dist) * fwdX + (mz / dist) * fwdZ;
    if (dot < 0.6) return false; // within ~53° arc
    return hasLOS(me.x, me.z, monster.x, monster.z);
}

// ── Host logic ─────────────────────────────────────────────────────────────
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            H.players.push({ id: from, name: msg.name || 'Player', color, ready: false, bot: false });
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
                p.x = msg.x; p.z = msg.z; p.yaw = msg.yaw; p.looking = msg.looking;
            }
            break;
        }
        case 'ritual': {
            if (!gameActive) return;
            const idx = msg.idx;
            if (idx < 0 || idx > 2 || H.ritualsDone[idx]) return;
            H.ritualsDone[idx] = true;
            H.ritualsComplete++;
            // Speed up monster per ritual
            H.monster.speed = MONSTER_BASE_SPEED * (1 + H.ritualsComplete * 0.28);
            emit({ t: 'ritualDone', idx });
            if (H.ritualsComplete >= 3) {
                emit({ t: 'allRitualsDone' });
            }
            sfx.ritual();
            break;
        }
        case 'escape': {
            if (!gameActive) return;
            const p = players.get(from);
            if (!p || !p.alive || p.escaped) return;
            if (!exitUnlocked) return;
            p.escaped = true; p.alive = false;
            emit({ t: 'escaped', id: from });
            hostCheckEnd();
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
    else { const p = players.get(id); if (p && p.model) gfx.removePlayerModel(id); players.delete(id); }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot })) });
}

function kickPlayer(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || idx < 0 || id === myId) return;
    const p = H.players[idx];
    if (p.bot) { H.players.splice(idx, 1); emitLobby(); return; }
    if (!net) return;
    net.send(id, { t: 'reject', reason: 'The host removed you.' });
    setTimeout(() => net && net.kick(id), 600);
    hostLeave(id);
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    H.players.push({ id: botId, name, color: COLORS[H.players.length % COLORS.length], ready: true, bot: true });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 1) { setStatus('lobby-status', 'Need at least 1 player.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }

    H.phase = 'game';
    H.ritualsDone = [false, false, false];
    H.ritualsComplete = 0;
    H.monster = { x: gfx.MONSTER_SPAWN.x, z: gfx.MONSTER_SPAWN.z, yaw: 0, frozen: true, speed: MONSTER_BASE_SPEED };

    const spawns = H.players.map((p, i) => {
        const s = gfx.START_SPAWNS[i % gfx.START_SPAWNS.length];
        return { id: p.id, name: p.name, color: p.color, bot: p.bot, x: s.x, z: s.z };
    });

    emit({
        t: 'roundStart',
        spawns,
        monsterSpawn: gfx.MONSTER_SPAWN,
        ritualPositions: gfx.RITUAL_POSITIONS,
        exitPos: gfx.EXIT_POS,
    });

    setTimeout(() => emit({ t: 'go' }), 3500);
}

function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    // Determine if monster is frozen: any alive human looking at it
    const alivePlayers = [...players.values()].filter(p => p.alive && !p.escaped);
    let anyLooking = false;

    if (role === 'host' && me && me.alive) {
        if (amLookingAtMonster()) anyLooking = true;
    }
    for (const [id, p] of players) {
        if (id === myId) continue;
        if (p.alive && !p.escaped && p.looking) { anyLooking = true; break; }
    }

    const wasFrozen = H.monster.frozen;
    H.monster.frozen = anyLooking;

    if (!wasFrozen && anyLooking) {
        emit({ t: 'monsterFreeze', frozen: true });
        sfx.monsterFreeze();
    } else if (wasFrozen && !anyLooking) {
        emit({ t: 'monsterFreeze', frozen: false });
        startMonsterRumble();
    }

    // Move monster
    if (!H.monster.frozen && alivePlayers.length > 0) {
        // Find nearest alive player
        let nearest = null, nearestDist = Infinity;
        for (const p of alivePlayers) {
            const d = Math.hypot(p.x - H.monster.x, p.z - H.monster.z);
            if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        if (nearest) {
            const dx = nearest.x - H.monster.x, dz = nearest.z - H.monster.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.5) {
                const spd = H.monster.speed;
                H.monster.x += (dx / dist) * spd * dt;
                H.monster.z += (dz / dist) * spd * dt;
                H.monster.yaw = Math.atan2(-dx, -dz);
            }

            // Catch check
            for (const p of alivePlayers) {
                const d = Math.hypot(p.x - H.monster.x, p.z - H.monster.z);
                if (d < MONSTER_R) {
                    p.alive = false;
                    emit({ t: 'caught', id: p.id });
                    sfx.caught();
                    hostCheckEnd();
                }
            }
        }
    }

    // Broadcast monster position
    H.monsterSendTimer -= dt;
    if (H.monsterSendTimer <= 0) {
        H.monsterSendTimer = SEND_EVERY;
        emit({ t: 'monsterPos', x: H.monster.x, z: H.monster.z, yaw: H.monster.yaw, frozen: H.monster.frozen });
    }

    // Bot AI
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        p.botThinkT = (p.botThinkT || 0) - dt;
        if (p.botThinkT > 0) continue;
        p.botThinkT = 0.5 + Math.random() * 0.8;

        const distToMonster = Math.hypot(p.x - H.monster.x, p.z - H.monster.z);
        // Bot logic: if monster is close and not frozen, flee; else go toward uncompleted ritual
        if (distToMonster < 8 && !H.monster.frozen) {
            // Flee from monster
            const fx = p.x - H.monster.x, fz = p.z - H.monster.z;
            const fl = Math.hypot(fx, fz);
            p.botTargetX = p.x + (fx / fl) * 6;
            p.botTargetZ = p.z + (fz / fl) * 6;
        } else {
            // Go toward nearest incomplete ritual
            let bestRitual = null, bestDist = Infinity;
            for (let i = 0; i < 3; i++) {
                if (H.ritualsDone[i]) continue;
                const rp = gfx.RITUAL_POSITIONS[i];
                const d = Math.hypot(rp.x - p.x, rp.z - p.z);
                if (d < bestDist) { bestDist = d; bestRitual = rp; }
            }
            if (bestRitual) {
                p.botTargetX = bestRitual.x; p.botTargetZ = bestRitual.z;
            } else if (exitUnlocked) {
                p.botTargetX = gfx.EXIT_POS.x; p.botTargetZ = gfx.EXIT_POS.z;
                if (Math.hypot(gfx.EXIT_POS.x - p.x, gfx.EXIT_POS.z - p.z) < EXIT_R) {
                    hostHandle(id, { t: 'escape' });
                }
            }
        }
    }

    // Bot movement physics
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        const tx = (p.botTargetX || 0) - p.x;
        const tz = (p.botTargetZ || 0) - p.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 0.5) {
            p.vx = (p.vx || 0) + (tx / tl) * ACCEL * dt;
            p.vz = (p.vz || 0) + (tz / tl) * ACCEL * dt;
        }
        // Friction
        const spd = Math.hypot(p.vx || 0, p.vz || 0);
        if (spd > MOVE_SPEED) { p.vx *= MOVE_SPEED / spd; p.vz *= MOVE_SPEED / spd; }
        if (spd > 0.1) {
            const f = FRICTION * dt; const ns = Math.max(0, spd - f);
            p.vx *= ns / spd; p.vz *= ns / spd;
        }
        p.x += (p.vx || 0) * dt; p.z += (p.vz || 0) * dt;
    }

    // Bot ritual progress — accumulate dt, complete after RITUAL_TIME seconds
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        let atRitual = false;
        for (let i = 0; i < 3; i++) {
            if (H.ritualsDone[i]) continue;
            const rp = gfx.RITUAL_POSITIONS[i];
            if (Math.hypot(rp.x - p.x, rp.z - p.z) < RITUAL_R) {
                atRitual = true;
                p.botRitualT = (p.botRitualT || 0) + dt;
                if (p.botRitualT >= RITUAL_TIME) {
                    p.botRitualT = 0;
                    hostHandle(id, { t: 'ritual', idx: i });
                }
                break;
            }
        }
        if (!atRitual) p.botRitualT = 0;
    }

    // Broadcast player positions
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const states = [];
        for (const [id, p] of players) states.push([id, p.x, p.z, p.yaw, p.alive ? 1 : 0]);
        emit({ t: 'sts', a: states });
    }
}

function hostCheckEnd() {
    const alivePlayers = [...players.values()].filter(p => p.alive && !p.escaped);
    const escapedPlayers = [...players.values()].filter(p => p.escaped);
    const allGone = alivePlayers.length === 0;

    if (!allGone) return;

    gameActive = false;
    const survivors = escapedPlayers.map(p => ({ id: p.id, name: p.name, color: p.color }));
    const caught = [...players.values()].filter(p => !p.escaped).map(p => ({ id: p.id, name: p.name, color: p.color }));
    emit({ t: 'roundEnd', survivors, caught });

    setTimeout(() => {
        const list = [...escapedPlayers, ...caught].map((p, i) => ({
            id: p.id, name: p.name, color: p.color, escaped: !!p.escaped, place: i + 1,
        }));
        emit({ t: 'results', list });
    }, 4000);
}

// ── Client logic ───────────────────────────────────────────────────────────
function clientHandle(msg) {
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; break;
        case 'reject': leave(msg.reason); return;
        case 'lobby': renderLobby(msg.players); break;
        case 'roundStart': {
            gameActive = false;
            players.clear();
            gfx.clearLevel();
            gfx.buildLevel();
            gfx.clearPlayerModels();
            ritualsDone.fill(false); ritualsComplete = 0; exitUnlocked = false;
            myRitualT = 0; myRitualIdx = -1;

            // Spawn players
            for (const s of msg.spawns) {
                const model = (s.id !== myId) ? gfx.addPlayerModel(s.id, s.color) : null;
                const p = { x: s.x, z: s.z, yaw: 0, alive: true, escaped: false, fear: 0,
                            vx: 0, vz: 0, bot: s.bot, name: s.name, color: s.color, model,
                            botTargetX: 0, botTargetZ: 0, botThinkT: 0, looking: false };
                players.set(s.id, p);
                if (s.id === myId) {
                    me = p;
                    gfx.camState.x = s.x; gfx.camState.z = s.z;
                    gfx.camState.yaw = 0; gfx.camState.pitch = 0;
                    vx = 0; vz = 0; battery = 1.0; fear = 0;
                }
            }

            // Monster
            monster.x = msg.monsterSpawn.x; monster.z = msg.monsterSpawn.z;
            monster.yaw = 0; monster.frozen = true;
            H.monster = { ...monster, speed: MONSTER_BASE_SPEED };
            gfx.setMonsterState(monster.x, monster.z, monster.yaw, true);

            show('hud');
            view = 'game';
            playMusic('game');
            startHeartbeat();

            $('ri-0').classList.remove('done','active');
            $('ri-1').classList.remove('done','active');
            $('ri-2').classList.remove('done','active');
            updatePlayersHud();

            showCenter('3'); sfx.count();
            setTimeout(() => { showCenter('2'); sfx.count(); }, 1000);
            setTimeout(() => { showCenter('1'); sfx.count(); }, 2000);
            setTimeout(() => { showCenter('GO!'); }, 3000);
            break;
        }
        case 'go': gameActive = true; requestPointerLock(); break;
        case 'sts':
            if (role === 'host') break;
            for (const s of msg.a) {
                const p = players.get(s[0]);
                if (!p || s[0] === myId) continue;
                p.x = s[1]; p.z = s[2]; p.yaw = s[3]; p.alive = !!s[4];
                if (p.model) gfx.setPlayerPos(s[0], s[1], s[2], s[3]);
            }
            break;
        case 'monsterPos':
            if (role === 'host') break;
            monster.x = msg.x; monster.z = msg.z; monster.yaw = msg.yaw; monster.frozen = msg.frozen;
            gfx.setMonsterState(monster.x, monster.z, monster.yaw, monster.frozen);
            break;
        case 'monsterFreeze':
            monster.frozen = msg.frozen;
            if (msg.frozen) { stopMonsterRumble(); sfx.monsterFreeze(); }
            else { startMonsterRumble(); }
            break;
        case 'ritualDone': {
            const idx = msg.idx;
            ritualsDone[idx] = true; ritualsComplete++;
            gfx.setRitualDone(idx);
            $('ri-' + idx).classList.add('done');
            toast(`Ritual ${idx + 1} complete!`);
            setTension(ritualsComplete / 3);
            break;
        }
        case 'allRitualsDone':
            exitUnlocked = true;
            gfx.unlockExit();
            showCenter('Exit is open! RUN!', 3000);
            toast('The exit is open!');
            sfx.allRituals();
            break;
        case 'caught': {
            const p = players.get(msg.id);
            if (p) { p.alive = false; if (p.model) gfx.removePlayerModel(msg.id); }
            if (msg.id === myId) {
                me.alive = false;
                showCenter('YOU WERE CAUGHT', 4000);
                gfx.applyShake(3);
                stopHeartbeat();
                document.exitPointerLock && document.exitPointerLock();
            } else {
                const n = p ? p.name : 'A player';
                toast(`${n} was caught!`);
                gfx.applyShake(1);
            }
            sfx.caught();
            updatePlayersHud();
            break;
        }
        case 'escaped': {
            const p = players.get(msg.id);
            if (p) { p.escaped = true; p.alive = false; if (p.model) gfx.removePlayerModel(msg.id); }
            if (msg.id === myId) {
                me.escaped = true;
                showCenter('YOU ESCAPED!', 4000);
                stopHeartbeat();
                document.exitPointerLock && document.exitPointerLock();
                sfx.escape();
            } else {
                toast(`${p ? p.name : 'Someone'} escaped!`);
            }
            updatePlayersHud();
            break;
        }
        case 'roundEnd':
            gameActive = false;
            stopMonsterRumble();
            stopHeartbeat();
            break;
        case 'results': showResults(msg.list); break;
        case 'toLobby':
            view = 'lobby'; show('lobby');
            gfx.clearLevel(); gfx.clearPlayerModels(); gfx.hideMonster();
            players.clear(); me = null;
            playMusic('menu');
            stopHeartbeat(); stopMonsterRumble();
            break;
    }
}

// ── HUD ────────────────────────────────────────────────────────────────────
function updatePlayersHud() {
    const hud = $('players-hud');
    hud.innerHTML = '';
    for (const [, p] of players) {
        if (p.id === myId) continue;
        const div = document.createElement('div');
        div.className = 'phud-item' + (p.escaped ? ' escaped' : p.alive ? '' : ' caught');
        div.innerHTML = `<span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span>`;
        hud.appendChild(div);
    }
}

function renderLobby(plist) {
    $('room-code').textContent = roomCode;
    $('count').textContent = `${plist.length}/${MAX_PLAYERS}`;
    const list = $('players');
    list.innerHTML = '';
    for (const p of plist) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span>${p.id === myId ? '<span class="badge host">You</span>' : ''}${p.ready ? '<span class="badge ok">Ready</span>' : ''}${role === 'host' && p.id !== myId ? `<button class="kick" type="button" data-kick="${esc(p.id)}">Remove</button>` : ''}`;
        list.appendChild(li);
    }
}

function showResults(list) {
    track('match_end');
    view = 'results'; show('results');
    gfx.clearLevel(); gfx.clearPlayerModels();
    players.clear(); me = null;
    playMusic('menu');
    gfx.buildLevel();
    gfx.setMonsterState(8, 0, 0, true);
    stopHeartbeat(); stopMonsterRumble();
    gameActive = false;

    const escaped = list.filter(p => p.escaped);
    const caught = list.filter(p => !p.escaped);
    $('results-title').textContent = escaped.some(p => p.id === myId) ? 'You Escaped!' :
                                     escaped.length > 0 ? `${escaped.length} Survived` : 'Nobody Escaped';
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of [...escaped, ...caught]) {
        const li = document.createElement('li');
        li.className = p.id === myId ? 'me' : '';
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span><span style="margin-left:auto;font-size:0.85rem;color:${p.escaped ? '#22c55e' : '#ef4444'}">${p.escaped ? 'Escaped' : 'Caught'}</span>`;
        ol.appendChild(li);
    }
}

// ── Pointer Lock ───────────────────────────────────────────────────────────
function requestPointerLock() {
    if (document.body.classList.contains('touch')) return;
    $('lock-prompt').classList.remove('hidden');
}

document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === document.getElementById('c') ||
                   document.pointerLockElement === document.body;
    $('lock-prompt').classList.toggle('hidden', locked);
});
$('lock-prompt').addEventListener('click', () => {
    document.getElementById('c').requestPointerLock();
});

// ── Input ──────────────────────────────────────────────────────────────────
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    // Interact
    if (e.code === 'KeyE' && view === 'game' && me && me.alive && nearRitual >= 0 && myRitualIdx < 0) {
        startRitual(nearRitual);
    }
    // Escape key exits pointer lock
});
addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse look
let mouseDx = 0, mouseDy = 0;
addEventListener('mousemove', e => {
    if (!document.pointerLockElement) return;
    mouseDx += e.movementX; mouseDy += e.movementY;
});

// Touch joysticks
const JOY_R = 50;
const joyL = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const joyR = { id: null, ox: 0, oy: 0, x: 0, y: 0 };

const cvs = document.getElementById('c');
cvs.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    e.preventDefault();
    if (view !== 'game' || !gameActive) return;
    if (e.clientX < innerWidth / 2) {
        if (joyL.id !== null) return;
        joyL.id = e.pointerId; joyL.ox = e.clientX; joyL.oy = e.clientY;
        const j = $('joy-left'); j.style.left = `${e.clientX - 50}px`; j.style.top = `${e.clientY - 50}px`;
    } else {
        if (joyR.id !== null) return;
        joyR.id = e.pointerId; joyR.ox = e.clientX; joyR.oy = e.clientY;
    }
});
cvs.addEventListener('pointermove', e => {
    if (joyL.id === e.pointerId) {
        let dx = e.clientX - joyL.ox, dy = e.clientY - joyL.oy;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
        joyL.x = dx / JOY_R; joyL.y = dy / JOY_R;
        $('joy-left-knob').style.transform = `translate(${dx}px, ${dy}px)`;
    }
    if (joyR.id === e.pointerId) {
        mouseDx += (e.clientX - joyR.ox) * 2.5;
        mouseDy += (e.clientY - joyR.oy) * 1.8;
        joyR.ox = e.clientX; joyR.oy = e.clientY;
    }
});
const endTouch = e => {
    if (e.pointerId === joyL.id) { joyL.id = null; joyL.x = joyL.y = 0; $('joy-left-knob').style.transform = ''; }
    if (e.pointerId === joyR.id) { joyR.id = null; }
};
cvs.addEventListener('pointerup', endTouch);
cvs.addEventListener('pointercancel', endTouch);
$('touch-interact').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (nearRitual >= 0 && myRitualIdx < 0 && me && me.alive) startRitual(nearRitual);
});

// ── Ritual interaction ─────────────────────────────────────────────────────
function startRitual(idx) {
    myRitualIdx = idx;
    myRitualT = 0;
    $('ritual-progress-wrap').classList.remove('hidden');
    $('interact-prompt').classList.add('hidden');
    $('ri-' + idx).classList.add('active');
}

function cancelRitual() {
    if (myRitualIdx < 0) return;
    $('ri-' + myRitualIdx).classList.remove('active');
    myRitualIdx = -1; myRitualT = 0;
    $('ritual-progress-wrap').classList.add('hidden');
}

// ── Game update ────────────────────────────────────────────────────────────
function updateGame(dt) {
    if (!gameActive) return;
    if (role === 'host') hostUpdate(dt);
    if (!me || !me.alive) return;

    // Mouse look
    const SENS = 0.0018;
    gfx.camState.yaw   -= mouseDx * SENS;
    gfx.camState.pitch  = clamp(gfx.camState.pitch - mouseDy * SENS, -Math.PI * 0.44, Math.PI * 0.44);
    mouseDx = mouseDy = 0;

    // Movement input
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown  ? 1 : 0) - (keys.KeyW || keys.ArrowUp   ? 1 : 0);
    if (joyL.id !== null) { ix = joyL.x; iz = joyL.y; }

    const inputLen = Math.hypot(ix, iz);
    const yaw = gfx.camState.yaw;

    // Rotate input by yaw (FPS strafe)
    const worldIx = ix * Math.cos(-yaw) - iz * Math.sin(-yaw);
    const worldIz = ix * Math.sin(-yaw) + iz * Math.cos(-yaw);

    if (inputLen > 0.12) {
        vx += worldIx * ACCEL * dt;
        vz += worldIz * ACCEL * dt;
    }

    // Friction
    const spd = Math.hypot(vx, vz);
    const maxSpd = MOVE_SPEED;
    if (spd > maxSpd) { vx *= maxSpd / spd; vz *= maxSpd / spd; }
    if (spd > 0.05) { const f = FRICTION * dt; const ns = Math.max(0, spd - f); vx *= ns / spd; vz *= ns / spd; }

    // Move (wall collision)
    const nx = me.x + vx * dt, nz = me.z + vz * dt;
    if (!collidesWall(nx, me.z)) me.x = nx;
    else vx = 0;
    if (!collidesWall(me.x, nz)) me.z = nz;
    else vz = 0;

    me.yaw = yaw;
    gfx.camState.x = me.x;
    gfx.camState.z = me.z;
    gfx.camState.moving = inputLen > 0.12;

    // Footstep sound
    stepClock += Math.hypot(vx, vz) * dt;
    if (stepClock > 2.2) { stepClock = 0; sfx.step(); }

    // Battery
    battery = clamp(battery - BATTERY_DRAIN * dt, 0, 1);
    // Slight regen when standing still
    if (inputLen < 0.1 && battery < 1) battery = clamp(battery + BATTERY_REGEN * dt, 0, 1);
    gfx.setBatteryLevel(battery);
    $('battery-bar').style.width = `${battery * 100}%`;
    $('battery-bar').style.background = battery > 0.3 ? '#c8a84b' : '#ef4444';

    // Looking at monster
    const looking = amLookingAtMonster();
    $('eye-icon').classList.toggle('looking', looking);
    $('eye-label').textContent = looking ? 'WATCHING' : 'LOOKING AWAY';

    // Fear
    const distToMonster = Math.hypot(me.x - monster.x, me.z - monster.z);
    const targetFear = monster.frozen ? Math.max(0, 1 - distToMonster / 18) :
                                        Math.max(0.3, 1 - distToMonster / 12);
    fear += (targetFear - fear) * dt * (targetFear > fear ? 2 : 0.8);
    fear = clamp(fear, 0, 1);
    $('fear-bar').style.width = `${fear * 100}%`;
    setHeartbeatRate(fear);
    setTension(fear * 0.6 + ritualsComplete * 0.13);

    // Vignette intensity from fear
    $('vignette').style.opacity = 0.55 + fear * 0.3;

    // Static near monster
    if (distToMonster < 5 && !monster.frozen) {
        drawStatic(Math.max(0, (5 - distToMonster) / 5));
    } else {
        $('static-overlay').style.opacity = 0;
    }

    // Proximity shake
    if (distToMonster < 3 && !monster.frozen) gfx.applyShake(0.8);

    // Ritual proximity check
    nearRitual = -1;
    for (let i = 0; i < 3; i++) {
        if (ritualsDone[i]) continue;
        const rp = gfx.RITUAL_POSITIONS[i];
        if (Math.hypot(me.x - rp.x, me.z - rp.z) < RITUAL_R) { nearRitual = i; break; }
    }

    // Show/hide interact prompt
    if (nearRitual >= 0 && myRitualIdx < 0) {
        $('interact-prompt').classList.remove('hidden');
        $('touch-interact').classList.remove('hidden');
    } else {
        $('interact-prompt').classList.add('hidden');
        if (!document.body.classList.contains('touch')) $('touch-interact').classList.add('hidden');
    }

    // Ritual progress
    if (myRitualIdx >= 0) {
        // Cancel if monster too close
        if (distToMonster < 5 && !monster.frozen) {
            cancelRitual();
        } else if (!keys.KeyE && joyL.id === null) {
            // Must hold E (keyboard) or button pressed
        } else {
            myRitualT += dt;
            $('ritual-progress-bar').style.width = `${(myRitualT / RITUAL_TIME) * 100}%`;
            if (myRitualT >= RITUAL_TIME) {
                const idx = myRitualIdx;
                cancelRitual();
                act({ t: 'ritual', idx });
            }
        }
    }

    // Exit check
    if (exitUnlocked) {
        const de = Math.hypot(me.x - gfx.EXIT_POS.x, me.z - gfx.EXIT_POS.z);
        if (de < EXIT_R) act({ t: 'escape' });
    }

    // Send position
    sendTimer -= dt;
    if (sendTimer <= 0 && role === 'client') {
        sendTimer = SEND_EVERY;
        act({ t: 'st', x: me.x, z: me.z, yaw: me.yaw, looking: amLookingAtMonster() });
    }

    // Update audio
    tickAudio(dt);
}

// ── Wall collision ─────────────────────────────────────────────────────────
function collidesWall(x, z) {
    for (const w of gfx.getWalls()) {
        if (x - PLAYER_R < w.maxX && x + PLAYER_R > w.minX &&
            z - PLAYER_R < w.maxZ && z + PLAYER_R > w.minZ) return true;
    }
    return false;
}

// ── Static effect ──────────────────────────────────────────────────────────
let staticCtx = null;
function drawStatic(intensity) {
    const cv = $('static-overlay');
    if (!staticCtx) { staticCtx = cv.getContext('2d'); cv.width = 320; cv.height = 180; }
    const img = staticCtx.createImageData(320, 180);
    for (let i = 0; i < img.data.length; i += 4) {
        if (Math.random() < intensity * 0.3) {
            const v = Math.random() < 0.5 ? 255 : 0;
            img.data[i] = img.data[i+1] = img.data[i+2] = v;
            img.data[i+3] = Math.random() * 200 * intensity;
        }
    }
    staticCtx.putImageData(img, 0, 0);
    cv.style.opacity = intensity * 0.45;
}

// ── Main loop ──────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (view === 'game' || gameActive) {
        updateGame(dt);
        gfx.update(dt, gameActive);
        gfx.updateCamera(dt);
    } else {
        gfx.updateMenuCamera(now / 1000);
        gfx.update(dt, false);
    }
    gfx.render();
    requestAnimationFrame(frame);
}

// ── Room management ────────────────────────────────────────────────────────
async function createRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dlName', myName); } catch {}
    setStatus('menu-status', 'Creating room…');
    roomCode = makeCode();
    role = 'host'; document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try { await hn.open(roomCode); } catch(e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return createRoom(); }
        setStatus('menu-status', e.message, true); role = null; document.body.classList.remove('is-host'); return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    track('room_create');
    enterLobby();
}

async function joinRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dlName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining…');
    role = 'client'; document.body.classList.remove('is-host');
    const cn = new ClientNet({ onMessage: clientHandle, onClose: () => leave('Lost connection.'), onStatus: msg => setStatus('menu-status', msg),
                               forceRelay: new URLSearchParams(location.search).get('net') === 'relay' });
    try { myId = await cn.connect(code); } catch(e) { setStatus('menu-status', e.message, true); role = null; return; }
    net = cn; roomCode = code;
    cn.send({ t: 'hello', name: myName });
    track('room_join');
    enterLobby();
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dlName', myName); } catch {}
    role = 'host'; document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 2; i++) addBot();
    track('play_solo');
    enterLobby();
}

function enterLobby() { view = 'lobby'; show('lobby'); playMusic('menu'); setStatus('menu-status', ''); }

function leave(reason) {
    const n = net; net = null; if (n) n.close();
    role = null; myId = null; roomCode = ''; gameActive = false;
    H.players = []; H.phase = 'lobby';
    gfx.clearLevel(); gfx.clearPlayerModels(); gfx.hideMonster();
    players.clear(); me = null;
    stopHeartbeat(); stopMonsterRumble();
    document.exitPointerLock && document.exitPointerLock();
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

// ── Event listeners ────────────────────────────────────────────────────────
$('players').addEventListener('click', e => {
    const id = e.target && e.target.dataset ? e.target.dataset.kick : null;
    if (!id) return;
    const p = H.players.find(x => x.id === id);
    if (p && (p.bot || confirm(`Remove ${p.name}?`))) kickPlayer(id);
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
$('btn-results-exit').addEventListener('click', () => leave());
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => addBot());
$('btn-ready').addEventListener('click', () => act({ t: 'ready', r: true }));
$('btn-start').addEventListener('click', () => hostStartGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    for (const p of H.players) p.ready = p.bot;
    emitLobby();
    emit({ t: 'toLobby' });
});

function syncMute() {
    const m = isMuted();
    for (const [s, m2] of [['icon-sound','icon-muted'],['icon-sound2','icon-muted2'],['icon-sound-hud','icon-muted-hud']]) {
        $(s).classList.toggle('hidden', m); $(m2).classList.toggle('hidden', !m);
    }
}
syncMute();
const muteHandler = () => { unlockAudio(); setMuted(!isMuted()); syncMute(); };
$('btn-mute').addEventListener('click', muteHandler);
$('btn-mute2').addEventListener('click', muteHandler);
$('btn-mute-hud').addEventListener('click', muteHandler);

// Touch detection
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ── Boot ───────────────────────────────────────────────────────────────────
$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `Invited to room ${invite}.`; $('invite').classList.remove('hidden'); }

gfx.init(document.getElementById('c'));
gfx.buildLevel();
gfx.setMonsterState(8, 0, 0, true);
show('menu');
playMusic('menu');
requestAnimationFrame(frame);
