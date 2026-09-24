// Procedural background music for Eyes & Legs. Quiet and a little mysterious, so the pings stay easy to hear.

import { getCtx, getMaster } from './audio.js?v=1';

let musicGain = null;
let current = null;
let volume = 0.3;

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('eyesMusicVol', v.toFixed(2)); } catch (e) { /* storage unavailable */ }
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
        try { o.gain.gain.setTargetAtTime(0, getCtx().currentTime, 0.1); } catch (e) { /* ignore */ }
        setTimeout(() => { try { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); } catch (e) { /* ignore */ } }, 300);
    }
    current = null;
}

function voice(type, freq, filterFreq = 2000) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(musicGain);
    osc.start();
    return { osc, gain, filter };
}

function playNote(v, freq, vol, dur) {
    const t = getCtx().currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(vol, t);
    v.gain.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.12);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.05, 0.1);
}

function loop(name, bpmStep, oscs, fn) {
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        fn(step++);
    }, bpmStep * 1000);
    current = { name, interval, oscs };
}

// Menu: slow minor arpeggio in D minor, like a music box in a dark room
function startMenu() {
    const stepDur = 60 / 84 / 2;
    const bass = voice('triangle', 73.4, 400);
    const pad = voice('sine', 293.7, 900);
    const arp = voice('triangle', 587, 1400);
    const bassNotes = [73.4, 58.3, 87.3, 65.4];            // D, Bb, F, C
    const arps = [
        [587, 698, 880, 698, 1175, 880, 698, 587],
        [466, 587, 698, 587, 932, 698, 587, 466],
        [523, 698, 880, 698, 1047, 880, 698, 523],
        [523, 659, 784, 659, 1047, 784, 659, 523],
    ];
    loop('menu', stepDur, [bass, pad, arp], step => {
        const bar = Math.floor(step / 8) % 4, beat = step % 8;
        if (beat === 0) {
            playNote(bass, bassNotes[bar], 0.1, stepDur * 8);
            playNote(pad, bassNotes[bar] * 4, 0.02, stepDur * 8);
        }
        playNote(arp, arps[bar][beat], 0.022, stepDur * 0.9);
    });
}

// In a level: a soft heartbeat pulse and sparse bell notes, tense but calm
function startGame() {
    const stepDur = 60 / 104 / 4;
    const kick = voice('sine', 55, 180);
    const bass = voice('sawtooth', 55, 260);
    const bell = voice('triangle', 880, 2200);
    const tick = voice('square', 3000, 6000);
    const bassNotes = [55, 55, 49, 58.3];                 // A, A, G, Bb
    const bells = [880, 0, 0, 659, 0, 0, 784, 0, 0, 0, 698, 0, 0, 587, 0, 0];
    loop('game', stepDur, [kick, bass, bell, tick], step => {
        const bar = Math.floor(step / 16) % 4, beat = step % 16;
        if (beat === 0 || beat === 3) playNote(kick, 55, beat === 0 ? 0.16 : 0.09, stepDur * 2);
        if (beat === 0) playNote(bass, bassNotes[bar], 0.05, stepDur * 14);
        if (beat % 4 === 2) playNote(tick, 3000, 0.004, stepDur * 0.4);
        const b = bells[(beat + bar * 5) % 16];
        if (b && bar % 2 === 0) playNote(bell, b, 0.018, stepDur * 3);
    });
}

// Results: warm major resolution
function startResults() {
    const stepDur = 60 / 100 / 2;
    const bass = voice('triangle', 130.8, 450);
    const pad = voice('triangle', 262, 900);
    const lead = voice('triangle', 523, 1600);
    const chords = [130.8, 174.6, 196, 130.8];
    const mel = [523, 659, 784, 1047, 784, 659, 784, 880];
    loop('results', stepDur, [bass, pad, lead], step => {
        const bar = Math.floor(step / 8) % 4, beat = step % 8;
        if (beat === 0 || beat === 4) playNote(bass, chords[bar], 0.09, stepDur * 3.5);
        if (beat === 0) playNote(pad, chords[bar] * 2, 0.03, stepDur * 8);
        playNote(lead, mel[beat] * (bar === 1 ? 1.335 : bar === 2 ? 1.125 : 1), 0.022, stepDur * 0.9);
    });
}

export function play(name) {
    init();
    if (current && current.name === name) return;
    stopCurrent();
    if (!getCtx()) return;
    if (name === 'menu') startMenu();
    else if (name === 'game') startGame();
    else if (name === 'results') startResults();
}

export function stop() { stopCurrent(); }

try { const saved = localStorage.getItem('eyesMusicVol'); if (saved !== null) volume = parseFloat(saved) || 0; } catch (e) { /* storage unavailable */ }
