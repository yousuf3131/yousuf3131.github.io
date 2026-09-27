// Synthesized audio for Blackout. No audio files: ambience, heartbeat, footsteps, gunfire, screams.

let ctx = null, master = null, sfxBus = null, ambBus = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem('blackoutMuted') === '1'; } catch (e) { return false; } })();

export const isMuted = () => muted;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('blackoutMuted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}

export function unlockAudio() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14; comp.ratio.value = 4;
            master.connect(comp).connect(ctx.destination);
            sfxBus = ctx.createGain(); sfxBus.connect(master);
            ambBus = ctx.createGain(); ambBus.gain.value = 0.8; ambBus.connect(master);
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        } catch (e) { return; }
    }
    if (ctx.state === 'suspended') ctx.resume();
}

function out(pan = 0, bus = sfxBus) {
    if (!pan || !ctx.createStereoPanner) return bus;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(bus);
    return p;
}

function tone(f0, f1, dur, { type = 'sine', vol = 0.2, delay = 0, pan = 0, attack = 0.005, bus } = {}) {
    if (!ctx || vol < 0.003) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out(pan, bus || sfxBus));
    o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { vol = 0.3, type = 'bandpass', freq = 1000, q = 1, f1 = 0, delay = 0, pan = 0, attack = 0.002, bus } = {}) {
    if (!ctx || vol < 0.003) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out(pan, bus || sfxBus));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}

let distCurve = null;
function distortion() {
    if (!distCurve) {
        distCurve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; distCurve[i] = Math.tanh(x * 6); }
    }
    const w = ctx.createWaveShaper(); w.curve = distCurve; return w;
}

// Screams: detuned saws through a moving formant filter and a little distortion
function scream({ vol = 0.3, pan = 0, pitch = 520, dur = 1.1, harsh = 0.5 } = {}) {
    if (!ctx || vol < 0.003) return;
    const t = ctx.currentTime;
    const g = ctx.createGain(), f = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), d = distortion();
    f.type = 'bandpass'; f.Q.value = 5; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1300, t + dur * 0.3); f.frequency.linearRampToValueAtTime(700, t + dur);
    f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const mix = ctx.createGain(); mix.gain.value = 0.5 + harsh;
    for (const det of [0, 7, -11]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(pitch * 0.8, t); o.frequency.exponentialRampToValueAtTime(pitch * 1.25, t + dur * 0.2); o.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + dur);
        o.detune.value = det * 10;
        const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 7 + Math.random() * 3; vg.gain.value = pitch * 0.04;
        vib.connect(vg).connect(o.frequency);
        o.connect(mix); o.start(t); o.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
    }
    mix.connect(d);
    d.connect(f); d.connect(f2);
    f.connect(g); f2.connect(g);
    g.connect(out(pan));
}

export const sfx = {
    click: () => tone(1100, 800, 0.05, { type: 'triangle', vol: 0.06 }),
    tick: () => { tone(1400, 1300, 0.06, { type: 'square', vol: 0.05 }); },
    go: () => { tone(60, 40, 1.2, { vol: 0.45 }); noise(1.2, { vol: 0.18, type: 'lowpass', freq: 400, f1: 80 }); },
    torch: (vol = 0.15, pan = 0) => { noise(0.02, { vol, type: 'highpass', freq: 3000, pan }); tone(2400, 1800, 0.02, { type: 'square', vol: vol * 0.3, pan, delay: 0.01 }); },
    battery: () => { tone(660, 660, 0.12, { type: 'triangle', vol: 0.12 }); tone(990, 990, 0.2, { type: 'triangle', vol: 0.12, delay: 0.08 }); },
    step(surface, vol = 0.1, pan = 0) {
        if (vol < 0.004) return;
        const v = vol * (0.8 + Math.random() * 0.4);
        switch (surface) {
            case 'wood': tone(120, 70, 0.08, { vol: v * 0.9, pan }); noise(0.05, { vol: v * 0.5, freq: 900, q: 2, pan }); break;
            case 'tile': noise(0.04, { vol: v * 0.9, type: 'highpass', freq: 1800, pan }); tone(200, 120, 0.05, { vol: v * 0.3, pan }); break;
            case 'gravel': noise(0.12, { vol: v * 1.1, freq: 2600, q: 0.8, pan }); noise(0.08, { vol: v * 0.6, freq: 5000, q: 1, delay: 0.03, pan }); break;
            case 'corn': noise(0.22, { vol: v * 1.1, type: 'highpass', freq: 2500, pan, attack: 0.04 }); break;
            case 'water': noise(0.18, { vol: v * 1.2, freq: 900, q: 1.5, f1: 400, pan }); break;
            default: noise(0.09, { vol: v, type: 'lowpass', freq: 700, pan }); tone(90, 60, 0.07, { vol: v * 0.4, pan }); break;
        }
    },
    shot(vol = 0.6, pan = 0) {
        tone(110, 35, 0.5, { vol: vol * 0.9, pan });
        noise(0.08, { vol, type: 'lowpass', freq: 6000, f1: 800, pan });
        noise(0.9, { vol: vol * 0.5, type: 'lowpass', freq: 1400, f1: 120, pan, delay: 0.02 });
        noise(1.6, { vol: vol * 0.12, type: 'bandpass', freq: 400, q: 0.6, delay: 0.15, pan, attack: 0.1 }); // echo
    },
    pump(vol = 0.25, pan = 0) {
        noise(0.05, { vol, freq: 2200, q: 3, pan, delay: 0.25 }); tone(300, 180, 0.05, { type: 'square', vol: vol * 0.3, delay: 0.25, pan });
        noise(0.05, { vol, freq: 1600, q: 3, pan, delay: 0.42 }); tone(250, 160, 0.05, { type: 'square', vol: vol * 0.3, delay: 0.42, pan });
    },
    dry: () => { noise(0.03, { vol: 0.12, freq: 3000, q: 4 }); },
    reload: () => { for (let i = 0; i < 2; i++) { noise(0.04, { vol: 0.14, freq: 2400, q: 4, delay: i * 0.45 }); tone(500, 380, 0.04, { type: 'square', vol: 0.05, delay: i * 0.45 + 0.02 }); } },
    flare(vol = 0.3, pan = 0) { noise(0.25, { vol, type: 'highpass', freq: 1500, pan }); noise(2.2, { vol: vol * 0.35, type: 'bandpass', freq: 3500, q: 0.5, pan, delay: 0.15, attack: 0.2 }); },
    stun(vol = 0.4, pan = 0) {
        noise(0.5, { vol: vol * 0.6, type: 'bandpass', freq: 5000, q: 1, pan });
        tone(90, 60, 0.9, { type: 'sawtooth', vol: vol * 0.35, pan, attack: 0.02 });
        scream({ vol: vol * 0.5, pan, pitch: 150, dur: 1.0, harsh: 1 });
    },
    hunterScream(vol = 0.5, pan = 0) {
        scream({ vol, pan, pitch: 260, dur: 1.8, harsh: 1.2 });
        scream({ vol: vol * 0.6, pan, pitch: 390, dur: 1.5, harsh: 1 });
        tone(55, 40, 2, { type: 'sawtooth', vol: vol * 0.25, pan, attack: 0.2 });
    },
    death(vol = 0.4, pan = 0) { scream({ vol, pan, pitch: 480 + Math.random() * 160, dur: 0.9, harsh: 0.3 }); },
    hit(vol = 0.4, pan = 0) { noise(0.15, { vol, type: 'lowpass', freq: 500, pan }); tone(80, 40, 0.2, { vol: vol * 0.7, pan }); },
    dash(vol = 0.3, pan = 0) { noise(0.5, { vol, type: 'bandpass', freq: 300, q: 0.8, f1: 900, pan, attack: 0.05 }); tone(70, 110, 0.5, { type: 'sawtooth', vol: vol * 0.2, pan }); },
    roundStart(hunter) {
        tone(45, 30, 3, { vol: 0.5, attack: 0.01 });
        noise(2.5, { vol: 0.2, type: 'lowpass', freq: 200, f1: 60 });
        const base = hunter ? 110 : 220;
        [1, 1.06, 1.414].forEach((m, i) => tone(base * m, base * m * 0.98, 3, { type: 'sawtooth', vol: 0.035, attack: 1.2, delay: i * 0.05 }));
    },
    release: () => { tone(80, 50, 1.5, { type: 'sawtooth', vol: 0.18, attack: 0.02 }); noise(1.2, { vol: 0.3, type: 'lowpass', freq: 900, f1: 100 }); },
    win: () => { [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(f, f, 2.8, { type: 'triangle', vol: 0.07, attack: 0.4, delay: i * 0.12 })); },
    lose: () => { [110, 116.5, 155.6].forEach((f, i) => tone(f, f * 0.97, 3, { type: 'sawtooth', vol: 0.05, attack: 0.3, delay: i * 0.08 })); tone(50, 35, 2.5, { vol: 0.4 }); },
    dawn: () => { [392, 493.9, 587.3, 784].forEach((f, i) => tone(f, f, 3.5, { type: 'sine', vol: 0.06, attack: 0.8, delay: i * 0.25 })); },
    ping: () => { tone(1800, 1700, 0.3, { type: 'sine', vol: 0.05 }); },
};

/* ── heartbeat ─────────────────────────────────────────── */
let heartLevel = 0, heartNext = 0, heartTimer = null;
export function setHeart(level) {
    heartLevel = Math.max(0, Math.min(1, level));
    if (!ctx || heartTimer) return;
    heartTimer = setInterval(() => {
        if (!ctx || heartLevel < 0.02) return;
        const now = ctx.currentTime;
        if (now < heartNext - 0.1) return;
        const t = Math.max(now, heartNext);
        const bpm = 62 + heartLevel * 100, v = 0.12 + heartLevel * 0.5;
        const beat = (d, k) => {
            const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
            o.type = 'sine'; o.frequency.setValueAtTime(62, t + d); o.frequency.exponentialRampToValueAtTime(38, t + d + 0.14);
            f.type = 'lowpass'; f.frequency.value = 160;
            g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(v * k, t + d + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
            o.connect(f).connect(g).connect(sfxBus); o.start(t + d); o.stop(t + d + 0.25);
        };
        beat(0, 1); beat(0.2, 0.65);
        heartNext = t + 60 / bpm;
    }, 40);
}

/* ── ambience ──────────────────────────────────────────── */
let amb = null;
export function startAmbience(kind) {
    if (!ctx) return;
    stopAmbience();
    const nodes = [], timers = [];
    const t = ctx.currentTime;
    const bed = ctx.createGain(); bed.gain.setValueAtTime(0.0001, t); bed.gain.exponentialRampToValueAtTime(1, t + 2.5); bed.connect(ambBus);
    const loopNoise = (type, freq, q, vol, lfoRate = 0, lfoDepth = 0) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = vol;
        src.connect(f).connect(g).connect(bed); src.start();
        nodes.push(src);
        if (lfoRate) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = lfoRate; lg.gain.value = lfoDepth; l.connect(lg).connect(f.frequency); l.start(); nodes.push(l); }
    };
    // Low drone under everything
    const drone = ctx.createBiquadFilter(); drone.type = 'lowpass'; drone.frequency.value = 170;
    const dg = ctx.createGain(); dg.gain.value = 0.05; drone.connect(dg).connect(bed);
    for (const f of [41.2, 41.7, 61.8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(drone); o.start(); nodes.push(o); }
    // Wind
    loopNoise('lowpass', 420, 0.7, kind === 'yard' ? 0.2 : 0.12, 0.07, 260);
    if (kind === 'farm') { loopNoise('highpass', 1400, 0.3, 0.1); loopNoise('bandpass', 5000, 0.4, 0.05, 0.3, 800); }
    if (kind === 'asylum') {
        const hum = ctx.createGain(); hum.gain.value = 0.02; hum.connect(bed);
        for (const f of [60, 120, 180]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(hum); o.start(); nodes.push(o); }
    }
    const every = (min, max, fn) => {
        const go = () => { fn(); timers.push(setTimeout(go, (min + Math.random() * (max - min)) * 1000)); };
        timers.push(setTimeout(go, (min + Math.random() * (max - min)) * 1000));
    };
    if (kind === 'camp') {
        every(0.4, 1.4, () => { const f = 4200 + Math.random() * 600, p = Math.random() * 2 - 1; for (let i = 0; i < 3; i++) tone(f, f, 0.04, { type: 'sine', vol: 0.012, delay: i * 0.06, pan: p, bus: ambBus }); });
        every(8, 18, () => { tone(420, 380, 0.5, { vol: 0.02, pan: Math.random() * 2 - 1, attack: 0.05, bus: ambBus }); tone(420, 380, 0.5, { vol: 0.016, delay: 0.7, attack: 0.05, bus: ambBus }); }); // owl
    }
    if (kind === 'farm') every(9, 20, () => { noise(3, { vol: 0.12, type: 'lowpass', freq: 160, f1: 50, attack: 0.3, bus: ambBus }); }); // thunder
    if (kind === 'asylum') every(6, 14, () => { const p = Math.random() * 2 - 1; noise(0.3, { vol: 0.05, type: 'lowpass', freq: 300, pan: p, bus: ambBus }); tone(90, 60, 0.3, { vol: 0.04, pan: p, bus: ambBus }); }); // distant door
    if (kind === 'yard') every(5, 12, () => { const p = Math.random() * 2 - 1; noise(1.4, { vol: 0.03, type: 'bandpass', freq: 700 + Math.random() * 600, q: 18, f1: 400, pan: p, attack: 0.3, bus: ambBus }); }); // metal creak
    amb = { nodes, timers, bed };
}

export function stopAmbience() {
    if (!amb || !ctx) return;
    const a = amb; amb = null;
    a.timers.forEach(clearTimeout);
    a.bed.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    setTimeout(() => { a.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); a.bed.disconnect(); }, 2000);
}

// Menu: just the drone and wind, quieter
export function menuAmbience() { startAmbience('menu'); if (amb) amb.bed.gain.setTargetAtTime(0.6, ctx.currentTime, 1); }
