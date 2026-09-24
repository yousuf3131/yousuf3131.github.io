// Tag Royale: online multiplayer tag game.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=3';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=3';
import { play as playMusic } from './music.js?v=3';

// Analytics: no-op until ../js/analytics.js loads, and always a no-op when testing locally
const track = (name, params) => { if (window.track) window.track(name, params); };

const MAX_PLAYERS = 8;
const BEST_OF = 3;
const ROUND_TIME = 90;
const COUNTDOWN = 3;
const IT_HEAD_START = 2;   // taggers wait this long after GO so runners can scatter
const ROUND_GAP = 4500;
const ARENA_W = 40;
const ARENA_D = 30;
const WALK_SPEED = 10;
const SPRINT_SPEED = 16;
const ACCEL = 35;
const FRICTION = 22;
const DODGE_DIST = 8;
const DODGE_DUR = 0.25;
const DODGE_INVULN = 0.3;
const DODGE_CD = 3;
const TAG_RANGE = 1.5;
const GRACE_PERIOD = 1;
const STAMINA_DRAIN = 0.25;
const STAMINA_REGEN = 0.15;
const PLAYER_R = 0.55;
const SEND_EVERY = 0.05;
const POWERUP_INTERVAL = 12;
const STEP = 1 / 60;
// Red and green are kept out of the player palette so they only ever mean IT / survivor
const COLORS = ['#3b82f6', '#f97316', '#a78bfa', '#facc15', '#ec4899', '#f1f5f9', '#22d3ee', '#b45309'];
const BOT_NAMES = ['Shadow', 'Blitz', 'Phantom', 'Zippy', 'Dash', 'Bolt', 'Specter', 'Flash'];
const POWERUP_INFO = {
    speed: { color: '#3b82f6', label: 'Speed boost' },
    freeze: { color: '#22d3ee', label: 'Freeze taggers' },
    invis: { color: '#a78bfa', label: 'Invisible' },
};

const DEBUG = location.hash === '#debug';
const IS_TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ============================================================
// Three.js setup
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const scene = new THREE.Scene();
scene.background = canvasTexture(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#3f9be6');
    grd.addColorStop(0.6, '#9dd3f5');
    grd.addColorStop(1, '#e4f4ff');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(0xcfe8f5, 70, 150);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 300);
camera.position.set(0, 30, 30);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xdcefff, 0x8f7f55, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(14, 32, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 26, bottom: -26, near: 5, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
});

// Soft round glow and ring textures shared by auras, power-ups and markers
const glowTex = canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});
const ringTex = canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 34, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.45, 'rgba(255,255,255,1)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});

// ============================================================
// Particles: one pooled point cloud per blending mode
// ============================================================
class Particles {
    constructor(max, additive) {
        this.max = max;
        this.list = [];
        this.pos = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.alpha = new Float32Array(max);
        this.size = new Float32Array(max);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setDrawRange(0, 0);
        this.geo = geo;
        this.mat = new THREE.ShaderMaterial({
            uniforms: { scale: { value: 400 } },
            vertexShader: `
                attribute vec3 pcolor; attribute float palpha; attribute float psize;
                uniform float scale; varying vec3 vColor; varying float vAlpha;
                void main() {
                    vColor = pcolor; vAlpha = palpha;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = psize * scale / -mv.z;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                varying vec3 vColor; varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;
                    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.15, d));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.points = new THREE.Points(geo, this.mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = additive ? 5 : 4;
        scene.add(this.points);
    }
    spawn(x, y, z, vx, vy, vz, life, size, color, o = {}) {
        if (this.list.length >= this.max) return;
        this.list.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grow: o.grow || 0, grav: o.grav || 0, drag: o.drag || 0, a: o.alpha ?? 1 });
    }
    clear() { this.list.length = 0; this.geo.setDrawRange(0, 0); }
    update(dt, scale) {
        this.mat.uniforms.scale.value = scale;
        const L = this.list;
        let n = 0;
        for (let i = 0; i < L.length; i++) {
            const p = L[i];
            p.life -= dt;
            if (p.life <= 0) continue;
            const f = 1 - p.drag * dt;
            p.vx *= f; p.vz *= f; p.vy = p.vy * f + p.grav * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
            const k = p.life / p.max;
            this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
            this.col[n * 3] = p.color.r; this.col[n * 3 + 1] = p.color.g; this.col[n * 3 + 2] = p.color.b;
            this.alpha[n] = p.a * Math.min(1, k * 2.5);
            this.size[n] = Math.max(0.01, p.size * (1 + p.grow * (1 - k)));
            L[n++] = p;
        }
        L.length = n;
        for (const name of ['position', 'pcolor', 'palpha', 'psize']) this.geo.attributes[name].needsUpdate = true;
        this.geo.setDrawRange(0, n);
    }
}
// Additive for light streaks and sparkles; normal blending for dust and flames so they read on the light floor
const fxAdd = new Particles(900, true);
const fxDust = new Particles(1400, false);

// Expanding ground rings for tags and pickups
const rings = [];
const ringGeo = new THREE.PlaneGeometry(1, 1);
function spawnRing(x, z, color, size, life, additive = true) {
    const mat = new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const m = new THREE.Mesh(ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.08, z);
    scene.add(m);
    rings.push({ m, life, max: life, size });
}
function updateRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= dt;
        const k = 1 - r.life / r.max;
        r.m.scale.setScalar(0.5 + r.size * Math.sqrt(k));
        r.m.material.opacity = Math.max(0, 1 - k);
        if (r.life <= 0) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
}

const C = hex => new THREE.Color(hex);
const FIRE = [C(0xff3b1f), C(0xff7a1a), C(0xffc23a)];
const DUST = C(0xcdb58a);
const WHOOSH = C(0x9fd0ff);

function tagBurst(x, z, big) {
    const n = big ? 70 : 40;
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * (big ? 10 : 7);
        const sys = i % 3 ? fxDust : fxAdd;
        sys.spawn(x, 1 + Math.random(), z, Math.cos(a) * s, 3 + Math.random() * 6, Math.sin(a) * s, 0.5 + Math.random() * 0.5, 0.35 + Math.random() * 0.35, FIRE[i % 3], { grav: -14, drag: 2.5 });
    }
    spawnRing(x, z, 0xff2a10, big ? 9 : 6, 0.55, false);
}

function pickupBurst(x, z, hex) {
    const col = C(hex);
    for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
        fxAdd.spawn(x, 1 + Math.random() * 0.6, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.6, 0.35, col, { grav: -6, drag: 2 });
    }
    spawnRing(x, z, col, 5, 0.5);
}

// ============================================================
// Arena
// ============================================================
const WALLS = [
    // Symmetrical rectangular obstacles
    { x: -8, z: -6, w: 5, d: 0.6 },
    { x: 8, z: -6, w: 5, d: 0.6 },
    { x: -8, z: 6, w: 5, d: 0.6 },
    { x: 8, z: 6, w: 5, d: 0.6 },
    { x: 0, z: 0, w: 0.6, d: 4 },
    { x: -14, z: 0, w: 0.6, d: 3 },
    { x: 14, z: 0, w: 0.6, d: 3 },
];
const PILLARS = [
    { x: -15, z: -10, r: 0.8 },
    { x: 15, z: -10, r: 0.8 },
    { x: -15, z: 10, r: 0.8 },
    { x: 15, z: 10, r: 0.8 },
];

function floorTexture() {
    const PX = 32;  // canvas pixels per metre
    const tex = canvasTexture(ARENA_W * PX, ARENA_D * PX, (g, w, h) => {
        // Rubber playground tiles
        for (let x = 0; x < ARENA_W; x += 2) {
            for (let z = 0; z < ARENA_D; z += 2) {
                g.fillStyle = ((x + z) / 2) % 2 ? '#ecd8ae' : '#e5cf9f';
                g.fillRect(x * PX, z * PX, 2 * PX, 2 * PX);
            }
        }
        // Granule speckle
        for (let i = 0; i < 9000; i++) {
            g.fillStyle = Math.random() < 0.5 ? 'rgba(90,60,20,0.08)' : 'rgba(255,255,255,0.18)';
            g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
        const cx = w / 2, cz = h / 2;
        // Painted zones
        g.fillStyle = 'rgba(255,120,60,0.35)';
        g.beginPath(); g.arc(cx, cz, 5 * PX, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(60,140,230,0.28)';
        for (const [x, z, a] of [[0, 0, 0], [w, 0, 0.5], [w, h, 1], [0, h, 1.5]]) {
            g.beginPath(); g.moveTo(x, z); g.arc(x, z, 7 * PX, a * Math.PI, (a + 0.5) * Math.PI); g.closePath(); g.fill();
        }
        // Twister-style dots between the barriers
        const dots = ['#ef4444', '#3b82f6', '#facc15', '#22c55e'];
        for (let i = 0; i < 6; i++) {
            for (const zRow of [-11.5, 11.5]) {
                g.fillStyle = dots[(i + (zRow > 0 ? 2 : 0)) % 4];
                g.globalAlpha = 0.55;
                g.beginPath(); g.arc(cx + (i - 2.5) * 2.2 * PX, cz + zRow * PX, 0.7 * PX, 0, Math.PI * 2); g.fill();
            }
        }
        g.globalAlpha = 1;
        // White court lines
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 0.18 * PX;
        g.strokeRect(0.8 * PX, 0.8 * PX, w - 1.6 * PX, h - 1.6 * PX);
        g.beginPath(); g.arc(cx, cz, 5 * PX, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(cx, 0.8 * PX); g.lineTo(cx, cz - 5 * PX); g.moveTo(cx, cz + 5 * PX); g.lineTo(cx, h - 0.8 * PX); g.stroke();
        for (const [x, z, a] of [[0, 0, 0], [w, 0, 0.5], [w, h, 1], [0, h, 1.5]]) {
            g.beginPath(); g.arc(x, z, 7 * PX, a * Math.PI, (a + 0.5) * Math.PI); g.stroke();
        }
    });
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

function grassTexture() {
    const tex = canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#6cbf4f'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2500; i++) {
            g.fillStyle = Math.random() < 0.5 ? 'rgba(40,110,30,0.25)' : 'rgba(200,255,150,0.18)';
            g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
        }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    return tex;
}

function stripeTexture() {
    return canvasTexture(8, 128, (g, w, h) => {
        for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ef4444'; g.fillRect(0, (i * h) / 8, w, h / 8); }
    });
}

let seed = 11;
const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function buildArena() {
    const arena = new THREE.Group();
    const add = (geo, mat, x, y, z, shadow = true) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = shadow; m.receiveShadow = true;
        arena.add(m);
        return m;
    };

    // Grass surroundings and the rubber court
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.04; grass.receiveShadow = true;
    arena.add(grass);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    arena.add(floor);

    // Hedges: a box with leafy bumps along the top (bumps are instanced)
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2f8a3a, roughness: 0.95, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4caf4a, roughness: 0.9, flatShading: true });
    const bumps = [];
    const addHedge = (cx, cz, w, d, h, bs = 1) => {
        add(new THREE.BoxGeometry(w, h, d), hedgeMat, cx, h / 2, cz);
        const along = w >= d, len = along ? w : d, thick = along ? d : w;
        const n = Math.max(2, Math.round(len / (thick * 0.9 * bs)));
        for (let i = 0; i < n; i++) {
            const t = ((i + 0.5) / n - 0.5) * len;
            const r = thick * (0.6 + srand() * 0.12) * bs;
            bumps.push({ x: cx + (along ? t : 0), y: h - 0.02, z: cz + (along ? 0 : t), r });
        }
    };
    const T = 1.1, PH = 1.3;
    addHedge(0, -ARENA_D / 2 - T / 2, ARENA_W + 2 * T, T, PH);
    addHedge(0, ARENA_D / 2 + T / 2, ARENA_W + 2 * T, T, 0.4, 0.5);   // low on the camera side so it never hides a runner
    addHedge(-ARENA_W / 2 - T / 2, 0, T, ARENA_D, PH);
    addHedge(ARENA_W / 2 + T / 2, 0, T, ARENA_D, PH);

    // Interior: vertical walls are hedges, horizontal walls are painted barriers
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    for (const w of WALLS) {
        if (w.d > w.w) { addHedge(w.x, w.z, w.w + 0.2, w.d + 0.2, 1.6); continue; }
        add(new THREE.BoxGeometry(w.w, 1.3, w.d), barrierMat, w.x, 0.65, w.z);
        add(new THREE.BoxGeometry(w.w + 0.02, 0.16, w.d + 0.04), bandMat, w.x, 0.72, w.z, false);
        add(new THREE.BoxGeometry(w.w + 0.3, 0.24, w.d + 0.35), capMat, w.x, 1.42, w.z);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.3, 1.5, w.d + 0.45), capMat, w.x + s * (w.w / 2), 0.75, w.z);
    }
    const bumpMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leafMat, bumps.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    bumps.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), srand() * 6);
        mtx.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.r, b.r * 0.75, b.r));
        bumpMesh.setMatrixAt(i, mtx);
    });
    bumpMesh.castShadow = true; bumpMesh.receiveShadow = true;
    arena.add(bumpMesh);

    // Pillars: candy-striped posts with a ball on top
    const postMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.45 });
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
    for (const p of PILLARS) {
        add(new THREE.CylinderGeometry(p.r + 0.15, p.r + 0.25, 0.25, 24), baseMat, p.x, 0.12, p.z);
        add(new THREE.CylinderGeometry(p.r, p.r, 1.9, 24), postMat, p.x, 1.1, p.z);
        add(new THREE.SphereGeometry(p.r * 0.75, 20, 14), ballMat, p.x, 2.3, p.z);
    }

    // Trees and flower bushes around the park
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const leafMats = [0x3f9e42, 0x59b447, 0x2f8a3a, 0x78c24a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 8);
    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    const flowerMats = [0xf472b6, 0xc084fc, 0xffffff, 0xfb7185].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const flowerGeo = new THREE.SphereGeometry(0.5, 10, 8);
    let placed = 0;
    while (placed < 60) {
        const x = (srand() - 0.5) * 130, z = -70 + srand() * 90;
        if (Math.abs(x) < ARENA_W / 2 + 3 && Math.abs(z) < ARENA_D / 2 + 3) continue;
        if (z > ARENA_D / 2 - 4 && Math.abs(x) < 50) continue;   // nothing between the camera and the court
        const s = 1.4 + srand() * 1.4;
        const near = Math.abs(x) < 34 && Math.abs(z) < 28;
        add(trunkGeo, trunkMat, x, 1, z, near).scale.set(1, s * 0.8, 1);
        const crown = add(crownGeo, leafMats[placed % 4], x, 1.6 * s + 0.8, z, near);
        crown.scale.set(s * 1.3, s * 1.2, s * 1.3);
        crown.rotation.y = srand() * 6;
        placed++;
    }
    for (let i = 0; i < 40; i++) {
        const side = i % 4;
        const t = (srand() - 0.5);
        const x = side < 2 ? t * (ARENA_W + 4) : (side === 2 ? -1 : 1) * (ARENA_W / 2 + 2.2);
        const z = side < 2 ? (side === 0 ? -1 : 1) * (ARENA_D / 2 + 2.2) : t * (ARENA_D + 4);
        add(flowerGeo, flowerMats[i % 4], x, 0.3, z, false).scale.setScalar(0.5 + srand() * 0.4);
    }
    scene.add(arena);
}
buildArena();

// Collision against walls and pillars
function collideTerrain(x, z, r) {
    let nx = x, nz = z;
    // Arena bounds
    const hw = ARENA_W / 2 - r, hd = ARENA_D / 2 - r;
    nx = clamp(nx, -hw, hw);
    nz = clamp(nz, -hd, hd);
    // Interior walls (AABB)
    for (const w of WALLS) {
        const whalf = w.w / 2 + r, dhalf = w.d / 2 + r;
        const dx = nx - w.x, dz = nz - w.z;
        if (Math.abs(dx) < whalf && Math.abs(dz) < dhalf) {
            const overlapX = whalf - Math.abs(dx);
            const overlapZ = dhalf - Math.abs(dz);
            if (overlapX < overlapZ) nx += (dx > 0 ? overlapX : -overlapX);
            else nz += (dz > 0 ? overlapZ : -overlapZ);
        }
    }
    // Pillars (circle)
    for (const p of PILLARS) {
        const dx = nx - p.x, dz = nz - p.z;
        const dist = Math.hypot(dx, dz);
        const minD = p.r + r;
        if (dist < minD && dist > 0.01) {
            nx = p.x + (dx / dist) * minD;
            nz = p.z + (dz / dist) * minD;
        }
    }
    return { x: nx, z: nz };
}

// ============================================================
// Player models: small cartoon runners built from primitives
// ============================================================
const eyeGeo = new THREE.SphereGeometry(0.12, 12, 8);
const pupilGeo = new THREE.SphereGeometry(0.065, 10, 6);
const hornGeo = new THREE.ConeGeometry(0.13, 0.5, 10);
const IT_EMISSIVE = C(0xff2a10);
const ICE_EMISSIVE = C(0x49c6ff);

function makeLabelTexture(name, color, isMe, it) {
    return canvasTexture(512, 128, (g) => {
        g.font = '800 54px Inter, system-ui, sans-serif';
        const tw = Math.min(g.measureText(name).width, 390);
        const w = tw + 84, x0 = (512 - w) / 2;
        g.beginPath(); g.roundRect(x0, 16, w, 92, 46);
        g.fillStyle = it ? 'rgba(200,30,22,0.92)' : 'rgba(14,18,28,0.8)';
        g.fill();
        g.lineWidth = 7;
        g.strokeStyle = isMe ? '#ffffff' : (it ? 'rgba(255,190,170,0.8)' : 'rgba(255,255,255,0.25)');
        g.stroke();
        g.beginPath(); g.arc(x0 + 40, 62, 15, 0, Math.PI * 2);
        g.fillStyle = color; g.fill();
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
        g.fillStyle = '#ffffff';
        g.textBaseline = 'middle';
        g.fillText(name, x0 + 66, 64, 390);
    });
}

function buildPlayerModel(color, name, isMe) {
    const root = new THREE.Group();
    const base = C(color);
    const bodyMat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.5 });
    const limbMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: base.clone().lerp(C(0xffffff), 0.3), roughness: 0.45 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, emissive: 0xff2200, emissiveIntensity: 0.5, roughness: 0.4 });
    const meshes = [];
    const part = (geo, mat, parent, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        parent.add(m); meshes.push(m);
        return m;
    };

    const scaler = new THREE.Group();
    scaler.scale.setScalar(1.2);
    root.add(scaler);
    const rig = new THREE.Group();
    scaler.add(rig);
    part(new THREE.CapsuleGeometry(0.36, 0.4, 4, 14), bodyMat, rig, 0, 1.0, 0);
    const head = new THREE.Group();
    head.position.y = 1.72;
    rig.add(head);
    part(new THREE.SphereGeometry(0.44, 22, 16), headMat, head, 0, 0, 0);
    for (const s of [-1, 1]) {
        part(eyeGeo, eyeMat, head, s * 0.16, 0.06, 0.36).scale.z = 0.6;
        part(pupilGeo, pupilMat, head, s * 0.16, 0.06, 0.44);
    }
    const horns = new THREE.Group();
    for (const s of [-1, 1]) {
        const h = part(hornGeo, hornMat, horns, s * 0.26, 0.46, 0.02);
        h.rotation.z = -s * 0.5;
    }
    horns.visible = false;
    head.add(horns);

    const limb = (x, y, geo, dy) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        part(geo, limbMat, pivot, 0, dy, 0);
        rig.add(pivot);
        return pivot;
    };
    const armGeo = new THREE.CapsuleGeometry(0.1, 0.34, 4, 8);
    const legGeo = new THREE.CapsuleGeometry(0.13, 0.32, 4, 8);
    const arms = [limb(-0.46, 1.25, armGeo, -0.24), limb(0.46, 1.25, armGeo, -0.24)];
    const legs = [limb(-0.18, 0.64, legGeo, -0.3), limb(0.18, 0.64, legGeo, -0.3)];
    for (const leg of legs) part(new THREE.BoxGeometry(0.24, 0.12, 0.34), limbMat, leg, 0, -0.58, 0.06);

    // Team marker on the ground, red glow for IT, name label
    const markerMat = new THREE.MeshBasicMaterial({ map: ringTex, color: 0x16c060, transparent: true, depthWrite: false, opacity: 0.85 });
    const marker = new THREE.Mesh(ringGeo, markerMat);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.06;
    marker.scale.setScalar(isMe ? 2.6 : 2.2);
    root.add(marker);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a10, transparent: true, depthWrite: false, opacity: 0.4 });
    const glow = new THREE.Sprite(glowMat);
    glow.position.y = 1.2; glow.scale.setScalar(3);
    glow.visible = false;
    root.add(glow);

    const labelTex = [makeLabelTexture(name, color, isMe, false), makeLabelTexture(name, color, isMe, true)];
    const labelMat = new THREE.SpriteMaterial({ map: labelTex[0], transparent: true, depthTest: false });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(3.6, 0.9, 1);
    label.position.y = 3.05;
    label.renderOrder = 999;
    root.add(label);

    root.userData = {
        rig, head, horns, arms, legs, marker, markerMat, glow, glowMat, label, labelMat, labelTex, meshes,
        mats: [bodyMat, limbMat, headMat, eyeMat, pupilMat, hornMat], bodyMat, headMat,
        yaw: 0, yawRate: 0, phase: Math.random() * 6, itShown: null, alpha: 1,
        dustAcc: 0, fireAcc: 0,
    };
    return root;
}

function disposeModel(m) {
    scene.remove(m);
    m.traverse(o => {
        if (o.geometry && o.geometry !== eyeGeo && o.geometry !== pupilGeo && o.geometry !== hornGeo && o.geometry !== ringGeo) o.geometry.dispose();
    });
    for (const t of m.userData.labelTex || []) t.dispose();
}

// ============================================================
// Power-up models: floating icon badge, spinning halo, ground glow
// ============================================================
function drawPowerupIcon(g, type) {
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (type === 'speed') {
        g.beginPath();
        g.moveTo(74, 22); g.lineTo(38, 70); g.lineTo(62, 70); g.lineTo(52, 106); g.lineTo(92, 54); g.lineTo(66, 54); g.lineTo(78, 22);
        g.closePath(); g.fill();
    } else if (type === 'freeze') {
        g.lineWidth = 8;
        for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI) / 3;
            const dx = Math.cos(a) * 40, dy = Math.sin(a) * 40;
            g.beginPath(); g.moveTo(64 - dx, 64 - dy); g.lineTo(64 + dx, 64 + dy); g.stroke();
            for (const s of [-1, 1]) {
                const bx = 64 + s * dx * 0.6, by = 64 + s * dy * 0.6;
                for (const t of [-1, 1]) {
                    const b = a + t * 0.7 + (s < 0 ? Math.PI : 0);
                    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * 14, by + Math.sin(b) * 14); g.stroke();
                }
            }
        }
    } else {
        // Ghost
        g.beginPath();
        g.moveTo(34, 104); g.lineTo(34, 60); g.arc(64, 60, 30, Math.PI, 0); g.lineTo(94, 104);
        for (let i = 0; i < 4; i++) g.lineTo(94 - (i + 0.5) * 15, i % 2 ? 104 : 92), g.lineTo(94 - (i + 1) * 15, 104);
        g.closePath(); g.fill();
        g.fillStyle = POWERUP_INFO.invis.color;
        g.beginPath(); g.arc(53, 60, 7, 0, Math.PI * 2); g.arc(75, 60, 7, 0, Math.PI * 2); g.fill();
    }
}

function buildPowerupModel(type) {
    const info = POWERUP_INFO[type] || POWERUP_INFO.speed;
    const group = new THREE.Group();
    const iconTex = canvasTexture(128, 128, (g) => {
        g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2);
        g.fillStyle = info.color; g.fill();
        g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
        drawPowerupIcon(g, type);
    });
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex, transparent: true }));
    icon.scale.setScalar(1.3);
    icon.position.y = 1.3;
    group.add(icon);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 40), new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1.2 }));
    halo.position.y = 1.3;
    group.add(halo);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: info.color, transparent: true, depthWrite: false, opacity: 0.5 }));
    glow.scale.setScalar(3.2); glow.position.y = 1.3;
    group.add(glow);
    const pad = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: info.color, transparent: true, depthWrite: false, opacity: 0.8 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.05; pad.scale.setScalar(3);
    group.add(pad);
    group.userData = { icon, halo, glow, t: Math.random() * 6, color: info.color };
    return group;
}

const powerupModels = new Map();
function removePowerupModel(uid) {
    const m = powerupModels.get(uid);
    if (!m) return;
    pickupBurst(m.position.x, m.position.z, m.userData.color);
    scene.remove(m);
    powerupModels.delete(uid);
}

// ============================================================
// Game state
// ============================================================
let myName = (() => { try { return localStorage.getItem('tagName') || ''; } catch { return ''; } })();
let role = null;
let solo = false;
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';
let gameActive = false;
let sendTimer = 0;
let myReady = false;
let roundNum = 0;
let timeLeft = ROUND_TIME;   // seconds left in the round, shown by the HUD on every peer
let frozenT = 0;             // time left on a freeze power-up (taggers cannot move)
let countdownEnd = 0;
let countdownShown = -1;
let waitingChase = false;
let lastStsAt = 0;   // we are the starting tagger, waiting out the head start

const players = new Map();
let me = null;
let wantDodge = false;
let wantSprint = false;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    round: 0,
    roundTimer: 0,
    nextPowerup: POWERUP_INTERVAL,
    powerups: [],
    powerupUid: 0,
    frozenTimer: 0,
    gen: 0,   // bumped when a game ends or is abandoned so pending round timers do nothing
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
    document.body.classList.toggle('in-game', id === 'hud');
}

function setStatus(el, msg, err) { const s = $(el); s.textContent = msg; s.classList.toggle('error', !!err); }
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Messaging
// ============================================================
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
// Host events carry a sequence number so a copy delivered twice by the relay is ignored
let emitSeq = 0;
const seenSeq = new Set();
function emit(msg) {
    if (role === 'host') msg.q = ++emitSeq;
    if (role === 'host' && net) net.broadcast(msg);
    clientHandle(msg);
}

// ============================================================
// Host logic
// ============================================================
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            // The relay delivers at least once, so the same hello can arrive twice
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const used = new Set(H.players.map(p => p.color));
            const color = COLORS.find(c => !used.has(c)) || COLORS[0];
            H.players.push({ id: from, name: (msg.name || 'Player').slice(0, 14), color, ready: false, bot: false, score: 0, tags: 0 });
            if (net && from !== myId) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            if (from !== myId) { toast(`${msg.name || 'Player'} joined`); sfx.join(); }
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === from);
            if (p) { p.ready = !!msg.r; emitLobby(); }
            break;
        }
        case 'st': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && from !== myId) {
                p.x = msg.s[1]; p.z = msg.s[2]; p.vx = msg.s[3]; p.vz = msg.s[4]; p.h = msg.s[5];
                p.sprinting = !!msg.s[6];
            }
            break;
        }
        case 'dodge': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && p.dodgeCd <= 0) {
                p.dodging = true;
                p.dodgeT = DODGE_DUR;
                p.invulnT = DODGE_INVULN;
                p.dodgeCd = DODGE_CD;
                const spd = DODGE_DIST / DODGE_DUR;
                p.vx = msg.dx * spd;
                p.vz = msg.dz * spd;
                emit({ t: 'dodgeEvt', id: from, dx: msg.dx, dz: msg.dz });
            }
            break;
        }
    }
}

function hostLeave(id, how = 'left') {
    const idx = H.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const name = H.players[idx].name;
    H.players.splice(idx, 1);
    toast(`${name} ${how}`);
    if (H.phase === 'lobby') { emitLobby(); return; }
    emit({ t: 'left', id });
    // Someone has to be IT: if the last tagger left, pass it on
    if (gameActive && players.size >= 2 && ![...players.values()].some(p => p.it)) {
        const ids = [...players.keys()];
        const pick = ids[Math.floor(Math.random() * ids.length)];
        const p = players.get(pick);
        p.it = true; p.graceT = GRACE_PERIOD;
        emit({ t: 'tagged', tagger: null, target: pick });
    }
}

function rejectPeer(id, reason) {
    net.send(id, { t: 'reject', reason });
    setTimeout(() => net && net.kick(id), 600);
}

// Host removes someone from the lobby: bots just vanish, people are told why and disconnected
function kickPlayer(id) {
    const p = H.players.find(q => q.id === id);
    if (!p || p.id === myId || H.phase !== 'lobby') return;
    if (p.bot) { H.players.splice(H.players.indexOf(p), 1); emitLobby(); return; }
    if (!net || !confirm(`Remove ${p.name} from the room?`)) return;
    rejectPeer(id, 'The host removed you from the room.');
    hostLeave(id, 'was removed');
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, score: p.score, host: p.id === myId })) });
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const usedColors = new Set(H.players.map(p => p.color));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    const color = COLORS.find(c => !usedColors.has(c)) || COLORS[0];
    H.players.push({ id: botId, name, color, ready: true, bot: true, score: 0, tags: 0 });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 2) { setStatus('lobby-status', 'Need at least 2 players.', true); return; }
    const notReady = H.players.filter(p => !p.bot && p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }
    setStatus('lobby-status', '');
    H.phase = 'game';
    H.round = 0;
    H.gen++;
    for (const p of H.players) { p.score = 0; p.tags = 0; }
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot })) });
    hostNextRound();
}

function hostNextRound() {
    H.round++;
    H.roundTimer = ROUND_TIME;
    H.powerups = [];
    H.nextPowerup = POWERUP_INTERVAL;
    H.powerupUid = 0;
    H.frozenTimer = 0;

    const n = H.players.length;
    const itIdx = Math.floor(Math.random() * n);
    // Spawn on a ring in a shuffled order so the IT player starts somewhere different each round
    const slots = H.players.map((_, i) => i).sort(() => Math.random() - 0.5);
    const off = Math.random() * Math.PI * 2;
    const spawns = slots.map(i => {
        const a = off + (i / n) * Math.PI * 2;
        return collideTerrain(Math.cos(a) * 11, Math.sin(a) * 8.5, PLAYER_R + 0.3);
    });
    for (const p of H.players) p.tags = 0;

    emit({
        t: 'roundStart', round: H.round, bestOf: BEST_OF,
        spawns: H.players.map((p, i) => ({
            id: p.id, name: p.name, color: p.color, bot: p.bot,
            x: spawns[i].x, z: spawns[i].z,
            it: i === itIdx, score: p.score,
        })),
    });

    const gen = H.gen, round = H.round;
    setTimeout(() => { if (role === 'host' && H.gen === gen && H.round === round) emit({ t: 'go' }); }, COUNTDOWN * 1000);
}

function hostEndRound(reason) {
    gameActive = false;
    const survivors = [...players.entries()].filter(([, p]) => !p.it).map(([id]) => id);
    // Survivors get 3 points, everyone gets 1 point per tag they made this round
    for (const hp of H.players) {
        if (survivors.includes(hp.id)) hp.score += 3;
        hp.score += hp.tags;
    }
    emit({
        t: 'roundEnd', reason, survivors, round: H.round,
        scores: H.players.map(p => ({ id: p.id, name: p.name, score: p.score, color: p.color })),
    });
    const gen = H.gen;
    setTimeout(() => {
        if (role !== 'host' || H.gen !== gen) return;
        if (H.round >= BEST_OF) {
            H.phase = 'results';
            const sorted = [...H.players].sort((a, b) => b.score - a.score);
            emit({ t: 'results', list: sorted.map((p, i) => ({ id: p.id, name: p.name, score: p.score, place: i + 1, color: p.color })) });
        } else hostNextRound();
    }, ROUND_GAP);
}

function spawnPowerup() {
    const types = ['speed', 'freeze', 'invis'];
    const type = types[Math.floor(Math.random() * types.length)];
    // Find a free spot away from walls and players
    for (let tries = 0; tries < 25; tries++) {
        const x = (Math.random() - 0.5) * (ARENA_W - 6);
        const z = (Math.random() - 0.5) * (ARENA_D - 6);
        const c = collideTerrain(x, z, 1.2);
        if (Math.hypot(c.x - x, c.z - z) > 0.01) continue;
        if ([...players.values()].some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
        const pu = { uid: ++H.powerupUid, type, x, z };
        H.powerups.push(pu);
        emit({ t: 'powerup', ...pu });
        return;
    }
}

function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    H.roundTimer -= dt;
    timeLeft = Math.max(0, H.roundTimer);

    if (H.frozenTimer > 0) H.frozenTimer -= dt;
    frozenT = Math.max(0, H.frozenTimer);

    H.nextPowerup -= dt;
    if (H.nextPowerup <= 0) {
        H.nextPowerup = POWERUP_INTERVAL;
        if (H.powerups.length < 2) spawnPowerup();
    }

    for (const [id, p] of players) if (p.bot) botThink(id, p, dt);

    // Physics for all players (host authoritative)
    for (const [id, p] of players) {
        if (p.dodgeT > 0) { p.dodgeT -= dt; if (p.dodgeT <= 0) p.dodging = false; }
        if (p.invulnT > 0) p.invulnT -= dt;
        if (p.dodgeCd > 0) p.dodgeCd -= dt;
        if (p.graceT > 0) p.graceT -= dt;
        if (p.powerupT > 0) { p.powerupT -= dt; if (p.powerupT <= 0) p.powerup = null; }
        if (p.invisT > 0) { p.invisT -= dt; if (p.invisT <= 0) p.invisible = false; }

        // Frozen or waiting taggers cannot move
        if (p.holdT > 0) p.holdT -= dt;
        if (p.it && (p.holdT > 0 || (H.frozenTimer > 0 && !p.dodging))) { p.vx = p.vz = 0; p.sprinting = false; continue; }

        if (p.bot && !p.dodging) {
            const tx = p.botTargetX || 0, tz = p.botTargetZ || 0;
            const len = Math.hypot(tx, tz);
            if (len > 0.1) {
                p.vx += (tx / len) * ACCEL * dt;
                p.vz += (tz / len) * ACCEL * dt;
            }
            p.sprinting = p.botSprint && p.stamina > 0.05 && len > 0.1;
        }

        if (p.sprinting && !p.dodging) {
            p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
            if (p.stamina <= 0) p.sprinting = false;
        } else {
            p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * dt);
        }

        if (!p.dodging) {
            const maxSpd = (p.sprinting ? SPRINT_SPEED : WALK_SPEED) * (p.powerup === 'speed' ? 1.8 : 1);
            const speed = Math.hypot(p.vx, p.vz);
            if (speed > maxSpd) { p.vx *= maxSpd / speed; p.vz *= maxSpd / speed; }
            if (speed > 0.1) {
                const ns = Math.max(0, Math.min(speed, maxSpd) - FRICTION * dt);
                const s2 = Math.hypot(p.vx, p.vz);
                p.vx *= ns / s2; p.vz *= ns / s2;
            }
        }

        const col = collideTerrain(p.x + p.vx * dt, p.z + p.vz * dt, PLAYER_R);
        p.x = col.x; p.z = col.z;
        if (Math.hypot(p.vx, p.vz) > 0.5) p.h = Math.atan2(p.vz, p.vx);

        // Power-up pickup (survivors only)
        if (!p.it) {
            for (let i = H.powerups.length - 1; i >= 0; i--) {
                const pu = H.powerups[i];
                if (Math.hypot(p.x - pu.x, p.z - pu.z) >= 1.5) continue;
                H.powerups.splice(i, 1);
                if (pu.type === 'speed') {
                    p.powerup = 'speed'; p.powerupT = 4;
                    emit({ t: 'grabbed', uid: pu.uid, id, type: pu.type });
                } else if (pu.type === 'freeze') {
                    H.frozenTimer = 2.5;
                    emit({ t: 'freezeEvt', uid: pu.uid, id, dur: 2.5 });
                } else {
                    p.invisible = true; p.invisT = 3;
                    emit({ t: 'invisEvt', uid: pu.uid, id, dur: 3 });
                }
            }
        }
    }

    // Tagging check
    for (const [itId, itP] of players) {
        if (!itP.it || itP.holdT > 0 || (itP.tagged && itP.graceT > 0) || (H.frozenTimer > 0 && !itP.dodging)) continue;
        for (const [rId, rP] of players) {
            if (rId === itId || rP.it) continue;
            if (rP.invulnT > 0 || rP.invisible) continue;
            if (Math.hypot(itP.x - rP.x, itP.z - rP.z) < TAG_RANGE) {
                rP.it = true;
                rP.tagged = true;
                rP.graceT = GRACE_PERIOD;
                const hp = H.players.find(p => p.id === itId);
                if (hp) hp.tags++;
                emit({ t: 'tagged', tagger: itId, target: rId });
            }
        }
    }

    // Broadcast positions
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const states = [];
        for (const [id, p] of players) {
            states.push([id, +p.x.toFixed(2), +p.z.toFixed(2), +p.vx.toFixed(2), +p.vz.toFixed(2), +p.h.toFixed(2), p.it ? 1 : 0, p.sprinting ? 1 : 0, p.dodging ? 1 : 0, p.invisible ? 1 : 0]);
        }
        if (net) net.broadcast({ t: 'sts', a: states, timer: Math.round(timeLeft * 10) / 10, frozen: H.frozenTimer > 0 ? 1 : 0 });
    }

    // Round ends when the clock runs out (survivors win) or nobody is left to tag (taggers win)
    const survivors = [...players.values()].filter(p => !p.it).length;
    if (survivors === 0) hostEndRound('caught');
    else if (H.roundTimer <= 0) hostEndRound('time');
}

// ============================================================
// Bot AI (host only)
// ============================================================

// Does the segment a-b pass through an obstacle grown by pad? Returns the obstacle or null.
function segBlocked(ax, az, bx, bz, pad) {
    const dx = bx - ax, dz = bz - az;
    for (const w of WALLS) {
        let t0 = 0, t1 = 1, hit = true;
        for (const [a, d, lo, hi] of [[ax, dx, w.x - w.w / 2 - pad, w.x + w.w / 2 + pad], [az, dz, w.z - w.d / 2 - pad, w.z + w.d / 2 + pad]]) {
            if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) { hit = false; break; } continue; }
            let ta = (lo - a) / d, tb = (hi - a) / d;
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit) return w;
    }
    const len2 = dx * dx + dz * dz || 1e-9;
    for (const p of PILLARS) {
        const t = clamp(((p.x - ax) * dx + (p.z - az) * dz) / len2, 0, 1);
        if (Math.hypot(ax + dx * t - p.x, az + dz * t - p.z) < p.r + pad) return p;
    }
    return null;
}

// Waypoints just outside an obstacle's corners
function obstacleCorners(o, m) {
    if (o.w !== undefined) {
        const hx = o.w / 2 + m, hz = o.d / 2 + m;
        return [[o.x - hx, o.z - hz], [o.x + hx, o.z - hz], [o.x - hx, o.z + hz], [o.x + hx, o.z + hz]];
    }
    const out = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; out.push([o.x + Math.cos(a) * (o.r + m), o.z + Math.sin(a) * (o.r + m)]); }
    return out;
}

const inArena = (x, z, m) => Math.abs(x) < ARENA_W / 2 - m && Math.abs(z) < ARENA_D / 2 - m;

// Direction toward (tx, tz), going around the corner of whatever is in the way
function pathDir(p, tx, tz) {
    const blk = segBlocked(p.x, p.z, tx, tz, PLAYER_R * 0.8);
    let gx = tx, gz = tz;
    if (blk) {
        let best = Infinity;
        for (const [cx, cz] of obstacleCorners(blk, PLAYER_R + 0.6)) {
            if (!inArena(cx, cz, PLAYER_R)) continue;
            const d0 = Math.hypot(cx - p.x, cz - p.z);
            if (d0 < 0.4) continue;
            let cost = d0 + Math.hypot(tx - cx, tz - cz);
            if (segBlocked(p.x, p.z, cx, cz, PLAYER_R * 0.7)) cost += 25;
            if (p.botCorner && Math.hypot(p.botCorner[0] - cx, p.botCorner[1] - cz) < 0.1) cost -= 1.5;  // stick with a choice
            if (cost < best) { best = cost; gx = cx; gz = cz; }
        }
        p.botCorner = [gx, gz];
    } else p.botCorner = null;
    const len = Math.hypot(gx - p.x, gz - p.z) || 1;
    return [(gx - p.x) / len, (gz - p.z) / len];
}

function botThink(id, p, dt) {
    // Unstick: if the bot wants to move but has barely moved for a while, sidestep
    p.stuckClock = (p.stuckClock || 0) + dt;
    if (p.stuckClock > 0.5) {
        const moved = Math.hypot(p.x - (p.lastX ?? p.x), p.z - (p.lastZ ?? p.z));
        const wants = Math.hypot(p.botTargetX || 0, p.botTargetZ || 0) > 0.5;
        if (wants && moved < 0.8 && !(p.it && H.frozenTimer > 0) && !(p.unstickT > 0)) {
            const tx = p.botTargetX, tz = p.botTargetZ;
            // Pick whichever side has more room
            let best = null, bestRoom = -1;
            for (const s of [-1, 1]) {
                const dx = -tz * s, dz = tx * s;
                const c = collideTerrain(p.x + dx * 2.5, p.z + dz * 2.5, PLAYER_R);
                const room = Math.hypot(c.x - p.x, c.z - p.z) + Math.random() * 0.3;
                if (room > bestRoom) { bestRoom = room; best = [dx * 0.8 - tx * 0.3, dz * 0.8 - tz * 0.3]; }
            }
            p.unstickT = 0.6;
            p.unstickDir = best;
        }
        p.stuckClock = 0; p.lastX = p.x; p.lastZ = p.z;
    }
    if (p.unstickT > 0) {
        p.unstickT -= dt;
        p.botTargetX = p.unstickDir[0]; p.botTargetZ = p.unstickDir[1];
        return;
    }

    p.botThinkT -= dt;
    if (p.botThinkT > 0) return;
    p.botThinkT = p.it ? 0.2 + Math.random() * 0.15 : 0.12 + Math.random() * 0.12;

    if (p.it) botChase(id, p);
    else botFlee(id, p);
}

function botChase(id, p) {
    if (H.frozenTimer > 0 || p.holdT > 0) { p.botTargetX = p.botTargetZ = 0; p.botSprint = false; return; }
    // Keep chasing the current target unless another survivor is clearly closer
    let target = players.get(p.botPrey), best = Infinity;
    if (target && (target.it || target.invisible)) target = null;
    const curD = target ? Math.hypot(target.x - p.x, target.z - p.z) : Infinity;
    for (const [oid, op] of players) {
        if (oid === id || op.it || op.invisible) continue;
        const d = Math.hypot(op.x - p.x, op.z - p.z);
        if (d < best && d < curD * 0.7) { best = d; target = op; p.botPrey = oid; }
    }
    if (!target) {
        // Nobody visible: search where the prey was last seen, then roam
        if (!p.botSeen || Math.hypot(p.botSeen[0] - p.x, p.botSeen[1] - p.z) < 1.5) {
            p.botSeen = [(Math.random() - 0.5) * (ARENA_W - 8), (Math.random() - 0.5) * (ARENA_D - 8)];
        }
        [p.botTargetX, p.botTargetZ] = pathDir(p, p.botSeen[0], p.botSeen[1]);
        p.botSprint = false;
        return;
    }
    p.botSeen = [target.x, target.z];
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    // Lead the target a little
    const lead = clamp(d / 14, 0, 0.7);
    const ax = clamp(target.x + target.vx * lead, -ARENA_W / 2 + 1, ARENA_W / 2 - 1);
    const az = clamp(target.z + target.vz * lead, -ARENA_D / 2 + 1, ARENA_D / 2 - 1);
    const [dx, dz] = pathDir(p, ax, az);
    p.botTargetX = dx; p.botTargetZ = dz;
    p.botSprint = p.sprinting ? p.stamina > 0.05 && d < 10 : p.stamina > 0.45 && d < 6;
    // Lunge with a dodge when close and in the clear
    if (d < 2.8 && p.dodgeCd <= 0 && Math.random() < 0.2 && !segBlocked(p.x, p.z, target.x, target.z, 0.1)) {
        const l = Math.hypot(target.x - p.x, target.z - p.z) || 1;
        hostHandle(id, { t: 'dodge', dx: (target.x - p.x) / l, dz: (target.z - p.z) / l });
    }
}

function botFlee(id, p) {
    const threats = [...players.values()].filter(o => o.it && o !== p);
    let nearest = null, nd = Infinity;
    for (const o of threats) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < nd) { nd = d; nearest = o; } }

    // Grab a nearby power-up when it is safe to do so
    const pu = H.powerups.find(u => Math.hypot(u.x - p.x, u.z - p.z) < 8 && (!nearest || Math.hypot(u.x - nearest.x, u.z - nearest.z) > 5));
    if (pu && nd > 4) {
        [p.botTargetX, p.botTargetZ] = pathDir(p, pu.x, pu.z);
        p.botSprint = nd < 8;
        return;
    }

    if (!nearest || nd > 15) {
        // Relaxed: wander between random spots
        if (!p.botWander || Math.hypot(p.botWander[0] - p.x, p.botWander[1] - p.z) < 1.5 || Math.random() < 0.02) {
            p.botWander = [(Math.random() - 0.5) * (ARENA_W - 8), (Math.random() - 0.5) * (ARENA_D - 8)];
        }
        const [dx, dz] = pathDir(p, p.botWander[0], p.botWander[1]);
        p.botTargetX = dx * 0.6; p.botTargetZ = dz * 0.6;
        p.botSprint = false;
        return;
    }

    // Score 16 directions: far from taggers, away from edges and corners, behind cover, not into walls
    let best = -Infinity, bx = 0, bz = 0;
    const px = p.botPrevX || 0, pz = p.botPrevZ || 0;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const qx = p.x + dx * 4, qz = p.z + dz * 4;
        const q = collideTerrain(qx, qz, PLAYER_R);
        let score = 0;
        let minD = Infinity;
        for (const o of threats) {
            const d = Math.hypot(q.x - (o.x + o.vx * 0.3), q.z - (o.z + o.vz * 0.3));
            minD = Math.min(minD, d);
            score += Math.min(d, 16) / (1 + Math.hypot(o.x - p.x, o.z - p.z) * 0.15);
        }
        score += minD * 1.5;
        score -= Math.hypot(q.x - qx, q.z - qz) * 2.5;
        if (segBlocked(p.x, p.z, q.x, q.z, PLAYER_R * 0.8)) score -= 3;
        if (segBlocked(nearest.x, nearest.z, q.x, q.z, 0.2)) score += 2.5;
        const edge = Math.min(ARENA_W / 2 - Math.abs(q.x), ARENA_D / 2 - Math.abs(q.z));
        if (edge < 4) score -= (4 - edge) * 1.6;
        if (ARENA_W / 2 - Math.abs(q.x) < 5 && ARENA_D / 2 - Math.abs(q.z) < 5) score -= 4;
        score += (dx * px + dz * pz) * 1.2;
        score += Math.random() * 0.4;
        if (score > best) { best = score; bx = dx; bz = dz; }
    }
    p.botPrevX = bx; p.botPrevZ = bz;
    p.botTargetX = bx; p.botTargetZ = bz;
    p.botSprint = p.sprinting ? p.stamina > 0.02 && nd < 11 : nd < 8;

    // Dodge away when about to be caught
    const closing = ((p.x - nearest.x) * (nearest.vx - p.vx) + (p.z - nearest.z) * (nearest.vz - p.vz)) > 0;
    if (nd < 2.4 && closing && p.dodgeCd <= 0 && Math.random() < 0.6) {
        hostHandle(id, { t: 'dodge', dx: bx, dz: bz });
    }
}

// ============================================================
// Client logic
// ============================================================
function clearActors() {
    for (const p of players.values()) if (p.model) disposeModel(p.model);
    players.clear();
    me = null;
    for (const uid of [...powerupModels.keys()]) { scene.remove(powerupModels.get(uid)); powerupModels.delete(uid); }
    fxAdd.clear(); fxDust.clear();
    for (const r of rings) scene.remove(r.m);
    rings.length = 0;
}

function clientHandle(msg) {
    if (typeof msg.q === 'number') {
        if (seenSeq.has(msg.q)) return;
        seenSeq.add(msg.q);
    }
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; break;
        case 'reject': leave(msg.reason); return;
        case 'lobby': renderLobby(msg.players); break;
        case 'toast': toast(msg.text); break;
        case 'gameStart':
            view = 'game';
            show('hud');
            playMusic('game');
            break;
        case 'roundStart': {
            gameActive = false;
            clearActors();
            for (const s of msg.spawns) {
                const model = buildPlayerModel(s.color, s.name, s.id === myId);
                model.position.set(s.x, 0, s.z);
                scene.add(model);
                const h = Math.atan2(-s.z, -s.x);
                model.userData.yaw = -h + Math.PI / 2;
                const p = {
                    x: s.x, z: s.z, vx: 0, vz: 0, h,
                    it: s.it, tagged: false,
                    sprinting: false, stamina: 1,
                    dodging: false, dodgeT: 0, invulnT: 0, dodgeCd: 0,
                    graceT: 0, holdT: 0,
                    powerup: null, powerupT: 0,
                    invisible: false, invisT: 0,
                    model, bot: s.bot, name: s.name, color: s.color, score: s.score || 0,
                    botThinkT: 0, botTargetX: 0, botTargetZ: 0, botSprint: false,
                };
                players.set(s.id, p);
                if (s.id === myId) me = p;
            }
            roundNum = msg.round;
            timeLeft = ROUND_TIME;
            frozenT = 0;
            $('round-num').textContent = `${msg.round}/${BEST_OF}`;
            updateRoleBadge();
            hudDirty = true;
            snapCamera();
            countdownEnd = performance.now() + COUNTDOWN * 1000;
            countdownShown = -1;
            break;
        }
        case 'go':
            gameActive = true;
            for (const p of players.values()) if (p.it) p.holdT = IT_HEAD_START;
            waitingChase = !!(me && me.it);
            break;
        case 'sts':
            if (role === 'host') break;
            for (const s of msg.a) {
                const p = players.get(s[0]);
                if (!p) continue;
                if (p.it !== !!s[6]) { p.it = !!s[6]; hudDirty = true; if (p === me) updateRoleBadge(); }
                if (p === me) continue;
                p.x = s[1]; p.z = s[2]; p.vx = s[3]; p.vz = s[4]; p.h = s[5];
                p.sprinting = !!s[7]; p.dodging = !!s[8]; p.invisible = !!s[9];
            }
            if (typeof msg.timer === 'number') { timeLeft = msg.timer; lastStsAt = performance.now(); }
            if (!msg.frozen) frozenT = 0;
            else if (frozenT <= 0) frozenT = 0.2;
            break;
        case 'dodgeEvt': {
            const p = players.get(msg.id);
            if (p) {
                p.dodging = true; p.dodgeT = DODGE_DUR; p.invulnT = DODGE_INVULN;
                const spd = DODGE_DIST / DODGE_DUR;
                p.vx = msg.dx * spd; p.vz = msg.dz * spd;
            }
            if (p && msg.id !== myId && me && Math.hypot(p.x - me.x, p.z - me.z) < 18) sfx.dodge();
            break;
        }
        case 'tagged': onTagged(msg); break;
        case 'left': {
            const p = players.get(msg.id);
            if (p) { if (p.model) disposeModel(p.model); players.delete(msg.id); hudDirty = true; }
            break;
        }
        case 'powerup': {
            if (powerupModels.has(msg.uid)) break;
            const model = buildPowerupModel(msg.type);
            model.position.set(msg.x, 0, msg.z);
            scene.add(model);
            powerupModels.set(msg.uid, model);
            break;
        }
        case 'grabbed': {
            removePowerupModel(msg.uid);
            const p = players.get(msg.id);
            if (p) { p.powerup = msg.type; p.powerupT = 4; }
            if (msg.id === myId) { sfx.powerup(); centerMsg('SPEED BOOST', '', 'info', 1200); }
            break;
        }
        case 'freezeEvt': {
            removePowerupModel(msg.uid);
            frozenT = msg.dur;
            sfx.freeze();
            const who = players.get(msg.id);
            if (me && me.it) centerMsg('FROZEN!', `${who ? who.name : 'A survivor'} froze the taggers`, 'info', 1600);
            else toast(msg.id === myId ? 'You froze the taggers!' : `${who ? who.name : 'Someone'} froze the taggers!`);
            break;
        }
        case 'invisEvt': {
            removePowerupModel(msg.uid);
            const p = players.get(msg.id);
            if (p) { p.invisible = true; p.invisT = msg.dur; }
            if (msg.id === myId) { sfx.invisible(); centerMsg('INVISIBLE', 'Taggers cannot see or catch you', 'info', 1400); }
            break;
        }
        case 'roundEnd': onRoundEnd(msg); break;
        case 'results': showResults(msg.list); break;
        case 'toLobby':
            view = 'lobby';
            gameActive = false;
            myReady = false;
            $('btn-ready').textContent = 'Ready up';
            clearActors();
            show('lobby');
            playMusic('menu');
            break;
    }
}

function onTagged(msg) {
    const target = players.get(msg.target);
    const tagger = msg.tagger ? players.get(msg.tagger) : null;
    if (target) { target.it = true; target.tagged = true; target.graceT = GRACE_PERIOD; }
    const tName = target ? target.name : '?';
    const mine = msg.target === myId || msg.tagger === myId;
    if (target) {
        tagBurst(target.x, target.z, mine);
        if (me && !mine) shake(clamp(0.35 - Math.hypot(target.x - me.x, target.z - me.z) * 0.015, 0.05, 0.3));
    }
    if (msg.target === myId) {
        sfx.youreIt();
        centerMsg("YOU'RE IT!", tagger ? `${tagger.name} tagged you - now chase the others` : 'Chase the survivors!', 'it', 2400);
        flash('it');
        shake(1.1);
        updateRoleBadge();
    } else if (msg.tagger === myId) {
        sfx.hit();
        centerMsg(`YOU TAGGED ${tName.toUpperCase()}`, 'They are chasing with you now', 'good', 1800);
        flash('hit');
        shake(0.6);
    } else {
        sfx.tag();
        toast(tagger ? `${tagger.name} tagged ${tName}` : `${tName} is now IT`);
    }
    hudDirty = true;
}

function onRoundEnd(msg) {
    gameActive = false;
    countdownEnd = 0;
    if (msg.reason === 'time') timeLeft = 0;
    for (const s of msg.scores) { const p = players.get(s.id); if (p) p.score = s.score; }
    hudDirty = true;
    const iSurvived = msg.survivors.includes(myId);
    const names = msg.survivors.map(id => players.get(id)?.name).filter(Boolean);
    const last = msg.round >= BEST_OF ? 'Final round over' : `Round ${msg.round + 1} starts soon`;
    if (msg.reason === 'time') {
        const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
        centerMsg('SURVIVORS WIN', iSurvived ? `You survived! +3 points. ${last}` : `${list} survived. ${last}`, iSurvived ? 'good' : 'it', ROUND_GAP - 300);
    } else {
        centerMsg('TAGGERS WIN', `Everyone was caught. ${last}`, 'it', ROUND_GAP - 300);
    }
    if (iSurvived || (msg.reason === 'caught' && me)) sfx.win(); else sfx.lose();
}

// ============================================================
// HUD helpers
// ============================================================
let cmTimer = 0;
function centerMsg(main, sub = '', cls = '', ms = 1800) {
    const el = $('center-msg');
    el.className = '';
    el.innerHTML = `<div class="cm-main">${esc(main)}</div>${sub ? `<div class="cm-sub">${esc(sub)}</div>` : ''}`;
    void el.offsetWidth;  // restart the pop animation
    el.className = `show ${cls}`;
    clearTimeout(cmTimer);
    if (ms) cmTimer = setTimeout(() => { el.className = ''; el.innerHTML = ''; }, ms);
}

function flash(kind) {
    const el = $('flash');
    el.className = '';
    void el.offsetWidth;
    el.className = kind;
}

function updateRoleBadge() {
    if (!me) return;
    const badge = $('role-badge');
    badge.textContent = me.it ? "YOU'RE IT" : 'RUN!';
    badge.className = 'role-badge ' + (me.it ? 'tagger' : 'runner');
}

let hudDirty = true;
let chipSig = '';
function updateChips() {
    const list = [...players.entries()];
    const sig = list.map(([id, p]) => `${id}${p.it ? 1 : 0}${p.score}`).join('|');
    if (!hudDirty && sig === chipSig) return;
    hudDirty = false; chipSig = sig;
    const survivors = list.filter(([, p]) => !p.it).length;
    $('survivor-count').innerHTML = `<b class="safe">${survivors}</b> left <b class="it">${list.length - survivors}</b> IT`;
    // Survivors first, then taggers; each chip shows colour, name and score
    list.sort((a, b) => (a[1].it - b[1].it) || (b[1].score - a[1].score));
    $('player-tags').innerHTML = list.map(([id, p]) =>
        `<span class="ptag ${p.it ? 'it' : 'safe'}${id === myId ? ' me' : ''}"><i style="background:${p.color}"></i><b>${esc(p.name)}</b><em>${p.score}</em></span>`).join('');
}

let lastTickSec = -1;
function updateTimer() {
    const secs = Math.max(0, Math.ceil(timeLeft - 1e-6));
    const el = $('timer');
    if (el.textContent !== String(secs)) {
        el.textContent = secs;
        $('timer-box').classList.toggle('low', secs <= 10 && gameActive);
        if (gameActive && secs <= 10 && secs > 0 && secs !== lastTickSec) sfx.tick();
        lastTickSec = secs;
    }
}

function updateCountdown(now) {
    if (!countdownEnd) return;
    const left = (countdownEnd - now) / 1000;
    if (left > 0) {
        const n = Math.ceil(left);
        if (n !== countdownShown) {
            countdownShown = n;
            const sub = `Round ${roundNum} of ${BEST_OF} - ${me && me.it ? 'you are IT' : 'you are a survivor'}`;
            centerMsg(String(n), sub, me && me.it ? 'it count' : 'count', 0);
            sfx.count();
        }
    } else {
        countdownEnd = 0;
        countdownShown = -1;
        if (me && me.it) centerMsg('WAIT...', 'Runners get a 2 second head start', 'it', 0);
        else centerMsg('GO!', 'Run! Survive until the clock hits 0', 'good', 1600);
        sfx.go();
    }
}

// Arrow at the screen edge pointing at the nearest threat (or prey when you are IT)
const tmpV = new THREE.Vector3();
function updateIndicator() {
    const el = $('offarrow');
    let target = null, best = Infinity;
    if (me && (gameActive || countdownEnd)) {
        for (const p of players.values()) {
            if (p === me || p.it === me.it || (me.it && p.invisible)) continue;
            const d = Math.hypot(p.x - me.x, p.z - me.z);
            if (d < best) { best = d; target = p; }
        }
    }
    if (!target) { el.style.display = 'none'; return; }
    tmpV.set(target.model.position.x, 1, target.model.position.z).project(camera);
    let dx = tmpV.x, dy = tmpV.y;
    if (tmpV.z < 1 && Math.abs(dx) < 0.95 && Math.abs(dy) < 0.92) { el.style.display = 'none'; return; }
    if (tmpV.z > 1) { dx = -dx; dy = -dy; }
    const W = innerWidth, Hh = innerHeight;
    let sx = dx * W / 2, sy = -dy * Hh / 2;
    const m = 34;
    const k = Math.min((W / 2 - m) / Math.max(Math.abs(sx), 1e-6), (Hh / 2 - m) / Math.max(Math.abs(sy), 1e-6));
    sx *= k; sy *= k;
    el.style.display = 'flex';
    el.style.transform = `translate(${W / 2 + sx}px, ${Hh / 2 + sy}px)`;
    el.className = me.it ? 'prey' : 'threat';
    $('offarrow-rot').style.transform = `rotate(${Math.atan2(sy, sx)}rad)`;
    $('offarrow-d').textContent = `${Math.round(best)}m`;
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (view === 'game' && e.code === 'Space') wantDodge = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// Touch joystick
const JOY_R = 55;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function resetJoy() { joy.id = null; joy.x = joy.y = 0; $('joy').classList.remove('on'); $('joy-knob').style.transform = ''; }
if (IS_TOUCH) document.body.classList.add('touch');
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    e.preventDefault();
    if (joy.id !== null || view !== 'game') return;
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
    const j = $('joy'); j.style.left = `${joy.ox}px`; j.style.top = `${joy.oy}px`; j.classList.add('on');
});
canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    joy.x = dx / JOY_R; joy.y = dy / JOY_R;
    $('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
});
const endJoy = e => { if (e.pointerId === joy.id) resetJoy(); };
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

// Touch buttons
$('touch-dodge').addEventListener('pointerdown', e => { e.preventDefault(); wantDodge = true; });
let sprintTouchId = null;
$('touch-sprint').addEventListener('pointerdown', e => { e.preventDefault(); sprintTouchId = e.pointerId; wantSprint = true; });
addEventListener('pointerup', e => { if (e.pointerId === sprintTouchId) { sprintTouchId = null; wantSprint = false; } });
addEventListener('pointercancel', e => { if (e.pointerId === sprintTouchId) { sprintTouchId = null; wantSprint = false; } });

function playerInput() {
    // The camera looks down the -z axis, so screen up is world -z
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (document.body.classList.contains('touch') && joy.id !== null) {
        ix = joy.x; iz = joy.y;
    }
    const sprint = keys.ShiftLeft || keys.ShiftRight || wantSprint;
    return { ix, iz, sprint };
}

// ============================================================
// Game loop
// ============================================================
function updateGame(dt) {
    if (!gameActive) { wantDodge = false; return; }

    if (role === 'host') hostUpdate(dt);
    else {
        // Count down between host updates, but stop if they stop coming (round over, or a stall)
        if (performance.now() - lastStsAt < 600) timeLeft = Math.max(0, timeLeft - dt);
        if (frozenT > 0) frozenT = Math.max(0, frozenT - dt);
    }
    if (!gameActive || !me) { wantDodge = false; return; }

    const { ix, iz, sprint } = playerInput();
    const inputLen = Math.hypot(ix, iz);
    // The host's physics loop already counts down its own runner's hold
    if (me.holdT > 0 && role !== 'host') me.holdT -= dt;
    if (waitingChase && !(me.holdT > 0)) {
        waitingChase = false;
        if (me.it) { centerMsg('CHASE!', 'Tag every runner', 'it', 1200); sfx.go(); }
    }
    const frozen = me.it && ((frozenT > 0 && !me.dodging) || me.holdT > 0);

    if (inputLen > 0.15 && !me.dodging && !frozen) {
        me.vx += (ix / inputLen) * ACCEL * dt;
        me.vz += (iz / inputLen) * ACCEL * dt;
    }
    me.sprinting = sprint && inputLen > 0.15 && me.stamina > 0 && !frozen;

    if (wantDodge && me.dodgeCd <= 0 && !frozen) {
        const dx = inputLen > 0.15 ? ix / inputLen : Math.cos(me.h);
        const dz = inputLen > 0.15 ? iz / inputLen : Math.sin(me.h);
        act({ t: 'dodge', dx, dz });
        sfx.dodge();
        if (role !== 'host') {
            me.dodging = true; me.dodgeT = DODGE_DUR; me.invulnT = DODGE_INVULN; me.dodgeCd = DODGE_CD;
            const spd = DODGE_DIST / DODGE_DUR;
            me.vx = dx * spd; me.vz = dz * spd;
        }
    }
    wantDodge = false;

    // Client-side prediction for our own runner
    if (role !== 'host') {
        if (me.dodgeT > 0) { me.dodgeT -= dt; if (me.dodgeT <= 0) me.dodging = false; }
        if (me.invulnT > 0) me.invulnT -= dt;
        if (me.dodgeCd > 0) me.dodgeCd -= dt;
        if (me.graceT > 0) me.graceT -= dt;
        if (me.sprinting && !me.dodging) {
            me.stamina = Math.max(0, me.stamina - STAMINA_DRAIN * dt);
            if (me.stamina <= 0) me.sprinting = false;
        } else {
            me.stamina = Math.min(1, me.stamina + STAMINA_REGEN * dt);
        }
        if (frozen) { me.vx = me.vz = 0; }
        if (!me.dodging) {
            const maxSpd = (me.sprinting ? SPRINT_SPEED : WALK_SPEED) * (me.powerup === 'speed' ? 1.8 : 1);
            const speed = Math.hypot(me.vx, me.vz);
            if (speed > maxSpd) { me.vx *= maxSpd / speed; me.vz *= maxSpd / speed; }
            if (speed > 0.1) {
                const ns = Math.max(0, Math.min(speed, maxSpd) - FRICTION * dt);
                const s2 = Math.hypot(me.vx, me.vz);
                me.vx *= ns / s2; me.vz *= ns / s2;
            }
        }
        const col = collideTerrain(me.x + me.vx * dt, me.z + me.vz * dt, PLAYER_R);
        me.x = col.x; me.z = col.z;
        if (Math.hypot(me.vx, me.vz) > 0.5) me.h = Math.atan2(me.vz, me.vx);
        if (me.powerupT > 0) { me.powerupT -= dt; if (me.powerupT <= 0) me.powerup = null; }
        if (me.invisT > 0) { me.invisT -= dt; if (me.invisT <= 0) me.invisible = false; }

        sendTimer -= dt;
        if (sendTimer <= 0) {
            sendTimer = SEND_EVERY;
            act({ t: 'st', s: [myId, +me.x.toFixed(2), +me.z.toFixed(2), +me.vx.toFixed(2), +me.vz.toFixed(2), +me.h.toFixed(2), me.sprinting ? 1 : 0] });
        }
    }
}

// ============================================================
// Camera: angled chase view that follows your runner
// ============================================================
const cam = { x: 0, z: 0, zoom: 1, shake: 0, menuT: 0 };

function shake(amount) { cam.shake = Math.max(cam.shake, amount); }

function cameraFrame() {
    const aspect = innerWidth / innerHeight;
    // Portrait screens get a wider vertical field of view so enough of the arena fits across
    const fov = aspect < 1 ? clamp(2 * Math.atan(Math.tan(20 * Math.PI / 180) / aspect) * 180 / Math.PI, 50, 66) : 48;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const dist = (aspect < 1 ? 27 : 25) * cam.zoom;
    // Steeper on portrait so the top of a tall screen is not all horizon
    const pitch = (aspect < 1 ? 62 : 54) * Math.PI / 180;
    return { fov: fov * Math.PI / 180, dist, aspect, pitch };
}

function snapCamera() {
    if (!me) return;
    cam.x = me.x; cam.z = me.z;
    clampCamTarget();
}

// Keep the view from drifting far past the edges of the arena
function clampCamTarget() {
    const { fov, dist, aspect, pitch } = cameraFrame();
    const h = dist * Math.sin(pitch), back = dist * Math.cos(pitch);
    const nearZ = back - h / Math.tan(Math.min(1.55, pitch + fov / 2));   // ground visible below the target
    const farZ = h / Math.tan(Math.max(0.05, pitch - fov / 2)) - back;     // ground visible above it
    const halfW = dist * Math.tan(fov / 2) * aspect;
    const limX = Math.max(0, ARENA_W / 2 + 2 - halfW);
    cam.x = clamp(cam.x, -limX, limX);
    const maxZ = ARENA_D / 2 + 4.5 - nearZ;
    const minZ = Math.min(maxZ, -ARENA_D / 2 - 2 + farZ * 0.35);
    cam.z = clamp(cam.z, minZ, maxZ);
}

function updateCamera(dt) {
    if (!me || view !== 'game') {
        // Slow orbit over the park behind the menus
        cam.menuT += dt * 0.06;
        const a = cam.menuT;
        camera.fov = 50; camera.updateProjectionMatrix();
        camera.position.set(Math.sin(a) * 34, 24, Math.cos(a) * 30);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        return;
    }
    const speed = Math.hypot(me.vx, me.vz);
    const zoomTo = me.sprinting && speed > WALK_SPEED * 0.9 ? 1.12 : 1;
    cam.zoom += (zoomTo - cam.zoom) * damp(2.5, dt);
    const { dist, pitch } = cameraFrame();
    // Look a little ahead of the runner
    const tx = me.x + me.vx * 0.22, tz = me.z + me.vz * 0.18;
    cam.x += (tx - cam.x) * damp(5, dt);
    cam.z += (tz - cam.z) * damp(5, dt);
    clampCamTarget();
    let sx = 0, sy = 0, sz = 0;
    if (cam.shake > 0.001) {
        const s = cam.shake * cam.shake * 0.9;
        sx = (Math.random() - 0.5) * s; sy = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s;
        cam.shake *= Math.exp(-dt * 5);
    }
    camera.position.set(cam.x + sx, dist * Math.sin(pitch) + sy, cam.z + dist * Math.cos(pitch) + sz);
    camera.lookAt(cam.x + sx * 0.5, 0, cam.z + sz * 0.5);
    camera.updateMatrixWorld();
}

// ============================================================
// Rendering
// ============================================================
function animatePlayer(id, p, dt, t) {
    const m = p.model, u = m.userData;
    // Remote runners are extrapolated a touch to hide the 20 Hz updates
    const lead = (role === 'host' || p === me) ? 0 : 0.05;
    const k = damp(18, dt);
    m.position.x += (p.x + p.vx * lead - m.position.x) * k;
    m.position.z += (p.z + p.vz * lead - m.position.z) * k;
    const speed = Math.hypot(p.vx, p.vz);
    const frozen = p.it && ((frozenT > 0 && !p.dodging) || p.holdT > 0);

    // Facing, with the turn rate driving a lean into corners
    const step = wrapAngle(-p.h + Math.PI / 2 - u.yaw) * damp(14, dt);
    u.yaw += step;
    u.yawRate += (step / Math.max(dt, 1e-4) - u.yawRate) * damp(10, dt);
    m.rotation.y = u.yaw;

    const amt = Math.min(1, speed / WALK_SPEED);
    if (!frozen) u.phase += dt * (4 + speed * 1.1);
    const sw = Math.sin(u.phase) * 1.1 * amt;
    u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
    u.arms[0].rotation.x = -sw * 0.9; u.arms[1].rotation.x = sw * 0.9;
    u.arms[0].rotation.z = -0.15 - amt * 0.1; u.arms[1].rotation.z = 0.15 + amt * 0.1;
    u.rig.position.y = Math.abs(Math.cos(u.phase)) * 0.16 * amt;
    const leanF = p.dodging ? 0.6 : amt * 0.22 + (speed > WALK_SPEED + 1 ? 0.12 : 0);
    u.rig.rotation.x += (leanF - u.rig.rotation.x) * damp(10, dt);
    const leanS = clamp(-u.yawRate * 0.045 * amt, -0.45, 0.45);
    u.rig.rotation.z += (leanS - u.rig.rotation.z) * damp(10, dt);
    const breathe = 1 + Math.sin(t * 3 + u.phase) * 0.02 * (1 - amt);
    if (p.dodging) u.rig.scale.set(0.8, 0.85, 1.35);
    else u.rig.scale.lerp(tmpV.set(1, breathe, 1), damp(10, dt));

    // IT look: horns, red glow and label; frozen taggers turn icy
    if (u.itShown !== p.it) {
        u.itShown = p.it;
        u.horns.visible = p.it;
        u.glow.visible = p.it;
        u.labelMat.map = u.labelTex[p.it ? 1 : 0];
        u.markerMat.color.set(p.it ? 0xff1a0a : 0x16c060);
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 7 + u.phase);
    if (p.it) {
        const e = frozen ? ICE_EMISSIVE : IT_EMISSIVE;
        const s = frozen ? 0.6 : 0.12 + pulse * 0.14;
        u.bodyMat.emissive.copy(e).multiplyScalar(s);
        u.headMat.emissive.copy(e).multiplyScalar(s * 0.8);
        u.glowMat.color.set(frozen ? 0x49c6ff : 0xff2a10);
        u.glow.scale.setScalar(2.7 + pulse * 0.5);
        u.marker.scale.setScalar(2.8 + pulse * 0.5);
    } else {
        u.bodyMat.emissive.setRGB(0, 0, 0);
        u.headMat.emissive.setRGB(0, 0, 0);
        u.marker.scale.setScalar(p === me ? 2.6 : 2.2);
    }

    // Invisibility: faint for teammates and yourself, nearly gone for taggers
    const alpha = p.invisible ? (p === me ? 0.35 : (me && me.it ? 0.04 : 0.25)) : 1;
    if (alpha !== u.alpha) {
        u.alpha = alpha;
        for (const mt of u.mats) { mt.transparent = alpha < 1; mt.opacity = alpha; }
        for (const ms of u.meshes) ms.castShadow = alpha > 0.5;
        u.label.visible = u.marker.visible = alpha > 0.1;
    }
    if (alpha < 0.1) return;

    // Particles: dust while sprinting, flames trailing taggers, a streak while dodging
    const px = m.position.x, pz = m.position.z;
    if (p.sprinting && speed > WALK_SPEED * 0.9) {
        u.dustAcc += dt * 26;
        while (u.dustAcc >= 1) {
            u.dustAcc--;
            fxDust.spawn(px + (Math.random() - 0.5) * 0.6, 0.15, pz + (Math.random() - 0.5) * 0.6, -p.vx * 0.08 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, -p.vz * 0.08 + (Math.random() - 0.5), 0.55, 0.55, DUST, { grow: 1.6, drag: 2, alpha: 0.7 });
        }
    }
    if (p.it && !frozen) {
        u.fireAcc += dt * (speed > 2 ? 34 : 14);
        while (u.fireAcc >= 1) {
            u.fireAcc--;
            const up = Math.random() < 0.35;
            fxDust.spawn(px + (Math.random() - 0.5) * 0.5, up ? 2.5 : 0.4 + Math.random() * 1.2, pz + (Math.random() - 0.5) * 0.5, -p.vx * 0.15, 1.2 + Math.random() * 1.5, -p.vz * 0.15, 0.45, up ? 0.35 : 0.55, FIRE[Math.floor(Math.random() * 3)], { grow: -0.7, alpha: 0.8 });
        }
    }
    if (p.dodging) {
        for (let i = 0; i < 4; i++) {
            fxAdd.spawn(px + (Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 1.5, pz + (Math.random() - 0.5) * 0.4, 0, 0, 0, 0.3, 0.7, WHOOSH, { grow: -0.6, alpha: 0.7 });
        }
    }
}

function render(dt, t) {
    for (const [id, p] of players) if (p.model) animatePlayer(id, p, dt, t);

    for (const m of powerupModels.values()) {
        const u = m.userData;
        u.t += dt;
        const y = 1.3 + Math.sin(u.t * 2.5) * 0.25;
        u.icon.position.y = u.glow.position.y = u.halo.position.y = y;
        u.halo.rotation.set(Math.PI / 2 + Math.sin(u.t) * 0.4, u.t * 2, 0);
        u.icon.material.rotation = Math.sin(u.t * 3) * 0.2;
        u.glow.material.opacity = 0.4 + Math.sin(u.t * 5) * 0.15;
    }

    updateCamera(dt);
    const scale = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    fxAdd.update(dt, scale);
    fxDust.update(dt, scale);
    updateRings(dt);

    if (view === 'game') {
        updateTimer();
        updateChips();
        updateIndicator();
        if (me) {
            $('stamina-fill').style.width = `${me.stamina * 100}%`;
            $('touch-sprint').style.setProperty('--fill', `${Math.round(me.stamina * 100)}%`);
            const cdFrac = me.dodgeCd > 0 ? me.dodgeCd / DODGE_CD : 0;
            $('cd-ring').style.strokeDashoffset = (cdFrac * 138.2).toFixed(1);
            $('touch-dodge').classList.toggle('cooling', cdFrac > 0);
            const pu = me.powerup ? 'Speed boost' : (me.invisible ? 'Invisible' : (frozenT > 0 && me.it ? 'Frozen' : ''));
            $('powerup-hud').classList.toggle('hidden', !pu);
            if (pu) $('powerup-icon').textContent = pu;
        }
    }
    renderer.render(scene, camera);
}

// ============================================================
// Lobby UI
// ============================================================
function renderLobby(plist) {
    $('room-code').textContent = solo ? 'SOLO' : roomCode;
    $('room-label').textContent = solo ? 'Practice match' : 'Room code';
    $('btn-copy').classList.toggle('hidden', solo);
    $('count').textContent = `${plist.length}/${MAX_PLAYERS}`;
    const list = $('players');
    list.innerHTML = '';
    for (const p of plist) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        const kick = role === 'host' && p.id !== myId ? `<button class="kick" type="button" data-id="${p.id}">Remove</button>` : '';
        const badge = p.host ? '<span class="badge host">Host</span>' : (p.bot ? '<span class="badge">Bot</span>' : (p.ready ? '<span class="badge ok">Ready</span>' : '<span class="badge">Not ready</span>')) + kick;
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}${p.id === myId ? ' (you)' : ''}</b></span>${badge}`;
        list.appendChild(li);
    }
}

// ============================================================
// Results
// ============================================================
function showResults(list) {
    track('match_end');
    view = 'results';
    gameActive = false;
    countdownEnd = 0;
    show('results');
    clearActors();
    playMusic('results');
    sfx.go();
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = p.id === myId ? 'me' : '';
        li.innerHTML = `<span class="place">${p.place}</span><span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span><span class="score">${p.score} pts</span>`;
        ol.appendChild(li);
    }
    $('results-title').textContent = list[0]?.id === myId ? 'You Win!' : `${list[0]?.name || 'Nobody'} wins`;
}

// ============================================================
// Room management
// ============================================================
async function createRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    setStatus('menu-status', 'Creating room...');
    roomCode = makeCode();
    role = 'host'; solo = false;
    document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try { await hn.open(roomCode); } catch (e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return createRoom(); }
        setStatus('menu-status', e.message, true); role = null; document.body.classList.remove('is-host'); return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    track('room_create');
    enterLobby();
}

async function joinRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining...');
    seenSeq.clear();
    role = 'client'; solo = false; document.body.classList.remove('is-host');
    const cn = new ClientNet({ onMessage: clientHandle, onClose: () => leave('Lost connection.'), onStatus: msg => setStatus('menu-status', msg), forceRelay: new URLSearchParams(location.search).get('net') === 'relay' });
    try { myId = await cn.connect(code); } catch (e) { setStatus('menu-status', e.message, true); role = null; return; }
    net = cn; roomCode = code;
    cn.send({ t: 'hello', name: myName });
    track('room_join');
    enterLobby();
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('tagName', myName); } catch {}
    role = 'host'; solo = true; document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = 'SOLO'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 5; i++) addBot();
    track('play_solo');
    enterLobby();
}

function enterLobby() { view = 'lobby'; show('lobby'); playMusic('menu'); setStatus('menu-status', ''); setStatus('lobby-status', ''); }
function leave(reason) {
    seenSeq.clear();
    const n = net; net = null; if (n) n.close();
    role = null; solo = false; myId = null; roomCode = ''; gameActive = false; countdownEnd = 0;
    myReady = false; $('btn-ready').textContent = 'Ready up';
    H.players = []; H.phase = 'lobby'; H.gen++;
    clearActors();
    $('center-msg').className = ''; $('center-msg').innerHTML = '';
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

// ============================================================
// Event listeners
// ============================================================
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-exit').addEventListener('click', () => {
    if (view === 'menu') location.href = '../projects.html';
    else if (confirm(role === 'host' && !solo ? 'Leave and close this room?' : 'Leave this game?')) leave();
});
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => addBot());
$('players').addEventListener('click', e => {
    const b = e.target.closest('.kick');
    if (b && role === 'host') kickPlayer(b.dataset.id);
});
$('btn-ready').addEventListener('click', () => {
    myReady = !myReady;
    $('btn-ready').textContent = myReady ? 'Not ready' : 'Ready up';
    act({ t: 'ready', r: myReady });
});
$('btn-start').addEventListener('click', () => hostStartGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    H.gen++;
    for (const p of H.players) { p.ready = p.bot; p.score = 0; p.tags = 0; }
    emit({ t: 'toLobby' });
    emitLobby();
});

function syncMute() { $('icon-sound').classList.toggle('hidden', isMuted()); $('icon-muted').classList.toggle('hidden', !isMuted()); }
syncMute();
$('btn-mute').addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); syncMute(); });

// Read-only state snapshot for automated testing, only with #debug in the URL
if (DEBUG) {
    window.__tag = {
        snapshot: () => ({
            role, solo, view, gameActive, myId, roomCode, round: roundNum,
            timer: $('timer').textContent, timeLeft: +timeLeft.toFixed(2),
            center: $('center-msg').textContent,
            me: me && { it: me.it, x: +me.x.toFixed(2), z: +me.z.toFixed(2) },
            players: [...players].map(([id, p]) => {
                const v = new THREE.Vector3(p.model.position.x, 1, p.model.position.z).project(camera);
                return { id, name: p.name, it: p.it, score: p.score, x: +p.x.toFixed(2), z: +p.z.toFixed(2), v: +Math.hypot(p.vx, p.vz).toFixed(1), bt: p.bot ? [+(p.botTargetX || 0).toFixed(2), +(p.botTargetZ || 0).toFixed(2), p.unstickT > 0 ? 1 : 0] : null, sx: Math.round((v.x + 1) / 2 * innerWidth), sy: Math.round((1 - v.y) / 2 * innerHeight) };
            }),
            particles: fxAdd.list.length + fxDust.list.length,
            powerups: powerupModels.size,
            lobby: [...document.querySelectorAll('#players .player')].map(li => li.querySelector('.who').textContent),
        }),
    };
}

// ============================================================
// Main loop: fixed simulation steps, one render per frame
// ============================================================
let last = performance.now();
let acc = 0;
function frame(now) {
    const elapsed = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (view === 'game') {
        updateCountdown(now);
        acc += elapsed;
        while (acc >= STEP) { updateGame(STEP); acc -= STEP; }
    } else acc = 0;
    render(Math.min(elapsed, 0.05), now / 1000);
    requestAnimationFrame(frame);
}

$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `Invited to room ${invite}.`; $('invite').classList.remove('hidden'); }

show('menu');
playMusic('menu');
requestAnimationFrame(frame);
