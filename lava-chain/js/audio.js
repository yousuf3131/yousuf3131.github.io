// Lava Chain — audio.js  (Web Audio API, no files)
let ctx = null;
let muted = false;
let masterGain = null;

function getCtx() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = muted ? 0 : 0.7;
        masterGain.connect(ctx.destination);
    }
    return ctx;
}

export function unlockAudio() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
}

export function setMuted(m) {
    muted = m;
    if (masterGain) masterGain.gain.setTargetAtTime(m ? 0 : 0.7, getCtx().currentTime, 0.05);
}
export function isMuted() { return muted; }

function out() { return masterGain || getCtx().destination; }
function now() { return getCtx().currentTime; }

// Short burst helper
function playTone(freq, type, vol, dur, attack = 0.005, release = 0.08) {
    const c = getCtx();
    const g = c.createGain();
    g.connect(out());
    const osc = c.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(g);
    const t = now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur + release);
    osc.start(t); osc.stop(t + attack + dur + release + 0.05);
}

// Footstep thud
let stepPhase = 0;
export const sfx = {
    step() {
        stepPhase = 1 - stepPhase;
        playTone(stepPhase ? 90 : 75, 'sine', 0.28, 0.06, 0.003, 0.04);
        // Soft noise layer
        const c = getCtx();
        const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.08;
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.setValueAtTime(0.15, now());
        g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.06);
        const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 800;
        src.connect(filt); filt.connect(g); g.connect(out());
        src.start();
    },

    jump() {
        playTone(180, 'sine', 0.2, 0.04, 0.003, 0.12);
        playTone(260, 'sine', 0.1, 0.03, 0.003, 0.12);
    },

    land() {
        playTone(65, 'sine', 0.4, 0.08, 0.002, 0.05);
        const c = getCtx();
        const buf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*0.4*(1-i/d.length);
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.value = 0.3;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
        src.connect(f); f.connect(g); g.connect(out()); src.start();
    },

    chainTaut() {
        // metallic clank
        playTone(320, 'sawtooth', 0.12, 0.02, 0.001, 0.06);
        playTone(480, 'square',   0.06, 0.02, 0.001, 0.06);
    },

    chainSnap() {
        // loud crunch burst
        const c = getCtx();
        const buf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*(1-i/d.length)**1.5;
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.value = 0.55;
        src.connect(g); g.connect(out()); src.start();
        playTone(55, 'sawtooth', 0.35, 0.12, 0.002, 0.05);
    },

    lavaTouch() {
        // sizzle + low boom
        const c = getCtx();
        const buf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*(1-i/d.length)**0.8 * 0.6;
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.value = 0.5;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.5;
        src.connect(f); f.connect(g); g.connect(out()); src.start();
        playTone(42, 'sine', 0.5, 0.25, 0.002, 0.12);
    },

    crumble() {
        // rumble
        playTone(55, 'sawtooth', 0.2, 0.3, 0.04, 0.25);
        playTone(82, 'square',   0.1, 0.2, 0.02, 0.15);
    },

    escape() {
        // ascending arpeggio
        [330, 440, 550, 660, 880].forEach((f, i) => {
            setTimeout(() => playTone(f, 'sine', 0.25, 0.15, 0.01, 0.12), i * 80);
        });
    },

    eliminated() {
        // descending minor sting
        [350, 280, 210, 160].forEach((f, i) => {
            setTimeout(() => playTone(f, 'sawtooth', 0.18, 0.18, 0.005, 0.1), i * 90);
        });
    },
};

// ── Lava rumble (looping) ──────────────────────────────────────────────────
let lavaRumbleNode = null;
let lavaRumbleGain = null;

export function startLavaRumble() {
    if (lavaRumbleNode) return;
    const c = getCtx();
    lavaRumbleGain = c.createGain();
    lavaRumbleGain.gain.value = 0;
    lavaRumbleGain.connect(out());
    lavaRumbleGain.gain.linearRampToValueAtTime(0.22, c.currentTime + 1.5);

    // Sub oscillator
    const osc = c.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 32;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.5;
    const lfoGain = c.createGain(); lfoGain.gain.value = 8;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 140;
    osc.connect(filt); filt.connect(lavaRumbleGain);
    osc.start(); lfo.start();
    lavaRumbleNode = [osc, lfo];
}

export function stopLavaRumble() {
    if (!lavaRumbleNode) return;
    if (lavaRumbleGain) lavaRumbleGain.gain.setTargetAtTime(0, getCtx().currentTime, 0.3);
    setTimeout(() => {
        if (lavaRumbleNode) { lavaRumbleNode.forEach(n => { try { n.stop(); } catch {} }); lavaRumbleNode = null; }
    }, 1200);
}

export function setLavaIntensity(t) {
    // t: 0..1 — raises lava rumble volume
    if (lavaRumbleGain) lavaRumbleGain.gain.setTargetAtTime(0.1 + t * 0.35, getCtx().currentTime, 0.3);
}

export function tickAudio() {} // hook for future use
