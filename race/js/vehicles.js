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
    // --- Trucks ---
    {
        id: 'monster', kind: 'truck', shape: 'monster', name: 'Monster',
        desc: 'Monster truck. Slow off the mark but crushes everything in its path.',
        top: 42, accel: 14, grip: 5.5, turn: 1.7, mass: 2.4, radius: 1.8,
        attack: { name: 'Fender Crush', word: 'CRUSHED!', sound: 'bonk', force: 28, range: 5.0, cd: 3.5 },
    },
    {
        id: 'rig', kind: 'truck', shape: 'rig', name: 'The Rig',
        desc: 'Semi truck cab. Like steering a building, but what a building.',
        top: 40, accel: 12, grip: 4.8, turn: 1.5, mass: 2.8, radius: 2.0,
        attack: { name: 'Air Horn Blast', word: 'HOOOONK!', sound: 'horn', force: 25, range: 5.5, cd: 4.0 },
    },
    // --- Karts ---
    {
        id: 'zippy', kind: 'kart', shape: 'gokart', name: 'Zippy',
        desc: 'Tiny go-kart. Handles like a dream, hits like a pillow.',
        top: 37, accel: 26, grip: 8.5, turn: 2.9, mass: 0.5, radius: 0.85,
        attack: { name: 'Steering Wheel Slap', word: 'SLAP!', sound: 'whack', force: 8, range: 3.2, cd: 1.6 },
    },
    {
        id: 'bumper', kind: 'kart', shape: 'bumpercar', name: 'Bumper',
        desc: 'Bumper car. Born to collide. Surprisingly fast.',
        top: 35, accel: 24, grip: 7.8, turn: 3.0, mass: 0.65, radius: 1.0,
        attack: { name: 'Bumper Bash', word: 'BUMP!', sound: 'bump', force: 10, range: 3.5, cd: 1.4 },
    },
    // --- ATVs ---
    {
        id: 'mudrunner', kind: 'atv', shape: 'quad', name: 'Mud Runner',
        desc: 'Quad bike. Barely notices grass and gravel. Rider has a shovel.',
        top: 38, accel: 22, grip: 6.8, turn: 2.4, mass: 1.1, radius: 1.2,
        attack: { name: 'Shovel Swing', word: 'DUG!', sound: 'bonk', force: 16, range: 4.0, cd: 2.2 },
        offroad: 0.78,
    },
    {
        id: 'dunebug', kind: 'atv', shape: 'buggy', name: 'Dune Bug',
        desc: 'Open-top buggy. Eats sand for breakfast. Passenger throws coconuts.',
        top: 40, accel: 20, grip: 6.0, turn: 2.3, mass: 1.0, radius: 1.3,
        attack: { name: 'Coconut Toss', word: 'BONK!', sound: 'bonk', force: 14, range: 4.5, cd: 2.0 },
        offroad: 0.72,
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
    const m = { root, body, kind: cfg.kind, cfg, wheels: [], front: [], doors: {}, weapon: null, legs: null, starY: 2.4, paintMat: null, _hat: null };
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.12 });
    m.paintMat = paint;
    if (cfg.kind === 'car') buildCar(cfg, m, paint);
    else if (cfg.kind === 'truck') buildTruck(cfg, m, paint);
    else if (cfg.kind === 'kart') buildKart(cfg, m, paint);
    else if (cfg.kind === 'atv') buildAtv(cfg, m, paint);
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

// ============================================================
// Truck models
// ============================================================
const TRUCKS = {
    monster: { L: 4.5, W: 2.3, H: 1.1, cabL: 1.6, cabH: 0.9, cabX: 0.6, wr: 0.7, hinge: 0.9, lift: 0.35 },
    rig: { L: 5.0, W: 2.4, H: 2.2, cabL: 0, cabH: 0, cabX: 0, wr: 0.55, hinge: 1.3, lift: 0 },
};

function buildTruck(cfg, m, paint) {
    const d = TRUCKS[cfg.shape];
    const base = d.wr * 0.85 + d.lift;
    const top = base + d.H;
    m.body.add(mesh(new RoundedBoxGeometry(d.L, d.H, d.W, 3, 0.2), paint, 0, base + d.H / 2, 0));

    if (cfg.shape === 'monster') {
        // Cab with glass
        m.body.add(mesh(new RoundedBoxGeometry(d.cabL, d.cabH, d.W * 0.85, 3, 0.18), MAT.glass, d.cabX, top + d.cabH / 2 - 0.08, 0));
        m.body.add(mesh(new RoundedBoxGeometry(d.cabL * 0.8, 0.1, d.W * 0.82, 2, 0.04), paint, d.cabX, top + d.cabH - 0.1, 0));
        // Roll bars over the bed
        for (const s of [1, -1]) m.body.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), MAT.chrome, -0.8, top + 0.6, s * (d.W / 2 - 0.15)));
        m.body.add(mesh(new THREE.BoxGeometry(0.12, 0.12, d.W - 0.3), MAT.chrome, -0.8, top + 1.2, 0));
        // Front bumper
        m.body.add(mesh(new RoundedBoxGeometry(0.15, 0.3, d.W + 0.2, 2, 0.06), MAT.chrome, d.L / 2 + 0.05, base + 0.35, 0));
        // Driver
        m.body.add(mesh(new THREE.SphereGeometry(0.24, 14, 10), MAT.skin, d.cabX + 0.15, top + 0.25, -0.35));
        m.body.add(mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), paint, d.cabX + 0.13, top + 0.28, -0.35));
        m.starY = top + d.cabH + 0.6;
    } else {
        // Rig: tall cab with flat windshield
        m.body.add(mesh(new RoundedBoxGeometry(0.12, d.H * 0.5, d.W * 0.86, 2, 0.05), MAT.glass, d.L / 2 - 0.04, top - d.H * 0.22, 0));
        m.body.add(mesh(new THREE.BoxGeometry(0.3, 0.08, d.W * 0.9), MAT.dark, d.L / 2 - 0.08, top + 0.06, 0));
        // Exhaust stacks
        for (const s of [1, -1]) m.body.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.8, 8), MAT.chrome, -d.L / 2 + 0.5, top + 0.9, s * (d.W / 2 - 0.2)));
        // Bumper
        m.body.add(mesh(new RoundedBoxGeometry(0.2, 0.4, d.W + 0.3, 2, 0.08), MAT.chrome, d.L / 2 + 0.08, base + 0.45, 0));
        // Driver
        m.body.add(mesh(new THREE.SphereGeometry(0.24, 14, 10), MAT.skin, 1.4, top - 0.55, -0.4));
        m.starY = top + 0.8;
    }
    // Lights
    for (const s of [1, -1]) {
        m.body.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.4), MAT.head, d.L / 2 + 0.01, base + d.H * 0.55, s * (d.W / 2 - 0.4)));
        m.body.add(mesh(new THREE.BoxGeometry(0.06, 0.18, 0.4), MAT.tail, -d.L / 2 - 0.01, base + d.H * 0.55, s * (d.W / 2 - 0.4)));
    }
    // Wheels
    const wx = d.L / 2 - d.wr - 0.3, wz = d.W / 2 - 0.08;
    const tireGeo = new THREE.CylinderGeometry(d.wr, d.wr, 0.42, 20);
    const hubGeo = new THREE.CylinderGeometry(d.wr * 0.5, d.wr * 0.5, 0.44, 10);
    for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, d.wr + d.lift, z);
        const spin = new THREE.Group();
        const tire = mesh(tireGeo, MAT.tire); tire.rotation.x = Math.PI / 2;
        const hub = mesh(hubGeo, MAT.hub); hub.rotation.x = Math.PI / 2;
        spin.add(tire, hub);
        pivot.add(spin);
        m.root.add(pivot);
        m.wheels.push(spin);
        if (x > 0) m.front.push(pivot);
    }
    // Doors (same mechanism as cars)
    const doorL = cfg.shape === 'rig' ? 1.5 : 1.2;
    const doorH = cfg.shape === 'rig' ? d.H * 0.45 : d.H * 0.8;
    for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(d.hinge, base + d.H * 0.52, s * (d.W / 2 + 0.03));
        pivot.add(mesh(new RoundedBoxGeometry(doorL, doorH, 0.08, 2, 0.03), paint, -doorL / 2, 0, 0));
        pivot.add(mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), MAT.chrome, -doorL + 0.28, 0.1, s * 0.05));
        m.body.add(pivot);
        m.doors[s] = pivot;
    }
}

// ============================================================
// Kart models
// ============================================================
const KARTS = {
    gokart: { L: 2.2, W: 1.4, H: 0.3, wr: 0.28, hinge: 0.4 },
    bumpercar: { L: 1.8, W: 1.6, H: 0.55, wr: 0.22, hinge: 0.2 },
};

function buildKart(cfg, m, paint) {
    const d = KARTS[cfg.shape];
    const base = d.wr * 0.85;
    const top = base + d.H;

    if (cfg.shape === 'gokart') {
        // Flat chassis
        m.body.add(mesh(new RoundedBoxGeometry(d.L, d.H, d.W, 2, 0.08), paint, 0, base + d.H / 2, 0));
        // Side pods
        for (const s of [1, -1]) m.body.add(mesh(new RoundedBoxGeometry(d.L * 0.55, d.H * 0.7, 0.22, 2, 0.05), paint, -0.08, base + d.H * 0.45, s * (d.W / 2 + 0.06)));
        // Seat back
        m.body.add(mesh(new RoundedBoxGeometry(0.35, 0.45, 0.45, 2, 0.08), paint, -0.35, top + 0.18, 0));
        // Steering column + wheel
        const col = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), MAT.dark, 0.5, top + 0.22, 0);
        col.rotation.z = 0.5;
        m.body.add(col);
        m.body.add(mesh(new THREE.TorusGeometry(0.14, 0.022, 8, 16), MAT.dark, 0.62, top + 0.42, 0));
        // Nose cone
        m.body.add(mesh(new RoundedBoxGeometry(0.5, d.H * 0.5, d.W * 0.45, 2, 0.06), paint, d.L / 2 - 0.08, base + d.H * 0.3, 0));
        // Driver (exposed)
        m.body.add(mesh(new THREE.SphereGeometry(0.2, 14, 10), MAT.skin, -0.12, top + 0.72, 0));
        m.body.add(mesh(new THREE.SphereGeometry(0.23, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), paint, -0.14, top + 0.75, 0));
        const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.28, 4, 8), paint, -0.08, top + 0.33, 0);
        torso.rotation.z = -0.18;
        m.body.add(torso);
        m.starY = top + 1.25;
    } else {
        // Bumper car: rounded body
        m.body.add(mesh(new RoundedBoxGeometry(d.L, d.H, d.W, 4, 0.2), paint, 0, base + d.H / 2, 0));
        // Rubber bumper ring
        const ring = mesh(new THREE.TorusGeometry((d.L + d.W) / 4 + 0.05, 0.12, 10, 28), MAT.dark, 0, base + d.H * 0.42, 0);
        ring.rotation.x = Math.PI / 2;
        m.body.add(ring);
        // Antenna pole
        m.body.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), MAT.chrome, 0, top + 0.55, 0));
        m.body.add(mesh(new THREE.SphereGeometry(0.07, 8, 8), MAT.star, 0, top + 1.1, 0));
        // Seat
        m.body.add(mesh(new RoundedBoxGeometry(0.4, 0.35, 0.45, 2, 0.08), paint, -0.12, top + 0.12, 0));
        // Driver
        m.body.add(mesh(new THREE.SphereGeometry(0.2, 14, 10), MAT.skin, -0.03, top + 0.62, 0));
        m.body.add(mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), paint, -0.05, top + 0.65, 0));
        m.starY = top + 1.4;
    }
    // Wheels
    const wx = d.L / 2 - d.wr - 0.12, wz = d.W / 2 - 0.08;
    const tireGeo = new THREE.CylinderGeometry(d.wr, d.wr, 0.2, 16);
    const hubGeo = new THREE.CylinderGeometry(d.wr * 0.5, d.wr * 0.5, 0.22, 8);
    for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, d.wr, z);
        const spin = new THREE.Group();
        const tire = mesh(tireGeo, MAT.tire); tire.rotation.x = Math.PI / 2;
        const hub = mesh(hubGeo, MAT.hub); hub.rotation.x = Math.PI / 2;
        spin.add(tire, hub);
        pivot.add(spin);
        m.root.add(pivot);
        m.wheels.push(spin);
        if (x > 0) m.front.push(pivot);
    }
    // Side panels (attack mechanism, same as doors)
    const panelL = cfg.shape === 'gokart' ? 0.7 : 0.6;
    const panelH = d.H * 0.7;
    for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(d.hinge, base + d.H * 0.5, s * (d.W / 2 + 0.03));
        pivot.add(mesh(new RoundedBoxGeometry(panelL, panelH, 0.05, 2, 0.02), paint, -panelL / 2, 0, 0));
        m.body.add(pivot);
        m.doors[s] = pivot;
    }
}

// ============================================================
// ATV models
// ============================================================
const ATVS = {
    quad: { wr: 0.44, wb: 1.6, trackW: 1.2, seat: 1.0, riderX: -0.15 },
    buggy: { wr: 0.46, wb: 2.0, trackW: 1.5, seat: 1.1, riderX: -0.2, L: 3.2, H: 0.4 },
};

function buildAtv(cfg, m, paint) {
    const d = ATVS[cfg.shape];
    const base = d.wr * 0.85;

    if (cfg.shape === 'quad') {
        // Quad bike frame
        m.body.add(mesh(new RoundedBoxGeometry(1.8, 0.35, 0.75, 2, 0.1), paint, 0, base + 0.22, 0));
        // Front fender
        m.body.add(mesh(new RoundedBoxGeometry(0.65, 0.18, d.trackW + 0.3, 2, 0.06), paint, d.wb / 2 - 0.12, base + 0.45, 0));
        // Rear fender
        m.body.add(mesh(new RoundedBoxGeometry(0.65, 0.18, d.trackW + 0.3, 2, 0.06), paint, -d.wb / 2 + 0.12, base + 0.38, 0));
        // Seat
        m.body.add(mesh(new RoundedBoxGeometry(0.75, 0.1, 0.38, 2, 0.04), MAT.dark, -0.1, d.seat - 0.06, 0));
        // Handlebars
        m.body.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), MAT.chrome, d.wb / 2 - 0.18, base + 0.7, 0));
        m.body.add(mesh(new THREE.BoxGeometry(0.08, 0.06, 0.65), MAT.dark, d.wb / 2 - 0.18, base + 0.88, 0));
        // Headlight
        m.body.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), MAT.head, d.wb / 2 - 0.02, base + 0.52, 0));
        // Tail light
        m.body.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.25), MAT.tail, -d.wb / 2 - 0.03, base + 0.4, 0));
        m.starY = d.seat + 1.55;
    } else {
        // Buggy: open frame
        m.body.add(mesh(new RoundedBoxGeometry(d.L, d.H, d.trackW, 2, 0.1), paint, 0, base + d.H / 2, 0));
        // Roll cage
        for (const s of [1, -1]) {
            m.body.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), MAT.chrome, 0.2, base + d.H + 0.7, s * (d.trackW / 2 - 0.06)));
            m.body.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), MAT.chrome, -0.65, base + d.H + 0.7, s * (d.trackW / 2 - 0.06)));
        }
        m.body.add(mesh(new THREE.BoxGeometry(0.85, 0.08, d.trackW - 0.12), MAT.chrome, -0.22, base + d.H + 1.4, 0));
        // Engine behind
        m.body.add(mesh(new RoundedBoxGeometry(0.75, 0.45, d.trackW * 0.55, 2, 0.06), MAT.dark, -d.L / 2 + 0.48, base + d.H + 0.22, 0));
        // Seat
        m.body.add(mesh(new RoundedBoxGeometry(0.45, 0.35, 0.45, 2, 0.06), MAT.dark, d.riderX, d.seat - 0.08, 0));
        // Windshield frame
        const ws = mesh(new THREE.BoxGeometry(0.05, 0.55, d.trackW * 0.65), MAT.chrome, d.L / 2 - 0.45, base + d.H + 0.65, 0);
        ws.rotation.z = 0.3;
        m.body.add(ws);
        // Lights
        for (const s of [1, -1]) m.body.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.18), MAT.head, d.L / 2 + 0.01, base + d.H * 0.6, s * (d.trackW / 2 - 0.25)));
        m.body.add(mesh(new THREE.BoxGeometry(0.05, 0.1, 0.28), MAT.tail, -d.L / 2 - 0.01, base + d.H * 0.6, 0));
        m.starY = d.seat + 1.55;
    }
    // 4 wheels
    const wx = d.wb / 2, wz = d.trackW / 2;
    const tireGeo = new THREE.CylinderGeometry(d.wr, d.wr, 0.28, 18);
    const hubGeo = new THREE.CylinderGeometry(d.wr * 0.45, d.wr * 0.45, 0.3, 8);
    for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, d.wr, z);
        const spin = new THREE.Group();
        const tire = mesh(tireGeo, MAT.tire); tire.rotation.x = Math.PI / 2;
        const hub = mesh(hubGeo, MAT.hub); hub.rotation.x = Math.PI / 2;
        spin.add(tire, hub);
        pivot.add(spin);
        m.root.add(pivot);
        m.wheels.push(spin);
        if (x > 0) m.front.push(pivot);
    }
    // Rider with weapon
    addAtvRider(cfg, m, paint, d);
}

function addAtvRider(cfg, m, paint, d) {
    const rider = new THREE.Group();
    rider.position.set(d.riderX, d.seat, 0);
    m.body.add(rider);

    const legGeo = new THREE.CapsuleGeometry(0.1, 0.48, 4, 8);
    m.legs = {};
    for (const s of [1, -1]) {
        const hip = new THREE.Group();
        hip.position.set(0.05, 0.05, s * 0.19);
        const leg = mesh(legGeo, MAT.jeans, 0.12, -0.26, 0);
        leg.rotation.z = 0.5;
        hip.add(leg, mesh(new THREE.BoxGeometry(0.24, 0.1, 0.13), MAT.dark, 0.28, -0.48, 0));
        rider.add(hip);
        m.legs[s] = hip;
    }
    const torso = mesh(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), paint, 0.1, 0.4, 0);
    torso.rotation.z = -0.28;
    rider.add(torso);
    rider.add(mesh(new THREE.SphereGeometry(0.17, 14, 10), MAT.skin, 0.26, 0.88, 0));
    rider.add(mesh(new THREE.SphereGeometry(0.21, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), paint, 0.24, 0.91, 0));
    rider.add(mesh(new THREE.BoxGeometry(0.05, 0.09, 0.26), MAT.dark, 0.42, 0.88, 0));
    for (const s of [1, -1]) {
        const arm = mesh(new THREE.CapsuleGeometry(0.065, 0.36, 4, 8), paint, 0.36, 0.56, s * 0.22);
        arm.rotation.z = -1.05;
        rider.add(arm);
    }
    // Weapon
    const pivot = new THREE.Group();
    pivot.position.set(0.12, 0.65, 0);
    const holder = new THREE.Group();
    holder.rotation.z = 0.55;
    pivot.add(holder);
    if (cfg.shape === 'quad') {
        // Shovel
        holder.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), MAT.dark, 0, 0.52, 0));
        holder.add(mesh(new RoundedBoxGeometry(0.32, 0.25, 0.04, 2, 0.02), MAT.chrome, 0, 1.12, 0));
    } else {
        // Coconut
        holder.add(mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), MAT.dark, 0, 0.32, 0));
        holder.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), MAT.crust, 0, 0.7, 0));
    }
    rider.add(pivot);
    m.weapon = pivot;
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
    g.globalAlpha = 0.5;
    if (pattern === 'stripes') {
        g.fillStyle = '#fff';
        for (let i = 0; i < 128; i += 16) g.fillRect(i, 0, 8, 128);
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
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
            if ((i + j) % 2) g.fillRect(i * 16, j * 16, 16, 16);
        }
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
    return t;
}

export function buildHat(hatId) {
    const g = new THREE.Group();
    const mat = (c, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    if (hatId === 'crown') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.3, 8), mat(0xf2c14e, 0.3));
        g.add(base);
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const pt = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), mat(0xf2c14e, 0.3));
            pt.position.set(Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35);
            g.add(pt);
        }
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.08), mat(0xff2244, 0.2));
        gem.position.y = 0.1;
        gem.position.z = 0.42;
        g.add(gem);
    } else if (hatId === 'propeller') {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4488ff));
        g.add(cap);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15), mat(0x888888, 0.3));
        hub.position.y = 0.38;
        g.add(hub);
        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.12), mat(0xff4488));
            blade.position.y = 0.45;
            blade.rotation.y = (i / 3) * Math.PI * 2;
            blade.position.x = Math.cos(blade.rotation.y) * 0.3;
            blade.position.z = Math.sin(blade.rotation.y) * 0.3;
            g.add(blade);
        }
        g.userData.spin = true;
    } else if (hatId === 'shark') {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), mat(0x556677));
        fin.rotation.x = -0.2;
        fin.position.y = 0.35;
        g.add(fin);
    } else if (hatId === 'tophat') {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12), mat(0x111111));
        g.add(brim);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.6, 12), mat(0x111111));
        top.position.y = 0.33;
        g.add(top);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 12), mat(0xcc2244));
        band.position.y = 0.1;
        g.add(band);
    } else if (hatId === 'antenna') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), mat(0x888888, 0.3));
        pole.position.y = 0.35;
        g.add(pole);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xff4444, 0.3));
        ball.position.y = 0.72;
        g.add(ball);
    }
    return g;
}

export function applyCustomization(model, custom) {
    if (!custom) return;
    // Apply color + pattern
    if (custom.color || custom.pattern) {
        const col = custom.color || '#e0473f';
        if (custom.pattern && custom.pattern !== 'solid') {
            const tex = createPatternTexture(custom.pattern, col);
            model.paintMat.map = tex;
            model.paintMat.color.set(0xffffff);
        } else {
            model.paintMat.map = null;
            model.paintMat.color.set(col);
        }
        model.paintMat.needsUpdate = true;
    }
    // Apply hat
    if (model._hat) { model.body.remove(model._hat); model._hat = null; }
    if (custom.hat && custom.hat !== 'none') {
        const hat = buildHat(custom.hat);
        hat.position.y = model.cfg.starY || 1.5;
        model.body.add(hat);
        model._hat = hat;
    }
}

export function animateModel(m, r, dt) {
    m.root.position.set(r.x, r.y || 0, r.z);
    m.root.rotation.y = -r.h;
    m.body.rotation.x = r.lean || 0;
    for (const w of m.wheels) w.rotation.z = -r.wheelSpin;
    for (const f of m.front) f.rotation.y = -r.steer * 0.42;

    const k = r.atkT > 0 ? Math.sin(Math.PI * (1 - r.atkT / ATK_TIME)) : 0;
    const s = r.atkSide || 1;
    if (m.kind === 'car' || m.kind === 'truck' || m.kind === 'kart') {
        for (const side of [1, -1]) m.doors[side].rotation.y = side === s ? side * k * 1.25 : 0;
    } else if (m.weapon) {
        m.weapon.rotation.x = s * k * 1.9;
    } else if (m.legs) {
        for (const side of [1, -1]) m.legs[side].rotation.x = side === s ? -side * k * 1.5 : 0;
    }
    m.stars.visible = r.stunT > 0;
    if (m.stars.visible) m.stars.rotation.y += dt * 6;
    // Propeller hat spin
    if (m._hat && m._hat.userData.spin) m._hat.rotation.y += dt * 14;
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
    const ev = { boost: false, bump: 0, miniturbo: 0 };
    const p = track.project(r.x, r.z, r.idx);
    const offroad = Math.abs(p.lat) > track.halfWidth + 0.8;
    if (r.boostT > 0) r.boostT = Math.max(0, r.boostT - dt);

    // --- Drift system ---
    const canDrift = r.speed > 12 && Math.abs(steer) > 0.3;
    if (input.brake && canDrift && !r.drifting && r.stunT <= 0) {
        r.drifting = true;
        r.driftDir = Math.sign(steer);
        r.driftCharge = 0;
        r.driftLevel = 0;
    }
    if (r.drifting) {
        if (!input.brake || r.speed < 5 || r.stunT > 0) {
            const boosts = [0, 0.8, 1.4, 2.2];
            if (r.driftLevel > 0) {
                r.boostT = Math.max(r.boostT, boosts[r.driftLevel]);
                ev.miniturbo = r.driftLevel;
            }
            r.drifting = false;
            r.driftCharge = 0;
            r.driftLevel = 0;
        } else {
            r.driftCharge += dt;
            r.driftLevel = r.driftCharge >= 3.5 ? 3 : r.driftCharge >= 2.0 ? 2 : r.driftCharge >= 0.8 ? 1 : 0;
            steer = clamp(r.driftDir * 0.55 + steer * 0.45, -1, 1);
            if (throttle < 0) throttle *= 0.25;
        }
    }

    const top = c.top * (offroad ? (c.offroad || 0.55) : 1) * (r.boostT > 0 ? 1.3 : 1) * (r.catchup || 1);

    if (throttle > 0) {
        if (r.speed < top) r.speed += c.accel * throttle * dt * (r.boostT > 0 ? 1.8 : 1);
    } else if (throttle < 0) {
        if (r.speed > 0.5) r.speed -= 34 * -throttle * dt;
        else r.speed = Math.max(-11, r.speed - c.accel * 0.6 * -throttle * dt);
    }
    if (r.speed > top) r.speed -= (r.speed - top) * 2.2 * dt;
    r.speed -= r.speed * (throttle === 0 ? 0.35 : 0.06) * dt;
    if (offroad) r.speed -= r.speed * (c.offroad ? 0.4 : 0.9) * dt;

    r.steer += (steer - r.steer) * (1 - Math.exp(-10 * dt));
    const sp = Math.abs(r.speed);
    const turnMult = r.drifting ? 1.4 : 1;
    const turn = c.turn * turnMult * r.steer * clamp(r.speed / 7, -1, 1) * (1 - 0.35 * clamp(sp / c.top, 0, 1));
    r.h += turn * dt;

    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    let gripMult = 1;
    if (r.drifting) gripMult *= 0.2;
    if (r.stunT > 0) gripMult *= 0.35;
    // Water hazard grip reduction (checked early using previous position)
    if (track.hazardZones && !r.airborne) {
        for (const hz of track.hazardZones) {
            if (hz.type !== 'water') continue;
            let dd = Math.abs((r.dist || 0) - hz.dist);
            dd = Math.min(dd, track.total - dd);
            const latD = Math.abs((r.lat || 0) - (hz.lat || 0));
            const rad = hz.radius || 4;
            if (dd < rad * 1.2 && latD < rad) gripMult *= 0.3;
        }
    }
    const k = 1 - Math.exp(-c.grip * gripMult * dt);
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

    // --- Height / airborne physics ---
    const groundY = f.y || 0;
    if (r.y == null) { r.y = groundY; r.vy = 0; r.airborne = false; }
    if (r.airborne) {
        r.vy -= 30 * dt;       // gravity
        r.y += r.vy * dt;
        steer *= 0.15;         // reduced air control
        if (r.y <= groundY) {
            r.y = groundY;
            r.vy = 0;
            r.airborne = false;
            ev.land = true;
        }
    } else {
        if (groundY > r.y + 0.3) {
            // Ramp launch
            const slope = groundY - r.y;
            r.vy = slope * 3 + Math.abs(r.speed) * 0.18;
            r.airborne = true;
            r.y = groundY;
        } else {
            r.y = groundY;
        }
    }

    for (const pad of track.pads) {
        let dd = Math.abs(f.dist - pad.dist);
        dd = Math.min(dd, track.total - dd);
        if (dd < 2.6 && Math.abs(f.lat - pad.lat) < 2.6) {
            if (r.boostT < 0.9) ev.boost = true;
            r.boostT = 1.3;
        }
    }

    // --- Hazard zone checks ---
    if (track.hazardZones && !r.airborne) {
        for (const hz of track.hazardZones) {
            let dd = Math.abs(f.dist - hz.dist);
            dd = Math.min(dd, track.total - dd);
            const latD = Math.abs(f.lat - (hz.lat || 0));
            const rad = hz.radius || 3;
            if (hz.type === 'fire' && dd < rad * 1.2 && latD < rad) {
                r.speed -= r.speed * 0.6 * dt;
                ev.fire = true;
            } else if (hz.type === 'water' && dd < rad * 1.2 && latD < rad) {
                ev.water = true;
            } else if (hz.type === 'hoop' && dd < 3 && latD < 5) {
                if (r.boostT < 0.5) ev.hoop = true;
                r.boostT = Math.max(r.boostT, 1.8);
            }
        }
    }

    const sf = clamp(sp / c.top, 0, 1);
    r.lean = c.kind === 'bike' ? r.steer * sf * 0.5 : c.kind === 'atv' ? r.steer * sf * 0.15 : -r.steer * sf * 0.06;
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
