// Lava Chain — music.js  (procedural drone + percussion)
let ctx = null, masterGain = null;
let nodes = [];
let playing = false;
let tensionVal = 0;
let tensionGain = null;

function getCtx() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(ctx.destination);
    }
    return ctx;
}

export function play(muted) {
    if (playing) return;
    playing = true;
    const c = getCtx();
    if (c.state === 'suspended') c.resume();

    // Slow fade-in
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.5, c.currentTime, 1.5);

    // ── Base drone: detuned sawtooth pair ─────────────────────────────
    const baseFreqs = [42, 42.25, 84, 84.5];
    baseFreqs.forEach(f => {
        const osc = c.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = f;
        const g = c.createGain(); g.gain.value = 0.08;
        const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
        osc.connect(filt); filt.connect(g); g.connect(masterGain);
        osc.start(); nodes.push(osc);
    });

    // ── Heartbeat pulse ───────────────────────────────────────────────
    const pulseOsc = c.createOscillator();
    pulseOsc.type = 'sine'; pulseOsc.frequency.value = 48;
    const pulseGain = c.createGain(); pulseGain.gain.value = 0;
    pulseOsc.connect(pulseGain); pulseGain.connect(masterGain);
    pulseOsc.start(); nodes.push(pulseOsc);

    let bpm = 68;
    function beat() {
        if (!playing) return;
        const t = c.currentTime;
        const interval = 60 / bpm;
        // Double thump
        pulseGain.gain.setValueAtTime(0.22, t);
        pulseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        pulseGain.gain.setValueAtTime(0.14, t + 0.14);
        pulseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        bpm = 60 + tensionVal * 40; // speeds up with tension
        setTimeout(beat, interval * 1000);
    }
    beat();

    // ── Tension layer: higher drone that rises in mix ─────────────────
    const tensOsc = c.createOscillator();
    tensOsc.type = 'sawtooth'; tensOsc.frequency.value = 126;
    tensionGain = c.createGain(); tensionGain.gain.value = 0;
    const tensFilt = c.createBiquadFilter(); tensFilt.type = 'bandpass';
    tensFilt.frequency.value = 800; tensFilt.Q.value = 2;
    tensOsc.connect(tensFilt); tensFilt.connect(tensionGain); tensionGain.connect(masterGain);
    tensOsc.start(); nodes.push(tensOsc);

    // ── Tremolo on base ───────────────────────────────────────────────
    const tremLFO = c.createOscillator(); tremLFO.frequency.value = 0.22;
    const tremGain = c.createGain(); tremGain.gain.value = 0.03;
    tremLFO.connect(tremGain); tremGain.connect(masterGain.gain);
    tremLFO.start(); nodes.push(tremLFO);
}

export function stop() {
    if (!playing) return;
    playing = false;
    const c = getCtx();
    masterGain.gain.setTargetAtTime(0, c.currentTime, 0.5);
    setTimeout(() => {
        nodes.forEach(n => { try { n.stop(); } catch {} });
        nodes = [];
    }, 1200);
}

export function setVolume(v) {
    if (masterGain) masterGain.gain.setTargetAtTime(v, getCtx().currentTime, 0.2);
}

export function setTension(t) {
    // t: 0..1 — lava proximity / speed
    tensionVal = Math.max(0, Math.min(1, t));
    if (tensionGain) {
        tensionGain.gain.setTargetAtTime(tensionVal * 0.18, getCtx().currentTime, 0.4);
    }
}
