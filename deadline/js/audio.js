// Synthesized audio for Deadline (Tron lightcycle game). No audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('deadlineMuted') === '1'; } catch { return false; } })();

// Engine hum state
let engineOsc = null;
let engineGain = null;
let engineFilter = null;

export const isMuted = () => muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('deadlineMuted', m ? '1' : '0'); } catch {}
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

    turn: () => {
        // Sharp clicking when turning: quick square snap + triangle tail
        tone(1200, 800, 0.03, 'square', 0.06);
        tone(2000, 1500, 0.02, 'triangle', 0.04, 0.01);
    },

    boost: () => {
        // Rising whoosh: noise burst + dual rising tones
        noise(0.3, 0.15, 2000, 2);
        tone(200, 800, 0.28, 'sine', 0.08);
        tone(400, 1200, 0.28, 'triangle', 0.05, 0.02);
    },

    die: () => {
        // Explosion: low thud + noise bursts + descending sawtooth
        tone(80, 20, 0.3, 'sine', 0.3);
        noise(0.2, 0.25, 400, 3);
        noise(0.15, 0.2, 800, 2, 0.05);
        noise(0.1, 0.15, 1200, 1, 0.1);
        tone(600, 100, 0.5, 'sawtooth', 0.1, 0.05);
    },

    shield: () => {
        // Metallic deflection ping: high triangle pings
        tone(2000, 1500, 0.06, 'triangle', 0.08);
        tone(3000, 2200, 0.04, 'triangle', 0.06, 0.03);
    },

    gap: () => {
        // Erasing sound: descending noise sweep + falling sine
        noise(0.2, 0.15, 3000, 3);
        noise(0.15, 0.1, 800, 2, 0.05);
        tone(1200, 200, 0.25, 'sine', 0.08);
    },

    powerup: () => {
        // Rising chime: stacked triangles climbing in pitch
        tone(400, 400, 0.08, 'triangle', 0.1);
        tone(600, 600, 0.08, 'triangle', 0.1, 0.07);
        tone(800, 800, 0.08, 'triangle', 0.1, 0.14);
        tone(1000, 1000, 0.12, 'triangle', 0.1, 0.21);
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

    wall: () => {
        // Wall hit before dying: low sine thud + noise
        tone(100, 50, 0.15, 'sine', 0.25);
        noise(0.1, 0.2, 300, 3);
    },
};

// --- Engine hum system ---

export function startEngine() {
    if (!ctx || engineOsc) return;

    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.setValueAtTime(80, ctx.currentTime);

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.setValueAtTime(200, ctx.currentTime);
    engineFilter.Q.setValueAtTime(1, ctx.currentTime);

    engineGain = ctx.createGain();
    engineGain.gain.setValueAtTime(0.06, ctx.currentTime);

    engineOsc.connect(engineFilter).connect(engineGain).connect(master);
    engineOsc.start();
}

export function updateEngine(speed, boosting) {
    if (!engineOsc) return;
    const t = ctx.currentTime;
    const baseFreq = 60 + speed * 1.5;
    const freq = boosting ? baseFreq * 1.5 : baseFreq;
    engineOsc.frequency.setTargetAtTime(freq, t, 0.05);

    // Open up the filter when going faster / boosting
    const filterFreq = 200 + speed * 2 + (boosting ? 200 : 0);
    engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.05);

    // Slightly louder when boosting
    const vol = boosting ? 0.09 : 0.06;
    engineGain.gain.setTargetAtTime(vol, t, 0.05);
}

export function stopEngine() {
    if (engineOsc) {
        try { engineOsc.stop(); } catch {}
        try { engineOsc.disconnect(); } catch {}
        engineOsc = null;
    }
    if (engineFilter) {
        try { engineFilter.disconnect(); } catch {}
        engineFilter = null;
    }
    if (engineGain) {
        try { engineGain.disconnect(); } catch {}
        engineGain = null;
    }
}
