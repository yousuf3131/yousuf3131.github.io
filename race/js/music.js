// Procedurally generated background music using Web Audio API.
// Three tracks: menu (chill), race (energetic), results (celebratory).
// Shares the AudioContext from audio.js.

import { getCtx, getMaster } from './audio.js?v=4';

let musicGain = null;
let current = null; // { name, interval, oscs }
let volume = 0.35;

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('bonkMusicVol', v.toFixed(2)); } catch {}
}
export function getMusicVolume() { return volume; }

function init() {
    const ctx = getCtx();
    if (!ctx || musicGain) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = volume;
    musicGain.connect(getMaster());
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

// Note frequency helper
const noteFreq = (note, octave) => {
    const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return 440 * Math.pow(2, (semitones[note[0]] + (note[1] === '#' ? 1 : 0) - 9) / 12 + (octave - 4));
};

// Create a persistent oscillator voice
function voice(type, freq, vol, filterFreq = 2000) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(musicGain);
    osc.start();
    return { osc, gain, filter };
}

// Short note envelope
function playNote(v, freq, vol, dur) {
    const ctx = getCtx();
    const t = ctx.currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(vol, t);
    v.gain.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.1);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.05, 0.08);
}

// ============================================================
// Track definitions
// ============================================================

const MENU_BPM = 90;
const RACE_BPM = 140;
const RESULTS_BPM = 110;

// Menu: Am chill groove - bass + pads + gentle arp
function startMenu() {
    const ctx = getCtx();
    if (!ctx) return;
    const stepDur = 60 / MENU_BPM / 2; // eighth notes
    const bass = voice('sawtooth', 110, 0, 400);
    const pad1 = voice('triangle', 220, 0, 800);
    const pad2 = voice('triangle', 330, 0, 800);
    const arp = voice('triangle', 440, 0, 1200);
    const oscs = [bass, pad1, pad2, arp];

    // Am - F - C - G progression
    const chords = [
        { b: 110, p: [220, 330] },  // Am
        { b: 87.3, p: [175, 262] }, // F
        { b: 130.8, p: [196, 330] }, // C
        { b: 98, p: [196, 294] },   // G
    ];
    const arpNotes = [440, 523, 660, 784, 660, 523, 440, 392];
    let step = 0;

    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];

        // Bass: play on beats 0, 4
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.12, stepDur * 3);
        // Pads: sustain through chord
        if (beat === 0) {
            playNote(pad1, ch.p[0], 0.04, stepDur * 8);
            playNote(pad2, ch.p[1], 0.03, stepDur * 8);
        }
        // Arp: each eighth note
        playNote(arp, arpNotes[beat] * (bar % 2 === 0 ? 1 : 0.84), 0.025, stepDur * 0.8);

        step++;
    }, stepDur * 1000);

    current = { name: 'menu', interval, oscs };
}

// Race: energetic driving music
function startRace() {
    const ctx = getCtx();
    if (!ctx) return;
    const stepDur = 60 / RACE_BPM / 4; // sixteenth notes
    const bass = voice('sawtooth', 110, 0, 500);
    const lead = voice('square', 440, 0, 1500);
    const kick = voice('sine', 60, 0, 200);
    const hihat = voice('sawtooth', 8000, 0, 12000);
    const oscs = [bass, lead, kick, hihat];

    // Em - C - D - B progression (more energetic)
    const bassNotes = [82.4, 65.4, 73.4, 61.7]; // E2, C2, D2, B1
    const leadPattern = [
        [659, 784, 880, 784, 659, 587, 659, 0, 784, 880, 988, 880, 784, 659, 784, 0],
        [523, 659, 784, 659, 523, 440, 523, 0, 659, 784, 880, 784, 659, 523, 659, 0],
        [587, 740, 880, 740, 587, 494, 587, 0, 740, 880, 988, 880, 740, 587, 740, 0],
        [494, 587, 740, 587, 494, 392, 494, 0, 587, 740, 880, 740, 587, 494, 587, 0],
    ];
    let step = 0;

    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 16) % 4;
        const beat = step % 16;

        // Kick: beats 0, 4, 8, 12
        if (beat % 4 === 0) playNote(kick, 60, 0.18, stepDur * 2);
        // Hihat: every other sixteenth
        if (beat % 2 === 0) playNote(hihat, 8000 + Math.random() * 2000, 0.015, stepDur * 0.5);
        // Snare noise on beats 4, 12
        if (beat === 4 || beat === 12) playNote(hihat, 4000, 0.04, stepDur * 1.5);
        // Bass
        if (beat === 0 || beat === 8) playNote(bass, bassNotes[bar], 0.1, stepDur * 6);
        // Lead melody
        const note = leadPattern[bar][beat];
        if (note > 0) playNote(lead, note, 0.035, stepDur * 1.5);

        step++;
    }, stepDur * 1000);

    current = { name: 'race', interval, oscs };
}

// Results: triumphant major key
function startResults() {
    const ctx = getCtx();
    if (!ctx) return;
    const stepDur = 60 / RESULTS_BPM / 2; // eighth notes
    const bass = voice('sawtooth', 130.8, 0, 500);
    const pad1 = voice('triangle', 262, 0, 1000);
    const pad2 = voice('triangle', 330, 0, 1000);
    const lead = voice('square', 523, 0, 2000);
    const oscs = [bass, pad1, pad2, lead];

    // C - G - Am - F (triumphant pop)
    const chords = [
        { b: 130.8, p: [262, 392] },
        { b: 98, p: [294, 392] },
        { b: 110, p: [262, 330] },
        { b: 87.3, p: [220, 349] },
    ];
    const melody = [
        [523, 0, 659, 784, 659, 0, 784, 880],
        [784, 0, 880, 988, 880, 0, 784, 659],
        [660, 0, 523, 440, 523, 0, 659, 784],
        [698, 0, 659, 523, 440, 0, 523, 0],
    ];
    let step = 0;

    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];

        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.1, stepDur * 3);
        if (beat === 0) {
            playNote(pad1, ch.p[0], 0.04, stepDur * 8);
            playNote(pad2, ch.p[1], 0.03, stepDur * 8);
        }
        const note = melody[bar][beat];
        if (note > 0) playNote(lead, note, 0.04, stepDur * 1.2);

        step++;
    }, stepDur * 1000);

    current = { name: 'results', interval, oscs };
}

export function play(trackName) {
    init();
    if (current && current.name === trackName) return;
    stopCurrent();
    if (!getCtx()) return;
    if (trackName === 'menu') startMenu();
    else if (trackName === 'race') startRace();
    else if (trackName === 'results') startResults();
}

export function stop() {
    stopCurrent();
}

// Load saved volume
try {
    const saved = localStorage.getItem('bonkMusicVol');
    if (saved !== null) volume = parseFloat(saved) || 0.35;
} catch {}
