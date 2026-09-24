// Synthesized audio for Sumo Smash. No audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('sumoMuted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('sumoMuted', m ? '1' : '0'); } catch {}
    if (master) master.gain.value = m ? 0 : 0.8;
}

export function unlockAudio() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : 0.8;
            master.connect(ctx.destination);
        } catch { return; }
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
    o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.3, freq = 1000, q = 1, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(master); src.start(t);
}

export const sfx = {
    click: () => tone(900, 700, 0.05, 'triangle', 0.05),
    join: () => tone(600, 900, 0.12, 'triangle', 0.08),
    dash: () => {
        // Whoosh: noise sweep + rising tone
        noise(0.2, 0.15, 2000, 2);
        tone(300, 800, 0.18, 'sine', 0.08);
    },
    hit: () => {
        // Impact thud: low tone + noise burst
        tone(80, 40, 0.15, 'sine', 0.25);
        noise(0.1, 0.2, 400, 3);
    },
    fall: () => {
        // Descending pitch: falling away
        tone(600, 100, 0.4, 'sine', 0.12);
        tone(500, 80, 0.45, 'triangle', 0.06, 0.05);
    },
    powerup: () => {
        // Rising chime: pickup feel
        tone(400, 400, 0.08, 'triangle', 0.1);
        tone(600, 600, 0.08, 'triangle', 0.1, 0.07);
        tone(800, 800, 0.08, 'triangle', 0.1, 0.14);
        tone(1000, 1000, 0.12, 'triangle', 0.1, 0.21);
    },
    shrink: () => {
        // Low rumble: noise burst at low frequency
        noise(0.25, 0.25, 150, 2);
        tone(60, 40, 0.2, 'sine', 0.15);
    },
    shield: () => {
        // Clink: high triangle ping
        tone(2000, 1500, 0.06, 'triangle', 0.08);
        tone(3000, 2200, 0.04, 'triangle', 0.06, 0.03);
    },
    count: () => {
        // Countdown beep
        tone(520, 520, 0.18, 'square', 0.08);
    },
    go: () => {
        // Start sound: rising two-tone
        tone(523, 523, 0.1, 'triangle', 0.12);
        tone(784, 784, 0.15, 'triangle', 0.12, 0.08);
    },
};
