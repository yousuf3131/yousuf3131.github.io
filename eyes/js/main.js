// Eyes & Legs: a 2-player online co-op obstacle course.
//
// Networking model: one player hosts the room in their browser and the other connects to them.
// (Guide pings travel as 'pg' messages: 'ping' is the relay's own keep-alive and is filtered out there.)
// The walker's browser is the authority for the walker (position, falls, checkpoints, reaching the goal).
// Hazards are pure functions of level time, so the host only sends when a level starts and both
// browsers derive the same clock from it. Pings and switch presses go guide -> host -> both.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=2';
import {
    LEVELS, MENU_LEVEL, T, WALKER_R, parseLevel, tileAt, tileRC, newSwitchState, pressSwitch, switchActive,
    groundAt, blockedAt, hazardHit, dynPhase, buildRoute, tileDanger, starsFor, platPos, hazTime, laserOn, laserWarn, crusherY, hammerHead, bladeAngle,
} from './levels.js?v=2';
import {
    initWorld, resize as resizeWorld, setMode, buildLevel, createWalker, addPing, clearPings, activePings, fx,
    frame as renderFrame, aimSun, placeEye, walkerCam, guideCam, menuCam, PING_COLORS, DARK,
} from './world.js?v=2';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=2';
import { play as playMusic } from './music.js?v=2';

// ============================================================
// Constants and helpers
// ============================================================
const MAX_PLAYERS = 2;
const SEND_EVERY = 0.05;         // walker state 20 times a second (the relay halves it)
const PING_GAP = 400;            // ms between pings
const INTER_MS = 5200;           // "You are the EYES" + 3-2-1
const RESULTS_MS = 6800;         // goal celebration + level results before the next intermission
const SPEED = 5.2, JUMP_V = 7.6, GRAVITY = 22;
const PING_KINDS = ['arrow', 'stop', 'jump', 'go', 'danger'];
const COLORS = ['#ff9a4a', '#38e1ff'];
const TILT = 0.5;                // guide camera tilt from straight down

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtTime(s) {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
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
const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
function starsSvg(n, total = 3) {
    let s = '';
    for (let i = 0; i < total; i++) s += `<svg viewBox="0 0 24 24" class="${i < n ? 'on' : 'off'}" style="animation-delay:${0.15 + i * 0.18}s"><path d="${STAR_PATH}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    return s;
}
function miniStars(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += `<svg viewBox="0 0 24 24"><path d="${STAR_PATH}" fill="${i < n ? '#ffc94a' : 'rgba(255,255,255,0.15)'}"/></svg>`;
    return s;
}

// ============================================================
// Renderer and the always-present bits
// ============================================================
const canvas = $('c');
initWorld(canvas);
function resize() { resizeWorld(innerWidth, innerHeight); }
addEventListener('resize', resize);
resize();
const walkerModel = createWalker();

// ============================================================
// State
// ============================================================
let role = null;              // 'host' | 'client' | 'solo'
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';            // 'menu' | 'lobby' | 'inter' | 'play' | 'lvres' | 'final'
let lobby = { players: [], phase: 'lobby' };
let myName = store.get('eyesName') || '';
let match = null;             // the level being played right now (both roles)
let lv = null;                // its meshes
let me = null;                // my walker, when I'm the legs
let menuLv = null;
let clockOffset = 0;          // host clock minus my clock, in ms (0 on the host)
let clockSamples = [];
let tpTimer = null;
let lastPingSent = -1e9, pingCs = 0, swCs = 0;
let sendAcc = 0, evSeq = 0, shake = 0, centerT = 0;
const hostNow = () => performance.now() + clockOffset;

// Host-only state
const H = {
    players: new Map(), phase: 'lobby', level: -1, seq: 0, S: null, L: null, goAt: 0, walker: null,
    levelDone: false, results: [], lastPing: -1e9, pingSeq: 0, seenCs: new Set(), timer: null,
};

// ============================================================
// Screens
// ============================================================
const SCREENS = ['menu', 'lobby', 'inter', 'lvres', 'final'];
function show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', !(id === 'hud' || id === 'inter' || id === 'lvres'));
}

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
    store.set('eyesName', myName);
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
        const hn = new HostNet({ onMessage: hostHandle, onLeave: id => hostLeave(id) });
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
    clockOffset = 0;
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
        onClose: () => {
            if (net !== cn) return;
            leave(view === 'menu' ? 'Lost connection to the host. The room may have closed.' : 'The host left, so the room was closed.');
        },
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
    clockSamples = [];
    act({ t: 'hello', name: myName });
    setStatus('menu-status', 'Connected. Waiting for the host...');
    // Keep measuring the round trip so level clocks line up
    const sendTp = () => { if (net === cn) net.send({ t: 'tp', c: performance.now() }); };
    sendTp();
    setTimeout(sendTp, 400);
    setTimeout(sendTp, 900);
    tpTimer = setInterval(sendTp, 2000);
    setTimeout(() => {
        if (net === cn && view === 'menu') leave("The host didn't answer. Ask them to refresh the page, create a new room and send you the new code.");
    }, 15000);
}

function startSolo() {
    if (busy || !readName()) return;
    unlockAudio();
    role = 'solo';
    myId = 'me';
    roomCode = 'SOLO';
    clockOffset = 0;
    document.body.classList.add('solo');
    document.body.classList.remove('is-host');
    hostInit();
    hostStartMatch();
}

function leave(reason) {
    const n = net;
    net = null;
    if (n) n.close();
    clearInterval(tpTimer);
    clearTimeout(H.timer);
    H.phase = 'lobby';
    role = null;
    myId = null;
    roomCode = '';
    lobby = { players: [], phase: 'lobby' };
    teardownLevel();
    document.body.classList.remove('solo', 'is-host', 'role-eyes', 'role-legs');
    view = 'menu';
    show('menu');
    buildMenuScene();
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-exit').addEventListener('click', e => {
    e.currentTarget.blur();
    if (view === 'menu') location.href = '../projects.html';
    else if (confirm(role === 'host' ? 'Leave and close this room?' : role === 'solo' ? 'Stop practising and go back to the menu?' : 'Leave this room?')) leave();
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
// Walker updates go straight to the other player
function sendWalker(msg) {
    if (role === 'client') net.send(msg);
    else if (role === 'host' && net) net.broadcast(msg);
}

// ============================================================
// Host logic
// ============================================================
function hostInit() {
    H.players.clear();
    H.phase = 'lobby';
    H.players.set(myId, { id: myId, name: myName, ready: true, host: true, color: COLORS[0] });
    broadcastLobby();
}

function broadcastLobby() {
    if (role === 'solo') return;
    emit({ t: 'lobby', code: roomCode, phase: H.phase, players: [...H.players.values()] });
}

function hostHandle(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
        // The relay can deliver a message twice: a player already here is simply ignored
        if (H.players.has(from)) return;
        if (H.phase !== 'lobby') return rejectPeer(from, 'A game is in progress in that room. Try again when it ends.');
        if (H.players.size >= MAX_PLAYERS) return rejectPeer(from, 'That room is full (2 players).');
        const p = { id: from, name: cleanName(msg.name), ready: false, color: COLORS[H.players.size % COLORS.length] };
        H.players.set(from, p);
        net.send(from, { t: 'welcome', you: from, code: roomCode });
        emit({ t: 'toast', text: `${p.name} joined the room` });
        broadcastLobby();
        return;
    }
    if (msg.t === 'tp') {
        if (net && from !== myId) net.send(from, { t: 'tq', c: msg.c, h: performance.now() });
        return;
    }
    const p = H.players.get(from);
    if (!p) return;
    switch (msg.t) {
        case 'ready':
            if (H.phase === 'lobby') { p.ready = !!msg.r; broadcastLobby(); }
            break;
        case 'st':
            if (from === H.walker && from !== myId) onWalkerState(msg.s);
            break;
        case 'ev':
            if (from === H.walker && from !== myId) onWalkerEvent(msg);
            break;
        case 'goal':
            if (from === H.walker) hostGoal(msg);
            break;
        case 'pg':
            if (from !== H.walker || role === 'solo') hostPing(msg);
            break;
        case 'sw':
            if (from !== H.walker || role === 'solo') hostSwitch(from, msg);
            break;
    }
}

function rejectPeer(id, reason) {
    net.send(id, { t: 'reject', reason });
    setTimeout(() => net && net.kick && net.kick(id), 600);
}

function hostLeave(id, how = 'left') {
    const p = H.players.get(id);
    if (!p || p.host) return;
    H.players.delete(id);
    if (H.phase !== 'lobby') {
        // Co-op needs both of you: end the run and send the host back to the lobby
        const wasFinal = H.phase === 'final';
        clearTimeout(H.timer);
        H.phase = 'lobby';
        H.walker = null;
        teardownLevel();
        enterLobby();
        setStatus('lobby-status', wasFinal ? `${p.name} left the room.` : `${p.name} ${how}, so the run ended. Invite someone else, or practise solo.`, true);
    }
    emit({ t: 'toast', text: `${p.name} ${how}` });
    broadcastLobby();
}

// Host removes the other player from the lobby: tell them why, then drop their connection
function kickPlayer(id) {
    const p = H.players.get(id);
    if (!p || p.host || H.phase !== 'lobby' || !net) return;
    rejectPeer(id, 'The host removed you from the room.');
    hostLeave(id, 'was removed');
}

function hostStart() {
    if (H.phase !== 'lobby') return;
    if (H.players.size < 2) return toast('You need a partner. Share the invite link, or practise solo.');
    const waiting = [...H.players.values()].filter(p => !p.host && !p.ready);
    if (waiting.length) return toast(`Waiting for ${waiting.map(p => p.name).join(', ')}`);
    hostStartMatch();
}

function hostStartMatch() {
    H.phase = 'play';
    H.level = -1;
    H.results = [];
    broadcastLobby();
    hostNextLevel();
}

const hostLt = () => (performance.now() - H.goAt) / 1000;

function hostNextLevel() {
    clearTimeout(H.timer);
    H.level++;
    if (H.level >= LEVELS.length) return hostFinal();
    const order = [...H.players.keys()];
    H.walker = order[H.level % order.length];
    H.L = parseLevel(LEVELS[H.level], H.level);
    H.S = newSwitchState(H.L);
    H.levelDone = false;
    H.seenCs.clear();
    H.seq++;
    H.phase = 'play';
    H.goAt = performance.now() + INTER_MS;
    const names = Object.fromEntries([...H.players.values()].map(p => [p.id, p.name]));
    emit({ t: 'level', n: H.level, seq: H.seq, walker: H.walker, goAt: H.goAt, names });
}

function hostGoal(msg) {
    if (H.phase !== 'play' || H.levelDone || msg.n !== H.level) return;
    H.levelDone = true;
    H.phase = 'results';
    const time = clamp(+msg.time || 0, 0, 3600);
    const deaths = Math.max(0, msg.deaths | 0);
    const stars = starsFor(LEVELS[H.level], time, deaths);
    const w = H.players.get(H.walker);
    const r = { n: H.level, time, deaths, stars, walker: w ? w.name : '' };
    H.results.push(r);
    emit({ t: 'lvres', ...r, seq: H.seq, last: H.level >= LEVELS.length - 1 });
    H.timer = setTimeout(hostNextLevel, RESULTS_MS);
}

function hostFinal() {
    H.phase = 'final';
    H.walker = null;
    emit({ t: 'final', results: H.results, seq: H.seq });
    broadcastLobby();
}

function hostBackToLobby() {
    if (H.phase !== 'final') return;
    H.phase = 'lobby';
    for (const p of H.players.values()) p.ready = !!p.host;
    emit({ t: 'toLobby' });
    broadcastLobby();
}

function hostPing(msg) {
    if (H.phase !== 'play' || !H.L) return;
    const now = performance.now();
    if (msg.cs != null) {
        if (H.seenCs.has('p' + msg.cs)) return;
        H.seenCs.add('p' + msg.cs);
    }
    if (now - H.lastPing < PING_GAP - 40) return;
    if (!PING_KINDS.includes(msg.k)) return;
    const x = +msg.x, z = +msg.z;
    if (!isFinite(x) || !isFinite(z) || x < -6 || z < -6 || x > H.L.width + 6 || z > H.L.depth + 6) return;
    let dx = +msg.dx || 0, dz = +msg.dz || 0;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) { dx /= len; dz /= len; } else { dx = 0; dz = -1; }
    H.lastPing = now;
    emit({ t: 'pg', id: ++H.pingSeq, n: H.level, k: msg.k, x: +x.toFixed(2), z: +z.toFixed(2), dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
}

function hostSwitch(from, msg) {
    if (H.phase !== 'play' || !H.L) return;
    if (msg.cs != null) {
        if (H.seenCs.has('s' + msg.cs)) return;
        H.seenCs.add('s' + msg.cs);
    }
    const idx = msg.i | 0;
    if (!H.L.switches[idx]) return;
    if (pressSwitch(H.L, H.S, idx, hostLt())) {
        emit({ t: 'sws', n: H.level, seq: H.S.seq, list: H.S.list, who: idx });
    } else if (from === myId) {
        if (role !== 'solo') onSwitchDenied(idx);
    } else if (net) {
        net.send(from, { t: 'swno', i: idx });
    }
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
        case 'tq': {
            const now = performance.now(), rtt = now - msg.c;
            if (rtt < 0 || rtt > 10000) break;
            clockSamples.push({ rtt, off: msg.h + rtt / 2 - now });
            if (clockSamples.length > 10) clockSamples.shift();
            const best = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
            clockOffset = best.off;
            break;
        }
        case 'lobby':
            lobby = msg;
            if (role === 'client' && view === 'menu' && msg.phase === 'lobby') enterLobby();
            else if (view === 'lobby') renderLobby();
            break;
        case 'level':
            startLevel(msg);
            break;
        case 'sts':
            if (match && me == null) onWalkerState(msg.s);
            break;
        case 'ev':
            if (match && me == null) onWalkerEvent(msg);
            break;
        case 'pg':
            onPing(msg);
            break;
        case 'sws':
            onSwitches(msg);
            break;
        case 'swno':
            onSwitchDenied(msg.i);
            break;
        case 'lvres':
            onLevelResults(msg);
            break;
        case 'final':
            showFinal(msg.results);
            break;
        case 'toLobby':
            teardownLevel();
            enterLobby();
            break;
    }
}

// ============================================================
// Lobby UI
// ============================================================
function enterLobby() {
    view = 'lobby';
    document.body.classList.toggle('is-host', role === 'host');
    document.body.classList.remove('role-eyes', 'role-legs');
    show('lobby');
    buildMenuScene();
    playMusic('menu');
    renderLobby();
}

function renderLobby() {
    const isHost = role === 'host';
    $('room-code').textContent = roomCode;
    const list = $('players');
    list.innerHTML = '';
    lobby.players.forEach((p, i) => {
        const li = el('li', 'player' + (p.id === myId ? ' me' : ''));
        const dot = el('span', 'dot');
        dot.style.background = p.color;
        const who = el('div', 'who');
        who.append(el('b', null, p.name + (p.id === myId ? ' (you)' : '')), el('small', null, i === 0 ? 'Walks levels 1, 3, 5' : 'Walks levels 2, 4, 6'));
        li.append(dot, who);
        if (p.host) li.append(el('span', 'badge host', 'Host'));
        else li.append(el('span', 'badge' + (p.ready ? ' ok' : ''), p.ready ? 'Ready' : 'Not ready'));
        if (isHost && !p.host && lobby.phase === 'lobby') {
            const x = el('button', 'kick', 'Remove');
            x.type = 'button';
            x.title = `Remove ${p.name}`;
            x.addEventListener('click', () => {
                if (confirm(`Remove ${p.name} from the room?`)) kickPlayer(p.id);
            });
            li.append(x);
        }
        list.append(li);
    });
    for (let i = lobby.players.length; i < MAX_PLAYERS; i++) list.append(el('li', 'player empty', 'Waiting for your partner...'));
    $('count').textContent = `${lobby.players.length}/${MAX_PLAYERS}`;
    const first = lobby.players[0];
    $('swap-note').textContent = lobby.players.length === 2
        ? `${first.name} walks first. You swap roles every level, 6 levels in all.`
        : 'You swap roles every level, 6 levels in all.';
    const mine = lobby.players.find(p => p.id === myId);
    if (isHost) {
        const waiting = lobby.players.filter(p => !p.host && !p.ready).map(p => p.name);
        $('btn-start').disabled = lobby.players.length < 2 || waiting.length > 0;
        if (!$('lobby-status').classList.contains('error') || lobby.players.length === 2) {
            setStatus('lobby-status', lobby.players.length < 2
                ? 'Send the invite link to a friend. This game needs two players.'
                : waiting.length ? `Waiting for ${waiting.join(', ')} to ready up` : 'Both ready. Start when you like!');
        }
    } else {
        $('btn-ready').textContent = mine && mine.ready ? 'Not ready' : 'Ready up';
        setStatus('lobby-status', mine && mine.ready ? 'Waiting for the host to start...' : 'Ready up when you are.');
    }
}

$('btn-copy').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    try {
        await navigator.clipboard.writeText(url);
        toast('Invite link copied. Send it to your partner!');
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
$('btn-lobby').addEventListener('click', () => { sfx.click(); hostBackToLobby(); });
$('btn-again').addEventListener('click', () => { sfx.click(); teardownLevel(); hostStartMatch(); });
$('btn-menu').addEventListener('click', () => { sfx.click(); leave(); });

// ============================================================
// Menu backdrop: the little walker under its lamp, watched by the eye
// ============================================================
function buildMenuScene() {
    if (menuLv) return;
    if (lv) teardownLevel();
    const L = parseLevel(MENU_LEVEL);
    menuLv = { L, lv: buildLevel(L) };
    setMode('menu');
    walkerModel.visible = true;
}
function disposeMenuScene() {
    if (!menuLv) return;
    menuLv.lv.dispose();
    menuLv = null;
}
let menuT = 0;
function updateMenuScene(dt) {
    if (!menuLv) buildMenuScene();
    menuT += dt;
    const s = menuLv.L.start;
    const cx = s.x, cz = s.z - 1;
    walkerModel.update({ x: cx, y: 0, z: cz, face: Math.sin(menuT * 0.4) * 0.6, speed: 0, grounded: true }, dt);
    menuLv.lv.update(menuT, null, [null], dt, null);
    // Wide screens: frame the walker and the eye beside the panel instead of behind it
    const wide = innerWidth > 980 && innerWidth / innerHeight > 1.3;
    const a = Math.sin(menuT * 0.1) * 0.5 + 0.35;
    const r = wide ? 8.2 : 10.5;
    menuCam.position.set(cx + Math.sin(a) * r, 3.3, cz + Math.cos(a) * r);
    menuCam.lookAt(cx, wide ? 1.7 : 2.6, cz);
    const off = wide ? -innerWidth * (view === 'lobby' ? 0.33 : 0.27) : 0;
    if (off) menuCam.setViewOffset(innerWidth, innerHeight, off, 0, innerWidth, innerHeight);
    else if (menuCam.view && menuCam.view.enabled) menuCam.clearViewOffset();
    placeEye(cx + Math.sin(menuT * 0.8) * 0.3, 3.1 + Math.sin(menuT * 1.3) * 0.15, cz - 0.6, menuCam.position.x, menuCam.position.y, menuCam.position.z);
    renderFrame(dt, menuCam, { x: cx, y: 0, z: cz });
}

// ============================================================
// Level setup and teardown
// ============================================================
function teardownLevel() {
    if (lv) { lv.dispose(); lv = null; }
    clearPings();
    for (const e of edgeEls) e.remove();
    edgeEls.length = 0;
    match = null;
    me = null;
    bot = null;
    $('center-msg').textContent = '';
    $('hud-hint').textContent = '';
    centerT = 0;
    resetJoy();
    aimEnd();
}

function startLevel(msg) {
    if (match && match.seq === msg.seq) return;  // a duplicate from the relay
    disposeMenuScene();
    teardownLevel();
    const L = parseLevel(LEVELS[msg.n], msg.n);
    const legs = msg.walker === myId;
    match = {
        n: msg.n, seq: msg.seq, walkerId: msg.walker, goAt: msg.goAt, L, S: newSwitchState(L),
        dyn: L.dyn.map(() => null), seenPings: new Set(), seenEv: new Set(), role: legs ? 'legs' : 'eyes',
        names: msg.names || {}, deaths: 0, cp: -1, finished: false, finishTime: 0, lastCount: null, started: false,
        remote: { x: L.start.x, y: 0, z: L.start.z, face: Math.PI, speed: 0, grounded: true, dead: false, net: null },
    };
    lv = buildLevel(L);
    if (legs) {
        me = newWalker(L);
        if (role === 'solo') { bot = { route: buildRoute(L), next: 0, marks: new Map(), stopping: false, lastArrow: null, arrowAt: -9 }; }
    }
    setMode(legs ? 'walker' : 'guide');
    document.body.classList.toggle('role-legs', legs);
    document.body.classList.toggle('role-eyes', !legs);
    initGuideCam(L);
    const pos = legs ? me : match.remote;
    camPos.set(pos.x, 4.3, pos.z + 5.2);
    walkerModel.visible = true;
    // HUD text
    $('role-badge').textContent = legs ? 'LEGS' : 'EYES';
    $('hud-level').textContent = `${msg.n + 1}/${LEVELS.length}`;
    $('hud-name').textContent = L.name;
    $('hud-deaths').textContent = '0';
    $('hud-time').textContent = fmtTime(0);
    // Intermission
    $('inter-level').textContent = `Level ${msg.n + 1} of ${LEVELS.length}: ${L.name}`;
    $('inter-role').innerHTML = `You are the <b>${legs ? 'LEGS' : 'EYES'}</b>`;
    $('inter-role').classList.toggle('eyes', !legs);
    const partner = Object.entries(match.names).find(([id]) => id !== myId);
    const pname = partner ? partner[1] : 'your guide';
    $('inter-sub').textContent = role === 'solo'
        ? `Practice: a helper bot is your guide. ${LEVELS[msg.n].hint}`
        : legs ? `Walk through the dark. ${pname} can see everything and will ping the way.` : `Guide ${pname} through the dark with pings. ${LEVELS[msg.n].hint}`;
    $('inter-count').textContent = '';
    view = 'inter';
    show('inter');
    playMusic('game');
}

function newWalker(L) {
    return { x: L.start.x, y: 0, z: L.start.z, vx: 0, vy: 0, vz: 0, face: Math.PI, speed: 0, grounded: true, ground: null, coyote: 0, jumpBuf: 0, dead: 0, invuln: 0, fallSound: false, stepT: 0 };
}

const levelTime = () => (match ? (hostNow() - match.goAt) / 1000 : 0);

// ============================================================
// The walker (only runs in the walker's browser)
// ============================================================
function walkerInput() {
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (joy.id !== null) { ix = joy.x; iz = joy.y; }
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    return { ix, iz };
}

function moveAxis(w, dx, dz, lt) {
    const L = match.L, S = match.S;
    const nx = w.x + dx, nz = w.z + dz, r = WALKER_R;
    const hit = (x, z) => blockedAt(L, S, lt, x - r, z - r) || blockedAt(L, S, lt, x + r, z - r) || blockedAt(L, S, lt, x - r, z + r) || blockedAt(L, S, lt, x + r, z + r);
    if (hit(nx, nz) && !hit(w.x, w.z)) return false;
    w.x = nx;
    w.z = nz;
    return true;
}

function updateWalker(dt, lt) {
    const w = me, L = match.L, S = match.S;
    if (w.dead > 0) {
        w.dead -= dt;
        if (w.dead <= 0) respawn();
        return;
    }
    w.invuln = Math.max(0, w.invuln - dt);
    const playing = lt >= 0 && !match.finished;
    const { ix, iz } = playing ? walkerInput() : { ix: 0, iz: 0 };
    const falling = w.y < -0.5;
    const accel = w.grounded ? 42 : 16;
    const tx = falling ? w.vx : ix * SPEED, tz = falling ? w.vz : iz * SPEED;
    w.vx += clamp(tx - w.vx, -accel * dt, accel * dt);
    w.vz += clamp(tz - w.vz, -accel * dt, accel * dt);
    // Belts push you, platforms carry you
    let px = 0, pz = 0;
    if (w.grounded && w.ground) {
        if (w.ground.kind === 'conv') { px = w.ground.tile.dir[0] * 2.4; pz = w.ground.tile.dir[1] * 2.4; }
        if (w.ground.kind === 'plat') {
            const a = platPos(w.ground.plat, lt - dt), b = platPos(w.ground.plat, lt);
            px = (b.x - a.x) / dt;
            pz = (b.z - a.z) / dt;
        }
    }
    moveAxis(w, (w.vx + px) * dt, 0, lt);
    moveAxis(w, 0, (w.vz + pz) * dt, lt);
    // Jumping with a little forgiveness either side
    w.coyote = w.grounded ? 0.1 : w.coyote - dt;
    w.jumpBuf -= dt;
    if (wantJump && playing) w.jumpBuf = 0.14;
    wantJump = false;
    if (w.jumpBuf > 0 && w.coyote > 0 && playing) {
        w.vy = JUMP_V;
        w.coyote = 0;
        w.jumpBuf = 0;
        w.grounded = false;
        sfx.jump();
        fx.dust(w.x, w.z, 5);
    }
    w.vy -= GRAVITY * dt;
    w.y += w.vy * dt;
    const g = groundAt(L, S, match.dyn, lt, w.x, w.z);
    const wasGrounded = w.grounded;
    if (g && w.y <= 0 && w.y > -0.45) {
        if (!wasGrounded && w.vy < -4) { sfx.land(); fx.dust(w.x, w.z, 6); }
        w.y = 0;
        w.vy = 0;
        w.grounded = true;
        w.ground = g;
    } else {
        w.grounded = false;
        w.ground = null;
    }
    w.groundBelow = !!g;
    w.speed = Math.hypot(w.vx, w.vz);
    if (w.speed > 0.6 && playing) w.face = Math.atan2(w.vx, w.vz);
    if (w.grounded && w.speed > 2) {
        w.stepT -= dt;
        if (w.stepT <= 0) { w.stepT = 0.28; sfx.step(); if (Math.random() < 0.5) fx.dust(w.x, w.z, 1); }
    }
    // Fake and cracked tiles give way under you
    if (w.grounded && g && g.tile && (g.kind === 'fake' || g.kind === 'crack')) {
        const k = g.tile.dyn, ph = dynPhase(g.tile, match.dyn[k], lt);
        if (ph === 'solid' || ph === 'reset') {
            match.dyn[k] = lt;
            sfx.crack();
            sendEv({ e: 'tile', i: k, at: +lt.toFixed(3) });
        }
    }
    if (!playing) return;
    if (w.y < -0.6 && !w.fallSound) { w.fallSound = true; sfx.fall(); }
    if (w.y < -6) return die('fall');
    if (w.invuln <= 0 && hazardHit(L, S, lt, w.x, w.y, w.z)) return die('hit');
    const tile = w.grounded ? tileAt(L, w.x, w.z) : null;
    if (tile && tile.kind === 'cp' && tile.cp > match.cp) {
        match.cp = tile.cp;
        lv.setCheckpoint(tile.cp);
        sfx.checkpoint();
        fx.sparkle(tile.x, 0.2, tile.z);
        centerMsg('CHECKPOINT', null, 'good', 1.1);
        sendEv({ e: 'cp', i: tile.cp });
    }
    if (tile && tile.kind === 'goal' && Math.hypot(w.x - tile.x, w.z - tile.z) < 1.05) reachGoal(lt);
}

function die(how) {
    const w = me;
    if (w.dead > 0) return;
    match.deaths++;
    w.dead = 1.15;
    if (how === 'hit') { fx.burst(w.x, w.y, w.z); shake = 0.6; }
    sfx.death();
    const f = $('flash');
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 70);
    centerMsg(how === 'fall' ? 'FELL!' : 'OUCH!', null, 'bad', 0.9);
    walkerModel.visible = false;
    sendEv({ e: 'die', d: match.deaths, x: +w.x.toFixed(2), y: +w.y.toFixed(2), z: +w.z.toFixed(2), how });
}

function respawn() {
    const w = me, L = match.L;
    const at = match.cp >= 0 ? L.cps[match.cp] : L.start;
    Object.assign(w, { x: at.x, y: 0, z: at.z + 0.2, vx: 0, vy: 0, vz: 0, grounded: true, dead: 0, invuln: 1.2, fallSound: false, face: Math.PI });
    walkerModel.visible = true;
    camPos.set(w.x, 4.3, w.z + 5.2);
    fx.sparkle(w.x, 0.1, w.z, 0xffd23f, 30);
    sfx.respawn();
    sendEv({ e: 'spawn', x: w.x, z: w.z });
}

function reachGoal(lt) {
    if (match.finished) return;
    match.finished = true;
    match.finishTime = lt;
    sfx.goal();
    fx.confetti(match.L.goal.x, 0.2, match.L.goal.z);
    centerMsg('GOAL!', null, 'gold', 2);
    me.vx = me.vz = 0;
    me.face = Math.PI;
    act({ t: 'goal', n: match.n, time: +lt.toFixed(2), deaths: match.deaths });
}

function sendEv(e) {
    e.t = 'ev';
    e.n = match.n;
    e.k = ++evSeq;
    sendWalker(e);
}

// Compact state packet: [level, x, y, z, face, speed, grounded, deaths, dead, finished]
function sendState(dt) {
    sendAcc += dt;
    if (sendAcc < SEND_EVERY) return;
    sendAcc = 0;
    const w = me;
    const s = [match.n, +w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2), +w.face.toFixed(2), +w.speed.toFixed(1), w.grounded ? 1 : 0, match.deaths, w.dead > 0 ? 1 : 0, match.finished ? 1 : 0];
    if (role === 'client') net.send({ t: 'st', s });
    else if (role === 'host' && net) net.broadcast({ t: 'sts', s });
}

// ============================================================
// The guide's side: showing the walker and their events
// ============================================================
function onWalkerState(s) {
    if (!match || !Array.isArray(s) || s[0] !== match.n) return;
    const r = match.remote;
    const [, x, y, z, face, speed, grounded, deaths, dead, fin] = s;
    if (![x, y, z].every(isFinite)) return;
    r.net = { x, y, z, t: performance.now() };
    r.face = face;
    r.speed = speed;
    r.grounded = !!grounded;
    r.dead = !!dead;
    if (deaths > match.deaths) match.deaths = deaths;
    if (fin) match.finished = true;
}

function onWalkerEvent(e) {
    if (!match || e.n !== match.n) return;
    const key = e.k != null ? e.k : JSON.stringify(e);
    if (match.seenEv.has(key)) return;
    match.seenEv.add(key);
    const r = match.remote;
    if (e.e === 'tile' && match.L.dyn[e.i]) {
        match.dyn[e.i] = +e.at;
    } else if (e.e === 'die') {
        match.deaths = Math.max(match.deaths, e.d | 0);
        if (e.how === 'hit') fx.burst(e.x, e.y, e.z);
        sfx.death();
        r.dead = true;
    } else if (e.e === 'spawn') {
        r.x = e.x; r.z = e.z; r.y = 0;
        r.net = { x: e.x, y: 0, z: e.z, t: performance.now() };
        r.dead = false;
        fx.sparkle(e.x, 0.1, e.z, 0xffd23f, 30);
    } else if (e.e === 'cp') {
        match.cp = Math.max(match.cp, e.i);
        lv.setCheckpoint(match.cp);
        const t = match.L.cps[e.i];
        if (t) fx.sparkle(t.x, 0.2, t.z);
        sfx.checkpoint();
    }
}

function interpolateRemote(dt) {
    const r = match.remote, n = r.net;
    if (!n) return;
    const k = 1 - Math.exp(-14 * dt);
    if (Math.hypot(n.x - r.x, n.z - r.z) > 4) { r.x = n.x; r.z = n.z; r.y = n.y; }
    r.x += (n.x - r.x) * k;
    r.z += (n.z - r.z) * k;
    r.y += (n.y - r.y) * k;
}

// ============================================================
// Pings
// ============================================================
function onPing(msg) {
    if (!match || msg.n !== match.n || match.seenPings.has(msg.id)) return;
    match.seenPings.add(msg.id);
    if (!PING_KINDS.includes(msg.k)) return;
    addPing({ k: msg.k, x: msg.x, z: msg.z, dx: msg.dx, dz: msg.dz });
    sfx.ping(msg.k);
    if (match.role === 'legs') match.lastPingKinds = [...(match.lastPingKinds || []), msg.k].slice(-10);
}

let tool = 'arrow';
function setTool(k) {
    tool = k;
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.k === k);
}
for (const b of document.querySelectorAll('.tool')) {
    b.addEventListener('click', e => { setTool(b.dataset.k); sfx.click(); e.currentTarget.blur(); });
}

function sendPing(k, x, z, dx, dz) {
    if (!match || match.role !== 'eyes' || view !== 'play') return false;
    const now = performance.now();
    if (now - lastPingSent < PING_GAP) {
        const b = document.querySelector('.tool.on');
        if (b) { b.classList.add('cool'); setTimeout(() => b.classList.remove('cool'), 200); }
        return false;
    }
    lastPingSent = now;
    act({ t: 'pg', k, x, z, dx, dz, cs: ++pingCs });
    return true;
}

function sendSwitch(i) {
    if (!match || match.role !== 'eyes' || view !== 'play') return;
    act({ t: 'sw', i, cs: ++swCs });
}

function onSwitches(msg) {
    if (!match || msg.n !== match.n || msg.seq <= match.S.seq) return;
    match.S = { seq: msg.seq, list: JSON.parse(JSON.stringify(msg.list)) };
    const sw = match.L.switches[msg.who];
    if (!sw) return;
    const st = match.S.list[msg.who];
    const on = sw.kind === 'pause' || st.on;
    (on ? sfx.switchOn : sfx.switchOff)();
    if (sw.kind !== 'pause') sfx.door();
    if (match.role === 'legs') {
        const text = sw.kind === 'door' ? (on ? 'The guide opened a door' : 'The guide closed a door')
            : sw.kind === 'bridge' ? `The guide extended a bridge (${sw.dur}s)` : `The guide froze the traps (${sw.dur}s)`;
        toast(text);
    }
}

function onSwitchDenied() {
    sfx.denied();
    toast('That switch is still busy. Try again in a moment.');
}

// ============================================================
// Practice bot: a simple guide that reads the level data
// ============================================================
let bot = null;
function botSay(k, x, z, dx = 0, dz = -1) {
    hostPing({ k, x, z, dx, dz });
}
function botGuide(lt) {
    if (!bot || lt < 0 || me.dead > 0 || match.finished) return;
    const L = match.L, S = match.S, R = bot.route;
    const here = tileAt(L, me.x, me.z);
    // Flip switches when the walker gets close to what they control
    L.switches.forEach((sw, i) => {
        const st = S.list[i];
        if (sw.kind === 'pause') {
            const near = L.hazards.some(h => h.grp === sw.id && Math.hypot(h.x - me.x, h.z - me.z) < 4.5);
            if (near && lt > st.at + sw.dur + 2.2) hostSwitch(myId, { i });
        } else {
            const targets = sw.kind === 'door' ? L.doors : L.bridges;
            const near = targets.some(t => t.sw === sw.id && Math.hypot(t.x - me.x, t.z - me.z) < 5.5);
            if (near && !switchActive(L, S, sw.id, lt + 1)) hostSwitch(myId, { i });
        }
    });
    if (lt < bot.next || !here) return;
    let cur = here;
    if (!R.next[cur.i]) {
        // Off the route (e.g. on a platform): steer back to the nearest routed tile
        let best = null, bd = Infinity;
        for (const t of L.tiles) {
            if (!R.next[t.i] && t !== L.goal) continue;
            const d = Math.hypot(t.x - me.x, t.z - me.z);
            if (d < bd) { bd = d; best = t; }
        }
        if (!best) return;
        cur = best;
    }
    const s1 = R.next[cur.i];
    if (!s1) return;
    const t1 = L.tiles[s1.to];
    const s2 = R.next[t1.i];
    const t2 = s2 ? L.tiles[s2.to] : t1;
    const mark = (key, gap) => {
        const last = bot.marks.get(key);
        if (last != null && lt - last < gap) return false;
        bot.marks.set(key, lt);
        return true;
    };
    // Fake tiles right next to the walker or the next step
    for (const base of [cur, t1]) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const t = tileRC(L, base.c + dc, base.r + dr);
            if (t && t.kind === 'fake' && mark('f' + t.i, 6)) { botSay('danger', t.x, t.z); bot.next = lt + 0.8; return; }
        }
    }
    // A gap to jump
    if (s1.jump) {
        const gx = (cur.x + t1.x) / 2, gz = (cur.z + t1.z) / 2;
        if (Math.hypot(gx - me.x, gz - me.z) < 3.2 && mark('j' + cur.i, 2.5)) { botSay('jump', gx, gz); bot.next = lt + 0.7; return; }
    }
    // Traps: stop, jump over blades, go when clear
    let danger = null;
    for (const t of [t1, t2]) {
        const h = tileDanger(L, S, lt, t, 0.8, t === t1 ? me.x : undefined);
        if (h) { danger = h; break; }
    }
    const platWait = s1.plat && (() => { const q = platPos(s1.plat, lt); return Math.hypot(q.x - t1.x, q.z - t1.z) > 0.7; })();
    const blocked = (t1.kind === 'door' || t1.kind === 'bridge') && !switchActive(L, S, t1.sw, lt);
    if (danger && danger.type === 'blade') {
        if (mark('b', 1.4)) { botSay('jump', me.x, me.z - 1); bot.next = lt + 0.5; return; }
    } else if (danger || platWait || blocked) {
        if (!bot.stopping || mark('s', 1.6)) {
            bot.stopping = true;
            bot.marks.set('s', lt);
            botSay('stop', me.x, me.z - 1.2);
            bot.next = lt + 0.6;
            return;
        }
    } else if (bot.stopping) {
        bot.stopping = false;
        botSay('go', t1.x, t1.z);
        bot.next = lt + 0.6;
        return;
    }
    const dx = t2.x - t1.x || t1.x - cur.x, dz = t2.z - t1.z || t1.z - cur.z;
    const key = `${t1.i}`;
    if ((bot.lastArrow !== key && lt - bot.arrowAt > 1.2) || lt - bot.arrowAt > 3) {
        bot.lastArrow = key;
        bot.arrowAt = lt;
        botSay('arrow', t1.x, t1.z, dx, dz);
        bot.next = lt + 0.9;
    }
}

// ============================================================
// Level results and the end of the run
// ============================================================
function onLevelResults(msg) {
    if (!match || msg.n !== match.n || view === 'lvres') return;
    if (!match.finished) {
        match.finished = true;
        if (match.role === 'eyes') { fx.confetti(match.L.goal.x, 0.2, match.L.goal.z); sfx.goal(); }
    }
    match.finishTime = msg.time;
    view = 'lvres';
    // Let the goal celebration play for a moment before the panel covers it
    const n = match.n;
    setTimeout(() => { if (match && match.n === n && view === 'lvres') show('lvres'); }, 1300);
    $('lvres-kicker').textContent = `Level ${msg.n + 1} cleared`;
    $('lvres-title').textContent = match.L.name;
    $('lvres-stars').innerHTML = starsSvg(msg.stars);
    for (let i = 0; i < msg.stars; i++) setTimeout(() => sfx.star(i), 1500 + i * 180);
    $('lvres-time').textContent = fmtTime(msg.time);
    $('lvres-deaths').textContent = String(msg.deaths);
    const next = $('lvres-next');
    if (msg.last) next.textContent = 'That was the last level!';
    else if (role === 'solo') next.innerHTML = 'Next up: you are the <b class="legs">LEGS</b> again';
    else {
        const nextLegs = match.role === 'eyes';
        next.innerHTML = `Next up: you are the <b class="${nextLegs ? 'legs' : 'eyes'}">${nextLegs ? 'LEGS' : 'EYES'}</b>`;
    }
    const bar = $('lvres-bar');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${RESULTS_MS - 1600}ms linear 1300ms`;
    bar.style.transform = 'scaleX(0)';
    playMusic('results');
}

function showFinal(results) {
    if (view === 'final') return;
    teardownLevel();
    buildMenuScene();
    view = 'final';
    document.body.classList.remove('role-eyes', 'role-legs');
    show('final');
    const rows = $('final-rows');
    rows.innerHTML = '';
    let time = 0, deaths = 0, stars = 0;
    for (const r of results) {
        time += r.time;
        deaths += r.deaths;
        stars += r.stars;
        const tr = el('tr');
        tr.append(el('td', null, `${r.n + 1}. ${LEVELS[r.n].name}`), el('td', null, r.walker), el('td', null, fmtTime(r.time)), el('td', null, String(r.deaths)));
        const td = el('td', 'mini-stars');
        td.innerHTML = miniStars(r.stars);
        tr.append(td);
        rows.append(tr);
    }
    const max = LEVELS.length * 3;
    $('final-time').textContent = fmtTime(time);
    $('final-deaths').textContent = String(deaths);
    $('final-starcount').textContent = `${stars}/${max}`;
    $('final-stars').innerHTML = starsSvg(Math.round(stars / max * 3));
    $('final-title').textContent = stars === max ? 'Perfect run!' : role === 'solo' ? 'Practice complete!' : 'You made it together!';
    // Best totals for this device
    const key = role === 'solo' ? 'eyesBestSolo' : 'eyesBestDuo';
    let best = null;
    try { best = JSON.parse(store.get(key)); } catch (e) { best = null; }
    const notes = [];
    if (results.length === LEVELS.length) {
        const nb = { time: best ? Math.min(best.time, time) : time, deaths: best ? Math.min(best.deaths, deaths) : deaths, stars: best ? Math.max(best.stars, stars) : stars };
        if (best && time < best.time) notes.push('New best time!');
        if (best && stars > best.stars) notes.push('New star record!');
        store.set(key, JSON.stringify(nb));
        best = nb;
    }
    $('final-best').textContent = notes.length ? notes.join(' ') : best ? `Best: ${fmtTime(best.time)}, ${best.deaths} falls, ${best.stars} stars` : '';
    playMusic('results');
}

// ============================================================
// Cameras
// ============================================================
const camPos = new THREE.Vector3();
const G = { x: 0, z: 0, zoom: 24, cx: 0, cz: 0, czoom: 24, follow: true, fit: false };

function defaultZoom(L) {
    const aspect = innerWidth / innerHeight;
    return clamp(Math.max(22, (Math.min(L.width, 16) + 2) / aspect), 16, 40);
}
function fitZoom(L) {
    const aspect = innerWidth / innerHeight;
    return Math.max((L.depth + 3) * Math.cos(TILT) + 6, (L.width + 3) / aspect) * 1.18;
}
function initGuideCam(L) {
    G.zoom = G.czoom = defaultZoom(L);
    G.x = G.cx = L.start.x;
    G.z = G.cz = L.start.z - 4;
    G.follow = true;
    G.fit = false;
    syncViewBtns();
}
function syncViewBtns() {
    $('btn-follow').classList.toggle('on', G.follow && !G.fit);
    $('btn-fit').classList.toggle('on', G.fit);
}
$('btn-follow').addEventListener('click', e => { G.follow = true; G.fit = false; syncViewBtns(); sfx.click(); e.currentTarget.blur(); });
$('btn-fit').addEventListener('click', e => { G.fit = !G.fit; if (!G.fit) G.follow = true; syncViewBtns(); sfx.click(); e.currentTarget.blur(); });

function updateGuideCam(dt, pos) {
    const L = match.L;
    let tx = G.x, tz = G.z, tzoom = G.zoom;
    if (G.fit) {
        tx = (L.cols - 1) * T / 2;
        tz = (L.rows - 1) * T / 2 + 1;
        tzoom = fitZoom(L);
    } else if (G.follow && pos) {
        G.x = tx = pos.x;
        G.z = tz = pos.z - G.zoom * 0.12;
    }
    const k = 1 - Math.exp(-5 * dt);
    G.cx += (tx - G.cx) * k;
    G.cz += (tz - G.cz) * k;
    G.czoom += (tzoom - G.czoom) * k;
    const aspect = innerWidth / innerHeight;
    const h = G.czoom / 2, w = h * aspect;
    if (guideCam.top !== h || guideCam.right !== w) {
        guideCam.left = -w; guideCam.right = w; guideCam.top = h; guideCam.bottom = -h;
        guideCam.updateProjectionMatrix();
    }
    guideCam.position.set(G.cx, Math.cos(TILT) * 80, G.cz + Math.sin(TILT) * 80);
    guideCam.lookAt(G.cx, 0, G.cz);
    aimSun(G.cx, G.cz, G.czoom * Math.max(1, aspect));
}

let celebT = 0;
function updateWalkerCam(dt, pos) {
    const y = Math.max(pos.y, -1.2);
    if (match.finished) {
        // Swing round to the front for a little victory shot
        celebT += dt;
        // Goals sit on the top row, so the space just north of them is always open
        const a = Math.sin(celebT * 0.7) * 0.5;
        const target = new THREE.Vector3(pos.x + Math.sin(a) * 4, y + 2.3, pos.z - Math.cos(a) * 4);
        camPos.lerp(target, 1 - Math.exp(-4 * dt));
        walkerCam.position.copy(camPos);
        walkerCam.lookAt(pos.x, y + 0.9, pos.z);
        return;
    }
    celebT = 0;
    // Tall portrait screens get a wider, higher view so the whole pool of light still fits across
    const p = clamp((1 - innerWidth / innerHeight) / 0.55, 0, 1);
    const fov = 56 + 30 * p;
    if (Math.abs(walkerCam.fov - fov) > 0.1) { walkerCam.fov = fov; walkerCam.updateProjectionMatrix(); }
    const up = 3.7 + 2.6 * p, back = 5.0 + 0.6 * p;
    const target = new THREE.Vector3(pos.x, y + up, pos.z + back);
    camPos.lerp(target, 1 - Math.exp(-7 * dt));
    walkerCam.position.copy(camPos);
    if (shake > 0) {
        walkerCam.position.x += (Math.random() - 0.5) * shake * 0.5;
        walkerCam.position.y += (Math.random() - 0.5) * shake * 0.5;
        shake = Math.max(0, shake - dt * 2);
    }
    walkerCam.lookAt(camPos.x, camPos.y - up + 0.2, camPos.z - back - 2.8 + 1.0 * p);
}

// ============================================================
// HUD, center messages, edge arrows
// ============================================================
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

const edgeEls = [];
const projV = new THREE.Vector3();
const EDGE_SVG = '<svg viewBox="0 0 24 24"><path d="M3 12 20 3l-4 9 4 9z" fill="currentColor"/></svg>';
function updateEdges(cam) {
    const list = match && match.role === 'legs' ? activePings() : [];
    while (edgeEls.length < list.length) {
        const d = el('div', 'edge-arrow');
        d.innerHTML = EDGE_SVG;
        $('edges').append(d);
        edgeEls.push(d);
    }
    const W = innerWidth, Hh = innerHeight, m = 34;
    edgeEls.forEach((d, i) => {
        const p = list[i];
        if (!p) { d.style.display = 'none'; return; }
        projV.set(p.x, 1, p.z).project(cam);
        let sx = (projV.x + 1) / 2 * W, sy = (1 - projV.y) / 2 * Hh;
        const behind = projV.z > 1;
        if (behind) { sx = W - sx; sy = Hh - sy; }
        const on = !behind && sx > m && sx < W - m && sy > m && sy < Hh - m;
        if (on) { d.style.display = 'none'; return; }
        const cx = W / 2, cy = Hh / 2;
        let dx = sx - cx, dy = sy - cy;
        if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
        const s = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (Hh / 2 - m) / Math.abs(dy || 1e-6));
        const ex = cx + dx * s, ey = cy + dy * s;
        d.style.display = '';
        d.style.color = '#' + PING_COLORS[p.k].toString(16).padStart(6, '0');
        d.style.opacity = String(clamp((3 - p.age) / 0.5, 0, 1));
        d.style.transform = `translate(${ex}px, ${ey}px) rotate(${Math.atan2(dy, dx) + Math.PI}rad)`;
    });
}

function updateHud(lt) {
    const t = match.finished ? match.finishTime : Math.max(0, lt);
    $('hud-time').textContent = fmtTime(t);
    $('hud-deaths').textContent = String(match.deaths);
    const hint = $('hud-hint');
    let text = '';
    if (lt >= 0 && lt < 9 && !match.finished) {
        if (match.role === 'legs') text = role === 'solo' ? 'Follow the glowing pings. The bot guide can see what you can\'t.' : 'Follow the glowing pings. Your guide can see what you can\'t.';
        else text = document.body.classList.contains('touch') ? 'Pick a ping, then tap the map. Drag with the arrow to point. Tap switches to use them.' : 'Pick a ping (1-5) and click the map. Drag to aim arrows. Click switches. Scroll to zoom, right-drag to pan.';
    } else if (match.role === 'legs' && me && me.dead > 0) text = match.cp >= 0 ? 'Back to the last checkpoint...' : 'Back to the start...';
    if (hint.textContent !== text) hint.textContent = text;
}

// ============================================================
// Input
// ============================================================
const keys = {};
let wantJump = false;
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (match && (view === 'play' || view === 'inter')) {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (match.role === 'legs' && e.code === 'Space' && !e.repeat) wantJump = true;
        if (match.role === 'eyes') {
            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= 5) setTool(PING_KINDS[n - 1]);
            if (e.code === 'KeyF') { G.fit = !G.fit; if (!G.fit) G.follow = true; syncViewBtns(); }
            if (e.code === 'Space') { G.follow = true; G.fit = false; syncViewBtns(); }
        }
    }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    resetJoy();
});

// Touch: floating joystick anywhere for the walker
const JOY_R = 55;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function resetJoy() {
    joy.id = null;
    joy.x = joy.y = 0;
    $('joy').classList.remove('on');
    $('joy-knob').style.transform = '';
}
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
$('btn-jump').addEventListener('pointerdown', e => {
    e.preventDefault();
    wantJump = true;
    e.currentTarget.classList.add('down');
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('btn-jump').addEventListener(ev, e => e.currentTarget.classList.remove('down'));

// Guide: tap or click to ping, drag to aim arrows; two fingers (or right-drag and the wheel) move the map
const pointers = new Map();
let aim = null, pinch = null;
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitV = new THREE.Vector3();
function screenToWorld(x, y) {
    const ndc = new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, guideCam);
    return ray.ray.intersectPlane(plane, hitV) ? { x: hitV.x, z: hitV.z } : null;
}
function worldToScreen(x, y, z, cam) {
    projV.set(x, y, z).project(cam);
    return { x: (projV.x + 1) / 2 * innerWidth, y: (1 - projV.y) / 2 * innerHeight };
}
const aimEl = el('div');
aimEl.style.cssText = 'position:fixed;left:0;top:0;height:6px;border-radius:3px;background:#38e1ff;box-shadow:0 0 12px #38e1ff;transform-origin:0 50%;pointer-events:none;display:none;z-index:6';
document.body.append(aimEl);
function aimEnd() { aim = null; aimEl.style.display = 'none'; }
const isGuide = () => match && match.role === 'eyes' && view === 'play';
function panBy(dxPx, dyPx) {
    const upp = G.czoom / innerHeight;
    G.follow = false;
    G.fit = false;
    G.x = G.cx - dxPx * upp;
    G.z = G.cz - dyPx * upp / Math.cos(TILT);
    G.cx = G.x;
    G.cz = G.z;
    G.zoom = G.czoom;
    syncViewBtns();
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') document.body.classList.add('touch');
    e.preventDefault();
    unlockAudio();
    if (match && match.role === 'legs' && e.pointerType === 'touch') {
        if (joy.id !== null) return;
        joy.id = e.pointerId;
        joy.ox = e.clientX;
        joy.oy = e.clientY;
        const j = $('joy');
        j.style.left = `${joy.ox}px`;
        j.style.top = `${joy.oy}px`;
        j.classList.add('on');
        return;
    }
    if (!isGuide()) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false });
    if (pointers.size === 2) {
        aimEnd();
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, zoom: G.czoom };
        for (const p of pointers.values()) p.moved = true;
        return;
    }
    if (e.button !== 0) return;
    const w = screenToWorld(e.clientX, e.clientY);
    if (w) aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w };
});
canvas.addEventListener('pointermove', e => {
    if (e.pointerId === joy.id) {
        let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
        joy.x = dx / JOY_R;
        joy.y = dy / JOY_R;
        $('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
        return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 12) p.moved = true;
    if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        panBy(mx - pinch.mx, my - pinch.my);
        pinch.mx = mx;
        pinch.my = my;
        G.zoom = G.czoom = clamp(pinch.zoom * pinch.d / Math.max(20, d), 10, fitZoom(match.L) * 1.1);
        return;
    }
    // Right or middle drag always pans; with a non-arrow tool, a one-finger drag pans too
    if (p.button !== 0) { panBy(p.x - px, p.y - py); return; }
    if (!aim || aim.id !== e.pointerId) return;
    if (tool !== 'arrow') {
        if (p.moved) { panBy(p.x - px, p.y - py); aim.panned = true; }
    } else {
        const dx = p.x - aim.sx, dy = p.y - aim.sy, len = Math.hypot(dx, dy);
        if (len > 12) {
            aimEl.style.display = 'block';
            aimEl.style.width = `${len}px`;
            aimEl.style.transform = `translate(${aim.sx}px, ${aim.sy - 3}px) rotate(${Math.atan2(dy, dx)}rad)`;
        } else aimEl.style.display = 'none';
    }
});
function endPointer(e) {
    if (e.pointerId === joy.id) { resetJoy(); return; }
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!p || !aim || aim.id !== e.pointerId || e.type === 'pointercancel') { if (aim && aim.id === e.pointerId) aimEnd(); return; }
    const a = aim;
    aimEnd();
    if (!isGuide() || a.panned) return;
    const L = match.L;
    // Switches take priority over pings
    if (!p.moved) {
        let best = -1, bd = 1.6;
        L.switches.forEach((sw, i) => {
            const d = Math.hypot(sw.x - a.w.x, sw.z - a.w.z);
            const s = worldToScreen(sw.x, 2.5, sw.z, guideCam);
            const ds = Math.hypot(s.x - p.x, s.y - p.y) / innerHeight * G.czoom;
            const dd = Math.min(d, ds);
            if (dd < bd) { bd = dd; best = i; }
        });
        if (best >= 0) { sendSwitch(best); return; }
    }
    if (tool === 'arrow') {
        const end = screenToWorld(p.x, p.y);
        let dx = 0, dz = -1;
        if (p.moved && end && Math.hypot(end.x - a.w.x, end.z - a.w.z) > 0.3) { dx = end.x - a.w.x; dz = end.z - a.w.z; }
        else {
            const r = match.remote;
            if (Math.hypot(a.w.x - r.x, a.w.z - r.z) > 0.8) { dx = a.w.x - r.x; dz = a.w.z - r.z; }
        }
        sendPing('arrow', a.w.x, a.w.z, dx, dz);
    } else if (!p.moved) {
        sendPing(tool, a.w.x, a.w.z, 0, -1);
    }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
    if (!isGuide()) return;
    e.preventDefault();
    G.fit = false;
    G.zoom = G.czoom = clamp(G.czoom * Math.exp(e.deltaY * 0.0012), 10, fitZoom(match.L) * 1.1);
    syncViewBtns();
}, { passive: false });

// Arrow keys / WASD pan the guide's map
function guideKeys(dt) {
    const dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const dz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (!dx && !dz) return;
    const sp = G.czoom * 0.9 * dt;
    G.follow = false;
    G.fit = false;
    G.x = G.cx + dx * sp;
    G.z = G.cz + dz * sp;
    G.zoom = G.czoom;
    syncViewBtns();
}

// ============================================================
// Main loop
// ============================================================
function updateMatch(dt) {
    const lt = levelTime();
    if (view === 'inter') {
        const n = Math.ceil(-lt);
        if (lt < 0 && n <= 3 && n !== match.lastCount) {
            match.lastCount = n;
            const c = $('inter-count');
            c.textContent = String(n);
            c.classList.remove('pop');
            void c.offsetWidth;
            c.classList.add('pop');
            sfx.count();
        }
        if (lt >= 0) {
            view = 'play';
            show('hud');
            centerMsg('GO!', null, 'good', 0.9);
            sfx.go();
        }
    }
    const legs = match.role === 'legs';
    if (legs) {
        // Hazards run on the real clock, so the walker is sub-stepped to keep up even at low frame rates
        const steps = Math.min(4, Math.ceil(dt / 0.034));
        for (let i = 1; i <= steps; i++) updateWalker(dt / steps, lt - dt + (dt * i) / steps);
        sendState(dt);
        if (role === 'solo' && view === 'play') botGuide(lt);
    } else {
        interpolateRemote(dt);
        if (view === 'play') guideKeys(dt);
    }
    const pos = legs ? me : match.remote;
    const dead = legs ? me.dead > 0 : match.remote.dead;
    walkerModel.visible = !dead;
    walkerModel.update({ x: pos.x, y: pos.y, z: pos.z, face: pos.face, speed: pos.speed, grounded: pos.grounded, groundBelow: legs ? me.groundBelow : true }, dt);
    lv.update(lt, match.S, match.dyn, dt, legs ? null : pos);
    let cam;
    if (legs) { updateWalkerCam(dt, pos); cam = walkerCam; }
    else { updateGuideCam(dt, pos); cam = guideCam; }
    updateHud(lt);
    updateEdges(cam);
    renderFrame(dt, cam, pos);
}

let last = performance.now();
function frame(now) {
    const dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    if (match && lv && (view === 'inter' || view === 'play' || view === 'lvres')) updateMatch(dt);
    else updateMenuScene(dt);
    if (centerT > 0) {
        centerT -= dt;
        if (centerT <= 0) $('center-msg').textContent = '';
    }
    requestAnimationFrame(frame);
}

// Read-only peek plus test helpers for automated tests; only exists with #debug in the URL
if (location.hash === '#debug') {
    window.eyesDebug = {
        state() {
            const w = me || (match && match.remote);
            return {
                view, role, myId, roomCode, players: lobby.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
                level: match ? match.n : null, myRole: match ? match.role : null, lt: match ? levelTime() : null,
                walker: w ? { x: w.x, y: w.y, z: w.z, dead: me ? me.dead > 0 : !!w.dead } : null,
                deaths: match ? match.deaths : null, cp: match ? match.cp : null, finished: match ? match.finished : null,
                pings: activePings().map(p => ({ k: p.k, x: p.x, z: p.z, age: p.age })),
                pingKinds: match ? match.lastPingKinds || [] : [],
                switches: match ? match.S.list.map(s => ({ on: s.on, until: s.until })) : [],
                darkOn: DARK.on.value, badge: $('role-badge').textContent, clockOffset,
                guideMarksVisible: lv ? lv.guideGroup.visible : null,
                plats: match ? match.L.plats.map(p => platPos(p, levelTime())) : [],
                haz: match ? match.L.hazards.map(h => {
                    const t = hazTime(match.L, match.S, h, levelTime());
                    return { type: h.type, x: h.x, z: h.z, on: h.type === 'laser' ? laserOn(h, t) : undefined, warn: h.type === 'laser' ? laserWarn(h, t) : undefined, y: h.type === 'crusher' ? crusherY(h, t) : undefined, hx: h.type === 'hammer' ? hammerHead(h, t).x : undefined, a: h.type === 'blade' ? bladeAngle(h, t) : undefined };
                }) : [],
                hudHidden: $('hud').classList.contains('hidden'),
            };
        },
        level() {
            if (!match) return null;
            const L = match.L;
            return {
                cols: L.cols, rows: L.rows, start: [L.start.x, L.start.z], goal: [L.goal.x, L.goal.z],
                cps: L.cps.map(t => [t.x, t.z]), fakes: L.dyn.filter(t => t.kind === 'fake').map(t => [t.x, t.z]),
                switches: L.switches.map(s => ({ kind: s.kind, x: s.x, z: s.z })), doors: L.doors.map(t => [t.x, t.z]),
            };
        },
        // Screen position of a world point in whatever camera is active
        screen(x, y, z) {
            const cam = match ? (match.role === 'legs' ? walkerCam : guideCam) : menuCam;
            return worldToScreen(x, y, z, cam);
        },
        teleport(where) {
            if (!me || !match) return false;
            const L = match.L;
            let t = null;
            if (where === 'goal') t = L.goal;
            else if (where === 'start') t = L.start;
            else if (typeof where === 'number') t = L.cps[where];
            else if (where && typeof where === 'object') t = where;
            if (!t) return false;
            Object.assign(me, { x: t.x, y: 0, z: t.z, vx: 0, vy: 0, vz: 0, dead: 0, invuln: 1 });
            camPos.set(me.x, 4.3, me.z + 5.2);
            return true;
        },
    };
}

show('menu');
buildMenuScene();
playMusic('menu');
requestAnimationFrame(frame);
