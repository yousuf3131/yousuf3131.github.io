// Courses: a closed spline turned into a road, curbs, run-off, barriers and scenery.
// Also provides the math the game needs: where am I along the track, and how far off-line.
import * as THREE from 'three';

const HW = 8;        // half the road width
const RUNOFF = 5;    // sand between the curb and the barrier
const N = 1400;      // samples along the centre line
const TREE_MAX = 320;

// Per-track visual theme defaults
const THEME_DEFAULT = {
    ground: '#5ea94f', groundSpeckle: ['#6cb85a', '#4f9444', '#74c062', '#58a04b'],
    road: '#3a3e45', roadSpeckle: ['#43474f', '#33363c', '#4a4e56'],
    sand: '#e2c48e', sandSpeckle: ['#d6b67c', '#ecd3a4', '#cfae72'],
    curb: ['#e0473f', '#f5f5f5'], wall: ['#2f63d8', '#f3f5f8'],
    fog: '#b0d8c0', sky: '#7ec8e3',
    treeHue: [0.25, 0.36], treeSat: [0.4, 0.6], treeLit: [0.26, 0.38],
    hillColor: 0x6f9a6a,
    // Sky gradient and lighting
    skyTop: '#4a86d8', skyMid: '#9fcaf2', skyHor: '#ffd9b0',
    sun: 0xfff1dc, sunInt: 2.3, hemiSky: 0xe8f4ff, hemiGround: 0x3d5a3a, hemiInt: 1.1, exposure: 1,
};

export const COURSES = [
    {
        id: 'coast',
        name: 'Sunset Coast',
        desc: 'A long harbour straight, a tight hairpin and a wiggly chicane.',
        laps: 3,
        available: true,
        points: [
            [0, 0], [120, 0], [200, -10], [250, -60], [255, -130], [215, -175], [150, -170], [110, -130],
            [70, -100], [20, -120], [-30, -170], [-110, -180], [-180, -140], [-200, -60], [-170, 10],
            [-200, 80], [-160, 150], [-80, 160], [-20, 120], [-60, 60], [-40, 20],
        ],
        pads: [[0.1, 0], [0.42, -3], [0.7, 3]],
        items: [0.2, 0.52, 0.84],
        theme: {
            fog: '#efc6a6', skyTop: '#3e62a8', skyMid: '#e8a283', skyHor: '#ffd29a',
            sun: 0xffd7a6, sunInt: 2.4, hemiSky: 0xffe6cf, hemiGround: 0x4a5a3a, hemiInt: 1.0,
        },
    },
    {
        id: 'city',
        name: 'Neon City',
        desc: 'Night streets, tight 90-degree corners and nowhere to hide.',
        laps: 3,
        available: true,
        points: [[0, 0], [140, 0], [140, -120], [40, -120], [40, -200], [-120, -200], [-120, -40], [-70, -40], [-70, 60], [-140, 60], [-140, 140], [0, 140]],
        pads: [[0.15, 0], [0.5, -3], [0.82, 3]],
        items: [0.26, 0.6, 0.92],
        theme: {
            skyTop: '#05040c', skyMid: '#160b2a', skyHor: '#4a1850', fogDensity: 0.0026,
            sun: 0x8a9cff, sunInt: 0.9, hemiSky: 0x7a66cc, hemiGround: 0x2a1a34, hemiInt: 0.95, exposure: 1.15, wetRoad: true,
            ground: '#2a2a35', groundSpeckle: ['#33333f', '#222230', '#3a3a48'],
            road: '#1e1e28', roadSpeckle: ['#252530', '#1a1a24', '#2e2e3a'],
            sand: '#3a3542', sandSpeckle: ['#44404e', '#332f3c', '#4a4558'],
            curb: ['#ff2266', '#222233'], wall: ['#6622cc', '#1a1a2e'],
            fog: '#1a0d2a', sky: '#0d0818',
            treeHue: [0.75, 0.85], treeSat: [0.5, 0.7], treeLit: [0.2, 0.3],
            hillColor: 0x221833, scenery: 'city',
        },
        hazards: [
            { type: 'water', pos: 0.35, lat: 0, radius: 4 },
        ],
    },
    {
        id: 'canyon',
        name: 'Dust Canyon',
        desc: 'Fast, sweeping bends through the desert.',
        laps: 3,
        available: true,
        points: [[0, 0], [160, -40], [220, -160], [120, -240], [-40, -200], [-180, -240], [-240, -100], [-160, 40], [-60, 20], [-100, 120], [60, 140]],
        pads: [[0.08, 0], [0.38, -4], [0.65, 2], [0.88, 0]],
        items: [0.3, 0.47, 0.76],
        theme: {
            skyTop: '#5d9ad8', skyMid: '#eed9a6', skyHor: '#ffe4ae', sun: 0xfff0d0, sunInt: 2.6,
            ground: '#c4a05a', groundSpeckle: ['#d4b06a', '#b89048', '#caa860'],
            road: '#8a7a5e', roadSpeckle: ['#948466', '#7e7054', '#a08e6e'],
            sand: '#dcc080', sandSpeckle: ['#e8cc8e', '#d0b470', '#f0d898'],
            curb: ['#cc5522', '#f0e8d0'], wall: ['#994411', '#e8d8b8'],
            fog: '#d8c8a0', sky: '#e8c870',
            treeHue: [0.08, 0.12], treeSat: [0.3, 0.5], treeLit: [0.25, 0.35],
            hillColor: 0xa88850, scenery: 'rocks',
        },
        hazards: [
            { type: 'ramp', pos: 0.22, lat: 0, width: 10, height: 3.5 },
            { type: 'fire', pos: 0.55, lat: 3, radius: 3 },
        ],
    },
    {
        id: 'volcano',
        name: 'Volcano Valley',
        desc: 'Lava flows, big ramps, and fireballs raining from above.',
        laps: 3,
        available: true,
        points: [
            [30, 90], [130, 40], [180, -80], [200, -170], [150, -230], [60, -238],
            [-40, -220], [-110, -160], [-80, -80], [-140, -30], [-200, -80],
            [-220, -170], [-160, -230], [-100, -280], [0, -300], [80, -280],
            [140, -310], [120, -360], [40, -370], [-40, -340], [-100, -360],
            [-140, -320], [-120, -260], [-60, -200], [20, -160], [60, -100],
            [40, -40], [-20, 20], [-30, 70],
        ],
        pads: [[0.05, 0], [0.3, -3], [0.6, 2], [0.81, 0]],
        // An elevated viaduct carries the course over both of its crossings
        elevation: [[0.735, 0], [0.768, 8.5], [0.845, 8.5], [0.88, 0]],
        items: [0.24, 0.45, 0.95],
        theme: {
            skyTop: '#140404', skyMid: '#3e1206', skyHor: '#a8381a', fogDensity: 0.0022,
            sun: 0xffa070, sunInt: 2.1, hemiSky: 0xff9a66, hemiGround: 0x4a2010, hemiInt: 1.05, exposure: 1.15,
            embers: true, concrete: '#5a4a44', rail: 0xff7a30,
            ground: '#3a2a1a', groundSpeckle: ['#4a3828', '#2e2016', '#543e2c'],
            road: '#2e2222', roadSpeckle: ['#3a2a2a', '#241a1a', '#443333'],
            sand: '#5a3a20', sandSpeckle: ['#6a4830', '#4e3018', '#7a5838'],
            curb: ['#ff4400', '#331100'], wall: ['#882200', '#441100'],
            fog: '#4a1a0c', sky: '#2a1008',
            treeHue: [0.02, 0.06], treeSat: [0.6, 0.8], treeLit: [0.15, 0.25],
            hillColor: 0x3a2010, scenery: 'volcano',
        },
        hazards: [
            { type: 'ramp', pos: 0.15, lat: 0, width: 12, height: 4 },
            { type: 'fire', pos: 0.35, lat: -3, radius: 3.5 },
            { type: 'fire', pos: 0.52, lat: 4, radius: 3 },
            { type: 'ramp', pos: 0.7, lat: 0, width: 10, height: 3 },
            { type: 'hoop', pos: 0.72, lat: 0 },
        ],
    },
    {
        id: 'aqua',
        name: 'Aqua Park',
        desc: 'Water zones, ramps into hoops, and splash sections galore.',
        laps: 3,
        available: true,
        points: [
            [0, 0], [110, 10], [180, -30], [220, -100], [180, -180], [100, -200],
            [40, -160], [-20, -200], [-100, -220], [-160, -180], [-140, -100],
            [-180, -40], [-140, 30], [-80, 60], [-40, 20],
        ],
        pads: [[0.08, 0], [0.45, -2], [0.75, 3]],
        items: [0.27, 0.53, 0.9],
        theme: {
            skyTop: '#2f86dc', skyMid: '#8fd0f0', skyHor: '#e4f6ff',
            ground: '#3a9a6a', groundSpeckle: ['#48aa78', '#2e8a5c', '#55bb85'],
            road: '#3a5a7a', roadSpeckle: ['#446a8a', '#304e6a', '#4e7a9a'],
            sand: '#e8dcc0', sandSpeckle: ['#f0e8d0', '#dcd0b0', '#f8f0d8'],
            curb: ['#00aaff', '#e0f8ff'], wall: ['#0088cc', '#c0e8ff'],
            fog: '#a0d8e8', sky: '#60c0e0',
            treeHue: [0.45, 0.55], treeSat: [0.4, 0.6], treeLit: [0.3, 0.4],
            hillColor: 0x4a9a6a, scenery: 'aqua',
        },
        hazards: [
            { type: 'water', pos: 0.2, lat: 0, radius: 5 },
            { type: 'ramp', pos: 0.35, lat: 0, width: 10, height: 3 },
            { type: 'hoop', pos: 0.37, lat: 0 },
            { type: 'water', pos: 0.6, lat: -3, radius: 4 },
            { type: 'water', pos: 0.8, lat: 3, radius: 3.5 },
        ],
    },
    {
        id: 'frost',
        name: 'Frozen Summit',
        desc: 'Icy bends, ski jumps, and slippery surfaces at the top of the world.',
        laps: 3,
        available: true,
        points: [
            [0, 0], [100, -10], [170, -60], [200, -140], [160, -210], [80, -230],
            [0, -190], [-60, -240], [-140, -260], [-200, -210], [-180, -130],
            [-220, -60], [-180, 20], [-100, 40], [-40, 10],
        ],
        pads: [[0.1, 0], [0.4, -3], [0.7, 2], [0.92, 0]],
        items: [0.28, 0.55, 0.77],
        theme: {
            skyTop: '#4e7cb8', skyMid: '#b6d0ea', skyHor: '#eef6ff', sun: 0xf2f6ff, sunInt: 2.1, hemiInt: 1.25, snow: true,
            ground: '#d8e8f0', groundSpeckle: ['#e0f0f8', '#c8d8e8', '#f0f8ff'],
            road: '#8898a8', roadSpeckle: ['#90a0b0', '#7888a0', '#a0b0c0'],
            sand: '#c0d0e0', sandSpeckle: ['#d0dce8', '#b0c4d4', '#d8e4f0'],
            curb: ['#4488cc', '#e0f0ff'], wall: ['#3366aa', '#c8e0f8'],
            fog: '#c8d8e8', sky: '#90b8d8',
            treeHue: [0.52, 0.58], treeSat: [0.15, 0.3], treeLit: [0.5, 0.65],
            hillColor: 0xc0d0e0, scenery: 'ice',
        },
        hazards: [
            { type: 'water', pos: 0.18, lat: 0, radius: 5 },
            { type: 'ramp', pos: 0.4, lat: 0, width: 12, height: 4.5 },
            { type: 'hoop', pos: 0.42, lat: 0 },
            { type: 'water', pos: 0.65, lat: -4, radius: 4 },
            { type: 'ramp', pos: 0.85, lat: 0, width: 10, height: 3 },
        ],
    },
];
export const COURSE_BY_ID = Object.fromEntries(COURSES.map(c => [c.id, c]));

const rand = (a, b) => a + Math.random() * (b - a);
function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function makeCurve(course) {
    return new THREE.CatmullRomCurve3(course.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
}

function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

function speckle(g, w, h, n, colors) {
    for (let i = 0; i < n; i++) {
        g.fillStyle = colors[i % colors.length];
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
}

// Flat 2D course preview, used on the vote cards
export function drawCourseMap(ctx, course, w, h) {
    const pts = makeCurve(course).getSpacedPoints(240);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 28;
    const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * sc) / 2 - minX * sc, oz = (h - (maxZ - minZ) * sc) / 2 - minZ * sc;
    const trace = () => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x * sc + ox, p.z * sc + oz) : ctx.moveTo(p.x * sc + ox, p.z * sc + oz)));
        ctx.closePath();
    };
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = ctx.lineCap = 'round';
    trace(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 18; ctx.stroke();
    trace(); ctx.strokeStyle = course.available ? '#f2f5f4' : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 9; ctx.stroke();
    trace(); ctx.setLineDash([10, 10]); ctx.strokeStyle = course.available ? '#2ec495' : 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    const s = pts[0];
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(s.x * sc + ox, s.z * sc + oz, 7, 0, Math.PI * 2);
    ctx.fill();
}

// Height of the road along the course from its elevation profile: [[fraction, height], ...].
// Heights ease smoothly between the control points (so bridges get ramps up and down).
function elevationAt(course, frac) {
    const e = course.elevation;
    if (!e || !e.length) return 0;
    for (let k = 0; k < e.length; k++) {
        const [f0, h0] = e[k], [f1raw, h1] = e[(k + 1) % e.length];
        const f1 = k + 1 < e.length ? f1raw : f1raw + 1;
        let f = frac;
        if (f < f0) f += 1;
        if (f >= f0 && f <= f1) {
            const t = (f - f0) / Math.max(1e-6, f1 - f0);
            return h0 + (h1 - h0) * t * t * (3 - 2 * t);
        }
    }
    return e[0][1];
}

// Everything about a course's centre line: positions, directions, distances and heights
function sampleCourse(course) {
    const pts = makeCurve(course).getSpacedPoints(N);
    const px = new Float32Array(N), pz = new Float32Array(N), py = new Float32Array(N);
    const tx = new Float32Array(N), tz = new Float32Array(N);
    const nx = new Float32Array(N), nz = new Float32Array(N);
    const heading = new Float32Array(N), cum = new Float32Array(N), jump = new Uint8Array(N);
    for (let i = 0; i < N; i++) { px[i] = pts[i].x; pz[i] = pts[i].z; }
    let total = 0;
    for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, k = (i - 1 + N) % N;
        const dx = px[j] - px[k], dz = pz[j] - pz[k], l = Math.hypot(dx, dz);
        tx[i] = dx / l; tz[i] = dz / l;
        nx[i] = -tz[i]; nz[i] = tx[i];
        heading[i] = Math.atan2(tz[i], tx[i]);
        cum[i] = total;
        total += Math.hypot(px[j] - px[i], pz[j] - pz[i]);
    }
    const step = total / N;
    for (let i = 0; i < N; i++) py[i] = elevationAt(course, i / N);

    // Jump ramps sit on top of the road height; their far side is marked so cars launch off it
    const hazardZones = [];
    for (const h of (course.hazards || [])) {
        const center = Math.floor(h.pos * N) % N;
        if (h.type === 'ramp') {
            const rampLen = (h.width || 10) * 3;
            const halfW = Math.max(20, Math.round(rampLen / step / 2));
            const base = py[center];
            for (let o = -halfW; o <= halfW; o++) {
                const k = (center + o + N) % N;
                const t = 1 - Math.abs(o) / halfW;
                py[k] = Math.max(py[k], base + (h.height || 3) * t * t * (3 - 2 * t));
                if (o >= 0) jump[k] = 1;
            }
        }
        hazardZones.push({ ...h, idx: center, dist: cum[center] });
    }
    return { px, pz, py, tx, tz, nx, nz, heading, cum, jump, total, step, hazardZones };
}

// The corridor is road + run-off + barrier on each side. Two parts of the course that aren't
// neighbours along the track must never come closer than this unless one passes well over the other.
export const CORRIDOR = 2 * (HW + RUNOFF + 0.3) + 4;
export const CLEARANCE = 6.5;
export function findOverlaps(course) {
    const S = sampleCourse(course);
    const hits = [];
    for (let i = 0; i < N; i += 2) {
        for (let j = i + 2; j < N; j += 2) {
            let along = Math.abs(S.cum[i] - S.cum[j]);
            along = Math.min(along, S.total - along);
            if (along < CORRIDOR * 2.2) continue;
            const d = Math.hypot(S.px[i] - S.px[j], S.pz[i] - S.pz[j]);
            if (d < CORRIDOR && Math.abs(S.py[i] - S.py[j]) < CLEARANCE) hits.push({ i, j, d });
        }
    }
    // Group neighbouring hits into one problem per place
    const groups = [];
    for (const h of hits) {
        const g = groups.find(q => Math.abs(q.i1 - h.i) <= 40 && Math.abs(q.j1 - h.j) <= 40);
        if (g) { g.i1 = h.i; g.j1 = Math.max(g.j1, h.j); if (h.d < g.d) { g.d = h.d; g.ai = h.i; g.aj = h.j; } }
        else groups.push({ i0: h.i, i1: h.i, j0: h.j, j1: h.j, d: h.d, ai: h.i, aj: h.j });
    }
    return groups.map(g => ({
        a: +(g.ai / N).toFixed(3), b: +(g.aj / N).toFixed(3), closest: +g.d.toFixed(1),
        at: [Math.round(S.px[g.ai]), Math.round(S.pz[g.ai])],
        heights: [+S.py[g.ai].toFixed(1), +S.py[g.aj].toFixed(1)],
    }));
}

export function buildTrack(course) {
    const T = { ...THEME_DEFAULT, ...(course.theme || {}) };

    // ---------- Centre line samples ----------
    const S = sampleCourse(course);
    const { px, pz, py, tx, tz, nx, nz, heading, cum, jump, total, step, hazardZones } = S;

    // ---------- Queries ----------
    // Road height at sample i, blended with its neighbour by how far along the segment we are
    function heightAt(idx) { return py[((idx % N) + N) % N]; }
    function surfaceY(i, along) {
        const t = along / step;
        if (t >= 0) return py[i] + (py[(i + 1) % N] - py[i]) * Math.min(1, t);
        return py[i] + (py[(i - 1 + N) % N] - py[i]) * Math.min(1, -t);
    }
    // Where is (x, z) along the course? With a hint we only search nearby samples, so a racer on a
    // bridge never snaps to the road below it (the two are far apart along the course). Without a
    // hint we search everywhere, and y breaks ties between decks.
    function project(x, z, hint, y) {
        let best = 0, bd = Infinity;
        if (hint == null || hint < 0) {
            for (let i = 0; i < N; i += 4) {
                let d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
                if (y != null) d += ((y - py[i]) * 4) ** 2;
                if (d < bd) { bd = d; best = i; }
            }
            hint = best;
            bd = Infinity;
        }
        for (let o = -40; o <= 40; o++) {
            const i = (hint + o + N) % N;
            const d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
            if (d < bd) { bd = d; best = i; }
        }
        const i = best, rx = x - px[i], rz = z - pz[i];
        const along = rx * tx[i] + rz * tz[i];
        let dist = cum[i] + along;
        if (dist < 0) dist += total;
        if (dist >= total) dist -= total;
        return { i, lat: rx * nx[i] + rz * nz[i], dist, nx: nx[i], nz: nz[i], tx: tx[i], tz: tz[i], y: surfaceY(i, along), jump: jump[i] };
    }
    function pointAhead(i, dist, lat) {
        const j = (((i + Math.round(dist / step)) % N) + N) % N;
        return { x: px[j] + nx[j] * lat, z: pz[j] + nz[j] * lat, y: py[j], i: j };
    }
    function curvatureAhead(i, dist) {
        const n = Math.max(2, Math.round(dist / step));
        let s = 0;
        for (let k = 0; k < n; k += 2) s += Math.abs(angleDiff(heading[(i + k) % N], heading[(i + k + 2) % N]));
        return s;
    }
    // Two-wide grid behind the start line, staggered
    function gridPos(slot) {
        const back = 12 + Math.floor(slot / 2) * 7 + (slot % 2) * 2.5;
        const j = (N - Math.round(back / step)) % N;
        const lat = slot % 2 ? -3.4 : 3.4;
        return { x: px[j] + nx[j] * lat, z: pz[j] + nz[j] * lat, h: heading[j], i: j, dist: cum[j] };
    }

    // ---------- Meshes ----------
    const group = new THREE.Group();
    const disposables = [];
    // Track materials ignore the reflection map (only cars and a wet road use it)
    const mat = opts => { const m = new THREE.MeshStandardMaterial({ envMapIntensity: 0, ...opts }); disposables.push(m); return m; };
    const tex = (...a) => { const t = canvasTex(...a); disposables.push(t); return t; };

    const grassTex = tex(256, 256, (g, w, h) => { g.fillStyle = T.ground; g.fillRect(0, 0, w, h); speckle(g, w, h, 4000, T.groundSpeckle); });
    grassTex.repeat.set(260, 260);
    const roadTex = tex(256, 256, (g, w, h) => {
        g.fillStyle = T.road; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 5000, T.roadSpeckle);
        g.fillStyle = '#f4f4f4';
        g.fillRect(10, 0, 6, h); g.fillRect(w - 16, 0, 6, h);
        g.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const sandTex = tex(128, 128, (g, w, h) => { g.fillStyle = T.sand; g.fillRect(0, 0, w, h); speckle(g, w, h, 1500, T.sandSpeckle); });
    const curbTex = tex(16, 64, (g, w, h) => { g.fillStyle = T.curb[0]; g.fillRect(0, 0, w, h / 2); g.fillStyle = T.curb[1]; g.fillRect(0, h / 2, w, h / 2); });
    const wallTex = tex(32, 64, (g, w, h) => {
        g.fillStyle = T.wall[0]; g.fillRect(0, 0, w, h / 2);
        g.fillStyle = T.wall[1]; g.fillRect(0, h / 2, w, h / 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 5, h);
    });
    const concreteTex = tex(128, 128, (g, w, h) => {
        g.fillStyle = T.concrete || '#8d8f94'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 1800, ['#7f8186', '#9a9ca1', '#85878c']);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
    });
    const checkTex = tex(64, 64, (g, w) => {
        const s = w / 8;
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fafafa'; g.fillRect(i * s, j * s, s, s); }
    });
    checkTex.repeat.set(1, 7);
    const chevTex = tex(128, 64, (g, w, h) => {
        g.fillStyle = 'rgba(46,196,149,0.35)'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#eafff7'; g.lineWidth = 10; g.lineJoin = 'round';
        for (const x of [18, 76]) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x + 28, h / 2); g.lineTo(x, h - 8); g.stroke(); }
    });
    const bannerTex = tex(512, 64, (g, w, h) => {
        g.fillStyle = '#10231c'; g.fillRect(0, 0, w, h);
        const s = 16;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
            g.fillRect(i * s, j * s, s, s);
            g.fillRect(w - 64 + i * s, j * s, s, s);
        }
        g.fillStyle = '#f2c14e';
        g.font = '900 40px "Arial Black", Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('BONK RACERS', w / 2, h / 2 + 2);
    });
    bannerTex.repeat.set(2, 1);

    // A strip that follows the course. at(k) gives its two edge points at sample k; include(k)
    // (optional) leaves gaps where it's false.
    function strip(material, vLen, at, include, shadows = true) {
        const pos = [], uv = [], idx = [];
        let count = 0, prev = false;
        for (let i = 0; i <= N; i++) {
            const k = i % N;
            if (include && !include(k)) { prev = false; continue; }
            const [a, b] = at(k);
            const v = (i === N ? total : cum[k]) / vLen;
            pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
            uv.push(0, v, 1, v);
            if (prev) { const s = count - 2; idx.push(s, s + 2, s + 1, s + 1, s + 2, s + 3); }
            count += 2;
            prev = true;
        }
        if (!idx.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, material);
        m.receiveShadow = shadows;
        group.add(m);
        return m;
    }
    const P = (k, lat, y) => [px[k] + nx[k] * lat, y, pz[k] + nz[k] * lat];
    // Flat strip between lateral offsets a > b, lifted y above the road surface
    const ribbon = (a, b, y, vLen, material) => strip(material, vLen, k => [P(k, a, py[k] + y), P(k, b, py[k] + y)]);
    // Vertical strip at lateral offset a, from y0 to y1 above the road surface
    const wall = (a, y0, y1, vLen, material, include) => strip(material, vLen, k => [P(k, a, py[k] + y0), P(k, a, py[k] + y1)], include);

    // Subdivided so depth stays precise near the camera (one giant quad lets the grass poke through the road)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 64, 64), mat({ map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);

    const edge = HW + RUNOFF + 0.3;
    const sandMat = mat({ map: sandTex, roughness: 1 });
    ribbon(edge, HW + 1.2, 0.006, 6, sandMat);
    ribbon(-HW - 1.2, -edge, 0.006, 6, sandMat);
    const wet = !!T.wetRoad;
    const roadMat = mat({
        map: roadTex, roughness: wet ? 0.28 : 0.9, metalness: wet ? 0.35 : 0, envMapIntensity: wet ? 1.3 : 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    ribbon(HW, -HW, 0.012, 16, roadMat);
    const curbMat = mat({ map: curbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ribbon(HW + 1.2, HW, 0.02, 2.4, curbMat);
    ribbon(-HW, -HW - 1.2, 0.02, 2.4, curbMat);
    const wallMat = mat({ map: wallTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [1, -1]) wall(s * edge, 0, 1.0, 4, wallMat).castShadow = true;

    // ---------- Bridges and embankments ----------
    // Where the road is raised, find the parts with another part of the course underneath:
    // those become open spans (a thin deck on pillars), the rest is a solid embankment.
    const raised = k => py[k] > 0.35;
    const open = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
        if (py[i] < 2) continue;
        for (let j = 0; j < N; j += 2) {
            let along = Math.abs(cum[i] - cum[j]);
            along = Math.min(along, total - along);
            if (along < 60 || py[j] > py[i] - 3) continue;
            if ((px[i] - px[j]) ** 2 + (pz[i] - pz[j]) ** 2 < (edge * 2 + 10) ** 2) { open[i] = 1; break; }
        }
    }
    const DECK = 0.9;
    const bottom = k => (open[k] ? py[k] - DECK : 0);
    const concreteMat = mat({ map: concreteTex, roughness: 0.85, side: THREE.DoubleSide });
    for (const s of [1, -1]) {
        const f = wall(s * (edge + 0.02), 0, 0, 3, concreteMat, raised);
        if (f) {
            // Outer face of the deck / embankment, from the road surface down to the ground or deck bottom
            const pos = f.geometry.attributes.position;
            let n = 0;
            for (let i = 0; i <= N; i++) {
                const k = i % N;
                if (!raised(k)) continue;
                pos.setY(n * 2, bottom(k));
                n++;
            }
            pos.needsUpdate = true;
            f.geometry.computeVertexNormals();
            f.castShadow = true;
        }
    }
    const underside = strip(concreteMat, 6, k => [P(k, edge, py[k] - DECK), P(k, -edge, py[k] - DECK)], k => open[k] && raised(k));
    if (underside) underside.castShadow = true;
    // Side rails on anything raised
    const railMat = mat({ color: T.rail || 0xe8c547, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.6 });
    for (const s of [1, -1]) wall(s * edge, 1.0, 1.22, 4, railMat, k => py[k] > 1.5);
    // Pillars under open spans, kept out of the corridor of the road passing underneath
    const pillarSpots = [], lampSpots = [];
    for (let i = 0; i < N; i += Math.max(1, Math.round(13 / step))) {
        if (!open[i]) continue;
        for (const s of [1, -1]) {
            const x = px[i] + nx[i] * s * (edge - 0.9), z = pz[i] + nz[i] * s * (edge - 0.9);
            let clear = true;
            for (let j = 0; j < N; j += 2) {
                if (py[j] > py[i] - 3) continue;
                if ((x - px[j]) ** 2 + (z - pz[j]) ** 2 < (edge + 1.5) ** 2) { clear = false; break; }
            }
            if (clear) pillarSpots.push([x, z, py[i] - DECK]);
        }
        lampSpots.push(i);
    }
    if (pillarSpots.length) {
        const pg = new THREE.BoxGeometry(1.5, 1, 1.5);
        pg.translate(0, 0.5, 0);
        const pillars = new THREE.InstancedMesh(pg, concreteMat, pillarSpots.length);
        const dm = new THREE.Object3D();
        pillarSpots.forEach(([x, z, h], n) => { dm.position.set(x, 0, z); dm.scale.set(1, h, 1); dm.updateMatrix(); pillars.setMatrixAt(n, dm.matrix); });
        pillars.castShadow = pillars.receiveShadow = true;
        group.add(pillars);
    }
    // Underpass lights on the deck's underside
    if (lampSpots.length) {
        const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 2.4), mat({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 2.2 }), lampSpots.length * 2);
        const dm = new THREE.Object3D();
        let n = 0;
        for (const i of lampSpots) for (const s of [1, -1]) {
            dm.position.set(px[i] + nx[i] * s * 5, py[i] - DECK - 0.08, pz[i] + nz[i] * s * 5);
            dm.rotation.y = -heading[i];
            dm.updateMatrix();
            lamps.setMatrixAt(n++, dm.matrix);
        }
        group.add(lamps);
    }

    // Start line and arch
    const h0 = heading[0];
    const lineGeo = new THREE.PlaneGeometry(2.2, HW * 2);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, mat({ map: checkTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    line.position.set(px[0], py[0] + 0.025, pz[0]);
    line.rotation.y = -h0;
    group.add(line);

    const arch = new THREE.Group();
    arch.position.set(px[0], py[0], pz[0]);
    arch.rotation.y = -h0;
    const span = edge + 0.8;
    const pillarMat = mat({ color: 0x23302b, roughness: 0.6 });
    const bannerMat = mat({ map: bannerTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.5 });
    for (const s of [1, -1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1, 7.5, 1), pillarMat);
        p.position.set(0, 3.75, s * span);
        p.castShadow = true;
        arch.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, span * 2 + 1), [bannerMat, bannerMat, pillarMat, pillarMat, pillarMat, pillarMat]);
    beam.position.y = 7.4;
    beam.castShadow = true;
    arch.add(beam);
    group.add(arch);

    // Boost pads
    const padMat = mat({ map: chevTex, emissive: 0x2ec495, emissiveMap: chevTex, emissiveIntensity: 1.6, transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pads = (course.pads || []).map(([f, lat]) => {
        const j = Math.floor(f * N) % N;
        const g = new THREE.PlaneGeometry(5, 4.2);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, padMat);
        m.position.set(px[j] + nx[j] * lat, py[j] + 0.03, pz[j] + nz[j] * lat);
        m.rotation.y = -heading[j];
        group.add(m);
        return { dist: cum[j], lat, y: py[j] };
    });

    // Item box rows: four boxes spread across the road at each listed point of the lap
    const itemSpots = [];
    for (const f of (course.items || [])) {
        const j = Math.floor(f * N) % N;
        for (const lat of [-5.4, -1.8, 1.8, 5.4]) {
            itemSpots.push({ x: px[j] + nx[j] * lat, y: py[j], z: pz[j] + nz[j] * lat, dist: cum[j], lat, i: j, h: heading[j] });
        }
    }

    // Grandstand with a crowd, just after the start
    {
        const j = Math.floor(N * 0.015);
        const stand = new THREE.Group();
        stand.position.set(px[j] + nx[j] * (edge + 4), 0, pz[j] + nz[j] * (edge + 4));
        stand.rotation.y = -heading[j];
        const standMat = mat({ color: 0x8c96a8, roughness: 0.8 });
        for (let t = 0; t < 3; t++) {
            const tier = new THREE.Mesh(new THREE.BoxGeometry(26, 1 + t, 3), standMat);
            tier.position.set(0, (1 + t) / 2, 1.5 + t * 3);
            tier.castShadow = tier.receiveShadow = true;
            stand.add(tier);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(27, 0.3, 10), mat({ color: 0x2ec495, roughness: 0.5 }));
        roof.position.set(0, 6.5, 4.5);
        roof.castShadow = true;
        stand.add(roof);
        const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 10, 8), mat({ color: 0xffffff, roughness: 0.7 }), 66);
        const dummy = new THREE.Object3D(), col = new THREE.Color();
        let n = 0;
        for (let t = 0; t < 3; t++) for (let k = 0; k < 22; k++) {
            dummy.position.set(-11.5 + k * 1.1 + rand(-0.15, 0.15), 1.4 + t, 1.5 + t * 3);
            dummy.scale.setScalar(rand(0.85, 1.1));
            dummy.updateMatrix();
            crowd.setMatrixAt(n, dummy.matrix);
            crowd.setColorAt(n, col.setHSL(Math.random(), 0.6, 0.55));
            n++;
        }
        stand.add(crowd);
        group.add(stand);
    }

    // Trees, kept clear of the track
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
        minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
        minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
    }
    const nearest = (x, z) => {
        let d = Infinity;
        for (let i = 0; i < N; i += 6) d = Math.min(d, (x - px[i]) ** 2 + (z - pz[i]) ** 2);
        return Math.sqrt(d);
    };
    const nearestIdx = (x, z) => {
        let d = Infinity, b = 0;
        for (let i = 0; i < N; i += 6) { const q = (x - px[i]) ** 2 + (z - pz[i]) ** 2; if (q < d) { d = q; b = i; } }
        return b;
    };
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
    trunkGeo.translate(0, 1, 0);
    const leafGeo = new THREE.ConeGeometry(1.8, 4.6, 7);
    leafGeo.translate(0, 4.2, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat({ color: 0x7a5234, roughness: 1 }), TREE_MAX);
    const leaves = new THREE.InstancedMesh(leafGeo, mat({ color: 0xffffff, roughness: 0.9, flatShading: true }), TREE_MAX);
    {
        const dummy = new THREE.Object3D(), col = new THREE.Color();
        let count = 0;
        const want = T.scenery === 'city' ? 60 : TREE_MAX;
        for (let tries = 0; tries < 3000 && count < want; tries++) {
            const x = rand(minX - 140, maxX + 140), z = rand(minZ - 140, maxZ + 140);
            if (nearest(x, z) < edge + 5) continue;
            const s = rand(0.7, 1.5);
            dummy.position.set(x, 0, z);
            dummy.rotation.y = rand(0, Math.PI * 2);
            dummy.scale.set(s, s * rand(0.85, 1.25), s);
            dummy.updateMatrix();
            trunks.setMatrixAt(count, dummy.matrix);
            leaves.setMatrixAt(count, dummy.matrix);
            leaves.setColorAt(count, col.setHSL(rand(T.treeHue[0], T.treeHue[1]), rand(T.treeSat[0], T.treeSat[1]), rand(T.treeLit[0], T.treeLit[1])));
            count++;
        }
        trunks.count = leaves.count = count;
    }
    trunks.castShadow = leaves.castShadow = true;
    group.add(trunks, leaves);

    // Distant low-poly hills for the horizon
    const hillMat = mat({ color: T.hillColor, roughness: 1, flatShading: true });
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(560, 760), hgt = rand(60, 170);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(rand(120, 220), hgt, 7), hillMat);
        cone.position.set(cx + Math.cos(a) * r, hgt / 2 - 5, cz + Math.sin(a) * r);
        group.add(cone);
    }

    // ---------- Hazard visuals ----------
    const hazardMeshes = [];
    const glowMats = [];   // materials whose glow pulses
    for (const hz of hazardZones) {
        const j = hz.idx;
        const hx = px[j] + nx[j] * (hz.lat || 0);
        const hz2 = pz[j] + nz[j] * (hz.lat || 0);
        const hy = py[j];
        if (hz.type === 'fire') {
            const r = hz.radius || 3;
            const fg = new THREE.CircleGeometry(r, 20);
            fg.rotateX(-Math.PI / 2);
            const fmat = mat({
                color: 0xff4400, emissive: 0xff3300, emissiveIntensity: 2.2,
                transparent: true, opacity: 0.85, roughness: 0.3,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
            });
            glowMats.push({ m: fmat, base: 2.2, amp: 0.8, f: 3 });
            const fm = new THREE.Mesh(fg, fmat);
            fm.position.set(hx, hy + 0.04, hz2);
            group.add(fm);
            hazardMeshes.push(fm);
        } else if (hz.type === 'water') {
            const r = hz.radius || 4;
            const wg = new THREE.CircleGeometry(r, 20);
            wg.rotateX(-Math.PI / 2);
            const wm = new THREE.Mesh(wg, mat({
                color: 0x2288dd, emissive: 0x1166aa, emissiveIntensity: 0.4,
                transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.3, envMapIntensity: 1,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
            }));
            wm.position.set(hx, hy + 0.03, hz2);
            group.add(wm);
            hazardMeshes.push(wm);
        } else if (hz.type === 'hoop') {
            const hoopG = new THREE.TorusGeometry(4, 0.35, 10, 32);
            const hoopMat = mat({ color: 0xf2c14e, emissive: 0xf2a020, emissiveIntensity: 1.8, roughness: 0.3 });
            glowMats.push({ m: hoopMat, base: 1.8, amp: 0.6, f: 5 });
            const hoopM = new THREE.Mesh(hoopG, hoopMat);
            hoopM.position.set(hx, hy + 4, hz2);
            hoopM.rotation.y = -heading[j] + Math.PI / 2;
            hoopM.userData.hoop = true;
            group.add(hoopM);
            hazardMeshes.push(hoopM);
        }
    }

    // ---------- Theme-specific scenery ----------
    if (T.scenery === 'city') {
        // Night-time blocks with lit windows, neon strips, glowing signs facing the road, and streetlights
        const winTex = tex(64, 128, (g, w, h) => {
            g.fillStyle = '#10101c'; g.fillRect(0, 0, w, h);
            for (let y = 6; y < h - 6; y += 12) for (let x = 5; x < w - 5; x += 11) {
                const on = Math.random() < 0.45;
                g.fillStyle = on ? ['#ffd98a', '#8ae6ff', '#ffb0e0'][Math.floor(Math.random() * 3)] : '#1c1c2c';
                g.fillRect(x, y, 6, 7);
            }
        });
        const buildMat = mat({ color: 0x9aa0c0, map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.7 });
        const neonCols = [0xff2a9a, 0x22ffd0, 0x7a44ff, 0xffb020];
        const neonMats = neonCols.map(c => mat({ color: c, emissive: c, emissiveIntensity: 3 }));
        const words = ['BONK', 'NOODLES', 'OPEN 24/7', 'TURBO', 'ARCADE', 'PIZZA', 'HONK', 'MOTEL', 'KARAOKE', 'TACOS'];
        const signMats = words.map((w, i) => {
            const col = ['#ff3aa8', '#39ffd8', '#9a6bff', '#ffc040'][i % 4];
            const t = tex(256, 96, (g, W, H) => {
                g.fillStyle = '#07060c'; g.fillRect(0, 0, W, H);
                g.strokeStyle = col; g.lineWidth = 5; g.strokeRect(6, 6, W - 12, H - 12);
                g.font = '900 44px "Arial Black", Impact, sans-serif';
                g.textAlign = 'center'; g.textBaseline = 'middle';
                g.shadowColor = col; g.shadowBlur = 16;
                g.fillStyle = col; g.fillText(w, W / 2, H / 2 + 2);
                g.fillStyle = '#fff'; g.shadowBlur = 0; g.globalAlpha = 0.55; g.fillText(w, W / 2, H / 2 + 2);
            });
            const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: true });
            disposables.push(m);
            return m;
        });
        let placed = 0;
        for (let i = 0; i < 400 && placed < 46; i++) {
            const x = rand(minX - 90, maxX + 90), z = rand(minZ - 90, maxZ + 90);
            const dn = nearest(x, z);
            if (dn < edge + 9) continue;
            placed++;
            const bh = rand(10, 38), bw = rand(6, 12), bd = rand(6, 12);
            const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), buildMat);
            b.position.set(x, bh / 2, z);
            b.castShadow = true;
            b.receiveShadow = true;
            group.add(b);
            const strip2 = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.2, 0.35, bd + 0.2), neonMats[placed % 4]);
            strip2.position.set(x, bh + 0.2, z);
            group.add(strip2);
            if (dn < edge + 40) {
                // A sign on the face that looks at the road
                const k = nearestIdx(x, z);
                const ang = Math.atan2(px[k] - x, pz[k] - z);
                const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.25), signMats[placed % signMats.length]);
                const r = Math.max(bw, bd) / 2 + 0.15;
                sign.position.set(x + Math.sin(ang) * r, Math.min(bh - 2, rand(5, 9)), z + Math.cos(ang) * r);
                sign.rotation.y = ang;
                group.add(sign);
            }
        }
        // Streetlights along both sides of the road
        const spots = [];
        for (let i = 0; i < N; i += Math.round(26 / step)) for (const s of [1, -1]) spots.push([i, s]);
        const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6);
        poleGeo.translate(0, 3.25, 0);
        const poles = new THREE.InstancedMesh(poleGeo, mat({ color: 0x2a2a38, roughness: 0.5, metalness: 0.5 }), spots.length);
        const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.18, 0.5), mat({ color: 0xffffff, emissive: 0xbfe6ff, emissiveIntensity: 3.2 }), spots.length);
        const dm = new THREE.Object3D();
        spots.forEach(([i, s], n) => {
            const lat = s * (edge + 1.2);
            dm.position.set(px[i] + nx[i] * lat, py[i], pz[i] + nz[i] * lat);
            dm.rotation.set(0, 0, 0);
            dm.scale.set(1, 1, 1);
            dm.updateMatrix();
            poles.setMatrixAt(n, dm.matrix);
            dm.position.set(px[i] + nx[i] * (lat - s * 0.8), py[i] + 6.5, pz[i] + nz[i] * (lat - s * 0.8));
            dm.rotation.y = -heading[i] + Math.PI / 2;
            dm.updateMatrix();
            heads.setMatrixAt(n, dm.matrix);
        });
        poles.castShadow = true;
        group.add(poles, heads);
    } else if (T.scenery === 'rocks') {
        const rockMat = mat({ color: 0x886644, roughness: 1, flatShading: true });
        for (let i = 0; i < 30; i++) {
            const x = rand(minX - 80, maxX + 80), z = rand(minZ - 80, maxZ + 80);
            if (nearest(x, z) < edge + 6) continue;
            const rh = rand(3, 12), rw = rand(2, 6);
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rw, 0), rockMat);
            rock.position.set(x, rh / 2 - 1, z);
            rock.scale.set(1, rh / rw, 1);
            rock.rotation.set(rand(0, 0.3), rand(0, Math.PI), rand(0, 0.3));
            rock.castShadow = true;
            group.add(rock);
        }
    } else if (T.scenery === 'volcano') {
        // Big volcano with a glowing crater, lava pools and cracks beside the road
        const volMat = mat({ color: 0x3a2010, roughness: 1, flatShading: true });
        const volcano = new THREE.Mesh(new THREE.ConeGeometry(120, 180, 12), volMat);
        volcano.position.set(cx + 420, 80, cz - 380);
        group.add(volcano);
        const lavaTex = tex(128, 128, (g, w, h) => {
            g.fillStyle = '#ff5a10'; g.fillRect(0, 0, w, h);
            for (let i = 0; i < 40; i++) {
                g.fillStyle = Math.random() < 0.5 ? '#ffb030' : '#c02000';
                g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 12, 0, Math.PI * 2); g.fill();
            }
        });
        const lavaMat = mat({ color: 0xff5a10, map: lavaTex, emissive: 0xff4400, emissiveMap: lavaTex, emissiveIntensity: 2.4, roughness: 0.6 });
        glowMats.push({ m: lavaMat, base: 2.4, amp: 0.7, f: 1.3, tex: lavaTex });
        const crater = new THREE.Mesh(new THREE.CircleGeometry(25, 16), lavaMat);
        crater.rotation.x = -Math.PI / 2;
        crater.position.set(cx + 420, 170, cz - 380);
        group.add(crater);
        let pools = 0;
        for (let i = 0; i < 300 && pools < 22; i++) {
            const x = rand(minX - 60, maxX + 60), z = rand(minZ - 60, maxZ + 60);
            const d = nearest(x, z);
            if (d < edge + 6 || d > edge + 70) continue;
            pools++;
            const pr = rand(5, 13);
            const pool = new THREE.Mesh(new THREE.CircleGeometry(pr, 18), lavaMat);
            pool.rotation.x = -Math.PI / 2;
            pool.scale.set(1, rand(0.5, 1), 1);
            pool.rotation.z = rand(0, Math.PI);
            pool.position.set(x, 0.05, z);
            group.add(pool);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(pr, 0.9, 5, 18), volMat);
            rim.rotation.x = -Math.PI / 2;
            rim.scale.copy(pool.scale);
            rim.rotation.z = pool.rotation.z;
            rim.position.set(x, 0.1, z);
            group.add(rim);
        }
    } else if (T.scenery === 'aqua') {
        const waterMat = mat({ color: 0x2288dd, emissive: 0x1166aa, emissiveIntensity: 0.2, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, envMapIntensity: 1 });
        const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), waterMat);
        waterPlane.rotation.x = -Math.PI / 2;
        waterPlane.position.y = -0.5;
        group.add(waterPlane);
    } else if (T.scenery === 'ice') {
        const iceMat = mat({ color: 0xc8e8ff, roughness: 0.15, metalness: 0.1, envMapIntensity: 0.8, flatShading: true, transparent: true, opacity: 0.85 });
        for (let i = 0; i < 20; i++) {
            const x = rand(minX - 100, maxX + 100), z = rand(minZ - 100, maxZ + 100);
            if (nearest(x, z) < edge + 8) continue;
            const ih = rand(5, 20), iw = rand(3, 8);
            const ice = new THREE.Mesh(new THREE.DodecahedronGeometry(iw, 0), iceMat);
            ice.position.set(x, ih / 3, z);
            ice.scale.set(1, ih / iw, 1);
            ice.rotation.y = rand(0, Math.PI);
            group.add(ice);
        }
    }

    // ---------- Fog ----------
    const fog = new THREE.FogExp2(new THREE.Color(T.fog), T.fogDensity || 0.0018);

    // For the minimap: which samples are up on a bridge
    const upper = new Uint8Array(N);
    for (let i = 0; i < N; i++) upper[i] = open[i];

    let clock = 0;
    return {
        group, course, total, step, N, px, pz, py, tx, tz, nx, nz, heading, cum, pads, itemSpots, upper,
        laps: course.laps, halfWidth: HW, runoff: RUNOFF, edge,
        hazardZones, fog, theme: T,
        project, pointAhead, curvatureAhead, gridPos, heightAt,
        update(dt) {
            clock += dt;
            chevTex.offset.x -= dt * 1.4;
            for (const m of hazardMeshes) if (m.userData.hoop) m.rotation.z = Math.sin(clock * 2) * 0.08;
            for (const g of glowMats) {
                g.m.emissiveIntensity = g.base + Math.sin(clock * g.f) * g.amp;
                if (g.tex) { g.tex.offset.x = clock * 0.02; g.tex.offset.y = Math.sin(clock * 0.3) * 0.05; }
            }
        },
        dispose() {
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            for (const d of disposables) d.dispose();
        },
    };
}
