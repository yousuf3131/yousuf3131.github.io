// Procedural background music for Drawing Duel.

import { getCtx, getMaster } from './audio.js?v=3';

let musicGain = null;
let current = null;
let volume = 0.3;

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('drawMusicVol', v.toFixed(2)); } catch {}
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

// Lobby: relaxed C-Am-Dm-G
function startLobby() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 85 / 2;
    const bass = voice('sawtooth', 130, 0, 400);
    const pad1 = voice('triangle', 262, 0, 800);
    const pad2 = voice('triangle', 330, 0, 800);
    const arp = voice('triangle', 523, 0, 1200);
    const oscs = [bass, pad1, pad2, arp];
    const chords = [
        { b: 130.8, p: [262, 392] },
        { b: 110, p: [220, 330] },
        { b: 73.4, p: [175, 294] },
        { b: 98, p: [196, 294] },
    ];
    const arpNotes = [523, 659, 784, 880, 784, 659, 523, 440];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.1, stepDur * 3);
        if (beat === 0) { playNote(pad1, ch.p[0], 0.035, stepDur * 8); playNote(pad2, ch.p[1], 0.025, stepDur * 8); }
        playNote(arp, arpNotes[beat] * (bar % 2 === 0 ? 1 : 0.84), 0.02, stepDur * 0.8);
        step++;
    }, stepDur * 1000);
    current = { name: 'lobby', interval, oscs };
}

// Game: upbeat, light percussion
function startGame() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 110 / 4;
    const bass = voice('sawtooth', 130, 0, 500);
    const lead = voice('triangle', 523, 0, 1500);
    const kick = voice('sine', 60, 0, 200);
    const hihat = voice('sawtooth', 8000, 0, 12000);
    const oscs = [bass, lead, kick, hihat];
    const bassNotes = [130.8, 110, 98, 116.5];
    const melody = [
        [523, 0, 659, 0, 784, 0, 659, 0, 523, 0, 440, 0, 523, 0, 659, 0],
        [440, 0, 523, 0, 659, 0, 523, 0, 440, 0, 392, 0, 440, 0, 523, 0],
        [392, 0, 494, 0, 587, 0, 494, 0, 392, 0, 330, 0, 392, 0, 494, 0],
        [466, 0, 523, 0, 659, 0, 523, 0, 466, 0, 392, 0, 466, 0, 523, 0],
    ];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 16) % 4;
        const beat = step % 16;
        if (beat % 4 === 0) playNote(kick, 60, 0.12, stepDur * 2);
        if (beat % 4 === 2) playNote(hihat, 8000 + Math.random() * 2000, 0.012, stepDur * 0.5);
        if (beat === 0 || beat === 8) playNote(bass, bassNotes[bar], 0.08, stepDur * 6);
        const note = melody[bar][beat];
        if (note > 0) playNote(lead, note, 0.03, stepDur * 1.5);
        step++;
    }, stepDur * 1000);
    current = { name: 'game', interval, oscs };
}

export function play(trackName) {
    init();
    if (current && current.name === trackName) return;
    stopCurrent();
    if (!getCtx()) return;
    if (trackName === 'lobby') startLobby();
    else if (trackName === 'game') startGame();
}

export function stop() { stopCurrent(); }

try { const saved = localStorage.getItem('drawMusicVol'); if (saved !== null) volume = parseFloat(saved) || 0.3; } catch {}
