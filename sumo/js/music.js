// Procedural background music for Sumo Smash.

import { getCtx, getMaster } from './audio.js?v=5';

let musicGain = null;
let current = null;
let volume = 0.3;

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('sumoMusicVol', v.toFixed(2)); } catch {}
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

function voice(type, freq, vol, filterFreq = 2000) {
    const ctx = getCtx();
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq; filter.Q.value = 1;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(musicGain); osc.start();
    return { osc, gain, filter };
}

function playNote(v, freq, vol, dur) {
    const ctx = getCtx(); const t = ctx.currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(vol, t);
    v.gain.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.1);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.05, 0.08);
}

// Menu: chill pentatonic (E G A B D), 90 BPM
function startMenu() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 90 / 2;
    // E pentatonic: E2=82.4, G2=98, A2=110, B2=123.5, D3=146.8
    const bass = voice('sawtooth', 82.4, 0, 350);
    const pad1 = voice('triangle', 164.8, 0, 700);
    const pad2 = voice('triangle', 196, 0, 700);
    const arp = voice('triangle', 330, 0, 1000);
    const oscs = [bass, pad1, pad2, arp];
    // Pentatonic scale notes: E G A B D across octaves
    const bassNotes = [82.4, 98, 110, 123.5];
    const padChords = [
        { p1: 164.8, p2: 246.9 }, // E + B
        { p1: 196, p2: 293.7 },   // G + D
        { p1: 220, p2: 330 },     // A + E
        { p1: 246.9, p2: 392 },   // B + G
    ];
    const arpNotes = [330, 392, 440, 494, 587, 494, 440, 392];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = padChords[bar];
        if (beat === 0 || beat === 4) playNote(bass, bassNotes[bar], 0.09, stepDur * 3);
        if (beat === 0) { playNote(pad1, ch.p1, 0.03, stepDur * 8); playNote(pad2, ch.p2, 0.02, stepDur * 8); }
        playNote(arp, arpNotes[beat], 0.02, stepDur * 0.8);
        step++;
    }, stepDur * 1000);
    current = { name: 'menu', interval, oscs };
}

// Game: energetic, fast pentatonic, 150 BPM with kick/hihat
function startGame() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 150 / 4;
    const bass = voice('sawtooth', 82.4, 0, 500);
    const lead = voice('triangle', 330, 0, 1500);
    const kick = voice('sine', 60, 0, 200);
    const hihat = voice('sawtooth', 8000, 0, 12000);
    const oscs = [bass, lead, kick, hihat];
    // Pentatonic: E=330, G=392, A=440, B=494, D=587
    const bassNotes = [82.4, 98, 110, 98];
    const melody = [
        [330, 0, 392, 0, 440, 0, 494, 0, 587, 0, 494, 0, 440, 0, 392, 0],
        [440, 0, 587, 0, 494, 0, 440, 0, 392, 0, 330, 0, 392, 0, 440, 0],
        [494, 0, 440, 0, 392, 0, 330, 0, 392, 0, 440, 0, 494, 0, 587, 0],
        [392, 0, 330, 0, 440, 0, 494, 0, 587, 0, 440, 0, 392, 0, 330, 0],
    ];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 16) % 4;
        const beat = step % 16;
        // Kick on every quarter note
        if (beat % 4 === 0) playNote(kick, 60, 0.14, stepDur * 2);
        // Hihat on off-beats for driving rhythm
        if (beat % 2 === 1) playNote(hihat, 8000 + Math.random() * 2000, 0.014, stepDur * 0.5);
        // Bass on 1 and 9
        if (beat === 0 || beat === 8) playNote(bass, bassNotes[bar], 0.1, stepDur * 6);
        const note = melody[bar][beat];
        if (note > 0) playNote(lead, note, 0.035, stepDur * 1.5);
        step++;
    }, stepDur * 1000);
    current = { name: 'game', interval, oscs };
}

// Results: triumphant, major key, 110 BPM
function startResults() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 110 / 2;
    // C major triumphal: C E G, F A C, G B D, C E G
    const bass = voice('sawtooth', 130.8, 0, 450);
    const pad1 = voice('triangle', 262, 0, 900);
    const pad2 = voice('triangle', 330, 0, 900);
    const lead = voice('triangle', 523, 0, 1400);
    const oscs = [bass, pad1, pad2, lead];
    const chords = [
        { b: 130.8, p1: 262, p2: 330 },  // C major
        { b: 174.6, p1: 349, p2: 440 },  // F major
        { b: 196, p1: 392, p2: 494 },    // G major
        { b: 130.8, p1: 262, p2: 392 },  // C (with 5th)
    ];
    const melodyNotes = [523, 659, 784, 880, 784, 659, 784, 1047];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.1, stepDur * 3.5);
        if (beat === 0) {
            playNote(pad1, ch.p1, 0.035, stepDur * 8);
            playNote(pad2, ch.p2, 0.025, stepDur * 8);
        }
        playNote(lead, melodyNotes[beat] * (bar === 3 ? 1.0 : (bar === 1 ? 1.335 : 1.0)), 0.025, stepDur * 0.9);
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
    else if (trackName === 'game') startGame();
    else if (trackName === 'results') startResults();
}

export function stop() { stopCurrent(); }

try { const saved = localStorage.getItem('sumoMusicVol'); if (saved !== null) volume = parseFloat(saved) || 0.3; } catch {}
