// Courses: a closed spline turned into a road, curbs, run-off, barriers and scenery.
// Also provides the math the game needs: where am I along the track, and how far off-line.
import * as THREE from 'three';

const HW = 8;        // half the road width
const RUNOFF = 5;    // sand between the curb and the barrier
const N = 1400;      // samples along the centre line
const TREE_MAX = 320;

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
        desc: 'Night streets, tight 90 degree corners and nowhere to hide.',
        laps: 3,
        available: false,
        points: [[0, 0], [140, 0], [140, -120], [40, -120], [40, -200], [-120, -200], [-120, -40], [-40, -40], [-40, 60], [-140, 60], [-140, 140], [0, 140]],
    },
    {
        id: 'canyon',
        name: 'Dust Canyon',
        desc: 'Fast, sweeping bends through the desert.',
        laps: 3,
        available: false,
        points: [[0, 0], [160, -40], [220, -160], [120, -240], [-40, -200], [-180, -240], [-240, -100], [-160, 40], [-60, 20], [-100, 120], [60, 140]],
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
    // ---------- Centre line samples ----------
    const pts = makeCurve(course).getSpacedPoints(N);
    const px = new Float32Array(N), pz = new Float32Array(N);
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

    // ---------- Queries ----------
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
        return { i, lat: rx * nx[i] + rz * nz[i], dist, nx: nx[i], nz: nz[i], tx: tx[i], tz: tz[i] };
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

    const grassTex = tex(256, 256, (g, w, h) => { g.fillStyle = '#5ea94f'; g.fillRect(0, 0, w, h); speckle(g, w, h, 4000, ['#6cb85a', '#4f9444', '#74c062', '#58a04b']); });
    grassTex.repeat.set(260, 260);
    const roadTex = tex(256, 256, (g, w, h) => {
        g.fillStyle = '#3a3e45'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 5000, ['#43474f', '#33363c', '#4a4e56']);
        g.fillStyle = '#f4f4f4';
        g.fillRect(10, 0, 6, h); g.fillRect(w - 16, 0, 6, h);
        g.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const sandTex = tex(128, 128, (g, w, h) => { g.fillStyle = '#e2c48e'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1500, ['#d6b67c', '#ecd3a4', '#cfae72']); });
    const curbTex = tex(16, 64, (g, w, h) => { g.fillStyle = '#e0473f'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#f5f5f5'; g.fillRect(0, h / 2, w, h / 2); });
    const wallTex = tex(32, 64, (g, w, h) => {
        g.fillStyle = '#2f63d8'; g.fillRect(0, 0, w, h / 2);
        g.fillStyle = '#f3f5f8'; g.fillRect(0, h / 2, w, h / 2);
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
            if (wallHeight) pos.set([px[k] + nx[k] * a, 0, pz[k] + nz[k] * a, px[k] + nx[k] * a, wallHeight, pz[k] + nz[k] * a], i * 6);
            else pos.set([px[k] + nx[k] * a, y, pz[k] + nz[k] * a, px[k] + nx[k] * b, y, pz[k] + nz[k] * b], i * 6);
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
            leaves.setColorAt(count, col.setHSL(rand(0.25, 0.36), rand(0.4, 0.6), rand(0.26, 0.38)));
            count++;
        }
        trunks.count = leaves.count = count;
    }
    trunks.castShadow = leaves.castShadow = true;
    group.add(trunks, leaves);

    // Distant low-poly hills for the horizon
    const hillMat = mat({ color: 0x6f9a6a, roughness: 1, flatShading: true });
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(560, 760), hgt = rand(60, 170);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(rand(120, 220), hgt, 7), hillMat);
        cone.position.set(cx + Math.cos(a) * r, hgt / 2 - 5, cz + Math.sin(a) * r);
        group.add(cone);
    }

    return {
        group, course, total, step, N, px, pz, tx, tz, heading, pads,
        laps: course.laps, halfWidth: HW, runoff: RUNOFF,
        project, pointAhead, curvatureAhead, gridPos,
        update(dt) { chevTex.offset.x -= dt * 1.4; },
        dispose() {
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            for (const d of disposables) d.dispose();
        },
    };
}
