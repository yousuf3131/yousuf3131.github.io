// Sumo Smash visuals: renderer look, dohyo arena, water, wrestlers and particle effects.
// Purely cosmetic: nothing in here touches game rules, physics or networking.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WATER_Y = -3.2;
const RING_R = 20;            // full dohyo radius (same as PLATFORM_R in main.js)
const FLARE = 1.6;            // mound widens by this much towards its base
const MOUND_H = 6.4;
const BALE_R = 0.3;
const BALE_SPACING = 1.45;
const MAX_BALES = 100;
const TAU = Math.PI * 2;
const FOG_COL = 0xe7a386;
const CONFETTI_COLS = [0xe0584f, 0x3b82f6, 0x2ec495, 0xf2c14e, 0xa78bfa, 0xf97316, 0xec4899, 0xffffff];
const SKIN_TONES = [0xf0c29c, 0xe2ab84, 0xcf9670, 0xf3cfae, 0xdca17b, 0xbd8058, 0xeab98f, 0xd39a74];
const PU_COLORS = { speed: 0x4d9bff, heavy: 0xff8a2a, shield: 0x33d69f };
const DUST_COL = 0xe8cba4;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = x => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

let scene, camera, renderer;
let time = 0;
let gameMode = false;
let shakeAmt = 0;
const shakeOff = new THREE.Vector3();
const _o = new THREE.Object3D();
const _c = new THREE.Color();

// ============================================================
// Setup
// ============================================================
export function initWorld(r, s, c) {
    renderer = r; scene = s; camera = c;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.background = new THREE.Color(FOG_COL);
    scene.fog = new THREE.Fog(FOG_COL, 55, 150);
    buildLights();
    buildSky();
    buildWater();
    buildLanterns();
    buildRoof();
    buildDohyo();
    buildPools();
    buildSpot();
    buildDemo();
    setMode(false);
}

function buildLights() {
    scene.add(new THREE.HemisphereLight(0xffe6d2, 0x6a4a3c, 1.35));
    const sun = new THREE.DirectionalLight(0xffdcb0, 2.5);
    sun.position.set(-16, 30, 12);
    sun.castShadow = true;
    const sz = coarse ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
}

// ============================================================
// Canvas textures
// ============================================================
function canvasTex(w, h, draw, srgb = true) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}

// Draw a dot on a tiling canvas, wrapping around the edges so the tile stays seamless
function wrapDot(g, x, y, r, s) {
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        const px = x + ox, py = y + oy;
        if (px + r < 0 || px - r > s || py + r < 0 || py - r > s) continue;
        g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
    }
}

function clayTexture() {
    return canvasTex(512, 512, (g, s) => {
        g.fillStyle = '#c98f5c';
        g.fillRect(0, 0, s, s);
        g.filter = 'blur(14px)';
        for (let i = 0; i < 80; i++) {
            g.fillStyle = Math.random() < 0.5 ? 'rgba(125,72,36,0.12)' : 'rgba(255,222,176,0.12)';
            wrapDot(g, Math.random() * s, Math.random() * s, rand(18, 60), s);
        }
        g.filter = 'none';
        for (let i = 0; i < 5200; i++) {
            g.fillStyle = Math.random() < 0.5 ? `rgba(98,56,28,${rand(0.12, 0.38).toFixed(2)})` : `rgba(255,234,200,${rand(0.12, 0.32).toFixed(2)})`;
            wrapDot(g, Math.random() * s, Math.random() * s, rand(0.5, 1.5), s);
        }
        for (let i = 0; i < 70; i++) {
            g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,96,80' : '226,206,180'},0.75)`;
            wrapDot(g, Math.random() * s, Math.random() * s, rand(1.4, 2.8), s);
        }
    });
}

function moundTexture() {
    const t = canvasTex(256, 256, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, '#c08553');
        grd.addColorStop(0.06, '#a96c40');
        grd.addColorStop(0.45, '#8a5634');
        grd.addColorStop(0.53, '#5c3a26');
        grd.addColorStop(1, '#2e241e');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 16; i++) {
            const y = rand(0.08, 0.5) * h, k = Math.floor(rand(1, 4)), ph = rand(0, TAU), th = rand(1.5, 4);
            g.fillStyle = Math.random() < 0.6 ? `rgba(70,40,22,${rand(0.15, 0.3).toFixed(2)})` : `rgba(230,180,130,${rand(0.1, 0.2).toFixed(2)})`;
            for (let x = 0; x < w; x += 2) g.fillRect(x, y + Math.sin(x / w * TAU * k + ph) * 4, 2, th);
        }
        for (let i = 0; i < 1600; i++) {
            g.fillStyle = Math.random() < 0.5 ? 'rgba(50,30,18,0.3)' : 'rgba(240,200,160,0.2)';
            g.fillRect(Math.random() * w, Math.random() * h * 0.55, rand(1, 2.5), rand(1, 2.5));
        }
        g.fillStyle = 'rgba(255,225,190,0.35)';
        g.fillRect(0, 0, w, 3);
    });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
}

function strawTexture() {
    return canvasTex(128, 128, (g, s) => {
        g.fillStyle = '#d8c07c';
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 280; i++) {
            g.fillStyle = Math.random() < 0.5 ? `rgba(140,112,52,${rand(0.2, 0.5).toFixed(2)})` : `rgba(255,244,200,${rand(0.2, 0.5).toFixed(2)})`;
            g.fillRect(Math.random() * s, 0, rand(0.6, 1.6), s);
        }
        for (const y of [0.3, 0.5, 0.7]) {
            g.fillStyle = 'rgba(92,70,38,0.9)';
            g.fillRect(0, y * s - 3, s, 6);
            g.fillStyle = 'rgba(255,236,186,0.35)';
            g.fillRect(0, y * s - 3, s, 1.5);
        }
    });
}

let glowTex = null;
function getGlowTex() {
    if (glowTex) return glowTex;
    glowTex = canvasTex(64, 64, (g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
    });
    glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
    return glowTex;
}

// ============================================================
// Sky and water
// ============================================================
let sky;
function buildSky() {
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTop: { value: new THREE.Color(0x27327a) },
            uMid: { value: new THREE.Color(0xc27aa0) },
            uHor: { value: new THREE.Color(0xffb582) },
            uLow: { value: new THREE.Color(FOG_COL) },
            uSun: { value: new THREE.Vector3(0.45, 0.1, -0.9).normalize() },
        },
        vertexShader: `varying vec3 vDir;
            void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uTop, uMid, uHor, uLow, uSun; varying vec3 vDir;
            void main() {
                vec3 d = normalize(vDir);
                float h = d.y;
                vec3 c = mix(uHor, uMid, smoothstep(0.02, 0.3, h));
                c = mix(c, uTop, smoothstep(0.3, 0.9, h));
                c = mix(uLow, c, smoothstep(-0.1, 0.02, h));
                float s = max(dot(d, uSun), 0.0);
                c += vec3(1.0, 0.72, 0.45) * (pow(s, 400.0) * 3.0 + pow(s, 10.0) * 0.35);
                gl_FragColor = vec4(c, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.BackSide, depthWrite: false, fog: false,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), mat);
    sky.renderOrder = -1;
    scene.add(sky);
}

let water;
const ripples = [];
function buildWater() {
    const geo = new THREE.PlaneGeometry(330, 330, 110, 110);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            uTime: { value: 0 },
            uShore: { value: RING_R + FLARE * 0.5 },
            uDeep: { value: new THREE.Color(0x14506e) },
            uShallow: { value: new THREE.Color(0x2fa6a8) },
            uFoam: { value: new THREE.Color(0xf4fbff) },
            uSky: { value: new THREE.Color(0xffc49a) },
            uGlint: { value: new THREE.Color(0xffe2b8) },
            uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
        }]),
        vertexShader: `uniform float uTime;
            varying vec3 vW; varying float vH;
            #include <fog_pars_vertex>
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                float h = sin(w.x * 0.33 + uTime * 1.2) * 0.12 + sin(w.z * 0.41 - uTime * 1.05 + w.x * 0.1) * 0.1 + sin((w.x + w.z) * 0.8 + uTime * 2.1) * 0.04;
                w.y += h;
                vW = w.xyz; vH = h;
                vec4 mvPosition = viewMatrix * w;
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }`,
        fragmentShader: `uniform float uTime, uShore;
            uniform vec3 uDeep, uShallow, uFoam, uSky, uGlint;
            uniform vec4 uRip[8];
            varying vec3 vW; varying float vH;
            #include <common>
            #include <fog_pars_fragment>
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            void main() {
                vec2 p = vW.xz;
                float d = length(p) - uShore;
                vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 16.0, d));
                // stylised light streaks drifting over the surface
                float n1 = noise(p * 0.18 + vec2(uTime * 0.05, uTime * 0.03));
                float n2 = noise(p * 0.55 - vec2(uTime * 0.12, -uTime * 0.08));
                float streak = abs(sin(n1 * 9.0 + n2 * 2.5 + uTime * 0.5));
                col += uFoam * (1.0 - smoothstep(0.0, 0.06, streak)) * 0.1;
                col *= 0.92 + vH * 1.1;
                // shoreline foam and lapping lines
                float ang = atan(p.y, p.x);
                float edgeN = noise(vec2(ang * 9.0, uTime * 0.7));
                float foam = 1.0 - smoothstep(0.05, 0.4 + edgeN * 0.6, d);
                float lines = smoothstep(0.82, 1.0, sin(d * 2.4 - uTime * 2.6 + edgeN * 2.5)) * (1.0 - smoothstep(0.6, 4.5, d));
                foam = max(foam, lines * 0.75);
                // splash ripples
                for (int i = 0; i < 8; i++) {
                    vec4 rp = uRip[i];
                    if (rp.w <= 0.0) continue;
                    float rr = length(p - rp.xy);
                    float front = rp.z * 5.5;
                    float ring = exp(-pow((rr - front) * 1.5, 2.0)) + 0.6 * exp(-pow((rr - front * 0.55) * 2.0, 2.0));
                    foam = max(foam, ring * rp.w * clamp(1.0 - rp.z / 1.8, 0.0, 1.0));
                }
                // sun glitter
                float g = noise(p * 2.3 + vec2(uTime * 0.45, uTime * 0.3)) * noise(p * 1.6 - vec2(uTime * 0.3, 0.0));
                col += uGlint * smoothstep(0.62, 0.75, g) * 0.3;
                vec3 V = normalize(cameraPosition - vW);
                float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
                col = mix(col, uSky, fr * 0.7);
                col = mix(col, uFoam, clamp(foam, 0.0, 1.0));
                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                #include <fog_fragment>
            }`,
        fog: true,
    });
    water = new THREE.Mesh(geo, mat);
    water.position.y = WATER_Y;
    scene.add(water);
}

export function ripple(x, z, strength = 1) {
    ripples.push({ x, z, t: 0, s: strength });
    if (ripples.length > 8) ripples.shift();
}

function updateWater(dt) {
    const u = water.material.uniforms;
    u.uTime.value = time;
    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].t += dt;
        if (ripples[i].t > 1.8) ripples.splice(i, 1);
    }
    for (let i = 0; i < 8; i++) {
        const r = ripples[i];
        if (r) u.uRip.value[i].set(r.x, r.z, r.t, r.s); else u.uRip.value[i].w = 0;
    }
}

// Paper lanterns drifting on the water
const lanterns = { body: null, glow: null, list: [] };
function buildLanterns() {
    const n = 18;
    const bodyGeo = new THREE.CylinderGeometry(0.42, 0.34, 0.75, 10);
    lanterns.body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.28) }), n);
    const gg = new THREE.PlaneGeometry(1, 1);
    gg.rotateX(-Math.PI / 2);
    lanterns.glow = new THREE.InstancedMesh(gg, new THREE.MeshBasicMaterial({ map: getGlowTex(), color: 0xffa050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }), n);
    lanterns.body.frustumCulled = lanterns.glow.frustumCulled = false;
    for (let i = 0; i < n; i++) lanterns.list.push({ a: rand(0, TAU), r: rand(27, 58), ph: rand(0, TAU), sp: rand(0.006, 0.014) * (Math.random() < 0.5 ? -1 : 1) });
    scene.add(lanterns.body, lanterns.glow);
}

function updateLanterns(dt) {
    lanterns.list.forEach((l, i) => {
        l.a += l.sp * dt;
        const x = Math.cos(l.a) * l.r, z = Math.sin(l.a) * l.r;
        _o.position.set(x, WATER_Y + 0.25 + Math.sin(time * 1.3 + l.ph) * 0.08, z);
        _o.rotation.set(Math.sin(time + l.ph) * 0.08, 0, Math.cos(time * 0.9 + l.ph) * 0.08);
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        lanterns.body.setMatrixAt(i, _o.matrix);
        _o.position.y = WATER_Y + 0.12;
        _o.rotation.set(0, 0, 0);
        _o.scale.set(3.2, 1, 3.2);
        _o.updateMatrix();
        lanterns.glow.setMatrixAt(i, _o.matrix);
    });
    lanterns.body.instanceMatrix.needsUpdate = true;
    lanterns.glow.instanceMatrix.needsUpdate = true;
}

// ============================================================
// Hanging roof (tsuriyane). Lowered over the ring in menus, hoisted out of view in play.
// ============================================================
let roof;
function buildRoof() {
    roof = new THREE.Group();
    const W = 23;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3326, roughness: 0.8 });
    const thatch = new THREE.MeshStandardMaterial({ color: 0x5a4436, roughness: 0.95, side: THREE.DoubleSide });
    const purple = new THREE.MeshStandardMaterial({ color: 0x5a2a7c, roughness: 0.7 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const band = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 0.6, 1.5, 0.3), purple);
        band.position.set(Math.sin(a) * W, 0.75, Math.cos(a) * W);
        band.rotation.y = a;
        roof.add(band);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 0.8, 0.25, 0.4), gold);
        trim.position.set(Math.sin(a) * W, 1.6, Math.cos(a) * W);
        trim.rotation.y = a;
        roof.add(trim);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 1, 0.4, 2 * W + 1), wood);
    ceil.position.y = 1.9;
    roof.add(ceil);
    const sh = new THREE.Shape();
    sh.moveTo(-W - 2.5, 0); sh.lineTo(W + 2.5, 0); sh.lineTo(0, 7); sh.closePath();
    const gable = new THREE.ExtrudeGeometry(sh, { depth: 2 * W + 4, bevelEnabled: false });
    gable.translate(0, 0, -(W + 2));
    const top = new THREE.Mesh(gable, thatch);
    top.position.y = 2.1;
    roof.add(top);
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2 * W + 5, 10), wood);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.y = 9.2;
    roof.add(ridge);
    for (let i = -2; i <= 2; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 10), gold);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 9.9, i * 8);
        roof.add(log);
    }
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
        const chigi = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.3), wood);
        chigi.position.set(sx * 1.1, 10.4, sz * (W + 2));
        chigi.rotation.z = sx * -0.55;
        roof.add(chigi);
    }
    // Four coloured tassels (fusa) at the corners
    const cols = [0x2f8f5b, 0xc0392b, 0xf2eee4, 0x26221f];
    const rope = new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6);
    const knot = new THREE.SphereGeometry(0.42, 12, 10);
    const tassel = new THREE.ConeGeometry(0.62, 2.6, 14);
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], i) => {
        const mat = new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.85 });
        const g = new THREE.Group();
        g.position.set(sx * W, 0, sz * W);
        const r = new THREE.Mesh(rope, mat); r.position.y = -1.2; g.add(r);
        const k = new THREE.Mesh(knot, mat); k.position.y = -2.5; g.add(k);
        const t = new THREE.Mesh(tassel, mat); t.position.y = -3.9; g.add(t);
        roof.add(g);
    });
    // Suspension cables
    const cable = new THREE.CylinderGeometry(0.06, 0.06, 60, 4);
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const c = new THREE.Mesh(cable, wood);
        c.position.set(sx * W * 0.7, 32, sz * W * 0.7);
        roof.add(c);
    }
    roof.position.y = 16;
    scene.add(roof);
}

// ============================================================
// Dohyo (ring)
// ============================================================
const ring = { r: RING_R, top: null, side: null, bales: null, danger: null, dangerKey: '', clayTex: null, sideTex: null, segMat: null };

function buildDohyo() {
    const grp = new THREE.Group();
    scene.add(grp);
    ring.clayTex = clayTexture();
    const topGeo = new THREE.RingGeometry(0, RING_R, 128, 10);
    topGeo.rotateX(-Math.PI / 2);
    const pos = topGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i), pos.getZ(i)) / RING_R;
        const k = 1.05 - 0.22 * d * d * d;
        col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
    }
    topGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ring.top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map: ring.clayTex, vertexColors: true, roughness: 0.92 }));
    ring.top.receiveShadow = true;
    grp.add(ring.top);

    ring.sideTex = moundTexture();
    const sideGeo = new THREE.CylinderGeometry(RING_R, RING_R + FLARE, MOUND_H, 128, 1, true);
    ring.side = new THREE.Mesh(sideGeo, new THREE.MeshStandardMaterial({ map: ring.sideTex, roughness: 1 }));
    ring.side.position.y = -MOUND_H / 2;
    ring.side.receiveShadow = true;
    grp.add(ring.side);

    // Shikiri-sen: the two white start lines
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ef, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const lineGeo = new THREE.PlaneGeometry(0.2, 2.1);
    lineGeo.rotateX(-Math.PI / 2);
    for (const sx of [-1, 1]) {
        const l = new THREE.Mesh(lineGeo, lineMat);
        l.position.set(sx * 1.4, 0.01, 0);
        l.receiveShadow = true;
        grp.add(l);
    }

    // Tawara: straw bales around the edge
    const baleGeo = new THREE.CapsuleGeometry(BALE_R, 1, 3, 10);
    baleGeo.rotateZ(Math.PI / 2);
    ring.bales = new THREE.InstancedMesh(baleGeo, new THREE.MeshStandardMaterial({ map: strawTexture(), roughness: 0.85 }), MAX_BALES);
    ring.bales.castShadow = ring.bales.receiveShadow = true;
    ring.bales.frustumCulled = false;
    for (let i = 0; i < MAX_BALES; i++) {
        const k = rand(0.82, 1.04);
        ring.bales.setColorAt(i, _c.setRGB(k, k * 0.97, k * 0.92));
    }
    grp.add(ring.bales);

    // Pulsing warning over the part of the ring that is about to crumble
    ring.danger = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    }));
    ring.danger.position.y = 0.02;
    ring.danger.visible = false;
    grp.add(ring.danger);

    const segTex = ring.clayTex.clone();
    segTex.repeat.set(0.1, 0.1);
    segTex.offset.set(0, 0);
    segTex.needsUpdate = true;
    ring.segMat = new THREE.MeshStandardMaterial({ map: segTex, color: 0xdcc8b4, roughness: 1, flatShading: true });
    setRingRadius(RING_R);
}

// The ring's visible edge always sits exactly at radius r (the physics edge).
export function setRingRadius(r, withFx) {
    const old = ring.r;
    ring.r = r;
    const s = r / RING_R;
    ring.top.scale.set(s, 1, s);
    ring.side.scale.set(s, 1, s);
    // Keep the clay texture the same size in world space as the ring scales
    const k = 2 * RING_R * s / 10;
    ring.clayTex.repeat.set(k, k);
    ring.clayTex.offset.set(-k / 2, -k / 2);
    ring.sideTex.repeat.set(Math.max(2, Math.round(24 * s)), 1);

    const rb = r - BALE_R - 0.02;
    const n = Math.min(MAX_BALES, Math.max(12, Math.round(TAU * rb / BALE_SPACING)));
    const len = TAU * rb / n - 0.1;
    for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * TAU;
        _o.position.set(Math.cos(a) * rb, 0.14, Math.sin(a) * rb);
        _o.rotation.set(0, -a - Math.PI / 2, 0);
        _o.scale.set(len / (1 + 2 * BALE_R), 0.78, 1);
        _o.updateMatrix();
        ring.bales.setMatrixAt(i, _o.matrix);
    }
    ring.bales.count = n;
    ring.bales.instanceMatrix.needsUpdate = true;
    water.material.uniforms.uShore.value = s * (RING_R + FLARE * (-WATER_Y / MOUND_H));
    ring.dangerKey = '';
    if (withFx && r < old - 0.01) crumble(old, r);
}

// level 0..1 = how close the next shrink is; nextR = radius after it
export function setDanger(level, nextR) {
    if (level <= 0 || nextR >= ring.r) { ring.danger.visible = false; return; }
    const key = nextR.toFixed(2) + ':' + ring.r.toFixed(2);
    if (ring.dangerKey !== key) {
        ring.dangerKey = key;
        ring.danger.geometry.dispose();
        const g = new THREE.RingGeometry(nextR, ring.r, 128, 3);
        g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
            const t = (Math.hypot(p.getX(i), p.getZ(i)) - nextR) / (ring.r - nextR);
            col[i * 3] = 1.0 * (0.25 + 0.75 * t); col[i * 3 + 1] = 0.16 * (0.25 + 0.75 * t); col[i * 3 + 2] = 0.05;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        ring.danger.geometry = g;
    }
    ring.danger.visible = true;
    const pulse = 0.5 + 0.5 * Math.sin(time * (5 + level * 12));
    ring.danger.material.opacity = (0.3 + 0.7 * pulse) * (0.4 + 0.6 * level);
}

// Outer band breaks into chunks that tumble into the water
const segs = [];
function crumble(oldR, newR) {
    const n = Math.max(10, Math.round(oldR * 0.9));
    for (let i = 0; i < n; i++) {
        const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, mid = (a0 + a1) / 2, rm = (oldR + newR) / 2;
        const sh = new THREE.Shape();
        sh.absarc(0, 0, oldR, a0, a1, false);
        sh.absarc(0, 0, newR, a1, a0, true);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false, curveSegments: 3 });
        geo.rotateX(Math.PI / 2);
        const cx = Math.cos(mid) * rm, cz = Math.sin(mid) * rm;
        geo.translate(-cx, 0.8, -cz);
        const m = new THREE.Mesh(geo, ring.segMat);
        m.position.set(cx, -0.8, cz);
        m.castShadow = true;
        scene.add(m);
        segs.push({ m, delay: rand(0, 0.12), vy: -1, ox: Math.cos(mid), oz: Math.sin(mid), tx: -Math.sin(mid), tz: Math.cos(mid), spin: rand(0.8, 2), splashed: false });
    }
    for (let i = 0; i < n * 2; i++) {
        const a = Math.random() * TAU, rr = rand(newR, oldR), sp = rand(1, 3);
        dust(Math.cos(a) * rr, 0.2, Math.sin(a) * rr, 1, 0.3, 1.5, 0.5);
        pools.chunk.add(Math.cos(a) * rr, 0.1, Math.sin(a) * rr, Math.cos(a) * sp, rand(2, 5), Math.sin(a) * sp, rand(1.2, 2), rand(0.12, 0.28), 0xa8744a, { grav: 22, spin: rand(-8, 8), water: true, curve: 2 });
    }
    shake(0.35);
}

const _axis = new THREE.Vector3();
function updateSegs(dt) {
    for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        s.delay -= dt;
        if (s.delay > 0) continue;
        s.vy -= 22 * dt;
        s.m.position.y += s.vy * dt;
        s.m.position.x += s.ox * 1.6 * dt;
        s.m.position.z += s.oz * 1.6 * dt;
        _axis.set(s.tx, 0, s.tz);
        s.m.rotateOnWorldAxis(_axis, -s.spin * dt);
        if (!s.splashed && s.m.position.y < WATER_Y) {
            s.splashed = true;
            if (Math.random() < 0.5) splash(s.m.position.x, s.m.position.z, 0.4);
        }
        if (s.m.position.y < WATER_Y - 6) {
            scene.remove(s.m);
            s.m.geometry.dispose();
            segs.splice(i, 1);
        }
    }
}

// Players standing on the straw bales ride up a little; beyond the edge they sink
export function edgeLift(d) {
    const r = ring.r;
    return 0.24 * smooth(r - 0.85, r - 0.45, d) - 0.3 * smooth(r, r + 0.5, d);
}
export function edgeTeeter(d) { return smooth(ring.r - 0.3, ring.r + 0.35, d); }

// ============================================================
// Particles
// ============================================================
class Pool {
    constructor(geo, mat, max) {
        this.mesh = new THREE.InstancedMesh(geo, mat, max);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.setColorAt(0, _c.set(0xffffff));
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.max = max;
        this.list = [];
        scene.add(this.mesh);
    }
    add(x, y, z, vx, vy, vz, life, size, color, o = {}) {
        if (this.list.length >= this.max) this.list.shift();
        _c.set(color);
        this.list.push({
            x, y, z, vx, vy, vz, life, max: life, size, r: _c.r, g: _c.g, b: _c.b,
            grav: o.grav || 0, drag: o.drag || 0, curve: o.curve || 0, spin: o.spin || 0, water: !!o.water,
            rx: Math.random() * TAU, ry: Math.random() * TAU, ax: o.ax || 1, ay: o.ay || 1, az: o.az || 1,
        });
    }
    clear() { this.list.length = 0; this.mesh.count = 0; }
    update(dt) {
        const L = this.list;
        for (let i = L.length - 1; i >= 0; i--) {
            const p = L[i];
            p.life -= dt;
            if (p.life <= 0 || (p.water && p.y < WATER_Y - 0.2 && p.vy < 0)) { L[i] = L[L.length - 1]; L.pop(); continue; }
            p.vy -= p.grav * dt;
            const dr = Math.max(0, 1 - p.drag * dt);
            p.vx *= dr; p.vy *= dr; p.vz *= dr;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
        }
        for (let i = 0; i < L.length; i++) {
            const p = L[i], k = 1 - p.life / p.max;
            let s;
            if (p.curve === 1) s = Math.min(1, k * 7) * Math.pow(1 - k, 0.8);
            else if (p.curve === 2) s = k < 0.75 ? 1 : (1 - k) / 0.25;
            else s = 1 - k;
            s *= p.size;
            _o.position.set(p.x, p.y, p.z);
            _o.rotation.set(p.rx, p.ry, 0);
            _o.scale.set(s * p.ax, s * p.ay, s * p.az);
            _o.updateMatrix();
            this.mesh.setMatrixAt(i, _o.matrix);
            this.mesh.setColorAt(i, _c.setRGB(p.r, p.g, p.b));
        }
        this.mesh.count = L.length;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
    }
}

const pools = {};
const waves = [];
const flashes = [];
function buildPools() {
    pools.dust = new Pool(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 180);
    pools.chunk = new Pool(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 140);
    pools.drop = new Pool(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true, emissive: 0x335566 }), 220);
    pools.spark = new Pool(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 100);
    pools.confetti = new Pool(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: 0x222222 }), 240);
    const waveGeo = new THREE.RingGeometry(0.8, 1, 40);
    waveGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        m.visible = false;
        scene.add(m);
        waves.push({ m, t: 1, dur: 0.4, size: 3 });
    }
    for (let i = 0; i < 4; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        sp.visible = false;
        scene.add(sp);
        flashes.push({ sp, t: 1, dur: 0.25, size: 3 });
    }
}

function wave(x, y, z, size, color, dur) {
    const w = waves.reduce((a, b) => (b.t / b.dur > a.t / a.dur ? b : a));
    w.t = 0; w.dur = dur; w.size = size;
    w.m.position.set(x, y, z);
    w.m.material.color.set(color);
    w.m.visible = true;
}

function flash(x, y, z, size, color) {
    const f = flashes.reduce((a, b) => (b.t / b.dur > a.t / a.dur ? b : a));
    f.t = 0; f.size = size;
    f.sp.position.set(x, y, z);
    f.sp.material.color.set(color);
    f.sp.visible = true;
}

function updateOneShots(dt) {
    for (const w of waves) {
        if (!w.m.visible) continue;
        w.t += dt;
        const k = w.t / w.dur;
        if (k >= 1) { w.m.visible = false; continue; }
        const s = 0.3 + (1 - Math.pow(1 - k, 3)) * w.size;
        w.m.scale.set(s, 1, s);
        w.m.material.opacity = 1 - k;
    }
    for (const f of flashes) {
        if (!f.sp.visible) continue;
        f.t += dt;
        const k = f.t / f.dur;
        if (k >= 1) { f.sp.visible = false; continue; }
        f.sp.scale.setScalar(f.size * (0.5 + k));
        f.sp.material.opacity = 1 - k;
    }
}

export function dust(x, y, z, n, spread, speed, size, color = DUST_COL) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = speed * rand(0.4, 1), sr = spread * Math.random();
        pools.dust.add(x + Math.cos(a) * sr, y, z + Math.sin(a) * sr, Math.cos(a) * sp, rand(0.5, 1.5), Math.sin(a) * sp, rand(0.45, 0.85), size * rand(0.7, 1.3), color, { drag: 3, grav: -0.6, curve: 1 });
    }
}

export function impact(x, y, z, strong) {
    const n = strong ? 16 : 9;
    for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = rand(5, strong ? 13 : 9);
        pools.spark.add(x, y, z, Math.cos(a) * sp, rand(1, 6), Math.sin(a) * sp, rand(0.2, 0.4), rand(0.1, 0.2), Math.random() < 0.5 ? 0xffe9a8 : 0xffffff, { drag: 4, grav: 10, ax: 1, ay: 1, az: 2.4 });
    }
    wave(x, 0.35, z, strong ? 3.6 : 2.4, 0xfff0c8, 0.35);
    flash(x, y, z, strong ? 4 : 2.6, 0xfff2cc);
    dust(x, 0.2, z, strong ? 8 : 4, 0.6, 3, 0.45);
}

export function splash(x, z, big = 1) {
    const n = Math.round(46 * big);
    for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = rand(0.8, 4.2) * Math.sqrt(big);
        pools.drop.add(x + Math.cos(a) * 0.4, WATER_Y + 0.2, z + Math.sin(a) * 0.4, Math.cos(a) * sp, rand(5, 12) * Math.sqrt(big), Math.sin(a) * sp, 2, rand(0.08, 0.2) * (0.6 + big * 0.4), Math.random() < 0.6 ? 0xeaf8ff : 0x7fd0ea, { grav: 24, water: true, curve: 2, ay: 1.8 });
    }
    for (let i = 0; i < 10 * big; i++) {
        const a = Math.random() * TAU, rr = rand(0.5, 1.6) * big;
        pools.dust.add(x + Math.cos(a) * rr, WATER_Y + 0.25, z + Math.sin(a) * rr, Math.cos(a) * 2, rand(0.5, 1.5), Math.sin(a) * 2, rand(0.6, 1.1), rand(0.4, 0.8) * big, 0xf6fcff, { drag: 2.5, curve: 1 });
    }
    wave(x, WATER_Y + 0.3, z, 3.5 * big, 0x8fb8c8, 0.6);
    ripple(x, z, Math.min(1, big));
}

export function sparkle(x, y, z, color) {
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * TAU, sp = rand(2, 6);
        pools.spark.add(x, y, z, Math.cos(a) * sp, rand(1, 6), Math.sin(a) * sp, rand(0.35, 0.6), rand(0.1, 0.18), i % 3 ? color : 0xffffff, { drag: 3, grav: 4 });
    }
    wave(x, 0.3, z, 2.4, color, 0.45);
    flash(x, y, z, 3, color);
}

export function confetti(x, z) {
    for (let i = 0; i < 150; i++) {
        const a = Math.random() * TAU, sp = rand(2, 9);
        pools.confetti.add(x + rand(-0.5, 0.5), rand(4, 6), z + rand(-0.5, 0.5), Math.cos(a) * sp, rand(4, 11), Math.sin(a) * sp, rand(2.6, 4), rand(0.2, 0.3), CONFETTI_COLS[i % CONFETTI_COLS.length], { grav: 7, drag: 1.6, spin: rand(-10, 10), curve: 2 });
    }
}

export function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
export function getShake() { return shakeOff; }

// ============================================================
// Wrestlers
// ============================================================
const WG = {};
const matCache = new Map();
function cachedMat(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }

function colored(geo, color) {
    _c.set(color);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
}

function wrestlerGeos() {
    if (WG.belly) return WG;
    WG.belly = new THREE.SphereGeometry(0.88, 28, 20);
    WG.belt = new THREE.CylinderGeometry(0.87, 0.8, 0.38, 28);
    WG.head = new THREE.SphereGeometry(0.42, 22, 16);
    const arm = new THREE.CapsuleGeometry(0.2, 0.42, 4, 10); arm.translate(0, -0.36, 0);
    const hand = new THREE.SphereGeometry(0.21, 12, 10); hand.translate(0, -0.72, 0);
    WG.arm = mergeGeometries([arm, hand]);
    const leg = new THREE.CapsuleGeometry(0.28, 0.22, 4, 10); leg.translate(0, -0.26, 0);
    const foot = new THREE.SphereGeometry(0.26, 12, 8); foot.scale(1, 0.5, 1.35); foot.translate(0, -0.5, 0.08);
    WG.leg = mergeGeometries([leg, foot]);
    const cap = new THREE.SphereGeometry(0.445, 22, 12, 0, TAU, 0, 1.3); cap.rotateX(-0.5);
    const knot = new THREE.CapsuleGeometry(0.085, 0.3, 4, 8); knot.rotateX(Math.PI / 2); knot.translate(0, 0.47, 0.03);
    const bun = new THREE.SphereGeometry(0.12, 10, 8); bun.translate(0, 0.43, -0.17);
    WG.hair = mergeGeometries([cap, knot, bun]);
    const face = [];
    for (const sx of [-1, 1]) {
        const eye = new THREE.SphereGeometry(0.06, 10, 8); eye.scale(1, 1.25, 0.55); eye.translate(sx * 0.15, 0.06, 0.385);
        face.push(colored(eye, 0x1a1210));
        const glint = new THREE.SphereGeometry(0.02, 6, 4); glint.translate(sx * 0.15 + 0.02, 0.09, 0.415);
        face.push(colored(glint, 0xffffff));
        const brow = new THREE.BoxGeometry(0.17, 0.045, 0.05); brow.rotateZ(sx * -0.22); brow.translate(sx * 0.16, 0.19, 0.35);
        face.push(colored(brow, 0x1a1210));
        const cheek = new THREE.SphereGeometry(0.075, 10, 6); cheek.scale(1, 0.65, 0.35); cheek.translate(sx * 0.25, -0.05, 0.335);
        face.push(colored(cheek, 0xf0857a));
    }
    const mouth = new THREE.TorusGeometry(0.08, 0.024, 6, 14, Math.PI); mouth.rotateZ(Math.PI); mouth.translate(0, -0.1, 0.4);
    face.push(colored(mouth, 0x7a2320));
    const nose = new THREE.SphereGeometry(0.06, 10, 8); nose.translate(0, -0.01, 0.415);
    face.push(colored(nose, 0xe29a78));
    WG.face = mergeGeometries(face);
    // Mawashi extras: hanging sagari strands, front panel and back knot
    const bits = [];
    for (let i = 0; i < 7; i++) {
        const s = new THREE.CylinderGeometry(0.032, 0.03, 0.44, 5);
        s.translate(-0.3 + i * 0.1, 0.22, 0.8 - Math.abs(i - 3) * 0.02);
        bits.push(s);
    }
    const panel = new THREE.BoxGeometry(0.34, 0.34, 0.08); panel.translate(0, 0.3, 0.74); bits.push(panel);
    const bow = new THREE.BoxGeometry(0.44, 0.34, 0.2); bow.translate(0, 0.62, -0.82); bits.push(bow);
    WG.sagari = mergeGeometries(bits);
    WG.ring = new THREE.RingGeometry(0.98, 1.22, 40); WG.ring.rotateX(-Math.PI / 2);
    WG.disc = new THREE.CircleGeometry(0.98, 32); WG.disc.rotateX(-Math.PI / 2);
    WG.marker = new THREE.ConeGeometry(0.22, 0.4, 4); WG.marker.rotateX(Math.PI);
    WG.shield = new THREE.SphereGeometry(1.5, 24, 16);
    WG.hairMat = new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 0.45 });
    WG.faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
    WG.shieldMat = new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(0x5affd0) } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
            void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uCol; varying vec3 vN; varying vec3 vV;
            void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uCol, 0.08 + f * 0.8); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    return WG;
}

export function buildWrestler(color, idx = 0) {
    const G = wrestlerGeos();
    const skin = cachedMat('skin' + (idx % SKIN_TONES.length), () => new THREE.MeshStandardMaterial({ color: SKIN_TONES[idx % SKIN_TONES.length], roughness: 0.55 }));
    const belt = cachedMat('belt' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.14 }));
    const ringMat = cachedMat('ring' + color, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    const discMat = cachedMat('disc' + color, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));

    const root = new THREE.Group();
    const tilt = new THREE.Group(); root.add(tilt);
    const body = new THREE.Group(); tilt.add(body);
    const squash = new THREE.Group(); body.add(squash);
    const mk = (geo, mat, parent, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = shadow; parent.add(m); return m; };

    const belly = mk(G.belly, skin, squash); belly.position.y = 1.08; belly.scale.set(1.05, 0.95, 0.95);
    const beltM = mk(G.belt, belt, squash); beltM.position.y = 0.6; beltM.scale.set(1.06, 1, 0.97);
    mk(G.sagari, belt, squash, false);
    const head = new THREE.Group(); head.position.y = 2.0; squash.add(head);
    mk(G.head, skin, head);
    mk(G.hair, G.hairMat, head);
    mk(G.face, G.faceMat, head, false);
    const limb = (geo, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); squash.add(p); mk(geo, skin, p); return p; };
    const armL = limb(G.arm, 0.84, 1.45, 0.02), armR = limb(G.arm, -0.84, 1.45, 0.02);
    const legL = limb(G.leg, 0.42, 0.62, 0), legR = limb(G.leg, -0.42, 0.62, 0);

    const ringM = mk(G.ring, ringMat, root, false); ringM.position.y = 0.04; ringM.renderOrder = 1;
    const disc = mk(G.disc, discMat, root, false); disc.position.y = 0.035; disc.renderOrder = 1;
    const marker = mk(G.marker, ringMat, root, false); marker.position.y = 3.2; marker.visible = false;
    const shield = mk(G.shield, G.shieldMat, root, false); shield.position.y = 1.2; shield.visible = false;

    root.userData.parts = { tilt, body, squash, head, armL, armR, legL, legR, ring: ringM, disc, marker, shield };
    root.userData.a = {
        t: Math.random() * 10, yaw: 0, move: 0, phase: Math.random() * TAU, side: 1, dash: 0, wasDash: false, trailT: 0,
        sq: 0, sqV: 0, wobble: 0, edge: 0, big: 1.14, pu: null, puT: 0, lastHit: -9, cheer: 0, stomp: 0, stompSide: 1, fall: null,
    };
    return root;
}

export function setMarker(m, on) { m.userData.parts.marker.visible = on; }
export function setPowerupVisual(m, type) { const a = m.userData.a; a.pu = type; a.puT = 5; }

function footPos(m, side) {
    const y = m.userData.a.yaw;
    return [m.position.x + Math.cos(y) * 0.42 * side, m.position.z - Math.sin(y) * 0.42 * side];
}

// s: { speed, dashing, yaw, edge }
export function animateWrestler(m, s, dt) {
    const a = m.userData.a, P = m.userData.parts;
    a.t += dt;
    const t = a.t;
    let dy = s.yaw - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yaw += dy * Math.min(1, dt * (s.dashing ? 22 : 11));
    m.rotation.y = a.yaw;

    a.move = lerp(a.move, clamp(s.speed / 12, 0, 1.4), Math.min(1, dt * 8));
    const mv = Math.min(1, a.move);
    a.phase += dt * (2.5 + a.move * 9);
    const st = Math.sin(a.phase);
    const side = st >= 0 ? 1 : -1;
    const fwdX = Math.sin(a.yaw), fwdZ = Math.cos(a.yaw);
    if (side !== a.side) {
        a.side = side;
        if (mv > 0.3) {
            const [fx, fz] = footPos(m, side);
            dust(fx, 0.1 + m.position.y, fz, a.pu === 'heavy' ? 4 : 2, 0.2, 1.3, a.pu === 'heavy' ? 0.34 : 0.24);
        }
    }

    // Dash: burst of dust behind and a short trail
    if (s.dashing && !a.wasDash) {
        dust(m.position.x - fwdX * 0.6, 0.2, m.position.z - fwdZ * 0.6, 10, 0.5, 4, 0.45);
        wave(m.position.x, 0.25, m.position.z, 2.2, 0xffe6bf, 0.3);
        a.sq = -0.16; a.sqV = 0;
    }
    a.wasDash = s.dashing;
    a.trailT -= dt;
    if (a.trailT <= 0) {
        if (s.dashing) { a.trailT = 0.035; dust(m.position.x - fwdX * 0.7, 0.2, m.position.z - fwdZ * 0.7, 1, 0.3, 1, 0.42); }
        else if (a.pu === 'speed' && mv > 0.4) { a.trailT = 0.06; dust(m.position.x - fwdX * 0.6, 0.6, m.position.z - fwdZ * 0.6, 1, 0.3, 0.6, 0.35, 0x8cc4ff); }
    }
    a.dash = s.dashing ? Math.min(1, a.dash + dt * 12) : Math.max(0, a.dash - dt * 3.5);
    a.wobble = Math.max(0, a.wobble - dt * 1.5);
    a.edge = lerp(a.edge, s.edge || 0, Math.min(1, dt * 8));
    a.cheer = Math.max(0, a.cheer - dt * 0.12);
    if (a.puT > 0) { a.puT -= dt; if (a.puT <= 0) a.pu = null; }

    // Squash and stretch spring
    a.sqV += (-170 * a.sq - 11 * a.sqV) * dt;
    a.sq += a.sqV * dt;

    // Shiko stomp (idle scene)
    let raise = 0;
    if (a.stomp > 0) {
        const pk = a.stomp;
        a.stomp += dt / 1.4;
        raise = pk < 0.55 ? Math.sin(pk / 0.55 * Math.PI / 2) : pk < 0.7 ? 1 : Math.max(0, 1 - (pk - 0.7) / 0.1);
        if (pk < 0.8 && a.stomp >= 0.8) {
            const [fx, fz] = footPos(m, a.stompSide);
            dust(fx, 0.15, fz, 10, 0.4, 3, 0.45);
            wave(fx, 0.2, fz, 2, 0xffe6bf, 0.35);
            a.sq = 0.22; a.sqV = 0;
        }
        if (a.stomp >= 1) a.stomp = 0;
    }

    const hop = a.cheer > 0 ? Math.abs(Math.sin(t * 7)) * 0.5 * Math.min(1, a.cheer * 3) : 0;
    P.body.position.y = Math.abs(Math.cos(a.phase)) * 0.14 * mv + hop;
    const lean = 0.2 * mv + 0.4 * a.dash;
    P.tilt.rotation.x = lerp(P.tilt.rotation.x, lean, Math.min(1, dt * 10));
    P.tilt.rotation.z = Math.sin(a.phase) * 0.08 * mv + Math.sin(t * 22) * 0.28 * a.wobble + Math.sin(t * 9) * 0.22 * a.edge - a.stompSide * 0.22 * raise;
    const sq = a.sq, ds = a.dash;
    P.squash.scale.set((1 + sq * 0.6) * (1 - 0.1 * ds), (1 - sq) * (1 - 0.05 * ds), (1 + sq * 0.6) * (1 + 0.2 * ds));

    // Legs: waddle steps, stomp raise
    const legSwing = st * 0.65 * mv;
    P.legL.rotation.set(-legSwing, 0, a.stompSide > 0 ? raise * 1.15 : 0);
    P.legR.rotation.set(legSwing, 0, a.stompSide < 0 ? -raise * 1.15 : 0);
    P.legL.position.y = 0.62 + Math.max(0, st) * 0.14 * mv;
    P.legR.position.y = 0.62 + Math.max(0, -st) * 0.14 * mv;

    // Arms: swing, flail when hit or teetering, thrust forward in a dash, up when cheering
    const swing = st * 0.45 * mv;
    let axL = swing, axR = -swing, az = 0.4 + Math.sin(t * 2.2) * 0.04 + raise * 0.5;
    const fl = Math.max(a.wobble, a.edge);
    axL += Math.sin(t * 15) * 1.3 * fl;
    axR += Math.sin(t * 15 + Math.PI) * 1.3 * fl;
    az += fl * 0.7;
    const ch = Math.min(1, a.cheer * 3);
    axL = lerp(axL, -2.7 + Math.sin(t * 9) * 0.3, ch);
    axR = lerp(axR, -2.7 + Math.sin(t * 9 + 1) * 0.3, ch);
    axL = lerp(axL, -1.5, ds); axR = lerp(axR, -1.5, ds); az = lerp(az, 0.12, ds);
    P.armL.rotation.set(axL, 0, az);
    P.armR.rotation.set(axR, 0, -az);
    P.head.rotation.set(-0.12 * ds + Math.sin(t * 1.7) * 0.03, 0, Math.sin(t * 20) * 0.15 * a.wobble);

    a.big = lerp(a.big, a.pu === 'heavy' ? 1.32 : 1.14, Math.min(1, dt * 6));
    m.scale.setScalar(a.big);
    P.shield.visible = a.pu === 'shield';
    if (P.shield.visible) P.shield.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
    P.marker.position.y = 3.2 + Math.sin(t * 4) * 0.12;
    P.marker.rotation.y += dt * 2;
}

export function stomp(m, side) { const a = m.userData.a; if (a.stomp <= 0) { a.stomp = 0.001; a.stompSide = side; } }

// Hit reaction for the struck wrestler (and a smaller one for the hitter)
export function hit(fm, tm, shakeScale) {
    if (!tm) return;
    const a = tm.userData.a;
    if (a.t - a.lastHit < 0.25) return;
    a.lastHit = a.t;
    a.sq = 0.32; a.sqV = 0; a.wobble = 1;
    let x = tm.position.x, z = tm.position.z;
    let strong = false;
    if (fm) {
        x = (x + fm.position.x) / 2; z = (z + fm.position.z) / 2;
        const b = fm.userData.a;
        strong = b.dash > 0.3;
        b.sq = 0.18; b.sqV = 0;
    }
    if (a.pu === 'shield' && a.puT > 0) {
        a.puT = 0; a.pu = null;
        sparkle(tm.position.x, 1.2, tm.position.z, PU_COLORS.shield);
    }
    impact(x, 1.0, z, strong);
    shake(shakeScale * (strong ? 1.4 : 1));
}

export function startFall(m, vx, vz) {
    const a = m.userData.a;
    if (a.fall) return;
    const d = Math.hypot(m.position.x, m.position.z) || 1;
    let fx = vx * 0.5 + m.position.x / d * 3.2, fz = vz * 0.5 + m.position.z / d * 3.2;
    const sp = Math.hypot(fx, fz);
    if (sp > 10) { fx *= 10 / sp; fz *= 10 / sp; }
    a.fall = { vx: fx, vz: fz, vy: 4.5, t: 0, splashed: false };
    a.pu = null; a.puT = 0;
    const P = m.userData.parts;
    P.ring.visible = P.disc.visible = P.shield.visible = P.marker.visible = false;
    dust(m.position.x, 0.2, m.position.z, 6, 0.5, 2.5, 0.4);
}

export function updateFall(m, dt) {
    const a = m.userData.a, f = a.fall, P = m.userData.parts;
    if (!f || !m.visible) return;
    f.t += dt; a.t += dt;
    const t = a.t;
    if (!f.splashed) {
        m.position.x += f.vx * dt;
        m.position.z += f.vz * dt;
        f.vy -= 26 * dt;
        m.position.y += f.vy * dt;
        P.tilt.rotation.x = Math.min(1.4, P.tilt.rotation.x + dt * 2.4);
        if (m.position.y < WATER_Y + 0.3) {
            f.splashed = true;
            splash(m.position.x, m.position.z, 1.4);
            shake(0.25);
        }
    } else {
        m.position.y -= dt * 3;
        if (m.position.y < WATER_Y - 4) m.visible = false;
    }
    P.squash.scale.set(1, 1, 1);
    P.tilt.rotation.z = Math.sin(t * 11) * 0.25;
    P.armL.rotation.set(-2.6 + Math.sin(t * 20) * 0.6, 0, 0.6 + Math.sin(t * 17) * 0.3);
    P.armR.rotation.set(-2.6 + Math.sin(t * 20 + 2) * 0.6, 0, -0.6 - Math.sin(t * 17 + 1) * 0.3);
    P.legL.rotation.set(Math.sin(t * 18) * 0.9, 0, 0.3);
    P.legR.rotation.set(-Math.sin(t * 18) * 0.9, 0, -0.3);
}

// ============================================================
// Power-ups
// ============================================================
const PG = {};
function puGeo(type) {
    if (PG[type]) return PG[type];
    let g;
    if (type === 'speed') {
        const s = new THREE.Shape();
        s.moveTo(0.14, 0.62); s.lineTo(-0.3, -0.02); s.lineTo(-0.02, -0.02); s.lineTo(-0.16, -0.62); s.lineTo(0.3, 0.08); s.lineTo(0.02, 0.08); s.closePath();
        g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2 });
        g.center();
    } else if (type === 'shield') {
        const s = new THREE.Shape();
        s.moveTo(0, 0.5); s.lineTo(0.42, 0.38); s.lineTo(0.4, -0.02);
        s.quadraticCurveTo(0.32, -0.4, 0, -0.6); s.quadraticCurveTo(-0.32, -0.4, -0.4, -0.02);
        s.lineTo(-0.42, 0.38); s.closePath();
        g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
        g.center();
    } else {
        const ball = new THREE.SphereGeometry(0.36, 18, 14); ball.translate(0, -0.12, 0);
        const handle = new THREE.TorusGeometry(0.22, 0.075, 8, 18); handle.translate(0, 0.3, 0);
        const base = new THREE.CylinderGeometry(0.22, 0.26, 0.1, 16); base.translate(0, -0.46, 0);
        g = mergeGeometries([ball, handle, base]);
    }
    PG[type] = g;
    return g;
}

const beamVS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const beamFS = `uniform vec3 uCol; uniform float uStr, uTop; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float fade = mix(1.0 - vUv.y, 0.25 + 0.75 * vUv.y, uTop);
        gl_FragColor = vec4(uCol, uStr * edge * fade);
    }`;
function beamMat(color, str, top) {
    return new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(color) }, uStr: { value: str }, uTop: { value: top } },
        vertexShader: beamVS, fragmentShader: beamFS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
}

export function buildPowerup(type) {
    const col = PU_COLORS[type] || 0xffffff;
    if (!PG.beam) {
        PG.beam = new THREE.CylinderGeometry(0.55, 0.7, 3.2, 20, 1, true);
        PG.pad = new THREE.RingGeometry(0.55, 0.85, 32); PG.pad.rotateX(-Math.PI / 2);
    }
    const coreMat = cachedMat('pu' + type, () => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.2 }));
    const glowMat = cachedMat('pug' + type, () => new THREE.SpriteMaterial({ map: getGlowTex(), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
    const bMat = cachedMat('pub' + type, () => beamMat(col, 0.55, 0));
    const padMat = cachedMat('pup' + type, () => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    const g = new THREE.Group();
    const item = new THREE.Group();
    item.position.y = 1.35;
    g.add(item);
    const core = new THREE.Mesh(puGeo(type), coreMat);
    core.castShadow = true;
    item.add(core);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(2.2);
    item.add(glow);
    const beam = new THREE.Mesh(PG.beam, bMat);
    beam.position.y = 1.6;
    g.add(beam);
    const pad = new THREE.Mesh(PG.pad, padMat);
    pad.position.y = 0.05;
    g.add(pad);
    g.userData.pu = { item, glow, pad, t: 0, col };
    item.scale.setScalar(0.01);
    return g;
}

export function animatePowerup(g, dt) {
    const u = g.userData.pu;
    if (!u) return;
    if (u.t === 0) sparkle(g.position.x, 1.2, g.position.z, u.col);
    u.t += dt;
    u.item.scale.setScalar(easeOutBack(Math.min(1, u.t * 2.5)));
    u.item.position.y = 1.35 + Math.sin(u.t * 3) * 0.22;
    u.item.rotation.y += dt * 2.2;
    u.glow.scale.setScalar(2.1 + Math.sin(u.t * 6) * 0.25);
    u.pad.scale.setScalar(1 + Math.sin(u.t * 4) * 0.12);
}

export function puColor(type) { return PU_COLORS[type] || 0xffffff; }

// ============================================================
// Winner spotlight
// ============================================================
let spot = null;
function buildSpot() {
    spot = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.3, 18, 28, 1, true), beamMat(0xfff0c8, 0.5, 1));
    cone.position.y = 9;
    spot.add(cone);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshBasicMaterial({ map: getGlowTex(), color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.06;
    spot.add(disc);
    spot.visible = false;
    spot.userData = { target: null, t: 0, cone, disc };
    scene.add(spot);
}

export function celebrate(m) {
    if (!m) return;
    m.userData.a.cheer = 1;
    spot.userData.target = m;
    spot.userData.t = 0;
    spot.visible = true;
    confetti(m.position.x, m.position.z);
}

export function clearRound() {
    spot.visible = false;
    spot.userData.target = null;
    setDanger(0, 0);
    pools.confetti.clear();
}

function updateSpot(dt) {
    if (!spot.visible) return;
    const u = spot.userData;
    u.t += dt;
    const k = Math.min(1, u.t * 3);
    if (u.target) spot.position.set(u.target.position.x, 0, u.target.position.z);
    u.cone.material.uniforms.uStr.value = 0.5 * k;
    u.disc.material.opacity = 0.9 * k;
}

// ============================================================
// Idle scene (menu / lobby backdrop)
// ============================================================
const demo = [];
let demoStompT = 2;
function buildDemo() {
    const cols = ['#e0584f', '#3b82f6'];
    for (let i = 0; i < 2; i++) {
        const m = buildWrestler(cols[i], i * 3);
        m.position.set(i ? 2.4 : -2.4, 0, 0);
        m.userData.a.yaw = i ? -Math.PI / 2 : Math.PI / 2;
        demo.push(m);
        scene.add(m);
    }
}

function updateIdle(dt) {
    demoStompT -= dt;
    if (demoStompT <= 0) {
        demoStompT = rand(2.5, 4);
        stomp(demo[Math.random() < 0.5 ? 0 : 1], Math.random() < 0.5 ? 1 : -1);
    }
    demo.forEach((m, i) => animateWrestler(m, { speed: 0, dashing: false, yaw: i ? -Math.PI / 2 : Math.PI / 2, edge: 0 }, dt));
    const ang = time * 0.05 + 0.5;
    const tall = innerHeight > innerWidth;
    const dist = tall ? 76 : 58;
    camera.position.set(Math.sin(ang) * dist, tall ? 15 : 12, Math.cos(ang) * dist);
    camera.lookAt(0, tall ? 6 : 5, 0);
}

export function setMode(game) {
    gameMode = game;
    for (const m of demo) m.visible = !game;
    if (!game) {
        setRingRadius(RING_R);
        clearRound();
        for (const s of segs) { scene.remove(s.m); s.m.geometry.dispose(); }
        segs.length = 0;
    }
}

// ============================================================
// Per-frame update
// ============================================================
export function update(dt) {
    time += dt;
    updateWater(dt);
    updateLanterns(dt);
    updateSegs(dt);
    for (const k in pools) pools[k].update(dt);
    updateOneShots(dt);
    updateSpot(dt);
    const roofTarget = gameMode ? 48 : 16;
    roof.position.y += (roofTarget - roof.position.y) * Math.min(1, dt * 1.5);
    roof.visible = roof.position.y < 46;
    if (!gameMode) updateIdle(dt);
    shakeAmt *= Math.exp(-dt * 7);
    if (shakeAmt < 0.005) shakeAmt = 0;
    shakeOff.set((Math.random() - 0.5) * 2 * shakeAmt, (Math.random() - 0.5) * 2 * shakeAmt, (Math.random() - 0.5) * 2 * shakeAmt);
    sky.position.copy(camera.position);
    const camD = camera.position.length();
    scene.fog.near = Math.max(55, camD * 1.3);
    scene.fog.far = scene.fog.near + 95;
}
