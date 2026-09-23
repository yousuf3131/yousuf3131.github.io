// Every sound is synthesised on the fly with the Web Audio API; there are no audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('bonkMuted') === '1'; } catch (e) { return false; } })();

export const isMuted = () => muted;

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
    click: () => tone(900, 700, 0.05, 'triangle', 0.05),
    join: () => tone(600, 900, 0.12, 'triangle', 0.08),
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
