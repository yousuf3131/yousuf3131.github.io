// Tanks: main menu, campaign entry, and online "Battle" mode.
//
// Battle authority model (same as Bonk Racers):
//  - Every browser simulates its own tank and sends its position ~20 times a second.
//    The host simulates the bots and relays everyone's positions to everyone.
//  - The shooter's browser spawns a bullet and broadcasts a fire event; every browser then
//    runs that bullet with the same wall and ricochet rules.
//  - A tank's own browser decides when it has been hit and broadcasts its death.
//  - Crates and mine explosions are decided by the host and relayed to everyone.
//  - The host tallies kills and round wins.
import { HostNet, ClientNet, makeCode } from './net.js?v=2';
import * as G from './game.js?v=2';
import { ARENAS } from './maps.js?v=2';
import { sfx, audio, store } from './audio.js?v=2';
import { updateBot, BOT_CFG } from './bots.js?v=2';

const { $, rand } = G;
const MAX_PLAYERS = 8;
const WIN_ROUNDS = 3;
const COUNTDOWN_MS = 3000;
const SEND_EVERY = 0.05;       // 20 position updates a second (the relay halves this)
const INVULN = 1.2;            // spawn protection after GO
const ROUND_LIMIT = 150;       // a round that drags on this long is a draw
const COLORS = ['#3b82f6', '#e0584f', '#f2c14e', '#a78bfa', '#f97316', '#ec4899', '#e2e8f0', '#22d3ee'];
const BOT_NAMES = ['Sarge', 'Rusty', 'Boomer', 'Clank', 'Dozer', 'Gunner', 'Tread', 'Major Mayhem'];
const PLAYER_CFG = G.TYPES.player;

// ============================================================
// Small helpers
// ============================================================
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function toast(text) {
    const t = el('div', 'toast', text);
    $('toasts').append(t);
    setTimeout(() => t.remove(), 3300);
}
function setStatus(id, text, isError) {
    const s = $(id);
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
}
const cleanName = s => (String(s || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player');
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
const lerpAngle = (a, b, k) => a + G.angleDiff(a, b) * k;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

// ============================================================
// Session state
// ============================================================
let role = null;      // 'host' | 'client' | 'solo'
let net = null;
let myId = null;
let myName = store.get('tanksName') || '';
let roomCode = '';
let view = 'main';    // 'main' | 'campaign' | 'lobby' | 'battle' | 'results'
let lobby = { players: [], phase: 'lobby' };

// The current round, as every browser sees it
const R = {
    n: 0, arena: 0, clock: 0, lastCount: null, players: [],
    byId: new Map(), tags: new Map(), seenB: new Set(), seenM: new Set(),
    wins: {}, kills: {}, sendAcc: 0, bulletN: 0, mineN: 0, aliveShown: -1,
};

// Host-only state
const H = {
    players: new Map(), phase: 'lobby', round: 0, wins: {}, kills: {},
    dead: new Set(), roster: [], ending: false, live: false, roundT: 0,
    states: new Map(), endTimer: null, nextTimer: null,
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['main', 'lobby', 'results', 'bmenu']) $(s).classList.toggle('hidden', s !== id);
    const scr = id === 'main' ? 'main' : view;
    for (const c of ['scr-main', 'scr-campaign', 'scr-lobby', 'scr-battle', 'scr-results']) document.body.classList.remove(c);
    document.body.classList.add(`scr-${scr}`);
}

function showMain(reason) {
    view = 'main';
    show('main');
    G.hideBanner();
    setStatus('menu-status', reason || '', !!reason);
}

// ============================================================
// Main menu
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
    for (const id of ['btn-create', 'btn-join', 'btn-solo', 'btn-campaign']) $(id).disabled = b;
}
function readName() {
    if (!$('name').value.trim()) {
        setStatus('menu-status', 'Enter your name first.', true);
        $('name').focus();
        return false;
    }
    myName = cleanName($('name').value);
    store.set('tanksName', myName);
    return true;
}

async function createRoom() {
    if (busy || !readName()) return;
    audio();
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
    audio();
    setBusy(true);
    setStatus('menu-status', `Joining room ${code}...`);
    const cn = new ClientNet({
        onMessage: clientHandle,
        onClose: () => { if (net === cn) leave('The host left or the connection dropped, so the room has closed.'); },
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
    act({ t: 'hello', name: myName });
    setStatus('menu-status', 'Connected. Waiting for the host...');
    // If the host never answers (e.g. they closed the room), don't leave the player hanging
    setTimeout(() => {
        if (net === cn && view === 'main') leave("The host didn't answer. Ask them to create a new room and send you the new code.");
    }, 15000);
}

function startSolo() {
    if (busy || !readName()) return;
    audio();
    role = 'solo';
    myId = 'host';
    roomCode = 'SOLO';
    hostInit();
    for (let i = 0; i < 3; i++) addBot();
    enterLobby();
}

function openCampaign() {
    if (busy) return;
    audio();
    view = 'campaign';
    show('campaign');
    G.openCampaignMenu();
}
G.hooks.toMain = () => {
    G.showBackdrop();
    showMain();
};

function leave(reason) {
    const n = net;
    net = null;
    if (n) n.close();
    clearTimeout(H.endTimer);
    clearTimeout(H.nextTimer);
    H.players.clear();
    H.phase = 'lobby';
    role = null;
    myId = null;
    roomCode = '';
    lobby = { players: [], phase: 'lobby' };
    clearTags();
    R.byId.clear();
    R.players = [];
    document.body.classList.remove('is-host');
    G.showBackdrop();
    showMain(reason);
}

$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('btn-campaign').addEventListener('click', openCampaign);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('exit').addEventListener('click', e => {
    e.currentTarget.blur();
    if (view === 'main') location.href = '../projects.html';
    else if (view === 'campaign') G.hooks.toMain();
    else if (confirm(role === 'host' ? 'Leave and close this room for everyone?' : role === 'solo' ? 'Leave this battle?' : 'Leave this room?')) leave();
});
addEventListener('pagehide', () => { if (net) net.close(); });

// ============================================================
// Messaging: act() goes to the host, emit() is the host telling everyone (itself included)
// ============================================================
function act(msg) {
    if (role === 'client') { if (net) net.send(msg); }
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
    H.phase = 'lobby';
    H.players.set(myId, { id: myId, name: myName, color: COLORS[0], ready: true, bot: false, host: true });
    broadcastLobby();
}

function nextColor() {
    const used = new Set([...H.players.values()].map(p => p.color));
    return COLORS.find(c => !used.has(c)) || COLORS[H.players.size % COLORS.length];
}

function broadcastLobby() {
    emit({ t: 'lobby', code: roomCode, phase: H.phase, players: [...H.players.values()] });
}

// Only the tank's own browser may speak for it; the host also speaks for the bots
const speaksFor = (from, id) => id === from || (from === myId && !!(H.players.get(id) || {}).bot);

function hostHandle(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
        if (H.players.has(from)) return;
        if (H.players.size >= MAX_PLAYERS) return rejectPeer(from, 'That room is full (8 tanks max).');
        if (H.phase !== 'lobby') return rejectPeer(from, 'A battle is in progress in that room. Try again when it ends.');
        const p = { id: from, name: cleanName(msg.name), color: nextColor(), ready: false, bot: false };
        H.players.set(from, p);
        net.send(from, { t: 'welcome', you: from, code: roomCode });
        emit({ t: 'toast', text: `${p.name} joined the room` });
        broadcastLobby();
        return;
    }
    const p = H.players.get(from);
    if (!p) return;
    const inRound = H.phase === 'match' && msg.r === H.round;
    switch (msg.t) {
        case 'ready':
            if (H.phase === 'lobby') { p.ready = !!msg.r; broadcastLobby(); }
            break;
        case 'st':
            if (H.phase === 'match' && Array.isArray(msg.s) && msg.s[0] === from && msg.s[7] === H.round) {
                H.states.set(from, msg.s);
                applyStates([msg.s]);
            }
            break;
        case 'fire':
        case 'mine':
            if (inRound && speaksFor(from, msg.o)) emit(msg);
            break;
        case 'die':
            if (inRound && speaksFor(from, msg.id)) hostDeath(msg);
            break;
    }
}

function rejectPeer(id, reason) {
    net.send(id, { t: 'reject', reason });
    setTimeout(() => net && net.kick(id), 600);
}

function hostLeave(id, how = 'left the room') {
    const p = H.players.get(id);
    if (!p) return;
    H.players.delete(id);
    H.states.delete(id);
    emit({ t: 'toast', text: `${p.name} ${how}` });
    if (H.phase === 'match') {
        emit({ t: 'left', id });
        if (H.players.size < 2) {
            hostResults('Everyone else left, so the battle is over.');
            return;
        }
        hostCheckRound();
    }
    broadcastLobby();
}

function addBot() {
    if (H.players.size >= MAX_PLAYERS || H.phase !== 'lobby') return;
    const used = new Set([...H.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${H.players.size}`;
    const id = `bot-${Math.random().toString(36).slice(2, 8)}`;
    H.players.set(id, { id, name, color: nextColor(), ready: true, bot: true });
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
    hostLeave(id, 'was removed from the room');
}

function hostStart() {
    if (H.phase !== 'lobby') return;
    if (H.players.size < 2) return toast('Invite a friend or add a bot first.');
    const waiting = [...H.players.values()].filter(p => !p.bot && !p.host && !p.ready);
    if (waiting.length) return toast(`Waiting for ${waiting.map(p => p.name).join(', ')}`);
    H.phase = 'match';
    H.round = 0;
    H.wins = {};
    H.kills = {};
    for (const id of H.players.keys()) { H.wins[id] = 0; H.kills[id] = 0; }
    broadcastLobby();
    hostNextRound();
}

function hostNextRound() {
    if (H.phase !== 'match') return;
    H.round++;
    H.dead = new Set();
    H.ending = false;
    H.live = true;
    H.roundT = 0;
    H.states.clear();
    const ids = shuffle([...H.players.keys()]);
    H.roster = ids;
    const slots = {};
    ids.forEach((id, i) => { slots[id] = String(i + 1); });
    emit({
        t: 'round', n: H.round, arena: (H.round - 1) % ARENAS.length, ms: COUNTDOWN_MS,
        players: [...H.players.values()].map(({ id, name, color, bot }) => ({ id, name, color, bot })),
        slots, wins: H.wins, kills: H.kills,
    });
}

function hostDeath(msg) {
    if (!H.live || H.dead.has(msg.id)) return;
    H.dead.add(msg.id);
    const by = msg.by && msg.by !== msg.id && H.players.has(msg.by) ? msg.by : null;
    if (by) H.kills[by] = (H.kills[by] || 0) + 1;
    emit({ t: 'dead', r: H.round, id: msg.id, by: msg.by || null, b: msg.b || null, x: msg.x, z: msg.z, kills: H.kills });
    hostCheckRound();
}

const hostAlive = () => H.roster.filter(id => H.players.has(id) && !H.dead.has(id));

function hostCheckRound() {
    if (!H.live || H.ending) return;
    if (hostAlive().length <= 1) {
        H.ending = true;
        // A short grace period so near-simultaneous deaths still count
        H.endTimer = setTimeout(hostEndRound, 1200);
    }
}

function hostEndRound() {
    if (!H.live) return;
    H.live = false;
    const alive = hostAlive();
    const winner = alive.length === 1 ? alive[0] : null;
    if (winner) H.wins[winner] = (H.wins[winner] || 0) + 1;
    const wp = winner ? H.players.get(winner) : null;
    emit({ t: 'roundEnd', r: H.round, winner, name: wp ? wp.name : null, wins: H.wins, kills: H.kills });
    const champ = winner && H.wins[winner] >= WIN_ROUNDS;
    clearTimeout(H.nextTimer);
    H.nextTimer = setTimeout(() => (champ ? hostResults() : hostNextRound()), 3500);
}

function hostResults(note) {
    clearTimeout(H.endTimer);
    clearTimeout(H.nextTimer);
    H.live = false;
    H.phase = 'results';
    const list = [...H.players.values()]
        .map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: H.wins[p.id] || 0, kills: H.kills[p.id] || 0 }))
        .sort((a, b) => b.wins - a.wins || b.kills - a.kills);
    emit({ t: 'results', list, note: note || '' });
    broadcastLobby();
}

function hostBackToLobby() {
    if (H.phase !== 'results') return;
    H.phase = 'lobby';
    for (const p of H.players.values()) p.ready = p.bot || !!p.host;
    emit({ t: 'toLobby' });
    broadcastLobby();
}

function hostTick(dt) {
    if (!H.live) return;
    H.roundT += dt;
    if (H.roundT > ROUND_LIMIT && !H.ending) {
        H.ending = true;
        // Time is up: nobody takes the round
        H.dead = new Set(H.roster);
        hostEndRound();
    }
}

// ============================================================
// Messages everyone handles (the host handles its own emits too)
// ============================================================
function clientHandle(msg) {
    if (!msg || typeof msg !== 'object') return;
    const thisRound = msg.r === R.n && view === 'battle';
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
            if (view === 'main' && role === 'client' && msg.phase === 'lobby') enterLobby();
            else if (view === 'lobby') renderLobby();
            break;
        case 'round':
            startRound(msg);
            break;
        case 'sts':
            if (role === 'client' && view === 'battle') applyStates(msg.a);
            break;
        case 'fire':
            if (thisRound) onFire(msg);
            break;
        case 'mine':
            if (thisRound) onMine(msg);
            break;
        case 'boom':
            if (thisRound) onBoom(msg);
            break;
        case 'crate':
            if (thisRound) G.breakWood(msg.row, msg.col);
            break;
        case 'dead':
            if (thisRound) onDead(msg);
            break;
        case 'left':
            onLeft(msg);
            break;
        case 'roundEnd':
            if (thisRound) onRoundEnd(msg);
            break;
        case 'results':
            showResults(msg);
            break;
        case 'toLobby':
            enterLobby();
            break;
    }
}

// ============================================================
// Lobby
// ============================================================
function enterLobby() {
    view = 'lobby';
    document.body.classList.toggle('is-host', role !== 'client');
    show('lobby');
    G.hideBanner();
    G.setMode('battle');
    G.setState('lobby');
    R.n = 0;
    lobbyKey = '';
    renderLobby();
}

// The arena behind the lobby, with everyone's tank parked on a spawn point
let lobbyKey = '';
function buildLobbyScene() {
    const key = lobby.players.map(p => p.id + p.color).join('|');
    if (key === lobbyKey) return;
    lobbyKey = key;
    clearTags();
    R.byId.clear();
    const spawns = G.loadArena(ARENAS[0].map);
    lobby.players.forEach((p, i) => {
        const sp = spawns[String(i + 1)];
        const t = G.makeBattleTank({ id: p.id, color: p.color, cfg: PLAYER_CFG, x: sp.x, z: sp.z, facing: Math.atan2(-sp.z, -sp.x) });
        Object.assign(t, { pid: p.id, name: p.name, owned: false, invulnT: 0 });
        R.byId.set(p.id, t);
        makeTag(t);
    });
    G.setPlayer(null);
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
        li.append(dot, el('span', 'who', p.name + (p.id === myId ? ' (you)' : '')));
        if (p.host) li.append(el('span', 'badge host', 'Host'));
        else if (p.bot) li.append(el('span', 'badge', 'Bot'));
        else li.append(el('span', 'badge' + (p.ready ? ' ok' : ''), p.ready ? 'Ready' : 'Not ready'));
        if (isHost && !p.host && lobby.phase === 'lobby') {
            const x = el('button', 'kick', 'Remove');
            x.type = 'button';
            x.title = p.bot ? 'Remove this bot' : `Remove ${p.name} from the room`;
            x.addEventListener('click', () => {
                sfx.click();
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
        $('btn-start').disabled = waiting.length > 0 || lobby.players.length < 2;
        setStatus('lobby-status', waiting.length
            ? `Waiting for ${waiting.join(', ')} to ready up`
            : lobby.players.length < 2 ? (role === 'solo' ? 'Add a bot to battle.' : 'Invite friends or add bots, then start.') : 'Everyone is ready. Start when you like!');
    } else {
        $('btn-ready').textContent = mine && mine.ready ? 'Not ready' : 'Ready up';
        setStatus('lobby-status', mine && mine.ready ? 'Waiting for the host to start...' : 'Ready up when you are set.');
    }
    if (view === 'lobby') buildLobbyScene();
}

$('btn-copy').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    try {
        await navigator.clipboard.writeText(url);
        toast('Invite link copied. Send it to your friends!');
    } catch (e) {
        setStatus('lobby-status', `Invite link: ${url}`);
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
// Rounds
// ============================================================
function makeTag(t) {
    const tag = el('div', 'ntag' + (t.pid === myId ? ' me' : ''), t.name);
    tag.style.color = t.cfg.color;
    $('tags').append(tag);
    R.tags.set(t.pid, tag);
}
function clearTags() {
    for (const tag of R.tags.values()) tag.remove();
    R.tags.clear();
}

function startRound(msg) {
    view = 'battle';
    show('battle');
    G.setMode('battle');
    G.clearInput();
    clearTags();
    R.byId.clear();
    R.seenB.clear();
    R.seenM.clear();
    Object.assign(R, {
        n: msg.n, arena: msg.arena, clock: -msg.ms / 1000, lastCount: null,
        players: msg.players, wins: msg.wins, kills: msg.kills, sendAcc: 0, aliveShown: -1,
    });
    const arena = ARENAS[msg.arena] || ARENAS[0];
    const spawns = G.loadArena(arena.map);
    for (const p of msg.players) {
        const sp = spawns[msg.slots[p.id]];
        if (!sp) continue;
        const t = G.makeBattleTank({
            id: p.id, color: p.color, cfg: p.bot ? BOT_CFG : PLAYER_CFG,
            x: sp.x, z: sp.z, facing: Math.atan2(-sp.z, -sp.x), isPlayer: p.id === myId,
        });
        Object.assign(t, { pid: p.id, name: p.name, bot: p.bot, owned: p.id === myId || (role !== 'client' && p.bot), net: null, invulnT: 0, target: null });
        R.byId.set(p.id, t);
        makeTag(t);
    }
    const me = R.byId.get(myId) || null;
    G.setPlayer(me);
    if (me) G.setCursorColor(me.cfg.color);
    G.setState('intro');
    $('banner').classList.remove('long');
    G.showBanner(`ROUND ${msg.n}`, '3', arena.name);
    $('b-round').textContent = msg.n;
    R.aliveShown = R.byId.size;
    $('b-alive').textContent = R.byId.size;
    renderScoreboard();
}

// ---------- Hooks the engine calls during a battle ----------
G.hooks.fired = (t, b) => {
    b.id = `${t.pid}.${++R.bulletN}`;
    R.seenB.add(b.id);
    act({ t: 'fire', r: R.n, id: b.id, o: t.pid, x: r3(b.x), z: r3(b.z), vx: r3(b.vx), vz: r3(b.vz), n: b.bounces });
};
G.hooks.mined = (t, m) => {
    m.id = `${t.pid}.m${++R.mineN}`;
    R.seenM.add(m.id);
    act({ t: 'mine', r: R.n, id: m.id, o: t.pid, x: r3(m.x), z: r3(m.z) });
};
G.hooks.bulletHit = (t, b) => {
    G.removeBullet(b);
    // Remote tanks: wait for their own browser to say whether they died
    if (!t.owned || G.state !== 'play' || t.invulnT > 0) return;
    killOwned(t, b.owner ? b.owner.pid : null, b.id || null);
};
G.hooks.blast = (t, m) => {
    if (!t.owned || G.state !== 'play' || t.invulnT > 0) return;
    killOwned(t, m.owner ? m.owner.pid : null, null);
};
G.hooks.crate = (r, c) => {
    // The host decides which crates break and tells everyone
    if (role !== 'client' && G.breakWood(r, c)) emit({ t: 'crate', r: R.n, row: r, col: c });
};
G.hooks.mineHit = m => {
    if (role !== 'client') G.detonate(m);
};
G.hooks.detonated = m => {
    if (role !== 'client') emit({ t: 'boom', r: R.n, id: m.id, x: r3(m.x), z: r3(m.z) });
};
G.hooks.killed = t => {
    const tag = R.tags.get(t.pid);
    if (tag) tag.style.display = 'none';
};

function killOwned(t, by, bulletId) {
    G.killTank(t);
    act({ t: 'die', r: R.n, id: t.pid, by, b: bulletId, x: r2(t.x), z: r2(t.z) });
}

// ---------- Network events ----------
function onFire(msg) {
    if (R.seenB.has(msg.id)) return;
    R.seenB.add(msg.id);
    const owner = R.byId.get(msg.o) || null;
    if (owner && owner.alive) owner.turret_a = Math.atan2(msg.vz, msg.vx);
    G.spawnBullet(owner, msg.x, msg.z, msg.vx, msg.vz, msg.n, msg.id);
}

function onMine(msg) {
    if (R.seenM.has(msg.id)) return;
    R.seenM.add(msg.id);
    G.spawnMine(R.byId.get(msg.o) || null, msg.x, msg.z, msg.id);
}

function onBoom(msg) {
    let m = G.mines.find(x => x.id === msg.id);
    if (!m) {
        // We never saw this mine arrive; blow it up where the host says it was
        if (R.seenM.has(msg.id)) return;
        R.seenM.add(msg.id);
        m = G.spawnMine(null, msg.x, msg.z, msg.id);
    }
    G.detonate(m);
}

function onDead(msg) {
    R.kills = msg.kills || R.kills;
    const t = R.byId.get(msg.id);
    if (msg.b) {
        const b = G.bullets.find(x => x.id === msg.b);
        if (b) G.removeBullet(b);
    }
    if (t && t.alive) {
        // Put the wreck where the owner saw it die
        if (typeof msg.x === 'number') { t.x = msg.x; t.z = msg.z; }
        G.killTank(t);
    }
    const victim = nameOf(msg.id), killer = msg.by && msg.by !== msg.id ? nameOf(msg.by) : null;
    if (msg.id === myId) toast(killer ? `${killer} destroyed you` : 'You destroyed yourself');
    else if (msg.by === myId && killer) toast(`You destroyed ${victim}`);
    else toast(killer ? `${killer} destroyed ${victim}` : `${victim} was destroyed`);
    renderScoreboard();
}

function onLeft(msg) {
    const t = R.byId.get(msg.id);
    if (t) {
        if (t.alive) G.vanishPuff(t.x, t.z);
        G.removeTank(t);
        R.byId.delete(msg.id);
    }
    const tag = R.tags.get(msg.id);
    if (tag) { tag.remove(); R.tags.delete(msg.id); }
    R.players = R.players.filter(p => p.id !== msg.id);
    renderScoreboard();
}

function onRoundEnd(msg) {
    G.setState('roundover');
    R.wins = msg.wins;
    R.kills = msg.kills;
    const champ = msg.winner && msg.wins[msg.winner] >= WIN_ROUNDS;
    $('banner').classList.add('long');
    if (!msg.winner) G.showBanner(`ROUND ${msg.n || R.n}`, 'DRAW', 'Nobody survived');
    else if (msg.winner === myId) G.showBanner(`ROUND ${R.n}`, 'YOU WIN', champ ? 'That takes the match' : `First to ${WIN_ROUNDS} takes the match`);
    else G.showBanner(`ROUND ${R.n}`, `${msg.name} WINS`, champ ? 'That takes the match' : `First to ${WIN_ROUNDS} takes the match`);
    sfx.go();
    renderScoreboard();
}

function nameOf(id) {
    const p = R.players.find(q => q.id === id) || lobby.players.find(q => q.id === id);
    return p ? p.name : 'Someone';
}

function renderScoreboard() {
    const ol = $('scoreboard');
    ol.innerHTML = '';
    const list = [...R.players].sort((a, b) => (R.wins[b.id] || 0) - (R.wins[a.id] || 0));
    for (const p of list) {
        const t = R.byId.get(p.id);
        const li = el('li', (p.id === myId ? 'me' : '') + (t && !t.alive ? ' out' : ''));
        const dot = el('span', 'dot');
        dot.style.background = p.color;
        const pips = el('span', 'pips');
        for (let i = 0; i < WIN_ROUNDS; i++) pips.append(el('i', i < (R.wins[p.id] || 0) ? 'on' : ''));
        li.append(dot, el('em', null, p.name), pips, el('span', 'k', `${R.kills[p.id] || 0} K`));
        ol.append(li);
    }
}

// ============================================================
// Results
// ============================================================
function showResults(msg) {
    view = 'results';
    show('results');
    G.hideBanner();
    G.setState('results');
    G.clearInput();
    const ol = $('results-list');
    ol.innerHTML = '';
    msg.list.forEach((p, i) => {
        const li = el('li', p.id === myId ? 'me' : '');
        const dot = el('span', 'dot');
        dot.style.background = p.color;
        const w = el('span', 'num');
        w.append(el('b', null, String(p.wins)), ` ${p.wins === 1 ? 'round' : 'rounds'}`);
        const k = el('span', 'num');
        k.append(el('b', null, String(p.kills)), ` ${p.kills === 1 ? 'kill' : 'kills'}`);
        li.append(el('span', 'place', String(i + 1)), dot, el('span', 'who', p.name + (p.bot ? ' (bot)' : '')), w, k);
        ol.append(li);
    });
    const top = msg.list[0];
    $('results-title').textContent = !top ? 'Results' : top.id === myId ? 'You win the match!' : `${top.name} wins the match`;
    $('results-note').textContent = msg.note || '';
    sfx.go();
}

// ============================================================
// Position sync
// ============================================================
// [id, x, z, body angle, turret angle, vx, vz, round]
const pack = t => [t.pid, r2(t.x), r2(t.z), r3(t.body), r3(t.turret_a), r2(t.vx || 0), r2(t.vz || 0), R.n];

function applyStates(arr) {
    if (!Array.isArray(arr)) return;
    const now = performance.now();
    for (const s of arr) {
        if (!Array.isArray(s) || s[7] !== R.n) continue;
        const t = R.byId.get(s[0]);
        if (!t || t.owned || !t.alive) continue;
        const [, x, z, body, turret, vx, vz] = s;
        if (!t.net) { t.x = x; t.z = z; t.body = body; t.turret_a = turret; }
        t.net = { x, z, body, turret, vx, vz, t: now };
    }
}

// Smoothly follow the latest reported position, extrapolating a little along the velocity
function interpolate(t, dt) {
    const n = t.net;
    const age = Math.min(0.25, (performance.now() - n.t) / 1000);
    let px = n.x + n.vx * age, pz = n.z + n.vz * age;
    if (G.circleBlocked(px, pz, G.TANK_R * 0.9)) { px = n.x; pz = n.z; }
    const k = 1 - Math.exp(-12 * dt);
    const ox = t.x, oz = t.z;
    if (Math.hypot(px - t.x, pz - t.z) > 3) { t.x = px; t.z = pz; }
    else { t.x += (px - t.x) * k; t.z += (pz - t.z) * k; }
    t.body = lerpAngle(t.body, n.body, k);
    t.turret_a = lerpAngle(t.turret_a, n.turret, k);
    t.vx = n.vx;
    t.vz = n.vz;
    t.treadDist += Math.hypot(t.x - ox, t.z - oz);
    if (t.treadDist > 0.2) {
        t.treadDist = 0;
        G.spawnTread(t.x, t.z, t.body);
    }
}

function sendStates(dt) {
    R.sendAcc += dt;
    if (R.sendAcc < SEND_EVERY) return;
    R.sendAcc = 0;
    if (role === 'client') {
        const me = R.byId.get(myId);
        if (me && me.alive) act({ t: 'st', s: pack(me) });
    } else if (net) {
        const a = [];
        for (const t of R.byId.values()) if (t.owned && t.alive) a.push(pack(t));
        for (const [id, s] of H.states) { const t = R.byId.get(id); if (t && t.alive) a.push(s); }
        net.broadcast({ t: 'sts', a });
    }
}

// ============================================================
// Per-frame battle update
// ============================================================
function battleFrame(dt) {
    if (view !== 'battle') return;
    // Solo battles can pause; online ones keep running
    if (role === 'solo' && !$('bmenu').classList.contains('hidden')) return;
    R.clock += dt;
    if (G.state === 'intro') {
        const n = Math.ceil(-R.clock);
        if (R.clock < 0 && n !== R.lastCount && n <= 3) {
            R.lastCount = n;
            G.showBanner(`ROUND ${R.n}`, String(n), (ARENAS[R.arena] || ARENAS[0]).name);
            sfx.count();
        }
        if (R.clock >= 0) {
            G.setState('play');
            G.showBanner(`ROUND ${R.n}`, 'GO', '');
            setTimeout(() => { if (G.state === 'play') G.hideBanner(); }, 700);
            sfx.go();
            for (const t of R.byId.values()) t.invulnT = INVULN;
        }
        G.aimOnly();
    }
    const st = G.state;
    if (st !== 'play' && st !== 'roundover') return;
    const tanks = G.tanks;
    for (const t of tanks) {
        if (t.invulnT > 0) t.invulnT -= dt;
        if (t.owned && t.cooldown > 0) t.cooldown -= dt;
    }
    const me = G.player;
    if (st === 'play' && me && me.alive) G.updatePlayer(dt);
    if (st === 'play' && role !== 'client') for (const t of tanks) if (t.owned && t.bot && t.alive) updateBot(t, dt);
    // Tanks we drive get pushed out of anyone they overlap
    for (const a of tanks) {
        if (!a.owned || !a.alive) continue;
        for (const b of tanks) {
            if (a === b || !b.alive) continue;
            const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
            if (d > 0 && d < G.TANK_R * 2) {
                const push = (G.TANK_R * 2 - d) * (b.owned ? 0.5 : 1), nx = dx / d * push, nz = dz / d * push;
                if (!G.circleBlocked(a.x + nx, a.z + nz, G.TANK_R)) { a.x += nx; a.z += nz; }
            }
        }
    }
    for (const t of tanks) if (!t.owned && t.alive && t.net) interpolate(t, dt);
    G.updateBullets(dt);
    G.updateMines(dt);
    sendStates(dt);
    if (role !== 'client') hostTick(dt);
    const alive = tanks.filter(t => t.alive).length;
    if (alive !== R.aliveShown) {
        R.aliveShown = alive;
        $('b-alive').textContent = alive;
        renderScoreboard();
    }
}

function afterSync() {
    for (const t of R.byId.values()) {
        const tag = R.tags.get(t.pid);
        if (t.alive) t.group.visible = !(t.invulnT > 0 && Math.floor(t.invulnT * 12) % 2 === 0);
        if (!tag || !t.alive) continue;
        const s = G.toScreen(t.x, 1.05, t.z);
        tag.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
}

G.hooks.frame = battleFrame;
G.hooks.afterSync = afterSync;

// ============================================================
// In-battle menu
// ============================================================
function toggleBattleMenu(open) {
    if (view !== 'battle') return;
    const m = $('bmenu');
    const on = open ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !on);
    $('bmenu-text').textContent = role === 'solo' ? 'The battle is paused.' : 'The battle keeps going while this is open.';
    if (on) G.clearInput();
}
G.hooks.escape = () => toggleBattleMenu();
$('bmenu-resume').addEventListener('click', () => toggleBattleMenu(false));
$('bmenu-leave').addEventListener('click', () => {
    if (confirm(role === 'host' ? 'Leave and close this room for everyone?' : role === 'solo' ? 'Leave this battle?' : 'Leave this room?')) {
        $('bmenu').classList.add('hidden');
        leave();
    }
});

// ============================================================
// Read-only peek for automated tests; only exists with #debug in the URL
// ============================================================
if (location.hash === '#debug') {
    window.tanksDebug = () => ({
        view, role, myId, mode: G.mode, state: G.state, netMode: net ? (net.mode || 'host') : null,
        round: R.n, arena: R.arena, wins: { ...R.wins }, kills: { ...R.kills },
        lobby: lobby.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, bot: p.bot })),
        tanks: G.tanks.map(t => {
            const s = G.toScreen(t.x, G.TURRET_Y, t.z);
            return { id: t.pid || t.id, name: t.name, x: r2(t.x), z: r2(t.z), alive: t.alive, owned: !!t.owned, sx: Math.round(s.x), sy: Math.round(s.y) };
        }),
        bullets: G.bullets.length, mines: G.mines.length, crates: G.crateCount(),
        crateCells: (() => {
            const out = [], me = G.player;
            for (let r = 0; r < G.ROWS; r++) for (let c = 0; c < G.COLS; c++) {
                if (G.cell(r, c) !== 'w') continue;
                const x = G.cellX(c), z = G.cellZ(r), s = G.toScreen(x, 0.4, z);
                out.push({ r, c, sx: Math.round(s.x), sy: Math.round(s.y), d: me ? r2(Math.hypot(x - me.x, z - me.z)) : null });
            }
            return out;
        })(),
    });
}

// ============================================================
// Boot
// ============================================================
if (G.boot()) {
    view = 'campaign';
    show('campaign');
} else {
    showMain();
}
