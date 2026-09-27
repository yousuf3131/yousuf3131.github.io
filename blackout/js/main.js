// Blackout: one hunter, up to seven survivors with flashlights, in the dark.
// Host-authoritative rounds over PeerJS with an MQTT relay fallback (same room system as Deadline).
// Each player moves their own character; the host checks every move and decides shots, stuns and pickups.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HostNet, ClientNet, makeCode } from './net.js';
import { MAPS, parseMap, distanceField, downhill, lineOfSight, collide } from './maps.js';
import { buildWorld, cut } from './world.js';
import { makeSurvivor, makeHunter, animate, SURVIVOR_LOOKS } from './models.js';
import * as TX from './textures.js';
import { sfx, isMuted, setMuted, unlockAudio, setHeart, startAmbience, stopAmbience, menuAmbience } from './audio.js';

const track = (name, params) => { if (window.track) window.track(name, params); };

/* ── tuning ────────────────────────────────────────────── */
const MAX_PLAYERS = 8;
const RAD = 0.38;                              // body radius for walls
const SURV_WALK = 3.9, SURV_RUN = 6.3;
const HUNT_WALK = 4.7, HUNT_DASH = 8.8, DASH_TIME = 1.1, DASH_CD = 9;
const SCREAM_CD = 30, REVEAL_TIME = 3.5;
const STAM_DRAIN = 26, STAM_REGEN = 15;
const BATT_DRAIN = 1.45, BATT_PICK = 50, MAX_BATTERIES = 6, BATTERY_RESPAWN = 14;
const SHELLS = 2, PUMP_TIME = 0.75, RELOAD_TIME = 2.4, SHOT_RANGE = 9.5, SHOT_CONE = 0.2;
const LIGHT_RANGE = 10, LIGHT_CONE = 0.3, STUN_FILL = 1.1, STUN_TIME = 2.8, STUN_IMMUNE = 6;
const FLARE_TIME = 12, FLARE_RAD = 5, FLARE_SLOW = 0.55, FLARE_THROW = 8;
const CORN_SLOW = 0.75;
const INTRO_TIME = 5, RELEASE_TIME = 10, END_TIME = 7;
const SEND_EVERY = 0.05;
const SPOT_POWER = 170;
const COLORS = ['#ffcf8a', '#7fc8ff', '#9be08a', '#f59ad0', '#c6a2ff', '#ff9f5a', '#8ae0d8', '#e8e0a0'];
const BOT_NAMES = ['Laurie', 'Sidney', 'Nancy', 'Ash', 'Ginny', 'Tommy', 'Chris', 'Marty'];
const roundTime = nSurv => Math.min(180, 75 + nSurv * 18);

const $ = id => document.getElementById(id);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

let quality = (() => { try { return localStorage.getItem('blackoutQuality') || (isTouch ? 'low' : 'high'); } catch (e) { return 'high'; } })();

/* ── renderer, scene, post ─────────────────────────────── */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040405);
scene.fog = new THREE.Fog(0x070a10, 20, 50);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 220);
camera.position.set(0, 20, 12);
const CAM_OFF = new THREE.Vector3(0, 14.5, 8.6);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Film look: grain, vignette, a touch of chromatic aberration, tint, and full-screen flashes / fades
const film = new ShaderPass({
    uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.055 }, uVig: { value: 0.85 }, uAberr: { value: 0.006 },
        uSat: { value: 0.82 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) }, uFade: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uAberr, uSat, uFlash, uFade; uniform vec3 uTint, uFlashColor;
        varying vec2 vUv;
        void main() {
            vec2 c = vUv - 0.5; float d = length(c);
            vec2 off = c * uAberr * d * 2.0;
            vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l), col, uSat) * uTint;
            col *= 1.0 - smoothstep(0.3, 0.85, d) * uVig;
            float n = fract(sin(dot(vUv * (1.0 + fract(uTime * 0.37)), vec2(12.9898, 78.233))) * 43758.5453);
            col += (n - 0.5) * uGrain;
            col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
            col *= 1.0 - uFade;
            gl_FragColor = vec4(col, 1.0);
        }`,
});
composer.addPass(film);

function applyQuality() {
    const pr = quality === 'high' ? Math.min(devicePixelRatio, 1.75) : Math.min(devicePixelRatio, 1) * 0.9;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    onResize();
    moon.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
    if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
    spots.forEach((s, i) => {
        s.castShadow = quality === 'high' || i === 0;
        if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    });
    for (const id of ['btn-quality', 'btn-quality2']) $(id).textContent = `Graphics: ${quality === 'high' ? 'High' : 'Low'}`;
}
function onResize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

/* ── lights (fixed pools, so shaders never recompile mid-game) ── */
const hemi = new THREE.HemisphereLight(0x1a2440, 0x080604, 0.5);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.5);
moon.castShadow = true;
Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.03;
scene.add(moon, moon.target);
const spots = [];
for (let i = 0; i < 7; i++) {
    const s = new THREE.SpotLight(0xfff0d8, 0, 26, 0.46, 0.55, 1.5);
    s.shadow.mapSize.setScalar(512);
    s.shadow.camera.near = 0.3; s.shadow.camera.far = 26;
    s.shadow.bias = -0.0008; s.shadow.normalBias = 0.03;
    scene.add(s, s.target);
    spots.push(s);
}
const lampLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(0xffc48a, 0, 16, 1.7); scene.add(l); return l; });
const flareLights = Array.from({ length: 3 }, () => { const l = new THREE.PointLight(0xff3a24, 0, 15, 1.6); scene.add(l); return l; });
const muzzleLight = new THREE.PointLight(0xffc070, 0, 20, 1.4); scene.add(muzzleLight);
const selfLight = new THREE.PointLight(0xffe2c4, 0, 5, 2); scene.add(selfLight);
applyQuality();

/* ── shared effect resources ───────────────────────────── */
const GLOW = TX.glowTexture(), BLOOD = [TX.bloodTexture(3), TX.bloodTexture(8), TX.bloodTexture(15)], SHADOW = TX.shadowTexture();
const beamGeo = new THREE.ConeGeometry(2.3, 9, 28, 1, true).translate(0, -4.5, 0).rotateX(-Math.PI / 2);
const BEAM_VS = `varying float vLen; varying vec3 vN; varying vec3 vV;
    void main() { vLen = position.z / 9.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const BEAM_FS = `uniform float uI; uniform vec3 uColor; varying float vLen; varying vec3 vN; varying vec3 vV;
    void main() { float edge = pow(abs(dot(vN, vV)), 1.6); float fall = pow(1.0 - clamp(vLen, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.08, vLen);
        gl_FragColor = vec4(uColor * uI * edge * fall * 0.13, 1.0); }`;
const makeBeam = () => {
    const m = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ uniforms: { uI: { value: 1 }, uColor: { value: new THREE.Color(1, 0.93, 0.82) } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.order = 'YXZ'; m.frustumCulled = false; m.renderOrder = 8;
    return m;
};

/* ── state ─────────────────────────────────────────────── */
let myName = '', role = '', myId = '', roomCode = '', view = 'menu', net = null, solo = false, paused = false;
const players = new Map();                     // everyone in the current game
let me = null, map = null, world = null, mapId = null;
const G = { phase: 'idle', round: 0, rounds: 0, hunterId: null, timeLeft: 0, release: 0, dawn: 0, revealUntil: 0, specId: null, winner: null };
let T = 0;                                     // seconds since load
const H = {                                    // host only
    players: [], settings: { map: 'random', rounds: '3' }, phase: 'lobby', order: [], round: 0, rounds: 3, lastMap: null,
    batteries: [], flares: [], batUid: 0, flareUid: 0, batTimers: [], timeLeft: 0, release: 0, introT: 0, stunMeter: 0, lastShot: null, sendT: 0, endT: 0,
};
const fields = new Map();                      // cached distance fields for bots, by goal tile

/* ── screens ───────────────────────────────────────────── */
const SCREENS = ['menu', 'lobby', 'hud', 'results', 'round-end', 'intro'];
function show(id) {
    for (const s of SCREENS) $(s).classList.add('hidden');
    if (id === 'game') $('hud').classList.remove('hidden');
    else $(id).classList.remove('hidden');
    view = id;
    document.body.classList.toggle('playing', id === 'game');
    $('btn-menu').textContent = id === 'menu' ? 'Exit' : 'Menu';
    if (id !== 'game') { $('labels').innerHTML = ''; labelEls.clear(); }
}
function toast(msg, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls; d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 4200);
}
let centerTimer = null;
function centerMsg(txt, sub = '', dur = 2) {
    const el = $('center-msg');
    el.textContent = txt; $('center-sub').textContent = sub;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    clearTimeout(centerTimer);
    if (dur > 0) centerTimer = setTimeout(() => { el.textContent = ''; $('center-sub').textContent = ''; }, dur * 1000);
}
function setMenuStatus(text, isError) { $('menu-status').textContent = text || ''; $('menu-status').className = isError ? 'status error' : 'status'; }

/* ── networking glue ───────────────────────────────────── */
function act(msg) { if (role === 'client') { if (net) net.send(msg); } else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }
const lobbyList = () => H.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, bot: p.bot, idx: p.idx }));
const emitLobby = () => emit({ t: 'lobby', players: lobbyList(), settings: H.settings });
const freeIdx = () => { for (let i = 0; i < MAX_PLAYERS; i++) if (!H.players.some(p => p.idx === i)) return i; return 0; };

function hostHandle(from, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const p = players.get(from);
    switch (msg.t) {
        case 'hello': {
            if (H.players.some(q => q.id === from)) return;
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'A game is in progress in that room. Try again when it ends.' }); return; }
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: `That room is full (${MAX_PLAYERS} players max).` }); return; }
            H.players.push({ id: from, name: String(msg.name || 'Player').slice(0, 14), ready: from === myId, bot: false, idx: freeIdx() });
            if (net && from !== myId) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            if (from !== myId) { toast(`${msg.name} joined`); sfx.ping(); }
            break;
        }
        case 'ready': { const q = H.players.find(q => q.id === from); if (q) { q.ready = !!msg.r; emitLobby(); } break; }
        case 'kick': {
            if (from !== myId) return;
            const q = H.players.find(q => q.id === msg.id);
            if (!q) return;
            if (!q.bot && net) { net.send(q.id, { t: 'reject', reason: 'The host removed you from the room.' }); setTimeout(() => net && net.kick(q.id), 600); }
            H.players = H.players.filter(x => x.id !== msg.id);
            emitLobby();
            break;
        }
        case 'st': if (p) hostApplyState(p, msg); break;
        case 'fire': if (p) hostFire(p, +msg.x, +msg.z, +msg.a); break;
        case 'reload': if (p && p.role === 'hunter' && p.shells < SHELLS && p.reloadT <= 0) p.reloadT = RELOAD_TIME; break;
        case 'dash': if (p) hostDash(p); break;
        case 'scream': if (p) hostScream(p); break;
        case 'flare': if (p) hostFlare(p, +msg.a); break;
    }
}

function clientHandle(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; enterJoinedLobby(); break;
        case 'reject': backToMenu(); setMenuStatus(msg.reason, true); break;
        case 'lobby': if (role === 'client') enterJoinedLobby(); renderLobby(msg.players, msg.settings); break;
        case 'gameStart': startGame(msg); break;
        case 'round': roundStart(msg); break;
        case 'hunt': onHunt(); break;
        case 'release': onRelease(); break;
        case 's': if (role !== 'host') applySnapshot(msg); break;
        case 'shot': onShot(msg); break;
        case 'died': onDied(msg); break;
        case 'stun': onStun(msg); break;
        case 'dash': { const p = players.get(msg.id); if (p && p.id !== myId) { p.dashT = DASH_TIME; playAt(p, (v, pan) => sfx.dash(v * 0.6, pan)); } break; }
        case 'scream': onScream(msg); break;
        case 'flare': onFlare(msg); break;
        case 'bat': addBattery(msg); break;
        case 'batTake': onBatTake(msg); break;
        case 'left': onLeft(msg); break;
        case 'end': onRoundEnd(msg); break;
        case 'results': showResults(msg.list); break;
        case 'toLobby': backToLobby(msg); break;
    }
}

/* ── lobby ─────────────────────────────────────────────── */
function fillMapSelect() {
    const sel = $('set-map');
    sel.innerHTML = '<option value="random">Random every round</option>' + MAPS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}
fillMapSelect();

function renderLobby(list, settings) {
    $('count').textContent = `${list.length}/${MAX_PLAYERS}`;
    const ul = $('players');
    ul.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        let badges = '';
        if (p.id === myId) badges += '<span class="badge ok">You</span>';
        else if (p.bot) badges += '<span class="badge">Bot</span>';
        else if (p.ready || p.id === 'host') badges += '<span class="badge ok">Ready</span>';
        else badges += '<span class="badge">Not ready</span>';
        const kick = role === 'host' && p.id !== myId ? `<button class="kick" data-id="${esc(p.id)}" type="button">Remove</button>` : '';
        li.innerHTML = `<span class="dot" style="background:${COLORS[p.idx % COLORS.length]}"></span><div class="who"><b>${esc(p.name)}</b></div>${badges}${kick}`;
        ul.appendChild(li);
    }
    ul.querySelectorAll('.kick').forEach(b => b.onclick = () => { sfx.click(); act({ t: 'kick', id: b.dataset.id }); });
    if (settings) {
        $('set-map').value = settings.map; $('set-rounds').value = settings.rounds;
        const m = MAPS.find(x => x.id === settings.map);
        $('map-card').innerHTML = m ? `<b>${esc(m.name)}</b><p>${esc(m.blurb)}</p>` : '<b>Random map</b><p>A different place every round: camp, farm, asylum or scrapyard.</p>';
    }
    $('set-map').disabled = $('set-rounds').disabled = role !== 'host';
    const humansReady = list.filter(p => p.id !== myId && !p.bot).every(p => p.ready);
    $('btn-start').disabled = list.length < 2 || !humansReady;
    $('lobby-status').textContent = list.length < 2 ? 'You need at least 2 players. Add a bot or invite a friend.' : !humansReady ? 'Waiting for everyone to ready up...' : '';
    $('btn-bot').disabled = list.length >= MAX_PLAYERS;
    $('btn-unbot').disabled = !list.some(p => p.bot);
}
$('set-map').onchange = () => { if (role !== 'host') return; H.settings.map = $('set-map').value; emitLobby(); };
$('set-rounds').onchange = () => { if (role !== 'host') return; H.settings.rounds = $('set-rounds').value; emitLobby(); };

/* ── game start ────────────────────────────────────────── */
function startGame(msg) {
    clearMenuScene();
    players.clear();
    for (const q of msg.players) {
        players.set(q.id, {
            id: q.id, name: q.name, bot: q.bot, idx: q.idx, color: COLORS[q.idx % COLORS.length], look: SURVIVOR_LOOKS[q.idx % SURVIVOR_LOOKS.length],
            score: 0, gain: 0, kills: 0, stuns: 0, role: 'survivor', alive: true,
            x: 0, z: 0, a: 0, rx: 0, rz: 0, ra: 0, speed: 0, light: false, sprint: false, dashT: 0, stunT: 0, immuneT: 0,
            battery: 100, stamina: 100, flares: 1, shells: SHELLS, pumpT: 0, reloadT: 0, dashCd: 0, screamCd: 0,
            model: null, beam: null, slot: -1, stepAcc: 0, marker: null, shadow: null, b: null,
        });
    }
    me = players.get(myId) || null;
    G.rounds = msg.rounds;
    show('game');
    if (role === 'host') { H.round = 0; hostNextRound(); }
}

/* ── host: rounds ──────────────────────────────────────── */
function hostStart() {
    H.phase = 'game';
    // Hunting order: a bot goes first when there is one (so round 1 teaches everyone the survivor side),
    // then every human, then the remaining bots
    const humans = H.players.filter(p => !p.bot).map(p => p.id).sort(() => Math.random() - 0.5);
    const bots = H.players.filter(p => p.bot).map(p => p.id).sort(() => Math.random() - 0.5);
    H.order = bots.slice(0, 1).concat(humans, bots.slice(1));
    H.rounds = H.settings.rounds === 'all' ? H.players.length : +H.settings.rounds;
    track(solo ? 'play_solo' : 'match_start', { players: H.players.length });
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, idx: p.idx })), rounds: H.rounds });
}

function hostNextRound() {
    H.round++;
    const live = H.order.filter(id => players.has(id));
    if (H.round > H.rounds || players.size < 2 || !live.length) return hostFinish();
    const hunterId = live[(H.round - 1) % live.length];
    let def;
    if (H.settings.map === 'random') {
        const pool = MAPS.filter(m => m.id !== H.lastMap);
        def = pool[Math.floor(Math.random() * pool.length)];
    } else def = MAPS.find(m => m.id === H.settings.map) || MAPS[0];
    H.lastMap = def.id;
    const m = parseMap(def);
    // Survivors spread over the survivor spawns; the hunter starts at their own spot
    const starts = m.spawnS.slice().sort(() => Math.random() - 0.5);
    const spawns = [];
    let k = 0;
    for (const p of players.values()) {
        let x, z, a;
        if (p.id === hunterId) { const h = m.spawnH[0]; x = m.cx(h.c); z = m.cz(h.r); a = Math.random() * 6.28; }
        else {
            const s = starts[k % starts.length], ring = Math.floor(k / starts.length);
            const ang = k * 2.4;
            x = m.cx(s.c) + (ring ? Math.cos(ang) * 1.1 : 0); z = m.cz(s.r) + (ring ? Math.sin(ang) * 1.1 : 0);
            ({ x, z } = collide(m, x, z, RAD));
            a = Math.random() * 6.28; k++;
        }
        spawns.push({ id: p.id, x: +x.toFixed(2), z: +z.toFixed(2), a: +a.toFixed(2) });
    }
    const nSurv = players.size - 1;
    H.timeLeft = roundTime(nSurv); H.release = RELEASE_TIME; H.introT = INTRO_TIME; H.phase = 'intro';
    H.stunMeter = 0; H.flares = []; H.batteries = []; H.batTimers = []; H.lastShot = null; H.sendT = 0;
    map = m; fields.clear();
    const bats = [];
    for (let i = 0; i < MAX_BATTERIES; i++) { const b = hostBatterySpot(spawns); if (b) { H.batteries.push(b); bats.push(b); } }
    emit({ t: 'round', round: H.round, rounds: H.rounds, map: def.id, hunter: hunterId, spawns, time: H.timeLeft, bats });
}

function hostBatterySpot(avoid) {
    for (let tries = 0; tries < 40; tries++) {
        const t = map.open[Math.floor(Math.random() * map.open.length)];
        const ch = map.at(t.c, t.r);
        if (ch === 'c') continue;
        const x = map.cx(t.c) + (Math.random() - 0.5), z = map.cz(t.r) + (Math.random() - 0.5);
        if (avoid.some(s => Math.hypot(s.x - x, s.z - z) < 7)) continue;
        if (H.batteries.some(b => Math.hypot(b.x - x, b.z - z) < 8)) continue;
        return { uid: ++H.batUid, x: +x.toFixed(2), z: +z.toFixed(2) };
    }
    return null;
}

function hostEndRound(winner, reason = '') {
    if (H.phase !== 'hunt' && H.phase !== 'intro') return;
    H.phase = 'end'; H.endT = END_TIME;
    const hunter = players.get(G.hunterId);
    const survivors = [...players.values()].filter(p => p.role === 'survivor');
    const alive = survivors.filter(p => p.alive);
    for (const p of alive) p.gain += 100;
    if (hunter && winner === 'hunter') hunter.gain += 150 + Math.round(Math.max(0, H.timeLeft));
    for (const p of players.values()) { p.gain = Math.round(p.gain); p.score += p.gain; }
    const list = [...players.values()].sort((a, b) => b.gain - a.gain).map(p => ({ id: p.id, name: p.name, idx: p.idx, role: p.role, alive: p.alive, gain: p.gain, score: p.score, kills: p.kills, stuns: p.stuns }));
    emit({ t: 'end', winner, reason, list, total: survivors.length, alive: alive.length, round: H.round, rounds: H.rounds, last: H.round >= H.rounds });
}

function hostFinish() {
    H.phase = 'results';
    const list = [...players.values()].sort((a, b) => b.score - a.score).map((p, i) => ({ place: i + 1, id: p.id, name: p.name, idx: p.idx, score: p.score }));
    track('match_end', { players: players.size, rounds: H.rounds });
    emit({ t: 'results', list });
}

/* ── host: simulation ──────────────────────────────────── */
function hostApplyState(p, msg) {
    if (!p.alive || (H.phase !== 'hunt' && H.phase !== 'intro')) return;
    let x = +msg.x, z = +msg.z;
    if (!isFinite(x) || !isFinite(z)) return;
    const now = T, dtm = clamp(now - (p.lastSt || now - SEND_EVERY), 0.016, 0.5);
    p.lastSt = now;
    if (isFinite(+msg.a)) p.a = +msg.a;
    p.sprint = !!msg.sp && p.role === 'survivor';
    const wantLight = !!msg.l && p.role === 'survivor' && p.battery > 0;
    p.light = wantLight;
    const frozen = H.phase === 'intro' || (p.role === 'hunter' && (H.release > 0 || p.stunT > 0));
    if (frozen) { if (Math.hypot(x - p.x, z - p.z) > 0.5) p.force = true; return; }
    const max = p.role === 'hunter' ? (p.dashT > 0 ? HUNT_DASH : HUNT_WALK) : SURV_RUN;
    const lim = max * dtm * 1.35 + 0.4;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > lim) { x = p.x + dx / d * lim; z = p.z + dz / d * lim; if (d > lim + 1.2) p.force = true; }
    ({ x, z } = collide(map, x, z, RAD));
    p.x = x; p.z = z;
}

function hostFire(p, x, z, a) {
    if (p.role !== 'hunter' || !p.alive || H.phase !== 'hunt' || H.release > 0 || p.stunT > 0) return;
    if (p.pumpT > 0.15) return;
    if (p.shells <= 0) { if (p.reloadT < 0.4) { p.shells = SHELLS; p.reloadT = 0; } else return; }
    if (!isFinite(a)) return;
    if (!isFinite(x) || !isFinite(z) || Math.hypot(x - p.x, z - p.z) > 1.5) { x = p.x; z = p.z; }
    p.shells--; p.pumpT = PUMP_TIME;
    if (p.shells <= 0) p.reloadT = RELOAD_TIME;
    const hits = [];
    for (const s of players.values()) {
        if (s.role !== 'survivor' || !s.alive) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d > SHOT_RANGE) continue;
        const allow = SHOT_CONE + Math.atan(0.55 / Math.max(d, 0.5));
        if (angDiff(a, Math.atan2(s.x - x, s.z - z)) > allow) continue;
        if (!lineOfSight(map, x, z, s.x, s.z)) continue;
        hits.push(s.id);
    }
    H.lastShot = { x, z, t: T };
    emit({ t: 'shot', id: p.id, x: +x.toFixed(2), z: +z.toFixed(2), a: +a.toFixed(3), hits });
    for (const id of hits) hostKill(players.get(id), p);
}

function hostKill(s, by) {
    if (!s || !s.alive) return;
    s.alive = false; s.light = false;
    if (by) { by.gain += 100; by.kills++; }
    emit({ t: 'died', id: s.id, by: by ? by.id : null, x: +s.x.toFixed(2), z: +s.z.toFixed(2) });
}

function hostDash(p) {
    if (p.role !== 'hunter' || !p.alive || H.phase !== 'hunt' || H.release > 0 || p.stunT > 0 || p.dashCd > 0.3) return;
    p.dashT = DASH_TIME; p.dashCd = DASH_CD;
    emit({ t: 'dash', id: p.id });
}

function hostScream(p) {
    if (p.role !== 'hunter' || !p.alive || H.phase !== 'hunt' || H.release > 0 || p.screamCd > 0.3) return;
    p.screamCd = SCREAM_CD;
    H.lastScream = { x: p.x, z: p.z, t: T };
    emit({ t: 'scream', id: p.id });
}

function hostFlare(p, a) {
    if (p.role !== 'survivor' || !p.alive || H.phase !== 'hunt' || p.flares <= 0 || !isFinite(a)) return;
    p.flares--;
    // Fly forward until a wall is in the way
    let x = p.x, z = p.z;
    const sx = Math.sin(a), sz = Math.cos(a);
    for (let d = 0.5; d <= FLARE_THROW; d += 0.25) {
        const nx = p.x + sx * d, nz = p.z + sz * d;
        if (map.solid(map.col(nx), map.row(nz))) break;
        x = nx; z = nz;
    }
    const f = { uid: ++H.flareUid, x: +x.toFixed(2), z: +z.toFixed(2), until: T + FLARE_TIME + 0.5 };
    H.flares.push(f);
    emit({ t: 'flare', uid: f.uid, id: p.id, x0: +p.x.toFixed(2), z0: +p.z.toFixed(2), x: f.x, z: f.z });
}

function hostTick(dt) {
    if (H.phase === 'intro') {
        H.introT -= dt;
        if (H.introT <= 0) { H.phase = 'hunt'; emit({ t: 'hunt' }); }
    } else if (H.phase === 'hunt') {
        if (H.release > 0) { H.release -= dt; if (H.release <= 0) { H.release = 0; emit({ t: 'release' }); } }
        else H.timeLeft -= dt;
        const hunter = players.get(G.hunterId);
        for (const p of players.values()) {
            p.dashT = Math.max(0, p.dashT - dt); p.dashCd = Math.max(0, p.dashCd - dt); p.screamCd = Math.max(0, p.screamCd - dt);
            p.stunT = Math.max(0, p.stunT - dt); p.immuneT = Math.max(0, p.immuneT - dt); p.pumpT = Math.max(0, p.pumpT - dt);
            if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) { p.reloadT = 0; p.shells = SHELLS; } }
            if (p.bot && p.alive) botTick(p, dt, hunter);
            if (p.role === 'survivor' && p.alive) {
                if (p.light) { p.battery = Math.max(0, p.battery - BATT_DRAIN * dt); if (p.battery <= 0) p.light = false; }
                if (H.release <= 0) p.gain += dt;
            }
        }
        hostStun(dt, hunter);
        hostPickups(dt);
        H.flares = H.flares.filter(f => f.until > T);
        const alive = [...players.values()].filter(p => p.role === 'survivor' && p.alive).length;
        if (!hunter) hostEndRound('survivors', 'The hunter left the game.');
        else if (alive === 0) hostEndRound('hunter');
        else if (H.timeLeft <= 0) hostEndRound('survivors');
    } else if (H.phase === 'end') {
        H.endT -= dt;
        if (H.endT <= 0) { H.phase = 'between'; hostNextRound(); }
    }
    if (H.phase === 'intro' || H.phase === 'hunt') {
        H.sendT -= dt;
        if (H.sendT <= 0) { H.sendT = SEND_EVERY; hostSnapshot(); }
    }
}

function hostSnapshot() {
    const p = [];
    for (const q of players.values()) {
        const flags = (q.alive ? 1 : 0) | (q.light ? 2 : 0) | (q.sprint ? 4 : 0) | (q.stunT > 0 ? 8 : 0) | (q.dashT > 0 ? 16 : 0) | (q.force ? 32 : 0);
        q.force = false;
        p.push([q.id, +q.x.toFixed(2), +q.z.toFixed(2), +q.a.toFixed(2), flags, Math.round(q.battery)]);
    }
    emit({ t: 's', tl: +Math.max(0, H.timeLeft).toFixed(1), rl: +H.release.toFixed(1), p });
    G.timeLeft = Math.max(0, H.timeLeft); G.release = H.release;
}

// Blinding: survivors aiming their light into the hunter's face fill a meter; full meter stuns
function hostStun(dt, hn) {
    if (!hn || !hn.alive || H.release > 0) return;
    if (hn.stunT > 0 || hn.immuneT > 0) { H.stunMeter = 0; return; }
    let rate = 0;
    const by = [];
    for (const s of players.values()) {
        if (s.role !== 'survivor' || !s.alive || !s.light) continue;
        if (!lightHits(s, hn)) continue;
        const d = Math.hypot(hn.x - s.x, hn.z - s.z);
        rate += (d < 5 ? 1.35 : 1) / STUN_FILL;
        by.push(s);
    }
    if (rate > 0) H.stunMeter += rate * dt;
    else H.stunMeter = Math.max(0, H.stunMeter - 0.5 * dt);
    if (H.stunMeter >= 1) {
        H.stunMeter = 0;
        hn.stunT = STUN_TIME; hn.immuneT = STUN_TIME + STUN_IMMUNE; hn.dashT = 0;
        for (const s of by) { s.gain += 50 / by.length + 10; s.stuns++; }
        emit({ t: 'stun', id: hn.id, by: by.map(s => s.id), dur: STUN_TIME });
    }
}

// Is survivor s shining their light into hunter h's eyes?
function lightHits(s, h) {
    const dx = h.x - s.x, dz = h.z - s.z, d = Math.hypot(dx, dz);
    if (d > LIGHT_RANGE || d < 0.2) return false;
    if (angDiff(s.a, Math.atan2(dx, dz)) > LIGHT_CONE + Math.atan(0.4 / d)) return false;
    if (angDiff(h.a, Math.atan2(-dx, -dz)) > 1.3) return false;
    return lineOfSight(map, s.x, s.z, h.x, h.z);
}

function hostPickups(dt) {
    for (const b of H.batteries.slice()) {
        for (const p of players.values()) {
            if (p.role !== 'survivor' || !p.alive || p.battery > 92) continue;
            if (Math.hypot(p.x - b.x, p.z - b.z) > 1.15) continue;
            p.battery = Math.min(100, p.battery + BATT_PICK);
            H.batteries = H.batteries.filter(x => x !== b);
            H.batTimers.push(BATTERY_RESPAWN);
            emit({ t: 'batTake', uid: b.uid, id: p.id, batt: Math.round(p.battery) });
            break;
        }
    }
    H.batTimers = H.batTimers.map(t => t - dt);
    while (H.batTimers.length && H.batTimers[0] <= 0) {
        H.batTimers.shift();
        const avoid = [...players.values()].filter(p => p.alive).map(p => ({ x: p.x, z: p.z }));
        const b = hostBatterySpot(avoid);
        if (b) { H.batteries.push(b); emit({ t: 'bat', ...b }); }
    }
}

/* ── bots (run on the host) ────────────────────────────── */
function fieldTo(c, r) {
    const key = r * 1000 + c;
    let f = fields.get(key);
    if (!f) {
        f = distanceField(map, [{ c, r }]);
        fields.set(key, f);
        if (fields.size > 60) fields.delete(fields.keys().next().value);
    }
    return f;
}

// Walk toward (gx, gz) along the tile grid. Returns true while still travelling.
function botWalk(p, dt, gx, gz, speed) {
    const c = map.col(p.x), r = map.row(p.z), gc = map.col(gx), gr = map.row(gz);
    let tx = gx, tz = gz;
    if (c !== gc || r !== gr) {
        const f = fieldTo(gc, gr);
        const n = downhill(map, f, c, r);
        if (n) {
            tx = map.cx(n.c); tz = map.cz(n.r);
            // Cut corners when the tile after next is in plain view
            const n2 = downhill(map, f, n.c, n.r);
            if (n2 && lineOfSight(map, p.x, p.z, map.cx(n2.c), map.cz(n2.r)) && clearPath(p.x, p.z, map.cx(n2.c), map.cz(n2.r))) { tx = map.cx(n2.c); tz = map.cz(n2.r); }
        }
    }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.15 && c === gc && r === gr) return false;
    if (map.charAt(p.x, p.z) === 'c') speed *= CORN_SLOW;
    if (p.role === 'hunter' && inFlare(p.x, p.z)) speed *= FLARE_SLOW;
    const step = Math.min(d, speed * dt);
    const pos = collide(map, p.x + dx / d * step, p.z + dz / d * step, RAD);
    p.x = pos.x; p.z = pos.z;
    p.moveA = Math.atan2(dx, dz);
    return true;
}
function clearPath(x1, z1, x2, z2) {
    const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.4);
    for (let i = 1; i <= n; i++) {
        const t = i / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        for (const [ox, oz] of [[RAD, 0], [-RAD, 0], [0, RAD], [0, -RAD]]) if (map.solid(map.col(x + ox), map.row(z + oz))) return false;
    }
    return true;
}
const inFlare = (x, z) => H.flares.some(f => f.until - 0.5 > T && Math.hypot(f.x - x, f.z - z) < FLARE_RAD);
const randomTile = (pred = () => true) => { for (let i = 0; i < 60; i++) { const t = map.open[Math.floor(Math.random() * map.open.length)]; if (pred(t)) return t; } return map.open[0]; };
const coverAt = t => { let n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!map.seeThrough(t.c + dc, t.r + dr)) n++; return n; };

function botTick(p, dt, hunter) {
    if (!p.b) p.b = { think: 0, goal: null, mode: 'roam', brave: Math.random() < 0.45, lightPref: Math.random(), seenAt: -99, hx: 0, hz: 0, idle: 0, react: 0, target: null, lostAt: T, known: null };
    const b = p.b;
    b.think -= dt;
    if (p.role === 'survivor') survivorBot(p, dt, hunter, b);
    else hunterBot(p, dt, b);
    // Face where we're going unless the brain chose a facing
    if (b.face !== undefined) { p.a = lerpAngle(p.a, b.face, 1 - Math.exp(-10 * dt)); b.face = undefined; }
    else if (p.moveA !== undefined) p.a = lerpAngle(p.a, p.moveA, 1 - Math.exp(-8 * dt));
    p.moveA = undefined;
}

function survivorBot(p, dt, hn, b) {
    if (H.phase !== 'hunt') return;
    const d = hn && hn.alive ? Math.hypot(hn.x - p.x, hn.z - p.z) : 99;
    if (b.think <= 0) {
        b.think = 0.25 + Math.random() * 0.15;
        const released = H.release <= 0;
        // Spot the hunter's glowing eyes in the open, hear their heavy steps close by, hear shots and screams
        const sees = released && d < 99 && ((d < 18 && lineOfSight(map, p.x, p.z, hn.x, hn.z)) || d < 8);
        // Everyone saw where the hunter stood waiting, so use the head start to get well away from it
        if (!released && d < 14) { b.seenAt = T; b.hx = hn.x; b.hz = hn.z; }
        const near = (e, r) => e && T - e.t < 1 && Math.hypot(e.x - p.x, e.z - p.z) < r;
        if (sees) { b.seenAt = T; b.hx = hn.x; b.hz = hn.z; }
        else if (near(H.lastShot, 26)) { b.seenAt = T; b.hx = H.lastShot.x; b.hz = H.lastShot.z; }
        else if (near(H.lastScream, 36)) { b.seenAt = T; b.hx = H.lastScream.x; b.hz = H.lastScream.z; }
        const threatened = T - b.seenAt < 6 && Math.hypot(b.hx - p.x, b.hz - p.z) < 20;
        const facingMe = sees && angDiff(hn.a, Math.atan2(p.x - hn.x, p.z - hn.z)) < 1.0;
        if (sees && b.brave && p.battery > 12 && d < 8 && d > 2.5 && facingMe && hn.immuneT <= 0 && hn.stunT <= 0) b.mode = 'blind';
        else if (sees && p.flares > 0 && d < 8 && Math.random() < 0.5) { hostFlare(p, Math.atan2(hn.x - p.x, hn.z - p.z)); b.mode = 'flee'; b.goal = fleeTile(p, hn.x, hn.z); }
        else if (threatened) {
            if (b.mode !== 'flee' || !b.goal || Math.hypot(map.cx(b.goal.c) - b.hx, map.cz(b.goal.r) - b.hz) < 10) b.goal = fleeTile(p, b.hx, b.hz);
            b.mode = 'flee';
        } else if (b.mode === 'flee' || b.mode === 'blind') { b.mode = 'hide'; b.idle = 3 + Math.random() * 5; b.goal = null; } // got away: lie low
        if (b.mode === 'roam' && !b.goal) {
            const bat = p.battery < 60 && H.batteries.filter(x => Math.hypot(x.x - p.x, x.z - p.z) < 30).sort((u, v) => Math.hypot(u.x - p.x, u.z - p.z) - Math.hypot(v.x - p.x, v.z - p.z))[0];
            if (bat) b.goal = { c: map.col(bat.x), r: map.row(bat.z) };
            else b.goal = randomTile(t => Math.hypot(map.cx(t.c) - p.x, map.cz(t.r) - p.z) < 20 && (!hn || Math.hypot(map.cx(t.c) - hn.x, map.cz(t.r) - hn.z) > 14) && (coverAt(t) >= 2 || Math.random() < 0.25));
        }
        // Lights stay off whenever the hunter might be around; some survivors are just braver with them
        const danger = released && (T - b.seenAt < 15 || d < 20);
        if (b.mode === 'blind') p.light = p.battery > 0;
        else if (b.mode === 'flee' || b.mode === 'hide') p.light = false;
        else p.light = p.battery > 20 && !danger && b.lightPref > 0.4;
        p.sprint = b.mode === 'flee' && d < (sees ? 13 : 9) && p.stamina > 12;
    }
    if (b.mode === 'blind' && hn) {
        b.face = Math.atan2(hn.x - p.x, hn.z - p.z);
        p.sprint = false;
        return;
    }
    if (b.mode === 'hide') { p.stamina = Math.min(100, p.stamina + STAM_REGEN * dt); b.idle -= dt; if (b.idle <= 0) b.mode = 'roam'; return; }
    if (!b.goal) return;
    let speed = SURV_WALK;
    if (p.sprint && p.stamina > 0) { speed = SURV_RUN; p.stamina = Math.max(0, p.stamina - STAM_DRAIN * dt); if (p.stamina <= 0) p.sprint = false; }
    else p.stamina = Math.min(100, p.stamina + STAM_REGEN * dt);
    const moving = botWalk(p, dt, map.cx(b.goal.c), map.cz(b.goal.r), speed);
    if (!moving) {
        b.goal = null;
        if (b.mode === 'roam' && Math.random() < 0.65) { b.mode = 'hide'; b.idle = 4 + Math.random() * 6; }
    }
}

// Somewhere far from the hunter that isn't past them
function fleeTile(p, hx, hz) {
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 30; i++) {
        const t = map.open[Math.floor(Math.random() * map.open.length)];
        const x = map.cx(t.c), z = map.cz(t.r);
        const dh = Math.hypot(x - hx, z - hz), dm = Math.hypot(x - p.x, z - p.z);
        if (dh < dm) continue;
        const score = dh * 1.2 - dm * 0.5 + coverAt(t) * 2.5;
        if (score > bestScore) { bestScore = score; best = t; }
    }
    return best || randomTile();
}

function hunterBot(p, dt, b) {
    if (H.phase !== 'hunt' || H.release > 0 || p.stunT > 0) return;
    if (b.think <= 0) {
        b.think = 0.2;
        let best = null, bd = 1e9;
        const revealed = T < G.revealUntil;
        for (const s of players.values()) {
            if (s.role !== 'survivor' || !s.alive) continue;
            const d = Math.hypot(s.x - p.x, s.z - p.z);
            const los = d < 30 && lineOfSight(map, p.x, p.z, s.x, s.z);
            const seen = los && ((s.light && d < 28) || d < 7.5) || revealed || (s.sprint && d < 20);
            if (seen && d < bd) { bd = d; best = s; }
        }
        if (best) {
            if (b.target !== best.id) b.react = 0.45 + Math.random() * 0.35;
            b.target = best.id; b.known = { x: best.x, z: best.z, t: T }; b.lostAt = T;
        } else b.target = null;
        if (!best && p.screamCd <= 0 && T - b.lostAt > 7) { hostScream(p); G.revealUntil = T + REVEAL_TIME; }
        if (!best && (!b.known || T - b.known.t > 9) && !b.goal) {
            // Patrol, drifting toward where someone probably is
            const alive = [...players.values()].filter(s => s.role === 'survivor' && s.alive);
            if (alive.length && Math.random() < 0.35) {
                const s = alive[Math.floor(Math.random() * alive.length)];
                b.goal = randomTile(t => Math.hypot(map.cx(t.c) - s.x, map.cz(t.r) - s.z) < 10);
            } else b.goal = randomTile();
        }
    }
    b.react -= dt;
    const t = b.target && players.get(b.target);
    let speed = p.dashT > 0 ? HUNT_DASH : HUNT_WALK;
    if (t && t.alive) {
        const d = Math.hypot(t.x - p.x, t.z - p.z), want = Math.atan2(t.x - p.x, t.z - p.z);
        const los = lineOfSight(map, p.x, p.z, t.x, t.z);
        if (los && d > 4 && d < 12 && p.dashCd <= 0 && Math.random() < 0.02) hostDash(p);
        if (los && d < 7.2) {
            b.face = want;
            // A light in the eyes spoils the aim, same as it whites out a human hunter's screen
            const glared = [...players.values()].some(s => s.role === 'survivor' && s.alive && s.light && lightHits(s, p));
            if (glared) b.react = Math.max(b.react, 0.3);
            if (angDiff(p.a, want) < 0.15 && b.react <= 0 && p.pumpT <= 0 && p.shells > 0) hostFire(p, p.x, p.z, want + (Math.random() - 0.5) * 0.44);
            if (d > 3) botWalk(p, dt, t.x, t.z, speed * 0.8);
            return;
        }
        botWalk(p, dt, t.x, t.z, speed);
        return;
    }
    if (b.known && T - b.known.t < 9) {
        if (!botWalk(p, dt, b.known.x, b.known.z, speed)) b.known = null;
        return;
    }
    if (b.goal && !botWalk(p, dt, map.cx(b.goal.c), map.cz(b.goal.r), speed)) b.goal = null;
    if (p.shells < SHELLS && p.reloadT <= 0) p.reloadT = RELOAD_TIME;
}

/* ── client: rounds ────────────────────────────────────── */
function loadMap(id) {
    if (mapId === id && world) return;
    const def = MAPS.find(m => m.id === id) || MAPS[0];
    if (world) { scene.remove(world.root); world.dispose(); }
    map = parseMap(def); mapId = id;
    world = buildWorld(map, quality);
    scene.add(world.root);
    scene.background = new THREE.Color(def.sky);
    scene.fog = new THREE.Fog(def.fog, 18, 18 + 1.3 / def.fogDensity);
    moon.color.setHex(def.moon.color); moon.userData.base = def.moon.intensity;
    hemi.color.setHex(def.ambient); hemi.userData.base = def.indoor ? 1.0 : 1.2;
}

const flareFx = new Map(), batteryFx = new Map(), decals = [], rings = [], tracers = [];

function clearRoundFx() {
    for (const f of flareFx.values()) scene.remove(f.group);
    for (const b of batteryFx.values()) scene.remove(b);
    for (const d of decals) scene.remove(d);
    for (const r of rings) scene.remove(r);
    for (const t of tracers) scene.remove(t.obj);
    flareFx.clear(); batteryFx.clear(); decals.length = 0; rings.length = 0; tracers.length = 0;
    muzzleLight.intensity = 0;
}

function roundStart(msg) {
    $('loading').textContent = `Entering ${MAPS.find(m => m.id === msg.map)?.name || ''}...`;
    $('loading').classList.remove('hidden');
    // Let the loading text paint before the (slow) map build
    requestAnimationFrame(() => setTimeout(() => {
        try { loadMap(msg.map); } finally { $('loading').classList.add('hidden'); }
        setupRound(msg);
    }, 20));
}

function setupRound(msg) {
    clearRoundFx();
    G.phase = 'intro'; G.round = msg.round; G.rounds = msg.rounds; G.hunterId = msg.hunter;
    G.timeLeft = msg.time; G.release = RELEASE_TIME; G.dawn = 0; G.revealUntil = 0; G.winner = null; G.specId = null;
    let slot = 0;
    const survivorsFirst = [...players.values()].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0));
    for (const p of survivorsFirst) {
        const s = msg.spawns.find(x => x.id === p.id);
        if (!s) continue;
        p.role = p.id === msg.hunter ? 'hunter' : 'survivor';
        p.alive = true; p.x = p.rx = s.x; p.z = p.rz = s.z; p.a = p.ra = s.a;
        p.gain = 0; p.kills = 0; p.stuns = 0; p.light = false; p.sprint = false; p.speed = 0;
        p.battery = 100; p.stamina = 100; p.flares = 1; p.shells = SHELLS; p.pumpT = 0; p.reloadT = 0;
        p.dashT = 0; p.dashCd = 0; p.screamCd = 0; p.stunT = 0; p.immuneT = 0; p.stunUntil = 0; p.force = false; p.b = null;
        if (p.model) scene.remove(p.model);
        if (p.beam) scene.remove(p.beam);
        if (p.marker) scene.remove(p.marker);
        if (p.shadow) scene.remove(p.shadow);
        p.model = p.role === 'hunter' ? makeHunter() : makeSurvivor(p.look);
        p.model.position.set(p.x, 0, p.z);
        scene.add(p.model);
        p.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: SHADOW, transparent: true, depthWrite: false }));
        p.shadow.renderOrder = 1;
        scene.add(p.shadow);
        p.beam = null; p.slot = -1;
        if (p.role === 'survivor') {
            p.slot = slot++;
            p.beam = makeBeam(); p.beam.visible = false; scene.add(p.beam);
            // Red marker the hunter sees when they scream
            p.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(3, 0.2, 0.15), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
            p.marker.scale.set(2.2, 2.2, 1); p.marker.renderOrder = 20; p.marker.visible = false;
            scene.add(p.marker);
        }
    }
    for (const b of msg.bats || []) addBattery(b);
    me = players.get(myId) || null;
    const iAmHunter = me && me.role === 'hunter';
    const hunter = players.get(G.hunterId);
    // Intro card
    $('intro-round').textContent = `Round ${G.round} of ${G.rounds}`;
    const roleEl = $('intro-role');
    roleEl.className = iAmHunter ? 'hunter' : 'survivor';
    roleEl.textContent = iAmHunter ? 'YOU ARE THE HUNTER' : 'SURVIVE';
    $('intro-text').textContent = iAmHunter
        ? `Kill all ${players.size - 1} survivor${players.size > 2 ? 's' : ''} before dawn. They get a 10 second head start.`
        : `${hunter ? hunter.name : 'Someone'} is the hunter. Hide, keep your light low, and stay alive for ${fmtTime(G.timeLeft)}.`;
    $('intro-keys').innerHTML = isTouch ? '' : iAmHunter
        ? '<kbd>Click</kbd> shoot &nbsp; <kbd>Space</kbd> dash &nbsp; <kbd>Q</kbd> scream'
        : '<kbd>F</kbd> / <kbd>Click</kbd> flashlight &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>Q</kbd> flare';
    $('intro-map').textContent = map.def.name;
    $('intro').classList.remove('hidden');
    $('round-end').classList.add('hidden');
    $('bar-survivor').classList.toggle('hidden', iAmHunter);
    $('bar-hunter').classList.toggle('hidden', !iAmHunter);
    $('spectate').classList.add('hidden');
    $('hurt').style.opacity = 0;
    film.uniforms.uTint.value.set(iAmHunter ? 1.08 : 1, iAmHunter ? 0.9 : 1, iAmHunter ? 0.88 : 1);
    renderer.toneMappingExposure = iAmHunter ? 1.12 : 1.0;
    sfx.roundStart(iAmHunter);
    startAmbience(map.def.id);
    renderRoster();
    camera.position.set(me ? me.x : 0, CAM_OFF.y, (me ? me.z : 0) + CAM_OFF.z);
}

function onHunt() {
    G.phase = 'hunt';
    $('intro').classList.add('hidden');
    if (me && me.role === 'hunter') centerMsg('WAIT', 'The survivors are hiding.', 2.5);
    else centerMsg('HIDE', 'The hunter wakes in 10 seconds.', 2.5);
    sfx.go();
}

function onRelease() {
    G.release = 0;
    const hn = players.get(G.hunterId);
    if (me && me.role === 'hunter') { centerMsg('HUNT', 'Find them. Kill them all.', 2); sfx.release(); }
    else { centerMsg("IT'S AWAKE", '', 2); sfx.release(); }
    if (hn) playAt(hn, (v, pan) => sfx.hunterScream(v * 0.6, pan), 60);
}

function applySnapshot(msg) {
    G.timeLeft = msg.tl; G.release = msg.rl;
    for (const [id, x, z, a, f, batt] of msg.p) {
        const p = players.get(id);
        if (!p) continue;
        const wasLight = p.light;
        p.alive = !!(f & 1);
        p.battery = batt;
        if (p === me) {
            // We move ourselves; the host only overrides us when it had to correct our position
            if (f & 32) { p.x = p.rx = x; p.z = p.rz = z; }
            if (p.light && batt <= 0) p.light = false;
            continue;
        }
        p.sprint = !!(f & 4); p.stunT = f & 8 ? 1 : 0; p.dashT = f & 16 ? Math.max(p.dashT, 0.1) : 0;
        p.x = x; p.z = z; p.a = a; p.light = !!(f & 2);
        if (p.light !== wasLight && p.role === 'survivor') playAt(p, (v, pan) => sfx.torch(v * 0.5, pan), 14);
    }
}

function onShot(msg) {
    const p = players.get(msg.id);
    // A guest's own shots were already shown the moment they pulled the trigger
    if (p && (p !== me || role === 'host')) shotFx(p, msg.x, msg.z, msg.a);
}

function shotFx(p, x, z, a) {
    const u = p.model && p.model.userData;
    if (u) u.recoil = 1;
    const mp = new THREE.Vector3();
    if (u) { p.model.updateMatrixWorld(true); u.muzzle.getWorldPosition(mp); } else mp.set(x, 1.3, z);
    muzzleLight.position.copy(mp); muzzleLight.intensity = 260;
    // Pellet tracers, each stopped by the first wall
    const pos = [];
    for (let i = 0; i < 8; i++) {
        const aa = a + (Math.random() - 0.5) * SHOT_CONE * 1.6;
        let d = 0.5;
        for (; d < SHOT_RANGE + 2; d += 0.25) if (!map.seeThrough(map.col(x + Math.sin(aa) * d), map.row(z + Math.cos(aa) * d))) break;
        // A short streak somewhere along the pellet's path
        const a0 = 0.6 + Math.random() * Math.max(0, d - 2.5), a1 = Math.min(d, a0 + 1.4 + Math.random());
        const y0 = mp.y - 0.25 * a0 / d, y1 = mp.y - 0.25 * a1 / d;
        pos.push(x + Math.sin(aa) * a0, y0, z + Math.cos(aa) * a0, x + Math.sin(aa) * a1, y1, z + Math.cos(aa) * a1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(lines);
    tracers.push({ obj: lines, t: 0 });
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(4, 3, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(mp); flash.scale.setScalar(1.6);
    scene.add(flash);
    tracers.push({ obj: flash, t: 0 });
    const d = listenerDist(x, z);
    sfx.shot(clamp(1 - d / 60, 0.08, 0.8), pan(x));
    if (p === me || d < 20) sfx.pump(clamp(0.3 - d / 80, 0.03, 0.3), pan(x));
    shake = Math.max(shake, p === me ? 0.5 : clamp(0.4 - d / 40, 0, 0.3));
    if (p === me) film.uniforms.uFlash.value = 0.12, film.uniforms.uFlashColor.value.set(1, 0.85, 0.6);
}

function onDied(msg) {
    const p = players.get(msg.id);
    if (!p) return;
    p.alive = false; p.light = false;
    p.x = p.rx = msg.x; p.z = p.rz = msg.z;
    if (p.model) p.model.userData.dead = 0.001;
    if (p.beam) p.beam.visible = false;
    // Blood pool under the body
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: BLOOD[Math.floor(Math.random() * 3)], transparent: true, depthWrite: false, roughness: 0.25, metalness: 0.2 }));
    dec.position.set(msg.x - Math.sin(p.ra) * 0.8, 0.03, msg.z - Math.cos(p.ra) * 0.8); dec.rotation.y = Math.random() * 6; dec.scale.setScalar(0.2);
    dec.renderOrder = 2;
    scene.add(dec); decals.push(dec);
    playAt(p, (v, pn) => { sfx.death(v * 0.8, pn); sfx.hit(v * 0.6, pn); }, 50);
    const killer = players.get(msg.by);
    toast(`${p.name} was killed${killer ? ' by ' + killer.name : ''}`, 'kill');
    if (p === me) {
        $('hurt').style.opacity = 1;
        film.uniforms.uFlash.value = 0.55; film.uniforms.uFlashColor.value.set(0.5, 0, 0.02);
        shake = 0.8;
        centerMsg('YOU DIED', 'Spectating the others until the round ends.', 3);
        setHeart(0);
        setTimeout(() => { if (me && !me.alive) { $('hurt').style.opacity = 0.35; nextSpectate(); } }, 2500);
    }
    renderRoster();
}

function onStun(msg) {
    const p = players.get(msg.id);
    if (!p) return;
    p.stunT = msg.dur; p.stunUntil = T + msg.dur;
    p.dashT = 0;
    playAt(p, (v, pn) => sfx.stun(v * 0.8, pn), 40);
    const names = (msg.by || []).map(id => players.get(id)?.name).filter(Boolean);
    if (p === me) { film.uniforms.uFlash.value = 1; film.uniforms.uFlashColor.value.set(1, 0.97, 0.9); centerMsg('BLINDED', '', 1.5); }
    else toast(`${names.join(' & ') || 'Someone'} blinded the hunter!`);
    if (me && msg.by && msg.by.includes(myId)) centerMsg('BLINDED THEM!', 'Now run.', 1.6);
}

function onScream(msg) {
    const p = players.get(msg.id);
    if (!p) return;
    p.screamCd = SCREAM_CD;
    G.revealUntil = T + REVEAL_TIME;
    playAt(p, (v, pn) => sfx.hunterScream(Math.max(0.25, v), pn), 80);
    if (me && me.role === 'survivor' && me.alive) { centerMsg('YOU ARE SEEN', 'The hunter can see everyone for a moment.', 2); film.uniforms.uFlash.value = 0.25; film.uniforms.uFlashColor.value.set(0.6, 0, 0); }
}

function onFlare(msg) {
    const p = players.get(msg.id);
    if (p) p.flares = Math.max(0, p.flares - 1);
    const group = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xaa1a14, roughness: 0.6 }));
    stick.position.y = 0.05;
    group.add(stick);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(5, 0.9, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(0.9); core.position.y = 0.15;
    group.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(1.4, 0.15, 0.08), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(4.5); halo.position.y = 0.4;
    group.add(halo);
    // Sparks
    const N = 40, pos = new Float32Array(N * 3), sp = [];
    for (let i = 0; i < N; i++) sp.push({ x: 0, y: 0.15, z: 0, vx: 0, vy: 0, vz: 0, life: Math.random() });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(4, 1.4, 0.6), size: 0.07, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(sparks);
    group.position.set(msg.x0, 0, msg.z0);
    scene.add(group);
    flareFx.set(msg.uid, { group, core, halo, sparks, sp, pos, x0: msg.x0, z0: msg.z0, x: msg.x, z: msg.z, t: 0, until: FLARE_TIME });
    playAt({ rx: msg.x0, rz: msg.z0 }, (v, pn) => sfx.flare(v * 0.6, pn), 40);
}

function addBattery(b) {
    if (batteryFx.has(b.uid)) return;
    const g = new THREE.Group();
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 14), new THREE.MeshStandardMaterial({ color: 0x1c2a1c, roughness: 0.4, metalness: 0.6 }));
    cell.rotation.z = Math.PI / 2;
    g.add(cell);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.1, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 0.8) }));
    band.rotation.z = Math.PI / 2; band.position.x = 0.1;
    g.add(band);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 }));
    cap.rotation.z = Math.PI / 2; cap.position.x = 0.2;
    g.add(cap);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(0.2, 0.9, 0.35), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.1);
    g.add(glow);
    g.position.set(b.x, 0.35, b.z);
    g.userData.seed = Math.random() * 6;
    scene.add(g);
    batteryFx.set(b.uid, g);
}

function onBatTake(msg) {
    const g = batteryFx.get(msg.uid);
    if (g) { scene.remove(g); batteryFx.delete(msg.uid); }
    const p = players.get(msg.id);
    if (p) p.battery = msg.batt;
    if (p === me) { sfx.battery(); toast('Battery +50%'); }
}

function onLeft(msg) {
    const p = players.get(msg.id);
    if (!p) return;
    if (p.model) scene.remove(p.model);
    if (p.beam) scene.remove(p.beam);
    if (p.marker) scene.remove(p.marker);
    if (p.shadow) scene.remove(p.shadow);
    players.delete(msg.id);
    toast(`${p.name} left the game`);
    if (G.specId === msg.id) nextSpectate();
    renderRoster();
}

function onRoundEnd(msg) {
    G.phase = 'end'; G.winner = msg.winner;
    for (const q of msg.list) { const p = players.get(q.id); if (p) p.score = q.score; }
    setHeart(0);
    const hunterWon = msg.winner === 'hunter';
    const iWon = me && ((me.role === 'hunter') === hunterWon);
    if (hunterWon) sfx.lose(); else { sfx.dawn(); }
    if (iWon) setTimeout(() => sfx.win(), 600);
    setTimeout(() => {
        if (G.phase !== 'end') return;
        $('end-kicker').textContent = `Round ${msg.round} of ${msg.rounds}`;
        const title = $('end-title');
        title.className = hunterWon ? 'hunter' : 'survivors';
        title.textContent = hunterWon ? 'Nobody saw the sunrise' : 'Dawn breaks';
        $('end-sub').textContent = msg.reason || (hunterWon ? `${players.get(G.hunterId)?.name || 'The hunter'} killed everyone.` : `${msg.alive} of ${msg.total} survived the night.`);
        $('end-list').innerHTML = msg.list.map((q, i) => {
            const what = q.role === 'hunter' ? `Hunter · ${q.kills} kill${q.kills === 1 ? '' : 's'}` : `${q.alive ? 'Survived' : 'Killed'}${q.stuns ? ` · ${q.stuns} stun${q.stuns > 1 ? 's' : ''}` : ''}`;
            return `<li class="${q.id === myId ? 'me' : ''}"><span class="place">${i + 1}</span><span class="dot" style="background:${COLORS[q.idx % COLORS.length]}"></span><span><b>${esc(q.name)}</b><span class="what">${what}</span></span><span class="gain">+${q.gain}</span><span class="pts">${q.score}</span></li>`;
        }).join('');
        $('end-next').textContent = msg.last ? 'Final scores next...' : 'Next round starting...';
        $('round-end').classList.remove('hidden');
    }, 1800);
    centerMsg(hunterWon ? 'THE HUNTER WINS' : 'DAWN', '', 1.8);
}

function showResults(list) {
    G.phase = 'idle';
    stopAmbience(); setHeart(0);
    show('results');
    $('results-title').textContent = list[0] ? `${list[0].name} wins!` : 'Game over';
    $('results-list').innerHTML = list.map(q => `<li class="${q.id === myId ? 'me' : ''}"><span class="place">${q.place}</span><span class="dot" style="background:${COLORS[q.idx % COLORS.length]}"></span><span><b>${esc(q.name)}</b></span><span></span><span class="pts">${q.score}</span></li>`).join('');
    if (list[0] && list[0].id === myId) sfx.win();
}

/* ── sound placement ───────────────────────────────────── */
function listener() {
    const f = focusPlayer();
    return f ? { x: f.rx, z: f.rz } : { x: camera.position.x, z: camera.position.z - CAM_OFF.z };
}
const listenerDist = (x, z) => { const l = listener(); return Math.hypot(x - l.x, z - l.z); };
const pan = x => clamp((x - listener().x) / 14, -0.9, 0.9);
function playAt(p, fn, range = 30) {
    const d = listenerDist(p.rx, p.rz);
    if (d > range) return;
    fn(clamp(1 - d / range, 0, 1), pan(p.rx));
}

/* ── input ─────────────────────────────────────────────── */
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, has: false };
const touchIn = { mx: 0, mz: 0, ax: 0, az: 0, aim: false, sprint: false };
addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'Escape') { togglePause(); return; }
    if (view !== 'game' || paused) return;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyF') primary(true);
    if (e.code === 'KeyQ') secondary();
    if (e.code === 'KeyR') reload();
    if (e.code === 'Space') { if (me && me.alive && me.role === 'hunter') dash(); else if (!me || !me.alive) nextSpectate(); }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && me && me.role === 'hunter') dash();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; });
canvas.addEventListener('mousedown', e => {
    unlockAudio();
    if (view !== 'game' || paused) return;
    if (!me || !me.alive) { nextSpectate(); return; }
    if (e.button === 0) primary(false);
    if (e.button === 2) secondary();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('spectate').onclick = () => nextSpectate();

const canAct = () => view === 'game' && me && me.alive && G.phase === 'hunt';
function primary(fromKey) {
    if (!canAct()) return;
    if (me.role === 'survivor') {
        if (me.battery <= 0) { sfx.dry(); toast('Your battery is dead. Find a spare.'); return; }
        me.light = !me.light; sfx.torch(0.2);
    } else if (!fromKey) fire();
}
function secondary() {
    if (!canAct()) return;
    if (me.role === 'survivor') {
        if (me.flares <= 0) { sfx.dry(); return; }
        act({ t: 'flare', a: +me.a.toFixed(3) });
    } else if (G.release <= 0 && me.screamCd <= 0 && T > me.stunUntil) {
        // On the host, `me` is the host's own record, so let the host check and update it
        if (role !== 'host') me.screamCd = SCREAM_CD;
        act({ t: 'scream' });
    }
}
function fire() {
    if (G.release > 0 || T < me.stunUntil) return;
    if (me.pumpT > 0) return;
    if (me.shells <= 0) { sfx.dry(); return; }
    const msg = { t: 'fire', x: +me.x.toFixed(2), z: +me.z.toFixed(2), a: +me.a.toFixed(3) };
    if (role === 'host') act(msg); // hostFire updates shells and shows the shot
    else {
        me.shells--; me.pumpT = PUMP_TIME;
        if (me.shells <= 0) me.reloadT = RELOAD_TIME;
        shotFx(me, me.x, me.z, me.a);
        act(msg);
    }
    if (me.shells <= 0) setTimeout(() => sfx.reload(), 500);
}
function reload() {
    if (!canAct() || me.role !== 'hunter' || me.shells >= SHELLS || me.reloadT > 0) return;
    me.reloadT = RELOAD_TIME; sfx.reload();
    act({ t: 'reload' });
}
function dash() {
    if (!canAct() || G.release > 0 || me.dashCd > 0 || T < me.stunUntil) return;
    if (role !== 'host') { me.dashT = DASH_TIME; me.dashCd = DASH_CD; }
    sfx.dash(0.35);
    act({ t: 'dash' });
}

// Touch: left half moves, right half aims; three buttons
function stick(zoneId, stickId, onMove) {
    const zone = $(zoneId), el = $(stickId), knob = el.firstElementChild;
    let id = null, ox = 0, oy = 0;
    zone.addEventListener('pointerdown', e => {
        unlockAudio();
        if (id !== null) return;
        id = e.pointerId; ox = e.clientX; oy = e.clientY;
        zone.setPointerCapture(id);
        el.style.left = ox + 'px'; el.style.top = oy + 'px'; el.style.display = 'block';
        knob.style.transform = '';
        if (view === 'game' && (!me || !me.alive)) nextSpectate();
    });
    zone.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        let dx = e.clientX - ox, dy = e.clientY - oy;
        const d = Math.hypot(dx, dy), max = 50;
        if (d > max) { dx *= max / d; dy *= max / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / max, dy / max, true);
    });
    const end = e => { if (e.pointerId !== id) return; id = null; el.style.display = 'none'; onMove(0, 0, false); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
}
stick('zone-move', 'stick-move', (x, y) => { touchIn.mx = x; touchIn.mz = y; });
stick('zone-aim', 'stick-aim', (x, y, on) => { touchIn.aim = on && Math.hypot(x, y) > 0.25; if (touchIn.aim) { touchIn.ax = x; touchIn.az = y; } });
const tbtn = (id, down, up) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); unlockAudio(); down(); }); if (up) { b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); } };
tbtn('t-b1', () => { if (me && me.role === 'hunter') fire(); else secondary(); });
tbtn('t-b2', () => { if (me && me.role === 'hunter') dash(); else touchIn.sprint = true; }, () => { touchIn.sprint = false; });
tbtn('t-b3', () => { if (me && me.role === 'hunter') secondary(); else primary(false); });

/* ── local player ──────────────────────────────────────── */
const ray = new THREE.Raycaster(), aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1), aimHit = new THREE.Vector3(), ndc = new THREE.Vector2();
let sendT = 0;

function localUpdate(dt) {
    if (!me || !me.alive || !map) return;
    const hunting = G.phase === 'hunt';
    const hunter = me.role === 'hunter';
    const stunned = hunter && T < me.stunUntil;
    const frozen = !hunting || (hunter && G.release > 0) || stunned;
    // Movement input (screen up is north, -z)
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    mx += touchIn.mx; mz += touchIn.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const moving = ml > 0.1;
    // Aim: the mouse on the ground, or the right stick, or the way we're walking
    if (!stunned) {
        if (touchIn.aim) me.a = Math.atan2(touchIn.ax, touchIn.az);
        else if (isTouch) { if (moving) me.a = lerpAngle(me.a, Math.atan2(mx, mz), 1 - Math.exp(-12 * dt)); }
        else if (mouse.has) {
            ndc.set(mouse.x / innerWidth * 2 - 1, -(mouse.y / innerHeight) * 2 + 1);
            ray.setFromCamera(ndc, camera);
            if (ray.ray.intersectPlane(aimPlane, aimHit)) me.a = Math.atan2(aimHit.x - me.x, aimHit.z - me.z);
        }
    }
    // Speed
    let speed = 0;
    const wantSprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchIn.sprint;
    // On the host, `me` is also the host's record, whose timers the host tick already counts down
    const mirror = role !== 'host';
    if (hunter) {
        if (mirror) me.dashT = Math.max(0, me.dashT - dt);
        speed = me.dashT > 0 ? HUNT_DASH : HUNT_WALK;
        if (flareNear(me.x, me.z)) speed *= FLARE_SLOW;
    } else {
        const canSprint = wantSprint && moving && (me.sprint ? me.stamina > 0 : me.stamina > 15);
        me.sprint = canSprint && hunting;
        if (me.sprint) { me.stamina = Math.max(0, me.stamina - STAM_DRAIN * dt); speed = SURV_RUN; }
        else { me.stamina = Math.min(100, me.stamina + STAM_REGEN * dt * (moving ? 0.7 : 1)); speed = SURV_WALK; }
    }
    if (map.charAt(me.x, me.z) === 'c') speed *= CORN_SLOW;
    // Walking backwards is slower
    if (moving && angDiff(Math.atan2(mx, mz), me.a) > 2.2) speed *= 0.82;
    if (frozen) speed = 0;
    if (moving && speed > 0) {
        const pos = collide(map, me.x + mx * speed * dt, me.z + mz * speed * dt, RAD);
        me.x = pos.x; me.z = pos.z;
    }
    // Guests mirror the host's timers so buttons feel instant
    if (mirror) {
        me.pumpT = Math.max(0, me.pumpT - dt); me.dashCd = Math.max(0, me.dashCd - dt); me.screamCd = Math.max(0, me.screamCd - dt);
        if (me.reloadT > 0) { me.reloadT -= dt; if (me.reloadT <= 0) { me.reloadT = 0; me.shells = SHELLS; } }
    }
    if (me.role === 'survivor' && me.battery <= 0 && me.light) { me.light = false; sfx.torch(0.1); toast('Your battery died.'); }
    sendT -= dt;
    if (sendT <= 0) {
        sendT = SEND_EVERY;
        act({ t: 'st', x: +me.x.toFixed(2), z: +me.z.toFixed(2), a: +me.a.toFixed(2), l: me.light ? 1 : 0, sp: me.sprint ? 1 : 0 });
    }
}
const flareNear = (x, z) => { for (const f of flareFx.values()) if (f.t > 0.5 && f.t < f.until && Math.hypot(f.x - x, f.z - z) < FLARE_RAD) return true; return false; };

/* ── spectating ────────────────────────────────────────── */
function focusPlayer() {
    if (me && me.alive) return me;
    const s = G.specId && players.get(G.specId);
    if (s) return s;
    return me || [...players.values()][0] || null;
}
function nextSpectate() {
    if (view !== 'game' || (me && me.alive)) return;
    const list = [...players.values()].filter(p => p.alive);
    if (!list.length) return;
    const i = list.findIndex(p => p.id === G.specId);
    const next = list[(i + 1) % list.length];
    G.specId = next.id;
    $('spectate').classList.remove('hidden');
    $('spec-name').textContent = `${next.name}${next.role === 'hunter' ? ' (hunter)' : ''}`;
}

/* ── rendering the game ────────────────────────────────── */
let shake = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const labelEls = new Map();

function updateVisuals(dt) {
    const focus = focusPlayer();
    const iAmHunter = me && me.role === 'hunter' && me.alive;
    const survivorView = !me || me.role === 'survivor' || !me.alive;
    let glare = 0;
    // Characters
    for (const p of players.values()) {
        if (!p.model) continue;
        const oldX = p.rx, oldZ = p.rz;
        if (p === me) { p.rx = p.x; p.rz = p.z; p.ra = lerpAngle(p.ra, p.a, 1 - Math.exp(-25 * dt)); }
        else {
            const k = 1 - Math.exp(-12 * dt);
            p.rx += (p.x - p.rx) * k; p.rz += (p.z - p.rz) * k; p.ra = lerpAngle(p.ra, p.a, 1 - Math.exp(-14 * dt));
        }
        const moved = Math.hypot(p.rx - oldX, p.rz - oldZ);
        p.speed = p.speed + (moved / Math.max(dt, 1e-3) - p.speed) * (1 - Math.exp(-10 * dt));
        p.model.position.set(p.rx, 0, p.rz);
        p.model.rotation.y = p.ra;
        const stunned = p.role === 'hunter' && (p.stunT > 0 || T < (p.stunUntil || 0));
        animate(p.model, dt, p.alive ? p.speed : 0, { lightOn: p.light && p.alive, stunned });
        p.shadow.position.set(p.rx, 0.02, p.rz);
        p.shadow.visible = p.alive;
        // Footsteps: louder when running, and the hunter's are heavy
        if (p.alive && moved > 0) {
            p.stepAcc += moved;
            const stride = p.role === 'hunter' ? 1.5 : p.sprint ? 1.8 : 1.2;
            if (p.stepAcc > stride) {
                p.stepAcc = 0;
                const base = p.role === 'hunter' ? 0.22 : p.sprint ? 0.16 : 0.06;
                const range = p.role === 'hunter' ? 24 : p.sprint ? 22 : 10;
                playAt(p, (v, pn) => sfx.step(surfaceAt(p.rx, p.rz), base * v * (p === me ? 0.7 : 1), pn), range);
            }
        }
        // Hunter's eyes burn brighter when released
        if (p.role === 'hunter') p.model.userData.eyeM.color.setRGB(G.release > 0 ? 1.5 : 6, 0.5, 0.3);
        // Flashlight
        if (p.role === 'survivor') {
            const s = spots[p.slot];
            let on = p.alive && p.light;
            let power = 1;
            if (on && p.battery < 15) power = Math.random() < 0.08 + (15 - p.battery) / 60 ? 0.05 : 0.55 + p.battery / 35;
            p.model.updateMatrixWorld(true);
            p.model.userData.tip.getWorldPosition(tmpV);
            p.model.userData.lensMat.color.setRGB(on ? 4 * power : 0.15, on ? 3.7 * power : 0.15, on ? 3.2 * power : 0.14);
            if (s) {
                s.intensity = on ? SPOT_POWER * power : 0;
                s.position.copy(tmpV);
                s.target.position.set(tmpV.x + Math.sin(p.ra) * 8, 0.1, tmpV.z + Math.cos(p.ra) * 8);
            }
            p.beam.visible = on;
            if (on) { p.beam.position.copy(tmpV); p.beam.rotation.set(0.12, p.ra, 0); p.beam.material.uniforms.uI.value = power; }
            // The hunter gets dazzled when a light is pointed at their face
            if (iAmHunter && on && lightHits({ x: p.rx, z: p.rz, a: p.ra }, { x: me.x, z: me.z, a: me.a })) {
                const d = Math.hypot(me.x - p.rx, me.z - p.rz);
                glare += (1 - d / LIGHT_RANGE) * 0.6 + 0.25;
            }
            // Scream reveal, seen by the hunter only
            const reveal = iAmHunter && p.alive && T < G.revealUntil;
            p.marker.visible = reveal;
            if (reveal) { p.marker.position.set(p.rx, 1.3, p.rz); p.marker.material.opacity = 0.6 + Math.sin(T * 12) * 0.3; }
            // Sprinting survivors leave red ripples the hunter can see through walls
            if (iAmHunter && p.alive && p.sprint && G.release <= 0) {
                p.ringT = (p.ringT || 0) - dt;
                if (p.ringT <= 0 && Math.hypot(p.rx - me.x, p.rz - me.z) < 32) { p.ringT = 0.45; addRing(p.rx, p.rz); }
            }
        }
    }
    // Unused flashlights stay dark
    const used = new Set([...players.values()].map(p => p.slot));
    spots.forEach((s, i) => { if (!used.has(i)) s.intensity = 0; });
    // Glare overlay for the hunter
    glareLevel += (Math.min(1, glare) - glareLevel) * (1 - Math.exp(-(glare > glareLevel ? 10 : 4) * dt));
    $('glare').style.opacity = (glareLevel * 0.85).toFixed(3);
    // Little light around yourself so you can find your own character
    if (focus && focus.alive) { selfLight.position.set(focus.rx, 2.2, focus.rz); selfLight.intensity = focus.role === 'hunter' ? 1.2 : 2.5; }
    else selfLight.intensity = 0;
    // World: lamps, flares, batteries, rings, tracers
    const fx = focus ? focus.rx : 0, fz = focus ? focus.rz : 0;
    if (world) {
        world.update(dt, T, fx, fz);
        const near = world.lamps.slice().sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz));
        lampLights.forEach((l, i) => {
            const L = near[i];
            if (!L || Math.hypot(L.x - fx, L.z - fz) > 40) { l.intensity = 0; return; }
            l.position.set(L.x, L.y, L.z); l.color.setHex(L.color); l.intensity = L.power * L.level;
        });
    }
    updateFlares(dt, fx, fz);
    for (const g of batteryFx.values()) { g.rotation.y += dt * 1.5; g.position.y = 0.35 + Math.sin(T * 2 + g.userData.seed) * 0.08; }
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.userData.t += dt;
        const k = r.userData.t / 1.1;
        if (k >= 1) { scene.remove(r); rings.splice(i, 1); continue; }
        r.scale.setScalar(0.4 + k * 2.6); r.material.opacity = 0.9 * (1 - k);
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i]; t.t += dt;
        if (t.t > 0.1) { scene.remove(t.obj); tracers.splice(i, 1); continue; }
        t.obj.material.opacity = 1 - t.t / 0.1;
    }
    for (const d of decals) if (d.scale.x < 1) d.scale.setScalar(Math.min(1, d.scale.x + dt * 0.6));
    muzzleLight.intensity *= Math.exp(-28 * dt);
    film.uniforms.uFlash.value *= Math.exp(-3.5 * dt);
    // Moon, and dawn creeping in over the last 20 seconds
    const dawnTarget = G.phase === 'end' && G.winner === 'survivors' ? 1 : G.phase === 'hunt' && G.release <= 0 ? clamp((20 - G.timeLeft) / 20, 0, 1) * 0.35 : 0;
    G.dawn += (dawnTarget - G.dawn) * (1 - Math.exp(-1.2 * dt));
    if (map) {
        moon.intensity = (moon.userData.base || 0.5) * (1 + G.dawn * 2.5);
        hemi.intensity = (hemi.userData.base || 0.5) * (1 + G.dawn * 3);
        moon.position.set(fx + 11, 34, fz + 15); // from the camera's side, so the faces we look at catch the light
        moon.target.position.set(fx, 0, fz);
    }
    // Hunter waiting in the dark for the release
    const waiting = iAmHunter && G.phase === 'hunt' && G.release > 0;
    film.uniforms.uFade.value += ((waiting ? 0.93 : G.phase === 'intro' && iAmHunter ? 0.5 : 0) - film.uniforms.uFade.value) * (1 - Math.exp(-4 * dt));
    film.uniforms.uSat.value = me && !me.alive ? 0.35 : 0.82;
    // Heartbeat: louder and faster as the hunter gets close
    if (me && me.alive && me.role === 'survivor' && G.phase === 'hunt') {
        const hn = players.get(G.hunterId);
        const d = hn && hn.alive ? Math.hypot(hn.rx - me.x, hn.rz - me.z) : 99;
        setHeart(G.release > 0 ? 0.15 : clamp((22 - d) / 18, 0, 1));
    } else setHeart(0);
    updateCamera(dt, focus);
    updateLabels(survivorView);
    updateHud();
}
let glareLevel = 0;

function surfaceAt(x, z) {
    const ch = map.charAt(x, z);
    if (ch === 'c') return 'corn';
    if (ch === 'i' || ch === '=') return map.def.floor === 'tiles' ? 'tile' : map.def.floor === 'concrete' ? 'tile' : 'wood';
    if (map.def.ground === 'tiles') return 'tile';
    if (map.def.ground === 'gravel') return 'gravel';
    return 'soft';
}

function addRing(x, z) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.15, 0.1), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    r.position.set(x, 0.1, z); r.renderOrder = 15; r.userData.t = 0;
    scene.add(r); rings.push(r);
}

function updateFlares(dt, fx, fz) {
    const active = [];
    for (const [uid, f] of flareFx) {
        f.t += dt;
        // Arc from the thrower to where it lands
        const k = Math.min(1, f.t / 0.5);
        f.group.position.set(f.x0 + (f.x - f.x0) * k, Math.sin(k * Math.PI) * 1.6, f.z0 + (f.z - f.z0) * k);
        const life = f.until - f.t;
        if (life <= 0) { scene.remove(f.group); flareFx.delete(uid); continue; }
        const burn = clamp(life / 1.5, 0, 1) * (0.85 + Math.sin(T * 30 + uid) * 0.1 + Math.random() * 0.08);
        f.level = burn;
        f.core.material.opacity = burn; f.halo.material.opacity = 0.55 * burn;
        f.core.scale.setScalar(0.7 + Math.random() * 0.3);
        for (let i = 0; i < f.sp.length; i++) {
            const s = f.sp[i];
            s.life -= dt * 1.8;
            if (s.life <= 0) { s.life = 1; s.x = 0; s.y = 0.15; s.z = 0; s.vx = (Math.random() - 0.5) * 1.6; s.vy = 1 + Math.random() * 1.8; s.vz = (Math.random() - 0.5) * 1.6; }
            s.vy -= 5 * dt; s.x += s.vx * dt; s.y = Math.max(0.02, s.y + s.vy * dt); s.z += s.vz * dt;
            f.pos[i * 3] = s.x; f.pos[i * 3 + 1] = s.y; f.pos[i * 3 + 2] = s.z;
        }
        f.sparks.geometry.attributes.position.needsUpdate = true;
        f.sparks.material.opacity = burn;
        active.push(f);
    }
    active.sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz));
    flareLights.forEach((l, i) => {
        const f = active[i];
        if (!f) { l.intensity = 0; return; }
        l.position.set(f.group.position.x, 0.6, f.group.position.z);
        l.intensity = 70 * f.level * (0.85 + Math.random() * 0.3);
    });
}

function updateCamera(dt, focus) {
    if (!focus) return;
    // Look ahead toward where the player is aiming. With a mouse, lead by the cursor's place on screen:
    // leading by the aim angle would move the ground under a still cursor and make the aim chase itself.
    let lx = 0, lz = 0;
    if (focus === me && me.alive) {
        if (!isTouch && mouse.has) { lx = clamp(mouse.x / innerWidth * 2 - 1, -1, 1) * 3.2; lz = clamp(mouse.y / innerHeight * 2 - 1, -1, 1) * 2.2; }
        else { lx = Math.sin(me.a) * 2.2; lz = Math.cos(me.a) * 2.2; }
    }
    const tx = focus.rx + lx, tz = focus.rz + lz;
    const k = 1 - Math.exp(-5 * dt);
    camTarget.x += (tx - camTarget.x) * k; camTarget.z += (tz - camTarget.z) * k;
    camera.position.set(camTarget.x + CAM_OFF.x, CAM_OFF.y, camTarget.z + CAM_OFF.z);
    camera.lookAt(camTarget.x, 0, camTarget.z);
    if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.z += (Math.random() - 0.5) * shake; shake *= Math.exp(-6 * dt); }
    // See-through circle around the focused character
    tmpV2.set(focus.rx, 1.1, focus.rz).project(camera);
    const w = renderer.domElement.width, h = renderer.domElement.height;
    cut.pos.value.set((tmpV2.x * 0.5 + 0.5) * w, (tmpV2.y * 0.5 + 0.5) * h, tmpV2.z * 0.5 + 0.5);
    cut.radius.value = h * 0.2;
}
const camTarget = { x: 0, z: 0 };

// Name tags: survivors see each other; the hunter sees nobody's
function updateLabels(show) {
    const box = $('labels');
    const want = new Set();
    if (show && view === 'game') {
        for (const p of players.values()) {
            if (p === me || p.role !== 'survivor' || !p.model) continue;
            tmpV.set(p.rx, 2.25, p.rz).project(camera);
            if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) continue;
            want.add(p.id);
            let el = labelEls.get(p.id);
            if (!el) { el = document.createElement('div'); el.className = 'label'; box.appendChild(el); labelEls.set(p.id, el); }
            el.textContent = p.name;
            el.classList.toggle('dead', !p.alive);
            el.style.left = ((tmpV.x * 0.5 + 0.5) * innerWidth) + 'px';
            el.style.top = ((-tmpV.y * 0.5 + 0.5) * innerHeight) + 'px';
        }
    }
    for (const [id, el] of labelEls) if (!want.has(id)) { el.remove(); labelEls.delete(id); }
}

const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
    if (view !== 'game') return;
    const releasing = G.phase === 'hunt' && G.release > 0;
    setText('timer', G.phase === 'intro' ? fmtTime(G.timeLeft) : releasing ? `0:${String(Math.ceil(G.release)).padStart(2, '0')}` : fmtTime(G.timeLeft));
    $('timer').classList.toggle('low', G.phase === 'hunt' && !releasing && G.timeLeft < 20);
    const ph = $('phase');
    let phase = '';
    if (G.phase === 'intro') phase = 'Get ready';
    else if (releasing) phase = me && me.role === 'hunter' ? 'Released in' : 'Hunter wakes in';
    else if (G.phase === 'hunt') phase = G.timeLeft < 20 ? 'Dawn is coming' : 'Until dawn';
    setText('phase', phase);
    ph.classList.toggle('alert', releasing);
    if (!me) return;
    if (me.role === 'survivor') {
        const b = Math.round(me.battery);
        setText('batt-pct', b + '%');
        $('batt-bar').style.width = b + '%';
        $('m-batt').classList.toggle('low', b < 20);
        $('stam-bar').style.width = Math.round(me.stamina) + '%';
        $('slot-flare').classList.toggle('off', me.flares <= 0);
        const t1 = $('t-b1'), t2 = $('t-b2'), t3 = $('t-b3');
        if (t1.textContent !== 'FLARE') { t1.textContent = 'FLARE'; t2.textContent = 'SPRINT'; t3.textContent = 'LIGHT'; }
        t3.classList.toggle('on', me.light);
    } else {
        const sh = $('shells').children;
        for (let i = 0; i < sh.length; i++) sh[i].classList.toggle('spent', i >= me.shells);
        setText('shell-txt', me.reloadT > 0 ? 'RELOADING' : 'SHELLS');
        $('cd-dash').style.height = (me.dashCd / DASH_CD * 100) + '%';
        $('cd-scream').style.height = (me.screamCd / SCREAM_CD * 100) + '%';
        const t1 = $('t-b1'), t2 = $('t-b2'), t3 = $('t-b3');
        if (t1.textContent !== 'SHOOT') { t1.textContent = 'SHOOT'; t2.textContent = 'DASH'; t3.textContent = 'SCREAM'; t3.classList.remove('on'); }
    }
}

function renderRoster() {
    const list = [...players.values()].sort((a, b) => (a.role === 'hunter' ? -1 : b.role === 'hunter' ? 1 : 0));
    $('roster').innerHTML = list.map(p => `<div class="${p.role === 'hunter' ? 'hunter' : ''} ${!p.alive ? 'dead' : ''} ${p === me ? 'me' : ''}"><i style="${p.role === 'hunter' ? '' : `background:${p.color}`}"></i><span>${esc(p.name)}${p.role === 'hunter' ? ' · hunter' : ''}</span></div>`).join('');
}

/* ── menu backdrop: a survivor walking the camp, being watched ── */
const menuScene = { walker: null, watcher: null, beam: null, t: 0 };
function setupMenuScene() {
    loadMap('camp');
    clearRoundFx();
    for (const m of [menuScene.walker, menuScene.watcher, menuScene.beam]) if (m) scene.remove(m);
    menuScene.walker = makeSurvivor(SURVIVOR_LOOKS[0]);
    menuScene.watcher = makeHunter();
    menuScene.beam = makeBeam();
    scene.add(menuScene.walker, menuScene.watcher, menuScene.beam);
    const fire = map.fires[0] || { c: map.W / 2, r: map.H / 2 };
    menuScene.cx = map.cx(fire.c); menuScene.cz = map.cz(fire.r);
    menuScene.watcher.position.set(menuScene.cx + 7.5, 0, menuScene.cz - 5);
    menuScene.watcher.rotation.y = Math.atan2(-7.5, 5);
    film.uniforms.uTint.value.set(1, 1, 1); film.uniforms.uFade.value = 0; film.uniforms.uSat.value = 0.82;
    renderer.toneMappingExposure = 1.05;
}
function clearMenuScene() {
    for (const m of [menuScene.walker, menuScene.watcher, menuScene.beam]) if (m) scene.remove(m);
    menuScene.walker = menuScene.watcher = menuScene.beam = null;
}
function menuUpdate(dt) {
    if (!menuScene.walker) return;
    const s = menuScene;
    s.t += dt * 0.16;
    const R = 5.2, x = s.cx + Math.cos(s.t) * R, z = s.cz + Math.sin(s.t) * R;
    s.walker.position.set(x, 0, z);
    const a = Math.atan2(-Math.sin(s.t), Math.cos(s.t)) + Math.sin(T * 0.7) * 0.5;
    s.walker.rotation.y = a;
    animate(s.walker, dt, 2.2, { lightOn: true });
    animate(s.watcher, dt, 0, {});
    s.watcher.userData.eyeM.color.setRGB(6, 0.5, 0.3);
    s.walker.updateMatrixWorld(true);
    s.walker.userData.tip.getWorldPosition(tmpV);
    s.walker.userData.lensMat.color.setRGB(4, 3.7, 3.2);
    spots[0].intensity = SPOT_POWER; spots[0].position.copy(tmpV);
    spots[0].target.position.set(tmpV.x + Math.sin(a) * 8, 0, tmpV.z + Math.cos(a) * 8);
    for (let i = 1; i < spots.length; i++) spots[i].intensity = 0;
    s.beam.visible = true; s.beam.position.copy(tmpV); s.beam.rotation.set(0.12, a, 0);
    const ca = T * 0.05;
    camera.position.set(s.cx + Math.sin(ca) * 16, 17, s.cz + Math.cos(ca) * 16);
    camera.lookAt(s.cx, 0, s.cz);
    world.update(dt, T, s.cx, s.cz);
    const near = world.lamps.slice().sort((a2, b) => Math.hypot(a2.x - s.cx, a2.z - s.cz) - Math.hypot(b.x - s.cx, b.z - s.cz));
    lampLights.forEach((l, i) => { const L = near[i]; if (!L) { l.intensity = 0; return; } l.position.set(L.x, L.y, L.z); l.color.setHex(L.color); l.intensity = L.power * L.level; });
    moon.position.set(s.cx + 11, 34, s.cz + 15); moon.target.position.set(s.cx, 0, s.cz);
    moon.intensity = moon.userData.base; hemi.intensity = hemi.userData.base;
    selfLight.intensity = 0; flareLights.forEach(l => l.intensity = 0);
    cut.pos.value.set(-1e5, -1e5, 0);
}

/* ── lobby, menu, flow ─────────────────────────────────── */
function cleanupGame() {
    for (const p of players.values()) for (const k of ['model', 'beam', 'marker', 'shadow']) if (p[k]) scene.remove(p[k]);
    players.clear(); me = null;
    clearRoundFx();
    G.phase = 'idle';
    setHeart(0);
    $('glare').style.opacity = 0; $('hurt').style.opacity = 0;
    $('intro').classList.add('hidden'); $('round-end').classList.add('hidden');
    $('center-msg').textContent = ''; $('center-sub').textContent = '';
    paused = false; $('pause').classList.add('hidden');
}

function backToMenu() {
    if (net) { net.close(); net = null; }
    cleanupGame();
    role = ''; solo = false;
    document.body.classList.remove('is-host', 'solo');
    show('menu');
    setupMenuScene();
    menuAmbience();
}

function backToLobby(msg) {
    cleanupGame();
    show('lobby');
    setupMenuScene();
    menuAmbience();
    if (msg && msg.players) renderLobby(msg.players, msg.settings);
}

let joinTimer = null;
const NO_ANSWER = 'No answer from that room. Check the code, and ask the host to keep the game open.';
function enterJoinedLobby() {
    if (view !== 'menu' || role !== 'client') return;
    clearTimeout(joinTimer);
    show('lobby');
    $('room-code').textContent = roomCode;
    setMenuStatus('');
}

function readName() {
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('blackoutName', myName); } catch (e) {}
}
try { $('name').value = localStorage.getItem('blackoutName') || ''; } catch (e) {}

async function createRoom(isSolo) {
    readName(); unlockAudio(); sfx.click();
    role = 'host'; solo = isSolo;
    document.body.classList.add('is-host');
    document.body.classList.toggle('solo', isSolo);
    H.players = []; H.phase = 'lobby';
    myId = 'host';
    if (!isSolo) {
        setMenuStatus('Creating room...');
        roomCode = makeCode();
        const hn = new HostNet({
            onMessage: (from, msg) => hostHandle(from, msg),
            onLeave: id => hostLeave(id),
        });
        try { await hn.open(roomCode); }
        catch (e) {
            if (e.message === 'code-taken') return createRoom(false);
            role = ''; document.body.classList.remove('is-host');
            return setMenuStatus(e.message, true);
        }
        net = hn;
        setMenuStatus('');
        track('room_create');
    } else { net = null; roomCode = 'SOLO'; }
    show('lobby');
    $('room-code').textContent = roomCode;
    hostHandle(myId, { t: 'hello', name: myName });
    if (isSolo) for (let i = 0; i < 4; i++) addBot(true);
    emitLobby();
}

function hostLeave(id) {
    const wasIn = H.players.some(p => p.id === id);
    H.players = H.players.filter(p => p.id !== id);
    if (H.phase === 'lobby') { if (wasIn) { emitLobby(); toast('A player left'); } return; }
    const p = players.get(id);
    if (!p) return;
    const wasHunter = p.role === 'hunter';
    emit({ t: 'left', id });
    H.order = H.order.filter(x => x !== id);
    if (players.size < 2) { hostFinish(); return; }
    if (wasHunter && (H.phase === 'hunt' || H.phase === 'intro')) hostEndRound('survivors', `${p.name} (the hunter) left the game.`);
}

function addBot(quiet) {
    if (H.players.length >= MAX_PLAYERS) return;
    const used = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
    H.players.push({ id: 'bot' + Math.random().toString(36).slice(2, 8), name, ready: true, bot: true, idx: freeIdx() });
    if (!quiet) emitLobby();
}

$('btn-create').onclick = () => createRoom(false);
$('btn-solo').onclick = () => createRoom(true);
$('btn-join').onclick = async () => {
    const code = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return setMenuStatus('Room codes are 5 letters or numbers.', true);
    readName(); unlockAudio(); sfx.click();
    setMenuStatus('Connecting...');
    role = 'client'; solo = false;
    document.body.classList.remove('is-host', 'solo');
    const q = new URLSearchParams(location.search);
    const cn = new ClientNet({
        onMessage: msg => clientHandle(msg),
        onClose: () => {
            if (net !== cn) return;
            const never = view === 'menu';
            clearTimeout(joinTimer);
            backToMenu();
            setMenuStatus(never ? NO_ANSWER : 'Lost connection to the host. The room may have closed.', true);
        },
        onStatus: s => setMenuStatus(s),
        forceRelay: q.get('net') === 'relay' || q.has('relay'),
    });
    try { myId = await cn.connect(code); }
    catch (e) { role = ''; return setMenuStatus(e.message, true); }
    net = cn; roomCode = code;
    setMenuStatus('Connected. Waiting for the host to answer...');
    net.send({ t: 'hello', name: myName });
    track('room_join');
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (net !== cn || view !== 'menu') return; backToMenu(); setMenuStatus(NO_ANSWER, true); }, 15000);
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').onclick(); });
$('btn-bot').onclick = () => { sfx.click(); addBot(false); };
$('btn-unbot').onclick = () => { sfx.click(); const b = [...H.players].reverse().find(p => p.bot); if (b) { H.players = H.players.filter(p => p !== b); emitLobby(); } };
$('btn-start').onclick = () => { sfx.click(); hostStart(); };
$('btn-ready').onclick = () => {
    sfx.click();
    const btn = $('btn-ready'), ready = btn.textContent === 'Ready up';
    btn.textContent = ready ? 'Cancel ready' : 'Ready up';
    act({ t: 'ready', r: ready });
};
$('btn-leave').onclick = () => { sfx.click(); backToMenu(); };
$('btn-copy').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => { $('btn-copy').textContent = 'Copied!'; setTimeout(() => { $('btn-copy').textContent = 'Copy invite link'; }, 2000); });
};
$('btn-again').onclick = () => {
    sfx.click();
    for (const p of H.players) p.ready = p.id === myId || p.bot;
    H.phase = 'lobby'; H.round = 0;
    emit({ t: 'toLobby', players: lobbyList(), settings: H.settings });
};
$('btn-howto').onclick = () => { sfx.click(); $('howto').classList.toggle('hidden'); };
const toggleQuality = () => { quality = quality === 'high' ? 'low' : 'high'; try { localStorage.setItem('blackoutQuality', quality); } catch (e) {} applyQuality(); sfx.click(); };
$('btn-quality').onclick = toggleQuality;
$('btn-quality2').onclick = toggleQuality;

function togglePause() {
    if (view === 'menu') return;
    paused = !paused && (view === 'game' || view === 'lobby' || view === 'results');
    $('pause').classList.toggle('hidden', !paused);
}
$('btn-menu').onclick = () => { sfx.click(); if (view === 'menu') location.href = '../projects.html'; else togglePause(); };
$('btn-resume').onclick = () => { paused = false; $('pause').classList.add('hidden'); };
$('btn-quit').onclick = () => { paused = false; $('pause').classList.add('hidden'); backToMenu(); };
$('btn-mute').onclick = () => {
    unlockAudio();
    const m = !isMuted(); setMuted(m);
    $('icon-sound').classList.toggle('hidden', m); $('icon-muted').classList.toggle('hidden', !m);
};
if (isMuted()) { $('icon-sound').classList.add('hidden'); $('icon-muted').classList.remove('hidden'); }

const params = new URLSearchParams(location.search);
if (params.has('room')) {
    const code = params.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    $('code').value = code;
    $('invite').textContent = `You've been invited to room ${code}. Enter your name and press Join.`;
    $('invite').classList.remove('hidden');
}

/* ── main loop ─────────────────────────────────────────── */
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;
    film.uniforms.uTime.value = T;
    if (view === 'game' || (view !== 'menu' && view !== 'lobby' && players.size)) {
        const frozen = paused && solo;
        if (!frozen) {
            if (role === 'host') hostTick(dt);
            localUpdate(dt);
        }
        updateVisuals(frozen ? 0 : dt);
    } else menuUpdate(dt);
    composer.render();
    requestAnimationFrame(frame);
}

// Boot: build the menu scene behind the loading screen
setTimeout(() => {
    setupMenuScene();
    $('loading').classList.add('hidden');
    requestAnimationFrame(frame);
}, 30);
document.addEventListener('pointerdown', () => { unlockAudio(); if (view === 'menu' || view === 'lobby') menuAmbience(); }, { once: true });

// Test hook for automated checks (harmless in normal play)
window.__blackout = { players, G, H, get me() { return me; }, get map() { return map; }, get view() { return view; }, camera, scene, renderer };
