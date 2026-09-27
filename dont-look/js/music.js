// Don't Look — ambient horror drone generator (Web Audio API)
import { getCtx } from './audio.js?v=2';

let musicGain = null;
let droneNodes = [];
let currentTrack = null;

export function play(track) {
    if (currentTrack === track) return;
    currentTrack = track;
    const ctx = getCtx();
    if (!ctx) return;

    stopAll();

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(ctx.destination);
    musicGain.gain.setTargetAtTime(track === 'game' ? 0.08 : 0.05, ctx.currentTime, 1.5);

    if (track === 'menu') buildMenuDrone(ctx);
    else if (track === 'game') buildGameDrone(ctx);
    else if (track === 'tense') buildTenseDrone(ctx);
}

export function stop() {
    if (!musicGain) return;
    musicGain.gain.setTargetAtTime(0, getCtx().currentTime, 0.8);
    setTimeout(stopAll, 2000);
    currentTrack = null;
}

export function setTension(level) {
    // level 0–1: fade to tense track
    if (!musicGain) return;
    const ctx = getCtx();
    if (!ctx) return;
    const target = 0.05 + level * 0.08;
    musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.5);
}

function stopAll() {
    for (const n of droneNodes) { try { n.stop(); } catch {} }
    droneNodes = [];
    if (musicGain) { try { musicGain.disconnect(); } catch {} musicGain = null; }
}

function makeDrone(ctx, freq, detune, type, vol, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.value = vol;
    osc.connect(g);
    g.connect(gain);
    osc.start();
    droneNodes.push(osc);
    return osc;
}

function buildMenuDrone(ctx) {
    // Low, ominous — relatively calm
    makeDrone(ctx, 55,   0, 'sine',     0.35, musicGain);
    makeDrone(ctx, 55,   7, 'sine',     0.20, musicGain);
    makeDrone(ctx, 110, -5, 'sine',     0.12, musicGain);
    makeDrone(ctx, 82.5, 0, 'triangle', 0.08, musicGain);

    // Slow LFO on main drone
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    lfoGain.connect(droneNodes[0].frequency);
    lfo.start();
    droneNodes.push(lfo);
}

function buildGameDrone(ctx) {
    // Deeper, more unsettling — detuned pairs + high overtone
    makeDrone(ctx, 36.7, 0,   'sawtooth', 0.10, musicGain);
    makeDrone(ctx, 36.7, 12,  'sawtooth', 0.10, musicGain);
    makeDrone(ctx, 55,   -8,  'sine',     0.18, musicGain);
    makeDrone(ctx, 55,    8,  'sine',     0.18, musicGain);
    makeDrone(ctx, 110,   0,  'sine',     0.07, musicGain);
    makeDrone(ctx, 220,  -3,  'sine',     0.04, musicGain);

    // Subtle low-pass filter to soften sawtooth
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 200;
    filt.Q.value = 0.7;
    // Rewire saws through filter (can't easily rewire, just rely on gain being low)

    // Slow wavering LFO
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.05;
    lg.gain.value = 4;
    lfo.connect(lg);
    lg.connect(droneNodes[0].frequency);
    lfo.start(); droneNodes.push(lfo);

    // Noise shimmer
    const bufLen = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = buf;
    nSrc.loop = true;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass';
    nFilt.frequency.value = 350;
    nFilt.Q.value = 4;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.025;
    nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(musicGain);
    nSrc.start(); droneNodes.push(nSrc);
}

function buildTenseDrone(ctx) {
    // Higher pitched, more dissonant
    makeDrone(ctx, 73.4, 0,  'sawtooth', 0.12, musicGain);
    makeDrone(ctx, 77.8, 0,  'sawtooth', 0.12, musicGain); // tritone dissonance
    makeDrone(ctx, 110,  0,  'sine',     0.15, musicGain);
    makeDrone(ctx, 146.8, 0, 'sine',     0.08, musicGain);

    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.15; // faster flutter
    lg.gain.value = 8;
    lfo.connect(lg);
    lg.connect(droneNodes[0].frequency);
    lfo.start(); droneNodes.push(lfo);
}
