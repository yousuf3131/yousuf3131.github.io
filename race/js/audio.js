// Every sound is synthesised on the fly with the Web Audio API; there are no audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('bonkMuted') === '1'; } catch (e) { return false; } })();

export const isMuted = () => muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('bonkMuted', m ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    if (master) master.gain.value = m ? 0 : 0.9;
}

export function unlockAudio() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : 0.9;
            master.connect(ctx.destination);
        } catch (e) {
            return;
        }
    }
    if (ctx.state === 'suspended') ctx.resume();
}

function tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.3, freq = 1000, q = 1, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(t);
}

export const sfx = {
    count: () => tone(520, 520, 0.18, 'square', 0.08),
    go: () => { tone(880, 880, 0.45, 'square', 0.09); tone(1320, 1320, 0.45, 'triangle', 0.05); },
    bonk: (v = 1) => { tone(420, 80, 0.28, 'sine', 0.45 * v); noise(0.08, 0.2 * v, 400); },
    whack: (v = 1) => { noise(0.14, 0.55 * v, 1800, 0.8); tone(300, 110, 0.14, 'triangle', 0.15 * v); },
    squawk: (v = 1) => { tone(700, 1500, 0.09, 'square', 0.12 * v); tone(1300, 450, 0.22, 'square', 0.12 * v, 0.08); },
    kick: (v = 1) => { tone(170, 45, 0.2, 'sine', 0.5 * v); noise(0.06, 0.25 * v, 2500); },
    whoosh: () => noise(0.25, 0.14, 900, 0.6),
    boost: () => { tone(300, 950, 0.35, 'sawtooth', 0.05); noise(0.35, 0.1, 1200); },
    bump: () => { noise(0.1, 0.25, 300); tone(90, 50, 0.12, 'sine', 0.25); },
    lap: () => { tone(660, 660, 0.12, 'triangle', 0.1); tone(990, 990, 0.22, 'triangle', 0.1, 0.1); },
    finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.28, 'triangle', 0.1, i * 0.12)),
    horn: (v = 1) => { tone(180, 160, 0.5, 'sawtooth', 0.3 * v); tone(240, 220, 0.45, 'square', 0.15 * v); noise(0.15, 0.15 * v, 300, 0.5); },
    click: () => tone(900, 700, 0.05, 'triangle', 0.05),
    join: () => tone(600, 900, 0.12, 'triangle', 0.08),
    scrape: (v = 1) => { noise(0.12, 0.16 * v, 3200, 1.4); noise(0.08, 0.1 * v, 900, 1); },
    nitro: () => { noise(0.5, 0.22, 700, 0.5); tone(120, 520, 0.45, 'sawtooth', 0.07); tone(90, 260, 0.6, 'square', 0.04); },
    pickup: () => { tone(900, 1400, 0.08, 'triangle', 0.08); tone(1300, 1900, 0.1, 'triangle', 0.06, 0.06); },
    tick: () => tone(1500, 1400, 0.03, 'square', 0.025),
    itemGet: () => { tone(660, 660, 0.08, 'triangle', 0.09); tone(990, 990, 0.14, 'triangle', 0.09, 0.07); },
    throw: () => { noise(0.18, 0.16, 1400, 0.7); tone(500, 250, 0.15, 'triangle', 0.06); },
    splat: (v = 1) => { noise(0.22, 0.5 * v, 500, 0.6); tone(180, 60, 0.2, 'sine', 0.3 * v); },
    punch: (v = 1) => { tone(160, 60, 0.18, 'sine', 0.5 * v); noise(0.07, 0.35 * v, 1800); tone(700, 1400, 0.25, 'triangle', 0.08 * v, 0.05); },
    boing: (v = 1) => tone(220, 660, 0.3, 'triangle', 0.12 * v),
    shieldUp: () => { tone(400, 1200, 0.35, 'sine', 0.1); tone(800, 1600, 0.3, 'triangle', 0.05, 0.05); },
    shieldPop: (v = 1) => { noise(0.12, 0.3 * v, 2600, 1); tone(1400, 300, 0.2, 'sine', 0.12 * v); },
    gum: (v = 1) => { tone(300, 120, 0.3, 'sine', 0.2 * v); noise(0.25, 0.15 * v, 350, 2); },
    slip: (v = 1) => { tone(800, 200, 0.5, 'sine', 0.12 * v); noise(0.3, 0.12 * v, 600, 1); },
    nearMiss: () => { noise(0.2, 0.14, 2200, 0.8); tone(700, 1100, 0.12, 'triangle', 0.05); },
    cheer: () => { noise(1.4, 0.18, 1600, 0.4); [784, 988, 1175].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.06, 0.1 + i * 0.1)); },
    miniturbo: (level = 1) => {
        const f = [0, 500, 650, 850][level];
        tone(f, f * 2, 0.3, 'sawtooth', 0.06);
        tone(f * 1.5, f * 2.5, 0.25, 'triangle', 0.04);
        noise(0.2, 0.12, 1400);
    },
};

// A single droning oscillator for your own engine, pitched by speed
export const engine = {
    osc: null,
    set(ratio, on) {
        if (!ctx) return;
        if (!this.osc) {
            this.osc = ctx.createOscillator();
            this.osc.type = 'sawtooth';
            this.filter = ctx.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.gain = ctx.createGain();
            this.gain.gain.value = 0;
            this.osc.connect(this.filter).connect(this.gain).connect(master);
            this.osc.start();
        }
        const t = ctx.currentTime;
        this.osc.frequency.setTargetAtTime(45 + ratio * 120, t, 0.05);
        this.filter.frequency.setTargetAtTime(380 + ratio * 900, t, 0.05);
        this.gain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.1);
    },
};

// Continuous tire screech during drift, pitch rises with charge level
export const driftSound = {
    osc: null,
    set(level, on) {
        if (!ctx) return;
        if (!this.osc) {
            this.osc = ctx.createOscillator();
            this.osc.type = 'sawtooth';
            this.filter = ctx.createBiquadFilter();
            this.filter.type = 'bandpass';
            this.filter.Q.value = 2;
            this.gain = ctx.createGain();
            this.gain.gain.value = 0;
            this.osc.connect(this.filter).connect(this.gain).connect(master);
            this.osc.start();
        }
        const t = ctx.currentTime;
        const freqs = [120, 180, 260, 380];
        const filters = [500, 700, 1000, 1400];
        this.osc.frequency.setTargetAtTime(freqs[level] || 120, t, 0.08);
        this.filter.frequency.setTargetAtTime(filters[level] || 500, t, 0.08);
        this.gain.gain.setTargetAtTime(on ? 0.025 : 0, t, on ? 0.06 : 0.15);
    },
};

// Looping noise through a filter: used for the nitro roar and the off-road rumble
function noiseLoop(type, freq, q) {
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return { f, g };
}

// Nitro: a roaring noise band plus a low growl, while the nitro burns
export const nitroSound = {
    n: null,
    set(on) {
        if (!ctx) return;
        if (!this.n) {
            this.n = noiseLoop('bandpass', 420, 0.7);
            this.osc = ctx.createOscillator();
            this.osc.type = 'sawtooth';
            this.osc.frequency.value = 70;
            this.og = ctx.createGain();
            this.og.gain.value = 0;
            this.osc.connect(this.og).connect(master);
            this.osc.start();
        }
        const t = ctx.currentTime;
        this.n.g.gain.setTargetAtTime(on ? 0.11 : 0, t, on ? 0.05 : 0.2);
        this.og.gain.setTargetAtTime(on ? 0.03 : 0, t, 0.1);
        this.osc.frequency.setTargetAtTime(on ? 95 : 70, t, 0.3);
    },
};

// Off-road rumble: low filtered noise while the wheels are on sand or grass
export const rumble = {
    n: null,
    set(level) {
        if (!ctx) return;
        if (!this.n) this.n = noiseLoop('lowpass', 180, 1);
        this.n.g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.16, ctx.currentTime, 0.08);
    },
};
