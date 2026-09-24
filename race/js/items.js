// Item boxes and the silly weapons inside them.
//
// Every browser simulates every projectile the same way from its 'fire' event. Only the browser
// that owns a racer decides whether that racer got hit (see main.js), so hits are always fair to
// the person being hit.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// ============================================================
// Item definitions
// ============================================================
export const ITEMS = {
    chicken: { name: 'Chicken Missile', short: 'CHICKEN' },
    tomato: { name: 'Tomato Launcher', short: 'TOMATO', ammo: 3 },
    glove: { name: 'Boxing Glove', short: 'GLOVE' },
    gum: { name: 'Bubble Gum', short: 'GUM', trap: true },
    oil: { name: 'Oil Slick', short: 'OIL', trap: true },
    shield: { name: 'Bubble Shield', short: 'SHIELD' },
    mega: { name: 'Mega Nitro', short: 'MEGA NITRO' },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const SHIELD_TIME = 8;
export const BOX_RESPAWN = 3;
export const ROULETTE_TIME = 1.1;

// back: 0 = leading the race, 1 = dead last (and/or far behind the leader).
// Leaders mostly get defensive or weak items; the back of the pack gets missiles, gloves and the rare Mega Nitro.
export function rollItem(back, rnd = Math.random) {
    const p = clamp(back, 0, 1);
    const w = {
        chicken: 0.1 + 2.8 * p,
        tomato: 0.9 + 1.2 * p,
        glove: 0.5 + 1.5 * p,
        gum: 2.4 - 1.9 * p,
        oil: 2.4 - 1.9 * p,
        shield: 2.0 - 1.4 * p,
        mega: p > 0.55 ? (p - 0.55) * 2.6 : 0,
    };
    let sum = 0;
    for (const k in w) sum += Math.max(0, w[k]);
    let x = rnd() * sum;
    for (const k in w) { x -= Math.max(0, w[k]); if (x <= 0) return k; }
    return 'gum';
}

// Flat icons for the HUD (inline SVG, no image files)
export const ICONS = {
    chicken: `<svg viewBox="0 0 64 64"><path d="M14 40c0-10 8-18 20-18 8 0 14 4 16 10l6 2-6 3c-1 9-9 15-19 15-10 0-17-5-17-12z" fill="#ffd23f" stroke="#7a5a00" stroke-width="2"/><circle cx="46" cy="26" r="8" fill="#ffd23f" stroke="#7a5a00" stroke-width="2"/><path d="M42 16l3-6 3 5 3-4 1 7z" fill="#e0303a"/><path d="M53 26l8 2-8 3z" fill="#ff8a1c"/><circle cx="47" cy="24" r="1.8" fill="#222"/><path d="M8 34l8 2-8 5 6 1-6 5" fill="none" stroke="#ff8a1c" stroke-width="3" stroke-linecap="round"/><path d="M24 36c4 4 10 4 14 0" fill="none" stroke="#c99a10" stroke-width="3" stroke-linecap="round"/></svg>`,
    tomato: `<svg viewBox="0 0 64 64"><circle cx="32" cy="36" r="20" fill="#e23b2e" stroke="#7a1810" stroke-width="2"/><ellipse cx="24" cy="30" rx="5" ry="3" fill="#ff8a78" opacity="0.8"/><path d="M32 18l-9-3 6 6-8 3 10 0-2 7 5-6 5 6-2-7 10 0-8-3 6-6-9 3-2-6z" fill="#3aa63a" stroke="#1d5c1d" stroke-width="1.5"/></svg>`,
    glove: `<svg viewBox="0 0 64 64"><path d="M16 28c0-10 8-16 18-16 11 0 18 7 18 17 0 8-5 13-11 15H24c-5-2-8-8-8-16z" fill="#e0303a" stroke="#6e1016" stroke-width="2"/><path d="M16 30c-4 0-7 3-7 7s3 6 7 6" fill="#e0303a" stroke="#6e1016" stroke-width="2"/><rect x="22" y="44" width="20" height="10" rx="3" fill="#f4efe6" stroke="#6e1016" stroke-width="2"/><path d="M30 18c6 0 11 3 12 8" fill="none" stroke="#ff8a8a" stroke-width="3" stroke-linecap="round"/></svg>`,
    gum: `<svg viewBox="0 0 64 64"><circle cx="34" cy="30" r="20" fill="#ff7ec8" stroke="#a02a70" stroke-width="2"/><ellipse cx="26" cy="22" rx="6" ry="4" fill="#fff" opacity="0.7"/><path d="M8 54c6-6 14-6 22-3s16 3 26-2" fill="none" stroke="#ff7ec8" stroke-width="5" stroke-linecap="round"/></svg>`,
    oil: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="50" rx="24" ry="8" fill="#1a1a22"/><path d="M32 8c8 12 14 20 14 28a14 14 0 0 1-28 0c0-8 6-16 14-28z" fill="#22222c" stroke="#000" stroke-width="2"/><path d="M26 30c2-4 5-8 6-10" fill="none" stroke="#8a7aff" stroke-width="3" stroke-linecap="round"/><path d="M14 50c6-2 10 2 16 0s12-2 18 0" fill="none" stroke="#39d0c0" stroke-width="2" opacity="0.8"/></svg>`,
    shield: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="rgba(90,220,255,0.25)" stroke="#5adcff" stroke-width="4"/><circle cx="32" cy="32" r="16" fill="none" stroke="#bff3ff" stroke-width="2" opacity="0.7"/><ellipse cx="23" cy="21" rx="7" ry="4" fill="#fff" opacity="0.75" transform="rotate(-30 23 21)"/></svg>`,
    mega: `<svg viewBox="0 0 64 64"><path d="M36 4L14 36h14l-4 24 26-36H34z" fill="#ffc400" stroke="#8a4a00" stroke-width="2.5" stroke-linejoin="round"/><path d="M34 12l-10 18" stroke="#fff6c0" stroke-width="3" stroke-linecap="round"/></svg>`,
};

// ============================================================
// Item boxes
// ============================================================
function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
const boxTex = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#ff4fa8'); gr.addColorStop(0.35, '#ffd23f'); gr.addColorStop(0.7, '#3fe0c8'); gr.addColorStop(1, '#7a6bff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.font = '900 86px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(40,10,60,0.7)'; g.strokeText('?', w / 2, h / 2 + 6);
    g.fillStyle = '#fff'; g.fillText('?', w / 2, h / 2 + 6);
});
const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, emissive: 0xffffff, emissiveMap: boxTex, emissiveIntensity: 0.9, transparent: true, opacity: 0.9, roughness: 0.2, metalness: 0.1 });
const boxGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 2.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const boxGlowGeo = new THREE.BoxGeometry(1.9, 1.9, 1.9);

export function buildItemBoxes(track) {
    const group = new THREE.Group();
    const boxes = track.itemSpots.map((s, n) => {
        const g = new THREE.Group();
        g.position.set(s.x, s.y + 1.4, s.z);
        const core = new THREE.Mesh(boxGeo, boxMat);
        core.castShadow = true;
        const glow = new THREE.Mesh(boxGlowGeo, boxGlowMat);
        g.add(core, glow);
        group.add(g);
        return { ...s, n, mesh: g, core, glow, hideT: 0, phase: n * 0.7 };
    });
    let t = 0;
    return {
        group, boxes,
        update(dt) {
            t += dt;
            for (const b of boxes) {
                if (b.hideT > 0) {
                    // Gone after a pickup, then pops back in over the last 0.4 s
                    b.hideT = Math.max(0, b.hideT - dt);
                    b.mesh.visible = b.hideT < 0.4;
                    b.mesh.scale.setScalar(Math.max(0.01, 1 - b.hideT / 0.4));
                } else {
                    b.mesh.visible = true;
                    b.mesh.scale.setScalar(1);
                }
                b.core.rotation.set(t * 0.9 + b.phase, t * 1.3 + b.phase, 0);
                b.glow.rotation.copy(b.core.rotation);
                b.mesh.position.y = b.y + 1.4 + Math.sin(t * 2.4 + b.phase) * 0.22;
            }
        },
    };
}

// ============================================================
// Weapon meshes
// ============================================================
const M = {
    chicken: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.45, emissive: 0x553300, emissiveIntensity: 0.3 }),
    comb: new THREE.MeshStandardMaterial({ color: 0xe0303a, roughness: 0.5 }),
    beak: new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: 0.5 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }),
    tomato: new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.25, metalness: 0.05 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3aa63a, roughness: 0.6 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xe0303a, roughness: 0.3, metalness: 0.05 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 }),
    spring: new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.2, metalness: 0.9 }),
    gum: new THREE.MeshStandardMaterial({ color: 0xff7ec8, roughness: 0.35, emissive: 0xff3da0, emissiveIntensity: 0.35 }),
    bubble: new THREE.MeshStandardMaterial({ color: 0xffb0e0, roughness: 0.1, transparent: true, opacity: 0.55, emissive: 0xff60c0, emissiveIntensity: 0.3 }),
    oil: new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
    sheen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.35, 1.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
};
const G = {
    body: new THREE.CapsuleGeometry(0.34, 0.7, 4, 10),
    head: new THREE.SphereGeometry(0.26, 12, 10),
    beak: new THREE.ConeGeometry(0.1, 0.3, 8),
    comb: new THREE.BoxGeometry(0.3, 0.2, 0.06),
    wing: new THREE.BoxGeometry(0.5, 0.06, 0.4),
    eye: new THREE.SphereGeometry(0.05, 6, 6),
    tomato: new THREE.SphereGeometry(0.42, 16, 12),
    leaf: new THREE.ConeGeometry(0.2, 0.12, 5),
    glove: new THREE.SphereGeometry(0.6, 14, 12),
    thumb: new THREE.SphereGeometry(0.26, 10, 8),
    cuff: new THREE.CylinderGeometry(0.42, 0.45, 0.35, 14),
    spring: new THREE.TorusGeometry(0.25, 0.05, 6, 14),
    gum: new THREE.SphereGeometry(1, 16, 10),
    oil: new THREE.CircleGeometry(1, 24),
};

function chickenMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(G.body, M.chicken);
    body.rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(G.head, M.chicken);
    head.position.set(0.65, 0.25, 0);
    const beak = new THREE.Mesh(G.beak, M.beak);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.95, 0.22, 0);
    const comb = new THREE.Mesh(G.comb, M.comb);
    comb.position.set(0.62, 0.52, 0);
    g.add(body, head, beak, comb);
    for (const s of [1, -1]) {
        const eye = new THREE.Mesh(G.eye, M.eye);
        eye.position.set(0.8, 0.33, s * 0.15);
        g.add(eye);
        const wing = new THREE.Mesh(G.wing, M.chicken);
        wing.position.set(0, 0.1, s * 0.38);
        g.add(wing);
        g.userData[s > 0 ? 'wingR' : 'wingL'] = wing;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), M.beak);
        leg.position.set(-0.35, -0.3, s * 0.12);
        leg.rotation.z = 1.1;
        g.add(leg);
    }
    g.scale.setScalar(1.25);
    return g;
}
function tomatoMesh() {
    const g = new THREE.Group();
    const t = new THREE.Mesh(G.tomato, M.tomato);
    t.scale.y = 0.85;
    const leaf = new THREE.Mesh(G.leaf, M.leaf);
    leaf.position.y = 0.36;
    g.add(t, leaf);
    return g;
}
function gloveMesh() {
    const g = new THREE.Group();
    const fist = new THREE.Mesh(G.glove, M.glove);
    fist.scale.set(1, 0.9, 0.95);
    const thumb = new THREE.Mesh(G.thumb, M.glove);
    thumb.position.set(0.1, 0.1, 0.5);
    const cuff = new THREE.Mesh(G.cuff, M.cuff);
    cuff.rotation.z = Math.PI / 2;
    cuff.position.x = -0.55;
    g.add(fist, thumb, cuff);
    const springs = new THREE.Group();
    for (let i = 0; i < 10; i++) {
        const c = new THREE.Mesh(G.spring, M.spring);
        c.rotation.y = Math.PI / 2;
        c.position.x = -0.8 - i * 0.3;
        springs.add(c);
    }
    g.add(springs);
    g.userData.springs = springs;
    return g;
}
function gumMesh() {
    const g = new THREE.Group();
    const blob = new THREE.Mesh(G.gum, M.gum);
    blob.scale.set(1.9, 0.22, 1.6);
    const bubble = new THREE.Mesh(G.gum, M.bubble);
    bubble.position.y = 0.5;
    bubble.scale.setScalar(0.7);
    g.add(blob, bubble);
    g.userData.bubble = bubble;
    return g;
}
function oilMesh() {
    const g = new THREE.Group();
    const puddle = new THREE.Mesh(G.oil, M.oil);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.set(2.4, 1.8, 1);
    puddle.position.y = 0.03;
    const sheen = new THREE.Mesh(G.oil, M.sheen);
    sheen.rotation.x = -Math.PI / 2;
    sheen.scale.set(1.3, 0.8, 1);
    sheen.position.set(0.3, 0.04, 0.2);
    g.add(puddle, sheen);
    g.userData.sheen = sheen;
    return g;
}
const BUILDERS = { chicken: chickenMesh, tomato: tomatoMesh, glove: gloveMesh, gum: gumMesh, oil: oilMesh };

// ============================================================
// Projectiles: chicken missile, tomato, boxing glove
// ============================================================
export const CHICKEN_SPEED = 64;
export const GLOVE_TIME = 0.55;
export const GLOVE_REACH = 8.5;

// Build the local projectile from a fire event: { id, k, o, x, y, z, h, sp, tgt, back }
export function spawnProjectile(msg, track) {
    const p = {
        id: msg.id, k: msg.k, o: msg.o, x: msg.x, y: msg.y, z: msg.z, h: msg.h, back: !!msg.back,
        tgt: msg.tgt || null, age: 0, idx: -1, vy: 0, dead: false,
        sp: msg.sp || 0, mesh: BUILDERS[msg.k] ? BUILDERS[msg.k]() : null,
    };
    const q = track.project(p.x, p.z, null, p.y);
    p.idx = q.i;
    if (p.k === 'tomato') p.vy = 4;
    return p;
}

// Advance one projectile; returns false once it's done. `racers` is the id -> racer map.
export function stepProjectile(p, dt, track, racers) {
    p.age += dt;
    if (p.k === 'chicken') return stepChicken(p, dt, track, racers);
    if (p.k === 'tomato') return stepTomato(p, dt, track);
    if (p.k === 'glove') return stepGlove(p, dt, racers);
    return false;
}

function stepChicken(p, dt, track, racers) {
    const q = track.project(p.x, p.z, p.idx, p.y);
    p.idx = q.i;
    const T = p.tgt ? racers.get(p.tgt) : null;
    let aimX, aimZ, homing = false;
    const dir = p.back ? -1 : 1;
    if (T && !T.fin) {
        const d = Math.hypot(T.x - p.x, T.z - p.z);
        if (d < 24 && Math.abs((T.y || 0) - p.y) < 4) { aimX = T.x; aimZ = T.z; homing = true; }
        else {
            const a = track.pointAhead(p.idx, dir * 14, clamp(T.lat != null ? T.lat : q.lat, -6, 6) * 0.6);
            aimX = a.x; aimZ = a.z;
        }
    } else {
        const a = track.pointAhead(p.idx, dir * 14, q.lat * 0.7);
        aimX = a.x; aimZ = a.z;
    }
    const want = Math.atan2(aimZ - p.z, aimX - p.x);
    const rate = homing ? 7 : 4.5;
    p.h += clamp(angleDiff(p.h, want), -rate * dt, rate * dt);
    const sp = CHICKEN_SPEED;
    p.x += Math.cos(p.h) * sp * dt;
    p.z += Math.sin(p.h) * sp * dt;
    // Stay between the barriers
    const q2 = track.project(p.x, p.z, p.idx, p.y);
    const lim = track.halfWidth + track.runoff - 0.8;
    if (Math.abs(q2.lat) > lim) {
        const s = Math.sign(q2.lat), over = Math.abs(q2.lat) - lim;
        p.x -= q2.nx * s * over;
        p.z -= q2.nz * s * over;
    }
    p.y = (q2.y || 0) + 1.1 + Math.sin(p.age * 12) * 0.15;
    if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.rotation.set(0, -p.h, Math.sin(p.age * 20) * 0.08);
        const f = Math.sin(p.age * 34) * 0.9;
        p.mesh.userData.wingR.rotation.x = f;
        p.mesh.userData.wingL.rotation.x = -f;
    }
    return p.age < 7;
}

function stepTomato(p, dt, track) {
    const vx = Math.cos(p.h) * p.sp, vz = Math.sin(p.h) * p.sp;
    p.x += vx * dt;
    p.z += vz * dt;
    p.vy -= 9 * dt;
    p.y += p.vy * dt;
    const q = track.project(p.x, p.z, p.idx, p.y);
    p.idx = q.i;
    const ground = (q.y || 0) + 0.45;
    if (p.y < ground) { p.y = ground; p.vy = Math.abs(p.vy) * 0.45; }
    if (Math.abs(q.lat) > track.halfWidth + track.runoff - 0.4) { p.splat = true; return false; }
    if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.rotation.x += dt * 9;
        p.mesh.rotation.y = -p.h;
    }
    return p.age < 1.7;
}

// The glove is fixed to its owner: it springs out in front (or behind) and comes back
export function gloveTip(p, owner) {
    const t = clamp(p.age / GLOVE_TIME, 0, 1);
    const ext = Math.sin(Math.PI * Math.min(1, t * 1.25)) * GLOVE_REACH * (t < 0.8 ? 1 : 1 - (t - 0.8) * 2);
    const dir = p.back ? -1 : 1;
    const h = owner.h + (p.back ? Math.PI : 0);
    const base = owner.cfg.radius + 0.8;
    return { x: owner.x + Math.cos(owner.h) * dir * (base + ext), z: owner.z + Math.sin(owner.h) * dir * (base + ext), y: (owner.y || 0) + 1.0, ext, h };
}
function stepGlove(p, dt, racers) {
    const o = racers.get(p.o);
    if (!o) return false;
    const tip = gloveTip(p, o);
    p.x = tip.x; p.z = tip.z; p.y = tip.y; p.ext = tip.ext;
    if (p.mesh) {
        p.mesh.position.set(tip.x, tip.y, tip.z);
        p.mesh.rotation.set(0, -tip.h, 0);
        const sp = p.mesh.userData.springs;
        const len = Math.max(0.2, tip.ext + 0.4);
        sp.scale.x = len / 3;
    }
    return p.age < GLOVE_TIME;
}

// ============================================================
// Traps: bubble gum and oil
// ============================================================
export const TRAP_ARM_TIME = 0.8;   // the dropper can't trigger their own trap straight away
export const TRAP_LIFE = 45;

// { id, k, o, x, y, z, fx, fy, fz } where (fx, fy, fz) is where it was thrown from
export function spawnTrap(msg) {
    const t = { ...msg, age: 0, mesh: BUILDERS[msg.k] ? BUILDERS[msg.k]() : null, landed: false };
    if (t.mesh) t.mesh.position.set(msg.fx ?? msg.x, (msg.fy ?? msg.y) + 1, msg.fz ?? msg.z);
    return t;
}
export function stepTrap(t, dt) {
    t.age += dt;
    const flight = 0.45;
    if (t.mesh) {
        if (t.age < flight) {
            const k = t.age / flight;
            const fx = t.fx ?? t.x, fy = t.fy ?? t.y, fz = t.fz ?? t.z;
            t.mesh.position.set(fx + (t.x - fx) * k, fy + (t.y - fy) * k + Math.sin(Math.PI * k) * 2.5 + 0.5 * (1 - k), fz + (t.z - fz) * k);
            t.mesh.scale.setScalar(0.5 + k * 0.5);
        } else {
            t.landed = true;
            t.mesh.position.set(t.x, t.y + 0.02, t.z);
            t.mesh.scale.setScalar(1);
            if (t.mesh.userData.bubble) {
                const b = 0.55 + Math.abs(Math.sin(t.age * 1.6)) * 0.35;
                t.mesh.userData.bubble.scale.setScalar(b);
                t.mesh.userData.bubble.position.y = 0.2 + b * 0.5;
            }
            if (t.mesh.userData.sheen) t.mesh.userData.sheen.rotation.z = t.age * 0.4;
        }
    }
    return t.age < TRAP_LIFE;
}
export const trapRadius = k => (k === 'oil' ? 2.3 : 1.9);
