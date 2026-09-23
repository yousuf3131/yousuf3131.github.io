// Bonk Racers: online multiplayer arcade racing.
//
// Networking model: one player hosts the room in their browser, everyone else connects to them.
// Every browser simulates its own vehicle and shares where it is; the host runs the lobby,
// the vote, the bots and the results, and relays everyone's positions to everyone else.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js';
import { COURSES, COURSE_BY_ID, buildTrack, drawCourseMap } from './track.js';
import { VEHICLES, VEHICLE_BY_ID, ATK_TIME, buildVehicleModel, animateModel, stepPhysics, findAttackTarget } from './vehicles.js';
import { sfx, engine, unlockAudio, setMuted, isMuted } from './audio.js';

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
// Renderer, scene, sky, lights
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 160, 680);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

{
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    const pos = geo.attributes.position, cols = [];
    const top = new THREE.Color('#4a86d8'), mid = new THREE.Color('#9fcaf2'), hor = new THREE.Color('#ffd9b0');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 1000;
        if (y > 0.22) c.copy(mid).lerp(top, (y - 0.22) / 0.78);
        else c.copy(hor).lerp(mid, clamp((y + 0.02) / 0.24, 0, 1));
        cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
}
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x3d5a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ============================================================
// Garage: the turntable you see on the menu and in the lobby
// ============================================================
const garage = new THREE.Group();
{
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x33443c, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x1b2420, roughness: 0.6 }));
    plate.position.y = 0.15;
    plate.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.05, 8, 72), new THREE.MeshStandardMaterial({ color: 0x2ec495, emissive: 0x2ec495, emissiveIntensity: 1.2 }));
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

let track = null;
const racers = new Map();
let me = null;
let raceClock = 0, lastCount = null, sendAcc = 0, wantAttack = false;
let camH = 0, shake = 0, wrongT = 0, centerT = 0, voteEnds = 0;
const camPos = new THREE.Vector3();

// Host-only state
const H = {
    players: new Map(), phase: 'lobby', votes: new Map(), states: new Map(),
    finished: [], bonks: {}, course: null,
    voteTimer: null, endTimer: null, doneTimer: null,
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'vote', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
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
    store.set('bonkName', myName);
    return true;
}

async function createRoom() {
    if (busy || !readName()) return;
    unlockAudio();
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
    setBusy(true);
    setStatus('menu-status', `Joining room ${code}...`);
    const cn = new ClientNet({
        onMessage: clientHandle,
        onClose: () => { if (net === cn) leave('The host closed the room.'); },
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
    act({ t: 'hello', name: myName, vehicle: myVehicle });
    setStatus('menu-status', 'Connected. Loading the garage...');
}

function startSolo() {
    if (busy || !readName()) return;
    unlockAudio();
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
        const p = { id: from, name: cleanName(msg.name), vehicle: VEHICLE_BY_ID[msg.vehicle] ? msg.vehicle : 'bubble', ready: false, bot: false, color: nextColor() };
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
            if (H.phase === 'lobby' && VEHICLE_BY_ID[msg.v]) { p.vehicle = msg.v; broadcastLobby(); }
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
            if (H.phase === 'race') {
                const target = msg.target && H.players.has(msg.target) ? msg.target : null;
                if (target) H.bonks[from] = (H.bonks[from] || 0) + 1;
                emit({ t: 'atk', from, target, side: msg.side === -1 ? -1 : 1 });
            }
            break;
        case 'fin':
            recordFinish(from, +msg.time || 0);
            break;
    }
}

function rejectPeer(id, reason) {
    net.send(id, { t: 'reject', reason });
    setTimeout(() => net && net.kick(id), 600);
}

function hostLeave(id) {
    const p = H.players.get(id);
    if (!p) return;
    H.players.delete(id);
    H.votes.delete(id);
    H.states.delete(id);
    emit({ t: 'toast', text: `${p.name} left` });
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
    buildVehicleCards();
    renderLobby();
}

function statList(v) {
    return [['Speed', v.top / 44], ['Accel', v.accel / 28], ['Grip', v.grip / 7.5], ['Weight', v.mass / 1.7]];
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
    act({ t: 'pick', v: id });
    buildVehicleCards();
    updateShowcase();
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
        if (isHost && p.bot && lobby.phase === 'lobby') {
            const x = el('button', 'kick', '×');
            x.type = 'button';
            x.title = 'Remove bot';
            x.addEventListener('click', () => removeBot(p.id));
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
    if (!showcase || showcase.vid !== v.id || showcase.color !== color) {
        const h = showcase ? showcase.state.h : 0.5;
        if (showcase) garage.remove(showcase.model.root);
        const model = buildVehicleModel(v, color);
        garage.add(model.root);
        showcase = { vid: v.id, color, model, state: { x: 0, z: 0, h, steer: 0, lean: 0, wheelSpin: 0, atkT: 0, atkSide: 1, stunT: 0, speed: 0 } };
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
        x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, speed: 0, steer: 0, lean: 0, wheelSpin: 0,
        idx: g.i, dist: g.dist, lat: 0, fwdDot: 0, lap: 0, half: true, fin: false, finTime: 0, place: 0, rank: 1,
        atkT: 0, atkSide: 1, cd: 1.5, stunT: 0, spin: 0, boostT: 0, catchup: 1,
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
    for (const id of [...racers.keys()]) removeRacer(id);
    me = null;
    if (track) {
        scene.remove(track.group);
        track.dispose();
        track = null;
    }
    $('pops').innerHTML = '';
    $('center-msg').textContent = '';
    $('wrong-way').classList.add('hidden');
    centerT = 0;
}

function startRace(msg) {
    teardownRace();
    const course = COURSE_BY_ID[msg.course] || COURSES[0];
    track = buildTrack(course);
    scene.add(track.group);
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
        $('touch-attack').textContent = me.cfg.kind === 'car' ? 'SLAM' : me.cfg.shape === 'dirt' ? 'KICK' : 'WHACK';
    }
    setupMinimap();
    view = 'race';
    show('hud');
    toast(`${course.name}: ${course.laps} laps`);
}

// ============================================================
// Race simulation
// ============================================================
function playerInput() {
    let steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    if (document.body.classList.contains('touch')) {
        // Phones: always accelerate, steer with the joystick, pull it down to brake
        throttle = joy.id !== null && joy.y > 0.5 ? -1 : 1;
        if (joy.id !== null) steer = clamp(joy.x * 1.4, -1, 1);
    }
    return { steer, throttle };
}

function botInput(r, dt, list) {
    const la = 8 + Math.abs(r.speed) * 0.5;
    const tp = track.pointAhead(r.idx, la, r.botLane);
    const d = angleDiff(r.h, Math.atan2(tp.z - r.z, tp.x - r.x));
    let steer = clamp(d * 2.4, -1, 1);
    const curve = track.curvatureAhead(r.idx, 18 + Math.abs(r.speed) * 0.6);
    const skill = r.fin ? 0.75 : r.botSkill;
    const maxSpeed = r.cfg.top * skill * (1 - clamp(curve * 0.55, 0, 0.5));
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
    return { steer, throttle };
}

function tryAttack(r, list) {
    if (r.cd > 0 || r.stunT > 0 || raceClock < 0) return;
    const hit = findAttackTarget(r, list.filter(o => o !== r));
    r.cd = r.cfg.attack.cd;
    r.atkT = ATK_TIME;
    r.atkSide = hit.side;
    const msg = { t: 'atk', target: hit.target ? hit.target.id : null, side: hit.side };
    if (r === me) act(msg);
    else hostHandle(r.id, msg);
    if (!hit.target && r === me) sfx.whoosh();
}

function onAttack(msg) {
    const a = racers.get(msg.from);
    if (!a) return;
    if (!a.owned) { a.atkT = ATK_TIME; a.atkSide = msg.side; }
    if (!msg.target) return;
    const v = racers.get(msg.target);
    if (!v) return;
    const vol = me ? clamp(1 - Math.hypot(v.x - me.x, v.z - me.z) / 90, 0.12, 1) : 1;
    (sfx[a.cfg.attack.sound] || sfx.bonk)(vol);
    popWord(v, a.cfg.attack.word, a.color);
    if (v.owned) {
        // Shove the victim sideways, away from the attacker, and set them spinning
        const f = a.cfg.attack.force / v.cfg.mass;
        const rx = -Math.sin(a.h), rz = Math.cos(a.h);
        v.vx += rx * msg.side * f;
        v.vz += rz * msg.side * f;
        v.speed *= 0.6;
        v.stunT = 1.0;
        v.spin = msg.side * rand(4, 7) * (v.cfg.kind === 'bike' ? 1.3 : 1);
    }
    if (v === me) {
        shake = 0.8;
        const f = $('hit-flash');
        f.classList.add('on');
        setTimeout(() => f.classList.remove('on'), 60);
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
    if (msg.id === myId) centerMsg(`${msg.place}${ordinal(msg.place)}`, msg.place === 1 ? 'YOU WIN! WAITING FOR THE OTHERS...' : 'FINISHED! WAITING FOR THE OTHERS...', msg.place === 1 ? 'gold' : 'go', Infinity);
    else toast(`${r.name} finished ${msg.place}${ordinal(msg.place)}`);
}

// Compact position packet: [id, x, z, heading, vx, vz, lap, dist, steer, attacking, stunned, finished]
function pack(r) {
    return [r.id, +r.x.toFixed(2), +r.z.toFixed(2), +r.h.toFixed(3), +r.vx.toFixed(2), +r.vz.toFixed(2), r.lap, Math.round(r.dist * 10) / 10, +r.steer.toFixed(2), r.atkT > 0 ? 1 : 0, r.stunT > 0 ? 1 : 0, r.fin ? 1 : 0];
}

function applyStates(arr) {
    const now = performance.now();
    for (const s of arr) {
        const r = racers.get(s[0]);
        if (!r || r.owned) continue;
        const [, x, z, h, vx, vz, lap, dist, steer, , stun, fin] = s;
        if (!r.net) { r.x = x; r.z = z; r.h = h; }
        r.net = { x, z, h, vx, vz, t: now };
        r.lap = lap;
        r.dist = dist;
        r.steer = steer;
        r.stunT = stun ? 0.2 : 0;
        if (fin) r.fin = true;
    }
}

function interpolateRemote(r, dt) {
    const n = r.net;
    const age = Math.min(0.25, (performance.now() - n.t) / 1000);
    const px = n.x + n.vx * age, pz = n.z + n.vz * age;
    const k = 1 - Math.exp(-12 * dt);
    if (Math.hypot(px - r.x, pz - r.z) > 12) { r.x = px; r.z = pz; }
    else { r.x += (px - r.x) * k; r.z += (pz - r.z) * k; }
    r.h = lerpAngle(r.h, n.h, k);
    r.vx = n.vx;
    r.vz = n.vz;
    r.speed = Math.hypot(n.vx, n.vz);
    r.wheelSpin += (r.speed * dt) / 0.42;
    const sf = clamp(r.speed / r.cfg.top, 0, 1);
    r.lean = r.cfg.kind === 'bike' ? r.steer * sf * 0.5 : -r.steer * sf * 0.06;
    if (r.stunT > 0) r.stunT = Math.max(0, r.stunT - dt * 0.2);
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
    }
    const racing = raceClock >= 0;
    const list = [...racers.values()];
    const ranked = rankRacers(list);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    track.update(dt);

    for (const r of list) {
        if (r.atkT > 0) r.atkT = Math.max(0, r.atkT - dt);
        if (r.owned) {
            r.cd = Math.max(0, r.cd - dt);
            let input = { steer: 0, throttle: 0 };
            if (racing) input = r === me && !r.fin ? playerInput() : botInput(r, dt, list);
            if (r === me && wantAttack && racing && !r.fin) tryAttack(r, list);
            // Gentle catch-up so the pack stays close
            r.catchup = 1 + 0.02 * Math.min(5, r.rank - 1);
            const prev = r.dist;
            const ev = stepPhysics(r, input, dt, track, list.filter(o => o !== r));
            if (r === me) {
                if (ev.boost) sfx.boost();
                if (ev.bump > 6) { sfx.bump(); shake = Math.max(shake, Math.min(0.5, ev.bump / 30)); }
            }
            if (racing) updateLap(r, prev);
        } else if (r.net) {
            interpolateRemote(r, dt);
        }
        animateModel(r.model, r, dt);
    }
    wantAttack = false;
    sendStates(dt);
    updateCamera(dt);
    updateTags();
    if (view === 'race') updateHud(ranked, dt);
    engine.set(me ? clamp(Math.abs(me.speed) / me.cfg.top, 0, 1.3) : 0, view === 'race' && !!me);
}

// ============================================================
// Camera, HUD, minimap, floating text
// ============================================================
function updateCamera(dt) {
    const target = me || racers.values().next().value;
    if (!target) return;
    if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camH = lerpAngle(camH, target.h, 1 - Math.exp(-4 * dt));
    const back = target.cfg.kind === 'bike' ? 8 : 9;
    camPos.lerp(new THREE.Vector3(target.x - Math.cos(camH) * back, 3.7, target.z - Math.sin(camH) * back), 1 - Math.exp(-8 * dt));
    camera.position.copy(camPos);
    if (shake > 0) {
        camera.position.x += rand(-shake, shake) * 0.4;
        camera.position.y += rand(-shake, shake) * 0.4;
        shake = Math.max(0, shake - dt * 2);
    }
    camera.lookAt(target.x + Math.cos(camH) * 6, 1.3, target.z + Math.sin(camH) * 6);
    const fov = 62 + clamp(Math.abs(target.speed) / target.cfg.top, 0, 1.35) * 12;
    if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
        camera.updateProjectionMatrix();
    }
    sun.position.set(target.x - 30, 70, target.z + 25);
    sun.target.position.set(target.x, 0, target.z);
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
        const s = toScreen(r.x, r.cfg.kind === 'car' ? 2.9 : 3.2, r.z);
        const vis = s.visible && d < 110;
        r.tag.style.display = vis ? '' : 'none';
        if (vis) {
            r.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
            r.tag.style.opacity = d > 70 ? String((110 - d) / 40) : '1';
        }
    }
}

function popWord(r, word, color) {
    const s = toScreen(r.x, 2.6, r.z);
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

    if (raceClock > 1 && !me.fin && me.fwdDot < -4) wrongT += dt; else wrongT = 0;
    $('wrong-way').classList.toggle('hidden', wrongT < 0.8);
    drawMinimap();
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
    mm = { ctx: c.getContext('2d'), dpr, sc, ox, oz, path, size };
}

function drawMinimap() {
    const { ctx, dpr, sc, ox, oz, path, size } = mm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 9;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke(path);
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
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (view === 'race') {
        if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'ShiftLeft') wantAttack = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    }
});
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

// ============================================================
// Main loop
// ============================================================
const compactLayout = () => innerWidth <= 1000 || innerHeight <= 560;

function updateGarage(dt) {
    const compact = view === 'lobby' && compactLayout();
    camera.position.set(0, 2.3, compact ? 12 : 8.6);
    camera.lookAt(0, 0.95, 0);
    if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix(); }
    // On phones the lobby stacks vertically with the car in the top band, so shift the render up
    const lift = compact ? Math.max(0, innerHeight / 2 - (70 + innerHeight * 0.22)) : 0;
    if (lift) camera.setViewOffset(innerWidth, innerHeight, 0, lift, innerWidth, innerHeight);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    sun.position.set(-8, 16, 10);
    sun.target.position.set(0, 0, 0);
    if (!showcase) updateShowcase();
    const s = showcase.state;
    s.h += dt * 0.45;
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
}

let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (track && racers.size && (view === 'race' || view === 'results')) updateRace(dt);
    else updateGarage(dt);
    if (view === 'vote') $('vote-timer').textContent = Math.max(0, Math.ceil((voteEnds - now) / 1000));
    if (centerT > 0 && centerT !== Infinity) {
        centerT -= dt;
        if (centerT <= 0) $('center-msg').textContent = '';
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

show('menu');
updateShowcase();
requestAnimationFrame(frame);
