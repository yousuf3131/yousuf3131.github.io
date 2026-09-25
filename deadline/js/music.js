// Procedural synthwave music for Deadline (Tron lightcycle game).
// Web Audio API only — no audio files.

let ctx = null;
let masterGain = null;
let musicGain = null;
let current = null;
let volume = 0.3;

function getCtx() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 1;
            masterGain.connect(ctx.destination);
        } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('deadlineMusicVol', v.toFixed(2)); } catch {}
}

function init() {
    const c = getCtx();
    if (!c || musicGain) return;
    musicGain = c.createGain();
    musicGain.gain.value = volume;
    musicGain.connect(masterGain);
}

function stopCurrent() {
    if (!current) return;
    clearInterval(current.interval);
    for (const o of current.oscs) {
        try { o.gain.gain.setTargetAtTime(0, getCtx().currentTime, 0.1); } catch {}
        try { setTimeout(() => { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); }, 300); } catch {}
    }
    current = null;
}

function voice(type, freq, vol, filterFreq = 2000) {
    const c = getCtx();
    const osc = c.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq; filter.Q.value = 1;
    const gain = c.createGain(); gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(musicGain); osc.start();
    return { osc, gain, filter };
}

function playNote(v, freq, vol, dur) {
    const c = getCtx(); const t = c.currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(vol, t);
    v.gain.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.1);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.05, 0.08);
}

function playSustain(v, freq, vol, dur) {
    const c = getCtx(); const t = c.currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(vol, t, 0.3);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.1, 0.2);
}

// --- Menu Track: Dark ambient synthwave, 80 BPM, A minor ---
function startMenu() {
    const c = getCtx(); if (!c) return;
    const stepDur = 60 / 80 / 2; // eighth-note steps
    // A minor: A2=110, C3=130.8, D3=146.8, E3=164.8, G3=196
    const bass = voice('sawtooth', 55, 0, 300);
    const pad1 = voice('triangle', 220, 0, 500);
    const pad2 = voice('triangle', 330, 0, 600);
    const arp  = voice('triangle', 440, 0, 900);
    const oscs = [bass, pad1, pad2, arp];

    // Am-Em-Dm-Am chord roots and voicings
    const chords = [
        { b: 55,   p1: 220, p2: 330 },   // Am (A-C-E)
        { b: 82.4, p1: 247, p2: 330 },   // Em (E-G-B)
        { b: 73.4, p1: 220, p2: 294 },   // Dm (D-F-A)
        { b: 55,   p1: 220, p2: 330 },   // Am
    ];
    // A minor pentatonic arp: A4 C5 D5 E5 G5
    const arpNotes = [440, 523, 587, 659, 784, 659, 587, 523];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];
        // Bass: slow pulse on beats 0 and 4
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.09, stepDur * 3);
        // Pads: sustained whole-bar chords with slow attack
        if (beat === 0) {
            playSustain(pad1, ch.p1, 0.03, stepDur * 8);
            playSustain(pad2, ch.p2, 0.02, stepDur * 8);
        }
        // Arp: sparse — play every other eighth note for delay-like feel
        if (beat % 2 === 0) playNote(arp, arpNotes[beat], 0.018, stepDur * 0.7);
        step++;
    }, stepDur * 1000);
    current = { name: 'menu', interval, oscs };
}

// --- Game Track: Tense driving pulse, 130 BPM, D minor ---
function startGame() {
    const c = getCtx(); if (!c) return;
    const stepDur = 60 / 130 / 4; // sixteenth-note steps
    // D minor: D2=73.4, F2=87.3, G2=98, A2=110, Bb2=116.5
    const kick  = voice('sine', 150, 0, 200);
    const bass  = voice('sawtooth', 73.4, 0, 450);
    const lead  = voice('square', 294, 0, 1200);
    const hihat = voice('sawtooth', 8000, 0, 12000);
    const oscs  = [kick, bass, lead, hihat];

    // Dm-Gm-Am-Dm bass roots (octave pulse)
    const bassNotes = [73.4, 98, 110, 73.4];
    // D minor pentatonic melody: D4=294, F4=349, G4=392, A4=440, C5=523
    const melody = [
        [294, 0, 349, 0, 392, 0, 440, 0, 523, 0, 440, 0, 392, 0, 349, 0],
        [392, 0, 440, 0, 523, 0, 440, 0, 349, 0, 294, 0, 349, 0, 392, 0],
        [440, 0, 523, 0, 440, 0, 392, 0, 349, 0, 294, 0, 392, 0, 440, 0],
        [523, 0, 440, 0, 349, 0, 294, 0, 349, 0, 392, 0, 440, 0, 523, 0],
    ];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 16) % 4;
        const beat = step % 16;
        // Kick: pitch drop 150->40Hz on every quarter note
        if (beat % 4 === 0) {
            const t = c.currentTime;
            kick.osc.frequency.setValueAtTime(150, t);
            kick.osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
            kick.gain.gain.cancelScheduledValues(t);
            kick.gain.gain.setValueAtTime(0.14, t);
            kick.gain.gain.setTargetAtTime(0, t + 0.08, 0.04);
        }
        // Hi-hat: eighth-note bursts
        if (beat % 2 === 1) playNote(hihat, 8000 + Math.random() * 2000, 0.015, stepDur * 0.5);
        // Bass: eighth-note octave pulse
        if (beat % 2 === 0) playNote(bass, bassNotes[bar], 0.1, stepDur * 1.5);
        // Lead: filtered minor pentatonic melody
        const note = melody[bar][beat];
        if (note > 0) playNote(lead, note, 0.03, stepDur * 1.5);
        step++;
    }, stepDur * 1000);
    current = { name: 'game', interval, oscs };
}

// --- Results Track: Triumphant synthwave, 110 BPM, D major ---
function startResults() {
    const c = getCtx(); if (!c) return;
    const stepDur = 60 / 110 / 2; // eighth-note steps
    // D major: D3=146.8, G3=196, A3=220
    const bass = voice('sawtooth', 146.8, 0, 500);
    const pad  = voice('triangle', 294, 0, 1100);
    const pad2 = voice('triangle', 370, 0, 1100);
    const lead = voice('triangle', 587, 0, 1600);
    const oscs = [bass, pad, pad2, lead];

    // D-G-A-D major chords
    const chords = [
        { b: 146.8, p1: 294, p2: 370 },  // D major (D-F#-A)
        { b: 196,   p1: 392, p2: 494 },  // G major (G-B-D)
        { b: 220,   p1: 440, p2: 554 },  // A major (A-C#-E)
        { b: 146.8, p1: 294, p2: 370 },  // D major
    ];
    // Celebratory hook in D major: D5 F#5 A5 D6 A5 F#5 A5 D6
    const melodyNotes = [587, 740, 880, 1175, 880, 740, 880, 1175];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];
        // Bass: half-note pulse
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.1, stepDur * 3.5);
        // Pad: sustained chords, brighter filter
        if (beat === 0) {
            playSustain(pad, ch.p1, 0.035, stepDur * 8);
            playSustain(pad2, ch.p2, 0.025, stepDur * 8);
        }
        // Lead: celebratory melodic hook
        playNote(lead, melodyNotes[beat], 0.025, stepDur * 0.9);
        step++;
    }, stepDur * 1000);
    current = { name: 'results', interval, oscs };
}

// --- Public API ---

export function startMusic(trackName) {
    init();
    if (current && current.name === trackName) return;
    stopCurrent();
    if (!getCtx()) return;
    if (trackName === 'menu') startMenu();
    else if (trackName === 'game') startGame();
    else if (trackName === 'results') startResults();
}

export function stopMusic() {
    if (!current) return;
    // Fade out then stop
    if (musicGain) {
        const c = getCtx();
        if (c) musicGain.gain.setTargetAtTime(0, c.currentTime, 0.15);
    }
    setTimeout(() => {
        stopCurrent();
        // Restore gain for next play
        if (musicGain) musicGain.gain.value = volume;
    }, 500);
}

// Load saved volume
try { const saved = localStorage.getItem('deadlineMusicVol'); if (saved !== null) volume = parseFloat(saved) || 0.3; } catch {}
