// Vehicle models: bodies shaped from side profiles, riders posed with simple two-bone IK,
// customization (paint, patterns, hats) and every per-frame animation (suspension, pitch and
// roll, steering, drift pose, attacks, nitro flames, shields).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ATK_TIME = 0.45; // seconds an attack animation lasts

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

let quality = 'high';
export function setModelQuality(q) { quality = q; }

// ============================================================
// Textures and shared materials
// ============================================================
function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}

// Tyre textures wrap once around the tyre (u) and across it (v): sidewall, tread band, sidewall
const TREAD = canvasTexture(256, 64, (g, w) => {
    g.fillStyle = '#26282d'; g.fillRect(0, 0, w, 64);
    g.fillStyle = '#34373e'; g.fillRect(0, 17, w, 30);
    g.strokeStyle = '#0d0e11'; g.lineWidth = 3;
    for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 17); g.lineTo(x + 5, 32); g.lineTo(x, 47); g.stroke(); }
    g.fillStyle = '#3a3d44'; g.fillRect(0, 7, w, 2); g.fillRect(0, 55, w, 2);
});
const KNOBBY = canvasTexture(256, 64, (g, w) => {
    g.fillStyle = '#26282d'; g.fillRect(0, 0, w, 64);
    g.fillStyle = '#101114'; g.fillRect(0, 15, w, 34);
    g.fillStyle = '#3c3f46';
    for (let x = 0; x < w; x += 16) { g.fillRect(x + 1, 17, 9, 12); g.fillRect(x + 8, 34, 9, 12); }
    g.fillStyle = '#3a3d44'; g.fillRect(0, 7, w, 2); g.fillRect(0, 55, w, 2);
});
// Soft fade from the base of a flame (opaque) to its tip (clear)
const FLAME_ALPHA = canvasTexture(8, 64, (g) => {
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#bbb'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 8, 64);
});
FLAME_ALPHA.colorSpace = THREE.NoColorSpace;

const std = o => new THREE.MeshStandardMaterial(o);
const MAT = {
    tire: std({ color: 0xffffff, map: TREAD, bumpMap: TREAD, bumpScale: 2, roughness: 0.92, envMapIntensity: 0.25 }),
    knobby: std({ color: 0xffffff, map: KNOBBY, bumpMap: KNOBBY, bumpScale: 3, roughness: 0.95, envMapIntensity: 0.25 }),
    rim: std({ color: 0xc8cdd4, roughness: 0.25, metalness: 0.9, envMapIntensity: 0.7 }),
    rimDark: std({ color: 0x33373f, roughness: 0.4, metalness: 0.6, envMapIntensity: 0.6 }),
    chrome: std({ color: 0xd8dde3, roughness: 0.12, metalness: 1, envMapIntensity: 0.75 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x16222e, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.62, envMapIntensity: 0.7, clearcoat: 0.4 }),
    dark: std({ color: 0x23262d, roughness: 0.62, envMapIntensity: 0.4 }),
    trim: std({ color: 0x131519, roughness: 0.4, metalness: 0.2, envMapIntensity: 0.6 }),
    rubber: std({ color: 0x1a1b1f, roughness: 0.85, envMapIntensity: 0.3 }),
    seat: std({ color: 0x2c2420, roughness: 0.75, envMapIntensity: 0.3 }),
    alu: std({ color: 0xa9b0ba, roughness: 0.35, metalness: 0.8 }),
    cream: std({ color: 0xf4efe6, roughness: 0.55 }),
    white: std({ color: 0xf2f4f6, roughness: 0.5 }),
    skin: std({ color: 0xf1c27d, roughness: 0.7, envMapIntensity: 0.4 }),
    jeans: std({ color: 0x33415c, roughness: 0.85, envMapIntensity: 0.3 }),
    boot: std({ color: 0x2a211c, roughness: 0.7, envMapIntensity: 0.3 }),
    visor: std({ color: 0x0c1118, roughness: 0.12, metalness: 0.6, envMapIntensity: 0.8 }),
    head: std({ color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: 2.6 }),
    amber: std({ color: 0xffb040, emissive: 0xff9a20, emissiveIntensity: 2.2 }),
    tail: std({ color: 0xff3030, emissive: 0xff1a1a, emissiveIntensity: 1.6 }),
    bread: std({ color: 0xd9a35b, roughness: 0.8 }),
    crust: std({ color: 0x9c6a2e, roughness: 0.8 }),
    chicken: std({ color: 0xffd23f, roughness: 0.5 }),
    comb: std({ color: 0xe0303a, roughness: 0.5 }),
    beak: std({ color: 0xff8a1c, roughness: 0.5 }),
    star: std({ color: 0xffe066, emissive: 0xffc400, emissiveIntensity: 2 }),
    spark: std({ color: 0xbfe8ff, emissive: 0x7fd0ff, emissiveIntensity: 3 }),
};
export { MAT as MODEL_MATS };

function makePaint(color) {
    const m = quality === 'low'
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.12, envMapIntensity: 0.45 })
        : new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.08, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 0.45 });
    return m;
}

// ============================================================
// Geometry helpers
// ============================================================
const geoCache = new Map();
const cached = (key, fn) => {
    let g = geoCache.get(key);
    if (!g) { g = fn(); geoCache.set(key, g); }
    return g;
};

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
}
const rbox = (w, h, d, r = 0.05, seg = 2) => cached(`rb${w}|${h}|${d}|${r}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const box = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphere = (r, ws = 14, hs = 10) => cached(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (rt, rb, h, seg = 12) => cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));

// A side profile: points run from the rear bottom corner, over the top, to the front bottom
// corner. [x, y] is a straight line, [x, y, cx, cy] a curve through control point (cx, cy).
// The underside runs back along the sill with the wheel arches cut out of it.
function profileShape(pts, sill = null, arches = []) {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.length === 4) s.quadraticCurveTo(p[2], p[3], p[0], p[1]);
        else s.lineTo(p[0], p[1]);
    }
    if (sill != null) {
        for (const a of [...arches].sort((p, q) => q.x - p.x)) {
            const half = (a.len || 0) / 2, x1 = a.x + half, x0 = a.x - half, cy = a.y;
            const t0 = cy < sill ? Math.asin(clamp((sill - cy) / a.r, 0, 1)) : 0;
            if (cy >= sill) { s.lineTo(x1 + a.r, sill); s.lineTo(x1 + a.r, cy); }
            else s.lineTo(x1 + a.r * Math.cos(t0), sill);
            s.absarc(x1, cy, a.r, t0, Math.PI / 2, false);
            s.absarc(x0, cy, a.r, Math.PI / 2, Math.PI - t0, false);
            if (cy >= sill) s.lineTo(x0 - a.r, sill);
        }
    }
    s.closePath();
    return s;
}
function polyShape(pts) { return profileShape(pts); }

// Extrude a profile across the vehicle; the bevel rounds the edges without growing the outline
function extrude(shape, width, bevel = 0.06, curveSegments = 8) {
    const depth = Math.max(0.002, width - bevel * 2);
    const g = new THREE.ExtrudeGeometry(shape, {
        depth, curveSegments, steps: 1,
        bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
    });
    g.translate(0, 0, -depth / 2);
    return g;
}
// Extrude a top-view outline upwards (x forward, second coordinate across the vehicle)
function extrudeUp(shape, height, bevel = 0.05) {
    const g = extrude(shape, height, bevel);
    g.translate(0, 0, height / 2);
    g.rotateX(-Math.PI / 2);
    return g;
}
function roundedRectShape(x0, y0, x1, y1, r) {
    const s = new THREE.Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
}

// A tube (frame rail, exhaust, roll cage) through a list of points
function tube(points, r, seg = 20, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V3(...p)), false, 'catmullrom', 0.2);
    return new THREE.TubeGeometry(curve, seg, r, radial, false);
}

// A capsule from a to b (limbs, struts)
function segment(parent, a, b, r, mat) {
    const d = b.clone().sub(a), len = d.length();
    const geo = cached(`cap${r}|${len.toFixed(2)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.01, len), 3, 8));
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    parent.add(m);
    return m;
}
// Two-bone limb from a to c, bending towards bendDir
function limb(parent, a, c, l1, l2, bendDir, r, mat1, mat2) {
    const d = c.clone().sub(a);
    const L = clamp(d.length(), 0.05, l1 + l2 - 0.002);
    const dn = d.clone().normalize();
    const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const perp = bendDir.clone().sub(dn.clone().multiplyScalar(bendDir.dot(dn))).normalize();
    const mid = a.clone().add(dn.clone().multiplyScalar(x)).add(perp.multiplyScalar(h));
    const end = a.clone().add(dn.clone().multiplyScalar(Math.min(d.length(), l1 + l2)));
    segment(parent, a, mid, r, mat1);
    segment(parent, mid, end, r * 0.88, mat2 || mat1);
    return end;
}

// Merge the plain meshes directly inside a group into one mesh per material (fewer draw calls)
function mergeGroup(group) {
    const byMat = new Map();
    for (const c of [...group.children]) {
        if (!c.isMesh || c.children.length || c.userData.keep) continue;
        c.updateMatrix();
        let g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.morphAttributes = {};
        g.applyMatrix4(c.matrix);
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(g);
        group.remove(c);
    }
    for (const [mat, geos] of byMat) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        group.add(new THREE.Mesh(merged, mat));
    }
}

// ============================================================
// Wheels
// ============================================================
// Tyre: a lathed cross-section, so it has rounded shoulders and a tread band
function tyreGeo(R, W, ri) {
    return cached(`tyre${R}|${W}|${ri}`, () => {
        const hw = W / 2, c = Math.min(0.07, W * 0.28);
        const pts = [
            [ri, hw * 0.92], [R - c * 1.3, hw], [R - c * 0.3, hw - c * 0.35], [R, hw - c],
            [R, -hw + c], [R - c * 0.3, -hw + c * 0.35], [R - c * 1.3, -hw], [ri, -hw * 0.92],
        ].map(p => new THREE.Vector2(p[0], p[1]));
        const g = new THREE.LatheGeometry(pts, 28);
        g.rotateX(Math.PI / 2);
        return g;
    });
}
// Rim: a dished disc with spokes and a hub cap on the outside face (+z)
function rimGeo(r, W, spokes) {
    return cached(`rim${r}|${W}|${spokes}`, () => {
        const parts = [];
        const add = (g, m) => { const n = g.index ? g.toNonIndexed() : g; n.applyMatrix4(m); parts.push(n); };
        const face = W * 0.32;
        add(new THREE.TorusGeometry(r * 0.94, r * 0.07, 6, 24), new THREE.Matrix4().makeTranslation(0, 0, face));
        for (let i = 0; i < spokes; i++) {
            const a = (i / spokes) * Math.PI * 2;
            const m = new THREE.Matrix4().makeRotationZ(a).premultiply(new THREE.Matrix4().makeTranslation(0, 0, face - 0.01));
            m.multiply(new THREE.Matrix4().makeTranslation(r * 0.47, 0, 0));
            add(new THREE.BoxGeometry(r * 0.9, r * 0.2, 0.05), m);
        }
        add(new THREE.CylinderGeometry(r * 0.22, r * 0.26, 0.06, 12), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, 0, face + 0.01)));
        return mergeGeometries(parts.map(p => { for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k); return p; }));
    });
}
const rimBackGeo = (r, W) => cached(`rimb${r}|${W}`, () => { const g = new THREE.CylinderGeometry(r, r, W * 0.6, 20); g.rotateX(Math.PI / 2); return g; });
// Spoked bike wheel: thin rim, lots of spokes, a hub
function spokeGeo(r) {
    return cached(`spoke${r}`, () => {
        const parts = [new THREE.TorusGeometry(r, 0.025, 6, 28).toNonIndexed()];
        for (let i = 0; i < 12; i++) {
            const g = new THREE.CylinderGeometry(0.007, 0.007, r, 4).toNonIndexed();
            g.translate(0, r / 2, 0);
            g.applyMatrix4(new THREE.Matrix4().makeRotationZ((i / 12) * Math.PI * 2));
            g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, (i % 2 ? 1 : -1) * 0.02));
            parts.push(g);
        }
        const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10).toNonIndexed();
        hub.rotateX(Math.PI / 2);
        parts.push(hub);
        return mergeGeometries(parts);
    });
}

// style: 'car' (alloy), 'dark' (steel), 'knobby' (off-road alloy), 'bike', 'bikeKnobby'
function addWheel(m, parent, x, y, z, R, W, style, front, spokes = 5) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    const bike = style.startsWith('bike');
    const ri = R * (bike ? 0.84 : 0.64);
    spin.add(new THREE.Mesh(tyreGeo(R, W, ri), style.includes('nobby') ? MAT.knobby : MAT.tire));
    if (bike) {
        spin.add(new THREE.Mesh(spokeGeo(ri * 0.98), MAT.chrome));
    } else {
        spin.add(new THREE.Mesh(rimBackGeo(ri, W), MAT.rimDark));
        const rim = new THREE.Mesh(rimGeo(ri, W, spokes), style === 'dark' ? MAT.rimDark : MAT.rim);
        if (z < 0) rim.scale.z = -1;
        spin.add(rim);
    }
    pivot.add(spin);
    parent.add(pivot);
    m.wheels.push({ pivot, spin, R, x, z, baseY: y, front });
    if (front) m.front.push(pivot);
    return pivot;
}

// ============================================================
// Common vehicle parts
// ============================================================
// Glass piece the shape of a polygon, extruded across the vehicle (shows as side windows)
function sideGlass(parent, pts, width) {
    return part(parent, extrude(polyShape(pts), width, 0.015), MAT.glass);
}
// A flat pane along a sloped edge from (x0,y0) to (x1,y1), sitting just proud of the body
function slopePane(parent, x0, y0, x1, y1, width, mat = MAT.glass, lift = 0.02, thick = 0.03) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const m = part(parent, rbox(len, thick, width, 0.012), mat, (x0 + x1) / 2 + nx * lift, (y0 + y1) / 2 + ny * lift, 0);
    m.rotation.z = Math.atan2(dy, dx);
    return m;
}
function addDoor(m, side, hingeX, frontX, backX, y0, y1, halfW, mat) {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, (y0 + y1) / 2, side * (halfW + 0.012));
    const h = y1 - y0, L = frontX - backX;
    const g = cached(`door${L}|${h}`, () => {
        const g2 = extrude(roundedRectShape(-L, -h / 2, 0, h / 2, Math.min(0.12, h * 0.3)), 0.05, 0.015);
        g2.translate(hingeX - frontX, 0, 0);
        return g2;
    });
    part(pivot, g, mat, 0, 0, 0);
    part(pivot, rbox(0.2, 0.04, 0.04, 0.015), MAT.chrome, hingeX - frontX - L + 0.28, h * 0.25, side * 0.035);
    m.susp.add(pivot);
    m.doors[side] = pivot;
}
function addExhaust(m, x, y, z, dir = V3(-1, 0, 0), size = 1) {
    m.exhausts.push({ pos: V3(x, y, z), dir: dir.clone().normalize(), size });
}

// A seated or riding person. Coordinates are in the vehicle's frame:
//   seat: [x, y, z] of the hips; grip: [x, y, halfSpread] hands; foot: [x, y, halfSpread] or null
function addPerson(m, paint, o) {
    const rider = new THREE.Group();
    rider.position.set(o.seat[0], o.seat[1], o.seat[2] || 0);
    m.susp.add(rider);
    const torso = new THREE.Group();
    rider.add(torso);
    const lean = o.lean ?? 0.35, tl = o.torso ?? 0.42;
    const up = V3(Math.sin(lean), Math.cos(lean), 0);
    const hip = V3(0, 0.06, 0);
    part(torso, sphere(0.15), MAT.jeans, 0, 0.04, 0).scale.set(1.1, 0.75, 1.25);
    const chest = hip.clone().add(up.clone().multiplyScalar(tl * 0.55));
    segment(torso, hip.clone().add(V3(0, 0.05, 0)), hip.clone().add(up.clone().multiplyScalar(tl)), 0.16, paint);
    const shoulder = hip.clone().add(up.clone().multiplyScalar(tl + 0.06));
    part(torso, sphere(0.1), paint, chest.x - 0.02, chest.y, 0).scale.set(1, 1, 1.9); // shoulders fill-out
    // Head: skin, helmet (paint), visor. The head group turns to look at whoever we bonk.
    const head = new THREE.Group();
    head.position.copy(shoulder).add(up.clone().multiplyScalar(0.19));
    torso.add(head);
    part(head, sphere(0.14), MAT.skin, 0.02, 0, 0);
    part(head, cached('helmet', () => new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)), paint, 0, 0.03, 0);
    part(head, rbox(0.07, 0.09, 0.26, 0.03), MAT.visor, 0.15, 0.01, 0);
    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0.2, 0);
    head.add(anchor);
    m.head = head;
    m.hatAnchor = anchor;
    m.hatScale = 0.5;
    // Arms reach from the shoulders to the grips
    if (o.grip) {
        const g = V3(o.grip[0] - o.seat[0], o.grip[1] - o.seat[1], 0);
        for (const s of [1, -1]) {
            const a = shoulder.clone().add(V3(-0.02, -0.02, s * 0.2));
            const c = V3(g.x, g.y, s * o.grip[2]);
            const end = limb(torso, a, c, 0.3, 0.3, V3(-0.3, -1, s * 0.9), 0.062, paint, paint);
            part(torso, sphere(0.06), MAT.boot, end.x, end.y, end.z);
        }
    }
    // Legs (each hip is its own group so the dirt bike can kick with it)
    if (o.foot) {
        m.legs = {};
        for (const s of [1, -1]) {
            const hipG = new THREE.Group();
            hipG.position.set(0.02, 0.04, s * 0.11);
            rider.add(hipG);
            const f = V3(o.foot[0] - o.seat[0] - 0.02, o.foot[1] - o.seat[1] - 0.04, s * (o.foot[2] - 0.11));
            const end = limb(hipG, V3(0, 0, 0), f, 0.36, 0.37, V3(1, 0.7, s * 0.25), 0.075, MAT.jeans, MAT.jeans);
            part(hipG, rbox(0.24, 0.1, 0.11, 0.04), MAT.boot, end.x + 0.06, end.y - 0.02, end.z);
            mergeGroup(hipG);
            m.legs[s] = hipG;
        }
    }
    // Weapon, held up and back until it's time to swing
    if (o.weapon) {
        const pivot = new THREE.Group();
        pivot.position.copy(shoulder).add(V3(-0.08, -0.05, 0));
        const holder = new THREE.Group();
        holder.rotation.z = 0.55;
        pivot.add(holder);
        buildWeapon(holder, o.weapon);
        torso.add(pivot);
        m.weapon = pivot;
    }
    mergeGroup(head);
    mergeGroup(torso);
    m.rider = rider;
    m.torso = torso;
    m.riderBaseY = rider.position.y;
    m.starY = Math.max(m.starY, o.seat[1] + shoulder.y + 0.75);
    return rider;
}

function buildWeapon(holder, kind) {
    if (kind === 'baguette') {
        part(holder, cached('bag', () => new THREE.CapsuleGeometry(0.085, 1.15, 4, 10)), MAT.bread, 0, 0.72, 0);
        for (let i = 0; i < 4; i++) part(holder, box(0.04, 0.03, 0.12), MAT.crust, 0.07, 0.35 + i * 0.25, 0, 0, 0.6, 0);
    } else if (kind === 'chicken') {
        part(holder, cached('chk', () => new THREE.CapsuleGeometry(0.12, 0.62, 4, 10)), MAT.chicken, 0, 0.55, 0);
        part(holder, sphere(0.13, 12, 10), MAT.chicken, 0, 1.02, 0);
        part(holder, box(0.06, 0.14, 0.04), MAT.comb, 0, 1.17, 0);
        part(holder, cyl(0, 0.05, 0.16, 8), MAT.beak, 0.14, 1.02, 0, 0, 0, -Math.PI / 2);
        for (const s of [1, -1]) part(holder, cyl(0.02, 0.02, 0.3, 6), MAT.beak, 0, 0.1, s * 0.06);
    } else if (kind === 'shovel') {
        part(holder, cyl(0.035, 0.035, 1.05, 6), MAT.seat, 0, 0.52, 0);
        part(holder, rbox(0.32, 0.26, 0.04, 0.02), MAT.chrome, 0, 1.12, 0);
    } else if (kind === 'coconut') {
        part(holder, cached('ccap', () => new THREE.CapsuleGeometry(0.06, 0.45, 4, 8)), MAT.seat, 0, 0.32, 0);
        part(holder, sphere(0.15, 12, 10), MAT.crust, 0, 0.72, 0);
    }
}

// ============================================================
// Cars
// ============================================================
const CAR = {
    bubble: {
        W: 1.74, sill: 0.3, wheels: [[0.92, 0.36], [-0.92, 0.36]], tw: 0.26, tz: 0.7,
        body: [[-1.46, 0.3], [-1.52, 0.62], [-1.36, 0.88, -1.54, 0.86], [0.55, 0.92], [1.2, 0.83, 0.95, 0.92], [1.5, 0.56, 1.5, 0.8], [1.5, 0.34], [1.42, 0.3]],
        glass: [[-1.33, 0.86], [-1.12, 1.38, -1.3, 1.26], [0.06, 1.46, -0.6, 1.52], [0.66, 0.9, 0.42, 1.22]], gw: 0.78,
        roof: [[-1.17, 1.34], [0.08, 1.43, -0.6, 1.5], [0.12, 1.5], [-0.6, 1.575, 0.12, 1.5], [-1.2, 1.41, -0.95, 1.52]], rw: 0.82,
        door: { hinge: 0.52, back: -0.52, y0: 0.36, y1: 0.86 }, driver: [-0.25, 0.62, -0.34], wheelArch: 0.47,
    },
    van: {
        W: 1.96, sill: 0.34, wheels: [[1.28, 0.4], [-1.28, 0.4]], tw: 0.28, tz: 0.8,
        body: [[-1.98, 0.36], [-2.0, 1.95], [-1.8, 2.12, -2.0, 2.12], [0.9, 2.12], [1.25, 1.97, 1.18, 2.12], [1.72, 1.22], [1.95, 1.04, 1.84, 1.08], [2.02, 0.82, 2.03, 1.0], [2.0, 0.36]],
        door: { hinge: 0.42, back: -0.9, y0: 0.42, y1: 1.72 }, driver: [1.0, 1.02, -0.45], wheelArch: 0.52,
    },
    sport: {
        W: 1.98, sill: 0.25, wheels: [[1.36, 0.35], [-1.3, 0.4]], tw: 0.32, tz: 0.8,
        body: [[-2.02, 0.3], [-2.06, 0.66], [-1.82, 0.84, -2.06, 0.84], [-1.1, 0.86], [0.75, 0.8], [1.75, 0.6, 1.3, 0.76], [2.06, 0.42, 2.04, 0.56], [2.04, 0.28], [1.95, 0.25]],
        glass: [[-1.42, 0.84], [-0.55, 1.15, -1.0, 1.1], [0.1, 1.17, -0.25, 1.22], [0.9, 0.79, 0.55, 1.06]], gw: 0.74,
        roof: [[-0.85, 1.12], [0.1, 1.15, -0.35, 1.2], [0.14, 1.2], [-0.35, 1.25, 0.14, 1.2], [-0.9, 1.17, -0.55, 1.2]], rw: 0.78,
        door: { hinge: 0.62, back: -0.62, y0: 0.32, y1: 0.8 }, driver: [-0.2, 0.36, -0.36], wheelArch: 0.47,
    },
};

function buildCar(cfg, m, paint) {
    const d = CAR[cfg.shape];
    const hw = d.W / 2;
    const arches = d.wheels.map(([x, R]) => ({ x, y: R, r: R + 0.09 }));
    const shell = new THREE.Group();
    m.susp.add(shell);
    part(shell, cached(`body-${cfg.shape}`, () => extrude(profileShape(d.body, d.sill, arches), d.W, 0.11, 10)), paint);

    if (cfg.shape === 'van') {
        // Tall boxy van: windscreen, cab side windows, back-door windows, roof rack
        slopePane(shell, 1.25, 1.97, 1.72, 1.22, d.W * 0.86);
        sideGlass(shell, [[0.5, 1.3], [1.46, 1.3], [1.2, 1.94], [0.5, 1.94]], d.W + 0.02);
        for (const s of [1, -1]) part(shell, rbox(0.03, 0.55, 0.62, 0.02), MAT.glass, -2.01, 1.55, s * 0.42);
        for (const s of [1, -1]) part(shell, box(2.6, 0.05, 0.05), MAT.trim, -0.45, 2.22, s * 0.7);
        for (let i = 0; i < 4; i++) part(shell, box(0.05, 0.05, 1.45), MAT.trim, -1.6 + i * 0.8, 2.22, 0);
        for (const s of [1, -1]) part(shell, cyl(0.03, 0.03, 0.12, 6), MAT.trim, -1.6, 2.16, s * 0.7);
        part(shell, rbox(0.12, 0.34, 1.4, 0.04), MAT.trim, 2.02, 0.62, 0);   // grille
        for (const s of [1, -1]) part(shell, rbox(0.06, 0.2, 0.34, 0.04), MAT.head, 2.02, 0.92, s * 0.68);
        for (const s of [1, -1]) part(shell, rbox(0.05, 0.42, 0.14, 0.03), m.tailMat, -2.0, 1.05, s * 0.86);
        for (const s of [1, -1]) part(shell, rbox(0.14, 0.2, 0.08, 0.03), MAT.trim, 1.62, 1.55, s * (hw + 0.1));
        part(shell, rbox(0.22, 0.22, d.W + 0.06, 0.07), MAT.rubber, 2.03, 0.4, 0);
        part(shell, rbox(0.2, 0.22, d.W + 0.06, 0.07), MAT.rubber, -2.02, 0.4, 0);
        part(shell, box(3.0, 0.06, 0.02), MAT.trim, 0.1, 1.28, hw + 0.004);
        part(shell, box(3.0, 0.06, 0.02), MAT.trim, 0.1, 1.28, -hw - 0.004);
        m.hatPos = V3(0.2, 2.12, 0);
        m.hatScale = 1.2;
        addExhaust(m, -2.0, 0.3, 0.5);
    } else {
        // Greenhouse: tinted glass with a painted roof panel and pillars
        part(shell, cached(`gh-${cfg.shape}`, () => extrude(polyShape(d.glass), d.W * d.gw, 0.08, 10)), MAT.glass);
        part(shell, cached(`roof-${cfg.shape}`, () => extrude(polyShape(d.roof), d.W * d.rw, 0.035, 10)), paint);
        const g0 = d.glass[0], g3 = d.glass[3], mid = (g0[0] + g3[0]) / 2 - 0.25;
        const pillarH = (cfg.shape === 'sport' ? 0.3 : 0.5);
        for (const s of [1, -1]) part(shell, rbox(0.16, pillarH, 0.05, 0.02), paint, mid, g0[1] + pillarH / 2, s * (d.W * d.gw / 2 + 0.01));
        const noseX = cfg.shape === 'sport' ? 1.9 : 1.46;
        const lightY = cfg.shape === 'sport' ? 0.55 : 0.68;
        for (const s of [1, -1]) {
            const hl = part(shell, cfg.shape === 'sport' ? rbox(0.3, 0.07, 0.36, 0.03) : cached('hl-round', () => { const g = new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16); g.rotateZ(Math.PI / 2); return g; }), MAT.head, noseX, lightY, s * (hw - 0.34));
            if (cfg.shape === 'sport') hl.rotation.z = -0.3;
        }
        if (cfg.shape === 'sport') {
            part(shell, rbox(0.05, 0.07, d.W * 0.82, 0.03), m.tailMat, -2.05, 0.7, 0);
            part(shell, rbox(0.34, 0.05, d.W * 0.96, 0.02), paint, -1.84, 1.14, 0);                 // wing
            for (const s of [1, -1]) {
                part(shell, rbox(0.1, 0.28, 0.04, 0.015), MAT.trim, -1.84, 0.98, s * 0.55);
                part(shell, rbox(0.34, 0.14, 0.03, 0.015), MAT.trim, -1.84, 1.12, s * d.W * 0.48);  // wing end plates
                part(shell, rbox(2.1, 0.07, 0.06, 0.03), MAT.trim, 0.02, 0.28, s * (hw + 0.01));    // side skirts
                part(shell, rbox(0.5, 0.12, 0.03, 0.03), MAT.trim, -0.95, 0.58, s * (hw + 0.004));   // side intakes
                part(shell, cyl(0.07, 0.07, 0.14, 12), MAT.chrome, -2.06, 0.34, s * 0.32, 0, 0, Math.PI / 2);
                part(shell, rbox(0.16, 0.08, 0.06, 0.03), paint, 0.55, 0.9, s * (hw - 0.02));        // mirrors
            }
            part(shell, rbox(0.3, 0.04, d.W * 0.92, 0.015), MAT.trim, 1.95, 0.25, 0);              // splitter
            part(shell, rbox(0.3, 0.1, d.W * 0.7, 0.03), MAT.trim, -1.95, 0.3, 0);                 // diffuser
            part(shell, rbox(0.06, 0.1, 0.9, 0.03), MAT.trim, 2.03, 0.38, 0);                      // intake
            m.hatPos = V3(-0.35, 1.2, 0);
            m.hatScale = 0.9;
            addExhaust(m, -2.1, 0.34, 0.32);
            addExhaust(m, -2.1, 0.34, -0.32);
        } else {
            for (const s of [1, -1]) {
                part(shell, rbox(0.05, 0.16, 0.26, 0.03), m.tailMat, -1.5, 0.72, s * 0.56);
                part(shell, rbox(0.14, 0.09, 0.07, 0.03), paint, 0.55, 1.0, s * (hw + 0.02));
            }
            part(shell, rbox(0.05, 0.12, 0.62, 0.03), MAT.trim, 1.5, 0.48, 0);
            part(shell, rbox(0.2, 0.18, d.W * 0.98, 0.07), MAT.rubber, 1.47, 0.36, 0);
            part(shell, rbox(0.2, 0.18, d.W * 0.98, 0.07), MAT.rubber, -1.47, 0.36, 0);
            part(shell, rbox(0.03, 0.34, 0.9, 0.02), MAT.glass, -1.52, 0.72, 0).rotation.z = 0.05;
            m.hatPos = V3(-0.45, 1.5, 0);
            m.hatScale = 1;
            addExhaust(m, -1.52, 0.3, 0.42);
        }
    }
    mergeGroup(shell);
    // Driver behind the glass
    addPerson(m, paint, { seat: d.driver, grip: [d.driver[0] + 0.45, d.driver[1] + 0.3, 0.16], lean: 0.12, torso: 0.36 });
    m.rider.position.z = d.driver[2];
    if (cfg.shape === 'sport') m.rider.scale.setScalar(0.85);
    const sw = part(m.susp, cached('swheel', () => new THREE.TorusGeometry(0.15, 0.025, 6, 16)), MAT.trim, d.driver[0] + 0.52, d.driver[1] + 0.34, d.driver[2], 0, Math.PI / 2, 0);
    sw.rotation.y = Math.PI / 2 - 0.5;
    m.hatAnchor = new THREE.Object3D();
    m.hatAnchor.position.copy(m.hatPos);
    m.susp.add(m.hatAnchor);
    for (const [x, R] of d.wheels) for (const s of [1, -1]) addWheel(m, m.root, x, R, s * d.tz, R, d.tw, 'car', x > 0);
    addDoor(m, 1, d.door.hinge, d.door.hinge, d.door.back, d.door.y0, d.door.y1, hw, paint);
    addDoor(m, -1, d.door.hinge, d.door.hinge, d.door.back, d.door.y0, d.door.y1, hw, paint);
    m.feel = cfg.shape === 'van' ? { pitch: 0.0028, roll: 0.018, heave: 1.1 } : cfg.shape === 'sport' ? { pitch: 0.0014, roll: 0.006, heave: 0.7 } : { pitch: 0.0022, roll: 0.011, heave: 1 };
    m.starY = Math.max(m.starY, cfg.shape === 'van' ? 2.7 : 1.9);
}

// ============================================================
// Trucks
// ============================================================
function buildTruck(cfg, m, paint) {
    const shell = new THREE.Group();
    m.susp.add(shell);
    if (cfg.shape === 'monster') {
        const W = 2.2, hw = W / 2, R = 0.95, tz = 1.12;
        const body = [[-2.15, 1.6], [-2.18, 2.3], [-2.08, 2.38, -2.18, 2.38], [-0.4, 2.38], [-0.38, 3.1], [-0.22, 3.2, -0.38, 3.2], [0.3, 3.2], [0.88, 2.5, 0.5, 3.1], [1.95, 2.42, 1.3, 2.5], [2.18, 2.12, 2.18, 2.4], [2.15, 1.6]];
        part(shell, cached('body-monster', () => extrude(profileShape(body, 1.55, [{ x: 1.45, y: 0.95, r: 0.86 }, { x: -1.45, y: 0.95, r: 0.86 }]), W, 0.12, 10)), paint);
        part(shell, box(1.6, 0.04, W * 0.8), MAT.dark, -1.28, 2.37, 0);           // open bed
        slopePane(shell, 0.3, 3.19, 0.88, 2.5, W * 0.86);
        sideGlass(shell, [[-0.3, 2.52], [0.7, 2.52], [0.3, 3.08], [-0.3, 3.08]], W + 0.02);
        part(shell, rbox(0.03, 0.4, W * 0.7, 0.02), MAT.glass, -0.41, 2.8, 0);
        // Roof light bar
        part(shell, rbox(0.2, 0.1, 1.6, 0.03), MAT.trim, 0.0, 3.26, 0);
        for (let i = 0; i < 4; i++) part(shell, rbox(0.04, 0.08, 0.26, 0.02), MAT.head, 0.1, 3.26, -0.6 + i * 0.4);
        // Chassis, axles, shocks, bumpers
        for (const s of [1, -1]) part(shell, box(4.0, 0.16, 0.12), MAT.dark, 0, 1.35, s * 0.62);
        for (const x of [1.45, -1.45]) {
            part(shell, cyl(0.12, 0.12, 2.1, 10), MAT.dark, x, 0.95, 0, Math.PI / 2, 0, 0);
            part(shell, rbox(0.4, 0.34, 0.5, 0.08), MAT.dark, x, 0.95, 0);
            for (const s of [1, -1]) {
                segment(shell, V3(x - 0.3, 1.0, s * 0.72), V3(x - 0.1, 1.62, s * 0.64), 0.07, MAT.chrome);
                segment(shell, V3(x + 0.3, 1.0, s * 0.72), V3(x + 0.1, 1.62, s * 0.64), 0.07, MAT.chrome);
            }
        }
        part(shell, rbox(0.2, 0.3, W + 0.3, 0.08), MAT.chrome, 2.2, 1.75, 0);
        part(shell, rbox(0.2, 0.3, W + 0.2, 0.08), MAT.chrome, -2.2, 1.75, 0);
        part(shell, rbox(0.06, 0.3, 1.2, 0.03), MAT.trim, 2.18, 2.18, 0);
        for (const s of [1, -1]) {
            part(shell, rbox(0.06, 0.18, 0.36, 0.04), MAT.head, 2.17, 2.2, s * 0.72);
            part(shell, rbox(0.05, 0.22, 0.3, 0.03), m.tailMat, -2.18, 2.05, s * 0.8);
            part(shell, rbox(0.15, 0.12, 0.08, 0.03), paint, 0.72, 2.6, s * (hw + 0.06));
            // Flared arches
            part(shell, cached('flare', () => { const g = new THREE.TorusGeometry(0.92, 0.07, 6, 18, Math.PI); return g; }), MAT.trim, 1.45, 0.95, s * (hw + 0.02));
            part(shell, cached('flare', () => new THREE.TorusGeometry(0.92, 0.07, 6, 18, Math.PI)), MAT.trim, -1.45, 0.95, s * (hw + 0.02));
        }
        mergeGroup(shell);
        addPerson(m, paint, { seat: [0.05, 2.45, 0], grip: [0.5, 2.78, 0.16], lean: 0.12, torso: 0.36 });
        m.rider.position.z = -0.45;
        for (const x of [1.45, -1.45]) for (const s of [1, -1]) addWheel(m, m.root, x, R, s * tz, R, 0.62, 'knobby', x > 0, 6);
        addDoor(m, 1, 0.55, 0.55, -0.35, 1.68, 2.45, hw, paint);
        addDoor(m, -1, 0.55, 0.55, -0.35, 1.68, 2.45, hw, paint);
        m.hatPos = V3(0.02, 3.3, 0);
        m.hatScale = 1.2;
        addExhaust(m, -2.2, 1.55, 0.5);
        addExhaust(m, -2.2, 1.55, -0.5);
        m.feel = { pitch: 0.004, roll: 0.03, heave: 1.5 };
        m.starY = 3.9;
    } else {
        const W = 2.4, hw = W / 2, R = 0.55, tz = 1.02;
        const body = [[-2.78, 0.82], [-2.82, 3.05], [-2.45, 3.36, -2.82, 3.36], [0.2, 3.34], [0.62, 2.36, 0.34, 3.2], [2.3, 2.08, 1.5, 2.26], [2.6, 1.9, 2.58, 2.08], [2.62, 0.85]];
        const arches = [{ x: 1.75, y: R, r: 0.66 }, { x: -1.62, y: R, r: 0.66, len: 0.85 }];
        part(shell, cached('body-rig', () => extrude(profileShape(body, 0.75, arches), W, 0.14, 10)), paint);
        slopePane(shell, 0.22, 3.3, 0.6, 2.38, W * 0.88);
        sideGlass(shell, [[-0.15, 2.4], [0.55, 2.4], [0.22, 3.2], [-0.15, 3.2]], W + 0.02);
        part(shell, rbox(0.3, 0.1, W * 0.9, 0.04), MAT.trim, 0.42, 3.38, 0);                 // sun visor
        part(shell, rbox(0.08, 1.0, 1.36, 0.04), MAT.chrome, 2.62, 1.42, 0);                   // grille
        for (let i = 0; i < 7; i++) part(shell, box(0.03, 0.9, 0.04), MAT.trim, 2.66, 1.42, -0.54 + i * 0.18);
        part(shell, rbox(0.34, 0.42, W + 0.28, 0.1), MAT.chrome, 2.7, 0.78, 0);             // bumper
        for (const s of [1, -1]) {
            part(shell, rbox(0.06, 0.24, 0.36, 0.04), MAT.head, 2.63, 1.25, s * 0.94);
            part(shell, rbox(0.05, 0.3, 0.2, 0.03), m.tailMat, -2.82, 1.2, s * 1.0);
            // Exhaust stacks behind the cab, fuel tanks, steps, mirrors, air horns
            part(shell, cyl(0.1, 0.12, 2.6, 12), MAT.chrome, -0.25, 2.45, s * (hw + 0.14));
            part(shell, cyl(0.32, 0.32, 1.4, 16), MAT.chrome, 0.35, 0.95, s * (hw + 0.05), 0, 0, Math.PI / 2);
            part(shell, rbox(0.4, 0.06, 0.3, 0.02), MAT.alu, 0.35, 0.5, s * (hw + 0.1));
            part(shell, rbox(0.1, 0.5, 0.06, 0.03), MAT.trim, 0.9, 2.55, s * (hw + 0.2));
            part(shell, cyl(0.02, 0.02, 0.26, 6), MAT.trim, 0.9, 2.35, s * (hw + 0.1), Math.PI / 2, 0, 0);
            part(shell, cached('horn', () => { const g = new THREE.CylinderGeometry(0.1, 0.03, 0.6, 12); g.rotateZ(-Math.PI / 2); return g; }), MAT.chrome, -0.2, 3.46, s * 0.3);
        }
        for (let i = 0; i < 3; i++) part(shell, rbox(0.08, 0.06, 0.14, 0.02), MAT.amber, 0.1, 3.42, -0.4 + i * 0.4);
        for (const s of [1, -1]) part(shell, box(5.0, 0.2, 0.14), MAT.dark, -0.1, 0.8, s * 0.55);
        mergeGroup(shell);
        addPerson(m, paint, { seat: [0.05, 2.12, 0], grip: [0.5, 2.45, 0.16], lean: 0.1, torso: 0.36 });
        m.rider.position.z = -0.55;
        addWheel(m, m.root, 1.75, R, tz, R, 0.4, 'dark', true, 8);
        addWheel(m, m.root, 1.75, R, -tz, R, 0.4, 'dark', true, 8);
        for (const x of [-1.2, -2.05]) for (const s of [1, -1]) addWheel(m, m.root, x, R, s * tz, R, 0.46, 'dark', false, 8);
        addDoor(m, 1, 0.58, 0.58, -0.2, 0.95, 2.3, hw, paint);
        addDoor(m, -1, 0.58, 0.58, -0.2, 0.95, 2.3, hw, paint);
        m.hatPos = V3(-1.2, 3.36, 0);
        m.hatScale = 1.4;
        addExhaust(m, -0.25, 3.8, hw + 0.14, V3(0, 1, 0), 1.2);
        addExhaust(m, -0.25, 3.8, -hw - 0.14, V3(0, 1, 0), 1.2);
        m.feel = { pitch: 0.0035, roll: 0.026, heave: 1.2 };
        m.starY = 4.2;
    }
    m.hatAnchor = new THREE.Object3D();
    m.hatAnchor.position.copy(m.hatPos);
    m.susp.add(m.hatAnchor);
}

// ============================================================
// Karts
// ============================================================
function buildKart(cfg, m, paint) {
    const shell = new THREE.Group();
    m.susp.add(shell);
    if (cfg.shape === 'gokart') {
        part(shell, rbox(1.9, 0.05, 0.86, 0.02), MAT.dark, -0.05, 0.14, 0);                        // floor pan
        part(shell, cached('kart-nose', () => extrude(polyShape([[0.4, 0.12], [0.42, 0.34], [1.02, 0.34, 0.75, 0.42], [1.16, 0.14, 1.18, 0.3]]), 0.86, 0.06)), paint);
        part(shell, cached('kart-bumper', () => tube([[1.05, 0.2, -0.55], [1.22, 0.2, -0.3], [1.24, 0.2, 0.3], [1.05, 0.2, 0.55]], 0.03, 16, 6)), MAT.chrome);
        part(shell, cached('kart-rbumper', () => tube([[-0.95, 0.22, -0.72], [-1.1, 0.24, -0.5], [-1.12, 0.24, 0.5], [-0.95, 0.22, 0.72]], 0.03, 16, 6)), MAT.chrome);
        part(shell, cached('kart-seat', () => extrude(polyShape([[-0.5, 0.16], [-0.62, 0.62, -0.6, 0.4], [-0.5, 0.64], [-0.4, 0.26, -0.45, 0.34], [-0.05, 0.18], [-0.05, 0.14]]), 0.44, 0.06)), MAT.seat);
        part(shell, rbox(0.4, 0.3, 0.34, 0.06), MAT.dark, -0.78, 0.36, 0.22);                       // engine
        part(shell, cached('kart-pipe', () => tube([[-0.75, 0.4, 0.4], [-0.9, 0.45, 0.46], [-1.08, 0.46, 0.42]], 0.045, 10, 8)), MAT.chrome);
        part(shell, cyl(0.02, 0.02, 0.5, 6), MAT.trim, 0.42, 0.38, 0, 0, 0, 0.9);                  // steering column
        const sw = part(shell, cached('kart-wheel', () => new THREE.TorusGeometry(0.14, 0.022, 6, 16)), MAT.trim, 0.26, 0.56, 0);
        sw.rotation.set(0, Math.PI / 2, 0);
        sw.rotateX(-0.9);
        part(shell, rbox(0.04, 0.16, 0.34, 0.02), MAT.white, 1.14, 0.3, 0);                        // number plate
        part(shell, rbox(0.03, 0.08, 0.14, 0.02), MAT.head, 1.16, 0.3, 0);
        part(shell, rbox(0.05, 0.08, 0.3, 0.02), m.tailMat, -0.9, 0.52, -0.05);
        mergeGroup(shell);
        addPerson(m, paint, { seat: [-0.35, 0.26, 0], grip: [0.26, 0.56, 0.13], foot: [0.62, 0.2, 0.14], lean: 0.2, torso: 0.4 });
        addWheel(m, m.root, 0.76, 0.22, 0.62, 0.22, 0.2, 'car', true, 5);
        addWheel(m, m.root, 0.76, 0.22, -0.62, 0.22, 0.2, 'car', true, 5);
        addWheel(m, m.root, -0.72, 0.27, 0.66, 0.27, 0.3, 'car', false, 5);
        addWheel(m, m.root, -0.72, 0.27, -0.66, 0.27, 0.3, 'car', false, 5);
        // Side pods double as the "doors" that slap people
        for (const s of [1, -1]) {
            const pivot = new THREE.Group();
            pivot.position.set(0.38, 0.24, s * 0.5);
            part(pivot, cached('kart-pod', () => { const g = extrude(polyShape([[-0.78, -0.1], [-0.76, 0.1], [0, 0.08], [0.06, -0.1]]), 0.14, 0.04); return g; }), paint, 0, 0, s * 0.05);
            m.susp.add(pivot);
            m.doors[s] = pivot;
        }
        addExhaust(m, -1.1, 0.46, 0.42);
        m.feel = { pitch: 0.0012, roll: 0.004, heave: 0.5 };
    } else {
        part(shell, cached('bumper-tub', () => extrudeUp(roundedRectShape(-0.9, -0.78, 0.9, 0.78, 0.55), 0.46, 0.14)), paint).position.y = 0.2;
        part(shell, cached('bumper-ring', () => {
            const s = roundedRectShape(-1.02, -0.9, 1.02, 0.9, 0.62);
            s.holes.push(roundedRectShape(-0.9, -0.78, 0.9, 0.78, 0.55));
            return extrudeUp(s, 0.22, 0.07);
        }), MAT.rubber).position.y = 0.16;
        part(shell, rbox(0.42, 0.42, 0.62, 0.12), MAT.seat, -0.3, 0.8, 0);
        part(shell, cyl(0.025, 0.025, 1.3, 8), MAT.chrome, -0.72, 1.3, 0);
        part(shell, sphere(0.08, 10, 8), MAT.spark, -0.72, 1.98, 0);
        part(shell, cyl(0.02, 0.02, 0.4, 6), MAT.trim, 0.42, 0.78, 0, 0, 0, 0.5);
        const sw = part(shell, cached('kart-wheel', () => new THREE.TorusGeometry(0.14, 0.022, 6, 16)), MAT.trim, 0.32, 0.96, 0);
        sw.rotation.set(0, Math.PI / 2, 0);
        sw.rotateX(-0.7);
        part(shell, sphere(0.09, 12, 8), MAT.head, 0.9, 0.52, 0);
        part(shell, rbox(0.05, 0.08, 0.3, 0.02), m.tailMat, -0.92, 0.5, 0);
        mergeGroup(shell);
        addPerson(m, paint, { seat: [-0.22, 0.72, 0], grip: [0.3, 0.95, 0.13], foot: [0.55, 0.36, 0.14], lean: 0.12, torso: 0.4 });
        for (const x of [0.6, -0.6]) for (const s of [1, -1]) addWheel(m, m.root, x, 0.15, s * 0.55, 0.15, 0.14, 'dark', x > 0, 4);
        for (const s of [1, -1]) {
            const pivot = new THREE.Group();
            pivot.position.set(0.25, 0.46, s * 0.8);
            part(pivot, rbox(0.6, 0.26, 0.06, 0.03), paint, -0.3, 0, 0);
            m.susp.add(pivot);
            m.doors[s] = pivot;
        }
        addExhaust(m, -0.98, 0.4, 0);
        m.feel = { pitch: 0.002, roll: 0.01, heave: 0.8 };
    }
}

// ============================================================
// Bikes
// ============================================================
function buildBike(cfg, m, paint) {
    const shell = new THREE.Group();
    m.susp.add(shell);
    if (cfg.shape === 'moped') {
        const R = 0.3, fx = 0.66, rx = -0.66;
        part(shell, sphere(1, 20, 14), paint, -0.36, 0.52, 0).scale.set(0.6, 0.3, 0.29);             // rear cowl
        part(shell, rbox(0.66, 0.06, 0.36, 0.03), MAT.dark, 0.08, 0.32, 0);                          // floorboard
        part(shell, cached('moped-shield', () => extrude(polyShape([[0.36, 0.3], [0.5, 0.3], [0.63, 1.02, 0.66, 0.62], [0.5, 1.02], [0.4, 0.34, 0.5, 0.6]]), 0.5, 0.04)), paint);
        part(shell, sphere(1, 16, 10), paint, 0.7, 0.48, 0).scale.set(0.3, 0.1, 0.15);               // front fender
        part(shell, cyl(0.035, 0.035, 0.62, 8), MAT.chrome, 0.64, 0.74, 0, 0, 0, 0.18);
        part(shell, rbox(0.26, 0.13, 0.3, 0.05), paint, 0.56, 1.08, 0);                               // headset
        part(shell, cached('moped-lamp', () => { const g = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16); g.rotateZ(Math.PI / 2); return g; }), MAT.head, 0.7, 1.08, 0);
        part(shell, cyl(0.02, 0.02, 0.62, 6), MAT.chrome, 0.52, 1.12, 0, Math.PI / 2, 0, 0);
        part(shell, rbox(0.62, 0.12, 0.3, 0.05), MAT.seat, -0.32, 0.84, 0);
        part(shell, rbox(0.3, 0.03, 0.26, 0.01), MAT.chrome, -0.78, 0.8, 0);                       // rack
        part(shell, rbox(0.05, 0.07, 0.14, 0.02), m.tailMat, -0.96, 0.6, 0);
        part(shell, cyl(0.045, 0.05, 0.4, 8), MAT.chrome, -0.52, 0.26, 0.17, 0, 0, Math.PI / 2 - 0.1);
        for (const s of [1, -1]) part(shell, cyl(0.012, 0.012, 0.3, 4), MAT.chrome, 0.5, 1.25, s * 0.28, 0.2 * s, 0, 0);
        mergeGroup(shell);
        addWheel(m, m.body, fx, R, 0, R, 0.12, 'car', true, 5);
        addWheel(m, m.body, rx, R, 0, R, 0.13, 'car', false, 5);
        addPerson(m, paint, { seat: [-0.28, 0.9, 0], grip: [0.5, 1.12, 0.28], foot: [0.12, 0.36, 0.13], lean: 0.08, torso: 0.44, weapon: 'baguette' });
        addExhaust(m, -0.74, 0.24, 0.17);
        m.feel = { pitch: 0.0022, roll: 0, heave: 0.9 };
    } else if (cfg.shape === 'dirt') {
        const fx = 0.84, rx = -0.8;
        part(shell, cached('dirt-frame', () => tube([[0.55, 1.08, 0], [0.3, 0.78, 0], [0.05, 0.44, 0], [-0.2, 0.52, 0], [-0.35, 0.86, 0], [-0.8, 0.98, 0]], 0.04, 20, 8)), MAT.alu);
        part(shell, cached('dirt-swing', () => tube([[-0.18, 0.5, 0], [-0.5, 0.48, 0], [rx, 0.46, 0]], 0.035, 8, 6)), MAT.dark);
        for (const s of [1, -1]) part(shell, cyl(0.04, 0.045, 0.95, 8), MAT.chrome, 0.7, 0.8, s * 0.1, 0, 0, 0.4);
        part(shell, rbox(0.12, 0.08, 0.3, 0.03), MAT.dark, 0.58, 1.14, 0);                           // triple clamp
        part(shell, cached('dirt-fender', () => extrude(polyShape([[0.55, 0.98], [0.82, 1.06, 0.66, 1.06], [1.2, 0.92, 1.05, 1.02], [1.18, 0.88], [0.8, 1.0, 1.0, 0.98], [0.56, 0.94]]), 0.2, 0.03)), paint);
        part(shell, cached('dirt-tank', () => extrude(polyShape([[-0.05, 0.9], [0.1, 1.12, -0.02, 1.08], [0.5, 1.12], [0.52, 0.94], [0.2, 0.84]]), 0.42, 0.08)), paint);
        for (const s of [1, -1]) part(shell, cached('dirt-shroud', () => extrude(polyShape([[0.1, 0.84], [0.5, 1.06], [0.46, 0.78]]), 0.03, 0.01)), paint, 0, 0, s * 0.22);
        part(shell, cached('dirt-seat', () => extrude(polyShape([[-0.85, 1.02], [-0.85, 1.08], [0.1, 1.12], [0.12, 1.04]]), 0.26, 0.04)), MAT.seat);
        part(shell, cached('dirt-rearfender', () => extrude(polyShape([[-0.6, 0.98], [-1.15, 1.04, -0.9, 1.04], [-1.15, 0.99], [-0.6, 0.92]]), 0.18, 0.02)), MAT.white);
        for (const s of [1, -1]) part(shell, rbox(0.3, 0.22, 0.02, 0.04), MAT.white, -0.62, 0.86, s * 0.14);
        part(shell, rbox(0.34, 0.3, 0.28, 0.06), MAT.dark, 0.02, 0.56, 0);                            // engine
        part(shell, cached('dirt-pipe', () => tube([[0.15, 0.62, 0.1], [0.1, 0.42, 0.14], [-0.2, 0.62, 0.18], [-0.55, 0.86, 0.18]], 0.035, 14, 6)), MAT.chrome);
        part(shell, cyl(0.06, 0.06, 0.4, 10), MAT.alu, -0.72, 0.9, 0.18, 0, 0, Math.PI / 2 - 0.25);
        part(shell, rbox(0.06, 0.3, 0.3, 0.04), MAT.cream, 0.74, 1.08, 0, 0, 0, 0.35);                // number plate
        part(shell, rbox(0.03, 0.06, 0.1, 0.01), MAT.head, 0.8, 1.05, 0, 0, 0, 0.35);
        part(shell, cyl(0.02, 0.02, 0.8, 6), MAT.trim, 0.46, 1.3, 0, Math.PI / 2, 0, 0);
        part(shell, rbox(0.04, 0.05, 0.1, 0.01), m.tailMat, -1.13, 0.98, 0);
        mergeGroup(shell);
        addWheel(m, m.body, fx, 0.46, 0, 0.46, 0.13, 'bikeKnobby', true);
        addWheel(m, m.body, rx, 0.44, 0, 0.44, 0.16, 'bikeKnobby', false);
        addPerson(m, paint, { seat: [-0.12, 1.12, 0], grip: [0.44, 1.32, 0.38], foot: [-0.02, 0.6, 0.22], lean: 0.42, torso: 0.44 });
        addExhaust(m, -0.95, 0.94, 0.18);
        m.feel = { pitch: 0.003, roll: 0, heave: 1.2 };
    } else {
        const fx = 1.18, rx = -1.06;
        part(shell, cached('chop-frame', () => tube([[0.78, 1.12, 0], [0.3, 0.92, 0], [-0.3, 0.74, 0], [-0.7, 0.66, 0], [rx, 0.48, 0]], 0.045, 20, 8)), MAT.chrome);
        part(shell, cached('chop-down', () => tube([[0.74, 1.05, 0], [0.45, 0.4, 0], [-0.2, 0.3, 0], [-0.6, 0.45, 0]], 0.04, 16, 8)), MAT.dark);
        for (const s of [1, -1]) part(shell, cyl(0.04, 0.04, 1.45, 8), MAT.chrome, 0.97, 0.8, s * 0.1, 0, 0, 0.55);
        part(shell, sphere(1, 20, 14), paint, 0.32, 1.02, 0).scale.set(0.46, 0.19, 0.22);             // tank
        for (const a of [-0.45, 0.45]) part(shell, cyl(0.1, 0.12, 0.42, 12), MAT.chrome, 0.05 + a * 0.2, 0.62, 0, 0, 0, a);
        part(shell, rbox(0.46, 0.2, 0.26, 0.06), MAT.dark, 0.02, 0.38, 0);
        part(shell, cached('chop-seat', () => extrude(polyShape([[-0.85, 0.76], [-0.8, 0.9, -0.88, 0.9], [-0.1, 0.84], [-0.1, 0.76]]), 0.32, 0.06)), MAT.seat);
        part(shell, cached('chop-sissy', () => tube([[-0.82, 0.8, -0.14], [-0.95, 1.35, -0.14], [-0.95, 1.4, 0], [-0.95, 1.35, 0.14], [-0.82, 0.8, 0.14]], 0.022, 16, 6)), MAT.chrome);
        part(shell, cached('chop-rfender', () => extrude(polyShape([[-0.6, 0.66], [-1.06, 1.02, -0.75, 1.0], [-1.52, 0.52, -1.42, 0.98], [-1.46, 0.48], [-1.06, 0.94, -1.36, 0.9], [-0.64, 0.6, -0.8, 0.86]]), 0.3, 0.04)), paint);
        for (const dz of [0.2, 0.28]) part(shell, cached(`chop-pipe${dz}`, () => tube([[0.1, 0.5, dz - 0.05], [-0.2, 0.36, dz], [-0.9, 0.38, dz], [-1.35, 0.46 + (dz - 0.2), dz]], 0.04, 14, 8)), MAT.chrome);
        for (const s of [1, -1]) part(shell, cached(`chop-ape${s}`, () => tube([[0.8, 1.2, s * 0.08], [0.72, 1.62, s * 0.3], [0.58, 1.74, s * 0.38]], 0.022, 12, 6)), MAT.chrome);
        part(shell, cached('chop-lamp', () => { const g = new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI); g.rotateY(-Math.PI / 2); return g; }), MAT.chrome, 0.98, 1.08, 0);
        part(shell, cached('chop-lens', () => { const g = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16); g.rotateZ(Math.PI / 2); return g; }), MAT.head, 0.99, 1.08, 0);
        part(shell, rbox(0.05, 0.06, 0.12, 0.02), m.tailMat, -1.5, 0.56, 0);
        mergeGroup(shell);
        addWheel(m, m.body, fx, 0.42, 0, 0.42, 0.11, 'bike', true);
        addWheel(m, m.body, rx, 0.46, 0, 0.46, 0.26, 'car', false, 6);
        addPerson(m, paint, { seat: [-0.45, 0.86, 0], grip: [0.58, 1.72, 0.38], foot: [0.55, 0.46, 0.26], lean: -0.12, torso: 0.46, weapon: 'chicken' });
        addExhaust(m, -1.4, 0.48, 0.2);
        addExhaust(m, -1.4, 0.56, 0.28);
        m.feel = { pitch: 0.0022, roll: 0, heave: 1 };
    }
}

// ============================================================
// ATVs
// ============================================================
// Mudguard band over a wheel pair: an arc of a ring, extruded across the vehicle
function fenderGeo(key, R, width, a0 = 0.25, a1 = 2.6) {
    return cached(key, () => {
        const s = new THREE.Shape();
        const ro = R + 0.2, rin = R + 0.08;
        s.absarc(0, 0, ro, a0, a1, false);
        s.absarc(0, 0, rin, a1, a0, true);
        s.closePath();
        return extrude(s, width, 0.035, 10);
    });
}

function buildAtv(cfg, m, paint) {
    const shell = new THREE.Group();
    m.susp.add(shell);
    if (cfg.shape === 'quad') {
        const R = 0.4, wx = 0.8, tz = 0.62;
        for (const x of [wx, -wx]) part(shell, fenderGeo('quad-fender', R, 1.62), paint, x, R, 0);
        part(shell, rbox(1.2, 0.3, 0.62, 0.1), paint, 0.05, 0.78, 0);                                // body cover
        part(shell, rbox(1.7, 0.14, 0.4, 0.04), MAT.dark, 0, 0.45, 0);                               // chassis
        part(shell, cached('quad-seat', () => extrude(polyShape([[-0.75, 0.9], [-0.72, 1.02], [0.2, 1.04], [0.25, 0.92]]), 0.36, 0.05)), MAT.seat);
        part(shell, rbox(0.5, 0.04, 1.1, 0.01), MAT.trim, 1.02, 1.02, 0);                             // front rack
        part(shell, rbox(0.55, 0.04, 1.1, 0.01), MAT.trim, -0.98, 1.0, 0);
        part(shell, cyl(0.035, 0.035, 0.3, 8), MAT.chrome, 0.56, 1.02, 0, 0, 0, -0.25);
        part(shell, rbox(0.22, 0.14, 0.34, 0.05), paint, 0.58, 1.18, 0);                             // headlight pod
        for (const s of [1, -1]) part(shell, rbox(0.05, 0.09, 0.14, 0.02), MAT.head, 1.28, 0.72, s * 0.3);
        part(shell, rbox(0.04, 0.08, 0.26, 0.02), m.tailMat, -1.3, 0.68, 0);
        part(shell, cyl(0.022, 0.022, 0.84, 6), MAT.trim, 0.52, 1.22, 0, Math.PI / 2, 0, 0);
        part(shell, cached('quad-pipe', () => tube([[-0.2, 0.5, 0.2], [-0.8, 0.62, 0.25], [-1.2, 0.72, 0.25]], 0.04, 10, 6)), MAT.chrome);
        for (const s of [1, -1]) part(shell, rbox(0.5, 0.04, 0.24, 0.01), MAT.trim, -0.02, 0.5, s * 0.38);  // footwells
        mergeGroup(shell);
        for (const x of [wx, -wx]) for (const s of [1, -1]) addWheel(m, m.root, x, R, s * tz, R, 0.3, 'knobby', x > 0, 5);
        addPerson(m, paint, { seat: [-0.15, 1.04, 0], grip: [0.5, 1.24, 0.4], foot: [0.0, 0.54, 0.36], lean: 0.3, torso: 0.42, weapon: 'shovel' });
        addExhaust(m, -1.24, 0.72, 0.25);
        m.feel = { pitch: 0.0026, roll: 0.012, heave: 1.3 };
    } else {
        const R = 0.46, wx = 1.0, tz = 0.82;
        part(shell, cached('buggy-tub', () => extrude(profileShape([[-1.4, 0.4], [-1.45, 0.72], [-0.5, 0.76], [0.9, 0.66], [1.55, 0.5, 1.4, 0.62], [1.55, 0.36]], 0.36, []), 1.2, 0.08)), paint);
        part(shell, cached('buggy-cage', () => {
            const parts = [];
            for (const s of [1, -1]) {
                parts.push(tube([[1.1, 0.62, s * 0.55], [0.55, 1.45, s * 0.55], [-0.15, 1.72, s * 0.55], [-0.8, 1.6, s * 0.55], [-1.2, 0.72, s * 0.55]], 0.04, 24, 6));
                parts.push(tube([[-0.8, 1.6, s * 0.55], [-0.8, 0.7, s * 0.6]], 0.035, 4, 6));
            }
            for (const x of [0.55, -0.15, -0.8]) {
                const y = x === 0.55 ? 1.45 : x === -0.15 ? 1.72 : 1.6;
                parts.push(tube([[x, y, -0.55], [x, y + 0.02, 0], [x, y, 0.55]], 0.035, 4, 6));
            }
            return mergeGeometries(parts.map(g => g.toNonIndexed ? (g.index ? g.toNonIndexed() : g) : g));
        }), MAT.dark);
        part(shell, cached('buggy-bumper', () => tube([[1.4, 0.5, -0.6], [1.7, 0.45, -0.35], [1.72, 0.45, 0.35], [1.4, 0.5, 0.6]], 0.04, 12, 6)), MAT.chrome);
        part(shell, rbox(0.7, 0.44, 0.7, 0.08), MAT.dark, -1.1, 0.95, 0);                               // engine
        for (const s of [1, -1]) part(shell, cached('buggy-pipe', () => tube([[-1.3, 1.0, 0.2], [-1.55, 1.1, 0.25], [-1.7, 1.25, 0.25]], 0.04, 8, 6)), MAT.chrome, 0, 0, s < 0 ? -0.45 : 0);
        part(shell, cached('buggy-seat', () => extrude(polyShape([[-0.5, 0.7], [-0.62, 1.3, -0.62, 1.0], [-0.5, 1.32], [-0.36, 0.84, -0.44, 0.9], [0.1, 0.76], [0.1, 0.7]]), 0.5, 0.06)), MAT.seat);
        for (const x of [wx, -wx]) for (const s of [1, -1]) part(shell, fenderGeo('buggy-fender', R, 0.4, 0.3, 2.3), paint, x, R, s * tz);
        for (const s of [1, -1]) part(shell, rbox(0.05, 0.12, 0.18, 0.02), MAT.head, 1.55, 0.58, s * 0.35);
        part(shell, rbox(0.05, 0.1, 0.28, 0.02), m.tailMat, -1.47, 0.62, 0);
        part(shell, cyl(0.02, 0.02, 0.4, 6), MAT.trim, 0.55, 0.95, 0, 0, 0, 0.9);
        const sw = part(shell, cached('kart-wheel', () => new THREE.TorusGeometry(0.14, 0.022, 6, 16)), MAT.trim, 0.36, 1.12, 0);
        sw.rotation.set(0, Math.PI / 2, 0);
        sw.rotateX(-0.8);
        mergeGroup(shell);
        for (const x of [wx, -wx]) for (const s of [1, -1]) addWheel(m, m.root, x, R, s * tz, R, 0.36, 'knobby', x > 0, 6);
        addPerson(m, paint, { seat: [-0.3, 0.84, 0], grip: [0.36, 1.12, 0.13], foot: [0.75, 0.62, 0.16], lean: 0.12, torso: 0.42, weapon: 'coconut' });
        addExhaust(m, -1.72, 1.26, 0.25);
        addExhaust(m, -1.72, 1.26, -0.2);
        m.feel = { pitch: 0.0028, roll: 0.012, heave: 1.4 };
    }
}

// ============================================================
// Effects attached to every vehicle: nitro flames, shield bubble, gum
// ============================================================
const flameGeo = (() => { const g = new THREE.ConeGeometry(0.2, 1, 12, 1, true); g.translate(0, 0.5, 0); return g; })();
function buildFlames(m, color) {
    const c = new THREE.Color(color);
    m.flameMats = {
        outer: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3), alphaMap: FLAME_ALPHA, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
        inner: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(4), alphaMap: FLAME_ALPHA, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    };
    m.boostColor = new THREE.Color(0xff8a30).multiplyScalar(3);
    m.nitroColor = c.clone().lerp(new THREE.Color(1, 1, 1), 0.15).multiplyScalar(3.2);
    m.flames = [];
    for (const e of m.exhausts) {
        const g = new THREE.Group();
        g.position.copy(e.pos);
        g.quaternion.setFromUnitVectors(UP, e.dir);
        const outer = new THREE.Mesh(flameGeo, m.flameMats.outer);
        const inner = new THREE.Mesh(flameGeo, m.flameMats.inner);
        inner.scale.set(0.5, 0.6, 0.5);
        g.add(outer, inner);
        g.visible = false;
        g.userData.size = e.size;
        m.susp.add(g);
        m.flames.push(g);
    }
}

const shieldMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.9, 1.6) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() { float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float bands = 0.5 + 0.5 * sin(vP.y * 9.0 - uTime * 4.0);
        gl_FragColor = vec4(uColor * (0.25 + f * 1.6 + bands * 0.15), 0.12 + f * 0.75); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const shieldGeo = new THREE.SphereGeometry(1, 24, 16);
const gumMat = std({ color: 0xff7ec8, roughness: 0.35, emissive: 0xff3da0, emissiveIntensity: 0.25 });

// ============================================================
// Build
// ============================================================
export function buildVehicleModel(cfg, color) {
    const root = new THREE.Group();   // position and heading
    const body = new THREE.Group();   // bikes lean the whole thing, wheels included
    const susp = new THREE.Group();   // sprung mass: heave, pitch, roll
    root.add(body);
    body.add(susp);
    const paint = makePaint(color);
    const tailMat = MAT.tail.clone();
    const m = {
        root, body, susp, kind: cfg.kind, cfg, wheels: [], front: [], doors: {}, weapon: null, legs: null,
        paintMat: paint, tailMat, head: null, hatAnchor: null, hatScale: 0.5, hatPos: null, rider: null, torso: null,
        exhausts: [], starY: 1.5, _hat: null, anim: null, feel: { pitch: 0.002, roll: 0.01, heave: 1 },
    };
    if (cfg.kind === 'car') buildCar(cfg, m, paint);
    else if (cfg.kind === 'truck') buildTruck(cfg, m, paint);
    else if (cfg.kind === 'kart') buildKart(cfg, m, paint);
    else if (cfg.kind === 'atv') buildAtv(cfg, m, paint);
    else buildBike(cfg, m, paint);

    // Dizzy stars shown while stunned
    const stars = new THREE.Group();
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        part(stars, cached('star', () => new THREE.OctahedronGeometry(0.16, 0)), MAT.star, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
    }
    stars.position.y = m.starY;
    stars.visible = false;
    susp.add(stars);
    m.stars = stars;

    buildFlames(m, color);
    const box3 = new THREE.Box3().setFromObject(susp);
    const size = box3.getSize(V3());
    m.shield = new THREE.Mesh(shieldGeo, shieldMat);
    m.shield.scale.set(size.x * 0.62 + 0.4, size.y * 0.62 + 0.35, size.z * 0.62 + 0.45);
    m.shield.position.y = size.y * 0.45;
    m.shield.visible = false;
    root.add(m.shield);
    m.gum = new THREE.Group();
    for (let i = 0; i < 5; i++) part(m.gum, sphere(0.35, 10, 8), gumMat, (i - 2) * 0.35, 0.12, (i % 2 ? 1 : -1) * size.z * 0.3).scale.set(1.3, 0.45, 1);
    m.gum.visible = false;
    root.add(m.gum);

    root.traverse(o => {
        if (!o.isMesh) return;
        const fx = o.material === shieldMat || o.material === m.flameMats.outer || o.material === m.flameMats.inner;
        o.castShadow = !fx && o.material !== MAT.glass;
        o.receiveShadow = !fx;
    });
    return m;
}

// ============================================================
// Customization: colors, patterns, hats
// ============================================================
export const PAINT_COLORS = [
    '#e0473f', '#2ec495', '#4488ff', '#f2c14e', '#cc44ff',
    '#ff8844', '#44ddff', '#ff4488', '#88ff44', '#aaaaaa', '#ffffff', '#222222',
];
export const PATTERNS = ['solid', 'stripes', 'flames', 'checkers', 'spots'];
export const HATS = ['none', 'crown', 'propeller', 'shark', 'tophat', 'antenna'];

export function createPatternTexture(pattern, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    g.globalAlpha = 0.55;
    if (pattern === 'stripes') {
        g.fillStyle = '#fff';
        for (let i = 0; i < 128; i += 32) g.fillRect(i, 0, 12, 128);
    } else if (pattern === 'flames') {
        g.fillStyle = '#ff4400';
        for (let i = 0; i < 5; i++) {
            const x = 10 + i * 24;
            g.beginPath();
            g.moveTo(x, 128);
            g.quadraticCurveTo(x + 12, 60 + Math.random() * 30, x + 6, Math.random() * 30);
            g.quadraticCurveTo(x + 18, 60, x + 24, 128);
            g.fill();
        }
    } else if (pattern === 'checkers') {
        g.fillStyle = '#000';
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) g.fillRect(i * 16, j * 16, 16, 16);
    } else if (pattern === 'spots') {
        g.fillStyle = '#fff';
        for (let i = 0; i < 12; i++) {
            g.beginPath();
            g.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 8, 0, Math.PI * 2);
            g.fill();
        }
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.8, 0.8);
    return t;
}

export function buildHat(hatId) {
    const g = new THREE.Group();
    const mat = (c, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    if (hatId === 'crown') {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.3, 8), mat(0xf2c14e, 0.3)));
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const pt = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), mat(0xf2c14e, 0.3));
            pt.position.set(Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35);
            g.add(pt);
        }
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.08), mat(0xff2244, 0.2));
        gem.position.set(0.42, 0.1, 0);
        g.add(gem);
    } else if (hatId === 'propeller') {
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4488ff)));
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15), mat(0x888888, 0.3));
        hub.position.y = 0.38;
        g.add(hub);
        const blades = new THREE.Group();
        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.12), mat(0xff4488));
            blade.position.y = 0.45;
            blade.rotation.y = (i / 3) * Math.PI * 2;
            blade.position.x = Math.cos(blade.rotation.y) * 0.3;
            blade.position.z = -Math.sin(blade.rotation.y) * 0.3;
            blades.add(blade);
        }
        g.add(blades);
        g.userData.spin = blades;
    } else if (hatId === 'shark') {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), mat(0x556677));
        fin.scale.z = 0.35;
        fin.rotation.z = 0.25;
        fin.position.y = 0.35;
        g.add(fin);
    } else if (hatId === 'tophat') {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16), mat(0x111111)));
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.6, 16), mat(0x111111));
        top.position.y = 0.33;
        g.add(top);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 16), mat(0xcc2244));
        band.position.y = 0.1;
        g.add(band);
    } else if (hatId === 'antenna') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), mat(0x888888, 0.3));
        pole.position.y = 0.35;
        g.add(pole);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2020, emissiveIntensity: 1.5 }));
        ball.position.y = 0.72;
        g.add(ball);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

export function applyCustomization(model, custom) {
    if (!custom) return;
    if (custom.color || custom.pattern) {
        const col = custom.color || '#e0473f';
        if (custom.pattern && custom.pattern !== 'solid') {
            model.paintMat.map = createPatternTexture(custom.pattern, col);
            model.paintMat.color.set(0xffffff);
        } else {
            model.paintMat.map = null;
            model.paintMat.color.set(col);
        }
        model.paintMat.needsUpdate = true;
    }
    if (model._hat) { model._hat.parent.remove(model._hat); model._hat = null; }
    if (custom.hat && custom.hat !== 'none' && model.hatAnchor) {
        const hat = buildHat(custom.hat);
        hat.scale.setScalar(model.hatScale);
        model.hatAnchor.add(hat);
        model._hat = hat;
    }
}

// ============================================================
// Animation
// ============================================================
// Everything here is derived from the racer's motion (speed, heading, height, steer), so remote
// racers animate the same as local ones without any extra network data.
export function animateModel(m, r, dt) {
    dt = clamp(dt || 0.016, 0.001, 0.05);
    const spd = r.speed || 0, y = r.y || 0;
    let a = m.anim;
    if (!a) {
        a = m.anim = { spd, acc: 0, h: r.h, yaw: 0, y, vy: 0, pitch: 0, pv: 0, roll: 0, rv: 0, heave: 0, hv: 0, spin: 0, slide: 0, land: 0, t: Math.random() * 10, steer: 0, tuck: 0, look: 0, lean: 0, air: 0 };
    }
    a.t += dt;
    const acc = (spd - a.spd) / dt;
    a.spd = spd;
    a.acc += (clamp(acc, -45, 45) - a.acc) * (1 - Math.exp(-6 * dt));
    const yawRate = angleDiff(a.h, r.h) / dt;
    a.h = r.h;
    a.yaw += (clamp(yawRate, -3.5, 3.5) - a.yaw) * (1 - Math.exp(-8 * dt));
    const vy = (y - a.y) / dt;
    a.y = y;
    // Landing: a big downward speed that suddenly stops
    if (a.vy < -4 && vy > a.vy + 4) {
        const hit = Math.min(1.2, -a.vy / 12);
        a.hv -= hit * 2.4 * m.feel.heave;
        a.land = Math.max(a.land, hit);
    }
    a.vy = vy;
    a.air += ((r.airborne || (vy < -2.5 && y > 0.3) ? 1 : 0) - a.air) * (1 - Math.exp(-10 * dt));
    if (r.jolt) { a.hv -= r.jolt * m.feel.heave; r.jolt = 0; }
    if (r.offroadVis && Math.abs(spd) > 6) a.hv += (Math.random() - 0.5) * 30 * dt * m.feel.heave;

    // Springs: pitch (nose up when accelerating), roll (body leans out of the turn), heave
    const f = m.feel;
    const pitchT = clamp(a.acc * f.pitch, -0.085, 0.085);
    const rollT = clamp(-a.yaw * spd * f.roll, -0.13, 0.13);
    a.pv += ((pitchT - a.pitch) * 110 - a.pv * 12) * dt;
    a.pitch += a.pv * dt;
    a.rv += ((rollT - a.roll) * 90 - a.rv * 11) * dt;
    a.roll += a.rv * dt;
    a.hv += (-a.heave * 160 - a.hv * 12) * dt;
    a.heave = clamp(a.heave + a.hv * dt, -0.25, 0.2);
    a.land *= Math.exp(-7 * dt);

    // Drift pose: the body swings into the slide and the front wheels counter-steer
    const dDir = r.drifting ? (r.driftDir || Math.sign(r.steer) || 1) : 0;
    a.slide += (dDir * 0.3 - a.slide) * (1 - Math.exp(-6 * dt));
    const steerT = r.drifting ? -dDir * 0.34 + (r.steer || 0) * 0.12 : (r.steer || 0) * 0.42;
    a.steer += (steerT - a.steer) * (1 - Math.exp(-12 * dt));

    m.root.position.set(r.x, y, r.z);
    m.root.rotation.y = -(r.h + a.slide + (r.spinVis || 0));
    const bike = m.kind === 'bike';
    const idle = Math.abs(spd) < 1.2 ? 1 : 0;
    m.body.rotation.x = bike ? (r.lean || 0) : m.kind === 'atv' ? (r.lean || 0) * 0.5 : 0;
    m.susp.position.y = a.heave + idle * Math.sin(a.t * 52) * 0.008;
    m.susp.rotation.z = a.pitch;
    m.susp.rotation.x = (bike ? 0 : a.roll) + idle * Math.sin(a.t * 41) * 0.004;
    const sq = a.land * 0.12;
    m.susp.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

    a.spin += spd * dt;
    const droop = a.air * 0.14;
    for (const w of m.wheels) {
        w.spin.rotation.z = -a.spin / w.R;
        if (!bike) w.pivot.position.y = w.baseY - droop + 0.35 * (a.heave + a.pitch * w.x - a.roll * w.z);
    }
    for (const p of m.front) p.rotation.y = -a.steer;

    // Rider / driver: lean into turns, tuck for nitro, brace on landing, look at their target
    if (m.rider) {
        a.tuck += ((r.nitroOn ? 1 : 0) - a.tuck) * (1 - Math.exp(-6 * dt));
        m.rider.position.y = m.riderBaseY + a.heave * 0.6 - a.land * 0.1 - a.tuck * 0.05;
        if (m.kind === 'bike' || m.kind === 'atv') m.rider.rotation.x = (r.lean || 0) * (m.kind === 'atv' ? 0.9 : 0.4);
        m.torso.rotation.z = -a.tuck * 0.32 - a.land * 0.25;
    }
    const k = r.atkT > 0 ? Math.sin(Math.PI * (1 - r.atkT / ATK_TIME)) : 0;
    const s = r.atkSide || 1;
    if (m.head) {
        const lookT = r.atkT > 0 ? -s * 0.9 : -(r.steer || 0) * 0.25;
        a.look += (lookT - a.look) * (1 - Math.exp(-10 * dt));
        m.head.rotation.y = a.look;
    }
    if (m.kind === 'car' || m.kind === 'truck' || m.kind === 'kart') {
        for (const side of [1, -1]) if (m.doors[side]) m.doors[side].rotation.y = side === s ? side * k * 1.25 : 0;
    }
    if (m.weapon) m.weapon.rotation.x = s * k * 1.9;
    else if (m.legs && m.cfg.shape === 'dirt') for (const side of [1, -1]) m.legs[side].rotation.x = side === s ? -side * k * 1.5 : 0;

    m.stars.visible = r.stunT > 0;
    if (m.stars.visible) m.stars.rotation.y += dt * 6;
    if (m._hat && m._hat.userData.spin) m._hat.userData.spin.rotation.y += dt * 14;

    // Nitro / boost flames
    const nitro = !!r.nitroOn, boost = !nitro && r.boostT > 0;
    for (const g of m.flames) {
        g.visible = nitro || boost;
        if (!g.visible) continue;
        const sz = g.userData.size;
        const len = (nitro ? 2.4 : 0.9) * sz * (0.8 + Math.random() * 0.45);
        const wid = (nitro ? 1.5 : 0.9) * sz * (0.9 + Math.random() * 0.2);
        g.scale.set(wid, len, wid);
    }
    if (m.flames.length) m.flameMats.outer.color.copy(nitro ? m.nitroColor : m.boostColor);
    m.shield.visible = r.shieldT > 0;
    if (m.shield.visible) {
        shieldMat.uniforms.uTime.value = a.t;
        m.shield.rotation.y = a.t * 0.5;
    }
    m.gum.visible = r.gumT > 0;
    m.tailMat.emissiveIntensity = r.braking ? 7 : 1.6;
}
