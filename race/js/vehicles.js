// The six rides: their stats, their low-poly models, arcade driving physics and side attacks.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ATK_TIME = 0.45; // seconds an attack animation lasts

export const VEHICLES = [
    {
        id: 'bubble', kind: 'car', shape: 'bubble', name: 'Bubble',
        desc: 'Tiny hatchback. Turns on a coin and slams doors with gusto.',
        top: 39, accel: 23, grip: 7.5, turn: 2.5, mass: 1.0, radius: 1.3,
        attack: { name: 'Door Slam', word: 'BONK!', sound: 'bonk', force: 15, range: 4.2, cd: 2.4 },
    },
    {
        id: 'brick', kind: 'car', shape: 'van', name: 'The Brick',
        desc: 'A delivery van. Slow to get going, devastating side door.',
        top: 38, accel: 17, grip: 6.5, turn: 2.0, mass: 1.7, radius: 1.5,
        attack: { name: 'Sliding Door', word: 'WHAM!', sound: 'bonk', force: 22, range: 4.6, cd: 3.0 },
    },
    {
        id: 'rocket', kind: 'car', shape: 'sport', name: 'Rocket',
        desc: 'Low, loud and slidey. Gullwing doors, zero manners.',
        top: 44, accel: 21, grip: 4.8, turn: 2.2, mass: 1.15, radius: 1.4,
        attack: { name: 'Gullwing Smack', word: 'SMACK!', sound: 'bonk', force: 14, range: 4.2, cd: 2.6 },
    },
    {
        id: 'moped', kind: 'bike', shape: 'moped', name: 'Le Moped',
        desc: 'Zippy scooter. The rider is armed with a day-old baguette.',
        top: 36, accel: 28, grip: 7.5, turn: 2.8, mass: 0.6, radius: 0.9,
        attack: { name: 'Baguette Whack', word: 'BAGUETTED!', sound: 'whack', force: 12, range: 4.0, cd: 1.8 },
    },
    {
        id: 'dirt', kind: 'bike', shape: 'dirt', name: 'Dirt Bike',
        desc: 'Light and balanced. Settles arguments with a flying kick.',
        top: 41, accel: 25, grip: 6.2, turn: 2.6, mass: 0.7, radius: 0.9,
        attack: { name: 'Flying Kick', word: 'HI-YA!', sound: 'kick', force: 14, range: 3.6, cd: 2.0 },
    },
    {
        id: 'chopper', kind: 'bike', shape: 'chopper', name: 'Chopper',
        desc: 'Big cruiser, bigger attitude. Swings a rubber chicken.',
        top: 43, accel: 20, grip: 5.2, turn: 2.2, mass: 0.95, radius: 1.0,
        attack: { name: 'Rubber Chicken', word: 'SQUAWK!', sound: 'squawk', force: 13, range: 4.8, cd: 2.2 },
    },
];
export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map(v => [v.id, v]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// Models
// ============================================================
const MAT = {
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.85 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.3, metalness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.2, metalness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.7 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 }),
    jeans: new THREE.MeshStandardMaterial({ color: 0x33415c, roughness: 0.8 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 0.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 0.5 }),
    bread: new THREE.MeshStandardMaterial({ color: 0xd9a35b, roughness: 0.8 }),
    crust: new THREE.MeshStandardMaterial({ color: 0x9c6a2e, roughness: 0.8 }),
    chicken: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 }),
    comb: new THREE.MeshStandardMaterial({ color: 0xe0303a, roughness: 0.5 }),
    beak: new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: 0.5 }),
    star: new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc400, emissiveIntensity: 0.9 }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
}

export function buildVehicleModel(cfg, color) {
    const root = new THREE.Group();   // position and heading
    const body = new THREE.Group();   // lean / roll
    root.add(body);
    const m = { root, body, kind: cfg.kind, wheels: [], front: [], doors: {}, weapon: null, legs: null, starY: 2.4 };
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.12 });
    if (cfg.kind === 'car') buildCar(cfg, m, paint);
    else buildBike(cfg, m, paint);

    // Dizzy stars shown while stunned
    const stars = new THREE.Group();
    const starGeo = new THREE.OctahedronGeometry(0.16, 0);
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        stars.add(mesh(starGeo, MAT.star, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6));
    }
    stars.position.y = m.starY;
    stars.visible = false;
    body.add(stars);
    m.stars = stars;

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return m;
}

const CARS = {
    bubble: { L: 3.0, W: 1.75, H: 0.8, cabL: 1.8, cabH: 0.78, cabX: -0.15, wr: 0.4, hinge: 0.72 },
    van: { L: 4.0, W: 1.95, H: 1.55, cabL: 0, cabH: 0, cabX: 0, wr: 0.44, hinge: 1.1 },
    sport: { L: 4.1, W: 1.95, H: 0.58, cabL: 1.7, cabH: 0.55, cabX: -0.35, wr: 0.42, hinge: 0.5 },
};

function buildCar(cfg, m, paint) {
    const d = CARS[cfg.shape];
    const base = d.wr * 0.85;
    const top = base + d.H;
    m.body.add(mesh(new RoundedBoxGeometry(d.L, d.H, d.W, 3, cfg.shape === 'van' ? 0.22 : 0.26), paint, 0, base + d.H / 2, 0));

    if (cfg.shape === 'van') {
        m.body.add(mesh(new RoundedBoxGeometry(0.12, 0.62, d.W * 0.86, 2, 0.05), MAT.glass, d.L / 2 - 0.02, top - 0.45, 0));
        m.body.add(mesh(new THREE.BoxGeometry(2.4, 0.08, d.W * 0.8), MAT.dark, -0.5, top + 0.1, 0));
        m.body.add(mesh(new THREE.SphereGeometry(0.24, 14, 10), MAT.skin, 1.35, top - 0.5, -0.4));
        m.starY = top + 0.8;
    } else {
        m.body.add(mesh(new RoundedBoxGeometry(d.cabL, d.cabH, d.W * 0.84, 3, 0.2), MAT.glass, d.cabX, top + d.cabH / 2 - 0.1, 0));
        m.body.add(mesh(new RoundedBoxGeometry(d.cabL * 0.72, 0.1, d.W * 0.8, 2, 0.04), paint, d.cabX - 0.05, top + d.cabH - 0.12, 0));
        // Driver, visible through the glass
        m.body.add(mesh(new THREE.SphereGeometry(0.24, 14, 10), MAT.skin, d.cabX + 0.15, top + 0.2, -0.35));
        m.body.add(mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), paint, d.cabX + 0.13, top + 0.26, -0.35));
        m.starY = top + d.cabH + 0.6;
    }
    if (cfg.shape === 'sport') {
        for (const s of [1, -1]) m.body.add(mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), MAT.dark, -d.L / 2 + 0.3, top + 0.15, s * 0.6));
        m.body.add(mesh(new RoundedBoxGeometry(0.5, 0.08, d.W, 2, 0.03), paint, -d.L / 2 + 0.28, top + 0.34, 0));
    }
    for (const s of [1, -1]) {
        m.body.add(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.34), MAT.head, d.L / 2 + 0.01, base + d.H * 0.6, s * (d.W / 2 - 0.35)));
        m.body.add(mesh(new THREE.BoxGeometry(0.06, 0.14, 0.34), MAT.tail, -d.L / 2 - 0.01, base + d.H * 0.6, s * (d.W / 2 - 0.35)));
    }

    const wx = d.L / 2 - d.wr - 0.25, wz = d.W / 2 - 0.12;
    const tireGeo = new THREE.CylinderGeometry(d.wr, d.wr, 0.34, 20);
    const hubGeo = new THREE.CylinderGeometry(d.wr * 0.55, d.wr * 0.55, 0.36, 10);
    for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, d.wr, z);
        const spin = new THREE.Group();
        const tire = mesh(tireGeo, MAT.tire);
        tire.rotation.x = Math.PI / 2;
        const hub = mesh(hubGeo, MAT.hub);
        hub.rotation.x = Math.PI / 2;
        spin.add(tire, hub);
        pivot.add(spin);
        m.root.add(pivot);
        m.wheels.push(spin);
        if (x > 0) m.front.push(pivot);
    }

    // Doors hinge at their front edge so they swing outwards into whoever is alongside
    const doorL = cfg.shape === 'van' ? 1.3 : 1.05;
    const doorH = cfg.shape === 'van' ? 1.15 : d.H * 0.8;
    for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(d.hinge, base + d.H * 0.52, s * (d.W / 2 + 0.03));
        pivot.add(mesh(new RoundedBoxGeometry(doorL, doorH, 0.08, 2, 0.03), paint, -doorL / 2, 0, 0));
        pivot.add(mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), MAT.chrome, -doorL + 0.25, 0.1, s * 0.05));
        m.body.add(pivot);
        m.doors[s] = pivot;
    }
}

const BIKES = {
    moped: { wr: 0.34, wb: 1.35, seat: 0.92, riderX: -0.2 },
    dirt: { wr: 0.46, wb: 1.65, seat: 1.18, riderX: -0.05 },
    chopper: { wr: 0.45, wb: 2.25, seat: 0.9, riderX: -0.45 },
};

function buildBike(cfg, m, paint) {
    const d = BIKES[cfg.shape];
    for (const x of [d.wb / 2, -d.wb / 2]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, d.wr, 0);
        const spin = new THREE.Group();
        spin.add(mesh(new THREE.TorusGeometry(d.wr - 0.09, 0.1, 10, 26), MAT.tire));
        spin.add(mesh(new THREE.TorusGeometry(d.wr - 0.2, 0.03, 6, 20), MAT.hub));
        for (const a of [0, Math.PI / 2]) {
            const spoke = mesh(new THREE.BoxGeometry((d.wr - 0.2) * 2, 0.04, 0.04), MAT.hub);
            spoke.rotation.z = a;
            spin.add(spoke);
        }
        pivot.add(spin);
        m.body.add(pivot);
        m.wheels.push(spin);
        if (x > 0) m.front.push(pivot);
    }

    const bar = (x, y) => {
        const b = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.78, 8), MAT.dark, x, y, 0);
        b.rotation.x = Math.PI / 2;
        m.body.add(b);
    };
    if (cfg.shape === 'moped') {
        m.body.add(mesh(new RoundedBoxGeometry(1.05, 0.42, 0.52, 3, 0.16), paint, -0.2, d.wr + 0.22, 0));
        const shield = mesh(new RoundedBoxGeometry(0.18, 0.95, 0.56, 3, 0.07), paint, 0.42, d.wr + 0.5, 0);
        shield.rotation.z = 0.25;
        m.body.add(shield);
        m.body.add(mesh(new RoundedBoxGeometry(0.75, 0.14, 0.4, 2, 0.06), MAT.cream, -0.25, d.seat - 0.12, 0));
        m.body.add(mesh(new THREE.BoxGeometry(0.6, 0.06, 0.5), MAT.dark, 0.1, d.wr + 0.02, 0));
        m.body.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), MAT.head, 0.56, d.wr + 0.92, 0));
        bar(0.5, d.wr + 1.02);
    } else if (cfg.shape === 'dirt') {
        const frame = mesh(new RoundedBoxGeometry(1.25, 0.3, 0.3, 2, 0.1), paint, 0, d.wr + 0.42, 0);
        frame.rotation.z = 0.12;
        m.body.add(frame);
        m.body.add(mesh(new RoundedBoxGeometry(0.55, 0.32, 0.42, 3, 0.12), paint, 0.3, d.wr + 0.66, 0));
        m.body.add(mesh(new RoundedBoxGeometry(0.8, 0.12, 0.3, 2, 0.05), MAT.dark, -0.25, d.seat - 0.1, 0));
        for (const s of [1, -1]) {
            const fork = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 8), MAT.chrome, d.wb / 2 - 0.15, d.wr + 0.5, s * 0.12);
            fork.rotation.z = 0.3;
            m.body.add(fork);
        }
        m.body.add(mesh(new THREE.BoxGeometry(0.55, 0.06, 0.3), paint, d.wb / 2, d.wr * 2 + 0.06, 0));
        m.body.add(mesh(new THREE.BoxGeometry(0.05, 0.3, 0.32), MAT.cream, d.wb / 2 - 0.12, d.wr + 1.0, 0));
        bar(d.wb / 2 - 0.3, d.wr + 1.1);
    } else {
        m.body.add(mesh(new RoundedBoxGeometry(1.7, 0.28, 0.32, 2, 0.1), MAT.dark, -0.15, d.wr + 0.2, 0));
        const tank = mesh(new THREE.SphereGeometry(1, 16, 12), paint, 0.2, d.wr + 0.58, 0);
        tank.scale.set(0.55, 0.28, 0.3);
        m.body.add(tank);
        m.body.add(mesh(new RoundedBoxGeometry(0.5, 0.42, 0.42, 2, 0.08), MAT.chrome, 0, d.wr + 0.2, 0));
        m.body.add(mesh(new RoundedBoxGeometry(0.7, 0.12, 0.42, 2, 0.05), MAT.dark, -0.45, d.seat - 0.08, 0));
        for (const s of [1, -1]) {
            const fork = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.55, 8), MAT.chrome, d.wb / 2 - 0.4, d.wr + 0.68, s * 0.12);
            fork.rotation.z = 0.55;
            m.body.add(fork);
            const pipe = mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 8), MAT.chrome, -0.5, d.wr - 0.05 + (s > 0 ? 0.1 : 0), 0.26);
            pipe.rotation.z = Math.PI / 2;
            if (s > 0) m.body.add(pipe);
        }
        for (const s of [1, -1]) m.body.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), MAT.chrome, d.wb / 2 - 0.72, d.wr + 1.35, s * 0.36));
        bar(d.wb / 2 - 0.72, d.wr + 1.6);
    }
    addRider(cfg, m, paint, d);
    m.starY = d.seat + 1.55;
}

function addRider(cfg, m, paint, d) {
    const rider = new THREE.Group();
    rider.position.set(d.riderX, d.seat, 0);
    m.body.add(rider);

    const legGeo = new THREE.CapsuleGeometry(0.11, 0.55, 4, 8);
    m.legs = {};
    for (const s of [1, -1]) {
        const hip = new THREE.Group();
        hip.position.set(0.05, 0.05, s * 0.17);
        const leg = mesh(legGeo, MAT.jeans, 0.15, -0.3, 0);
        leg.rotation.z = 0.55;
        hip.add(leg, mesh(new THREE.BoxGeometry(0.28, 0.12, 0.14), MAT.dark, 0.36, -0.58, 0));
        rider.add(hip);
        m.legs[s] = hip;
    }
    const torso = mesh(new THREE.CapsuleGeometry(0.24, 0.42, 4, 10), paint, 0.12, 0.45, 0);
    torso.rotation.z = -0.35;
    rider.add(torso);
    rider.add(mesh(new THREE.SphereGeometry(0.19, 14, 10), MAT.skin, 0.3, 0.98, 0));
    rider.add(mesh(new THREE.SphereGeometry(0.235, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), paint, 0.28, 1.0, 0));
    rider.add(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), MAT.dark, 0.47, 0.99, 0));
    for (const s of [1, -1]) {
        const arm = mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8), paint, 0.42, 0.62, s * 0.24);
        arm.rotation.z = -1.15;
        rider.add(arm);
    }

    if (cfg.shape === 'dirt') return; // the dirt bike kicks instead
    const pivot = new THREE.Group();
    pivot.position.set(0.15, 0.72, 0);
    const holder = new THREE.Group();
    holder.rotation.z = 0.55; // held up and back while resting
    pivot.add(holder);
    if (cfg.shape === 'moped') {
        holder.add(mesh(new THREE.CapsuleGeometry(0.085, 1.15, 4, 10), MAT.bread, 0, 0.72, 0));
        for (let i = 0; i < 4; i++) {
            const slash = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.12), MAT.crust, 0.07, 0.35 + i * 0.25, 0);
            slash.rotation.y = 0.6;
            holder.add(slash);
        }
    } else {
        holder.add(mesh(new THREE.CapsuleGeometry(0.12, 0.62, 4, 10), MAT.chicken, 0, 0.55, 0));
        holder.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), MAT.chicken, 0, 1.02, 0));
        holder.add(mesh(new THREE.BoxGeometry(0.06, 0.14, 0.04), MAT.comb, 0, 1.17, 0));
        const beak = mesh(new THREE.ConeGeometry(0.05, 0.16, 8), MAT.beak, 0.14, 1.02, 0);
        beak.rotation.z = -Math.PI / 2;
        holder.add(beak);
        for (const s of [1, -1]) holder.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), MAT.beak, 0, 0.1, s * 0.06));
    }
    rider.add(pivot);
    m.weapon = pivot;
}

export function animateModel(m, r, dt) {
    m.root.position.set(r.x, 0, r.z);
    m.root.rotation.y = -r.h;
    m.body.rotation.x = r.lean || 0;
    for (const w of m.wheels) w.rotation.z = -r.wheelSpin;
    for (const f of m.front) f.rotation.y = -r.steer * 0.42;

    const k = r.atkT > 0 ? Math.sin(Math.PI * (1 - r.atkT / ATK_TIME)) : 0;
    const s = r.atkSide || 1;
    if (m.kind === 'car') {
        for (const side of [1, -1]) m.doors[side].rotation.y = side === s ? side * k * 1.25 : 0;
    } else if (m.weapon) {
        m.weapon.rotation.x = s * k * 1.9;
    } else if (m.legs) {
        for (const side of [1, -1]) m.legs[side].rotation.x = side === s ? -side * k * 1.5 : 0;
    }
    m.stars.visible = r.stunT > 0;
    if (m.stars.visible) m.stars.rotation.y += dt * 6;
}

// ============================================================
// Physics
// ============================================================
// Arcade handling: throttle sets a forward speed, and the actual velocity is pulled toward
// "forward x speed" by the grip. Low grip means more slide, and knockback shoves you sideways.
export function stepPhysics(r, input, dt, track, others) {
    const c = r.cfg;
    let { steer, throttle } = input;
    if (r.stunT > 0) {
        r.stunT = Math.max(0, r.stunT - dt);
        steer *= 0.25;
        throttle *= 0.3;
    }
    if (r.spin) {
        r.h += r.spin * dt;
        r.spin *= Math.exp(-2.5 * dt);
        if (Math.abs(r.spin) < 0.05) r.spin = 0;
    }
    const ev = { boost: false, bump: 0 };
    const p = track.project(r.x, r.z, r.idx);
    const offroad = Math.abs(p.lat) > track.halfWidth + 0.8;
    if (r.boostT > 0) r.boostT = Math.max(0, r.boostT - dt);
    const top = c.top * (offroad ? 0.55 : 1) * (r.boostT > 0 ? 1.3 : 1) * (r.catchup || 1);

    if (throttle > 0) {
        if (r.speed < top) r.speed += c.accel * throttle * dt * (r.boostT > 0 ? 1.8 : 1);
    } else if (throttle < 0) {
        if (r.speed > 0.5) r.speed -= 34 * -throttle * dt;
        else r.speed = Math.max(-11, r.speed - c.accel * 0.6 * -throttle * dt);
    }
    if (r.speed > top) r.speed -= (r.speed - top) * 2.2 * dt;
    r.speed -= r.speed * (throttle === 0 ? 0.35 : 0.06) * dt;
    if (offroad) r.speed -= r.speed * 0.9 * dt;

    r.steer += (steer - r.steer) * (1 - Math.exp(-10 * dt));
    const sp = Math.abs(r.speed);
    const turn = c.turn * r.steer * clamp(r.speed / 7, -1, 1) * (1 - 0.35 * clamp(sp / c.top, 0, 1));
    r.h += turn * dt;

    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    const k = 1 - Math.exp(-c.grip * dt * (r.stunT > 0 ? 0.35 : 1));
    r.vx += (fx * r.speed - r.vx) * k;
    r.vz += (fz * r.speed - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;

    // Bump into other vehicles (we only ever move ourselves; they move themselves)
    for (const o of others) {
        const dx = r.x - o.x, dz = r.z - o.z, d = Math.hypot(dx, dz);
        const min = c.radius + o.cfg.radius;
        if (d > 0.001 && d < min) {
            const nx = dx / d, nz = dz / d, push = min - d;
            r.x += nx * push * 0.55;
            r.z += nz * push * 0.55;
            const rel = (r.vx - (o.vx || 0)) * nx + (r.vz - (o.vz || 0)) * nz;
            if (rel < 0) {
                const imp = -rel * 1.8 * (o.cfg.mass / (c.mass + o.cfg.mass));
                r.vx += nx * imp;
                r.vz += nz * imp;
                ev.bump = Math.max(ev.bump, -rel);
            }
        }
    }

    // Barriers
    const q = track.project(r.x, r.z, p.i);
    const lim = track.halfWidth + track.runoff - c.radius * 0.6;
    if (Math.abs(q.lat) > lim) {
        const s = Math.sign(q.lat), over = Math.abs(q.lat) - lim;
        r.x -= q.nx * s * over;
        r.z -= q.nz * s * over;
        const vn = (r.vx * q.nx + r.vz * q.nz) * s;
        if (vn > 0) {
            r.vx -= q.nx * s * vn * 1.6;
            r.vz -= q.nz * s * vn * 1.6;
            r.speed *= 0.8;
            ev.bump = Math.max(ev.bump, vn);
        }
    }

    const f = track.project(r.x, r.z, q.i);
    r.idx = f.i;
    r.dist = f.dist;
    r.lat = f.lat;
    r.fwdDot = r.vx * f.tx + r.vz * f.tz;

    for (const pad of track.pads) {
        let dd = Math.abs(f.dist - pad.dist);
        dd = Math.min(dd, track.total - dd);
        if (dd < 2.6 && Math.abs(f.lat - pad.lat) < 2.6) {
            if (r.boostT < 0.9) ev.boost = true;
            r.boostT = 1.3;
        }
    }

    const sf = clamp(sp / c.top, 0, 1);
    r.lean = c.kind === 'bike' ? r.steer * sf * 0.5 : -r.steer * sf * 0.06;
    r.wheelSpin += (r.speed * dt) / 0.42;
    return ev;
}

// Who is alongside us? Returns the closest rival within reach on either side.
export function findAttackTarget(r, others) {
    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    const rx = -fz, rz = fx; // +side is to the right of the direction of travel
    let best = null, bestScore = Infinity, side = 0;
    for (const o of others) {
        const dx = o.x - r.x, dz = o.z - r.z;
        const along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
        if (Math.abs(along) < 3.4 && Math.abs(lat) < r.cfg.attack.range + o.cfg.radius && Math.abs(lat) > 0.3) {
            const score = Math.abs(lat) + Math.abs(along) * 0.3;
            if (score < bestScore) { bestScore = score; best = o; side = Math.sign(lat); }
        }
    }
    return { target: best, side: best ? side : (Math.random() < 0.5 ? -1 : 1) };
}
