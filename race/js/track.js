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
    },
    {
        id: 'city',
        name: 'Neon City',
        desc: 'Night streets, tight 90-degree corners and nowhere to hide.',
        laps: 3,
        available: true,
        points: [[0, 0], [140, 0], [140, -120], [40, -120], [40, -200], [-120, -200], [-120, -40], [-40, -40], [-40, 60], [-140, 60], [-140, 140], [0, 140]],
        pads: [[0.15, 0], [0.5, -3], [0.82, 3]],
        theme: {
            ground: '#2a2a35', groundSpeckle: ['#33333f', '#222230', '#3a3a48'],
            road: '#1e1e28', roadSpeckle: ['#252530', '#1a1a24', '#2e2e3a'],
            sand: '#3a3542', sandSpeckle: ['#44404e', '#332f3c', '#4a4558'],
            curb: ['#ff2266', '#222233'], wall: ['#6622cc', '#1a1a2e'],
            fog: '#1a1028', sky: '#0d0818',
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
        theme: {
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
            [0, 0], [100, -20], [180, -80], [200, -170], [150, -230], [60, -250],
            [-40, -220], [-110, -160], [-80, -80], [-140, -30], [-200, -80],
            [-220, -170], [-160, -230], [-100, -280], [0, -300], [80, -280],
            [140, -310], [120, -360], [40, -370], [-40, -340], [-100, -360],
            [-140, -320], [-120, -260], [-60, -200], [20, -160], [60, -100],
            [40, -40], [-20, 20],
        ],
        pads: [[0.05, 0], [0.3, -3], [0.6, 2], [0.85, 0]],
        theme: {
            ground: '#3a2a1a', groundSpeckle: ['#4a3828', '#2e2016', '#543e2c'],
            road: '#2e2222', roadSpeckle: ['#3a2a2a', '#241a1a', '#443333'],
            sand: '#5a3a20', sandSpeckle: ['#6a4830', '#4e3018', '#7a5838'],
            curb: ['#ff4400', '#331100'], wall: ['#882200', '#441100'],
            fog: '#4a2010', sky: '#2a1008',
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
        theme: {
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
        theme: {
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

export function buildTrack(course) {
    const T = { ...THEME_DEFAULT, ...(course.theme || {}) };

    // ---------- Centre line samples ----------
    const pts = makeCurve(course).getSpacedPoints(N);
    const px = new Float32Array(N), pz = new Float32Array(N), py = new Float32Array(N);
    const tx = new Float32Array(N), tz = new Float32Array(N);
    const nx = new Float32Array(N), nz = new Float32Array(N);
    const heading = new Float32Array(N), cum = new Float32Array(N);
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

    // ---------- Hazards: write height data for ramps ----------
    const hazardZones = [];
    for (const h of (course.hazards || [])) {
        const center = Math.floor(h.pos * N) % N;
        if (h.type === 'ramp') {
            const halfW = Math.round((h.width || 10) / step / 2);
            for (let o = -halfW; o <= halfW; o++) {
                const k = (center + o + N) % N;
                const t = 1 - Math.abs(o) / halfW;
                py[k] = Math.max(py[k], (h.height || 3) * Math.sin(t * Math.PI));
            }
        }
        hazardZones.push({ ...h, idx: center, dist: cum[center] });
    }

    // ---------- Queries ----------
    function heightAt(idx) { return py[(idx + N) % N]; }
    function project(x, z, hint) {
        let best = 0, bd = Infinity;
        if (hint == null || hint < 0) {
            for (let i = 0; i < N; i += 4) {
                const d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
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
        let dist = cum[i] + rx * tx[i] + rz * tz[i];
        if (dist < 0) dist += total;
        if (dist >= total) dist -= total;
        return { i, lat: rx * nx[i] + rz * nz[i], dist, nx: nx[i], nz: nz[i], tx: tx[i], tz: tz[i], y: py[i] };
    }
    function pointAhead(i, dist, lat) {
        const j = (i + Math.round(dist / step)) % N;
        return { x: px[j] + nx[j] * lat, z: pz[j] + nz[j] * lat };
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
    const mat = opts => { const m = new THREE.MeshStandardMaterial(opts); disposables.push(m); return m; };
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

    // A strip following the track between two lateral offsets (a > b), or a vertical wall at offset a
    function ribbon(a, b, y, vLen, material, wallHeight = 0) {
        const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
        for (let i = 0; i <= N; i++) {
            const k = i % N, v = (i === N ? total : cum[k]) / vLen;
            const hy = py[k];
            if (wallHeight) pos.set([px[k] + nx[k] * a, hy, pz[k] + nz[k] * a, px[k] + nx[k] * a, hy + wallHeight, pz[k] + nz[k] * a], i * 6);
            else pos.set([px[k] + nx[k] * a, y + hy, pz[k] + nz[k] * a, px[k] + nx[k] * b, y + hy, pz[k] + nz[k] * b], i * 6);
            uv.set([0, v, 1, v], i * 4);
            if (i < N) { const s = i * 2; idx.push(s, s + 2, s + 1, s + 1, s + 2, s + 3); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, material);
        m.receiveShadow = true;
        group.add(m);
        return m;
    }

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat({ map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    group.add(ground);

    const edge = HW + RUNOFF + 0.3;
    const sandMat = mat({ map: sandTex, roughness: 1 });
    ribbon(edge, HW + 1.2, 0.006, 6, sandMat);
    ribbon(-HW - 1.2, -edge, 0.006, 6, sandMat);
    ribbon(HW, -HW, 0.012, 16, mat({ map: roadTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const curbMat = mat({ map: curbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ribbon(HW + 1.2, HW, 0.02, 2.4, curbMat);
    ribbon(-HW, -HW - 1.2, 0.02, 2.4, curbMat);
    const wallMat = mat({ map: wallTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [1, -1]) ribbon(s * edge, 0, 0, 4, wallMat, 1.0).castShadow = true;

    // Start line and arch
    const h0 = heading[0];
    const lineGeo = new THREE.PlaneGeometry(2.2, HW * 2);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, mat({ map: checkTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    line.position.set(px[0], 0.025, pz[0]);
    line.rotation.y = -h0;
    group.add(line);

    const arch = new THREE.Group();
    arch.position.set(px[0], 0, pz[0]);
    arch.rotation.y = -h0;
    const span = edge + 0.8;
    const pillarMat = mat({ color: 0x23302b, roughness: 0.6 });
    const bannerMat = mat({ map: bannerTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.25 });
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
    const padMat = mat({ map: chevTex, emissive: 0x2ec495, emissiveMap: chevTex, emissiveIntensity: 0.7, transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pads = (course.pads || []).map(([f, lat]) => {
        const j = Math.floor(f * N) % N;
        const g = new THREE.PlaneGeometry(5, 4.2);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, padMat);
        m.position.set(px[j] + nx[j] * lat, 0.03, pz[j] + nz[j] * lat);
        m.rotation.y = -heading[j];
        group.add(m);
        return { dist: cum[j], lat };
    });

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
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
    trunkGeo.translate(0, 1, 0);
    const leafGeo = new THREE.ConeGeometry(1.8, 4.6, 7);
    leafGeo.translate(0, 4.2, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat({ color: 0x7a5234, roughness: 1 }), TREE_MAX);
    const leaves = new THREE.InstancedMesh(leafGeo, mat({ color: 0xffffff, roughness: 0.9, flatShading: true }), TREE_MAX);
    {
        const dummy = new THREE.Object3D(), col = new THREE.Color();
        let count = 0;
        for (let tries = 0; tries < 3000 && count < TREE_MAX; tries++) {
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
    for (const hz of hazardZones) {
        const j = hz.idx;
        const hx = px[j] + nx[j] * (hz.lat || 0);
        const hz2 = pz[j] + nz[j] * (hz.lat || 0);
        const hy = py[j];
        if (hz.type === 'fire') {
            // Glowing red/orange circle on ground
            const r = hz.radius || 3;
            const fg = new THREE.CircleGeometry(r, 16);
            fg.rotateX(-Math.PI / 2);
            const fm = new THREE.Mesh(fg, mat({
                color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.6,
                transparent: true, opacity: 0.7, roughness: 0.3,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
            }));
            fm.position.set(hx, hy + 0.04, hz2);
            group.add(fm);
            hazardMeshes.push(fm);
        } else if (hz.type === 'water') {
            const r = hz.radius || 4;
            const wg = new THREE.CircleGeometry(r, 16);
            wg.rotateX(-Math.PI / 2);
            const wm = new THREE.Mesh(wg, mat({
                color: 0x2288dd, emissive: 0x1166aa, emissiveIntensity: 0.3,
                transparent: true, opacity: 0.6, roughness: 0.2,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
            }));
            wm.position.set(hx, hy + 0.03, hz2);
            group.add(wm);
            hazardMeshes.push(wm);
        } else if (hz.type === 'hoop') {
            const hoopG = new THREE.TorusGeometry(4, 0.35, 8, 24);
            const hoopM = new THREE.Mesh(hoopG, mat({
                color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: 0.5, roughness: 0.3,
            }));
            hoopM.position.set(hx, hy + 4, hz2);
            hoopM.rotation.y = -heading[j] + Math.PI / 2;
            group.add(hoopM);
            hazardMeshes.push(hoopM);
        }
    }

    // ---------- Theme-specific scenery ----------
    if (T.scenery === 'city') {
        // Neon buildings scattered around
        const buildMat = mat({ color: 0x222244, roughness: 0.6 });
        const neonMats = [mat({ color: 0xff22aa, emissive: 0xff22aa, emissiveIntensity: 0.4 }), mat({ color: 0x22ffcc, emissive: 0x22ffcc, emissiveIntensity: 0.4 }), mat({ color: 0x6622ff, emissive: 0x6622ff, emissiveIntensity: 0.4 })];
        for (let i = 0; i < 40; i++) {
            const x = rand(minX - 100, maxX + 100), z = rand(minZ - 100, maxZ + 100);
            if (nearest(x, z) < edge + 8) continue;
            const bh = rand(8, 35), bw = rand(4, 10), bd = rand(4, 10);
            const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), buildMat);
            b.position.set(x, bh / 2, z);
            b.castShadow = true;
            group.add(b);
            // Neon strip
            const strip = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.2, 0.5, bd + 0.2), neonMats[i % 3]);
            strip.position.set(x, bh * rand(0.3, 0.8), z);
            group.add(strip);
        }
    } else if (T.scenery === 'rocks') {
        // Rock formations for canyon
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
        // Big central volcano + lava pools
        const volMat = mat({ color: 0x3a2010, roughness: 1, flatShading: true });
        const volcano = new THREE.Mesh(new THREE.ConeGeometry(120, 180, 12), volMat);
        volcano.position.set(cx, 80, cz);
        group.add(volcano);
        const lavaMat = mat({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 });
        const crater = new THREE.Mesh(new THREE.CircleGeometry(25, 12), lavaMat);
        crater.rotation.x = -Math.PI / 2;
        crater.position.set(cx, 170, cz);
        group.add(crater);
    } else if (T.scenery === 'aqua') {
        // Big water plane in the center, floating platforms
        const waterMat = mat({ color: 0x2288dd, emissive: 0x1166aa, emissiveIntensity: 0.2, transparent: true, opacity: 0.5 });
        const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), waterMat);
        waterPlane.rotation.x = -Math.PI / 2;
        waterPlane.position.y = -0.5;
        group.add(waterPlane);
    } else if (T.scenery === 'ice') {
        // Icebergs scattered around
        const iceMat = mat({ color: 0xc8e8ff, roughness: 0.2, flatShading: true, transparent: true, opacity: 0.8 });
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
    const fog = new THREE.FogExp2(new THREE.Color(T.fog), 0.0018);

    return {
        group, course, total, step, N, px, pz, py, tx, tz, heading, pads,
        laps: course.laps, halfWidth: HW, runoff: RUNOFF,
        hazardZones, fog, theme: T,
        project, pointAhead, curvatureAhead, gridPos, heightAt,
        update(dt) {
            chevTex.offset.x -= dt * 1.4;
            // Animate hoops (gentle bob)
            for (const m of hazardMeshes) {
                if (m.geometry.type === 'TorusGeometry') {
                    m.rotation.z = Math.sin(performance.now() * 0.002) * 0.08;
                }
            }
        },
        dispose() {
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            for (const d of disposables) d.dispose();
        },
    };
}
