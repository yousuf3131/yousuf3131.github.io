// The twelve rides: their stats, arcade driving physics and side attacks. Models live in models.js.
export { ATK_TIME, buildVehicleModel, animateModel, applyCustomization, PAINT_COLORS, PATTERNS, HATS, setModelQuality } from './models.js?v=8';

export const NITRO_MIN = 20;    // you can fire the nitro once the meter reaches this
export const NITRO_DRAIN = 40;  // per second, so a full tank lasts 2.5 s

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
        offroad: 1,
    },
    {
        id: 'rig', kind: 'truck', shape: 'rig', name: 'The Rig',
        desc: 'Semi truck cab. Like steering a building, but what a building.',
        top: 40, accel: 12, grip: 4.8, turn: 1.5, mass: 2.8, radius: 2.0,
        attack: { name: 'Air Horn Blast', word: 'HOOOONK!', sound: 'horn', force: 25, range: 5.5, cd: 4.0 },
        offroad: 0.98,
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
        offroad: 1,
    },
    {
        id: 'dunebug', kind: 'atv', shape: 'buggy', name: 'Dune Bug',
        desc: 'Open-top buggy. Eats sand for breakfast. Passenger throws coconuts.',
        top: 40, accel: 20, grip: 6.0, turn: 2.3, mass: 1.0, radius: 1.3,
        attack: { name: 'Coconut Toss', word: 'BONK!', sound: 'bonk', force: 14, range: 4.5, cd: 2.0 },
        offroad: 1,
    },
];
export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map(v => [v.id, v]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// Physics
// ============================================================
// Speed lost when you hit a barrier, by how square-on the hit is (0 = sliding along it, 1 = head-on).
// Glancing scrapes cost at most 3%; a head-on hit costs about half your speed.
export function wallLoss(frac) {
    const glance = 0.03 * Math.min(1, frac / 0.26);
    const hard = frac > 0.26 ? Math.pow((frac - 0.26) / 0.74, 1.5) * 0.5 : 0;
    return glance + hard;
}

// Arcade handling: throttle sets a forward speed, and the actual velocity is pulled toward
// "forward x speed" by the grip. Low grip means more slide, and knockback shoves you sideways.
export function stepPhysics(r, input, dt, track, others) {
    const c = r.cfg;
    let { steer, throttle } = input;
    if (r.stunT > 0) {
        r.stunT = Math.max(0, r.stunT - dt);
        steer *= 0.3;
        throttle *= 0.4;
    }
    if (r.spin) {
        r.h += r.spin * dt;
        r.spin *= Math.exp(-4 * dt);
        if (Math.abs(r.spin) < 0.05) r.spin = 0;
    }
    const ev = { boost: false, bump: 0, miniturbo: 0, scrape: 0, offroad: false, hoopPass: false };
    const p = track.project(r.x, r.z, r.idx, r.y);
    const offroad = Math.abs(p.lat) > track.halfWidth + 0.8;
    ev.offroad = offroad && !r.airborne;
    if (r.boostT > 0) r.boostT = Math.max(0, r.boostT - dt);
    if (r.gumT > 0) r.gumT = Math.max(0, r.gumT - dt);
    if (r.hoopCd > 0) r.hoopCd = Math.max(0, r.hoopCd - dt);

    // --- Nitro: burns the whole tank once lit, and keeps your foot down for you ---
    if (r.nitroOn) {
        r.nitro = Math.max(0, (r.nitro || 0) - NITRO_DRAIN * dt);
        if (r.nitro <= 0) r.nitroOn = false;
        if (r.stunT <= 0) throttle = Math.max(throttle, 1);
    }

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

    // Boost pads, mini-turbos, nitro and slipstream stack, but only up to +50%
    const boostMult = Math.min(1.5, 1 + (r.boostT > 0 ? 0.3 : 0) + (r.nitroOn ? 0.35 : 0) + (r.drafting ? 0.05 : 0));
    // Leaving the road costs only a few percent (ATVs and trucks barely care)
    const surface = offroad ? (c.offroad ?? 0.95) : 1;
    const top = c.top * surface * boostMult * (r.catchup || 1) * (r.gumT > 0 ? 0.45 : 1);
    const accelMult = r.nitroOn ? 2.4 : r.boostT > 0 ? 1.8 : 1;

    if (throttle > 0) {
        if (r.speed < top) r.speed += c.accel * throttle * dt * accelMult;
    } else if (throttle < 0) {
        if (r.speed > 0.5) r.speed -= 34 * -throttle * dt;
        else r.speed = Math.max(-11, r.speed - c.accel * 0.6 * -throttle * dt);
    }
    if (r.speed > top) r.speed -= (r.speed - top) * (r.gumT > 0 ? 5 : 2.2) * dt;
    r.speed -= r.speed * (throttle === 0 ? 0.35 : 0.06) * dt;
    r.braking = !!input.brake || (throttle < 0 && r.speed > 1);

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
        if (d > 0.001 && d < min && Math.abs((r.y || 0) - (o.y || 0)) < 2.2) {
            const nx = dx / d, nz = dz / d, push = min - d;
            r.x += nx * push * 0.55;
            r.z += nz * push * 0.55;
            const rel = (r.vx - (o.vx || 0)) * nx + (r.vz - (o.vz || 0)) * nz;
            if (rel < 0) {
                const imp = -rel * 1.8 * (o.cfg.mass / (c.mass + o.cfg.mass));
                r.vx += nx * imp;
                r.vz += nz * imp;
                ev.bump = Math.max(ev.bump, -rel);
                ev.touched = o.id;
            }
        }
    }

    // Barriers: slide along them. Only the part of your velocity going into the wall is removed,
    // and the speed you lose depends on how square-on you hit it.
    const q = track.project(r.x, r.z, p.i, r.y);
    const lim = track.halfWidth + track.runoff - c.radius * 0.6;
    if (r.wallT > 0) { r.wallT -= dt; if (r.wallT <= 0) r.wallHit = 0; }
    if (Math.abs(q.lat) > lim) {
        const s = Math.sign(q.lat), over = Math.abs(q.lat) - lim;
        const wnx = q.nx * s, wnz = q.nz * s;          // points into the wall
        r.x -= wnx * over;
        r.z -= wnz * over;
        const vn = r.vx * wnx + r.vz * wnz;
        if (vn > 0) {
            const v = Math.hypot(r.vx, r.vz);
            const frac = v > 0.01 ? clamp(vn / v, 0, 1) : 0;
            const bounce = frac > 0.6 ? 0.3 * (frac - 0.6) / 0.4 : 0;
            r.vx -= wnx * vn * (1 + bounce);
            r.vz -= wnz * vn * (1 + bounce);
            // Only charge for the hardest part of one continuous contact, not every frame of it
            const loss = wallLoss(frac);
            const already = r.wallT > 0 ? (r.wallHit || 0) : 0;
            if (loss > already) {
                const keep = (1 - loss) / (1 - already);
                r.speed *= keep;
                r.vx *= keep;
                r.vz *= keep;
                r.wallHit = loss;
            }
            r.wallT = 0.3;
            // A glancing hit turns you to run along the wall instead of grinding into it
            if (frac < 0.6 && Math.abs(r.speed) > 3) {
                const wallH = Math.atan2(q.tz, q.tx);
                let d = ((wallH - r.h) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
                if (Math.abs(d) > Math.PI / 2) d = d > 0 ? d - Math.PI : d + Math.PI;
                r.h += d * Math.min(1, dt * 9);
            }
            ev.scrape = Math.max(ev.scrape, v);
            ev.wallX = r.x + wnx * c.radius * 0.7;
            ev.wallZ = r.z + wnz * c.radius * 0.7;
            ev.wallFrac = frac;
            if (frac > 0.45) ev.bump = Math.max(ev.bump, vn);
        }
        r.speed -= r.speed * 0.03 * dt;
    }

    const f = track.project(r.x, r.z, q.i, r.y);
    r.idx = f.i;
    r.dist = f.dist;
    r.lat = f.lat;
    r.fwdDot = r.vx * f.tx + r.vz * f.tz;

    // --- Height / airborne physics ---
    const groundY = f.y || 0;
    if (r.y == null) { r.y = groundY; r.vy = 0; r.airborne = false; r._prevGroundY = groundY; }
    if (r.airborne) {
        r.vy -= 30 * dt;       // gravity
        r.y += r.vy * dt;
        if (r.y <= groundY) {
            ev.land = -r.vy;
            r.y = groundY;
            r.vy = 0;
            r.airborne = false;
        }
    } else {
        // Launch off a jump when the ground drops away faster than a gentle slope would
        const drop = (r._prevGroundY ?? groundY) - groundY;
        const rate = drop / Math.max(dt, 1e-3);
        r.y = groundY;
        if (f.jump && rate > 2 && Math.abs(r.speed) > 8) {
            r.vy = Math.abs(r.speed) * 0.15 + 2;
            r.airborne = true;
        }
    }
    r._prevGroundY = groundY;

    for (const pad of track.pads) {
        let dd = Math.abs(f.dist - pad.dist);
        dd = Math.min(dd, track.total - dd);
        if (dd < 2.6 && Math.abs(f.lat - pad.lat) < 2.6 && Math.abs((r.y || 0) - (pad.y || 0)) < 2) {
            if (r.boostT < 0.9) ev.boost = true;
            r.boostT = 1.3;
        }
    }

    // --- Hazard zone checks ---
    if (track.hazardZones) {
        for (const hz of track.hazardZones) {
            let dd = Math.abs(f.dist - hz.dist);
            dd = Math.min(dd, track.total - dd);
            const latD = Math.abs(f.lat - (hz.lat || 0));
            const rad = hz.radius || 3;
            if (hz.type === 'hoop') {
                if (dd < 3 && latD < 5) {
                    if (r.boostT < 0.5) ev.hoop = true;
                    if (!(r.hoopCd > 0)) { ev.hoopPass = true; r.hoopCd = 2; }
                    r.boostT = Math.max(r.boostT, 1.8);
                }
            } else if (r.airborne) {
                continue;
            } else if (hz.type === 'fire' && dd < rad * 1.2 && latD < rad) {
                r.speed -= r.speed * 0.6 * dt;
                ev.fire = true;
            } else if (hz.type === 'water' && dd < rad * 1.2 && latD < rad) {
                ev.water = true;
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
        if (Math.abs(along) < 3.4 && Math.abs(lat) < r.cfg.attack.range + o.cfg.radius && Math.abs(lat) > 0.3 && Math.abs((o.y || 0) - (r.y || 0)) < 2.5) {
            const score = Math.abs(lat) + Math.abs(along) * 0.3;
            if (score < bestScore) { bestScore = score; best = o; side = Math.sign(lat); }
        }
    }
    return { target: best, side: best ? side : (Math.random() < 0.5 ? -1 : 1) };
}
