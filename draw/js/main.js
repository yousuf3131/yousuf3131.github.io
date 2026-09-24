// Drawing Duel: online multiplayer drawing and guessing game.
import { HostNet, ClientNet, makeCode } from './net.js?v=1';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=1';
import { play as playMusic, stop as stopMusic, setMusicVolume, getMusicVolume } from './music.js?v=1';
import { DrawCanvas, COLORS as DRAW_COLORS, SIZES } from './canvas.js?v=1';
import { getRandomWords } from './words.js?v=1';

const MAX_PLAYERS = 8;
const ROUND_TIME = 60;
const COLORS = ['#8b5cf6', '#e0584f', '#3b82f6', '#f2c14e', '#a78bfa', '#f97316', '#ec4899', '#2ec495'];
const BOT_NAMES = ['Doodle Dan', 'Sketch Sally', 'Paint Pete', 'Art Annie', 'Scribble Sam', 'Crayon Carl', 'Brush Betty', 'Pencil Pat'];

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// Persistent state
// ============================================================
let myName = (() => { try { return localStorage.getItem('drawName') || ''; } catch { return ''; } })();
let role = null; // 'host' | 'client' | 'solo'
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu'; // 'menu' | 'lobby' | 'game' | 'results'

// Host state
const H = {
    players: [],  // { id, name, color, ready, bot, score }
    phase: 'lobby',
    round: 0,
    totalRounds: 0,
    drawerIdx: 0,
    word: '',
    timer: null,
    timeLeft: 0,
    guessed: new Set(),
    botTimers: [],
};

// Client state
let players = [];
let drawCanvas = null;
let isDrawer = false;
let guessedCorrectly = false;

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'game', 'results']) $(s).classList.toggle('hidden', s !== id);
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

function setStatus(el, msg, err) {
    const s = $(el); s.textContent = msg;
    s.classList.toggle('error', !!err);
}

function toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500);
}

// ============================================================
// Messaging
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
function hostHandle(from, msg) {
    const p = H.players.find(p => p.id === from);
    switch (msg.t) {
        case 'hello': {
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game already in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            const player = { id: from, name: msg.name || 'Player', color, ready: false, bot: false, score: 0 };
            H.players.push(player);
            if (net) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            toast(`${player.name} joined`);
            sfx.join();
            break;
        }
        case 'ready':
            if (p) { p.ready = !!msg.r; emitLobby(); }
            break;
        case 'chose':
            if (from === getDrawer()?.id && msg.word) {
                H.word = msg.word;
                startDrawing();
            }
            break;
        case 'stroke':
        case 'clear':
        case 'undo':
        case 'fill':
            if (from === getDrawer()?.id) emit({ ...msg, t: msg.t });
            break;
        case 'guess':
            if (!msg.text || !p) return;
            const text = msg.text.trim().toLowerCase();
            if (!text) return;
            if (H.guessed.has(from)) return; // already guessed right
            if (text === H.word.toLowerCase()) {
                H.guessed.add(from);
                const bonus = Math.floor((H.timeLeft / ROUND_TIME) * 500);
                p.score += 500 + bonus;
                const drawer = getDrawer();
                if (drawer) drawer.score += 100;
                emit({ t: 'chat', from, name: p.name, text: 'Guessed correctly!', correct: true, color: p.color });
                sfx.correct();
                // Check if all non-drawing humans have guessed
                const unguessed = H.players.filter(p2 => p2.id !== drawer?.id && !p2.bot && !H.guessed.has(p2.id));
                if (unguessed.length === 0) endRound();
            } else {
                // Check for close guess (>60% of word matches)
                const close = isCloseGuess(text, H.word.toLowerCase());
                emit({ t: 'chat', from, name: p.name, text: msg.text, correct: false, close, color: p.color });
            }
            break;
    }
}

function isCloseGuess(guess, word) {
    if (guess.length < 2 || word.length < 2) return false;
    let matches = 0;
    for (let i = 0; i < Math.min(guess.length, word.length); i++) {
        if (guess[i] === word[i]) matches++;
    }
    return matches / word.length > 0.6 && guess !== word;
}

function hostLeave(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const name = H.players[idx].name;
    H.players.splice(idx, 1);
    toast(`${name} left`);
    if (H.phase === 'lobby') emitLobby();
    else if (H.players.length < 2) endGame();
}

function getDrawer() { return H.players[H.drawerIdx]; }

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, score: p.score })), phase: H.phase });
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    const color = COLORS[H.players.length % COLORS.length];
    H.players.push({ id: botId, name, color, ready: true, bot: true, score: 0 });
    emitLobby();
}

function startGame() {
    if (H.players.length < 2) { setStatus('lobby-status', 'Need at least 2 players.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    if (humans.length < 1) return;
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }
    H.phase = 'game';
    H.round = 0;
    const humanCount = humans.length;
    H.totalRounds = humanCount * Math.ceil(12 / humanCount);
    H.drawerIdx = -1;
    for (const p of H.players) p.score = 0;
    emit({ t: 'gameStart', totalRounds: H.totalRounds });
    nextRound();
}

function nextRound() {
    H.round++;
    if (H.round > H.totalRounds) { endGame(); return; }
    // Find next human drawer
    let tries = 0;
    do {
        H.drawerIdx = (H.drawerIdx + 1) % H.players.length;
        tries++;
    } while (H.players[H.drawerIdx].bot && tries <= H.players.length);
    if (tries > H.players.length) { endGame(); return; }

    H.guessed.clear();
    H.word = '';
    clearBotTimers();

    const drawer = getDrawer();
    const words = getRandomWords(3);
    emit({ t: 'round', drawer: drawer.id, drawerName: drawer.name, round: H.round, totalRounds: H.totalRounds, color: drawer.color });
    // Send word choices to the drawer
    if (drawer.id === myId) {
        clientHandle({ t: 'pick', words });
    } else if (net) {
        net.send(drawer.id, { t: 'pick', words });
    }
}

function startDrawing() {
    const hint = H.word.split('').map(c => c === ' ' ? '  ' : '_').join(' ');
    emit({ t: 'start', hint, letterCount: H.word.length, drawer: getDrawer()?.id });
    H.timeLeft = ROUND_TIME;
    emit({ t: 'timer', sec: H.timeLeft });
    clearInterval(H.timer);
    H.timer = setInterval(() => {
        H.timeLeft--;
        emit({ t: 'timer', sec: H.timeLeft });
        // Hints
        if (H.timeLeft === 40) {
            emit({ t: 'hint', hint: `${H.word.length} letters` });
        } else if (H.timeLeft === 25 && H.word.length > 1) {
            const h = H.word[0] + ' ' + H.word.slice(1).split('').map(c => c === ' ' ? ' ' : '_').join(' ');
            emit({ t: 'hint', hint: h });
        } else if (H.timeLeft === 15 && H.word.length > 3) {
            const arr = H.word.split('');
            const revealed = new Set([0]);
            const mid = 1 + Math.floor(Math.random() * (arr.length - 2));
            revealed.add(mid);
            const h = arr.map((c, i) => revealed.has(i) || c === ' ' ? c : '_').join(' ');
            emit({ t: 'hint', hint: h });
        }
        if (H.timeLeft <= 0) endRound();
    }, 1000);

    // Schedule bot guesses
    scheduleBotGuesses();
}

function scheduleBotGuesses() {
    clearBotTimers();
    for (const p of H.players) {
        if (!p.bot || p.id === getDrawer()?.id) continue;
        if (Math.random() > 0.7) continue; // 30% chance to not guess
        const delay = 15000 + Math.random() * 30000;
        const timer = setTimeout(() => {
            if (H.phase !== 'game' || H.guessed.has(p.id)) return;
            H.guessed.add(p.id);
            const bonus = Math.floor((H.timeLeft / ROUND_TIME) * 500);
            p.score += 500 + bonus;
            const drawer = getDrawer();
            if (drawer) drawer.score += 100;
            emit({ t: 'chat', from: p.id, name: p.name, text: 'Guessed correctly!', correct: true, color: p.color });
        }, delay);
        H.botTimers.push(timer);
    }
}

function clearBotTimers() {
    for (const t of H.botTimers) clearTimeout(t);
    H.botTimers = [];
}

function endRound() {
    clearInterval(H.timer);
    clearBotTimers();
    emit({ t: 'reveal', word: H.word });
    emit({ t: 'scores', list: H.players.map(p => ({ id: p.id, name: p.name, score: p.score, color: p.color })) });
    sfx.roundEnd();
    setTimeout(() => nextRound(), 4000);
}

function endGame() {
    clearInterval(H.timer);
    clearBotTimers();
    H.phase = 'lobby';
    const sorted = [...H.players].sort((a, b) => b.score - a.score);
    emit({ t: 'results', list: sorted.map((p, i) => ({ id: p.id, name: p.name, score: p.score, place: i + 1, color: p.color })) });
}

// ============================================================
// Client logic
// ============================================================
function clientHandle(msg) {
    switch (msg.t) {
        case 'welcome':
            myId = msg.you;
            roomCode = msg.code;
            break;
        case 'reject':
            setStatus('menu-status', msg.reason, true);
            leave();
            return;
        case 'lobby':
            players = msg.players;
            renderLobby();
            break;
        case 'toast':
            toast(msg.text);
            break;
        case 'gameStart':
            view = 'game';
            show('game');
            playMusic('game');
            initCanvas();
            break;
        case 'round':
            isDrawer = msg.drawer === myId;
            guessedCorrectly = false;
            $('round-num').textContent = `${msg.round}/${msg.totalRounds}`;
            $('drawer-name').textContent = isDrawer ? 'Your turn to draw!' : `${msg.drawerName} is drawing`;
            $('drawer-name').style.color = msg.color;
            $('hint').textContent = '';
            $('chat-input').disabled = isDrawer;
            $('chat-input').placeholder = isDrawer ? "You're drawing!" : 'Type your guess...';
            $('toolbar').classList.toggle('hidden', !isDrawer);
            drawCanvas.setEnabled(isDrawer);
            drawCanvas.clear(true);
            addChatMsg('system', `Round ${msg.round} - ${isDrawer ? 'Your turn to draw!' : msg.drawerName + ' is drawing'}`, 'system');
            break;
        case 'pick':
            showWordChoice(msg.words);
            break;
        case 'start':
            $('hint').textContent = msg.hint;
            $('word-choice').classList.add('hidden');
            break;
        case 'stroke':
            if (!isDrawer) drawCanvas.addRemoteStroke(msg);
            break;
        case 'clear':
            if (!isDrawer) drawCanvas.clear(true);
            break;
        case 'undo':
            if (!isDrawer) { drawCanvas.strokes.pop(); drawCanvas.redraw(); }
            break;
        case 'fill':
            if (!isDrawer) drawCanvas.applyRemoteFill(msg.x, msg.y, msg.color);
            break;
        case 'chat':
            if (msg.correct) {
                addChatMsg(msg.name, msg.text, 'correct');
                if (msg.from === myId) { guessedCorrectly = true; $('chat-input').disabled = true; $('chat-input').placeholder = 'You guessed it!'; }
            } else if (msg.close) {
                addChatMsg(msg.name, msg.text, 'close-guess');
            } else {
                addChatMsg(msg.name, msg.text, '', msg.color);
            }
            break;
        case 'hint':
            $('hint').textContent = msg.hint;
            break;
        case 'timer':
            $('timer').textContent = msg.sec;
            if (msg.sec <= 10 && msg.sec > 0) sfx.tick();
            break;
        case 'reveal':
            $('hint').textContent = msg.word;
            addChatMsg('system', `The word was: ${msg.word}`, 'system');
            break;
        case 'scores':
            // Could show a score popup, but we'll just keep chat
            for (const p of msg.list) {
                addChatMsg('system', `${p.name}: ${p.score} pts`, 'system');
            }
            break;
        case 'results':
            showResults(msg.list);
            break;
        case 'toLobby':
            view = 'lobby';
            show('lobby');
            playMusic('lobby');
            break;
    }
}

// ============================================================
// Canvas init
// ============================================================
function initCanvas() {
    if (!drawCanvas) {
        drawCanvas = new DrawCanvas($('draw-canvas'));
        buildToolbar();
    }
    resizeCanvas();
    drawCanvas.clear(true);
    drawCanvas.setEnabled(false);
}

function resizeCanvas() {
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap) return;
    const maxW = Math.min(600, wrap.clientWidth - 24);
    const maxH = Math.min(400, wrap.clientHeight - 24);
    const aspect = 600 / 400;
    let w = maxW, h = maxW / aspect;
    if (h > maxH) { h = maxH; w = maxH * aspect; }
    drawCanvas.resize(Math.round(w), Math.round(h));
}

function buildToolbar() {
    // Colors
    const colorRow = $('color-row');
    DRAW_COLORS.forEach((c, i) => {
        const s = document.createElement('button');
        s.className = 'color-swatch' + (i === 0 ? ' on' : '');
        s.style.background = c;
        s.type = 'button';
        s.addEventListener('click', () => {
            colorRow.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('on'));
            s.classList.add('on');
            drawCanvas.setColor(c);
            updateToolBtns();
        });
        colorRow.appendChild(s);
    });
    // Sizes
    const sizeRow = $('size-row');
    SIZES.forEach((sz, i) => {
        const b = document.createElement('button');
        b.className = 'size-btn' + (i === 1 ? ' on' : '');
        b.type = 'button';
        b.textContent = sz.label;
        b.addEventListener('click', () => {
            sizeRow.querySelectorAll('.size-btn').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
            drawCanvas.setSize(sz.px);
        });
        sizeRow.appendChild(b);
    });
    // Tool buttons
    $('tool-eraser').addEventListener('click', () => { drawCanvas.setTool('eraser'); updateToolBtns(); });
    $('tool-fill').addEventListener('click', () => { drawCanvas.setTool('fill'); updateToolBtns(); });
    $('tool-undo').addEventListener('click', () => drawCanvas.undo());
    $('tool-clear').addEventListener('click', () => drawCanvas.clear());

    // Canvas callbacks
    drawCanvas.onStroke = stroke => act({ t: 'stroke', points: stroke.points, color: stroke.color, size: stroke.size, tool: stroke.tool });
    drawCanvas.onFill = (x, y, color) => act({ t: 'fill', x, y, color });
    drawCanvas.onClear = () => act({ t: 'clear' });
    drawCanvas.onUndo = () => act({ t: 'undo' });
}

function updateToolBtns() {
    $('tool-eraser').classList.toggle('on', drawCanvas.tool === 'eraser');
    $('tool-fill').classList.toggle('on', drawCanvas.tool === 'fill');
}

// ============================================================
// Word choice
// ============================================================
function showWordChoice(words) {
    const container = $('word-cards');
    container.innerHTML = '';
    for (const w of words) {
        const card = document.createElement('button');
        card.className = 'word-card';
        card.type = 'button';
        card.textContent = w;
        card.addEventListener('click', () => {
            $('word-choice').classList.add('hidden');
            act({ t: 'chose', word: w });
        });
        container.appendChild(card);
    }
    $('word-choice').classList.remove('hidden');
}

// ============================================================
// Chat
// ============================================================
function addChatMsg(sender, text, cls, color) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (cls ? ' ' + cls : '');
    if (cls === 'system') {
        div.textContent = text;
    } else {
        const s = document.createElement('span');
        s.className = 'sender';
        s.textContent = sender + ': ';
        if (color) s.style.color = color;
        div.appendChild(s);
        div.appendChild(document.createTextNode(text));
    }
    const msgs = $('chat-messages');
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    // Limit messages
    while (msgs.children.length > 100) msgs.firstChild.remove();
}

$('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendGuess();
});
$('btn-send').addEventListener('click', sendGuess);

function sendGuess() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    act({ t: 'guess', text });
}

// ============================================================
// Lobby UI
// ============================================================
function renderLobby() {
    $('room-code').textContent = roomCode;
    $('count').textContent = `${players.length}/${MAX_PLAYERS}`;
    const list = $('players');
    list.innerHTML = '';
    for (const p of players) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        li.innerHTML = `
            <span class="dot" style="background:${p.color}"></span>
            <span class="who"><b>${esc(p.name)}</b>${p.bot ? '<small>Bot</small>' : ''}</span>
            ${p.id === myId ? '<span class="badge host">You</span>' : ''}
            ${p.ready ? '<span class="badge ok">Ready</span>' : ''}
        `;
        list.appendChild(li);
    }
    // Empty slots
    for (let i = players.length; i < MAX_PLAYERS; i++) {
        const li = document.createElement('li');
        li.className = 'player empty';
        li.textContent = 'Empty slot';
        list.appendChild(li);
    }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Results
// ============================================================
function showResults(list) {
    view = 'results';
    show('results');
    playMusic('lobby');
    sfx.reveal();
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = p.id === myId ? 'me' : '';
        li.innerHTML = `
            <span class="place">${p.place}</span>
            <span class="dot" style="background:${p.color}"></span>
            <span class="who"><b>${esc(p.name)}</b></span>
            <span class="score">${p.score}</span>
        `;
        ol.appendChild(li);
    }
    if (list.length && list[0].id === myId) {
        $('results-title').textContent = 'You Win!';
    } else {
        $('results-title').textContent = 'Final Scores';
    }
}

// ============================================================
// Room management
// ============================================================
async function createRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('drawName', myName); } catch {}
    setStatus('menu-status', 'Creating room...');
    roomCode = makeCode();
    role = 'host';
    document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try {
        await hn.open(roomCode);
    } catch (e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return createRoom(); }
        setStatus('menu-status', e.message, true);
        role = null; document.body.classList.remove('is-host');
        return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = [];
    H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    enterLobby();
}

async function joinRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('drawName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining...');
    role = 'client';
    document.body.classList.remove('is-host');
    const cn = new ClientNet({
        onMessage: clientHandle,
        onClose: () => leave('Lost connection to the host.'),
        onStatus: msg => setStatus('menu-status', msg),
        forceRelay: new URLSearchParams(location.search).get('net') === 'relay',
    });
    try {
        myId = await cn.connect(code);
    } catch (e) {
        setStatus('menu-status', e.message, true);
        role = null; return;
    }
    net = cn;
    roomCode = code;
    cn.send({ t: 'hello', name: myName });
    enterLobby();
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('drawName', myName); } catch {}
    role = 'host';
    document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----';
    H.players = [];
    H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 3; i++) addBot();
    enterLobby();
}

function enterLobby() {
    view = 'lobby';
    show('lobby');
    playMusic('lobby');
    setStatus('menu-status', '');
    $('chat-messages').innerHTML = '';
}

function leave(reason) {
    const n = net; net = null;
    if (n) n.close();
    clearInterval(H.timer);
    clearBotTimers();
    role = null; myId = null; roomCode = '';
    H.players = []; H.phase = 'lobby';
    view = 'menu';
    show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('lobby');
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
    else if (confirm(role === 'host' ? 'Leave and close this room for everyone?' : 'Leave this room?')) leave();
});
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => addBot());
$('btn-ready').addEventListener('click', () => {
    const p = players.find(p => p.id === myId);
    act({ t: 'ready', r: !p?.ready });
});
$('btn-start').addEventListener('click', () => startGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    for (const p of H.players) { p.ready = p.bot; p.score = 0; }
    emitLobby();
    emit({ t: 'toLobby' });
});

// Mute
function syncMute() {
    $('icon-sound').classList.toggle('hidden', isMuted());
    $('icon-muted').classList.toggle('hidden', !isMuted());
}
syncMute();
$('btn-mute').addEventListener('click', () => {
    unlockAudio();
    setMuted(!isMuted());
    syncMute();
});

// Resize canvas on window resize
addEventListener('resize', () => { if (drawCanvas && view === 'game') resizeCanvas(); });

// Start music
playMusic('lobby');
