// Tanks engine: rendering, arena grid, tanks, bullets, mines, effects, input, and the
// single-player campaign. Battle mode (js/main.js) plugs in through `hooks`.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLS, ROWS, LEVELS } from './maps.js?v=2';
import { sfx, audio, store, isMuted, setMuted } from './audio.js?v=2';

export { COLS, ROWS };

// ============================================================
// Config
// ============================================================
export const TANK_R = 0.38, BULLET_R = 0.1;
export const TURRET_Y = 0.47;

export const TYPES = {
    player: { color: 0x3b82f6, speed: 3.2, bulletSpeed: 7, bounces: 1, maxBullets: 5, cooldown: 0.22, turn: 7.5 },
    b: { color: 0xc08a52, speed: 0,   bulletSpeed: 4.5, bounces: 1, maxBullets: 1, cooldown: 2.6, turretTurn: 1.4, jitter: 0.22, smart: false, pref: 0 },
    g: { color: 0x9aa3b5, speed: 1.6, bulletSpeed: 5,   bounces: 1, maxBullets: 1, cooldown: 2.0, turretTurn: 2.0, jitter: 0.14, smart: false, pref: 7 },
    t: { color: 0x2bb3a6, speed: 1.3, bulletSpeed: 10,  bounces: 0, maxBullets: 1, cooldown: 2.4, turretTurn: 2.2, jitter: 0.05, smart: false, pref: 8 },
    r: { color: 0xe0584f, speed: 2.0, bulletSpeed: 6,   bounces: 1, maxBullets: 3, cooldown: 0.8, turretTurn: 3.0, jitter: 0.06, smart: true,  pref: 6 },
    k: { color: 0x3a3f4c, speed: 2.8, bulletSpeed: 10,  bounces: 1, maxBullets: 2, cooldown: 1.0, turretTurn: 3.5, jitter: 0.03, smart: true,  pref: 5 },
};

// ============================================================
// Helpers
// ============================================================
export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
// Remove dead entries in place (other modules hold references to these arrays)
function prune(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
}

// ============================================================
// Mode and hooks
// ============================================================
// mode: 'campaign' (also the idle backdrop behind the menus) or 'battle'
export let mode = 'campaign';
export function setMode(m) { mode = m; }
// Battle mode fills these in. The campaign never calls them.
export const hooks = {
    frame: null,      // (dt) per-frame battle update
    afterSync: null,  // (dt) after tank meshes are positioned
    escape: null,     // Esc / pause button during battle
    toMain: null,     // campaign menu "Back" / exit
    fired: null,      // (tank, bullet) a tank we simulate fired
    mined: null,      // (tank, mine) a tank we simulate laid a mine
    bulletHit: null,  // (tank, bullet) a bullet touched a tank; must remove the bullet
    blast: null,      // (tank, mine) a tank is inside a mine blast
    crate: null,      // (r, c) something wants to break this crate
    mineHit: null,    // (mine) a mine was shot, touched or timed out
    detonated: null,  // (mine) a mine exploded here
    killed: null,     // (tank) a tank was destroyed here
};

// ============================================================
// Renderer, scene, lights
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121619);

export const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xe6f6ff, 0x24332d, 1.0));
const sun = new THREE.DirectionalLight(0xfff6e8, 2.4);
sun.position.set(-7, 18, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const flashLight = new THREE.PointLight(0xff9a3c, 0, 7, 2);
scene.add(flashLight);

const levelGroup = new THREE.Group();
const fx = new THREE.Group();
scene.add(levelGroup, fx);

// ============================================================
// Textures and shared assets
// ============================================================
function canvasTexture(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
}

const floorTex = canvasTexture(256, (g, s) => {
    const h = s / 2;
    const cols = ['#3aa27c', '#379c77'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle = cols[(i + j) % 2];
        g.fillRect(i * h, j * h, h, h);
    }
    for (let n = 0; n < 2600; n++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, h, h);
    g.strokeRect(h, h, h, h);
    g.strokeRect(h, 0, h, h);
    g.strokeRect(0, h, h, h);
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set((COLS - 2) / 2, (ROWS - 2) / 2);

const woodTex = canvasTexture(128, (g, s) => {
    g.fillStyle = '#d4a064';
    g.fillRect(0, 0, s, s);
    const plank = s / 4;
    for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? 'rgba(120,70,20,0.10)' : 'rgba(255,230,190,0.08)';
        g.fillRect(0, i * plank, s, plank);
        g.fillStyle = 'rgba(90,50,15,0.45)';
        g.fillRect(0, i * plank, s, 2);
    }
    for (let n = 0; n < 60; n++) {
        g.strokeStyle = `rgba(110,65,25,${rand(0.05, 0.18)})`;
        g.lineWidth = 1;
        const y = Math.random() * s;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(s * 0.3, y + rand(-3, 3), s * 0.6, y + rand(-3, 3), s, y + rand(-2, 2));
        g.stroke();
    }
    g.strokeStyle = 'rgba(80,45,10,0.6)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, s, s);
});

const scorchTex = canvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(15,15,15,0.7)');
    grd.addColorStop(0.5, 'rgba(20,20,20,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
});

const mats = {
    block: new THREE.MeshStandardMaterial({ color: 0x626b80, roughness: 0.82 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x565e71, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.75 }),
    tread: new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.85 }),
    bullet: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c8, emissiveIntensity: 0.6, roughness: 0.3 }),
    rocket: new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xff8a2a, emissiveIntensity: 1.2, roughness: 0.3 }),
    scorch: new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false }),
    mine: new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.5, metalness: 0.2 }),
    mineLight: new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2a2a, emissiveIntensity: 0 }),
};

const geos = {
    // Plain boxes so neighbouring blocks join into seamless walls
    block: new THREE.BoxGeometry(1, 1, 1),
    wood: new RoundedBoxGeometry(0.94, 0.78, 0.94, 2, 0.05),
    hull: new RoundedBoxGeometry(0.78, 0.26, 0.62, 3, 0.08),
    tread: new RoundedBoxGeometry(0.86, 0.2, 0.18, 3, 0.07),
    turret: new THREE.CylinderGeometry(0.22, 0.25, 0.18, 28),
    hatch: new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20),
    barrel: new THREE.CylinderGeometry(0.055, 0.065, 0.5, 14),
    muzzle: new THREE.CylinderGeometry(0.075, 0.075, 0.08, 14),
    bullet: new THREE.CapsuleGeometry(0.07, 0.14, 4, 10),
    puff: new THREE.IcosahedronGeometry(0.12, 0),
    cube: new THREE.BoxGeometry(0.1, 0.1, 0.1),
    tread_mark: new THREE.PlaneGeometry(0.22, 0.07),
    scorch: new THREE.PlaneGeometry(1.5, 1.5),
    xbar: new THREE.BoxGeometry(0.7, 0.02, 0.09),
    mine: new THREE.CylinderGeometry(0.2, 0.22, 0.08, 24),
    mineLight: new THREE.SphereGeometry(0.05, 12, 8),
};

// Arena floor and base
const floor = new THREE.Mesh(new THREE.PlaneGeometry(COLS - 2, ROWS - 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const base = new THREE.Mesh(new RoundedBoxGeometry(COLS + 0.8, 0.8, ROWS + 0.8, 2, 0.2), new THREE.MeshStandardMaterial({ color: 0x1b2226, roughness: 0.9 }));
base.position.y = -0.41;
base.receiveShadow = true;
scene.add(base);

// Aim cursor
const cursor = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 36), new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.95, depthWrite: false }));
cursor.rotation.x = -Math.PI / 2;
cursor.position.y = 0.03;
scene.add(cursor);
export function setCursorColor(c) { cursor.material.color.set(c); }
// Aim line follows the real bullet path, including ricochets
const AIM_POINTS = 6;
const aimLineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: AIM_POINTS }, () => new THREE.Vector3()));
const aimLine = new THREE.Line(aimLineGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.14, gapSize: 0.14, transparent: true, opacity: 0.35 }));
scene.add(aimLine);

// ============================================================
// Sound toggle
// ============================================================
function syncMuteIcon() {
    $('icon-sound').classList.toggle('hidden', isMuted());
    $('icon-muted').classList.toggle('hidden', !isMuted());
}
syncMuteIcon();
$('mute').addEventListener('click', e => {
    setMuted(!isMuted());
    syncMuteIcon();
    e.currentTarget.blur();
});

// ============================================================
// Grid
// ============================================================
let grid = [];
const woodMeshes = new Map();
export const toCol = x => Math.floor(x + COLS / 2);
export const toRow = z => Math.floor(z + ROWS / 2);
export const cellX = c => c - COLS / 2 + 0.5;
export const cellZ = r => r - ROWS / 2 + 0.5;
export function cell(r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '#';
    return grid[r][c];
}
export const cellAt = (x, z) => cell(toRow(z), toCol(x));
export const isSolid = ch => ch === '#' || ch === 'w';
export const solidAt = (x, z) => isSolid(cellAt(x, z));
export const crateCount = () => woodMeshes.size;

export function circleBlocked(x, z, rad) {
    for (let r = toRow(z - rad); r <= toRow(z + rad); r++) {
        for (let c = toCol(x - rad); c <= toCol(x + rad); c++) {
            if (!isSolid(cell(r, c))) continue;
            const x0 = c - COLS / 2, z0 = r - ROWS / 2;
            const nx = clamp(x, x0, x0 + 1), nz = clamp(z, z0, z0 + 1);
            if ((x - nx) ** 2 + (z - nz) ** 2 < rad * rad) return true;
        }
    }
    return false;
}

export function lineClear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.1);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        if (solidAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
}

// Breadth-first search over open cells, used for enemy navigation
export function bfs(r0, c0) {
    const dist = new Int16Array(ROWS * COLS).fill(-1);
    const prev = new Int16Array(ROWS * COLS).fill(-1);
    const q = [r0 * COLS + c0];
    dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], r = Math.floor(i / COLS), c = i % COLS;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nr = r + dr, nc = c + dc, ni = nr * COLS + nc;
            if (isSolid(cell(nr, nc)) || dist[ni] !== -1) continue;
            dist[ni] = dist[i] + 1;
            prev[ni] = i;
            q.push(ni);
        }
    }
    return { dist, prev };
}

// ============================================================
// Effects: particles, tread marks, decals
// ============================================================
const particles = [], particlePool = [];
function spawnParticle(kind, x, y, z, o) {
    let p = particlePool.pop();
    if (!p) {
        p = { mesh: new THREE.Mesh(geos.puff, new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 0.9 })) };
    }
    const m = p.mesh;
    m.geometry = geos[kind];
    m.material.color.set(o.color);
    m.material.emissive.set(o.emissive ?? 0x000000);
    m.material.opacity = o.opacity ?? 1;
    m.castShadow = kind === 'cube';
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.max = o.life;
    p.grow = o.grow || 0;
    p.gravity = o.gravity || 0;
    p.scale = o.scale ?? 1;
    p.op = o.opacity ?? 1;
    p.spin = kind === 'cube' ? rand(-10, 10) : rand(-1, 1);
    m.scale.setScalar(p.scale);
    fx.add(m);
    particles.push(p);
}
function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i], m = p.mesh;
        p.life -= dt;
        if (p.life <= 0) {
            fx.remove(m);
            particlePool.push(p);
            particles.splice(i, 1);
            continue;
        }
        p.vy -= p.gravity * dt;
        m.position.x += p.vx * dt;
        m.position.y += p.vy * dt;
        m.position.z += p.vz * dt;
        if (p.gravity && m.position.y < 0.05) {
            m.position.y = 0.05;
            p.vy *= -0.35;
            p.vx *= 0.6;
            p.vz *= 0.6;
            p.spin *= 0.6;
        }
        m.rotation.x += p.spin * dt;
        m.rotation.y += p.spin * dt;
        const k = 1 - p.life / p.max;
        m.scale.setScalar(p.scale * (1 + p.grow * k));
        m.material.opacity = p.op * (p.gravity ? Math.min(1, p.life * 3) : 1 - k);
    }
}
function clearParticles() {
    for (const p of particles) { fx.remove(p.mesh); particlePool.push(p); }
    particles.length = 0;
}

const treads = [], treadPool = [];
export function spawnTread(x, z, angle) {
    for (const side of [-1, 1]) {
        let t = treads.length > 500 ? treads.shift() : treadPool.pop();
        if (!t) {
            t = { mesh: new THREE.Mesh(geos.tread_mark, new THREE.MeshBasicMaterial({ color: 0x0c2a1f, transparent: true, depthWrite: false })) };
            t.mesh.rotation.x = -Math.PI / 2;
        }
        const ox = -Math.sin(angle) * 0.3 * side, oz = Math.cos(angle) * 0.3 * side;
        t.mesh.position.set(x + ox, 0.011, z + oz);
        t.mesh.rotation.z = -angle;
        t.life = 5;
        fx.add(t.mesh);
        treads.push(t);
    }
}
function updateTreads(dt) {
    for (let i = treads.length - 1; i >= 0; i--) {
        const t = treads[i];
        t.life -= dt;
        if (t.life <= 0) {
            fx.remove(t.mesh);
            treadPool.push(t);
            treads.splice(i, 1);
        } else {
            t.mesh.material.opacity = 0.28 * Math.min(1, t.life / 2);
        }
    }
}
function clearTreads() {
    for (const t of treads) { fx.remove(t.mesh); treadPool.push(t); }
    treads.length = 0;
}

let flashT = 0;
function explosion(x, z, color, big) {
    spawnParticle('puff', x, 0.5, z, { color: 0xffc27a, emissive: 0xff7a1a, scale: big ? 5.5 : 3.5, grow: 1.4, life: 0.35 });
    for (let i = 0; i < (big ? 26 : 18); i++) {
        const a = Math.random() * Math.PI * 2, s = rand(1.5, 4.5);
        spawnParticle('cube', x, 0.4, z, {
            color: Math.random() < 0.7 ? color : 0x2a2e36,
            vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: rand(2.5, 6),
            gravity: 14, life: rand(1.2, 2.2), scale: rand(0.8, 1.6),
        });
    }
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(0.3, 1.2);
        spawnParticle('puff', x + Math.cos(a) * 0.2, rand(0.3, 0.7), z + Math.sin(a) * 0.2, {
            color: i < 5 ? 0xff9a3c : 0x4a4f57, emissive: i < 5 ? 0x7a2a00 : 0x000000,
            vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: rand(0.6, 1.6),
            scale: rand(1.6, 3), grow: 1.2, life: rand(0.7, 1.3), opacity: 0.85,
        });
    }
    const scorch = new THREE.Mesh(geos.scorch, mats.scorch);
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = Math.random() * Math.PI;
    scorch.position.set(x, 0.012, z);
    scorch.scale.setScalar(big ? 1.4 : 1);
    levelGroup.add(scorch);
    flashLight.position.set(x, 1.2, z);
    flashT = 0.35;
    sfx.boom();
}

// A small grey puff, used when a player disconnects and their tank is removed
export function vanishPuff(x, z) {
    for (let i = 0; i < 10; i++) {
        spawnParticle('puff', x + rand(-0.3, 0.3), rand(0.2, 0.6), z + rand(-0.3, 0.3), { color: 0xc8ced6, vy: rand(0.3, 0.9), scale: rand(1.5, 2.5), grow: 1, life: rand(0.5, 0.9), opacity: 0.7 });
    }
}

function markWreck(x, z, color) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(geos.xbar, mat);
        bar.position.set(x, 0.02, z);
        bar.rotation.y = a;
        levelGroup.add(bar);
    }
}

// ============================================================
// Tanks
// ============================================================
function buildTankMesh(color) {
    const c = new THREE.Color(color);
    const bodyMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.08 });
    const topMat = new THREE.MeshStandardMaterial({ color: c.clone().offsetHSL(0, 0, 0.07), roughness: 0.38, metalness: 0.08 });
    const darkMat = new THREE.MeshStandardMaterial({ color: c.clone().offsetHSL(0, -0.1, -0.12), roughness: 0.5 });

    const group = new THREE.Group();
    const hull = new THREE.Group();
    const h = new THREE.Mesh(geos.hull, bodyMat);
    h.position.y = 0.26;
    const t1 = new THREE.Mesh(geos.tread, mats.tread);
    t1.position.set(0, 0.12, 0.3);
    const t2 = t1.clone();
    t2.position.z = -0.3;
    hull.add(h, t1, t2);

    const turret = new THREE.Group();
    const dome = new THREE.Mesh(geos.turret, topMat);
    dome.position.y = 0.48;
    const hatch = new THREE.Mesh(geos.hatch, darkMat);
    hatch.position.set(-0.04, 0.59, 0);
    const barrelG = new THREE.Group();
    const barrel = new THREE.Mesh(geos.barrel, topMat);
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.set(0.33, TURRET_Y, 0);
    const muzzle = new THREE.Mesh(geos.muzzle, darkMat);
    muzzle.rotation.z = -Math.PI / 2;
    muzzle.position.set(0.58, TURRET_Y, 0);
    barrelG.add(barrel, muzzle);
    turret.add(dome, hatch, barrelG);

    group.add(hull, turret);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group, hull, turret, barrelG };
}

function makeTank(type, x, z, id) {
    const cfg = TYPES[type];
    const mesh = buildTankMesh(cfg.color);
    levelGroup.add(mesh.group);
    const facing = type === 'player' ? -Math.PI / 2 : Math.PI / 2;
    const t = {
        id, type, cfg, isPlayer: type === 'player',
        x, z, vx: 0, vz: 0, body: facing, turret_a: facing,
        ...mesh,
        alive: true,
        cooldown: type === 'player' ? 0 : rand(0.8, 1.8),
        recoil: 0, reverse: false, treadDist: 0,
        path: null, stuckT: 0, thinkT: rand(0, 0.4), aim: null,
        dodgeT: 0, dodgeA: 0, sweep: rand(0, 6),
    };
    syncTank(t);
    return t;
}

// Battle tanks: any colour, any config; added straight into the tank list
export function makeBattleTank({ id, color, cfg, x, z, facing, isPlayer }) {
    const mesh = buildTankMesh(color);
    levelGroup.add(mesh.group);
    const t = {
        id, type: 'battle', cfg: { ...cfg, color }, isPlayer: !!isPlayer,
        x, z, vx: 0, vz: 0, body: facing, turret_a: facing,
        ...mesh,
        alive: true,
        cooldown: 0,
        recoil: 0, reverse: false, treadDist: 0,
        path: null, stuckT: 0, thinkT: rand(0, 0.4), aim: null,
        dodgeT: 0, dodgeA: 0, sweep: rand(0, 6),
    };
    syncTank(t);
    tanks.push(t);
    return t;
}

// Take a tank out of the arena without an explosion (its player left)
export function removeTank(t) {
    t.alive = false;
    levelGroup.remove(t.group);
    const i = tanks.indexOf(t);
    if (i >= 0) tanks.splice(i, 1);
    if (player === t) player = null;
}

// The turret angle is turret_a; t.turret is the turret mesh group
export function syncTank(t) {
    t.group.position.set(t.x, 0, t.z);
    t.hull.rotation.y = -t.body;
    t.turret.rotation.y = -t.turret_a;
}

function tankBlocked(self, x, z) {
    for (const o of tanks) {
        if (o === self || !o.alive) continue;
        const nd = Math.hypot(o.x - x, o.z - z);
        if (nd < TANK_R * 2 && nd < Math.hypot(o.x - self.x, o.z - self.z)) return true;
    }
    return false;
}

export function moveTank(t, dx, dz) {
    const ox = t.x, oz = t.z;
    if (!circleBlocked(t.x + dx, t.z, TANK_R) && !tankBlocked(t, t.x + dx, t.z)) t.x += dx;
    if (!circleBlocked(t.x, t.z + dz, TANK_R) && !tankBlocked(t, t.x, t.z + dz)) t.z += dz;
    const moved = Math.hypot(t.x - ox, t.z - oz);
    t.treadDist += moved;
    if (t.treadDist > 0.2) {
        t.treadDist = 0;
        spawnTread(t.x, t.z, t.body);
    }
    return moved;
}

// ============================================================
// Game state
// ============================================================
// These arrays are shared with battle mode, so they are only ever mutated in place
export const tanks = [], bullets = [], mines = [];
export let player = null;
export let state = 'loading';
export function setPlayer(t) { player = t; }
export function setState(s) { state = s; }
let stateT = 0, pausedFrom = null;
let levelIndex = 0, lives = 3, killsTotal = 0;
const killedThisLevel = new Set();

function clearLevel() {
    while (levelGroup.children.length) levelGroup.remove(levelGroup.children[0]);
    for (const b of bullets) fx.remove(b.mesh);
    clearParticles();
    clearTreads();
    bullets.length = 0;
    mines.length = 0;
    tanks.length = 0;
    player = null;
    woodMeshes.clear();
}

function buildCell(r, c) {
    const ch = grid[r][c], x = cellX(c), z = cellZ(r);
    if (ch === '#') {
        const border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
        const m = new THREE.Mesh(geos.block, border ? mats.wall : mats.block);
        m.position.set(x, 0.5, z);
        m.castShadow = m.receiveShadow = true;
        levelGroup.add(m);
    } else if (ch === 'w') {
        const m = new THREE.Mesh(geos.wood, mats.wood);
        m.position.set(x, 0.39, z);
        m.rotation.y = (Math.floor(Math.random() * 4)) * Math.PI / 2;
        m.castShadow = m.receiveShadow = true;
        levelGroup.add(m);
        woodMeshes.set(r * COLS + c, m);
    }
}

function loadLevel() {
    clearLevel();
    const map = LEVELS[levelIndex];
    grid = map.map(row => [...row]);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c], x = cellX(c), z = cellZ(r);
            if (ch === '#' || ch === 'w') {
                buildCell(r, c);
            } else if (ch === 'P') {
                grid[r][c] = '.';
                player = makeTank('player', x, z, 'player');
            } else if (TYPES[ch]) {
                grid[r][c] = '.';
                const id = `${r},${c}`;
                if (!killedThisLevel.has(id)) tanks.push(makeTank(ch, x, z, id));
            }
        }
    }
    tanks.push(player);
    updateHud();
}

// Battle arena: walls and crates only. Returns the spawn points keyed '1'..'8'.
export function loadArena(map) {
    clearLevel();
    grid = map.map(row => [...row]);
    const spawns = {};
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            if (ch >= '1' && ch <= '8') {
                spawns[ch] = { x: cellX(c), z: cellZ(r) };
                grid[r][c] = '.';
            } else buildCell(r, c);
        }
    }
    return spawns;
}

const enemiesAlive = () => tanks.filter(t => !t.isPlayer && t.alive).length;

function updateHud() {
    $('lives').textContent = lives;
    $('level').textContent = `${levelIndex + 1}/${LEVELS.length}`;
    $('enemies').textContent = enemiesAlive();
}

// ============================================================
// Combat
// ============================================================
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

function addBullet(t, x, z, dx, dz, speed, bounces) {
    const rocket = speed > 8;
    const mesh = new THREE.Mesh(geos.bullet, rocket ? mats.rocket : mats.bullet);
    mesh.castShadow = true;
    mesh.position.set(x, TURRET_Y, z);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.set(dx, 0, dz));
    fx.add(mesh);
    const b = { x, z, vx: dx * speed, vz: dz * speed, bounces, owner: t, bounced: false, mesh, trailT: 0, age: 0, rocket };
    bullets.push(b);
    for (let i = 0; i < 5; i++) {
        spawnParticle('puff', x, TURRET_Y, z, {
            color: 0xe8e8e8, vx: dx * rand(0.5, 1.5) + rand(-0.4, 0.4), vz: dz * rand(0.5, 1.5) + rand(-0.4, 0.4), vy: rand(0.2, 0.6),
            scale: rand(0.7, 1.2), grow: 1.5, life: rand(0.3, 0.5), opacity: 0.7,
        });
    }
    if (t) t.recoil = 1;
    rocket ? sfx.rocket() : sfx.shoot();
    return b;
}

export function fire(t) {
    const cfg = t.cfg;
    if (t.cooldown > 0) return false;
    if (bullets.filter(b => b.owner === t).length >= cfg.maxBullets) return false;
    const dx = Math.cos(t.turret_a), dz = Math.sin(t.turret_a);
    const x = t.x + dx * 0.62, z = t.z + dz * 0.62;
    t.cooldown = t.isPlayer ? cfg.cooldown : cfg.cooldown * rand(0.7, 1.3);
    if (solidAt(x, z)) { sfx.fizzle(); return false; }
    const b = addBullet(t, x, z, dx, dz, cfg.bulletSpeed, cfg.bounces);
    if (mode === 'battle' && hooks.fired) hooks.fired(t, b);
    return true;
}

// A bullet someone else fired (battle mode)
export function spawnBullet(owner, x, z, vx, vz, bounces, id) {
    const speed = Math.hypot(vx, vz) || 1;
    const b = addBullet(owner, x, z, vx / speed, vz / speed, speed, bounces);
    b.id = id;
    return b;
}

export function removeBullet(b) {
    b.dead = true;
    fx.remove(b.mesh);
}

export function breakWood(r, c) {
    const key = r * COLS + c;
    const m = woodMeshes.get(key);
    if (!m) return false;
    grid[r][c] = '.';
    levelGroup.remove(m);
    woodMeshes.delete(key);
    const x = cellX(c), z = cellZ(r);
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(1, 3);
        spawnParticle('cube', x, 0.4, z, { color: 0xc8955a, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: rand(2, 4.5), gravity: 14, life: rand(1, 1.8), scale: rand(1, 2) });
    }
    for (let i = 0; i < 5; i++) {
        spawnParticle('puff', x, 0.4, z, { color: 0xd9c3a0, vy: rand(0.3, 0.8), vx: rand(-0.6, 0.6), vz: rand(-0.6, 0.6), scale: 2, grow: 1, life: 0.6, opacity: 0.6 });
    }
    sfx.crate();
    return true;
}

export function killTank(t) {
    if (!t.alive) return;
    t.alive = false;
    levelGroup.remove(t.group);
    explosion(t.x, t.z, t.cfg.color, false);
    markWreck(t.x, t.z, t.cfg.color);
    if (mode === 'battle') {
        if (hooks.killed) hooks.killed(t);
        return;
    }
    if (t.isPlayer) {
        lives--;
        state = 'dead';
        stateT = 2.2;
    } else {
        killedThisLevel.add(t.id);
        killsTotal++;
    }
    updateHud();
}

function sparks(x, z) {
    for (let i = 0; i < 4; i++) {
        spawnParticle('puff', x, TURRET_Y, z, { color: 0xfff1c8, emissive: 0xffb050, vx: rand(-1.5, 1.5), vz: rand(-1.5, 1.5), vy: rand(0, 1), scale: 0.4, life: 0.18 });
    }
}

export function updateBullets(dt) {
    const battle = mode === 'battle';
    const steps = 3, h = dt / steps;
    for (const b of bullets) {
        if (b.dead) continue;
        b.age += dt;
        if (b.age > 14) { removeBullet(b); continue; }
        for (let s = 0; s < steps && !b.dead; s++) {
            for (const axis of ['x', 'z']) {
                const nx = axis === 'x' ? b.x + b.vx * h : b.x;
                const nz = axis === 'z' ? b.z + b.vz * h : b.z;
                const r = toRow(nz), c = toCol(nx), ch = cell(r, c);
                if (ch === 'w') {
                    if (battle) hooks.crate(r, c); else breakWood(r, c);
                    removeBullet(b);
                    break;
                }
                if (ch === '#') {
                    if (b.bounces <= 0) {
                        sparks(b.x, b.z);
                        sfx.fizzle();
                        removeBullet(b);
                        break;
                    }
                    b.bounces--;
                    b.bounced = true;
                    if (axis === 'x') b.vx = -b.vx; else b.vz = -b.vz;
                    sparks(b.x, b.z);
                    sfx.bounce();
                } else {
                    b.x = nx;
                    b.z = nz;
                }
            }
            if (b.dead) break;
            for (const t of tanks) {
                if (!t.alive || (t === b.owner && !b.bounced)) continue;
                if (Math.hypot(t.x - b.x, t.z - b.z) < TANK_R + BULLET_R) {
                    if (battle) { hooks.bulletHit(t, b); break; }
                    removeBullet(b);
                    killTank(t);
                    break;
                }
            }
        }
        if (b.dead) continue;
        for (const m of mines) {
            if (!m.dead && Math.hypot(m.x - b.x, m.z - b.z) < 0.3) {
                removeBullet(b);
                if (battle) hooks.mineHit(m); else detonate(m);
                break;
            }
        }
        if (b.dead) continue;
        b.mesh.position.set(b.x, TURRET_Y, b.z);
        b.mesh.quaternion.setFromUnitVectors(UP, tmpV.set(b.vx, 0, b.vz).normalize());
        b.trailT -= dt;
        if (b.trailT <= 0) {
            b.trailT = b.rocket ? 0.025 : 0.045;
            spawnParticle('puff', b.x, TURRET_Y, b.z, {
                color: b.rocket ? 0xffb070 : 0xdddddd, emissive: b.rocket ? 0x803000 : 0x000000,
                vy: 0.25, scale: b.rocket ? 0.8 : 0.55, grow: 1.2, life: b.rocket ? 0.45 : 0.35, opacity: 0.55,
            });
        }
    }
    // Bullets that meet cancel each other out
    for (let i = 0; i < bullets.length; i++) {
        const a = bullets[i];
        if (a.dead) continue;
        for (let j = i + 1; j < bullets.length; j++) {
            const c = bullets[j];
            if (!c.dead && Math.hypot(a.x - c.x, a.z - c.z) < BULLET_R * 2.4) {
                sparks(a.x, a.z);
                sfx.fizzle();
                removeBullet(a);
                removeBullet(c);
                break;
            }
        }
    }
    prune(bullets);
}

// ---------- Mines ----------
function addMine(owner, x, z) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(geos.mine, mats.mine);
    body.position.y = 0.04;
    body.castShadow = true;
    const light = new THREE.Mesh(geos.mineLight, mats.mineLight.clone());
    light.position.y = 0.1;
    group.add(body, light);
    group.position.set(x, 0, z);
    levelGroup.add(group);
    const m = { x, z, owner, timer: 10, armT: 1.2, group, light, blink: 0, dead: false };
    mines.push(m);
    sfx.mine();
    return m;
}

export function layMine(t) {
    if (mines.filter(m => m.owner === t && !m.dead).length >= 2) return;
    if (mines.some(m => !m.dead && Math.hypot(m.x - t.x, m.z - t.z) < 0.6)) return;
    const m = addMine(t, t.x, t.z);
    if (mode === 'battle' && hooks.mined) hooks.mined(t, m);
}

// A mine someone else laid (battle mode)
export function spawnMine(owner, x, z, id) {
    const m = addMine(owner, x, z);
    m.id = id;
    return m;
}

export const MINE_R = 1.7;
export function detonate(m) {
    if (m.dead) return;
    m.dead = true;
    levelGroup.remove(m.group);
    explosion(m.x, m.z, 0xf2c14e, true);
    const R = MINE_R, battle = mode === 'battle';
    for (const t of tanks) {
        if (t.alive && Math.hypot(t.x - m.x, t.z - m.z) < R) {
            if (battle) hooks.blast(t, m); else killTank(t);
        }
    }
    for (let r = toRow(m.z - R); r <= toRow(m.z + R); r++) {
        for (let c = toCol(m.x - R); c <= toCol(m.x + R); c++) {
            if (cell(r, c) === 'w' && Math.hypot(cellX(c) - m.x, cellZ(r) - m.z) < R + 0.3) {
                if (battle) hooks.crate(r, c); else breakWood(r, c);
            }
        }
    }
    for (const b of bullets) if (!b.dead && Math.hypot(b.x - m.x, b.z - m.z) < R) removeBullet(b);
    if (battle && hooks.detonated) hooks.detonated(m);
    for (const o of mines) if (!o.dead && Math.hypot(o.x - m.x, o.z - m.z) < R) detonate(o);
}

export function updateMines(dt) {
    for (const m of mines) {
        if (m.dead) continue;
        m.timer -= dt;
        m.armT -= dt;
        const rate = m.timer < 3 ? 10 : 3;
        m.blink += dt * rate;
        const on = Math.sin(m.blink * Math.PI) > 0;
        m.light.material.emissiveIntensity = on ? 3 : 0.2;
        if (on && !m.wasOn && m.timer < 3) sfx.beep();
        m.wasOn = on;
        let trigger = m.timer <= 0;
        if (m.armT <= 0) {
            for (const t of tanks) {
                if (t.alive && t !== m.owner && Math.hypot(t.x - m.x, t.z - m.z) < 0.9) trigger = true;
            }
        }
        if (trigger) {
            if (mode === 'battle') hooks.mineHit(m); else detonate(m);
        }
    }
    prune(mines);
}

// ============================================================
// Player
// ============================================================
const keys = {};
const mouse = { ndc: new THREE.Vector2(0, -0.2), down: false, has: false };
const aimPoint = new THREE.Vector3(0, TURRET_Y, 0);
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TURRET_Y);

export function updatePlayer(dt) {
    const p = player;
    if (!p.alive) return;
    const cfg = p.cfg;

    // Screen-relative driving: W (or joystick up) is always "up" on screen
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    let throttle = 1;
    const joyMag = Math.hypot(joy.x, joy.y);
    if (joy.id !== null && joyMag > 0.18) {
        ix = joy.x;
        iz = joy.y;
        throttle = Math.min(1, joyMag);
    }
    const ox = p.x, oz = p.z;
    if (ix || iz) {
        const want = Math.atan2(iz, ix);
        const dF = angleDiff(p.body, want), dR = angleDiff(p.body, want + Math.PI);
        // Drive backwards instead of spinning around, with hysteresis so it doesn't flicker
        if (p.reverse ? Math.abs(dF) < Math.abs(dR) - 0.35 : Math.abs(dR) < Math.abs(dF) - 0.35) p.reverse = !p.reverse;
        const d = p.reverse ? dR : dF;
        const turn = clamp(d, -cfg.turn * dt, cfg.turn * dt);
        p.body += turn;
        const f = Math.max(0, Math.cos(d - turn)) ** 3 * throttle;
        const dir = p.reverse ? -1 : 1;
        moveTank(p, Math.cos(p.body) * cfg.speed * f * dir * dt, Math.sin(p.body) * cfg.speed * f * dir * dt);
    }
    p.vx = (p.x - ox) / dt;
    p.vz = (p.z - oz) / dt;

    if (mouse.has) {
        raycaster.setFromCamera(mouse.ndc, camera);
        if (raycaster.ray.intersectPlane(aimPlane, tmpV)) aimPoint.copy(tmpV);
        p.turret_a = Math.atan2(aimPoint.z - p.z, aimPoint.x - p.x);
    } else {
        // Nothing aimed yet (e.g. a phone before the first tap): face where we're driving
        p.turret_a = p.body + (p.reverse ? Math.PI : 0);
    }

    // A click always fires at least once, even if it was quicker than a frame
    if (mouse.down || clickShotT > 0) {
        if (fire(p)) clickShotT = 0;
        else clickShotT -= dt;
    }
    // A tap on touch screens queues one shot at the tapped spot
    if (tapShotT > 0) {
        tapShotT = fire(p) ? 0 : tapShotT - dt;
    }
}

// Let the player aim while a mission or round card is up
export function aimOnly() {
    if (!player || !player.alive || !mouse.has) return;
    raycaster.setFromCamera(mouse.ndc, camera);
    if (raycaster.ray.intersectPlane(aimPlane, tmpV)) aimPoint.copy(tmpV);
    player.turret_a = Math.atan2(aimPoint.z - player.z, aimPoint.x - player.x);
}

// ============================================================
// Enemy AI
// ============================================================
// Trace a shot through the arena. Returns what it would hit first.
function simulateShot(e, angle, bounces) {
    let vx = Math.cos(angle), vz = Math.sin(angle);
    let x = e.x + vx * 0.62, z = e.z + vz * 0.62;
    if (solidAt(x, z)) return null;
    let b = bounces, bounced = false, len = 0;
    const step = 0.12;
    while (len < 45) {
        let nx = x + vx * step;
        if (solidAt(nx, z)) {
            if (cellAt(nx, z) === 'w' || b <= 0) return { hit: 'wall', len };
            vx = -vx; b--; bounced = true;
        } else x = nx;
        let nz = z + vz * step;
        if (solidAt(x, nz)) {
            if (cellAt(x, nz) === 'w' || b <= 0) return { hit: 'wall', len };
            vz = -vz; b--; bounced = true;
        } else z = nz;
        len += step;
        if (player.alive && Math.hypot(player.x - x, player.z - z) < TANK_R + 0.06) return { hit: 'player', len, bounced };
        for (const o of tanks) {
            if (!o.alive || o.isPlayer) continue;
            if (o === e && !bounced) continue;
            if (Math.hypot(o.x - x, o.z - z) < TANK_R + 0.12) return { hit: 'ally', len };
        }
    }
    return { hit: 'none', len };
}

// Corner points of a shot's path, for the player's aim preview
function tracePath(t, angle, bounces, maxLen) {
    let vx = Math.cos(angle), vz = Math.sin(angle);
    let x = t.x + vx * 0.62, z = t.z + vz * 0.62;
    const pts = [{ x, z }];
    if (solidAt(x, z)) return pts;
    let len = 0;
    const step = 0.05;
    // Move one axis at a time, exactly like real bullets do
    const hit = (hx, hz) => {
        pts.push({ x, z });
        return bounces-- <= 0 || cellAt(hx, hz) === 'w' || pts.length >= AIM_POINTS;
    };
    while (len < maxLen) {
        const nx = x + vx * step;
        if (solidAt(nx, z)) { if (hit(nx, z)) return pts; vx = -vx; } else x = nx;
        const nz = z + vz * step;
        if (solidAt(x, nz)) { if (hit(x, nz)) return pts; vz = -vz; } else z = nz;
        len += step;
    }
    pts.push({ x, z });
    return pts;
}

function computeAim(e) {
    const cfg = e.cfg;
    if (!player.alive) return null;
    let tx = player.x, tz = player.z;
    if (cfg.smart) {
        const t = Math.hypot(tx - e.x, tz - e.z) / cfg.bulletSpeed;
        tx += player.vx * t * 0.8;
        tz += player.vz * t * 0.8;
    }
    const direct = Math.atan2(tz - e.z, tx - e.x);
    const r = simulateShot(e, direct, cfg.bounces);
    if (r && r.hit === 'player') return direct + rand(-0.5, 0.5) * cfg.jitter;

    // Look for a ricochet shot
    if (cfg.bounces > 0 && (cfg.smart || Math.random() < 0.3)) {
        let best = null, bestLen = Infinity;
        const off = Math.random() * 0.1;
        for (let i = 0; i < 96; i++) {
            const a = off + (i / 96) * Math.PI * 2;
            const s = simulateShot(e, a, cfg.bounces);
            if (s && s.hit === 'player' && s.len < bestLen) { best = a; bestLen = s.len; }
        }
        if (best !== null) return best + rand(-0.5, 0.5) * cfg.jitter * 0.5;
    }
    return null;
}

function pickPath(e) {
    const r0 = toRow(e.z), c0 = toCol(e.x);
    const { dist, prev } = bfs(r0, c0);
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < dist.length; i++) {
        const d = dist[i];
        if (d < 2 || d > 9) continue;
        const x = cellX(i % COLS), z = cellZ(Math.floor(i / COLS));
        const pd = player.alive ? Math.hypot(player.x - x, player.z - z) : 6;
        const score = -Math.abs(pd - e.cfg.pref) + rand(0, 3) - (mines.some(m => Math.hypot(m.x - x, m.z - z) < 2) ? 10 : 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    const path = [];
    for (let i = best; i !== -1 && dist[i] > 0; i = prev[i]) path.push({ x: cellX(i % COLS), z: cellZ(Math.floor(i / COLS)) });
    return path.reverse();
}

export function incomingBullet(e) {
    for (const b of bullets) {
        if (b.owner === e && !b.bounced) continue;
        const rx = e.x - b.x, rz = e.z - b.z;
        const v2 = b.vx * b.vx + b.vz * b.vz;
        const t = (rx * b.vx + rz * b.vz) / v2;
        if (t <= 0 || t > 0.7) continue;
        const cx = b.x + b.vx * t - e.x, cz = b.z + b.vz * t - e.z;
        if (Math.hypot(cx, cz) < 0.8) return b;
    }
    return null;
}

export function driveToward(e, angle, dt, allowReverse) {
    let d = angleDiff(e.body, angle), dir = 1;
    if (allowReverse && Math.abs(d) > Math.PI / 2) { d = angleDiff(e.body, angle + Math.PI); dir = -1; }
    const turn = clamp(d, -4.5 * dt, 4.5 * dt);
    e.body += turn;
    const f = Math.abs(d - turn) < 0.6 ? Math.cos(d - turn) : 0;
    if (f <= 0) return 0;
    const want = e.cfg.speed * f * dt;
    return moveTank(e, Math.cos(e.body) * want * dir, Math.sin(e.body) * want * dir) / Math.max(want, 1e-6);
}

function updateEnemy(e, dt) {
    const cfg = e.cfg;

    // Aiming
    e.thinkT -= dt;
    if (e.thinkT <= 0) {
        e.thinkT = rand(0.25, 0.45);
        e.aim = computeAim(e);
    }
    let target;
    if (e.aim !== null) target = e.aim;
    else {
        e.sweep += dt * 0.6;
        const toP = player.alive ? Math.atan2(player.z - e.z, player.x - e.x) : e.turret_a;
        target = toP + Math.sin(e.sweep) * 0.9;
    }
    const d = angleDiff(e.turret_a, target);
    e.turret_a += clamp(d, -cfg.turretTurn * dt, cfg.turretTurn * dt);
    if (e.aim !== null && Math.abs(angleDiff(e.turret_a, e.aim)) < 0.05 && e.cooldown <= 0) {
        const s = simulateShot(e, e.turret_a, cfg.bounces);
        if (s && s.hit !== 'ally' && (s.hit === 'player' || !cfg.smart)) fire(e);
    }

    // Movement
    if (cfg.speed <= 0) return;
    if (e.dodgeT > 0) {
        e.dodgeT -= dt;
        driveToward(e, e.dodgeA, dt, true);
        return;
    }
    if (cfg.smart || e.type === 'g') {
        const b = incomingBullet(e);
        if (b) {
            const perp = Math.atan2(b.vz, b.vx) + Math.PI / 2;
            const side = (e.x - b.x) * Math.cos(perp) + (e.z - b.z) * Math.sin(perp) >= 0 ? 0 : Math.PI;
            e.dodgeA = perp + side;
            e.dodgeT = 0.35;
            e.path = null;
            return;
        }
    }
    if (!e.path || e.path.length === 0) {
        e.path = pickPath(e);
        e.stuckT = 0;
        if (!e.path) return;
    }
    const wp = e.path[0];
    if (Math.hypot(wp.x - e.x, wp.z - e.z) < 0.15) {
        e.path.shift();
        return;
    }
    const progress = driveToward(e, Math.atan2(wp.z - e.z, wp.x - e.x), dt, false);
    if (progress < 0.2 && Math.abs(angleDiff(e.body, Math.atan2(wp.z - e.z, wp.x - e.x))) < 0.6) {
        e.stuckT += dt;
        if (e.stuckT > 0.6) e.path = null;
    } else e.stuckT = 0;
}

// ============================================================
// Flow: menus, banners, levels
// ============================================================
export function showBanner(kick, big, small) {
    $('banner-kick').textContent = kick;
    $('banner-big').textContent = big;
    $('banner-small').textContent = small || '';
    const el = $('banner');
    el.classList.add('hidden');
    void el.offsetWidth; // restart the pop animation
    el.classList.remove('hidden');
}
export const hideBanner = () => $('banner').classList.add('hidden');

function showMenu(kicker, title, text, button) {
    $('menu-kicker').textContent = kicker;
    $('menu-title').textContent = title;
    $('menu-text').textContent = text;
    $('play').textContent = button;
    const best = +(store.get('tanksBestMission') || 0);
    $('best').textContent = best ? `Best: mission ${best} of ${LEVELS.length}` : '';
    $('menu').classList.remove('hidden');
}

function recordBest(mission) {
    const best = +(store.get('tanksBestMission') || 0);
    if (mission > best) store.set('tanksBestMission', mission);
}

function beginIntro() {
    state = 'intro';
    stateT = 2.2;
    const n = enemiesAlive();
    showBanner('MISSION', String(levelIndex + 1), `Enemy tanks: ${n}`);
}

function startCampaign(startAt = 0) {
    $('menu').classList.add('hidden');
    audio();
    levelIndex = startAt;
    lives = 3;
    killsTotal = 0;
    killedThisLevel.clear();
    loadLevel();
    beginIntro();
}

function updateFlow(dt) {
    if (state === 'intro') {
        stateT -= dt;
        if (stateT <= 0) { state = 'play'; hideBanner(); }
    } else if (state === 'play') {
        if (enemiesAlive() === 0) {
            state = 'cleared';
            stateT = 2.4;
            const n = levelIndex + 1;
            recordBest(n);
            const bonus = n % 3 === 0 && n < LEVELS.length;
            if (bonus) { lives++; updateHud(); }
            showBanner('MISSION', 'CLEARED', bonus ? 'Bonus tank: +1 life' : `${killsTotal} tanks destroyed`);
        }
    } else if (state === 'dead') {
        stateT -= dt;
        if (stateT <= 0) {
            if (lives <= 0) {
                state = 'over';
                hideBanner();
                recordBest(levelIndex);
                showMenu('Game over', 'Destroyed', `You made it to mission ${levelIndex + 1} and destroyed ${killsTotal} tanks.`, 'Try again');
            } else {
                loadLevel();
                beginIntro();
            }
        }
    } else if (state === 'cleared') {
        stateT -= dt;
        if (stateT <= 0) {
            if (levelIndex + 1 >= LEVELS.length) {
                state = 'won';
                hideBanner();
                showMenu('Campaign complete', 'Victory', `All ${LEVELS.length} missions cleared with ${lives} ${lives === 1 ? 'life' : 'lives'} to spare and ${killsTotal} tanks destroyed.`, 'Play again');
            } else {
                levelIndex++;
                killedThisLevel.clear();
                loadLevel();
                beginIntro();
            }
        }
    }
}

function setPaused(on) {
    if (on && (state === 'play' || state === 'intro')) {
        pausedFrom = state;
        state = 'paused';
        $('pause').classList.remove('hidden');
    } else if (!on && state === 'paused') {
        state = pausedFrom;
        $('pause').classList.add('hidden');
    }
}

// Campaign entry points used by the main menu
export function openCampaignMenu() {
    mode = 'campaign';
    setCursorColor(0x7fb4ff);
    levelIndex = 0;
    killedThisLevel.clear();
    loadLevel();
    state = 'menu';
    hideBanner();
    showMenu('Campaign', 'TANKS', `Fight through ${LEVELS.length} missions. Bullets ricochet off walls, crates break apart, and every enemy colour fights differently.`, 'Start campaign');
}

// Leave the campaign (or battle) and put the idle campaign backdrop behind the main menu
export function showBackdrop() {
    mode = 'campaign';
    setCursorColor(0x7fb4ff);
    $('menu').classList.add('hidden');
    $('pause').classList.add('hidden');
    hideBanner();
    levelIndex = 0;
    killedThisLevel.clear();
    loadLevel();
    state = 'menu';
    clearInput();
}

// ============================================================
// Input
// ============================================================
addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
        if (mode === 'battle') { if (e.code === 'Escape' && hooks.escape) hooks.escape(); return; }
        if (state === 'menu' || state === 'over' || state === 'won') return;
        setPaused(state !== 'paused');
        return;
    }
    if (e.code === 'KeyM') { $('mute').click(); return; }
    keys[e.code] = true;
    if (state === 'play' && e.code === 'Space' && player && player.alive) layMine(player);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
export function clearInput() {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    touches.clear();
    resetJoy();
    tapShotT = clickShotT = 0;
}
addEventListener('blur', () => {
    clearInput();
    if (mode === 'campaign') setPaused(true);
});
function setMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    mouse.has = true;
}
canvas.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') setMouse(e); });
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    setMouse(e);
    if (e.button === 2) {
        if (state === 'play' && player && player.alive) layMine(player);
    } else {
        mouse.down = true;
        if (state === 'play') clickShotT = 0.35;
    }
});
addEventListener('pointerup', e => { if (e.pointerType !== 'touch' && e.button !== 2) mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- Touch: floating joystick + tap to shoot ----------
// The first finger down becomes a joystick centred where it landed.
// Any quick tap (with that finger or a second one) fires at the tapped spot.
const JOY_R = 55;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const touches = new Map();
let tapShotT = 0, clickShotT = 0;
const joyEl = $('joy'), knobEl = $('joy-knob');

function useTouchUi() {
    document.body.classList.add('touch');
}
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) useTouchUi();

function resetJoy() {
    joy.id = null;
    joy.x = joy.y = 0;
    joyEl.classList.remove('on');
    knobEl.style.transform = '';
}

canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    useTouchUi();
    e.preventDefault();
    audio();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
    if (joy.id === null) {
        joy.id = e.pointerId;
        joy.ox = e.clientX;
        joy.oy = e.clientY;
        joyEl.style.left = `${joy.ox}px`;
        joyEl.style.top = `${joy.oy}px`;
    }
});
canvas.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.moved = Math.max(t.moved, Math.hypot(e.clientX - t.x, e.clientY - t.y));
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    joy.x = dx / JOY_R;
    joy.y = dy / JOY_R;
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    // Only show the joystick once the finger actually drags, so taps don't flash it
    if (t.moved > 8) joyEl.classList.add('on');
});
function endTouch(e) {
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    const quick = performance.now() - t.t < 260 && t.moved < 14;
    if (quick && e.type === 'pointerup' && state === 'play') {
        setMouse(e);
        tapShotT = 0.35;
    }
    if (e.pointerId === joy.id) resetJoy();
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);

$('mine-btn').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state === 'play' && player && player.alive) layMine(player);
});
$('pause-btn').addEventListener('click', e => {
    if (mode === 'battle') { if (hooks.escape) hooks.escape(); }
    else setPaused(state !== 'paused');
    e.currentTarget.blur();
});

$('play').addEventListener('click', () => startCampaign(0));
$('resume').addEventListener('click', () => setPaused(false));
$('menu-back').addEventListener('click', () => { if (hooks.toMain) hooks.toMain(); });

// ============================================================
// Camera fitting and resize
// ============================================================
const camTarget = new THREE.Vector3(0, 0, 0.5);
function fitCamera() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const el = THREE.MathUtils.degToRad(57);
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    const corners = [];
    for (const x of [-COLS / 2 - 0.4, COLS / 2 + 0.4]) for (const z of [-ROWS / 2 - 0.4, ROWS / 2 + 0.4]) for (const y of [0, 1]) corners.push(new THREE.Vector3(x, y, z));
    let lo = 4, hi = 150;
    for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        camera.position.copy(camTarget).addScaledVector(dir, mid);
        camera.lookAt(camTarget);
        camera.updateMatrixWorld();
        const fits = corners.every(c => {
            const p = c.clone().project(camera);
            return Math.abs(p.x) < 0.97 && p.y > -0.97 && p.y < 0.82;
        });
        if (fits) hi = mid; else lo = mid;
    }
    camera.position.copy(camTarget).addScaledVector(dir, hi);
    camera.lookAt(camTarget);
}
addEventListener('resize', fitCamera);
fitCamera();

// World position to screen pixels, for name tags
const projV = new THREE.Vector3();
export function toScreen(x, y, z) {
    projV.set(x, y, z).project(camera);
    return { x: ((projV.x + 1) / 2) * innerWidth, y: ((1 - projV.y) / 2) * innerHeight };
}

// ============================================================
// Main loop
// ============================================================
function campaignStep(dt) {
    const active = state === 'play' || state === 'dead' || state === 'cleared';
    if (state === 'play') {
        for (const t of tanks) if (t.cooldown > 0) t.cooldown -= dt;
        updatePlayer(dt);
        for (const t of tanks) if (!t.isPlayer && t.alive) updateEnemy(t, dt);
        // Keep tanks from overlapping
        for (let i = 0; i < tanks.length; i++) for (let j = i + 1; j < tanks.length; j++) {
            const a = tanks[i], b = tanks[j];
            if (!a.alive || !b.alive) continue;
            const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
            if (d > 0 && d < TANK_R * 2) {
                const push = (TANK_R * 2 - d) / 2, nx = dx / d * push, nz = dz / d * push;
                if (!circleBlocked(a.x - nx, a.z - nz, TANK_R)) { a.x -= nx; a.z -= nz; }
                if (!circleBlocked(b.x + nx, b.z + nz, TANK_R)) { b.x += nx; b.z += nz; }
            }
        }
    } else if (state === 'intro' && player && player.alive && mouse.has) {
        aimOnly();
    }
    if (active) {
        updateBullets(dt);
        updateMines(dt);
        updateHud();
    }
}

let last = performance.now();
function frame(now) {
    // Battle runs in real time even on slow devices so every browser stays in step
    const dt = Math.min(mode === 'battle' ? 0.1 : 1 / 30, (now - last) / 1000);
    last = now;

    if (mode === 'battle') {
        if (hooks.frame) hooks.frame(dt);
    } else {
        campaignStep(dt);
    }
    if (state !== 'paused') {
        updateParticles(dt);
        updateTreads(dt);
        if (flashT > 0) flashT -= dt;
        flashLight.intensity = Math.max(0, flashT) * 90;
    }
    if (mode === 'campaign') updateFlow(state === 'paused' ? 0 : dt);

    for (const t of tanks) {
        if (!t.alive) continue;
        t.recoil = Math.max(0, t.recoil - dt * 6);
        t.barrelG.position.x = -t.recoil * 0.08;
        syncTank(t);
    }
    if (mode === 'battle' && hooks.afterSync) hooks.afterSync(dt);

    const aiming = (state === 'play' || state === 'intro') && player && player.alive;
    document.body.classList.toggle('playing', !!aiming);
    cursor.visible = aimLine.visible = !!aiming && mouse.has;
    if (cursor.visible) {
        cursor.position.set(aimPoint.x, 0.03, aimPoint.z);
        const pts = tracePath(player, player.turret_a, player.cfg.bounces, 11);
        const pos = aimLineGeo.attributes.position;
        pts.forEach((p, i) => pos.setXYZ(i, p.x, TURRET_Y, p.z));
        aimLineGeo.setDrawRange(0, pts.length);
        pos.needsUpdate = true;
        aimLineGeo.computeBoundingSphere();
        aimLine.computeLineDistances();
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ============================================================
// Boot. Returns true if the URL asked to jump straight into a campaign mission.
// ============================================================
export function boot() {
    $('loading').remove();
    loadLevel();
    const m = location.hash.match(/^#mission=(\d+)$/);
    requestAnimationFrame(frame);
    if (m) {
        startCampaign(clamp(+m[1] - 1, 0, LEVELS.length - 1));
        return true;
    }
    state = 'menu';
    return false;
}
