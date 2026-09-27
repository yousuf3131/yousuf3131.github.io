// Procedural textures for Blackout, painted on canvases at load time. No image files.

import * as THREE from 'three';

/* ── noise ─────────────────────────────────────────────── */
const N = 512, MASK = N - 1;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Tileable value noise of the given cell size, 0..1
function valueNoise(cell, seed) {
    const rand = rng(seed), g = N / cell;
    const lat = new Float32Array(g * g).map(() => rand());
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / cell, fy = y / cell;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const a = lat[(y0 % g) * g + x0 % g], b = lat[(y0 % g) * g + (x0 + 1) % g];
        const c = lat[((y0 + 1) % g) * g + x0 % g], d = lat[((y0 + 1) % g) * g + (x0 + 1) % g];
        out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
    return out;
}
let NZ = null;
function noise() {
    if (!NZ) {
        const big = valueNoise(128, 1), mid = valueNoise(32, 2), small = valueNoise(8, 3), fine = valueNoise(2, 4);
        const fbm = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) fbm[i] = big[i] * 0.45 + mid[i] * 0.3 + small[i] * 0.17 + fine[i] * 0.08;
        NZ = { big, mid, small, fine, fbm };
    }
    return NZ;
}
const at = (arr, x, y) => arr[((y | 0) & MASK) * N + ((x | 0) & MASK)];

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = true, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;

// Paint every pixel with fn(x, y) -> [r, g, b]
function paint(w, h, fn) {
    const c = canvas(w, h), g = c.getContext('2d');
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [r, gg, b] = fn(x, y), i = (y * w + x) * 4;
        d[i] = clamp(r); d[i + 1] = clamp(gg); d[i + 2] = clamp(b); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
}

/* ── ground surfaces (colour at a pixel, 48px per 2m tile) ─ */
const SURF = {
    grass(x, y, n) {
        const v = at(n.fbm, x, y), f = at(n.fine, x * 3, y * 3), p = at(n.big, x + 200, y);
        const k = 0.55 + v * 0.7 + (f - 0.5) * 0.35;
        const dry = Math.max(0, p - 0.55) * 1.6;
        return [(30 + dry * 30) * k, (44 + dry * 8) * k, (22) * k];
    },
    dirt(x, y, n) {
        const v = at(n.fbm, x + 77, y + 31), f = at(n.fine, x * 2, y * 2);
        const k = 0.6 + v * 0.65 + (f - 0.5) * 0.3;
        const pebble = at(n.small, x * 4, y * 4) > 0.78 ? 1.25 : 1;
        return [56 * k * pebble, 45 * k * pebble, 34 * k * pebble];
    },
    path(x, y, n) {
        const v = at(n.fbm, x + 11, y + 400), f = at(n.fine, x * 2.5, y * 2.5);
        const k = 0.7 + v * 0.5 + (f - 0.5) * 0.35;
        return [66 * k, 54 * k, 40 * k];
    },
    needles(x, y, n) {
        const v = at(n.fbm, x + 5, y + 9), f = at(n.fine, x * 3, y * 1.5);
        const k = 0.5 + v * 0.6 + (f - 0.5) * 0.4;
        return [44 * k, 34 * k, 22 * k];
    },
    straw(x, y, n) {
        const v = at(n.fbm, x, y), s = at(n.fine, x * 0.7, y * 6);
        const k = 0.55 + v * 0.6;
        return [(52 + s * 30) * k, (44 + s * 22) * k, (28 + s * 6) * k];
    },
    gravel(x, y, n) {
        const v = at(n.fbm, x + 90, y + 90), f = at(n.fine, x * 1.5, y * 1.5), s = at(n.small, x * 2, y * 2);
        const k = 0.6 + v * 0.45 + (f - 0.5) * 0.25 + (s > 0.72 ? 0.15 : 0);
        const oil = at(n.big, x * 1.5 + 300, y * 1.5) > 0.68 ? 0.55 : 1;
        return [66 * k * oil, 64 * k * oil, 60 * k * oil];
    },
    concrete(x, y, n) {
        const v = at(n.fbm, x + 40, y + 70), f = at(n.fine, x * 3, y * 3);
        const k = 0.7 + v * 0.45 + (f - 0.5) * 0.2;
        const seam = (x % 48 < 1 || y % 48 < 1) ? 0.6 : 1;
        return [82 * k * seam, 80 * k * seam, 76 * k * seam];
    },
    tiles(x, y, n) {
        const tx = Math.floor(x / 24), ty = Math.floor(y / 24);
        const lx = x % 24, ly = y % 24;
        const grout = lx < 1.5 || ly < 1.5;
        const odd = (tx + ty) & 1;
        const v = at(n.fbm, x + 13, y + 57), grime = at(n.big, x * 2, y * 2 + 99);
        const k = 0.75 + v * 0.35 - Math.max(0, grime - 0.5) * 0.9;
        if (grout) return [40 * k, 40 * k, 36 * k];
        return odd ? [118 * k, 118 * k, 106 * k] : [78 * k, 92 * k, 84 * k];
    },
    planks(x, y, n) {
        const board = Math.floor(y / 12), ly = y % 12;
        const off = at(n.small, 7, board * 31) * 200;
        const grain = at(n.fine, (x + off) * 0.25, y * 3);
        const v = at(n.fbm, x + off, y);
        const seam = ly < 1 || ((x + off) % 96) < 1 ? 0.45 : 1;
        const k = (0.6 + v * 0.5 + (grain - 0.5) * 0.35) * seam * (0.85 + at(n.small, board * 13, 3) * 0.3);
        return [74 * k, 54 * k, 36 * k];
    },
    mud(x, y, n) { const v = at(n.fbm, x, y); return [24 + v * 14, 22 + v * 12, 18 + v * 8]; },
};

const GROUND_OF = { grass: 'grass', dirt: 'dirt', tiles: 'tiles', gravel: 'gravel' };

// The palettes above are written dark; this lifts each to a believable albedo before lighting
const LIFT = { grass: 2.3, dirt: 2.1, path: 2.0, needles: 2.2, straw: 2.0, gravel: 1.6, concrete: 1.6, tiles: 1.45, planks: 1.8, mud: 1.6 };
const lifted = (kind, x, y, n) => { const k = LIFT[kind] || 1, c = SURF[kind](x, y, n); return [c[0] * k, c[1] * k, c[2] * k]; };

// Which surface sits under each map character
function surfaceFor(ch, def) {
    switch (ch) {
        case ',': return def.ground === 'tiles' ? 'tiles' : 'path';
        case 'i': case '=': return def.floor;
        case 'g': return 'grass';
        case 'c': return 'straw';
        case 'T': return 'needles';
        case '~': return 'mud';
        case '#': return def.ground === 'tiles' ? 'tiles' : def.floor;
        default: return GROUND_OF[def.ground] || 'dirt';
    }
}

// One big texture for the whole map floor, with soft organic edges between surfaces and
// dark contact shadows at the foot of walls, containers and trees.
export function groundTexture(map) {
    const n = noise(), PX = 48;
    const W = map.W * PX, H = map.H * PX;
    const def = map.def;
    const surf = [];
    for (let r = 0; r < map.H; r++) for (let c = 0; c < map.W; c++) surf.push(surfaceFor(map.cells[r][c], def));
    const hard = s => s === 'tiles' || s === 'planks' || s === 'concrete';
    const tall = ch => ch === '#' || ch === 'x'; // square blocks only, round things would get square shadows
    const c = paint(W, H, (x, y) => {
        // Wobble the lookup so outdoor surfaces blend into each other
        const wob = (at(n.mid, x * 1.3, y * 1.3) - 0.5) * 22, wob2 = (at(n.mid, x * 1.3 + 250, y * 1.3) - 0.5) * 22;
        let tc = Math.floor(x / PX), tr = Math.floor(y / PX);
        let s = surf[tr * map.W + tc];
        if (!hard(s)) {
            const jc = Math.floor((x + wob) / PX), jr = Math.floor((y + wob2) / PX);
            if (jc >= 0 && jr >= 0 && jc < map.W && jr < map.H) {
                const s2 = surf[jr * map.W + jc];
                if (!hard(s2)) s = s2;
            }
        }
        let [r, g, b] = lifted(s, x, y, n);
        // Contact shadow: distance to the nearest tall solid tile around this pixel
        const lx = x - tc * PX, ly = y - tr * PX;
        let ao = 1;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            if (!tall(map.at(tc + dc, tr + dr))) continue;
            const ex = dc < 0 ? lx : dc > 0 ? PX - lx : 999;
            const ey = dr < 0 ? ly : dr > 0 ? PX - ly : 999;
            const d = dc && dr ? Math.hypot(Math.min(ex, 999), Math.min(ey, 999)) : Math.min(ex, ey);
            ao = Math.min(ao, 0.45 + 0.55 * Math.min(1, d / 18));
        }
        return [r * ao, g * ao, b * ao];
    });
    const t = tex(c, false);
    t.anisotropy = 8;
    return t;
}

// One surface on its own, for tiling (the ground outside the playable map, hay, mattresses...)
export function surfaceTexture(kind) {
    const n = noise();
    return tex(paint(512, 512, (x, y) => lifted(kind, x, y, n)));
}

/* ── walls ─────────────────────────────────────────────── */
const WALLS = {
    logs(x, y, n) {
        const log = Math.floor(y / 32), ly = (y % 32) / 32;
        const round = Math.sin(ly * Math.PI);
        const grain = at(n.fine, x * 0.3 + log * 50, y * 2.5);
        const v = at(n.fbm, x + log * 90, y);
        const k = (0.3 + round * 0.75) * (0.7 + v * 0.5 + (grain - 0.5) * 0.3);
        return [92 * k, 64 * k, 40 * k];
    },
    plaster(x, y, n) {
        const v = at(n.fbm, x + 3, y * 0.7), stain = at(n.big, x * 1.5, y * 0.5 + 60);
        const drip = at(n.fine, x * 0.5, y * 0.05);
        let k = 0.75 + v * 0.35 - Math.max(0, stain - 0.55) * 1.1 - Math.max(0, drip - 0.8) * 0.8;
        const dado = y > 260;
        if (Math.abs(y - 260) < 2) k *= 0.5;
        return dado ? [70 * k, 86 * k, 76 * k] : [140 * k, 138 * k, 124 * k];
    },
    barn(x, y, n) {
        const board = Math.floor(x / 26), lx = x % 26;
        const v = at(n.fbm, x, y * 0.3 + board * 40), grain = at(n.fine, x * 3, y * 0.2);
        const seam = lx < 2 ? 0.35 : 1;
        const k = (0.55 + v * 0.55 + (grain - 0.5) * 0.3) * seam;
        return [104 * k, 36 * k, 28 * k];
    },
    brick(x, y, n) {
        const row = Math.floor(y / 16), off = (row & 1) * 16;
        const lx = (x + off) % 32, ly = y % 16;
        const mortar = lx < 2 || ly < 2;
        const v = at(n.fbm, x, y), b = at(n.small, Math.floor((x + off) / 32) * 17, row * 23);
        const k = 0.6 + v * 0.45;
        if (mortar) return [64 * k, 60 * k, 56 * k];
        return [(96 + b * 30) * k, (44 + b * 10) * k, (34) * k];
    },
};

export function wallTexture(kind) {
    const n = noise();
    return tex(paint(256, 384, (x, y) => WALLS[kind](x, y, n)));
}

// Corrugated steel, left pale so each container can be tinted its own colour
export function containerTexture() {
    const n = noise();
    return tex(paint(256, 256, (x, y) => {
        const rib = 0.78 + 0.22 * Math.sin(x / 256 * Math.PI * 2 * 7);
        const v = at(n.fbm, x * 2, y * 2), rust = at(n.big, x * 3 + 80, y * 1.2);
        const streak = at(n.fine, x * 0.6, y * 0.04);
        let k = rib * (0.75 + v * 0.35);
        let r = 220 * k, g = 220 * k, b = 220 * k;
        const rr = Math.max(0, rust - 0.52) * 3 + Math.max(0, streak - 0.78) * 2;
        if (rr > 0) { const m = Math.min(1, rr); r = r * (1 - m) + 120 * m * k; g = g * (1 - m) + 60 * m * k; b = b * (1 - m) + 30 * m * k; }
        const edge = (y < 6 || y > 250) ? 0.5 : 1;
        return [r * edge, g * edge, b * edge];
    }));
}

export function barkTexture() {
    const n = noise();
    return tex(paint(128, 256, (x, y) => {
        const v = at(n.fine, x * 2, y * 0.3), f = at(n.fbm, x * 3, y);
        const k = 0.35 + v * 0.5 + f * 0.3;
        return [70 * k, 50 * k, 36 * k];
    }));
}

export function foliageTexture() {
    const n = noise();
    return tex(paint(256, 256, (x, y) => {
        const v = at(n.fine, x * 2, y * 2), f = at(n.fbm, x, y), s = at(n.small, x * 3, y * 3);
        const k = 0.35 + v * 0.45 + f * 0.35 + (s > 0.7 ? 0.2 : 0);
        return [38 * k, 70 * k, 40 * k];
    }));
}

export function metalTexture(base = [90, 88, 84]) {
    const n = noise();
    return tex(paint(256, 256, (x, y) => {
        const v = at(n.fbm, x * 2, y * 2), rust = at(n.big, x * 2 + 40, y * 2 + 40), f = at(n.fine, x * 4, y * 4);
        const k = 0.6 + v * 0.5 + (f - 0.5) * 0.2;
        const m = Math.min(1, Math.max(0, rust - 0.45) * 2.5);
        return [(base[0] * (1 - m) + 110 * m) * k, (base[1] * (1 - m) + 56 * m) * k, (base[2] * (1 - m) + 30 * m) * k];
    }));
}

export function fabricTexture() {
    const n = noise();
    return tex(paint(128, 128, (x, y) => {
        const weave = ((x + y) & 3) === 0 ? 0.85 : 1;
        const v = at(n.fbm, x * 3, y * 3);
        const k = (0.8 + v * 0.3) * weave;
        return [200 * k, 200 * k, 200 * k];
    }));
}

/* ── alpha textures ────────────────────────────────────── */
// A few corn stalks with drooping leaves and a tassel, on a transparent background
export function cornTexture() {
    const c = canvas(256, 512), g = c.getContext('2d');
    const rand = rng(42);
    for (let s = 0; s < 3; s++) {
        const x0 = 50 + s * 78 + rand() * 20;
        const lean = (rand() - 0.5) * 30;
        g.strokeStyle = `rgb(${70 + rand() * 20},${86 + rand() * 20},${40})`;
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(x0, 512); g.quadraticCurveTo(x0 + lean * 0.3, 260, x0 + lean, 30); g.stroke();
        for (let l = 0; l < 7; l++) {
            const t = 0.2 + l * 0.11, y = 512 - t * 480, xm = x0 + lean * t * t;
            const dir = l & 1 ? 1 : -1, len = 60 + rand() * 50;
            const col = rand() < 0.35 ? `rgb(${120 + rand() * 30},${104 + rand() * 20},${54})` : `rgb(${58 + rand() * 20},${84 + rand() * 25},${36})`;
            g.fillStyle = col;
            g.beginPath(); g.moveTo(xm, y);
            g.quadraticCurveTo(xm + dir * len * 0.6, y - 40, xm + dir * len, y + 20 + rand() * 30);
            g.quadraticCurveTo(xm + dir * len * 0.5, y - 20, xm, y + 8);
            g.fill();
        }
        g.fillStyle = 'rgb(150,126,70)';
        for (let k = 0; k < 6; k++) { g.save(); g.translate(x0 + lean, 34); g.rotate((k - 2.5) * 0.25); g.fillRect(-1.5, -30, 3, 30); g.restore(); }
        if (rand() < 0.8) { g.fillStyle = 'rgb(160,140,70)'; g.beginPath(); g.ellipse(x0 + lean * 0.5 + 8, 250, 7, 26, 0.3, 0, Math.PI * 2); g.fill(); }
    }
    const t = tex(c, false);
    return t;
}

export function bloodTexture(seed = 7) {
    const c = canvas(256, 256), g = c.getContext('2d');
    const rand = rng(seed);
    const drop = (x, y, r, a) => {
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, `rgba(70,0,4,${a})`); grd.addColorStop(0.7, `rgba(90,4,8,${a * 0.9})`); grd.addColorStop(1, 'rgba(60,0,4,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    drop(128, 128, 70, 0.95);
    for (let i = 0; i < 40; i++) {
        const a = rand() * Math.PI * 2, d = 40 + rand() * 80;
        drop(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + rand() * 12, 0.8);
    }
    return tex(c, false);
}

export function glowTexture() {
    const c = canvas(128, 128), g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return tex(c, false);
}

// Soft blob used as a fake contact shadow under characters
export function shadowTexture() {
    const c = canvas(64, 64), g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.7)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return tex(c, false);
}

// Diamond wire mesh for the scrapyard fences
export function chainLinkTexture() {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.strokeStyle = 'rgba(170,172,176,0.95)'; g.lineWidth = 2.2;
    for (let i = -128; i < 256; i += 16) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
        g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke();
    }
    return tex(c);
}

// Soft drifting fog bank
export function mistTexture() {
    const n = noise();
    const c = canvas(256, 256), g = c.getContext('2d');
    const img = g.createImageData(256, 256), d = img.data;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const dx = (x - 128) / 128, dy = (y - 128) / 128;
        const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
        const v = at(n.fbm, x * 2, y * 2);
        const i = (y * 256 + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 200;
        d[i + 3] = clamp(fall * fall * (v - 0.25) * 2.2 * 255);
    }
    g.putImageData(img, 0, 0);
    return tex(c, false);
}

// Rippling water normals
export function waterNormals() {
    const n = noise();
    const h = (x, y) => at(n.small, x, y) * 0.6 + at(n.fine, x * 2, y * 2) * 0.4;
    const c = paint(256, 256, (x, y) => {
        const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
        return [128 + dx * 400, 128 + dy * 400, 255];
    });
    return tex(c, true, false);
}
