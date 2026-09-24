// Tiny synth sound effects, no audio files.

export const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};

let actx = null;
let muted = store.get('tanksMuted') === '1';

export function audio() {
    if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
}

export const isMuted = () => muted;
export function setMuted(m) {
    muted = m;
    store.set('tanksMuted', muted ? '1' : '0');
}

function tone(f0, f1, dur, type, vol) {
    const a = !muted && audio();
    if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur);
}

function noise(dur, vol, cutoff) {
    const a = !muted && audio();
    if (!a) return;
    const t = a.currentTime;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
}

export const sfx = {
    shoot: () => tone(520, 170, 0.1, 'square', 0.045),
    rocket: () => tone(260, 80, 0.2, 'sawtooth', 0.05),
    bounce: () => tone(950, 650, 0.05, 'triangle', 0.05),
    boom: () => noise(0.7, 0.4, 1000),
    crate: () => noise(0.22, 0.18, 2600),
    mine: () => tone(700, 700, 0.06, 'square', 0.03),
    beep: () => tone(1400, 1400, 0.04, 'square', 0.02),
    fizzle: () => tone(300, 200, 0.05, 'triangle', 0.03),
    count: () => tone(660, 660, 0.12, 'square', 0.04),
    go: () => tone(990, 990, 0.25, 'square', 0.05),
    join: () => tone(520, 880, 0.12, 'triangle', 0.05),
    click: () => tone(800, 600, 0.04, 'triangle', 0.03),
};
