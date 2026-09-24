// Every sound is synthesised on the fly with the Web Audio API; there are no audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('eyesMuted') === '1'; } catch (e) { return false; } })();

export const isMuted = () => muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('eyesMuted', m ? '1' : '0'); } catch (e) { /* storage unavailable */ }
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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
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

// One distinct sound per ping type, so the walker can tell them apart without looking
const PING_SOUNDS = {
    arrow: () => { tone(660, 660, 0.09, 'triangle', 0.12); tone(990, 990, 0.14, 'triangle', 0.12, 0.08); },
    stop: () => { tone(240, 220, 0.16, 'square', 0.1); tone(240, 220, 0.2, 'square', 0.1, 0.19); },
    jump: () => { tone(380, 1250, 0.22, 'sine', 0.18); tone(760, 2000, 0.16, 'triangle', 0.05, 0.03); },
    go: () => [523, 659, 784].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.11, i * 0.07)),
    danger: () => { for (let i = 0; i < 3; i++) { tone(880, 820, 0.09, 'sawtooth', 0.07, i * 0.11); tone(932, 870, 0.09, 'sawtooth', 0.05, i * 0.11); } },
};

export const sfx = {
    ping: kind => (PING_SOUNDS[kind] || PING_SOUNDS.arrow)(),
    count: () => tone(520, 520, 0.18, 'square', 0.08),
    go: () => { tone(880, 880, 0.45, 'square', 0.08); tone(1320, 1320, 0.45, 'triangle', 0.05); },
    jump: () => tone(300, 620, 0.14, 'triangle', 0.1),
    land: () => { noise(0.07, 0.12, 500, 0.8); tone(120, 70, 0.08, 'sine', 0.12); },
    step: () => noise(0.03, 0.04, 1600, 1.2),
    death: () => { tone(520, 60, 0.6, 'sawtooth', 0.12); noise(0.4, 0.25, 700, 0.6); tone(90, 40, 0.5, 'sine', 0.3, 0.05); },
    fall: () => tone(700, 90, 0.9, 'triangle', 0.1),
    respawn: () => { tone(300, 900, 0.3, 'sine', 0.1); tone(450, 1350, 0.3, 'triangle', 0.05, 0.05); },
    checkpoint: () => [659, 880, 1175].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.1, i * 0.09)),
    goal: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.34, 'triangle', 0.11, i * 0.11)),
    crack: () => { noise(0.12, 0.25, 2400, 1.5); tone(200, 120, 0.12, 'square', 0.04); },
    drop: () => { noise(0.3, 0.2, 400, 0.7); tone(180, 50, 0.4, 'sine', 0.15); },
    switchOn: () => { tone(420, 840, 0.12, 'square', 0.07); tone(840, 840, 0.18, 'triangle', 0.07, 0.1); },
    switchOff: () => tone(700, 300, 0.2, 'square', 0.06),
    door: () => { noise(0.6, 0.18, 220, 0.5); tone(70, 55, 0.6, 'sawtooth', 0.05); },
    denied: () => tone(200, 160, 0.14, 'square', 0.06),
    click: () => tone(900, 700, 0.05, 'triangle', 0.05),
    join: () => tone(600, 900, 0.12, 'triangle', 0.08),
    star: i => tone(880 + i * 220, 880 + i * 220, 0.25, 'triangle', 0.1),
};
