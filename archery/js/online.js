// Archery Duel online: 2 to 6 archers, free-for-all, turn-based, best of 3 rounds.
//
// Authority model
// - The host owns the player list, turn order, wind, terrain seed, HP and scores.
// - Terrain is generated from the host's seed (buildArena), so every browser has identical terrain.
// - The current shooter's browser simulates its own shot (resolveShot) and is authoritative for the
//   result. It sends angle, speed and the result (target id + body part + damage, or where it landed).
//   Every browser animates the same fixed-step flight and lands it at the reported point, so tiny
//   floating point differences can never make browsers disagree.
// - The host applies damage, then advances the turn. Each 'turn' carries the authoritative HP list.
// - Bots run on the host using the tournament AI.
import { HostNet, ClientNet, makeCode } from './net.js?v=3';
import {
    E, clamp, lerp, rand, gauss, store, view, ctx, sfx, MAX_HP, MAX_DRAG, MIN_SPEED, MAX_SPEED, SIM_DT, DAMAGE,
    buildArena, resolveShot, fireScripted, updateArrows, animateArchers, dragShot, bestShot, render,
    facingFor, angleLerp, elevationDeg, toScreenX, toScreenY, screenTransform, drawAimBox, roundRect, setMinWorldWidth,
} from './engine.js?v=3';
import { $, showScreen, setStatus, toast, esc, banner, hideBanner, setHint } from './ui.js?v=3';

// Analytics: no-op until ../js/analytics.js loads, and always a no-op when testing locally
const track = (name, params) => { if (window.track) window.track(name, params); };

const MAX_PLAYERS = 6;
const ROUNDS = 3;
const WINS_NEEDED = 2;
const TURN_MS = 20000;
const GRACE_MS = 1500;         // host waits a little longer than the shooter's own clock
const AIM_SEND_MS = 110;       // live aim stream rate (about 9 per second)
const ONLINE_MIN_VIEW_W = 700; // zoom out on narrow screens so you can see around you
const COLORS = ['#2ec495', '#e0584f', '#4f8fe0', '#f2c14e', '#b07cf0', '#f08a3c'];
const BOT_NAMES = ['Fletcher', 'Quill', 'Kestrel', 'Yew', 'Sparrow', 'Longbow'];

let role = null;      // 'host' | 'client'
let solo = false;
let net = null;
let myId = null;
let roomCode = '';
let lobbyPlayers = [];
let joinTimer = null;
let hooks = { onEnter() {}, onExit() {} };

// ============================================================
// Host state
// ============================================================
const H = {
    players: [],          // { id, name, color, ready, bot }
    phase: 'lobby',       // lobby | match (between) | aim | flight | roundEnd | results
    round: 0,
    order: [],
    hp: {}, wins: {}, dmg: {},
    turnIdx: -1, cur: null, turnNo: 0, wind: 0,
    botErr: {},
    timers: new Set(), intervals: new Set(),
};
function later(ms, fn) {
    const t = setTimeout(() => { H.timers.delete(t); fn(); }, ms);
    H.timers.add(t);
    return t;
}
function clearHostTimers() {
    H.timers.forEach(clearTimeout); H.timers.clear();
    H.intervals.forEach(clearInterval); H.intervals.clear();
}

// ============================================================
// Match view state (every browser, including the host)
// ============================================================
const M = {
    active: false, players: [], round: 0, wins: {},
    curId: null, turnNo: 0, deadline: 0, lastSec: -1,
    state: 'idle',        // idle | between | aim (my turn) | watch | flight
    aimT: null, lastAimSend: 0, lastAimKey: '', firedNo: -1, hinted: false,
    lastShooter: null,
};

const archerById = id => (E.world && E.world.archers ? E.world.archers.find(a => a.id === id) : null);
const playerInfo = id => M.players.find(p => p.id === id);
const nameOf = id => (playerInfo(id) || {}).name || 'Someone';
const colorOf = id => (playerInfo(id) || {}).color || '#fff';

// ============================================================
// Messaging
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
const pub = p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, host: p.id === myId });
const present = id => H.players.some(p => p.id === id);

function hostHandle(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
        case 'hello': {
            if (present(from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'That room is full (6 archers max).' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'That room is in the middle of a match. Try again when it is back in the lobby.' }); return; }
            const used = new Set(H.players.map(p => p.color));
            const color = COLORS.find(c => !used.has(c)) || COLORS[0];
            const name = String(msg.name || 'Player').slice(0, 14);
            H.players.push({ id: from, name, color, ready: false, bot: false });
            if (net && from !== myId) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            if (from !== myId) { toast(`${name} joined`); sfx.join(); }
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === from);
            if (p && H.phase === 'lobby') { p.ready = !!msg.r; emitLobby(); }
            break;
        }
        case 'aim': {
            if (H.phase !== 'aim' || from !== H.cur || msg.no !== H.turnNo) return;
            const a = +msg.a, p = +msg.p;
            if (!Number.isFinite(a) || !Number.isFinite(p)) return;
            emit({ t: 'aim', id: from, no: H.turnNo, a, p: clamp(p, 0, 1) });
            break;
        }
        case 'fire': {
            if (H.phase !== 'aim' || from !== H.cur || msg.no !== H.turnNo) return;
            hostAcceptShot(from, +msg.a, +msg.s, msg.res);
            break;
        }
    }
}

function hostLeave(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const p = H.players[idx];
    H.players.splice(idx, 1);
    toast(`${p.name} left`);
    if (H.phase === 'lobby') { emitLobby(); return; }
    if (H.phase === 'results') return;
    emit({ t: 'left', id });
    if (H.players.length < 2) {
        H.phase = 'roundEnd'; // stop turns; nobody left to shoot at
        H.turnNo++;
        later(900, hostEndMatch);
        return;
    }
    const alive = H.order.filter(x => present(x) && H.hp[x] > 0);
    if (H.phase === 'aim' && (H.cur === id || alive.length <= 1)) {
        H.phase = 'match';
        H.turnNo++; // invalidates the pending timeout / bot turn
        later(900, hostNextTurn);
    }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(pub) });
}

function addBot() {
    if (role !== 'host' || H.phase !== 'lobby' || H.players.length >= MAX_PLAYERS) return;
    const usedNames = new Set(H.players.map(p => p.name));
    const usedColors = new Set(H.players.map(p => p.color));
    H.players.push({
        id: 'bot_' + Math.random().toString(36).slice(2, 8),
        name: BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot',
        color: COLORS.find(c => !usedColors.has(c)) || COLORS[0],
        ready: true, bot: true,
    });
    emitLobby();
}
function removeBot(id) {
    if (role !== 'host' || H.phase !== 'lobby') return;
    const i = H.players.findIndex(p => p.id === id && p.bot);
    if (i >= 0) { H.players.splice(i, 1); emitLobby(); }
}
// Host removes a real player from the lobby: tell them why, then drop their connection
function kickPlayer(id) {
    const p = H.players.find(x => x.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || !net || !p || p.bot || id === myId) return;
    net.send(id, { t: 'reject', reason: 'The host removed you from the room.' });
    setTimeout(() => net && net.kick(id), 600);
    hostLeave(id);
}

function hostStartMatch() {
    if (role !== 'host' || H.phase !== 'lobby') return;
    if (H.players.length < 2) { setStatus('lobby-status', 'You need at least 2 archers. Add a bot or invite a friend.', true); return; }
    const notReady = H.players.filter(p => !p.bot && p.id !== myId && !p.ready);
    if (notReady.length) { setStatus('lobby-status', `Waiting for ${notReady[0].name} to ready up.`, true); return; }
    setStatus('lobby-status', '');
    clearHostTimers();
    H.phase = 'match';
    H.round = 0;
    H.wins = {}; H.dmg = {};
    for (const p of H.players) { H.wins[p.id] = 0; H.dmg[p.id] = 0; }
    emit({ t: 'match', players: H.players.map(pub), rounds: ROUNDS, need: WINS_NEEDED });
    later(400, hostNextRound);
}

function hostNextRound() {
    H.round++;
    const ids = H.players.map(p => p.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    H.order = ids;
    H.hp = {};
    for (const id of ids) H.hp[id] = MAX_HP;
    H.seed = Math.floor(Math.random() * 2147483647);
    H.turnIdx = -1;
    H.botErr = {};
    H.phase = 'match';
    emit({ t: 'round', round: H.round, rounds: ROUNDS, seed: H.seed, order: ids, wins: H.wins });
    later(2200, hostNextTurn);
}

function hostNextTurn() {
    if (H.phase === 'lobby' || H.phase === 'results' || H.phase === 'roundEnd') return;
    const alive = H.order.filter(id => present(id) && H.hp[id] > 0);
    if (alive.length <= 1) { hostRoundEnd(alive[0] || null); return; }
    const n = H.order.length;
    let i = H.turnIdx;
    for (let k = 0; k < n; k++) { i = (i + 1) % n; if (alive.includes(H.order[i])) break; }
    H.turnIdx = i;
    H.cur = H.order[i];
    H.turnNo++;
    H.phase = 'aim';
    H.wind = Math.round(rand(-0.8, 0.8) * 20) / 20;
    const no = H.turnNo;
    emit({ t: 'turn', id: H.cur, no, wind: H.wind, dur: TURN_MS, hp: H.hp });
    const p = H.players.find(p => p.id === H.cur);
    if (p && p.bot) hostBotTurn(p, no);
    else later(TURN_MS + GRACE_MS, () => {
        if (H.turnNo !== no || H.phase !== 'aim') return;
        H.phase = 'match';
        emit({ t: 'skip', id: H.cur, no });
        later(1300, hostNextTurn);
    });
}

function sanitizeRes(r) {
    const kinds = ['archer', 'rock', 'tree', 'ground', 'out'];
    if (!r || typeof r !== 'object' || !kinds.includes(r.k)) return null;
    const x = +r.x, y = +r.y, n = Math.round(+r.n), ang = +r.ang;
    if (![x, y, n, ang].every(Number.isFinite) || n < 1 || n > 600) return null;
    const out = { k: r.k, x, y, n, ang };
    if (r.k === 'archer') {
        if (typeof r.id !== 'string' || !DAMAGE[r.part]) return null;
        out.id = r.id; out.part = r.part;
        out.dmg = clamp(Math.round(+r.dmg) || 0, 0, DAMAGE[r.part] + 3);
    }
    return out;
}

function hostAcceptShot(id, a, s, rawRes) {
    const res = sanitizeRes(rawRes);
    if (!res || !Number.isFinite(a) || !Number.isFinite(s)) return;
    H.phase = 'flight';
    if (res.k === 'archer' && present(res.id) && H.hp[res.id] > 0) {
        H.hp[res.id] = Math.max(0, H.hp[res.id] - res.dmg);
        H.dmg[id] = (H.dmg[id] || 0) + res.dmg;
    }
    emit({ t: 'shot', id, no: H.turnNo, a, s: clamp(s, MIN_SPEED, MAX_SPEED), w: H.wind, res });
    later(res.n * SIM_DT * 1000 + 1600, hostNextTurn);
}

// Bots think on the host with the tournament AI, then stream their draw like a human would
function hostBotTurn(p, no) {
    later(800, () => {
        if (H.turnNo !== no || H.phase !== 'aim') return;
        const me = archerById(p.id);
        const targets = E.world.archers.filter(a => a !== me && !a.dead && present(a.id));
        if (!me || !targets.length) return;
        targets.sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
        const target = targets.length > 1 && Math.random() < 0.3 ? targets[1] : targets[0];
        const facing = me.facing;
        const best = bestShot(me, target, H.wind);
        me.facing = facing;
        const key = p.id + '>' + target.id;
        const errK = H.botErr[key] || 1;
        H.botErr[key] = Math.max(0.45, errK * 0.82); // zeroes in on the same target
        const err = 0.85 * errK;
        const angle = best.angle + gauss() * 0.1 * err;
        const speed = clamp(best.speed * (1 + gauss() * 0.09 * err), MIN_SPEED, MAX_SPEED);
        const power = (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
        let from = me.aim;
        if (facingFor(from) !== facingFor(angle)) from = Math.PI - from;
        let k = 0;
        const iv = setInterval(() => {
            if (H.turnNo !== no || H.phase !== 'aim') { clearInterval(iv); H.intervals.delete(iv); return; }
            k++;
            const e = 1 - (1 - k / 10) ** 3;
            emit({ t: 'aim', id: p.id, no, a: angleLerp(from, angle, e), p: e * power });
            if (k >= 10) {
                clearInterval(iv); H.intervals.delete(iv);
                const res = resolveShot(me, angle, speed, H.wind);
                hostAcceptShot(p.id, angle, speed, res);
            }
        }, 100);
        H.intervals.add(iv);
    });
}

function hostRoundEnd(winner) {
    if (H.phase === 'results' || H.phase === 'lobby') return;
    H.phase = 'roundEnd';
    if (winner) H.wins[winner] = (H.wins[winner] || 0) + 1;
    const top = Math.max(0, ...Object.values(H.wins));
    const last = top >= WINS_NEEDED || H.round >= ROUNDS || H.players.length < 2;
    emit({ t: 'roundEnd', round: H.round, winner, wins: H.wins, hp: H.hp, last });
    later(last ? 4200 : 4600, last ? hostEndMatch : () => { H.phase = 'match'; hostNextRound(); });
}

function hostEndMatch() {
    if (H.phase === 'results' || H.phase === 'lobby') return;
    clearHostTimers();
    H.phase = 'results';
    const list = H.players
        .map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: H.wins[p.id] || 0, dmg: H.dmg[p.id] || 0 }))
        .sort((a, b) => b.wins - a.wins || b.dmg - a.dmg)
        .map((p, i) => ({ ...p, place: i + 1 }));
    emit({ t: 'results', list });
}

function hostBackToLobby() {
    if (role !== 'host') return;
    clearHostTimers();
    H.phase = 'lobby';
    for (const p of H.players) p.ready = p.bot;
    emitLobby();
    emit({ t: 'toLobby' });
}

// ============================================================
// Client logic
// ============================================================
function clientHandle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
        case 'welcome':
            myId = msg.you;
            roomCode = msg.code;
            clearTimeout(joinTimer);
            renderLobby();
            break;
        case 'reject':
            leave(msg.reason);
            return;
        case 'hostLeft':
            leave('The host left, so the room was closed.');
            return;
        case 'lobby':
            clearTimeout(joinTimer);
            lobbyPlayers = Array.isArray(msg.players) ? msg.players : [];
            renderLobby();
            break;
        case 'match': onMatch(msg); break;
        case 'round': onRound(msg); break;
        case 'turn': onTurn(msg); break;
        case 'aim': onAim(msg); break;
        case 'shot': onShot(msg); break;
        case 'skip': onSkip(msg); break;
        case 'left': onLeft(msg); break;
        case 'roundEnd': onRoundEnd(msg); break;
        case 'results': showResults(msg.list || []); break;
        case 'toLobby': toLobbyView(); break;
    }
}

function onMatch(msg) {
    M.players = msg.players || [];
    M.active = true;
    M.wins = {};
    M.state = 'between';
    setMinWorldWidth(ONLINE_MIN_VIEW_W);
    showScreen(null);
    $('board').classList.add('hidden');
    $('ohud').classList.remove('hidden');
}

function onRound(msg) {
    if (!M.active) onMatch({ players: M.players });
    M.round = msg.round;
    M.wins = msg.wins || {};
    const list = (msg.order || []).map(playerInfo).filter(Boolean);
    buildArena(msg.seed >>> 0, list);
    E.onHit = onHit;
    E.drag = null;
    M.state = 'between';
    M.curId = null;
    M.aimT = null;
    M.lastShooter = null;
    const mine = archerById(myId) || E.world.archers[0];
    E.cam.x = E.cam.target = clamp(mine.x - view.ww * (mine.facing > 0 ? 0.35 : 0.65), 0, Math.max(0, E.world.width - view.ww));
    $('board').classList.add('hidden');
    $('o-round').textContent = `${msg.round}/${msg.rounds || ROUNDS}`;
    setWind(0);
    setTurnChip(null);
    renderRoster();
    setHint('');
    banner(`Round ${msg.round}`, list.length === 2 ? '1 v 1 duel' : `${list.length} archer free for all`, '#fff', 2000);
}

function syncHp(hp) {
    if (!hp || !E.world) return;
    for (const a of E.world.archers) {
        if (hp[a.id] == null) continue;
        a.hp = hp[a.id];
        if (a.hp <= 0) a.dead = true;
    }
}

function onTurn(msg) {
    if (!E.world || !E.world.online) return;
    M.curId = msg.id;
    M.turnNo = msg.no;
    M.aimT = null;
    M.lastAimKey = '';
    E.world.wind = msg.wind;
    setWind(msg.wind);
    syncHp(msg.hp);
    M.deadline = performance.now() + msg.dur;
    M.lastSec = -1;
    const a = archerById(msg.id);
    if (msg.id === myId) {
        M.state = 'aim';
        banner('Your turn', null, '#2ec495', 1100);
        sfx.turn();
        setHint(M.hinted ? '' : 'Your turn: drag back anywhere, release to shoot. Aim left or right.');
    } else {
        M.state = 'watch';
        E.drag = null;
        banner(`${nameOf(msg.id)}'s turn`, null, colorOf(msg.id), 1100);
        setHint('');
    }
    if (a) M.lastShooter = a;
    setTurnChip(msg.id);
    renderRoster();
}

function onAim(msg) {
    if (msg.no !== M.turnNo || msg.id !== M.curId) return;
    if (msg.id === myId && M.state === 'aim') return; // our own live aim
    const prev = M.aimT ? M.aimT.p : 0;
    M.aimT = { a: msg.a, p: msg.p };
    if (Math.floor(msg.p * 8) !== Math.floor(prev * 8) && Math.random() < 0.5) sfx.creak();
}

function onShot(msg) {
    const a = archerById(msg.id);
    if (!a) return;
    if (!(msg.id === myId && M.firedNo === msg.no)) fireScripted(a, msg.a, msg.s, msg.w, msg.res);
    if (msg.id === myId) { E.drag = null; setHint(''); }
    M.state = 'flight';
    M.aimT = null;
    M.deadline = 0;
    setTurnChip(msg.id);
}

function onSkip(msg) {
    const a = archerById(msg.id);
    if (a) a.draw = 0;
    if (msg.id === myId) { E.drag = null; setHint(''); banner('Time is up', null, '#ff7b6e', 1300); }
    else banner(`${nameOf(msg.id)} ran out of time`, null, '#fff', 1300);
    M.state = 'between';
    M.deadline = 0;
    setTurnChip(null);
}

function onLeft(msg) {
    const info = playerInfo(msg.id);
    if (info) info.left = true;
    if (role !== 'host') toast(`${info ? info.name : 'A player'} left`);
    if (E.world && E.world.online) {
        E.world.archers = E.world.archers.filter(a => a.id !== msg.id);
        if (M.lastShooter && M.lastShooter.id === msg.id) M.lastShooter = null;
    }
    if (M.curId === msg.id) { M.state = 'between'; M.curId = null; M.deadline = 0; setTurnChip(null); }
    renderRoster();
}

function onRoundEnd(msg) {
    syncHp(msg.hp);
    M.wins = msg.wins || {};
    M.state = 'between';
    M.curId = null;
    M.deadline = 0;
    E.drag = null;
    setHint('');
    setTurnChip(null);
    renderRoster();
    const w = msg.winner;
    if (w === myId) { sfx.win(); banner('You win the round', `ROUND ${msg.round}`, '#2ec495'); }
    else if (w) { sfx.lose(); banner(`${nameOf(w)} wins the round`, `ROUND ${msg.round}`, colorOf(w)); }
    else banner('No one survived', `ROUND ${msg.round}`, '#fff');
    setTimeout(() => {
        if (!M.active) return;
        hideBanner();
        showBoard(msg);
    }, 1500);
}

function showBoard(msg) {
    $('board-kicker').textContent = `After round ${msg.round} of ${ROUNDS}`;
    const w = msg.winner;
    $('board-title').textContent = w ? (w === myId ? 'You won that round' : `${nameOf(w)} won that round`) : 'Draw';
    const rows = M.players
        .filter(p => !p.left)
        .map(p => ({ ...p, wins: M.wins[p.id] || 0 }))
        .sort((a, b) => b.wins - a.wins);
    $('board-list').innerHTML = rows.map(p => `
        <li class="${p.id === myId ? 'me' : ''}">
            <span class="dot" style="background:${p.color}"></span>
            <span class="who"><b>${esc(p.name)}</b></span>
            <span class="pips">${pips(p.wins)}</span>
        </li>`).join('');
    $('board-foot').textContent = msg.last ? 'Match over. Final results coming up.' : `First to ${WINS_NEEDED} round wins. Next round starting...`;
    $('board').classList.remove('hidden');
}

const pips = n => Array.from({ length: WINS_NEEDED }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + (n > WINS_NEEDED ? `<em>${n}</em>` : '');

function showResults(list) {
    track('match_end');
    M.active = false;
    M.state = 'idle';
    E.drag = null;
    hideBanner();
    setHint('');
    $('board').classList.add('hidden');
    $('ohud').classList.add('hidden');
    showScreen('results');
    const first = list[0];
    $('results-title').textContent = !first ? 'Match over' : first.id === myId ? 'You win!' : `${first.name} wins`;
    if (first && first.id === myId) sfx.win();
    $('results-list').innerHTML = list.map(p => `
        <li class="${p.id === myId ? 'me' : ''}">
            <span class="place">${p.place}</span>
            <span class="dot" style="background:${p.color}"></span>
            <span class="who"><b>${esc(p.name)}</b><small>${p.dmg} damage dealt</small></span>
            <span class="score">${p.wins} ${p.wins === 1 ? 'win' : 'wins'}</span>
        </li>`).join('');
}

function toLobbyView() {
    M.active = false;
    M.state = 'idle';
    $('ohud').classList.add('hidden');
    $('board').classList.add('hidden');
    hideBanner();
    showScreen('lobby');
    renderLobby();
}

function onHit() { renderRoster(); }

// ============================================================
// HUD
// ============================================================
function setWind(w) {
    const kmh = Math.round(Math.abs(w) * 30);
    $('o-wind').textContent = `${kmh} km/h`;
    $('o-wind-arrow').style.transform = w < 0 ? 'scaleX(-1)' : 'none';
    $('o-wind-arrow').style.opacity = kmh === 0 ? 0.3 : 1;
}

function setTurnChip(id) {
    const chip = $('o-turn');
    if (!id) { chip.classList.add('idle'); $('o-turn-name').textContent = 'Waiting'; $('o-timer').textContent = ''; $('o-turn-dot').style.background = 'transparent'; return; }
    chip.classList.remove('idle');
    $('o-turn-dot').style.background = colorOf(id);
    $('o-turn-name').textContent = id === myId ? 'Your turn' : nameOf(id);
    if (M.state === 'flight') $('o-timer').textContent = '';
}

function updateTimer() {
    if (!M.active || !M.deadline || (M.state !== 'aim' && M.state !== 'watch')) return;
    const sec = Math.max(0, Math.ceil((M.deadline - performance.now()) / 1000));
    if (sec === M.lastSec) return;
    M.lastSec = sec;
    const t = $('o-timer');
    t.textContent = `${sec}s`;
    t.classList.toggle('low', sec <= 5);
    if (M.state === 'aim' && sec <= 5 && sec > 0) sfx.tick();
}

function renderRoster() {
    const ul = $('o-roster');
    if (!E.world || !E.world.online) { ul.innerHTML = ''; return; }
    ul.innerHTML = E.world.archers.map(a => `
        <li class="${a.id === M.curId ? 'cur' : ''} ${a.dead ? 'out' : ''} ${a.id === myId ? 'me' : ''}">
            <span class="dot" style="background:${a.color}"></span>
            <span class="nm">${esc(a.id === myId ? `${a.name} (you)` : a.name)}</span>
            <span class="hp"><i style="width:${(a.hp / a.maxHp) * 100}%;background:${a.color}"></i></span>
            <span class="hpn">${a.hp}</span>
            <span class="pips">${pips(M.wins[a.id] || 0)}</span>
        </li>`).join('');
}

// ============================================================
// Per-frame
// ============================================================
function maxDrag() { return Math.min(MAX_DRAG, Math.max(120, Math.min(view.w, view.h) * 0.45)); }

function tick(dt) {
    const w = E.world;
    if (!w) return;
    if (M.active) updateArrows(dt);
    animateArchers(dt);
    const cur = M.active ? archerById(M.curId) : null;
    let shot = null;
    if (M.active && M.state === 'aim' && cur && M.curId === myId) {
        shot = dragShot(maxDrag());
        if (shot) { cur.aim = shot.angle; cur.draw = shot.power; cur.facing = facingFor(shot.angle); }
        else cur.draw = 0;
        const now = performance.now();
        if (now - M.lastAimSend > AIM_SEND_MS) {
            const key = shot ? `${shot.angle.toFixed(3)}:${shot.power.toFixed(3)}` : '0';
            if (key !== M.lastAimKey) {
                M.lastAimKey = key;
                M.lastAimSend = now;
                act({ t: 'aim', no: M.turnNo, a: shot ? shot.angle : cur.aim, p: shot ? shot.power : 0 });
            }
        }
        if (now > M.deadline) {
            // Out of time locally; the host will announce the skip
            M.state = 'between';
            E.drag = null;
            cur.draw = 0;
            shot = null;
            setHint('');
        }
    } else if (M.active && M.state === 'watch' && cur && M.aimT) {
        const k = 1 - Math.exp(-dt * 12);
        cur.aim = angleLerp(cur.aim, M.aimT.a, k);
        cur.draw = lerp(cur.draw, M.aimT.p, k);
        if (M.aimT.p > 0.02) cur.facing = facingFor(M.aimT.a);
    }
    updateTimer();
    updateCamera(dt, cur);
    E.shake = Math.max(0, E.shake - dt * 40);
    render(dt, {
        isAiming: a => M.active && a === cur && (M.state === 'aim' || M.state === 'watch'),
        preview: shot ? { archer: cur, shot, readout: false } : null,
        overlay: () => drawOverlay(cur, shot),
    });
}

function updateCamera(dt, cur) {
    const w = E.world, cam = E.cam;
    let fast = false;
    const last = w.arrows[w.arrows.length - 1];
    if (M.active && M.state === 'flight' && last) {
        cam.target = last.x - view.ww * 0.5;
        fast = !last.stuck;
    } else if (M.active && cur && (M.state === 'aim' || M.state === 'watch')) {
        cam.target = cur.x - view.ww * (cur.facing > 0 ? 0.35 : 0.65);
    }
    cam.target = clamp(cam.target, 0, Math.max(0, w.width - view.ww));
    cam.x = lerp(cam.x, cam.target, 1 - Math.exp(-dt * (fast ? 7 : 3.5)));
}

// Screen-space overlay: name tags, live aim readout, off-screen markers
function drawOverlay(cur, shot) {
    const w = E.world;
    if (!w.online) return;
    screenTransform();
    ctx.textAlign = 'center';
    for (const a of w.archers) {
        const sx = toScreenX(a.x), sy = toScreenY(a.y - 116);
        if (sx < -60 || sx > view.w + 60) continue;
        ctx.globalAlpha = a.dead ? 0.55 : 1;
        ctx.font = '800 12px Inter, sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        const label = a.dead ? `${a.name} (out)` : a.name;
        ctx.strokeText(label, sx, sy - 10);
        ctx.fillStyle = a.id === myId ? '#fff' : a.color;
        ctx.fillText(label, sx, sy - 10);
        if (!a.dead) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            roundRect(sx - 23, sy - 4, 46, 7, 3.5);
            ctx.fill();
            ctx.fillStyle = a.color;
            roundRect(sx - 23, sy - 4, 46 * (a.hp / a.maxHp), 7, 3.5);
            ctx.fill();
        }
        if (a === cur && M.state !== 'flight') {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(sx, sy - 26);
            ctx.lineTo(sx - 6, sy - 34);
            ctx.lineTo(sx + 6, sy - 34);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    // Live aim readout for whoever is drawing
    if (cur && (M.state === 'aim' || M.state === 'watch') && cur.draw > 0.02) {
        const power = shot ? shot.power : cur.draw;
        const angle = shot ? shot.angle : cur.aim;
        const sx = clamp(toScreenX(cur.x) - 55, 16, view.w - 140), sy = Math.max(40, toScreenY(cur.y - 116) - 80);
        drawAimBox(sx, sy, elevationDeg(angle), power);
    }
    // Off-screen markers with distance
    const ref = cur || M.lastShooter || archerById(myId);
    const sides = { l: [], r: [] };
    for (const a of w.archers) {
        if (a.dead || a === ref) continue;
        const sx = toScreenX(a.x);
        if (sx < -24) sides.l.push(a);
        else if (sx > view.w + 24) sides.r.push(a);
    }
    for (const side of ['l', 'r']) {
        const list = sides[side];
        if (!list.length) continue;
        const refX = ref ? ref.x : E.cam.x + view.ww / 2;
        list.sort((a, b) => Math.abs(a.x - refX) - Math.abs(b.x - refX));
        const right = side === 'r';
        let yMin = Math.min(view.h * 0.3, 120);
        for (const a of list) {
            const x = right ? view.w - 22 : 22;
            const y = Math.max(yMin, clamp(toScreenY(a.y - 60), 60, view.h - 70));
            yMin = y + 46;
            const dist = Math.round(Math.abs(a.x - refX) / 20);
            ctx.fillStyle = a.color;
            ctx.beginPath();
            ctx.moveTo(x + (right ? 14 : -14), y);
            ctx.lineTo(x + (right ? -6 : 6), y - 12);
            ctx.lineTo(x + (right ? -6 : 6), y + 12);
            ctx.closePath();
            ctx.fill();
            ctx.textAlign = right ? 'right' : 'left';
            ctx.font = '800 12px Inter, sans-serif';
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            const tx = x + (right ? 8 : -8);
            ctx.strokeText(a.name, tx, y + 26);
            ctx.fillStyle = '#fff';
            ctx.fillText(a.name, tx, y + 26);
            ctx.font = '700 11px Inter, sans-serif';
            ctx.strokeText(`${dist} m`, tx, y + 39);
            ctx.fillText(`${dist} m`, tx, y + 39);
        }
    }
    // Arrows above the view
    for (const ar of w.arrows) {
        if (ar.stuck || toScreenY(ar.y) > 0) continue;
        const x = clamp(toScreenX(ar.x), 20, view.w - 20);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x - 8, 22);
        ctx.lineTo(x + 8, 22);
        ctx.closePath();
        ctx.fill();
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(-ar.y / 10)} m`, x, 38);
    }
}

function release(s) {
    if (!M.active || M.state !== 'aim' || M.curId !== myId) return;
    const a = archerById(myId);
    if (!a) return;
    if (!s || s.power < 0.08) { a.draw = 0; return; }
    if (performance.now() > M.deadline) return;
    M.hinted = true;
    setHint('');
    const res = resolveShot(a, s.angle, s.speed, E.world.wind);
    M.firedNo = M.turnNo;
    M.state = 'flight';
    fireScripted(a, s.angle, s.speed, E.world.wind, res);
    act({ t: 'fire', no: M.turnNo, a: s.angle, s: s.speed, res });
}

// ============================================================
// Lobby UI
// ============================================================
function renderLobby() {
    $('room-code').textContent = solo ? 'SOLO' : roomCode || '-----';
    $('btn-copy').classList.toggle('hidden', solo);
    $('count').textContent = `${lobbyPlayers.length}/${MAX_PLAYERS}`;
    const rows = lobbyPlayers.map(p => `
        <li class="player ${p.id === myId ? 'me' : ''}">
            <span class="dot" style="background:${p.color}"></span>
            <span class="who"><b>${esc(p.name)}</b>${p.bot ? '<small>Bot</small>' : p.host ? '<small>Host</small>' : ''}</span>
            ${p.id === myId ? '<span class="badge you">You</span>' : ''}
            ${p.ready || p.host ? '<span class="badge ok">Ready</span>' : '<span class="badge">Not ready</span>'}
            ${role === 'host' && p.id !== myId ? `<button class="mini" type="button" data-kick="${esc(p.id)}">Remove</button>` : ''}
        </li>`);
    for (let i = lobbyPlayers.length; i < MAX_PLAYERS; i++) rows.push('<li class="player empty">Empty slot</li>');
    $('players').innerHTML = rows.join('');
    const me = lobbyPlayers.find(p => p.id === myId);
    $('btn-ready').textContent = me && me.ready ? 'Not ready' : 'Ready up';
    $('btn-ready').classList.toggle('on', !!(me && me.ready));
    $('btn-bot').disabled = lobbyPlayers.length >= MAX_PLAYERS;
    if (role === 'host') {
        const waiting = lobbyPlayers.filter(p => !p.bot && !p.host && !p.ready);
        $('btn-start').disabled = lobbyPlayers.length < 2;
        setStatus('lobby-status', lobbyPlayers.length < 2 ? 'Add a bot or invite a friend to start.' : waiting.length ? `Waiting for ${waiting.map(p => p.name).join(', ')} to ready up.` : 'Everyone is ready.');
    } else if (role === 'client') {
        setStatus('lobby-status', !me ? 'Connecting to the room...' : me.ready ? 'Waiting for the host to start.' : 'Ready up when you are set.');
    }
}

// ============================================================
// Room management
// ============================================================
function readName() {
    const n = $('name').value.trim().slice(0, 14) || 'Archer';
    store.set('archeryName', n);
    return n;
}

function enterLobby() {
    hooks.onEnter();
    setStatus('menu-status', '');
    showScreen('lobby');
    renderLobby();
}

async function createRoom() {
    if (role) return;
    const name = readName();
    setStatus('menu-status', 'Creating room...');
    roomCode = makeCode();
    role = 'host';
    document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try {
        await hn.open(roomCode);
    } catch (e) {
        hn.close();
        role = null;
        document.body.classList.remove('is-host');
        if (e.message === 'code-taken') return createRoom();
        setStatus('menu-status', e.message, true);
        return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    solo = false;
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name });
    track('room_create');
    enterLobby();
}

async function joinRoom() {
    if (role) return;
    const name = readName();
    const code = $('code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { setStatus('menu-status', 'Enter the 5-character room code.', true); return; }
    setStatus('menu-status', 'Joining...');
    role = 'client';
    document.body.classList.remove('is-host');
    const cn = new ClientNet({
        onMessage: clientHandle,
        onClose: () => leave('Lost connection to the host. The room may have closed.'),
        onStatus: msg => setStatus('menu-status', msg),
        forceRelay: new URLSearchParams(location.search).get('net') === 'relay',
    });
    try {
        myId = await cn.connect(code);
    } catch (e) {
        try { cn.close(); } catch (err) { /* already closed */ }
        role = null;
        setStatus('menu-status', e.message, true);
        return;
    }
    net = cn;
    roomCode = code;
    lobbyPlayers = [];
    cn.send({ t: 'hello', name });
    track('room_join');
    enterLobby();
    // The relay cannot tell us a room does not exist, so give up if nobody answers
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (role === 'client' && !lobbyPlayers.length) leave('No answer from that room. Check the code and try again.'); }, 12000);
}

function startSolo() {
    if (role) return;
    const name = readName();
    role = 'host';
    solo = true;
    document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '';
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name });
    addBot();
    addBot();
    track('play_solo');
    enterLobby();
}

function leave(reason) {
    const n = net;
    net = null;
    if (n) {
        if (role === 'host') {
            try { n.broadcast({ t: 'hostLeft' }); } catch (e) { /* ignore */ }
            setTimeout(() => n.close(), 250);
        } else n.close();
    }
    clearHostTimers();
    clearTimeout(joinTimer);
    role = null; myId = null; roomCode = ''; solo = false;
    lobbyPlayers = [];
    H.players = []; H.phase = 'lobby';
    M.active = false; M.state = 'idle'; M.curId = null; M.players = [];
    E.drag = null;
    document.body.classList.remove('is-host');
    $('ohud').classList.add('hidden');
    $('board').classList.add('hidden');
    hideBanner();
    setHint('');
    hooks.onExit(reason);
}

// ============================================================
// Wiring
// ============================================================
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    const done = () => toast('Invite link copied');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
    else toast(url);
});
$('btn-bot').addEventListener('click', addBot);
$('players').addEventListener('click', e => {
    const id = e.target && e.target.dataset ? e.target.dataset.kick : null;
    if (!id) return;
    const p = H.players.find(x => x.id === id);
    if (!p) return;
    if (p.bot) removeBot(id);
    else if (confirm(`Remove ${p.name} from the room?`)) kickPlayer(id);
});
$('btn-ready').addEventListener('click', () => {
    const me = lobbyPlayers.find(p => p.id === myId);
    act({ t: 'ready', r: !(me && me.ready) });
});
$('btn-start').addEventListener('click', hostStartMatch);
$('btn-lobby-leave').addEventListener('click', () => leave());
$('btn-again').addEventListener('click', hostBackToLobby);
$('btn-results-leave').addEventListener('click', () => leave());
addEventListener('pagehide', () => { if (net) leave(); });

{
    $('name').value = store.get('archeryName') || '';
    const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (invite) {
        $('code').value = invite;
        $('invite').textContent = `You have been invited to room ${invite}. Enter your name and press Join.`;
        $('invite').classList.remove('hidden');
    }
}

export const online = {
    init(h) { hooks = { ...hooks, ...h }; },
    get inRoom() { return !!role; },
    get inMatch() { return M.active; },
    leave,
    tick,
    maxDrag,
    canAim: () => M.active && M.state === 'aim' && M.curId === myId,
    release,
    cancel() { const a = archerById(myId); if (a && M.state === 'aim') a.draw = 0; },
    // Read-only snapshot for automated tests (exposed only with #debug)
    debug() {
        const w = E.world;
        return {
            role, solo, myId, roomCode, lobby: lobbyPlayers.map(p => ({ ...p })),
            active: M.active, state: M.state, round: M.round, curId: M.curId, turnNo: M.turnNo,
            wins: { ...M.wins }, maxDrag: maxDrag(),
            timeLeft: M.deadline ? Math.max(0, M.deadline - performance.now()) : 0,
            wind: w ? w.wind : 0, width: w ? w.width : 0, online: !!(w && w.online),
            archers: w ? w.archers.map(a => ({ id: a.id, name: a.name, x: a.x, y: a.y, hp: a.hp, dead: a.dead, facing: a.facing, aim: a.aim, draw: a.draw, color: a.color })) : [],
            terrain: w && w.online ? Array.from(w.heights.filter((_, i) => i % 50 === 0)).map(v => Math.round(v * 100) / 100) : [],
            obstacles: w && w.online ? w.obstacles.map(o => ({ type: o.type, x: Math.round(o.x) })) : [],
            arrows: w ? w.arrows.length : 0,
            net: net ? (net.mode || (role === 'host' ? 'host' : '')) : '',
            view: { w: view.w, h: view.h, scale: view.scale, oy: view.oy, camX: E.cam.x },
        };
    },
    // Best (no error) shot for my archer at a target, for tests. Leaves the game state untouched.
    suggest(targetId) {
        const me = archerById(myId), t = archerById(targetId);
        if (!me || !t || !E.world) return null;
        const f = me.facing;
        const best = bestShot(me, t, E.world.wind);
        me.facing = f;
        return { angle: best.angle, power: (best.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), maxDrag: maxDrag() };
    },
};
