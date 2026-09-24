// Eyes & Legs visuals: renderer, the darkness around the walker, level meshes, the walker, pings and effects.
// Purely cosmetic: game rules live in levels.js and main.js.
import * as THREE from 'three';
import {
    T, LIGHT_R, PIVOT_Y, SWITCH_COLORS, hazTime, hammerAngle, bladeAngle, laserOn, laserWarn,
    crusherY, crusherWarn, platPos, dynPhase, switchActive, isPaused,
} from './levels.js?v=1';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

export const PING_COLORS = { arrow: 0x38e1ff, stop: 0xff4d5e, jump: 0xffd23f, go: 0x3cf29a, danger: 0xff8a1f };
export const PING_LABELS = { arrow: 'THIS WAY', stop: 'STOP', jump: 'JUMP', go: 'GO', danger: 'DANGER' };

export let renderer, scene, walkerCam, guideCam, menuCam;
let hemi, sun, lamp, fill, blueprint, motes, eye;
let mode = 'menu';
let time = 0;

// ============================================================
// Darkness: every world material fades to black beyond the walker's light radius.
// This is a hard cut in the shader, so nothing out there (glowing or not) can be seen.
// ============================================================
export const DARK = { pos: { value: new THREE.Vector3() }, r: { value: LIGHT_R }, on: { value: 0 } };
function patch(mat) {
    mat.onBeforeCompile = sh => {
        sh.uniforms.uDkPos = DARK.pos;
        sh.uniforms.uDkR = DARK.r;
        sh.uniforms.uDkOn = DARK.on;
        sh.vertexShader = 'varying vec3 vDkW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 dkw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                dkw = instanceMatrix * dkw;
            #endif
            vDkW = (modelMatrix * dkw).xyz;`);
        sh.fragmentShader = 'uniform vec3 uDkPos; uniform float uDkR; uniform float uDkOn; varying vec3 vDkW;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float dkd = distance(vDkW.xz, uDkPos.xz);
            float dkv = 1.0 - smoothstep(uDkR * 0.5, uDkR, dkd);
            if (uDkOn > 0.5 && dkv <= 0.0) discard;
            gl_FragColor.rgb *= mix(1.0, dkv, uDkOn);`);
    };
    mat.customProgramCacheKey = () => 'dark1';
    return mat;
}
const std = (o) => patch(new THREE.MeshStandardMaterial(o));
const basic = (o) => patch(new THREE.MeshBasicMaterial(o));

// ============================================================
// Canvas textures
// ============================================================
function canvasTex(w, h, draw, srgb = true) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}
function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

const TEX = {};
function makeTextures() {
    TEX.floor = canvasTex(256, 256, (g, s) => {
        g.fillStyle = '#2d313b';
        g.fillRect(0, 0, s, s);
        const grd = g.createLinearGradient(0, 0, s, s);
        grd.addColorStop(0, '#a3abb9');
        grd.addColorStop(1, '#7d8697');
        g.fillStyle = grd;
        roundRect(g, 7, 7, s - 14, s - 14, 22);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 4;
        roundRect(g, 10, 10, s - 20, s - 20, 20);
        g.stroke();
        for (let i = 0; i < 2600; i++) {
            g.fillStyle = Math.random() < 0.5 ? `rgba(40,44,54,${rand(0.08, 0.22).toFixed(2)})` : `rgba(255,255,255,${rand(0.05, 0.16).toFixed(2)})`;
            g.fillRect(rand(12, s - 12), rand(12, s - 12), rand(1, 3), rand(1, 3));
        }
        g.strokeStyle = 'rgba(40,44,54,0.35)';
        g.lineWidth = 3;
        roundRect(g, s * 0.3, s * 0.3, s * 0.4, s * 0.4, 12);
        g.stroke();
    });
    TEX.wall = canvasTex(128, 128, (g, s) => {
        g.fillStyle = '#4a4f5e';
        g.fillRect(0, 0, s, s);
        g.fillStyle = '#3a3e4b';
        for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
            g.fillStyle = y % 2 ? '#555b6b' : '#50566a';
            g.fillRect(x * 44 + (y % 2) * 22 - 22 + 2, y * 32 + 2, 40, 28);
        }
        for (let i = 0; i < 500; i++) {
            g.fillStyle = `rgba(0,0,0,${rand(0.05, 0.2).toFixed(2)})`;
            g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
        }
    });
    TEX.wall.wrapS = TEX.wall.wrapT = THREE.RepeatWrapping;
    TEX.belt = canvasTex(128, 128, (g, s) => {
        g.fillStyle = '#23262d';
        g.fillRect(0, 0, s, s);
        g.fillStyle = '#ffb938';
        for (let k = 0; k < 2; k++) {
            const y0 = k * 64 + 12;
            g.beginPath();
            g.moveTo(24, y0 + 34); g.lineTo(64, y0); g.lineTo(104, y0 + 34); g.lineTo(104, y0 + 50); g.lineTo(64, y0 + 16); g.lineTo(24, y0 + 50);
            g.closePath();
            g.fill();
        }
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(0, 0, 8, s);
        g.fillRect(s - 8, 0, 8, s);
    });
    TEX.belt.wrapS = TEX.belt.wrapT = THREE.RepeatWrapping;
    TEX.stripes = canvasTex(128, 128, (g, s) => {
        g.fillStyle = '#2a2a2a';
        g.fillRect(0, 0, s, s);
        g.fillStyle = '#f2c14e';
        for (let i = -s; i < s * 2; i += 32) {
            g.beginPath();
            g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - s, s); g.lineTo(i - s, s);
            g.closePath();
            g.fill();
        }
    });
    TEX.stripes.wrapS = TEX.stripes.wrapT = THREE.RepeatWrapping;
    TEX.glow = canvasTex(64, 64, (g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
    });
    TEX.beam = canvasTex(8, 128, (g, w, h) => {
        const grd = g.createLinearGradient(0, h, 0, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0.9)');
        grd.addColorStop(0.35, 'rgba(255,255,255,0.3)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
    });
    TEX.fake = canvasTex(128, 128, (g, s) => {
        g.fillStyle = 'rgba(255,60,80,0.38)';
        roundRect(g, 6, 6, s - 12, s - 12, 12);
        g.fill();
        g.strokeStyle = '#ff3b55';
        g.lineWidth = 7;
        g.stroke();
        g.lineWidth = 12;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(34, 34); g.lineTo(s - 34, s - 34);
        g.moveTo(s - 34, 34); g.lineTo(34, s - 34);
        g.stroke();
    });
    TEX.crack = canvasTex(128, 128, (g, s) => {
        g.fillStyle = 'rgba(255,150,40,0.22)';
        roundRect(g, 6, 6, s - 12, s - 12, 12);
        g.fill();
        g.strokeStyle = '#ffa62b';
        g.lineWidth = 5;
        g.setLineDash([12, 8]);
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(20, 60); g.lineTo(46, 52); g.lineTo(60, 70); g.lineTo(84, 58); g.lineTo(108, 72);
        g.moveTo(60, 70); g.lineTo(56, 96); g.lineTo(70, 112);
        g.moveTo(46, 52); g.lineTo(40, 26);
        g.moveTo(84, 58); g.lineTo(92, 30);
        g.stroke();
    });
    TEX.ring = canvasTex(128, 128, (g, s) => {
        g.strokeStyle = '#fff';
        g.lineWidth = 10;
        g.beginPath();
        g.arc(s / 2, s / 2, s / 2 - 10, 0, TAU);
        g.stroke();
    });
}

// ============================================================
// Setup
// ============================================================
export function initWorld(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.6 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    walkerCam = new THREE.PerspectiveCamera(56, 1, 0.1, 300);
    menuCam = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    guideCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    makeTextures();

    hemi = new THREE.HemisphereLight(0xdcecff, 0x2a3346, 1.2);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
    sun.castShadow = true;
    const sz = coarse ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    // The walker's lamp: a warm spot straight overhead plus a soft fill so faces read
    lamp = new THREE.SpotLight(0xffd6a0, 110, 16, 0.78, 0.75, 1.5);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(coarse ? 512 : 1024, coarse ? 512 : 1024);
    lamp.shadow.bias = -0.0006;
    lamp.shadow.normalBias = 0.03;
    lamp.shadow.camera.near = 1;
    lamp.shadow.camera.far = 16;
    fill = new THREE.PointLight(0xffc98a, 9, 7, 1.4);
    scene.add(lamp, lamp.target, fill);

    buildBlueprint();
    buildMotes();
    buildEye();
    buildParticles();
    setMode('menu');
    return { renderer, scene };
}

export function resize(w, h) {
    renderer.setSize(w, h, false);
    walkerCam.aspect = w / h;
    walkerCam.updateProjectionMatrix();
    menuCam.aspect = w / h;
    menuCam.updateProjectionMatrix();
}

// Guide = fully lit diorama over a blueprint; walker = pitch dark with a lamp; menu = dark with a little rim light
export function setMode(m) {
    mode = m;
    const dark = m !== 'guide';
    DARK.on.value = dark ? 1 : 0;
    scene.background = new THREE.Color(dark ? 0x040509 : 0x0b1a33);
    hemi.intensity = dark ? 0.55 : 1.25;
    hemi.color.set(dark ? 0xffe2c0 : 0xdcecff);
    sun.visible = !dark;
    lamp.visible = fill.visible = dark;
    blueprint.visible = !dark;
    motes.visible = dark;
    eye.visible = m === 'menu';
    if (currentLevel) {
        currentLevel.guideGroup.visible = m === 'guide';
        currentLevel.group.traverse(o => { if (o.userData.walkerOnly) o.visible = m !== 'guide'; });
    }
}
export const getMode = () => mode;

let currentLevel = null;

// ============================================================
// Blueprint floor under the guide's map
// ============================================================
function buildBlueprint() {
    const mat = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Vector3() } },
        vertexShader: `varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec2 vP; uniform vec3 uC;
            float line(float v, float w) { float d = abs(fract(v) - 0.5); return smoothstep(0.5 - w, 0.5, d); }
            void main() {
                vec3 base = vec3(0.035, 0.09, 0.19);
                float minor = max(line(vP.x / 2.0 + 0.5, 0.03), line(vP.y / 2.0 + 0.5, 0.03));
                float major = max(line(vP.x / 10.0 + 0.5, 0.012), line(vP.y / 10.0 + 0.5, 0.012));
                float fade = 1.0 - smoothstep(20.0, 90.0, distance(vP, uC.xz));
                vec3 c = base + vec3(0.18, 0.45, 0.8) * (minor * 0.18 + major * 0.35) * fade;
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }`,
    });
    blueprint = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat);
    blueprint.rotation.x = -Math.PI / 2;
    blueprint.position.y = -7;
    scene.add(blueprint);
}

// Dust motes drifting in the lamp light
function buildMotes() {
    const n = 50, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = rand(-2.6, 2.6);
        pos[i * 3 + 1] = rand(0.2, 3.2);
        pos[i * 3 + 2] = rand(-3, 1.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    motes = new THREE.Points(geo, new THREE.PointsMaterial({ map: TEX.glow, color: 0xffe0b0, size: 0.09, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false;
    scene.add(motes);
}

// The big friendly eye that hovers over the menu
function buildEye() {
    eye = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 24), new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.25, emissive: 0x8fb8ff, emissiveIntensity: 0.25 }));
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x38e1ff }));
    iris.position.z = 0.79;
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: 0x05070c }));
    pupil.position.z = 0.795;
    const shine = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(0.12, 0.12, 0.8);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x38e1ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(4.2);
    eye.add(halo, white, iris, pupil, shine);
    scene.add(eye);
}

// ============================================================
// Particles: one instanced pool for dust, bursts, confetti and sparkles
// ============================================================
const PARTS = 320;
let partMesh;
const parts = [];
const _o = new THREE.Object3D();
const _c = new THREE.Color();
function buildParticles() {
    partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), basic({ color: 0xffffff }), PARTS);
    partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    partMesh.frustumCulled = false;
    for (let i = 0; i < PARTS; i++) {
        parts.push({ life: 0 });
        partMesh.setColorAt(i, _c.set(0xffffff));
        _o.scale.setScalar(0);
        _o.updateMatrix();
        partMesh.setMatrixAt(i, _o.matrix);
    }
    scene.add(partMesh);
}
let partIdx = 0;
function emit(x, y, z, vx, vy, vz, life, size, color, grav = 0, drag = 0) {
    const i = partIdx;
    partIdx = (partIdx + 1) % PARTS;
    Object.assign(parts[i], { x, y, z, vx, vy, vz, life, max: life, size, grav, drag, rx: rand(0, TAU), ry: rand(0, TAU), spin: rand(-8, 8) });
    partMesh.setColorAt(i, _c.set(color));
    partMesh.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
    for (let i = 0; i < PARTS; i++) {
        const p = parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
            _o.scale.setScalar(0);
            _o.position.set(0, -50, 0);
            _o.updateMatrix();
            partMesh.setMatrixAt(i, _o.matrix);
            continue;
        }
        p.vy -= p.grav * dt;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vz *= k; p.vy *= p.grav ? 1 : k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.spin * dt;
        const f = p.life / p.max;
        _o.position.set(p.x, p.y, p.z);
        _o.rotation.set(p.rx, p.ry + p.rx * 0.5, 0);
        _o.scale.setScalar(p.size * (0.3 + 0.7 * f));
        _o.updateMatrix();
        partMesh.setMatrixAt(i, _o.matrix);
    }
    partMesh.instanceMatrix.needsUpdate = true;
}
export const fx = {
    dust(x, z, n = 4) {
        for (let i = 0; i < n; i++) emit(x + rand(-0.25, 0.25), 0.08, z + rand(-0.25, 0.25), rand(-0.8, 0.8), rand(0.4, 1.1), rand(-0.8, 0.8), rand(0.35, 0.6), rand(0.07, 0.13), 0xbfc4cf, 0, 3);
    },
    burst(x, y, z) {
        const cols = [0xff8a3d, 0xffd23f, 0xffa45c, 0xffffff, 0xff5a3d];
        for (let i = 0; i < 46; i++) {
            const a = rand(0, TAU), s = rand(2, 7);
            emit(x, y + 0.6, z, Math.cos(a) * s, rand(2, 8), Math.sin(a) * s, rand(0.6, 1.1), rand(0.1, 0.22), cols[i % cols.length], 14, 0.5);
        }
    },
    sparkle(x, y, z, color = 0x3cf29a, n = 26) {
        for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), r = rand(0.3, 1.1);
            emit(x + Math.cos(a) * r, y + rand(0, 0.4), z + Math.sin(a) * r, Math.cos(a) * 0.4, rand(1.5, 3.5), Math.sin(a) * 0.4, rand(0.7, 1.3), rand(0.06, 0.12), color, -0.5, 1);
        }
    },
    confetti(x, y, z) {
        const cols = [0xff4d5e, 0x38e1ff, 0xffd23f, 0x3cf29a, 0xb48cff, 0xff8a1f, 0xffffff];
        for (let i = 0; i < 110; i++) {
            const a = rand(0, TAU), s = rand(1.5, 5.5);
            emit(x, y + 0.5, z, Math.cos(a) * s, rand(5, 10), Math.sin(a) * s, rand(1.4, 2.4), rand(0.06, 0.12), cols[i % cols.length], 9, 1.2);
        }
    },
    debris(x, z) {
        for (let i = 0; i < 12; i++) emit(x + rand(-0.8, 0.8), -0.1, z + rand(-0.8, 0.8), rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(0.6, 1.0), rand(0.12, 0.25), 0x7d8697, 12, 0.2);
    },
};

// ============================================================
// Level meshes
// ============================================================
const MAT = {};
function mats() {
    if (MAT.top) return MAT;
    MAT.top = std({ map: TEX.floor, roughness: 0.82, metalness: 0.05 });
    MAT.side = std({ color: 0x4a5061, roughness: 0.9 });
    MAT.under = std({ color: 0x252932, roughness: 1 });
    MAT.wall = std({ map: TEX.wall, color: 0xb8bfd0, roughness: 0.9 });
    MAT.wallTop = std({ color: 0x6a7184, roughness: 0.75 });
    MAT.metal = std({ color: 0x3b4150, roughness: 0.45, metalness: 0.6 });
    MAT.darkMetal = std({ color: 0x23262e, roughness: 0.5, metalness: 0.5 });
    MAT.steel = std({ color: 0x9aa3b5, roughness: 0.3, metalness: 0.8 });
    MAT.red = std({ color: 0x8a1c24, emissive: 0xff2238, emissiveIntensity: 2.2, roughness: 0.4 });
    MAT.orange = std({ color: 0x8a4a10, emissive: 0xff7a1a, emissiveIntensity: 2.4, roughness: 0.4 });
    MAT.stripes = std({ map: TEX.stripes, roughness: 0.6 });
    MAT.belt = std({ map: TEX.belt, roughness: 0.7 });
    MAT.beam = std({ color: 0x8d6a4a, roughness: 0.8 });
    MAT.beamEdge = std({ color: 0x0d3040, emissive: 0x35d6ff, emissiveIntensity: 1.6 });
    MAT.laser = basic({ color: 0xff2a40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.laserGlow = basic({ color: 0xff2a40, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.laserWarn = basic({ color: 0xff2a40, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.gold = std({ color: 0xd9a441, roughness: 0.3, metalness: 0.7, emissive: 0x6b4a10, emissiveIntensity: 0.6 });
    MAT.goalGlow = basic({ color: 0xffd23f, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.pole = std({ color: 0xd8dde8, roughness: 0.4, metalness: 0.5 });
    MAT.plat = std({ map: TEX.floor, color: 0xbfe8ff, roughness: 0.7 });
    MAT.platRim = std({ color: 0x0b3c3a, emissive: 0x2ee6c8, emissiveIntensity: 1.8 });
    for (const m of Object.values(MAT)) m.userData.keep = true;
    return MAT;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
}
function cyl(rt, rb, h, mat, seg = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}
function textSprite(text, color, w = 256, h = 96, scale = 1.6) {
    const tex = canvasTex(w, h, (g) => {
        g.fillStyle = 'rgba(6,14,30,0.82)';
        roundRect(g, 4, 4, w - 8, h - 8, 22);
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = 5;
        g.stroke();
        g.fillStyle = color;
        g.font = `900 ${Math.round(h * 0.42)}px Inter, Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 2);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(scale * w / h, scale, 1);
    s.renderOrder = 10;
    return s;
}
const hex = n => '#' + n.toString(16).padStart(6, '0');

export function buildLevel(L) {
    const M = mats();
    const group = new THREE.Group();
    const guideGroup = new THREE.Group();
    group.add(guideGroup);
    const upd = [];          // per-frame updaters: fn(lt, S, dyn, dt)

    // ---- Tile slabs: one instanced mesh for every standable square (fake and cracked ones look identical here)
    const slabKinds = new Set(['floor', 'start', 'goal', 'cp', 'fake', 'crack', 'switch', 'door']);
    const slabs = L.tiles.filter(t => slabKinds.has(t.kind));
    const slabGeo = new THREE.BoxGeometry(T - 0.08, 0.6, T - 0.08);
    slabGeo.translate(0, -0.3, 0);
    const slabMesh = new THREE.InstancedMesh(slabGeo, [M.side, M.side, M.top, M.under, M.side, M.side], slabs.length);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    const slabIdx = new Map();
    slabs.forEach((t, i) => {
        _o.position.set(t.x, 0, t.z);
        _o.rotation.set(0, ((t.c * 7 + t.r * 3) % 4) * Math.PI / 2, 0);
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        slabMesh.setMatrixAt(i, _o.matrix);
        slabIdx.set(t.i, i);
    });
    group.add(slabMesh);

    // Fake and cracked tiles: marked for the guide only, animated for both
    const dynMarks = [];
    for (const t of L.dyn) {
        const mark = new THREE.Mesh(new THREE.PlaneGeometry(T - 0.14, T - 0.14), new THREE.MeshBasicMaterial({ map: t.kind === 'fake' ? TEX.fake : TEX.crack, transparent: true, depthWrite: false }));
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(t.x, 0.03, t.z);
        guideGroup.add(mark);
        dynMarks.push(mark);
    }
    const dynSeen = L.dyn.map(() => 'solid');
    upd.push((lt, S, dyn) => {
        let dirty = false;
        L.dyn.forEach((t, k) => {
            const ph = dynPhase(t, dyn[k], lt);
            const i = slabIdx.get(t.i);
            if (ph === 'solid' && dynSeen[k] === 'solid') return;
            let y = 0, sc = 1, jx = 0, jz = 0;
            if (ph === 'shake') { jx = rand(-0.05, 0.05); jz = rand(-0.05, 0.05); }
            else if (ph === 'fallen') {
                const d = lt - dyn[k] - (t.kind === 'fake' ? 0.12 : 0.65);
                y = -0.5 * 20 * d * d;
                if (y < -25) sc = 0;
                if (dynSeen[k] !== 'fallen') { fx.debris(t.x, t.z); }
            } else if (ph === 'reset') {
                const d = lt - dyn[k] - (t.kind === 'fake' ? 3.6 : 4.6);
                sc = clamp(d * 4, 0, 1);
            }
            dynSeen[k] = ph === 'reset' && sc >= 1 ? 'solid' : ph;
            _o.position.set(t.x + jx, y, t.z + jz);
            _o.rotation.set(0, ((t.c * 7 + t.r * 3) % 4) * Math.PI / 2, 0);
            _o.scale.set(sc, sc, sc);
            _o.updateMatrix();
            slabMesh.setMatrixAt(i, _o.matrix);
            dynMarks[k].visible = ph !== 'fallen';
            dirty = true;
        });
        if (dirty) slabMesh.instanceMatrix.needsUpdate = true;
    });

    // ---- Walls
    const walls = L.tiles.filter(t => t.kind === 'wall');
    if (walls.length) {
        const wg = new THREE.BoxGeometry(T - 0.04, 1.8, T - 0.04);
        wg.translate(0, 0.3, 0);
        const wm = new THREE.InstancedMesh(wg, [M.wall, M.wall, M.wallTop, M.under, M.wall, M.wall], walls.length);
        wm.castShadow = wm.receiveShadow = true;
        walls.forEach((t, i) => {
            _o.position.set(t.x, 0, t.z);
            _o.rotation.set(0, 0, 0);
            _o.scale.set(1, 1, 1);
            _o.updateMatrix();
            wm.setMatrixAt(i, _o.matrix);
        });
        group.add(wm);
    }

    // ---- Conveyors: stripes scroll the way they push
    const belts = L.tiles.filter(t => t.kind === 'conv');
    if (belts.length) {
        const beltMat = M.belt.clone();
        beltMat.map = TEX.belt.clone();
        beltMat.map.needsUpdate = true;
        patch(beltMat);
        const bg = new THREE.BoxGeometry(T - 0.08, 0.6, T - 0.08);
        bg.translate(0, -0.3, 0);
        for (const t of belts) {
            const m = new THREE.Mesh(bg, [M.side, M.side, beltMat, M.under, M.side, M.side]);
            m.position.set(t.x, 0, t.z);
            // texture chevrons point towards -z (north) by default
            m.rotation.y = Math.atan2(-t.dir[0], -t.dir[1]);
            m.receiveShadow = true;
            group.add(m);
        }
        upd.push((lt) => { beltMat.map.offset.y = -((lt * 0.9) % 1); });
    }

    // ---- Narrow beams
    for (const t of L.tiles.filter(q => q.kind === 'beamNS' || q.kind === 'beamEW')) {
        const g = new THREE.Group();
        g.add(box(0.72, 0.3, T, M.beam, 0, -0.15, 0));
        g.add(box(0.06, 0.06, T, M.beamEdge, 0.36, -0.02, 0, false), box(0.06, 0.06, T, M.beamEdge, -0.36, -0.02, 0, false));
        g.position.set(t.x, 0, t.z);
        if (t.kind === 'beamEW') g.rotation.y = Math.PI / 2;
        group.add(g);
    }

    // ---- Start pad
    if (L.start) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 40), basic({ color: 0x38e1ff, transparent: true, opacity: 0.8 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(L.start.x, 0.02, L.start.z);
        group.add(ring);
    }

    // ---- Goal pad with a faint beacon beam (the beam is not hidden by the dark on purpose: it is a direction, not a hazard)
    if (L.goal) {
        const g = new THREE.Group();
        g.position.set(L.goal.x, 0, L.goal.z);
        const pad = cyl(0.92, 0.98, 0.16, M.gold, 40);
        pad.position.y = 0.08;
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 48), MAT.goalGlow);
        r1.rotation.x = Math.PI / 2;
        r1.position.y = 0.2;
        const r2 = r1.clone();
        r2.scale.setScalar(0.6);
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 16, 24, 1, true), new THREE.MeshBasicMaterial({ map: TEX.beam, color: 0xffd23f, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beacon.position.y = 8;
        g.add(pad, r1, r2, beacon);
        group.add(g);
        upd.push((lt) => {
            r1.position.y = 0.2 + Math.sin(lt * 3) * 0.08;
            r2.position.y = 0.45 + Math.sin(lt * 3 + 1.5) * 0.12;
            r1.rotation.z = lt;
            beacon.material.opacity = mode === 'guide' ? 0.35 : 0.16 + Math.sin(lt * 2) * 0.04;
        });
    }

    // ---- Checkpoint flags
    const flags = [];
    for (const t of L.cps) {
        const g = new THREE.Group();
        g.position.set(t.x, 0, t.z);
        const pole = cyl(0.05, 0.06, 2.1, M.pole, 8);
        pole.position.set(-0.72, 1.05, -0.62);
        const flagGeo = new THREE.PlaneGeometry(0.85, 0.52, 8, 1);
        flagGeo.translate(0.425, 0, 0);
        const flagMat = std({ color: 0x5a6378, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x000000 });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(-0.7, 1.78, -0.62);
        flag.castShadow = true;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 40), basic({ color: 0x5a6378, transparent: true, opacity: 0.6 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        g.add(pole, flag, ring);
        group.add(g);
        const base = flagGeo.attributes.position.array.slice();
        flags.push({ g, flag, flagMat, ring, base, on: false, pulse: 0 });
    }
    upd.push((lt, S, dyn, dt) => {
        for (const f of flags) {
            const p = f.flag.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = f.base[i * 3];
                p.array[i * 3 + 2] = Math.sin(x * 5 - lt * 6) * 0.08 * x;
            }
            p.needsUpdate = true;
            if (f.pulse > 0) {
                f.pulse = Math.max(0, f.pulse - dt);
                f.ring.scale.setScalar(1 + (1 - f.pulse) * 0.6);
            } else f.ring.scale.setScalar(1);
        }
    });

    // ---- Doors: two halves that slide apart
    const doors = [];
    for (const t of L.doors) {
        const sw = L.switches.find(s => s.id === t.sw);
        const col = SWITCH_COLORS[sw ? sw.kind : 'door'];
        const g = new THREE.Group();
        g.position.set(t.x, 0, t.z);
        const glow = std({ color: 0x0a2230, emissive: col, emissiveIntensity: 2 });
        const panel = std({ color: new THREE.Color(col).multiplyScalar(0.35), roughness: 0.45, metalness: 0.5, emissive: col, emissiveIntensity: 0.18 });
        g.add(box(0.2, 2.8, 0.44, M.metal, -0.98, 1.4, 0), box(0.2, 2.8, 0.44, M.metal, 0.98, 1.4, 0), box(2.16, 0.3, 0.5, M.metal, 0, 2.85, 0));
        const halves = [-1, 1].map(s => {
            const h = new THREE.Group();
            h.add(box(0.92, 2.55, 0.22, panel, 0, 1.3, 0), box(0.08, 2.2, 0.24, glow, -s * 0.38, 1.3, 0, false), box(0.7, 0.1, 0.24, glow, 0, 1.8, 0, false), box(0.92, 0.06, 0.24, glow, 0, 2.58, 0, false));
            h.position.x = s * 0.47;
            g.add(h);
            return { h, s };
        });
        group.add(g);
        doors.push({ t, halves, open: 0 });
    }
    upd.push((lt, S, dyn, dt) => {
        for (const d of doors) {
            const want = switchActive(L, S, d.t.sw, lt) ? 1 : 0;
            d.open += (want - d.open) * (1 - Math.exp(-8 * dt));
            for (const { h, s } of d.halves) h.position.x = s * (0.47 + d.open * 0.9);
        }
    });

    // ---- Bridges that extend from the north edge
    const bridges = [];
    for (const t of L.bridges) {
        const g = new THREE.Group();
        g.position.set(t.x, 0, t.z - T / 2);
        const inner = new THREE.Group();
        const railMat = std({ color: 0x1c1030, emissive: SWITCH_COLORS.bridge, emissiveIntensity: 1.8 });
        inner.add(box(T - 0.2, 0.26, T, M.beam, 0, -0.13, T / 2), box(0.08, 0.1, T, railMat, (T - 0.2) / 2, 0, T / 2, false), box(0.08, 0.1, T, railMat, -(T - 0.2) / 2, 0, T / 2, false));
        g.add(inner);
        const ghost = new THREE.Mesh(new THREE.PlaneGeometry(T - 0.2, T - 0.1), new THREE.MeshBasicMaterial({ map: TEX.crack, color: 0xb48cff, transparent: true, opacity: 0.5, depthWrite: false }));
        ghost.rotation.x = -Math.PI / 2;
        ghost.position.set(t.x, 0.02, t.z);
        guideGroup.add(ghost);
        group.add(g);
        bridges.push({ t, inner, ext: 0, ghost });
    }
    upd.push((lt, S, dyn, dt) => {
        for (const b of bridges) {
            const want = switchActive(L, S, b.t.sw, lt) ? 1 : 0;
            b.ext += (want - b.ext) * (1 - Math.exp(-7 * dt));
            b.inner.scale.z = Math.max(0.001, b.ext);
            b.inner.visible = b.ext > 0.01;
            b.ghost.visible = b.ext < 0.5;
        }
    });

    // ---- Switch pedestals, with a clickable hologram label for the guide
    const switches = [];
    for (const sw of L.switches) {
        const col = SWITCH_COLORS[sw.kind];
        const g = new THREE.Group();
        g.position.set(sw.x, 0, sw.z);
        const base = cyl(0.5, 0.62, 0.8, M.metal, 20);
        base.position.y = 0.4;
        const btnMat = std({ color: 0x101820, emissive: col, emissiveIntensity: 1.2 });
        const btn = cyl(0.36, 0.38, 0.18, btnMat, 20);
        btn.position.y = 0.88;
        g.add(base, btn);
        const label = textSprite(sw.kind.toUpperCase(), hex(col), 256, 96, 1.2);
        label.position.set(0, 2.5, 0);
        const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.18, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.03;
        const timer = new THREE.Mesh(new THREE.RingGeometry(1.24, 1.4, 48, 1, 0, TAU), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
        timer.rotation.x = -Math.PI / 2;
        timer.position.y = 0.04;
        const lg = new THREE.Group();
        lg.position.set(sw.x, 0, sw.z);
        lg.add(label, halo, timer);
        guideGroup.add(lg);
        group.add(g);
        switches.push({ sw, btn, btnMat, halo, timer, label, press: 0 });
    }
    upd.push((lt, S, dyn, dt) => {
        switches.forEach((s, i) => {
            const st = S && S.list[i];
            let active = false, frac = 0;
            if (st) {
                if (s.sw.kind === 'pause') { active = lt < st.until; frac = active ? (st.until - lt) / s.sw.dur : 0; }
                else if (s.sw.dur > 0) { active = st.on && lt < st.until; frac = active ? (st.until - lt) / s.sw.dur : 0; }
                else { active = st.on; frac = active ? 1 : 0; }
            }
            s.btnMat.emissiveIntensity = active ? 3.2 : 0.9 + Math.sin(lt * 4) * 0.3;
            s.btn.position.y = active ? 0.82 : 0.88;
            s.halo.scale.setScalar(1 + Math.sin(lt * 3) * 0.05);
            s.timer.visible = frac > 0;
            if (frac > 0 && Math.abs((s.timer.userData.f || 0) - frac) > 0.01) {
                s.timer.geometry.dispose();
                s.timer.geometry = new THREE.RingGeometry(1.24, 1.4, 48, 1, Math.PI / 2, TAU * frac);
                s.timer.userData.f = frac;
            }
        });
    });

    // ---- Hazards
    for (const h of L.hazards) {
        if (h.type === 'hammer') upd.push(buildHammer(group, h, L));
        else if (h.type === 'blade') upd.push(buildBlade(group, h, L));
        else if (h.type === 'laser') upd.push(buildLaser(group, guideGroup, h, L));
        else if (h.type === 'crusher') upd.push(buildCrusher(group, guideGroup, h, L));
    }
    for (const p of L.plats) upd.push(buildPlat(group, guideGroup, p, L));

    // ---- The walker's footprint on the guide's map: where they are and how far they can see
    const view = new THREE.Mesh(new THREE.CircleGeometry(LIGHT_R, 48), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.1, depthWrite: false }));
    view.rotation.x = -Math.PI / 2;
    const viewEdge = new THREE.Mesh(new THREE.RingGeometry(LIGHT_R - 0.08, LIGHT_R, 64), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthWrite: false }));
    viewEdge.rotation.x = -Math.PI / 2;
    const you = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false }));
    you.rotation.x = -Math.PI / 2;
    const walkerMark = new THREE.Group();
    walkerMark.add(view, viewEdge, you);
    walkerMark.renderOrder = 2;
    guideGroup.add(walkerMark);

    guideGroup.visible = mode === 'guide';
    scene.add(group);
    const lv = {
        L, group, guideGroup,
        update(lt, S, dyn, dt, wpos) {
            for (const f of upd) f(lt, S, dyn, dt);
            if (wpos) {
                walkerMark.visible = true;
                walkerMark.position.set(wpos.x, 0.06, wpos.z);
                you.scale.setScalar(1 + Math.sin(lt * 5) * 0.12);
            } else walkerMark.visible = false;
        },
        setCheckpoint(i) {
            flags.forEach((f, k) => {
                const on = k === i;
                if (on && !f.on) f.pulse = 1;
                f.on = on;
                f.flagMat.color.set(on ? 0x3cf29a : 0x5a6378);
                f.flagMat.emissive.set(on ? 0x1fae66 : 0x000000);
                f.flagMat.emissiveIntensity = on ? 1.2 : 0;
                f.ring.material.color.set(on ? 0x3cf29a : 0x5a6378);
                f.ring.material.opacity = on ? 0.95 : 0.6;
            });
        },
        dispose() {
            scene.remove(group);
            group.traverse(o => {
                if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
                const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
                for (const m of ms) if (!m.userData.keep) { if (m.map && m.map !== TEX.fake && m.map !== TEX.crack && m.map !== TEX.beam && m.map !== TEX.glow && m.map !== TEX.belt) m.map.dispose(); m.dispose(); }
            });
            if (currentLevel === lv) currentLevel = null;
        },
    };
    currentLevel = lv;
    return lv;
}

function buildHammer(group, h, L) {
    const M = MAT;
    const g = new THREE.Group();
    g.position.set(h.x, 0, h.z);
    const span = 2 * T;
    // The frame would hide the tiles in front of it on the guide's tilted map, so only the walker sees it
    const frame = new THREE.Group();
    frame.add(box(0.36, 5.0, 0.36, M.metal, -span, 2.5, 0), box(0.36, 5.0, 0.36, M.metal, span, 2.5, 0));
    frame.add(box(span * 2 + 0.4, 0.34, 0.5, M.metal, 0, 4.85, 0));
    frame.userData.walkerOnly = true;
    g.add(frame);
    const pivot = new THREE.Group();
    pivot.position.y = PIVOT_Y;
    const arm = box(0.14, h.len, 0.14, M.steel, 0, -h.len / 2, 0);
    const head = new THREE.Group();
    head.position.y = -h.len;
    const body = cyl(0.55, 0.55, 1.4, M.darkMetal, 20);
    body.rotation.z = Math.PI / 2;
    const bandA = cyl(0.58, 0.58, 0.14, M.red, 20);
    bandA.rotation.z = Math.PI / 2;
    bandA.position.x = 0.62;
    const bandB = bandA.clone();
    bandB.position.x = -0.62;
    const mid = cyl(0.58, 0.58, 0.2, M.steel, 20);
    mid.rotation.z = Math.PI / 2;
    head.add(body, bandA, bandB, mid);
    pivot.add(arm, head);
    g.add(pivot);
    group.add(g);
    return (lt, S) => {
        const t = hazTime(L, S, h, lt);
        pivot.rotation.z = hammerAngle(h, t);
    };
}

function buildBlade(group, h, L) {
    const M = MAT;
    const g = new THREE.Group();
    g.position.set(h.x, 0, h.z);
    const hub = cyl(0.3, 0.38, 0.62, M.metal, 16);
    hub.position.y = 0.31;
    const cap = cyl(0.2, 0.2, 0.1, M.orange, 16);
    cap.position.y = 0.66;
    const bar = new THREE.Group();
    bar.position.y = 0.36;
    const L2 = h.len * 2;
    bar.add(box(L2, 0.14, 0.34, M.steel, 0, 0, 0));
    bar.add(box(L2, 0.06, 0.06, M.orange, 0, 0, 0.19, false), box(L2, 0.06, 0.06, M.orange, 0, 0, -0.19, false));
    // teeth along both edges
    const tooth = new THREE.ConeGeometry(0.09, 0.22, 4);
    for (let k = -3; k <= 3; k++) {
        if (!k) continue;
        for (const s of [-1, 1]) {
            const m = new THREE.Mesh(tooth, M.orange);
            m.rotation.x = s * Math.PI / 2;
            m.position.set(k * (h.len / 3.4), 0, s * 0.3);
            bar.add(m);
        }
    }
    g.add(hub, cap, bar);
    group.add(g);
    return (lt, S) => {
        const t = hazTime(L, S, h, lt);
        bar.rotation.y = -bladeAngle(h, t);
    };
}

function buildLaser(group, guideGroup, h, L) {
    const M = MAT;
    const g = new THREE.Group();
    g.position.set(0, 0, h.z);
    const len = h.x1 - h.x0;
    const cx = (h.x0 + h.x1) / 2;
    for (const x of [h.x0 + 0.16, h.x1 - 0.16]) {
        g.add(box(0.28, 2.1, 0.34, M.metal, x, 1.05, 0));
        for (const y of [0.35, 0.95, 1.55]) g.add(box(0.32, 0.12, 0.38, M.red, x, y, 0, false));
    }
    const beams = new THREE.Group();
    const warn = new THREE.Group();
    for (const y of [0.35, 0.95, 1.55]) {
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len - 0.3, 6), M.laser);
        core.rotation.z = Math.PI / 2;
        core.position.set(cx, y, 0);
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, len - 0.3, 8), M.laserGlow);
        glow.rotation.z = Math.PI / 2;
        glow.position.set(cx, y, 0);
        beams.add(core, glow);
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len - 0.3, 5), M.laserWarn);
        w.rotation.z = Math.PI / 2;
        w.position.set(cx, y, 0);
        warn.add(w);
    }
    g.add(beams, warn);
    group.add(g);
    // Guide: a strip on the floor, green = safe, amber = about to fire, red = firing
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x3cf29a, transparent: true, opacity: 0.6, depthWrite: false });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.5), stripMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(cx, 0.05, h.z);
    guideGroup.add(strip);
    return (lt, S) => {
        const t = hazTime(L, S, h, lt);
        const on = laserOn(h, t), w = laserWarn(h, t);
        beams.visible = on;
        warn.visible = !on && w < 0.5 && Math.floor(lt * 14) % 2 === 0;
        stripMat.color.set(on ? 0xff2a40 : w < 0.8 ? 0xffb938 : 0x3cf29a);
        stripMat.opacity = on ? 0.85 : 0.55;
    };
}

function buildCrusher(group, guideGroup, h, L) {
    const M = MAT;
    const g = new THREE.Group();
    g.position.set(h.x, 0, h.z);
    g.add(box(0.26, 5.6, 0.26, M.metal, -1.02, 2.8, -0.9), box(0.26, 5.6, 0.26, M.metal, 1.02, 2.8, -0.9));
    g.add(box(0.26, 5.6, 0.26, M.metal, -1.02, 2.8, 0.9), box(0.26, 5.6, 0.26, M.metal, 1.02, 2.8, 0.9));
    const block = new THREE.Group();
    block.add(box(1.76, 1.4, 1.76, M.stripes, 0, 0.72, 0));
    block.add(box(1.8, 0.12, 1.8, M.red, 0, 0.06, 0, false));
    block.add(box(0.5, 1.2, 0.5, M.darkMetal, 0, 2.0, 0));
    g.add(block);
    group.add(g);
    const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a40, transparent: true, opacity: 0, depthWrite: false });
    const warnSq = new THREE.Mesh(new THREE.PlaneGeometry(T - 0.2, T - 0.2), warnMat);
    warnSq.rotation.x = -Math.PI / 2;
    warnSq.position.set(h.x, 0.05, h.z);
    guideGroup.add(warnSq);
    return (lt, S) => {
        const t = hazTime(L, S, h, lt);
        const y = crusherY(h, t);
        block.position.y = y;
        const w = crusherWarn(h, t);
        if (y < 1.3) { warnMat.color.set(0xff2a40); warnMat.opacity = 0.75; }
        else if (w < 0.7) { warnMat.color.set(0xffb938); warnMat.opacity = 0.35 + 0.35 * Math.abs(Math.sin(lt * 12)); }
        else { warnMat.color.set(0x3cf29a); warnMat.opacity = 0.25; }
    };
}

function buildPlat(group, guideGroup, p, L) {
    const M = MAT;
    const g = new THREE.Group();
    const slab = box(T - 0.1, 0.4, T - 0.1, [M.platRim, M.platRim, M.plat, M.under, M.platRim, M.platRim], 0, -0.2, 0);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0x2ee6c8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.45;
    patch(under.material);
    g.add(slab, under);
    group.add(g);
    // Guide: the rail it travels along
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(0.22, len + 0.4), new THREE.MeshBasicMaterial({ color: 0x2ee6c8, transparent: true, opacity: 0.55, depthWrite: false }));
    rail.rotation.x = -Math.PI / 2;
    rail.rotation.z = -Math.atan2(p.bx - p.ax, p.bz - p.az);
    rail.position.set((p.ax + p.bx) / 2, -0.3, (p.az + p.bz) / 2);
    guideGroup.add(rail);
    return (lt) => {
        const q = platPos(p, lt);
        g.position.set(q.x, 0, q.z);
    };
}

// ============================================================
// The walker: a small round miner with a headlamp
// ============================================================
export function createWalker() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const orange = std({ color: 0xff8a3d, roughness: 0.5 });
    const light = std({ color: 0xffb070, roughness: 0.5 });
    const dark = std({ color: 0x3b2a4a, roughness: 0.7 });
    const yellow = std({ color: 0xffd23f, roughness: 0.4 });
    const white = std({ color: 0xffffff, roughness: 0.2 });
    const black = std({ color: 0x0b0b12, roughness: 0.2 });
    const lens = basic({ color: 0xfff2b0 });
    const sph = (r, m) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), m); s.castShadow = true; return s; };
    const torso = sph(0.4, orange);
    torso.scale.set(1, 1.05, 0.92);
    torso.position.y = 0.72;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), light);
    belly.scale.set(1, 1.1, 0.5);
    belly.position.set(0, 0.66, 0.26);
    const head = new THREE.Group();
    head.position.y = 1.22;
    const skull = sph(0.34, light);
    const helmet = sph(0.36, yellow);
    helmet.scale.set(1, 0.62, 1);
    helmet.position.y = 0.1;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 24), yellow);
    brim.position.y = 0.08;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 16), dark);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.2, 0.34);
    const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), lens);
    lampLens.position.set(0, 0.2, 0.395);
    const eyes = [-1, 1].map(s => {
        const e = new THREE.Group();
        const w = sph(0.09, white);
        w.scale.set(1, 1.15, 0.6);
        const p = sph(0.05, black);
        p.position.z = 0.04;
        e.add(w, p);
        e.position.set(s * 0.12, -0.02, 0.29);
        return e;
    });
    head.add(skull, helmet, brim, lamp, lampLens, ...eyes);
    const mkLimb = (len, r, m, footM) => {
        const pivot = new THREE.Group();
        const l = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 10), m);
        l.position.y = -len / 2;
        l.castShadow = true;
        pivot.add(l);
        if (footM) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.28), footM);
            f.position.set(0, -len - 0.02, 0.05);
            f.castShadow = true;
            pivot.add(f);
        } else {
            const hnd = sph(0.075, light);
            hnd.position.y = -len;
            pivot.add(hnd);
        }
        return pivot;
    };
    const legs = [-1, 1].map(s => { const p = mkLimb(0.36, 0.085, dark, dark); p.position.set(s * 0.17, 0.42, 0); return p; });
    const arms = [-1, 1].map(s => { const p = mkLimb(0.3, 0.065, orange, null); p.position.set(s * 0.4, 0.86, 0); p.rotation.z = s * 0.25; return p; });
    body.add(torso, belly, head, ...legs, ...arms);
    const shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), basic({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.position.y = 0.015;
    root.add(shadowBlob);
    scene.add(root);
    let phase = 0, face = 0, blink = 0;
    return {
        root,
        set visible(v) { root.visible = v; },
        get visible() { return root.visible; },
        update(s, dt) {
            root.position.set(s.x, s.y, s.z);
            face += (((s.face - face + Math.PI * 3) % TAU) - Math.PI) * (1 - Math.exp(-14 * dt));
            root.rotation.y = face;
            const run = clamp(s.speed / 5, 0, 1);
            phase += dt * (4 + s.speed * 2.2);
            const air = !s.grounded;
            const sw = Math.sin(phase) * 0.9 * run;
            legs[0].rotation.x = air ? -0.7 : sw;
            legs[1].rotation.x = air ? 0.35 : -sw;
            arms[0].rotation.x = air ? -2.4 : -sw * 0.8;
            arms[1].rotation.x = air ? -2.4 : sw * 0.8;
            body.position.y = air ? 0 : Math.abs(Math.sin(phase)) * 0.07 * run + Math.sin(time * 2.5) * 0.012 * (1 - run);
            body.rotation.x = run * 0.12;
            head.rotation.z = Math.sin(phase * 0.5) * 0.05 * run;
            blink -= dt;
            const closed = blink < 0.12;
            if (blink < 0) blink = rand(2, 4.5);
            for (const e of eyes) e.scale.y = closed ? 0.15 : 1;
            shadowBlob.position.y = 0.015 - s.y;
            shadowBlob.visible = s.groundBelow !== false;
            shadowBlob.scale.setScalar(clamp(1 - s.y * 0.25, 0.4, 1));
        },
        dispose() {
            scene.remove(root);
        },
    };
}

// ============================================================
// Pings: glowing markers that stay about 3 seconds
// ============================================================
const iconCache = {};
function pingIcon(kind) {
    if (iconCache[kind]) return iconCache[kind];
    const col = hex(PING_COLORS[kind]);
    const tex = canvasTex(256, 256, (g, s) => {
        g.save();
        g.translate(s / 2, s / 2);
        g.shadowColor = col;
        g.shadowBlur = 24;
        g.fillStyle = 'rgba(6,10,20,0.85)';
        g.beginPath();
        if (kind === 'stop') {
            for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(Math.cos(a) * 100, Math.sin(a) * 100); }
        } else if (kind === 'danger') {
            g.moveTo(0, -104); g.lineTo(100, 78); g.lineTo(-100, 78);
        } else {
            g.arc(0, 0, 100, 0, TAU);
        }
        g.closePath();
        g.fill();
        g.lineWidth = 12;
        g.strokeStyle = col;
        g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = col;
        g.strokeStyle = col;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        if (kind === 'arrow') {
            g.beginPath();
            g.moveTo(0, -62); g.lineTo(52, -4); g.lineTo(20, -4); g.lineTo(20, 58); g.lineTo(-20, 58); g.lineTo(-20, -4); g.lineTo(-52, -4);
            g.closePath();
            g.fill();
        } else if (kind === 'stop') {
            g.fillRect(-58, -16, 116, 32);
        } else if (kind === 'jump') {
            g.lineWidth = 20;
            for (const y of [-6, 40]) { g.beginPath(); g.moveTo(-44, y + 4); g.lineTo(0, y - 40); g.lineTo(44, y + 4); g.stroke(); }
        } else if (kind === 'go') {
            g.beginPath();
            g.moveTo(-34, -52); g.lineTo(56, 0); g.lineTo(-34, 52);
            g.closePath();
            g.fill();
        } else if (kind === 'danger') {
            g.lineWidth = 20;
            g.beginPath();
            g.moveTo(-34, -10); g.lineTo(34, 54); g.moveTo(34, -10); g.lineTo(-34, 54);
            g.stroke();
        }
        g.restore();
    });
    iconCache[kind] = tex;
    return tex;
}
export { pingIcon };

let arrowGeo = null;
function getArrowGeo() {
    if (arrowGeo) return arrowGeo;
    const s = new THREE.Shape();
    s.moveTo(0, 1.3); s.lineTo(0.85, 0.3); s.lineTo(0.32, 0.3); s.lineTo(0.32, -1.0); s.lineTo(-0.32, -1.0); s.lineTo(-0.32, 0.3); s.lineTo(-0.85, 0.3);
    s.closePath();
    arrowGeo = new THREE.ShapeGeometry(s);
    arrowGeo.rotateX(-Math.PI / 2);   // shape +y becomes world -z
    arrowGeo.userData.keep = true;
    return arrowGeo;
}

const pings = [];
export const PING_LIFE = 3;
export function addPing(p) {
    const col = PING_COLORS[p.k] || 0xffffff;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.86, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    const ring2 = new THREE.Mesh(ring.geometry, ringMat.clone());
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.07;
    const beamMat = new THREE.MeshBasicMaterial({ map: TEX.beam, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5, 12, 1, true), beamMat);
    beam.position.y = 2.5;
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: pingIcon(p.k), transparent: true, depthTest: false, depthWrite: false }));
    icon.scale.setScalar(1.25);
    icon.position.y = 2.1;
    icon.renderOrder = 20;
    g.add(ring, ring2, beam, icon);
    let arrow = null;
    if (p.k === 'arrow') {
        arrow = new THREE.Mesh(getArrowGeo(), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        arrow.position.y = 0.12;
        arrow.rotation.y = Math.atan2(-p.dx, -p.dz);
        g.add(arrow);
    }
    scene.add(g);
    const ping = { ...p, g, ring, ring2, icon, beam, arrow, age: 0, col };
    pings.push(ping);
    return ping;
}
function updatePings(dt) {
    for (let i = pings.length - 1; i >= 0; i--) {
        const p = pings[i];
        p.age += dt;
        if (p.age > PING_LIFE) {
            scene.remove(p.g);
            p.ring.geometry.dispose();
            p.beam.geometry.dispose();
            p.icon.material.dispose();
            pings.splice(i, 1);
            continue;
        }
        const fade = clamp((PING_LIFE - p.age) / 0.5, 0, 1) * clamp(p.age / 0.12, 0, 1);
        const k = (p.age * 1.4) % 1;
        const soft = mode === 'guide' ? 1 : 0.6;
        p.ring.scale.setScalar(0.8 + Math.sin(p.age * 8) * 0.06);
        p.ring.material.opacity = fade * soft;
        p.ring2.scale.setScalar(1 + k * 1.6);
        p.ring2.material.opacity = (1 - k) * fade * soft * 0.8;
        p.beam.material.opacity = 0.45 * fade;
        p.icon.material.opacity = fade;
        const pop = p.age < 0.25 ? 1 + Math.sin(p.age / 0.25 * Math.PI) * 0.35 : 1;
        p.icon.scale.setScalar((mode === 'guide' ? 1.6 : 1.25) * pop);
        p.icon.position.y = 2.1 + Math.sin(p.age * 4) * 0.12;
        if (p.arrow) {
            p.arrow.material.opacity = (mode === 'guide' ? 0.9 : 0.6) * fade;
            const s = (p.age * 1.6) % 1;
            const len = Math.hypot(p.dx, p.dz) || 1;
            p.arrow.position.x = (p.dx / len) * s * 0.6;
            p.arrow.position.z = (p.dz / len) * s * 0.6;
        }
    }
}
export const activePings = () => pings;
export function clearPings() {
    for (const p of pings) scene.remove(p.g);
    pings.length = 0;
}

// ============================================================
// Per-frame
// ============================================================
export function frame(dt, cam, focus) {
    time += dt;
    updateParticles(dt);
    updatePings(dt);
    if (focus) {
        DARK.pos.value.set(focus.x, 0, focus.z);
        lamp.position.set(focus.x, focus.y + 6.5, focus.z + 1.2);
        lamp.target.position.set(focus.x, focus.y, focus.z - 0.4);
        fill.position.set(focus.x, focus.y + 1.8, focus.z + 1.4);
        motes.position.set(focus.x, focus.y, focus.z);
        const a = motes.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
            let y = a.array[i * 3 + 1] + dt * 0.15;
            if (y > 3.6) y = 0.2;
            a.array[i * 3 + 1] = y;
            a.array[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.05;
        }
        a.needsUpdate = true;
    }
    renderer.render(scene, cam);
}

// Keep the guide's sun and its shadow box around what the guide is looking at
export function aimSun(x, z, size) {
    sun.position.set(x - 14, 34, z + 18);
    sun.target.position.set(x, 0, z);
    const c = sun.shadow.camera;
    const s = Math.max(12, size * 0.75);
    if (Math.abs(c.right - s) > 0.5) {
        c.left = -s; c.right = s; c.top = s; c.bottom = -s;
        c.near = 1; c.far = 120;
        c.updateProjectionMatrix();
    }
    blueprint.material.uniforms.uC.value.set(x, 0, z);
    blueprint.position.x = x;
    blueprint.position.z = z;
}

export function placeEye(x, y, z, lookX, lookY, lookZ) {
    eye.position.set(x, y, z);
    eye.lookAt(lookX, lookY, lookZ);
}
