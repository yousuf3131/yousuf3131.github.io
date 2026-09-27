// Builds a Blackout map as a three.js scene: ground, walls, trees, corn, water, containers,
// wrecks, fences, furniture, lamps, the campfire and the weather.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE } from './maps.js';
import * as TX from './textures.js';

const MARGIN = 9; // decorated tiles drawn outside the map so the edge never shows the void

// Shared uniforms: the see-through circle around the local player, and time for swaying plants
export const cut = { pos: { value: new THREE.Vector3(-1e5, -1e5, 0) }, radius: { value: 160 } };
export const clock = { value: 0 };

// Anything tall between the camera and the player dissolves in a dithered circle
function seeThrough(mat, sway = 0) {
    mat.onBeforeCompile = sh => {
        sh.uniforms.uCutPos = cut.pos; sh.uniforms.uCutR = cut.radius; sh.uniforms.uTime = clock;
        sh.fragmentShader = 'uniform vec3 uCutPos;\nuniform float uCutR;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            {
                float rr = length(gl_FragCoord.xy - uCutPos.xy) / uCutR;
                if (rr < 1.0 && gl_FragCoord.z < uCutPos.z) {
                    const float B[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
                    ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
                    if (smoothstep(0.45, 1.0, rr) < (B[q.y * 4 + q.x] + 0.5) / 16.0) discard;
                }
            }`);
        if (sway) {
            sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                {
                    vec4 wp = vec4(transformed, 1.0);
                    #ifdef USE_INSTANCING
                    wp = instanceMatrix * wp;
                    #endif
                    float h = max(0.0, position.y) * ${sway.toFixed(3)};
                    transformed.x += sin(uTime * 1.4 + wp.x * 0.35 + wp.z * 0.21) * h;
                    transformed.z += cos(uTime * 1.1 + wp.x * 0.27 - wp.z * 0.3) * h * 0.7;
                }`);
        }
    };
    mat.customProgramCacheKey = () => 'cut' + sway;
    return mat;
}

// Seeded random so every player builds the exact same decorations
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const groundCache = new Map();
const texCache = new Map();
const cached = (key, make) => texCache.get(key) || (texCache.set(key, make()), texCache.get(key));

function instanced(geo, mat, list, place, opts = {}) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const o = new THREE.Object3D();
    list.forEach((item, i) => {
        o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
        const color = place(o, item, i);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (color !== undefined) m.setColorAt(i, new THREE.Color(color));
    });
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    m.instanceMatrix.needsUpdate = true;
    return m;
}

// Irregular low-poly pine: stacked, jittered cones on a trunk
function pineGeometries() {
    const r = rng(9);
    const parts = [];
    // Five drooping tiers with ragged rims
    for (let i = 0; i < 5; i++) {
        const rad = 2.0 - i * 0.36, h = 2.2 - i * 0.18;
        const g = new THREE.ConeGeometry(rad, h, 14, 3, true);
        const p = g.attributes.position;
        for (let v = 0; v < p.count; v++) {
            const y = p.getY(v), rim = (h / 2 - y) / h; // 0 at the tip, 1 at the rim
            const k = 1 + (r() - 0.5) * 0.35 * rim;
            p.setX(v, p.getX(v) * k); p.setZ(v, p.getZ(v) * k);
            p.setY(v, y - rim * rim * 0.35 + (r() - 0.5) * 0.18 * rim);
        }
        g.translate(0, 2.3 + i * 1.15, 0);
        g.computeVertexNormals();
        parts.push(g);
    }
    const trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.2, 8);
    trunk.translate(0, 1.6, 0);
    return { crown: mergeGeometries(parts), trunk };
}

// Three crossed planes of corn stalks
function cornGeometry() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const g = new THREE.PlaneGeometry(1.7, 2.7);
        g.translate(0, 1.35, 0);
        g.rotateY(i * Math.PI / 3);
        parts.push(g);
    }
    return mergeGeometries(parts);
}

function rockGeometry(seed) {
    const r = rng(seed);
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
        const k = 0.75 + r() * 0.45;
        p.setXYZ(v, p.getX(v) * k, p.getY(v) * k * 0.7, p.getZ(v) * k);
    }
    g.computeVertexNormals();
    return g;
}

function makeCar(color, r) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, map: cached('metal', () => TX.metalTexture([150, 150, 150])), roughness: 0.55, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.15, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.3, metalness: 0.9 });
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.3), paint);
    lower.position.y = 0.62;
    car.add(lower);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.12, 1.3), paint);
    hood.position.set(0, 0.97, 1.35); hood.rotation.x = 0.05;
    car.add(hood);
    // Cabin with sloped glass
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), dark);
    cab.position.set(0, 1.2, -0.25);
    car.add(cab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 1.7), paint);
    roof.position.set(0, 1.5, -0.3);
    car.add(roof);
    for (const [x, z] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), rubber);
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z);
        if (r() < 0.25) { w.position.y = 0.26; w.scale.set(1, 1, 0.8); } // flat tyre
        car.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10), chrome);
        hub.rotation.z = Math.PI / 2; hub.position.copy(w.position);
        car.add(hub);
    }
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.16, 0.12), chrome);
    bumper.position.set(0, 0.45, 2.18);
    car.add(bumper);
    const bumper2 = bumper.clone(); bumper2.position.z = -2.18; car.add(bumper2);
    const lampM = new THREE.MeshStandardMaterial({ color: 0x302c24, roughness: 0.2 });
    for (const x of [-0.6, 0.6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.05), lampM); l.position.set(x, 0.8, 2.16); car.add(l); }
    car.rotation.z = (r() - 0.5) * 0.06;
    car.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return car;
}

// Furniture per map style ('=' tiles)
function makeFurniture(style, r) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3e28, map: cached('planks', () => TX.surfaceTexture('planks')), roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8c90, map: cached('metal', () => TX.metalTexture([150, 150, 150])), roughness: 0.45, metalness: 0.7 });
    const cloth = c => new THREE.MeshStandardMaterial({ color: c, map: cached('fabric', () => TX.fabricTexture()), roughness: 0.95 });
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
    if (style === 'asylum') {
        // Hospital bed, sometimes knocked askew
        box(0.95, 0.06, 1.9, steel, 0, 0.55, 0);
        for (const [x, z] of [[-0.44, -0.9], [0.44, -0.9], [-0.44, 0.9], [0.44, 0.9]]) box(0.05, 0.55, 0.05, steel, x, 0.28, z);
        box(0.95, 0.5, 0.05, steel, 0, 0.8, -0.93);
        box(0.88, 0.14, 1.8, cloth(0xb8b4a4), 0, 0.64, 0);
        box(0.5, 0.1, 0.3, cloth(0xd0ccc0), 0, 0.76, -0.7);
        if (r() < 0.5) { const sheet = box(0.9, 0.02, 1.2, cloth(0x8a8474), 0, 0.72, 0.3); sheet.rotation.z = 0.05; }
        g.rotation.y = (r() - 0.5) * 0.5;
    } else if (style === 'farm') {
        // Hay bales
        const hay = new THREE.MeshStandardMaterial({ color: 0xb09a60, map: cached('straw', () => TX.surfaceTexture('straw')), roughness: 1 });
        box(1.5, 0.8, 0.9, hay, 0, 0.4, -0.4);
        box(1.5, 0.8, 0.9, hay, 0.1, 0.4, 0.55);
        if (r() < 0.6) box(1.5, 0.8, 0.9, hay, 0.05, 1.2, 0.05).rotation.y = 0.2;
    } else if (style === 'yard') {
        // Oil drums
        const drum = new THREE.MeshStandardMaterial({ color: [0x6a2020, 0x2a4a6a, 0x4a5a2a][Math.floor(r() * 3)], map: cached('metal', () => TX.metalTexture([150, 150, 150])), roughness: 0.6, metalness: 0.5 });
        for (const [x, z] of [[-0.45, -0.4], [0.45, -0.35], [0, 0.45]]) {
            const d = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.0, 14), drum);
            d.position.set(x, 0.5, z);
            g.add(d);
        }
    } else {
        // Camp: bunk bed or a table with benches
        if (r() < 0.5) {
            for (const y of [0.45, 1.35]) {
                box(0.9, 0.08, 1.9, wood, 0, y, 0);
                box(0.84, 0.12, 1.8, cloth(r() < 0.5 ? 0x6a5a48 : 0x4a5a6a), 0, y + 0.1, 0);
            }
            for (const [x, z] of [[-0.42, -0.92], [0.42, -0.92], [-0.42, 0.92], [0.42, 0.92]]) box(0.08, 1.7, 0.08, wood, x, 0.85, z);
        } else {
            box(1.0, 0.06, 1.8, wood, 0, 0.75, 0);
            for (const [x, z] of [[-0.4, -0.8], [0.4, -0.8], [-0.4, 0.8], [0.4, 0.8]]) box(0.07, 0.75, 0.07, wood, x, 0.37, z);
            box(0.3, 0.05, 1.7, wood, -0.8, 0.45, 0); box(0.3, 0.05, 1.7, wood, 0.8, 0.45, 0);
        }
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}

// Lamp fixture per map style. Returns { group, light: {x,y,z,color,power}, mat }
function makeLamp(style, r) {
    const g = new THREE.Group();
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.8 });
    let y = 2.4, color = 0xffc48a, power = 26, flicker = r() < 0.25 ? 'flicker' : 'steady';
    if (style === 'asylum') {
        // Hanging shade on a long cord
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 3, 4), iron); cord.position.y = 4.4; g.add(cord);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a4a40, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
        shade.position.y = 2.95; g.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bulbMat); bulb.position.y = 2.8; g.add(bulb);
        y = 2.75; color = 0xcfe0ff; power = 13;
        flicker = r() < 0.2 ? 'dead' : r() < 0.55 ? 'flicker' : 'steady';
        if (flicker === 'steady') color = 0xf0e8d0;
    } else if (style === 'yard') {
        // Floodlight tower
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), iron); pole.position.y = 3; g.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.3), iron); head.position.set(0, 6, 0.2); head.rotation.x = 0.5; g.add(head);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), bulbMat); face.position.set(0, 5.93, 0.37); face.rotation.x = 0.5 + Math.PI / 2 - Math.PI / 2; g.add(face);
        y = 5.6; color = 0xdde4ff; power = 32;
        flicker = r() < 0.3 ? 'flicker' : 'steady';
    } else if (style === 'farm') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5, 8), wood); pole.position.y = 2.5; g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.9), wood); arm.position.set(0, 4.7, 0.4); g.add(arm);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
        shade.position.set(0, 4.55, 0.8); g.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bulbMat); bulb.position.set(0, 4.45, 0.8); g.add(bulb);
        y = 4.3; power = 16;
    } else {
        // Camp lantern on a post
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), wood); post.position.y = 1.15; g.add(post);
        const hook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), iron); hook.position.set(0, 2.2, 0.18); g.add(hook);
        const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 8), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.6, wireframe: true }));
        cage.position.set(0, 2.0, 0.36); g.add(cage);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat); bulb.position.set(0, 2.0, 0.36); g.add(bulb);
        y = 2.0; color = 0xffb060; power = 10;
    }
    g.traverse(o => { if (o.isMesh && o.material !== bulbMat) { o.castShadow = true; o.receiveShadow = true; } });
    return { group: g, y, color, power, flicker, mat: bulbMat };
}

export function buildWorld(map, quality) {
    const def = map.def, r = rng(def.id.length * 977 + map.W * 31);
    const root = new THREE.Group();
    const style = def.props;
    const WW = map.W * TILE, HH = map.H * TILE;
    const tiles = ch => { const out = []; for (let rr = 0; rr < map.H; rr++) for (let c = 0; c < map.W; c++) if (map.cells[rr][c] === ch) out.push({ c, r: rr, x: map.cx(c), z: map.cz(rr) }); return out; };

    /* ground */
    let gtex = groundCache.get(def.id);
    if (!gtex) { gtex = TX.groundTexture(map); groundCache.set(def.id, gtex); }
    const wet = def.weather === 'rain';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WW, HH), new THREE.MeshStandardMaterial({ map: gtex, bumpMap: gtex, bumpScale: 1.2, roughness: wet ? 0.55 : 0.92, metalness: wet ? 0.12 : 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    root.add(ground);
    // Outside the map: the same surface as the border, tiled
    if (!def.indoor) {
        const outerKind = { grass: 'needles', dirt: 'straw', gravel: 'gravel' }[def.ground] || 'dirt';
        const otex = cached('surf-' + outerKind, () => TX.surfaceTexture(outerKind)).clone();
        otex.needsUpdate = true;
        const OW = WW + MARGIN * TILE * 2, OH = HH + MARGIN * TILE * 2;
        otex.repeat.set(OW / 10, OH / 10);
        const outer = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH), new THREE.MeshStandardMaterial({ map: otex, roughness: 0.95 }));
        outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
        outer.receiveShadow = true;
        root.add(outer);
    }
    // Decorated ring of tiles outside the map, in map coordinates
    const outside = [];
    for (let rr = -MARGIN; rr < map.H + MARGIN; rr++) for (let c = -MARGIN; c < map.W + MARGIN; c++) {
        if (rr >= 0 && rr < map.H && c >= 0 && c < map.W) continue;
        outside.push({ c, r: rr, x: map.cx(c), z: map.cz(rr) });
    }

    /* walls */
    const wallH = def.indoor ? 3.4 : 3.0;
    const wallTex = cached('wall-' + def.wall, () => TX.wallTexture(def.wall));
    const walls = tiles('#');
    const wallMesh = instanced(new THREE.BoxGeometry(TILE, wallH, TILE), seeThrough(new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 1.5, roughness: 0.9 })), walls,
        (o, t) => { o.position.set(t.x, wallH / 2, t.z); });
    if (wallMesh) root.add(wallMesh);
    const capMesh = instanced(new THREE.BoxGeometry(TILE + 0.04, 0.1, TILE + 0.04), seeThrough(new THREE.MeshStandardMaterial({ color: { logs: 0x4a3524, plaster: 0x55534c, barn: 0x4a2018, brick: 0x4a322a }[def.wall] || 0x333333, roughness: 0.9 })), walls,
        (o, t) => { o.position.set(t.x, wallH + 0.05, t.z); }, { cast: false });
    if (capMesh) root.add(capMesh);

    /* pines: map trees, plus a dense forest outside the camp */
    let trees = tiles('T').map(t => ({ ...t, x: t.x + (r() - 0.5) * 0.6, z: t.z + (r() - 0.5) * 0.6 }));
    if (style === 'forest') for (const t of outside) if (r() < 0.55) trees.push({ ...t, x: t.x + (r() - 0.5) * 1.4, z: t.z + (r() - 0.5) * 1.4 });
    if (trees.length) {
        const { crown, trunk } = pineGeometries();
        const barkT = cached('bark', () => TX.barkTexture()), leafT = cached('leaf', () => TX.foliageTexture());
        const scales = trees.map(() => ({ s: 0.8 + r() * 0.4, h: 0.72 + r() * 0.3, a: r() * Math.PI * 2 }));
        const place = (o, t, i) => { const k = scales[i]; o.position.set(t.x, 0, t.z); o.scale.set(k.s, k.h * k.s, k.s); o.rotation.y = k.a; };
        root.add(instanced(trunk, seeThrough(new THREE.MeshStandardMaterial({ map: barkT, roughness: 0.95 })), trees, place));
        const crownMesh = instanced(crown, seeThrough(new THREE.MeshStandardMaterial({ map: leafT, color: 0xb8c8b0, roughness: 0.9, side: THREE.DoubleSide }), 0.015), trees, place);
        root.add(crownMesh);
    }

    /* corn */
    let corn = tiles('c');
    if (style === 'farm') corn = corn.concat(outside.filter(() => r() < 0.9));
    if (corn.length) {
        const clumps = [];
        for (const t of corn) for (let k = 0; k < 2; k++) clumps.push({ x: t.x + (r() - 0.5) * 1.4, z: t.z + (r() - 0.5) * 1.4, s: 0.85 + r() * 0.35, a: r() * Math.PI });
        const mat = seeThrough(new THREE.MeshStandardMaterial({ map: cached('corn', () => TX.cornTexture()), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }), 0.05);
        root.add(instanced(cornGeometry(), mat, clumps, (o, t) => { o.position.set(t.x, 0, t.z); o.scale.set(t.s, t.s * (0.9 + r() * 0.25), t.s); o.rotation.y = t.a; }));
    }

    /* water */
    const water = tiles('~');
    let waterMat = null;
    if (water.length) {
        // One sheet over the whole map, cut to the water tiles by a soft, ragged mask so the shore isn't square
        const PX = 16, mc = document.createElement('canvas');
        mc.width = map.W * PX; mc.height = map.H * PX;
        const g = mc.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, mc.width, mc.height);
        g.filter = 'blur(5px)'; g.fillStyle = '#fff';
        for (const t of water) {
            g.beginPath();
            g.ellipse((t.c + 0.5) * PX, (t.r + 0.5) * PX, PX * (0.72 + r() * 0.15), PX * (0.72 + r() * 0.15), r() * 3, 0, Math.PI * 2);
            g.fill();
        }
        const mask = new THREE.CanvasTexture(mc);
        const normals = cached('waterN', () => TX.waterNormals()).clone();
        normals.needsUpdate = true;
        normals.repeat.set(WW / 7, HH / 7);
        waterMat = new THREE.MeshStandardMaterial({ color: 0x0a1620, roughness: 0.14, metalness: 0.2, normalMap: normals, normalScale: new THREE.Vector2(0.2, 0.2), alphaMap: mask, transparent: true, depthWrite: false });
        const wm = new THREE.Mesh(new THREE.PlaneGeometry(WW, HH).rotateX(-Math.PI / 2), waterMat);
        wm.position.y = 0.06; wm.renderOrder = 1;
        wm.receiveShadow = true;
        root.add(wm);
    }

    /* shipping containers: each connected block gets one colour, some are stacked two high */
    const boxes = tiles('x');
    if (boxes.length || style === 'yard') {
        const PALETTE = [0xa83c28, 0x3a6a98, 0x4e8052, 0xc08a30, 0x8a8c92, 0x9a4040, 0x3a8080];
        const seen = new Set(), comps = [];
        const key = (c, rr) => rr * 1000 + c;
        const isX = (c, rr) => map.at(c, rr) === 'x';
        for (const t of boxes) {
            if (seen.has(key(t.c, t.r))) continue;
            const comp = [], stack = [t];
            seen.add(key(t.c, t.r));
            while (stack.length) {
                const a = stack.pop(); comp.push(a);
                for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nc = a.c + dc, nr = a.r + dr;
                    if (isX(nc, nr) && !seen.has(key(nc, nr))) { seen.add(key(nc, nr)); stack.push({ c: nc, r: nr, x: map.cx(nc), z: map.cz(nr) }); }
                }
            }
            comps.push(comp);
        }
        const lower = [], upper = [];
        for (const comp of comps) {
            const col = PALETTE[Math.floor(r() * PALETTE.length)], col2 = PALETTE[Math.floor(r() * PALETTE.length)];
            const stacked = r() < 0.55;
            for (const t of comp) { lower.push({ ...t, col }); if (stacked) upper.push({ ...t, col: col2 }); }
        }
        // Stacks outside the yard fence
        if (style === 'yard') for (const t of outside) if (r() < 0.35) { const col = PALETTE[Math.floor(r() * PALETTE.length)]; lower.push({ ...t, col }); if (r() < 0.5) upper.push({ ...t, col }); }
        const ctex = cached('container', () => TX.containerTexture());
        const cmat = seeThrough(new THREE.MeshStandardMaterial({ map: ctex, bumpMap: ctex, bumpScale: 2, roughness: 0.75, metalness: 0.08 }));
        const cgeo = new THREE.BoxGeometry(TILE, 2.6, TILE);
        root.add(instanced(cgeo, cmat, lower, (o, t) => { o.position.set(t.x, 1.3, t.z); return t.col; }));
        if (upper.length) root.add(instanced(cgeo, cmat, upper, (o, t) => { o.position.set(t.x, 3.9, t.z); return t.col; }));
    }

    /* car wrecks: one car per connected group of 'v' tiles, lying along the group */
    const vs = tiles('v'), vseen = new Set();
    const CAR_COLORS = [0x5a1e1a, 0x2a3a4a, 0x4a4a3a, 0x6a6a64, 0x2a3a2a, 0x7a5a2a];
    for (const t of vs) {
        const k = t.r * 1000 + t.c;
        if (vseen.has(k)) continue;
        const comp = [t]; vseen.add(k);
        for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            if (map.at(t.c + dc, t.r + dr) === 'v' && !vseen.has((t.r + dr) * 1000 + t.c + dc)) { vseen.add((t.r + dr) * 1000 + t.c + dc); comp.push({ c: t.c + dc, r: t.r + dr, x: map.cx(t.c + dc), z: map.cz(t.r + dr) }); }
        }
        const cx = comp.reduce((s, a) => s + a.x, 0) / comp.length, cz = comp.reduce((s, a) => s + a.z, 0) / comp.length;
        const horiz = comp.length > 1 ? comp[0].r === comp[1].r : r() < 0.5;
        const car = makeCar(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)], r);
        car.position.set(cx, 0, cz);
        car.rotation.y = (horiz ? Math.PI / 2 : 0) + (r() - 0.5) * 0.3;
        if (comp.length === 1) car.scale.setScalar(0.62); // squeeze a lone wreck into its tile
        root.add(car);
    }

    /* fences */
    const fences = tiles('f');
    if (style === 'yard') for (const t of outside) if (t.c === -1 || t.r === -1 || t.c === map.W || t.r === map.H) fences.push(t);
    if (fences.length) {
        const isF = (c, rr) => map.at(c, rr) === 'f' || c === -1 || rr === -1 || c === map.W || rr === map.H;
        const chain = style === 'yard';
        const postM = new THREE.MeshStandardMaterial(chain ? { color: 0x7a7c80, roughness: 0.4, metalness: 0.8 } : { color: 0x4a3624, roughness: 0.9 });
        const h = chain ? 2.3 : 1.3;
        root.add(instanced(new THREE.BoxGeometry(0.12, h, 0.12), postM, fences, (o, t) => { o.position.set(t.x, h / 2, t.z); }));
        const spans = [];
        for (const t of fences) {
            if (isF(t.c + 1, t.r)) spans.push({ x: t.x + TILE / 2, z: t.z, a: 0 });
            if (isF(t.c, t.r + 1)) spans.push({ x: t.x, z: t.z + TILE / 2, a: Math.PI / 2 });
        }
        if (chain) {
            const ct = cached('chain', () => TX.chainLinkTexture());
            ct.repeat.set(2, 2.3);
            const mesh = new THREE.MeshStandardMaterial({ map: ct, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, color: 0x9a9ca0 });
            root.add(instanced(new THREE.PlaneGeometry(TILE, h - 0.1), mesh, spans, (o, t) => { o.position.set(t.x, h / 2, t.z); o.rotation.y = t.a; }));
        } else {
            const rails = [];
            for (const s of spans) for (const y of [0.55, 1.1]) rails.push({ ...s, y });
            root.add(instanced(new THREE.BoxGeometry(TILE, 0.1, 0.05), postM, rails, (o, t) => { o.position.set(t.x, t.y, t.z); o.rotation.y = t.a; o.rotation.z = (r() - 0.5) * 0.08; }));
        }
    }

    /* 'o': rocks, silos or tyre stacks */
    const os = tiles('o');
    if (os.length) {
        if (def.rock === 'silo') {
            const m = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, map: cached('metal', () => TX.metalTexture([150, 150, 150])), roughness: 0.6, metalness: 0.25 });
            for (const t of os) {
                const s = new THREE.Group();
                const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 4.6, 20), m); body.position.y = 2.3; s.add(body);
                const dome = new THREE.Mesh(new THREE.SphereGeometry(0.97, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.y = 4.6; dome.scale.y = 0.6; s.add(dome);
                for (let k = 1; k < 5; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.025, 4, 24), m); ring.rotation.x = Math.PI / 2; ring.position.y = k; s.add(ring); }
                s.position.set(t.x, 0, t.z);
                s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = seeThrough(m); } });
                root.add(s);
            }
        } else if (def.rock === 'tyres') {
            const rub = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
            const list = [];
            for (const t of os) { const n = 3 + Math.floor(r() * 3); for (let k = 0; k < n; k++) list.push({ x: t.x + (r() - 0.5) * 0.15, z: t.z + (r() - 0.5) * 0.15, y: 0.18 + k * 0.34 }); }
            root.add(instanced(new THREE.TorusGeometry(0.5, 0.2, 10, 20).rotateX(Math.PI / 2), rub, list, (o, t) => { o.position.set(t.x, t.y, t.z); }));
        } else {
            const stone = new THREE.MeshStandardMaterial({ color: 0x6a6a66, roughness: 0.95, flatShading: true });
            root.add(instanced(rockGeometry(3), stone, os, (o, t) => { o.position.set(t.x, 0.3, t.z); o.scale.set(1.05, 1.1, 1.0); o.rotation.y = r() * 6; }));
        }
    }

    /* furniture */
    for (const t of tiles('=')) {
        const f = makeFurniture(style, r);
        f.position.set(t.x, 0, t.z);
        if (style !== 'asylum') f.rotation.y += r() < 0.5 ? 0 : Math.PI / 2;
        root.add(f);
    }

    /* scattered detail that doesn't block anything */
    const floorTiles = map.open.map(t => ({ ...t, x: map.cx(t.c), z: map.cz(t.r), ch: map.at(t.c, t.r) }));
    const pick = (pred, chance) => floorTiles.filter(t => pred(t.ch) && r() < chance).map(t => ({ ...t, x: t.x + (r() - 0.5) * 1.4, z: t.z + (r() - 0.5) * 1.4 }));
    const outdoor = ch => ch === '.' || ch === 'g';
    if (style === 'forest') {
        // Bushes: a few lumpy leaf balls merged into one clump
        const bushes = pick(outdoor, 0.08);
        const leaf = cached('leaf', () => TX.foliageTexture());
        const lumps = [];
        for (const [x, y, z, s] of [[0, 0.35, 0, 0.55], [0.4, 0.28, 0.15, 0.4], [-0.35, 0.25, 0.2, 0.42], [0.1, 0.3, -0.38, 0.38]]) {
            const g = new THREE.IcosahedronGeometry(s, 2);
            const pp = g.attributes.position;
            for (let v = 0; v < pp.count; v++) { const k = 0.82 + ((v * 2654435761) % 1000) / 1000 * 0.3; pp.setXYZ(v, pp.getX(v) * k, pp.getY(v) * k * 0.85, pp.getZ(v) * k); }
            g.translate(x, y, z); g.computeVertexNormals();
            lumps.push(g);
        }
        root.add(instanced(mergeGeometries(lumps), seeThrough(new THREE.MeshStandardMaterial({ map: leaf, color: 0xc8e0b0, roughness: 1 }), 0.04), bushes,
            (o, t) => { const s = 0.7 + r() * 0.6; o.position.set(t.x, 0, t.z); o.scale.set(s, s * (0.8 + r() * 0.4), s); o.rotation.y = r() * 6; }));
        const stones = pick(outdoor, 0.06);
        root.add(instanced(rockGeometry(11), new THREE.MeshStandardMaterial({ color: 0x5a5a56, roughness: 0.95, flatShading: true }), stones,
            (o, t) => { const s = 0.15 + r() * 0.3; o.position.set(t.x, s * 0.3, t.z); o.scale.setScalar(s); o.rotation.y = r() * 6; }));
        // Fallen logs outside
        const logs = outside.filter(() => r() < 0.04);
        root.add(instanced(new THREE.CylinderGeometry(0.22, 0.26, 3.2, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: cached('bark', () => TX.barkTexture()), roughness: 1 }), logs,
            (o, t) => { o.position.set(t.x, 0.2, t.z); o.rotation.y = r() * 6; }));
    }
    if (style === 'farm' || style === 'yard' || style === 'asylum') {
        // Glossy puddles that catch flashlight glints
        const puddles = pick(ch => ch === '.' || ch === ',' , style === 'farm' ? 0.08 : 0.05);
        const pm = new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.85, depthWrite: false });
        const pgeo = new THREE.CircleGeometry(0.8, 14);
        const pp = pgeo.attributes.position;
        for (let v = 1; v < pp.count; v++) { const k = 0.7 + ((v * 7919) % 13) / 30; pp.setXY(v, pp.getX(v) * k, pp.getY(v) * k * 0.8); }
        root.add(instanced(pgeo.rotateX(-Math.PI / 2), pm, puddles, (o, t) => { const s = 0.6 + r() * 0.9; o.position.set(t.x, 0.02, t.z); o.scale.set(s, 1, s); o.rotation.y = r() * 6; }, { cast: false }));
    }
    if (style === 'asylum') {
        // Loose paper and debris
        const papers = pick(ch => ch === '.', 0.18);
        root.add(instanced(new THREE.PlaneGeometry(0.22, 0.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8b2a0, roughness: 0.9 }), papers,
            (o, t) => { o.position.set(t.x, 0.012, t.z); o.rotation.y = r() * 6; }, { cast: false }));
        const debris = pick(ch => ch === '.', 0.07);
        root.add(instanced(rockGeometry(5), new THREE.MeshStandardMaterial({ color: 0x8a8678, roughness: 1, flatShading: true }), debris,
            (o, t) => { const s = 0.08 + r() * 0.18; o.position.set(t.x, s * 0.3, t.z); o.scale.setScalar(s); }));
    }
    if (style === 'yard') {
        const scrap = pick(ch => ch === '.', 0.05);
        root.add(instanced(new THREE.BoxGeometry(0.8, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x6a5a50, map: cached('metal', () => TX.metalTexture([150, 150, 150])), roughness: 0.6, metalness: 0.6 }), scrap,
            (o, t) => { o.position.set(t.x, 0.08, t.z); o.rotation.set((r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3); o.scale.set(0.6 + r(), 1, 0.6 + r()); }));
    }

    /* lamps and the campfire */
    const lamps = [];
    for (const t of tiles('L')) {
        const L = makeLamp(style, r);
        // Stand the post at the side of the tile nearest a wall or path edge so it doesn't sit mid-path
        L.group.position.set(t.x + (style === 'asylum' ? 0 : 0.7), 0, t.z + (style === 'asylum' ? 0 : -0.7));
        L.group.rotation.y = style === 'yard' ? r() * 6 : 0;
        root.add(L.group);
        const tip = new THREE.Vector3(0, L.y, style === 'forest' ? 0.36 : style === 'farm' ? 0.8 : 0).applyEuler(L.group.rotation).add(L.group.position);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: cached('glow', () => TX.glowTexture()), color: L.color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.copy(tip); glow.scale.setScalar(style === 'yard' ? 1.8 : 0.9);
        root.add(glow);
        lamps.push({ x: tip.x, y: tip.y - 0.15, z: tip.z, color: L.color, power: L.power, flicker: L.flicker, mat: L.mat, glow, level: 1, seed: r() * 100, next: 0 });
    }
    const fires = [];
    for (const t of tiles('F')) {
        const f = new THREE.Group();
        f.position.set(t.x, 0, t.z);
        const stone = new THREE.MeshStandardMaterial({ color: 0x5a5854, roughness: 0.95, flatShading: true });
        const rg = rockGeometry(21);
        for (let k = 0; k < 9; k++) { const s = new THREE.Mesh(rg, stone); const a = k / 9 * Math.PI * 2; s.position.set(Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75); s.scale.setScalar(0.2 + r() * 0.06); s.castShadow = true; f.add(s); }
        const logM = new THREE.MeshStandardMaterial({ map: cached('bark', () => TX.barkTexture()), roughness: 1, emissive: 0x401000, emissiveIntensity: 0.6 });
        for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 6), logM); l.rotation.z = Math.PI / 2 - 0.35; l.rotation.y = k * Math.PI / 2; l.position.y = 0.2; f.add(l); }
        const flames = [];
        for (let k = 0; k < 3; k++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cached('glow', () => TX.glowTexture()), color: k ? 0xff7a20 : 0xffc060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            sp.position.y = 0.4 + k * 0.2; sp.scale.set(0.9, 1.3, 1);
            f.add(sp); flames.push(sp);
        }
        root.add(f);
        fires.push({ flames });
        lamps.push({ x: t.x, y: 1.0, z: t.z, color: 0xff8a3a, power: 45, flicker: 'fire', mat: null, glow: null, level: 1, seed: r() * 100, next: 0 });
    }

    /* weather */
    const weather = { update() {} };
    if (def.weather === 'rain') {
        const N = quality === 'high' ? 1800 : 900, AREA = 44, TOP = 22;
        const pos = new Float32Array(N * 6), drops = [];
        for (let i = 0; i < N; i++) drops.push({ x: (r() - 0.5) * AREA, y: r() * TOP, z: (r() - 0.5) * AREA, v: 22 + r() * 8 });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8a9ab8, transparent: true, opacity: 0.32, depthWrite: false }));
        lines.frustumCulled = false;
        root.add(lines);
        weather.update = (dt, fx, fz) => {
            for (let i = 0; i < N; i++) {
                const d = drops[i];
                d.y -= d.v * dt;
                if (d.y < 0) { d.y += TOP; d.x = (r() - 0.5) * AREA; d.z = (r() - 0.5) * AREA; }
                const x = fx + d.x, z = fz + d.z;
                pos[i * 6] = x; pos[i * 6 + 1] = d.y; pos[i * 6 + 2] = z;
                pos[i * 6 + 3] = x + 0.05; pos[i * 6 + 4] = d.y + 0.6; pos[i * 6 + 5] = z + 0.1;
            }
            geo.attributes.position.needsUpdate = true;
        };
    } else if (def.weather === 'mist' || def.weather === 'dust') {
        const mist = def.weather === 'mist';
        const banks = [];
        if (mist) {
            const mt = cached('mist', () => TX.mistTexture());
            for (let i = 0; i < 26; i++) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: mt, color: 0x8a9ab0, transparent: true, opacity: 0.12, depthWrite: false }));
                m.rotation.x = -Math.PI / 2; m.rotation.z = r() * 6;
                m.position.set((r() - 0.5) * WW, 0.5 + r() * 1.3, (r() - 0.5) * HH);
                m.renderOrder = 5;
                root.add(m); banks.push({ m, vx: (r() - 0.3) * 0.4, vz: (r() - 0.5) * 0.3 });
            }
        }
        // Floating motes that show up in flashlight beams
        const N = quality === 'high' ? 700 : 350, AREA = 36;
        const pos = new Float32Array(N * 3), motes = [];
        for (let i = 0; i < N; i++) motes.push({ x: (r() - 0.5) * AREA, y: r() * 3, z: (r() - 0.5) * AREA, p: r() * 6 });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: mist ? 0x9aa6b8 : 0xb8b0a0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
        pts.frustumCulled = false;
        root.add(pts);
        weather.update = (dt, fx, fz, t) => {
            for (const b of banks) {
                b.m.position.x += b.vx * dt; b.m.position.z += b.vz * dt;
                if (b.m.position.x > WW / 2 + 8) b.m.position.x = -WW / 2 - 8;
                if (b.m.position.z > HH / 2 + 8) b.m.position.z = -HH / 2 - 8;
                if (b.m.position.z < -HH / 2 - 8) b.m.position.z = HH / 2 + 8;
            }
            for (let i = 0; i < N; i++) {
                const m = motes[i];
                let x = m.x + Math.sin(t * 0.3 + m.p) * 0.6, z = m.z + Math.cos(t * 0.25 + m.p) * 0.6;
                // Keep the cloud centred on the player by wrapping each mote around them
                x = fx + (((x - fx) % AREA) + AREA * 1.5) % AREA - AREA / 2;
                z = fz + (((z - fz) % AREA) + AREA * 1.5) % AREA - AREA / 2;
                pos[i * 3] = x; pos[i * 3 + 1] = m.y + Math.sin(t * 0.5 + m.p * 2) * 0.2; pos[i * 3 + 2] = z;
            }
            geo.attributes.position.needsUpdate = true;
        };
    }

    // Lamp brightness over time: steady hum, flicker, dead (rare sputters) or campfire
    function lampLevel(L, t) {
        const n = Math.sin(t * 13 + L.seed) * 0.5 + Math.sin(t * 7.3 + L.seed * 2) * 0.5;
        switch (L.flicker) {
            case 'fire': return 0.75 + n * 0.15 + Math.sin(t * 23 + L.seed) * 0.08;
            case 'flicker': {
                if (t > L.next) { L.next = t + 0.04 + Math.random() * (Math.random() < 0.2 ? 1.5 : 0.25); L.on = Math.random() < 0.72; }
                return L.on ? 0.85 + n * 0.1 : 0.05;
            }
            case 'dead': {
                if (t > L.next) { L.next = t + (L.on ? 0.05 + Math.random() * 0.1 : 3 + Math.random() * 8); L.on = !L.on; }
                return L.on ? 0.6 : 0;
            }
            default: return 0.95 + n * 0.03;
        }
    }

    return {
        root, lamps,
        update(dt, t, fx, fz) {
            clock.value = t;
            if (waterMat) { waterMat.normalMap.offset.x = t * 0.02; waterMat.normalMap.offset.y = t * 0.013; }
            for (const L of lamps) {
                L.level = lampLevel(L, t);
                if (L.mat) L.mat.color.setHex(L.color).multiplyScalar(0.1 + L.level * 3); // above 1 so the bloom catches it
                if (L.glow) L.glow.material.opacity = 0.4 * L.level;
            }
            for (const f of fires) f.flames.forEach((sp, k) => { const s = 0.8 + Math.sin(t * (9 + k * 3) + k) * 0.18; sp.scale.set(0.8 * s, 1.3 * s, 1); sp.position.y = 0.4 + k * 0.2 + Math.sin(t * 11 + k) * 0.04; });
            weather.update(dt, fx, fz, t);
        },
        dispose() {
            root.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) for (const m of [].concat(o.material)) m.dispose();
            });
        },
    };
}
