// Battle bots. They only ever run on the host's browser; everyone else sees them
// through the same position and fire messages as human players.
import {
    tanks, mines, fire, layMine, bfs, toRow, toCol, cellX, cellZ, COLS,
    solidAt, cellAt, TANK_R, driveToward, incomingBullet, angleDiff, clamp, rand,
} from './game.js?v=2';

export const BOT_CFG = { speed: 2.6, bulletSpeed: 7, bounces: 1, maxBullets: 3, cooldown: 0.9, turn: 7.5, turretTurn: 3.0, jitter: 0.11, smart: true, pref: 6 };

// Trace a shot. Returns the first tank it would hit (or 'self'), or null for a wall.
function traceShot(e, angle, bounces, maxLen) {
    let vx = Math.cos(angle), vz = Math.sin(angle);
    let x = e.x + vx * 0.62, z = e.z + vz * 0.62;
    if (solidAt(x, z)) return null;
    let b = bounces, bounced = false, len = 0;
    const step = 0.12;
    while (len < maxLen) {
        const nx = x + vx * step;
        if (solidAt(nx, z)) {
            if (cellAt(nx, z) === 'w' || b <= 0) return null;
            vx = -vx; b--; bounced = true;
        } else x = nx;
        const nz = z + vz * step;
        if (solidAt(x, nz)) {
            if (cellAt(x, nz) === 'w' || b <= 0) return null;
            vz = -vz; b--; bounced = true;
        } else z = nz;
        len += step;
        for (const o of tanks) {
            if (!o.alive || (o === e && !bounced)) continue;
            if (Math.hypot(o.x - x, o.z - z) < TANK_R + 0.08) return { tank: o === e ? 'self' : o, len };
        }
    }
    return null;
}

const hitsEnemy = (e, s) => s && s.tank !== 'self' && s.tank !== e;

function nearestEnemy(e) {
    let best = null, bd = Infinity;
    for (const o of tanks) {
        if (o === e || !o.alive) continue;
        const d = Math.hypot(o.x - e.x, o.z - e.z);
        if (d < bd) { bd = d; best = o; }
    }
    return best;
}

function computeAim(e, target) {
    const cfg = e.cfg;
    let tx = target.x, tz = target.z;
    const t = Math.hypot(tx - e.x, tz - e.z) / cfg.bulletSpeed;
    tx += (target.vx || 0) * t * 0.7;
    tz += (target.vz || 0) * t * 0.7;
    const direct = Math.atan2(tz - e.z, tx - e.x);
    if (hitsEnemy(e, traceShot(e, direct, cfg.bounces, 30))) return direct + rand(-0.5, 0.5) * cfg.jitter;
    // Look for a ricochet (not every time, so bots aren't perfect)
    if (Math.random() < 0.4) return null;
    let best = null, bestLen = Infinity;
    const off = Math.random() * 0.1;
    for (let i = 0; i < 48; i++) {
        const a = off + (i / 48) * Math.PI * 2;
        const s = traceShot(e, a, cfg.bounces, 24);
        if (hitsEnemy(e, s) && s.len < bestLen) { best = a; bestLen = s.len; }
    }
    return best === null ? null : best + rand(-0.5, 0.5) * cfg.jitter * 0.5;
}

function pickPath(e, target) {
    const { dist, prev } = bfs(toRow(e.z), toCol(e.x));
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < dist.length; i++) {
        const d = dist[i];
        if (d < 2 || d > 9) continue;
        const x = cellX(i % COLS), z = cellZ(Math.floor(i / COLS));
        const pd = target ? Math.hypot(target.x - x, target.z - z) : 6;
        const score = -Math.abs(pd - e.cfg.pref) + rand(0, 3) - (mines.some(m => !m.dead && Math.hypot(m.x - x, m.z - z) < 2.2) ? 10 : 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    const path = [];
    for (let i = best; i !== -1 && dist[i] > 0; i = prev[i]) path.push({ x: cellX(i % COLS), z: cellZ(Math.floor(i / COLS)) });
    return path.reverse();
}

export function updateBot(e, dt) {
    const cfg = e.cfg;
    const ox = e.x, oz = e.z;

    e.thinkT -= dt;
    if (e.thinkT <= 0) {
        e.thinkT = rand(0.25, 0.45);
        e.target = nearestEnemy(e);
        e.aim = e.target ? computeAim(e, e.target) : null;
        // Now and then drop a mine when someone is close
        if (e.target && Math.hypot(e.target.x - e.x, e.target.z - e.z) < 3 && Math.random() < 0.12) layMine(e);
    }
    const target = e.target && e.target.alive ? e.target : null;
    let want;
    if (e.aim !== null) want = e.aim;
    else {
        e.sweep += dt * 0.6;
        const toT = target ? Math.atan2(target.z - e.z, target.x - e.x) : e.turret_a;
        want = toT + Math.sin(e.sweep) * 0.9;
    }
    const d = angleDiff(e.turret_a, want);
    e.turret_a += clamp(d, -cfg.turretTurn * dt, cfg.turretTurn * dt);
    if (e.aim !== null && Math.abs(angleDiff(e.turret_a, e.aim)) < 0.06 && e.cooldown <= 0) {
        if (hitsEnemy(e, traceShot(e, e.turret_a, cfg.bounces, 30))) fire(e);
    }

    // Movement
    if (e.dodgeT > 0) {
        e.dodgeT -= dt;
        driveToward(e, e.dodgeA, dt, true);
    } else {
        const b = incomingBullet(e);
        if (b && Math.random() < 0.85) {
            const perp = Math.atan2(b.vz, b.vx) + Math.PI / 2;
            const side = (e.x - b.x) * Math.cos(perp) + (e.z - b.z) * Math.sin(perp) >= 0 ? 0 : Math.PI;
            e.dodgeA = perp + side;
            e.dodgeT = 0.35;
            e.path = null;
        } else {
            if (!e.path || e.path.length === 0) {
                e.path = pickPath(e, target);
                e.stuckT = 0;
            }
            if (e.path && e.path.length) {
                const wp = e.path[0];
                if (Math.hypot(wp.x - e.x, wp.z - e.z) < 0.15) e.path.shift();
                else {
                    const progress = driveToward(e, Math.atan2(wp.z - e.z, wp.x - e.x), dt, false);
                    if (progress < 0.2 && Math.abs(angleDiff(e.body, Math.atan2(wp.z - e.z, wp.x - e.x))) < 0.6) {
                        e.stuckT += dt;
                        if (e.stuckT > 0.6) e.path = null;
                    } else e.stuckT = 0;
                }
            }
        }
    }
    e.vx = (e.x - ox) / dt;
    e.vz = (e.z - oz) / dt;
}
