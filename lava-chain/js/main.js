// Lava Chain — main.js
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=1';
import { sfx, unlockAudio, setMuted, isMuted,
         startLavaRumble, stopLavaRumble, setLavaIntensity, tickAudio } from './audio.js?v=1';
import { play as playMusic, stop as stopMusic, setTension, setVolume } from './music.js?v=1';
import * as gfx from './gfx.js?v=1';

const track = (name, p) => { if (window.track) window.track(name, p); };
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

// ── Constants ──────────────────────────────────────────────────────────────
const SEND_EVERY      = 0.05;   // 20 Hz state send
const CRUMBLE_WARN    = 1.6;    // seconds before fall
const CRUMBLE_FALL    = 3.2;    // seconds until disappear
const LAVA_ACCEL      = 0.004;  // m/s² acceleration per second
const LAVA_WARN_DIST  = 5;      // metres below player → warning
const RITUAL_NONE     = -1;

const PLAYER_COLORS   = [0xff5500, 0x44aaff, 0xffcc00, 0x88ff44,
                         0xff44bb, 0x00ffcc, 0xaa44ff, 0xff9900];

// ── State ──────────────────────────────────────────────────────────────────
let role = null, net = null, myId = null, roomCode = '';
let gameActive = false, sendTimer = 0;
let view = 'menu'; // menu | lobby | game | results
let myName = (() => { try { return localStorage.getItem('lcName') || ''; } catch { return ''; } })();

// All players: id → { x,y,z, vx,vy,vz, alive, escaped, onGround, name,
//                     color, bot, chainPartnerId, botTarget }
const players = new Map();
let myId2 = null; // alias for myId
function me() { return players.get(myId); }

// Host-only shared state
const H = {
    players: [],        // [{id,name,colorIdx}]
    phase: 'lobby',
    lavaY: gfx.LAVA_START_Y,
    lavaSpeed: gfx.LAVA_RISE_BASE,
    platState: {},      // idx → {standTimer, phase: 0|1|2}
    chains: [],         // [{a, b}] — pairs
    survivorCount: 0,
};

// Client-side received monster / lava state
const shared = {
    lavaY: gfx.LAVA_START_Y,
};

// Input
const keys = {};
let joyL = { x: 0, y: 0, id: null, sx: 0, sy: 0 };
let jumpPressed = false;

// ── Networking helpers ─────────────────────────────────────────────────────
function emit(msg) {
    if (net) net.emit(msg);
}

function hostHandle(fromId, msg) {
    switch (msg.t) {
        case 'hello': {
            const idx = H.players.length;
            H.players.push({ id: fromId, name: msg.name.slice(0, 16), colorIdx: idx % 8 });
            emit({ t: 'lobby', players: H.players });
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === fromId);
            if (p) p.ready = msg.r;
            emit({ t: 'lobby', players: H.players });
            break;
        }
        case 'st': {
            if (!gameActive) return;
            const p = players.get(fromId);
            if (p && !p.bot) {
                p.x = msg.x; p.y = msg.y; p.z = msg.z;
                p.vx = msg.vx; p.vy = msg.vy; p.vz = msg.vz;
                p.onGround = msg.og;
            }
            break;
        }
        case 'escape': {
            if (!gameActive) return;
            const p = players.get(fromId);
            if (p && p.alive) {
                p.alive = false; p.escaped = true;
                H.survivorCount++;
                emit({ t: 'escaped', id: fromId });
                checkRoundEnd();
            }
            break;
        }
        case 'startGame': {
            if (role !== 'host') return;
            startRound();
            break;
        }
    }
}

// ── Host: start round ──────────────────────────────────────────────────────
function startRound() {
    H.phase = 'game';
    H.lavaY = gfx.LAVA_START_Y;
    H.lavaSpeed = gfx.LAVA_RISE_BASE;
    H.platState = {};
    H.survivorCount = 0;

    // Build player list from H.players (add bots if solo / < 2 human)
    players.clear();
    const allP = [...H.players];

    // Spawn positions on ground platform
    const spawns = [
        { x: -4, y: 0.01, z: -4 }, { x:  4, y: 0.01, z: -4 },
        { x: -4, y: 0.01, z:  4 }, { x:  4, y: 0.01, z:  4 },
        { x: -2, y: 0.01, z:  0 }, { x:  2, y: 0.01, z:  0 },
        { x:  0, y: 0.01, z: -2 }, { x:  0, y: 0.01, z:  2 },
    ];

    allP.forEach((pd, i) => {
        const sp = spawns[i % spawns.length];
        players.set(pd.id, {
            x: sp.x, y: sp.y, z: sp.z,
            vx: 0, vy: 0, vz: 0,
            alive: true, escaped: false, onGround: true,
            name: pd.name, color: PLAYER_COLORS[pd.colorIdx % 8],
            colorIdx: pd.colorIdx,
            bot: pd.bot || false,
            chainPartnerId: null,
            botTarget: null, botJumpT: 0,
        });
    });

    // Pair players into chains (0↔1, 2↔3, …)
    H.chains = [];
    const ids = allP.map(p => p.id);
    for (let i = 0; i + 1 < ids.length; i += 2) {
        H.chains.push({ a: ids[i], b: ids[i + 1] });
        players.get(ids[i]).chainPartnerId = ids[i + 1];
        players.get(ids[i + 1]).chainPartnerId = ids[i];
    }
    // Odd player out → chains to themselves (no partner) = safe
    if (ids.length % 2 === 1) {
        const last = ids[ids.length - 1];
        players.get(last).chainPartnerId = null;
    }

    gfx.buildLevel();
    gfx.clearPlayerModels();
    for (const [id, p] of players) {
        gfx.addPlayerModel(id, p.colorIdx, p.name);
    }

    emit({
        t: 'roundStart',
        players: allP,
        chains: H.chains,
        spawns: Object.fromEntries([...players.entries()].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z }])),
    });

    // Countdown
    let cd = 3;
    const cdEl = $('countdown');
    cdEl.classList.remove('hidden');
    const cdInt = setInterval(() => {
        if (cd > 0) { cdEl.textContent = cd; cd--; }
        else {
            cdEl.textContent = 'GO!';
            setTimeout(() => { cdEl.classList.add('hidden'); }, 700);
            clearInterval(cdInt);
            gameActive = true;
            emit({ t: 'go' });
            startLavaRumble();
            playMusic(isMuted());
        }
    }, 1000);
    showHud();
}

// ── Host: round update ──────────────────────────────────────────────────────
function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    // Lava rises & accelerates
    H.lavaSpeed += LAVA_ACCEL * dt;
    H.lavaY += H.lavaSpeed * dt;

    // Check player-lava collision
    for (const [id, p] of players) {
        if (!p.alive || p.escaped) continue;
        if (p.y <= H.lavaY + 0.4) {
            eliminatePlayer(id, 'lava');
        }
    }

    // Platform crumble logic
    for (const plat of gfx.PLATFORMS) {
        if (plat.type !== 'crumble') continue;
        let anyOn = false;
        for (const [, p] of players) {
            if (!p.alive || !p.onGround) continue;
            if (isOnPlatform(p, plat)) { anyOn = true; break; }
        }
        const ps = H.platState[plat.idx] || { phase: 0, t: 0 };
        if (anyOn && ps.phase === 0) {
            ps.phase = 1; ps.t = 0;
            emit({ t: 'platCrumble', idx: plat.idx, phase: 1 });
        }
        if (ps.phase === 1) {
            ps.t += dt;
            if (ps.t >= CRUMBLE_FALL) {
                ps.phase = 2;
                emit({ t: 'platCrumble', idx: plat.idx, phase: 2 });
                // Respawn after 6s
                setTimeout(() => {
                    ps.phase = 0; ps.t = 0;
                    emit({ t: 'platCrumble', idx: plat.idx, phase: 0 });
                }, 6000);
            }
        }
        H.platState[plat.idx] = ps;
    }

    // Chain spring: apply force between paired players
    for (const chain of H.chains) {
        const pa = players.get(chain.a);
        const pb = players.get(chain.b);
        if (!pa || !pb || (!pa.alive && !pb.alive)) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
        if (dist > gfx.CHAIN_MAX) {
            const over = dist - gfx.CHAIN_MAX;
            const fx = (dx / dist) * over * gfx.CHAIN_SPRING;
            const fz = (dz / dist) * over * gfx.CHAIN_SPRING;
            const fy = (dy / dist) * over * gfx.CHAIN_SPRING * 0.5;
            if (pa.alive) { pa.vx += fx * dt; pa.vy += fy * dt; pa.vz += fz * dt; }
            if (pb.alive) { pb.vx -= fx * dt; pb.vy -= fy * dt; pb.vz -= fz * dt; }
        }
    }

    // Bot AI
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        botThink(id, p, dt);
    }

    // Broadcast state
    const sts = [];
    for (const [id, p] of players) {
        sts.push([id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), p.alive ? 1 : 0]);
    }
    emit({ t: 'sts', a: sts, lavaY: +H.lavaY.toFixed(3) });

    checkRoundEnd();
}

function isOnPlatform(p, plat) {
    const hw = plat.w / 2, hd = plat.d / 2;
    return p.x >= plat.x - hw && p.x <= plat.x + hw
        && p.z >= plat.z - hd && p.z <= plat.z + hd
        && Math.abs(p.y - plat.y) < 0.5;
}

function eliminatePlayer(id, reason) {
    const p = players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    emit({ t: 'eliminated', id, reason });
    // Check partner
    if (p.chainPartnerId) {
        const partner = players.get(p.chainPartnerId);
        if (partner && partner.alive) {
            // Give partner 2s of extra drag force (already handled by spring hitting y=-inf)
        }
    }
    checkRoundEnd();
}

function checkRoundEnd() {
    if (!gameActive) return;
    const alive = [...players.values()].filter(p => p.alive && !p.escaped);
    const total = [...players.values()].length;
    const escaped = [...players.values()].filter(p => p.escaped).length;
    if (alive.length === 0) {
        gameActive = false;
        H.phase = 'results';
        const list = [...players.values()].map(p => ({
            id: p.bot ? ('bot_' + p.name) : [... players.entries()].find(([k,v])=>v===p)?.[0],
            name: p.name, color: p.color, escaped: p.escaped,
        }));
        setTimeout(() => emit({ t: 'results', list }), 1200);
    }
}

// ── Bot AI ────────────────────────────────────────────────────────────────
function botThink(id, p, dt) {
    // Find a safe platform above lava to target
    const lavaY = H.lavaY;
    const target = _botPickTarget(p, lavaY);
    if (!target) return;

    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.sqrt(dx*dx + dz*dz);

    // Move toward target
    if (dist > 0.5) {
        const spd = gfx.PLAYER_SPEED * 0.75;
        p.vx += (dx / dist) * spd * dt * 6;
        p.vz += (dz / dist) * spd * dt * 6;
    }

    // Jump if target is higher and on ground
    p.botJumpT = (p.botJumpT || 0) + dt;
    if (p.onGround && target.y > p.y + 0.5 && p.botJumpT > 0.6) {
        p.vy = gfx.JUMP_FORCE;
        p.onGround = false;
        p.botJumpT = 0;
    }
}

function _botPickTarget(p, lavaY) {
    // Pick lowest platform that's safely above lava + 3, and close-ish
    let best = null, bestScore = Infinity;
    for (const plat of gfx.PLATFORMS) {
        if (plat.y < lavaY + 3) continue;
        const ps = H.platState[plat.idx];
        if (ps && ps.phase === 2) continue; // gone
        const dx = plat.x - p.x, dz = plat.z - p.z;
        const hdist = Math.sqrt(dx*dx + dz*dz);
        const score = hdist + Math.abs(plat.y - p.y - 2) * 0.5;
        if (score < bestScore) { bestScore = score; best = plat; }
    }
    return best;
}

// ── Client: handle server messages ────────────────────────────────────────
function clientHandle(msg) {
    switch (msg.t) {
        case 'welcome':
            myId = msg.you; roomCode = msg.code;
            $('lobby-code').textContent = msg.code;
            break;
        case 'reject': leave(msg.reason); return;
        case 'lobby': renderLobby(msg.players); break;
        case 'roundStart': {
            gameActive = false;
            players.clear();
            gfx.clearLevel();
            gfx.clearPlayerModels();
            gfx.buildLevel();

            msg.players.forEach(pd => {
                const sp = msg.spawns[pd.id] || { x: 0, y: 0, z: 0 };
                players.set(pd.id, {
                    x: sp.x, y: sp.y, z: sp.z,
                    vx: 0, vy: 0, vz: 0,
                    alive: true, escaped: false, onGround: true,
                    name: pd.name, colorIdx: pd.colorIdx,
                    color: PLAYER_COLORS[pd.colorIdx % 8],
                    chainPartnerId: null,
                });
                gfx.addPlayerModel(pd.id, pd.colorIdx, pd.name);
            });
            msg.chains.forEach(chain => {
                const pa = players.get(chain.a);
                const pb = players.get(chain.b);
                if (pa) pa.chainPartnerId = chain.b;
                if (pb) pb.chainPartnerId = chain.a;
            });
            shared.lavaY = gfx.LAVA_START_Y;
            showHud();
            break;
        }
        case 'go':
            gameActive = true;
            startLavaRumble();
            playMusic(isMuted());
            break;
        case 'sts':
            if (role === 'host') break;
            msg.a.forEach(([id, x, y, z, aliveN]) => {
                const p = players.get(id);
                if (p && id !== myId) {
                    p.x = x; p.y = y; p.z = z; p.alive = aliveN === 1;
                }
            });
            shared.lavaY = msg.lavaY;
            break;
        case 'platCrumble':
            gfx.setPlatformCrumble(msg.idx, msg.phase);
            if (msg.phase === 1) sfx.crumble();
            break;
        case 'eliminated':
            if (msg.id === myId) {
                const mep = me(); if (mep) mep.alive = false;
                sfx.eliminated();
            } else {
                const p = players.get(msg.id);
                if (p) p.alive = false;
            }
            updateHudPlayers();
            break;
        case 'escaped':
            if (msg.id === myId) sfx.escape();
            const ep = players.get(msg.id);
            if (ep) { ep.alive = false; ep.escaped = true; }
            updateHudPlayers();
            break;
        case 'results':
            gameActive = false;
            stopLavaRumble();
            stopMusic();
            showResults(msg.list);
            break;
    }
}

// ── Physics (client-side for self) ────────────────────────────────────────
function updatePhysics(dt) {
    const p = me();
    if (!p || !p.alive) return;

    // Input → wish velocity
    const { fwd, right } = gfx.getPlayerCamForward();
    let wx = 0, wz = 0;

    if (keys['KeyW'] || keys['ArrowUp'])    { wx += fwd.x;   wz += fwd.z; }
    if (keys['KeyS'] || keys['ArrowDown'])  { wx -= fwd.x;   wz -= fwd.z; }
    if (keys['KeyA'] || keys['ArrowLeft'])  { wx -= right.x; wz -= right.z; }
    if (keys['KeyD'] || keys['ArrowRight']) { wx += right.x; wz += right.z; }

    // Joystick
    if (joyL.x !== 0 || joyL.y !== 0) {
        wx += right.x * joyL.x + fwd.x * (-joyL.y);
        wz += right.z * joyL.x + fwd.z * (-joyL.y);
    }

    const wlen = Math.sqrt(wx*wx + wz*wz);
    if (wlen > 0.01) { wx /= wlen; wz /= wlen; }

    const accel = p.onGround ? 55 : 18;
    const friction = p.onGround ? 0.82 : 0.97;
    p.vx += wx * gfx.PLAYER_SPEED * accel * dt;
    p.vz += wz * gfx.PLAYER_SPEED * accel * dt;
    p.vx *= Math.pow(friction, dt * 60);
    p.vz *= Math.pow(friction, dt * 60);

    // Jump
    const wantJump = keys['Space'] || jumpPressed;
    if (wantJump && p.onGround) {
        p.vy = gfx.JUMP_FORCE;
        p.onGround = false;
        sfx.jump();
        jumpPressed = false;
    }

    // Chain spring (client-side mirror)
    if (p.chainPartnerId) {
        const partner = players.get(p.chainPartnerId);
        if (partner && partner.alive) {
            const dx = partner.x - p.x, dy = partner.y - p.y, dz = partner.z - p.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
            if (dist > gfx.CHAIN_MAX) {
                const over = dist - gfx.CHAIN_MAX;
                p.vx += (dx / dist) * over * gfx.CHAIN_SPRING * dt;
                p.vy += (dy / dist) * over * gfx.CHAIN_SPRING * 0.5 * dt;
                p.vz += (dz / dist) * over * gfx.CHAIN_SPRING * dt;
            }
        }
    }

    // Gravity
    p.vy += gfx.GRAVITY * dt;

    // Integrate
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    // Platform collision
    const prevOnGround = p.onGround;
    p.onGround = false;
    for (const plat of gfx.PLATFORMS) {
        const ps = role === 'host' ? H.platState[plat.idx] : null;
        if (ps && ps.phase === 2) continue; // gone
        const hw = plat.w / 2, hd = plat.d / 2;
        if (p.x >= plat.x - hw && p.x <= plat.x + hw
         && p.z >= plat.z - hd && p.z <= plat.z + hd
         && p.y >= plat.y - 0.3 && p.y <= plat.y + 0.5) {
            if (p.vy <= 0) {
                p.y = plat.y;
                if (p.vy < -2 && !prevOnGround) sfx.land();
                p.vy = 0;
                p.onGround = true;
            }
        }
    }

    // Escape zone: top platform
    const summit = gfx.PLATFORMS[gfx.PLATFORMS.length - 1];
    if (p.onGround && Math.abs(p.x - summit.x) < summit.w / 2
     && Math.abs(p.z - summit.z) < summit.d / 2
     && p.y >= summit.y - 0.1) {
        // Reached summit!
        if (role === 'host') {
            hostHandle(myId, { t: 'escape' });
        } else {
            emit({ t: 'escape' });
        }
    }

    // Clamp horizontal bounds
    p.x = clamp(p.x, -40, 40);
    p.z = clamp(p.z, -40, 40);

    // Step sound
    if (p.onGround && wlen > 0.1) {
        p._stepT = (p._stepT || 0) + dt;
        if (p._stepT > 0.35) { sfx.step(); p._stepT = 0; }
    }

    // Check lava
    const lavaY = role === 'host' ? H.lavaY : shared.lavaY;
    if (p.y < lavaY + 0.3) {
        if (role === 'host') {
            eliminatePlayer(myId, 'lava');
        }
        // Client side: host will send eliminated
    }
}

// ── Host physics for bots ──────────────────────────────────────────────────
function updateBotPhysics(id, p, dt) {
    p.vy += gfx.GRAVITY * dt;
    p.vx *= Math.pow(0.78, dt * 60);
    p.vz *= Math.pow(0.78, dt * 60);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    p.onGround = false;
    for (const plat of gfx.PLATFORMS) {
        const ps = H.platState[plat.idx];
        if (ps && ps.phase === 2) continue;
        const hw = plat.w / 2, hd = plat.d / 2;
        if (p.x >= plat.x - hw && p.x <= plat.x + hw
         && p.z >= plat.z - hd && p.z <= plat.z + hd
         && p.y >= plat.y - 0.3 && p.y <= plat.y + 0.5) {
            if (p.vy <= 0) { p.y = plat.y; p.vy = 0; p.onGround = true; }
        }
    }

    // Escape at summit
    const summit = gfx.PLATFORMS[gfx.PLATFORMS.length - 1];
    if (p.onGround && Math.abs(p.x - summit.x) < summit.w / 2
     && Math.abs(p.z - summit.z) < summit.d / 2) {
        hostHandle(id, { t: 'escape' });
    }

    // Lava
    if (p.y < H.lavaY + 0.3) eliminatePlayer(id, 'lava');

    p.x = clamp(p.x, -40, 40);
    p.z = clamp(p.z, -40, 40);
}

// ── Main game update ───────────────────────────────────────────────────────
function updateGame(dt) {
    if (!gameActive) return;

    if (role === 'host') {
        // Physics for bots
        for (const [id, p] of players) {
            if (p.bot && p.alive) updateBotPhysics(id, p, dt);
        }
        hostUpdate(dt);
        // Host also runs own physics
        updatePhysics(dt);
        // Sync lava for own client
        shared.lavaY = H.lavaY;
    } else {
        updatePhysics(dt);
    }

    // Send own state
    sendTimer += dt;
    if (sendTimer >= SEND_EVERY && role !== 'host') {
        sendTimer = 0;
        const p = me();
        if (p) emit({ t: 'st', x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, og: p.onGround });
    }
}

// ── Camera ─────────────────────────────────────────────────────────────────
function updateCamera(dt) {
    const p = me();
    if (p && p.alive) {
        gfx.updateCamera(p.x, p.y, p.z, dt);
    } else {
        // Spectate first alive player
        for (const [, q] of players) {
            if (q.alive) { gfx.updateCamera(q.x, q.y, q.z, dt); break; }
        }
    }
}

// ── Graphics sync ─────────────────────────────────────────────────────────
function syncGraphics() {
    const lavaY = role === 'host' ? H.lavaY : shared.lavaY;
    gfx.setLavaY(lavaY);

    for (const [id, p] of players) {
        gfx.setPlayerPos(id, p.x, p.y, p.z, p.alive);
    }

    // Chain
    const mep = me();
    if (mep && mep.chainPartnerId) {
        const partner = players.get(mep.chainPartnerId);
        if (partner) {
            const dx = partner.x - mep.x, dy = partner.y - mep.y, dz = partner.z - mep.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const stretch = Math.min(1, Math.max(0, (dist - 4) / (gfx.CHAIN_MAX - 4)));
            gfx.updateChain(mep.x, mep.y, mep.z, partner.x, partner.y, partner.z, stretch);
            updateChainHud(stretch);
        }
    } else {
        gfx.hideChain();
        updateChainHud(0);
    }

    // HUD
    if (mep) {
        const aboveLava = mep.y - lavaY;
        const warnEl = $('lava-warn');
        if (aboveLava < LAVA_WARN_DIST) {
            warnEl.textContent = aboveLava < 2 ? '⚠ LAVA RISING ⚠' : 'LAVA RISING';
            warnEl.classList.add('visible');
        } else {
            warnEl.classList.remove('visible');
        }
        $('height-val').textContent = Math.max(0, Math.round(mep.y));
        setLavaIntensity(clamp(1 - aboveLava / 20, 0, 1));
        setTension(clamp(1 - aboveLava / 15, 0, 1));
    }
}

function updateChainHud(stretch01) {
    const fill = $('chain-bar-fill');
    if (!fill) return;
    fill.style.width = (stretch01 * 100) + '%';
    fill.classList.toggle('danger', stretch01 > 0.8);
}

// ── HUD ────────────────────────────────────────────────────────────────────
function showHud() {
    $('hud').classList.remove('hidden');
    $('menu').classList.add('hidden');
    $('lobby').classList.add('hidden');
    $('results').classList.add('hidden');
    if ('ontouchstart' in window) $('touch-controls').classList.remove('hidden');
    view = 'game';
    updateHudPlayers();
}

function updateHudPlayers() {
    const el = $('hud-players');
    el.innerHTML = '';
    for (const [id, p] of players) {
        const row = document.createElement('div');
        row.className = 'hud-player-row' + ((!p.alive && !p.escaped) ? ' hud-player-dead' : '');
        const dot = document.createElement('div');
        dot.className = 'hud-player-dot';
        dot.style.background = '#' + p.color.toString(16).padStart(6, '0');
        row.appendChild(dot);
        const label = document.createElement('span');
        label.textContent = (p.escaped ? '✓ ' : (!p.alive ? '✗ ' : '')) + p.name;
        row.appendChild(label);
        el.appendChild(row);
    }
}

// ── Results ────────────────────────────────────────────────────────────────
function showResults(list) {
    gfx.clearLevel();
    gfx.buildLevel();
    gfx.clearPlayerModels();
    $('hud').classList.add('hidden');
    $('touch-controls').classList.add('hidden');
    $('results').classList.remove('hidden');
    view = 'results';

    const escaped = list.filter(p => p.escaped);
    $('results-title').textContent = escaped.length ? 'SURVIVED!' : 'CONSUMED';

    const ul = $('results-list');
    ul.innerHTML = '';
    list.forEach(p => {
        const li = document.createElement('li');
        const dot = document.createElement('div');
        dot.className = 'player-dot';
        dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:#${(p.color||0xff5500).toString(16).padStart(6,'0')}`;
        li.appendChild(dot);
        const span = document.createElement('span');
        span.innerHTML = esc(p.name) + ' — ' + (p.escaped ? '<span style="color:#90d090">Escaped</span>' : '<span style="color:#ff6040">Consumed</span>');
        li.appendChild(span);
        ul.appendChild(li);
    });
}

// ── Lobby ──────────────────────────────────────────────────────────────────
function enterLobby() {
    $('menu').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('results').classList.add('hidden');
    $('hud').classList.add('hidden');
    view = 'lobby';
    $('lobby-code').textContent = roomCode || '-----';
    if (role !== 'host') {
        $('lobby-code').textContent = roomCode;
    }
    gfx.buildLevel();
}

function renderLobby(plist) {
    const el = $('players');
    el.innerHTML = '';
    plist.forEach((p, i) => {
        const col = PLAYER_COLORS[p.colorIdx % 8];
        const row = document.createElement('div');
        row.className = 'player-row';
        row.innerHTML = `<div class="player-dot" style="background:#${col.toString(16).padStart(6,'0')}"></div>
            <span>${esc(p.name)}</span>
            ${i % 2 === 0 && i + 1 < plist.length
                ? `<span class="player-chain-badge">⛓ ${esc(plist[i+1]?.name || '?')}</span>` : ''}`;
        el.appendChild(row);
    });
    const btn = $('btn-start');
    if (btn) btn.disabled = plist.length < 1;
}

// ── Solo ───────────────────────────────────────────────────────────────────
function addBot(name, colorIdx) {
    const id = 'bot_' + Math.random().toString(36).slice(2, 8);
    H.players.push({ id, name, colorIdx, bot: true, ready: true });
    return id;
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('lcName', myName); } catch {}
    role = 'host'; document.body.classList.add('is-host', 'solo');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    addBot('Blaze', 1);
    addBot('Frost', 2);
    track('play_solo');
    enterLobby();
    renderLobby(H.players);
    $('btn-start').disabled = false;
}

// ── Networking ─────────────────────────────────────────────────────────────
function hostGame() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('lcName', myName); } catch {}
    roomCode = makeCode();
    role = 'host'; document.body.classList.add('is-host');
    myId = 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = []; H.phase = 'lobby';

    net = new HostNet(roomCode, (fromId, msg) => {
        if (fromId === myId) return;
        hostHandle(fromId, msg);
    });
    net.onConnect = id => {
        // Send lobby state on connect
        emit({ t: 'welcome', you: id, code: roomCode });
        emit({ t: 'lobby', players: H.players });
    };

    hostHandle(myId, { t: 'hello', name: myName });
    $('lobby-code').textContent = roomCode;
    $('menu-status').textContent = '';
    track('host');
    enterLobby();
    renderLobby(H.players);
}

function joinGame() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('lcName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 5) { $('menu-status').textContent = 'Enter a 5-letter code'; $('menu-status').className = 'status error'; return; }

    role = 'client';
    $('menu-status').textContent = 'Connecting…'; $('menu-status').className = 'status';
    net = new ClientNet(code, msg => clientHandle(msg));
    net.onOpen = () => {
        myId = 'client_' + Math.random().toString(36).slice(2, 8);
        emit({ t: 'hello', name: myName });
        enterLobby();
        track('join');
    };
    net.onError = () => { $('menu-status').textContent = 'Room not found'; $('menu-status').className = 'status error'; };
}

function leave(reason) {
    const n = net; net = null; if (n) n.close();
    role = null; myId = null; roomCode = '';
    gameActive = false;
    H.players = []; H.phase = 'lobby';
    players.clear();
    gfx.clearLevel();
    gfx.clearPlayerModels();
    gfx.hideChain();
    stopLavaRumble();
    stopMusic();
    document.body.classList.remove('is-host', 'solo');
    $('menu').classList.remove('hidden');
    $('lobby').classList.add('hidden');
    $('results').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('touch-controls').classList.add('hidden');
    if (reason) { $('menu-status').textContent = reason; $('menu-status').className = 'status error'; }
    view = 'menu';
    gfx.buildLevel();
}

// ── Input ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse look
document.addEventListener('mousemove', e => {
    if (view !== 'game' || !gameActive) return;
    gfx.rotateCam(e.movementX, e.movementY);
});
document.addEventListener('click', e => {
    if (view === 'game' && gameActive) {
        const canvas = document.getElementById('c');
        if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    }
});

// Touch controls
const joyCenter = { x: 0, y: 0 };
$('joy-zone-l').addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const r = $('joy-zone-l').getBoundingClientRect();
    joyCenter.x = r.left + r.width / 2;
    joyCenter.y = r.top + r.height / 2;
    joyL.id = t.identifier; joyL.sx = t.clientX; joyL.sy = t.clientY;
}, { passive: false });
$('joy-zone-l').addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
        if (t.identifier !== joyL.id) continue;
        const dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        const max = 40;
        joyL.x = clamp(dx / max, -1, 1);
        joyL.y = clamp(dy / max, -1, 1);
    }
}, { passive: false });
['touchend','touchcancel'].forEach(ev => {
    $('joy-zone-l').addEventListener(ev, e => {
        for (const t of e.changedTouches) {
            if (t.identifier === joyL.id) { joyL.x = 0; joyL.y = 0; joyL.id = null; }
        }
    });
});
$('btn-jump').addEventListener('touchstart', e => { e.preventDefault(); jumpPressed = true; });
$('btn-jump').addEventListener('touchend', e => { e.preventDefault(); jumpPressed = false; });

// ── UI Events ──────────────────────────────────────────────────────────────
$('btn-solo').addEventListener('click', startSolo);
$('btn-host').addEventListener('click', hostGame);
$('btn-join').addEventListener('click', joinGame);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-solo').click(); });

$('btn-start').addEventListener('click', () => {
    if (role !== 'host') return;
    startRound();
});
$('btn-exit').addEventListener('click', () => leave());
$('btn-results-lobby').addEventListener('click', () => {
    if (role !== 'host') return;
    $('results').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    view = 'lobby';
    renderLobby(H.players);
    gfx.clearLevel(); gfx.buildLevel();
});
$('btn-results-exit').addEventListener('click', () => leave());

// Mute
const muteBtn = $('btn-mute');
muteBtn.addEventListener('click', () => {
    const m = !isMuted(); setMuted(m); setVolume(m ? 0 : 0.5);
    muteBtn.textContent = m ? '🔇' : '♪';
});

// Pre-fill name
if (myName) $('name').value = myName;

// ── Frame loop ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
gfx.init(canvas);
gfx.buildLevel();

let last = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tickAudio();

    if (view === 'game' || gameActive) {
        updateGame(dt);
        syncGraphics();
        updateCamera(dt);
    } else {
        gfx.updateMenuCamera(now / 1000);
    }

    gfx.update(dt);
}
requestAnimationFrame(frame);
