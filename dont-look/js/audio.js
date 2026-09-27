// Don't Look — horror audio (Web Audio API, no files)
let ctx, master;
let _muted = false;
let _heartNode = null, _heartGain = null;
let _monsterRumbleNode = null, _monsterRumbleGain = null;

try { _muted = JSON.parse(localStorage.getItem('dlMuted') || 'false'); } catch {}

export const isMuted = () => _muted;
export const getCtx = () => ctx;

export function unlockAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = _muted ? 0 : 0.5;
    master.connect(ctx.destination);
}

export function setMuted(m) {
    _muted = !!m;
    try { localStorage.setItem('dlMuted', JSON.stringify(_muted)); } catch {}
    if (master) master.gain.setTargetAtTime(_muted ? 0 : 0.5, ctx.currentTime, 0.05);
}

function conn(node) { node.connect(master); return node; }

function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.01);
}

function noise(dur, vol, freq, q = 1, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const bufLen = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.01);
}

export const sfx = {
    click() {
        tone(600, 500, 0.06, 'square', 0.08);
    },
    join() {
        tone(300, 500, 0.15, 'sine', 0.18);
        tone(500, 600, 0.12, 'sine', 0.12, 0.12);
    },

    // Footstep — dull thud alternating pitch
    _stepAlt: false,
    step() {
        if (!ctx) return;
        const freq = this._stepAlt ? 55 : 48;
        this._stepAlt = !this._stepAlt;
        noise(0.09, 0.25, freq, 0.6);
        tone(freq, freq * 0.6, 0.09, 'sine', 0.12);
    },

    // Heartbeat — double thump
    heartbeat(rate = 1.0) {
        if (!ctx) return;
        const interval = 60 / (rate * 72 + 20); // BPM 92 to 92+extra
        // thump 1
        tone(60, 40, 0.12, 'sine', 0.35);
        noise(0.12, 0.2, 70, 0.4);
        // thump 2
        tone(55, 35, 0.10, 'sine', 0.28, 0.15);
        noise(0.10, 0.18, 65, 0.4, 0.15);
    },

    // Deep sub-bass rumble when monster moving — one-shot version
    monsterMove() {
        if (!ctx) return;
        // Sub-bass
        tone(28, 22, 0.5, 'sawtooth', 0.25);
        tone(32, 25, 0.5, 'sawtooth', 0.20, 0.02);
        noise(0.5, 0.12, 80, 0.3);
    },

    // Screech when monster freezes
    monsterFreeze() {
        if (!ctx) return;
        // High cut screech
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(4000, t);
        filter.frequency.exponentialRampToValueAtTime(800, t + 0.25);
        filter.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
        osc.connect(filter); filter.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + 0.3);
        // Low thud
        tone(80, 30, 0.2, 'sine', 0.3);
    },

    // Ritual activation — eerie low chime
    ritual() {
        tone(220, 180, 1.2, 'sine', 0.22);
        tone(330, 300, 1.0, 'sine', 0.15, 0.05);
        tone(165, 155, 0.8, 'sine', 0.12, 0.1);
        noise(0.4, 0.06, 180, 2);
    },

    // All rituals complete — rising tone
    allRituals() {
        tone(200, 600, 1.5, 'sine', 0.28);
        tone(250, 750, 1.3, 'sine', 0.22, 0.1);
        tone(300, 900, 1.1, 'sine', 0.18, 0.2);
    },

    // Caught — sting
    caught() {
        tone(200, 80, 0.8, 'sawtooth', 0.35);
        tone(150, 60, 0.7, 'sawtooth', 0.28, 0.05);
        noise(0.6, 0.2, 120, 1.5);
        noise(0.4, 0.15, 60, 1, 0.1);
    },

    // Escaped — hopeful release
    escape() {
        tone(440, 660, 0.6, 'sine', 0.25);
        tone(550, 880, 0.5, 'sine', 0.2, 0.08);
        tone(660, 1100, 0.4, 'sine', 0.15, 0.18);
    },

    // Countdown beep
    count() { tone(880, 880, 0.1, 'square', 0.12); },
    go() {
        tone(440, 660, 0.3, 'sine', 0.22);
        tone(660, 880, 0.25, 'sine', 0.18, 0.12);
    },
};

// ── Continuous heartbeat loop ──────────────────────────────────────────────
let _hbRate = 0, _hbTimer = 0, _hbActive = false;
export function startHeartbeat() { _hbActive = true; }
export function stopHeartbeat() { _hbActive = false; _hbTimer = 0; }
export function setHeartbeatRate(r) { _hbRate = r; } // 0–1

export function tickAudio(dt) {
    if (!ctx || !_hbActive) return;
    _hbTimer -= dt;
    if (_hbTimer <= 0) {
        const bpm = 55 + _hbRate * 85; // 55–140 BPM
        _hbTimer = 60 / bpm;
        sfx.heartbeat(_hbRate);
    }
}

// ── Continuous monster rumble (while moving) ───────────────────────────────
export function startMonsterRumble() {
    if (!ctx || _monsterRumbleNode) return;
    _monsterRumbleGain = ctx.createGain();
    _monsterRumbleGain.gain.value = 0;
    _monsterRumbleGain.gain.setTargetAtTime(0.18, ctx.currentTime, 0.3);
    _monsterRumbleGain.connect(master);

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 80;
    src.connect(filter);
    filter.connect(_monsterRumbleGain);
    src.start();
    _monsterRumbleNode = src;
}

export function stopMonsterRumble() {
    if (!_monsterRumbleNode) return;
    if (_monsterRumbleGain) {
        _monsterRumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        setTimeout(() => {
            try { _monsterRumbleNode && _monsterRumbleNode.stop(); } catch {}
            _monsterRumbleNode = null;
            _monsterRumbleGain = null;
        }, 600);
    } else {
        try { _monsterRumbleNode.stop(); } catch {}
        _monsterRumbleNode = null;
    }
}
