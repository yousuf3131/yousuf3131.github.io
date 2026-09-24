// Archery Duel engine: world generation, physics, audio and rendering.
// Shared by the single-player tournament and the online mode.

// ============================================================
// Config
// ============================================================
export const WORLD_H = 760;           // visible world height in world units
export const GROUND_Y = 600;          // base ground line
export const G = 980;                 // gravity, units/s^2
export const WIND_ACC = 70;           // horizontal accel at wind = 1
export const MAX_DRAG = 230;          // screen px for full power
export const MIN_SPEED = 380, MAX_SPEED = 1650;
export const MAX_HP = 100;
export const SIM_DT = 1 / 90;         // fixed step used by simulate() and scripted arrows
export const DAMAGE = { head: 55, body: 30, legs: 18 };

export const STAGES = [
    { name: 'Scout',        dist: 900,  err: 1.4, hp: 100, wind: 0.2, hill: 0,   obstacles: [],                     palette: 0 },
    { name: 'Ranger',       dist: 1050, err: 1.15, hp: 100, wind: 0.35, hill: 0,  obstacles: [['rock', 0.5]],        palette: 0 },
    { name: 'Hunter',       dist: 1250, err: 0.95, hp: 110, wind: 0.45, hill: 150, obstacles: [],                    palette: 1 },
    { name: 'Sharpshooter', dist: 1400, err: 0.6,  hp: 110, wind: 0.5, hill: 60,  obstacles: [['tree', 0.45]],       palette: 1 },
    { name: 'Warden',       dist: 1600, err: 0.5,  hp: 120, wind: 0.6, hill: 190, obstacles: [['rock', 0.3]],        palette: 2 },
    { name: 'Marksman',     dist: 1800, err: 0.4,  hp: 130, wind: 0.8, hill: 110, obstacles: [['tree', 0.35], ['rock', 0.65]], palette: 2 },
    { name: 'Champion',     dist: 2000, err: 0.3,  hp: 150, wind: 0.9, hill: 220, obstacles: [['tree', 0.6]],        palette: 3 },
];

export const PALETTES = [
    { skyTop: '#6fb7ff', skyBottom: '#d7efff', sun: '#fff6cf', far: '#9cc3d9', mid: '#79a9a0', grass: '#5dbb63', grassDark: '#3f9a4a', dirt: '#8a6a45', dirtDark: '#6d5236' },
    { skyTop: '#5aa0e8', skyBottom: '#ffe1b8', sun: '#fff0c2', far: '#b7b8d4', mid: '#8aa58c', grass: '#6cbf5a', grassDark: '#4c9a43', dirt: '#8f6a43', dirtDark: '#6e5033' },
    { skyTop: '#3b5b9a', skyBottom: '#ffb38a', sun: '#ffd9a0', far: '#8f86a8', mid: '#6d7f78', grass: '#58a55a', grassDark: '#3d8044', dirt: '#7a5a3b', dirtDark: '#5d432c' },
    { skyTop: '#1d2b53', skyBottom: '#e27d6a', sun: '#ffc48a', far: '#5f5a7d', mid: '#4d615c', grass: '#4b9150', grassDark: '#336d3a', dirt: '#6a4d33', dirtDark: '#4f3825' },
];

// ============================================================
// Helpers
// ============================================================
export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
export const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
export const facingFor = angle => (Math.cos(angle) >= 0 ? 1 : -1);
export function angleLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}
// Elevation above the horizon in degrees, whichever way the archer faces
export const elevationDeg = angle => Math.round(Math.asin(clamp(-Math.sin(angle), -1, 1)) * 180 / Math.PI);

// Deterministic PRNG so every browser builds the same terrain from the host's seed
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => clamp(Math.round(c * (1 + k)), 0, 255);
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Shared mutable state
export const E = {
    world: null,
    cam: { x: 0, target: 0 },
    shake: 0,
    drag: null,
    onHit: null,   // (archer, part, dmg) after an arrow lands in someone
};

// ============================================================
// Canvas and view
// ============================================================
export const canvas = $('c');
export const ctx = canvas.getContext('2d');
// minW: minimum visible world width (online mode zooms out on narrow screens); oy: vertical offset
export const view = { w: 0, h: 0, dpr: 1, scale: 1, ww: 0, oy: 0, minW: 0 };
export function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = innerWidth;
    view.h = innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    view.scale = view.h / WORLD_H;
    if (view.minW) view.scale = Math.min(view.scale, view.w / view.minW);
    view.ww = view.w / view.scale; // view width in world units
    view.oy = 0;
    if (view.minW && view.scale < view.h / WORLD_H) {
        // Tall screen: put the ground line about two thirds down rather than at the very bottom
        const bottom = view.h - WORLD_H * view.scale;
        view.oy = clamp(view.h * 0.68 - GROUND_Y * view.scale, 0, bottom);
    }
}
addEventListener('resize', resize);
resize();
export function setMinWorldWidth(w) {
    if (view.minW === w) return;
    view.minW = w;
    resize();
}
export const toScreenX = x => (x - E.cam.x) * view.scale;
export const toScreenY = y => y * view.scale + view.oy;

// ============================================================
// Audio
// ============================================================
let actx = null;
let muted = store.get('archeryMuted') === '1';
export function audio() {
    if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
}
function tone(f0, f1, dur, type, vol) {
    const a = !muted && audio();
    if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur);
}
function noise(dur, vol, cutoff) {
    const a = !muted && audio();
    if (!a) return;
    const t = a.currentTime;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = cutoff;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
}
export const sfx = {
    twang: () => { tone(180, 90, 0.25, 'triangle', 0.12); noise(0.12, 0.2, 1800); },
    thud: () => { tone(140, 60, 0.12, 'sine', 0.2); noise(0.1, 0.25, 600); },
    hit: () => { tone(420, 160, 0.18, 'square', 0.06); noise(0.15, 0.3, 900); },
    head: () => { tone(880, 440, 0.25, 'square', 0.06); tone(1320, 660, 0.25, 'triangle', 0.05); noise(0.15, 0.3, 1200); },
    clink: () => tone(1800, 1400, 0.08, 'triangle', 0.06),
    creak: () => tone(90 + Math.random() * 30, 70, 0.08, 'sawtooth', 0.02),
    win: () => { tone(523, 523, 0.15, 'triangle', 0.08); setTimeout(() => tone(659, 659, 0.15, 'triangle', 0.08), 140); setTimeout(() => tone(784, 784, 0.3, 'triangle', 0.08), 280); },
    lose: () => { tone(392, 330, 0.3, 'triangle', 0.08); setTimeout(() => tone(330, 262, 0.5, 'triangle', 0.08), 260); },
    join: () => { tone(660, 660, 0.08, 'triangle', 0.06); setTimeout(() => tone(880, 880, 0.1, 'triangle', 0.06), 90); },
    turn: () => tone(740, 980, 0.12, 'triangle', 0.05),
    tick: () => tone(1200, 1100, 0.04, 'square', 0.025),
};
export const isMuted = () => muted;
export function setMuted(m) { muted = m; store.set('archeryMuted', muted ? '1' : '0'); }

// ============================================================
// World: tournament stages
// ============================================================
export function buildWorld(stageIndex) {
    const st = STAGES[stageIndex];
    const px = 260, ex = px + st.dist;
    const width = ex + 300;
    const seed = Math.random() * 1000;
    const step = 4;
    const heights = new Float32Array(Math.ceil(width / step) + 2);
    const mid = (px + ex) / 2;
    for (let i = 0; i < heights.length; i++) {
        const x = i * step;
        let h = GROUND_Y
            - 18 * Math.sin(x * 0.004 + seed)
            - 10 * Math.sin(x * 0.011 + seed * 2)
            - 4 * Math.sin(x * 0.03 + seed * 3);
        if (st.hill) h -= st.hill * Math.exp(-(((x - mid) / (st.dist * 0.16)) ** 2));
        // Flatten ground where the archers stand
        for (const ax of [px, ex]) {
            const d = Math.abs(x - ax);
            if (d < 110) {
                const flat = GROUND_Y - 10;
                h = lerp(flat, h, clamp((d - 50) / 60, 0, 1));
            }
        }
        heights[i] = h;
    }
    const groundAt = makeGroundAt(heights, step);

    const obstacles = st.obstacles.map(([type, t]) => makeObstacle(type, lerp(px, ex, t), groundAt));

    const deco = [];
    for (let x = 60; x < width; x += rand(120, 260)) {
        if (Math.abs(x - px) < 140 || Math.abs(x - ex) < 140) continue;
        deco.push({ x, kind: Math.random() < 0.6 ? 'bush' : 'grass', s: rand(0.7, 1.3) });
    }

    const player = makeArcher(px, groundAt(px), 1, true, MAX_HP, 'You');
    const enemy = makeArcher(ex, groundAt(ex), -1, false, st.hp, st.name);

    E.world = {
        stageIndex, st, width, heights, groundAt, obstacles, deco,
        archers: [player, enemy], player, enemy,
        palette: PALETTES[st.palette],
        wind: 0,
        arrows: [], particles: [], texts: [],
        clouds: makeClouds(width),
        aiErr: 1,
    };
    return E.world;
}

function makeGroundAt(heights, step) {
    return x => {
        const f = clamp(x / step, 0, heights.length - 1.001);
        const i = Math.floor(f);
        return lerp(heights[i], heights[i + 1], f - i);
    };
}
function makeObstacle(type, x, groundAt) {
    const gy = groundAt(x);
    if (type === 'rock') return { type, x, y: gy - 30, r: 58 };
    return { type, x, y: gy, trunkH: 190, canopyR: 78 };
}
function makeClouds(width) {
    return Array.from({ length: 8 }, () => ({ x: rand(0, width + 800), y: rand(60, 260), s: rand(0.6, 1.4), v: rand(6, 16) }));
}

export function makeArcher(x, y, facing, isPlayer, hp, name, color) {
    const main = color || (isPlayer ? '#2ec495' : '#e0584f');
    return {
        x, y, facing, isPlayer, hp, maxHp: hp, name,
        color: main,
        dark: color ? shade(color, -0.4) : (isPlayer ? '#1a7a5c' : '#9c3530'),
        aim: facing > 0 ? -0.6 : Math.PI + 0.6, // radians in canvas space
        draw: 0,
        stuck: [],
        flinch: 0,
        fall: 0,
        dead: false,
        breath: Math.random() * 6,
    };
}

// ============================================================
// World: online arena generated from the host's seed.
// Every call to rng() happens in a fixed order, so all browsers get identical terrain.
// ============================================================
export function buildArena(seed, list) {
    const rng = mulberry32(seed);
    const rr = (a, b) => a + rng() * (b - a);
    const n = list.length;
    const margin = 420;
    const xs = [margin];
    for (let i = 1; i < n; i++) xs.push(xs[i - 1] + (n === 2 ? rr(1000, 1250) : rr(720, 960)));
    const width = xs[n - 1] + margin;
    const step = 4;
    const s = rng() * 1000;
    const paletteIndex = Math.floor(rng() * PALETTES.length);

    // Hills and obstacles between neighbouring archers
    const hills = [], obstacleSpecs = [];
    for (let i = 0; i < n - 1; i++) {
        const a = xs[i], b = xs[i + 1], gap = b - a;
        if (rng() < 0.6) hills.push({ x: lerp(a, b, rr(0.4, 0.6)), h: rr(60, 210), w: gap * 0.16 });
        if (rng() < (n === 2 ? 0.7 : 0.55)) obstacleSpecs.push([rng() < 0.5 ? 'rock' : 'tree', lerp(a, b, rr(0.3, 0.7))]);
    }

    const heights = new Float32Array(Math.ceil(width / step) + 2);
    for (let i = 0; i < heights.length; i++) {
        const x = i * step;
        let h = GROUND_Y
            - 18 * Math.sin(x * 0.004 + s)
            - 10 * Math.sin(x * 0.011 + s * 2)
            - 4 * Math.sin(x * 0.03 + s * 3);
        for (const hl of hills) h -= hl.h * Math.exp(-(((x - hl.x) / hl.w) ** 2));
        for (const ax of xs) {
            const d = Math.abs(x - ax);
            if (d < 110) h = lerp(GROUND_Y - 10, h, clamp((d - 50) / 60, 0, 1));
        }
        heights[i] = h;
    }
    const groundAt = makeGroundAt(heights, step);
    const obstacles = obstacleSpecs.map(([type, x]) => makeObstacle(type, x, groundAt));

    const deco = [];
    for (let x = 60; x < width; x += rr(120, 260)) {
        const kind = rng() < 0.6 ? 'bush' : 'grass', sc = rr(0.7, 1.3);
        if (xs.some(ax => Math.abs(x - ax) < 140)) continue;
        deco.push({ x, kind, s: sc });
    }

    // Alternate facing; the two ends always face inwards
    const archers = list.map((p, i) => {
        let facing = i % 2 === 0 ? 1 : -1;
        if (i === 0) facing = 1;
        if (i === n - 1) facing = -1;
        const a = makeArcher(xs[i], groundAt(xs[i]), facing, false, MAX_HP, p.name, p.color);
        a.id = p.id;
        a.bot = !!p.bot;
        return a;
    });

    E.world = {
        online: true, st: { wind: 0.8 }, width, heights, groundAt, obstacles, deco,
        archers, palette: PALETTES[paletteIndex],
        wind: 0, arrows: [], particles: [], texts: [],
        clouds: makeClouds(width),
    };
    return E.world;
}

// ============================================================
// Physics and hit detection
// ============================================================
export const HEAD_Y = -88, HEAD_R = 13;
function hitArcher(a, x, y) {
    if (a.dead) return null;
    const rx = (x - a.x) * a.facing, ry = y - a.y;
    if (Math.hypot(rx, ry - HEAD_Y) < HEAD_R + 1) return 'head';
    if (Math.abs(rx) < 12 && ry > -74 && ry <= -36) return 'body';
    if (Math.abs(rx) < 10 && ry > -36 && ry <= 2) return 'legs';
    return null;
}

// What does a point in the world collide with?
function collide(x, y, owner, age) {
    const world = E.world;
    if (x < -400 || x > world.width + 400 || y > WORLD_H + 400) return { type: 'out' };
    for (const a of world.archers) {
        if (a === owner && age < 0.3) continue;
        const part = hitArcher(a, x, y);
        if (part) return { type: 'archer', archer: a, part };
    }
    for (const o of world.obstacles) {
        if (o.type === 'rock') {
            if (Math.hypot(x - o.x, (y - o.y) * 1.25) < o.r) return { type: 'rock', o };
        } else {
            if (Math.abs(x - o.x) < 13 && y > o.y - o.trunkH && y < o.y) return { type: 'tree', o };
            if (Math.hypot(x - o.x, y - (o.y - o.trunkH - 30)) < o.canopyR) return { type: 'tree', o };
        }
    }
    if (x >= 0 && x <= world.width && y >= world.groundAt(x)) return { type: 'ground' };
    return null;
}

export function bowHand(a) {
    return { x: a.x + a.facing * 6, y: a.y - 62 };
}

// Simulate a shot to its first contact (used by the AI and by online shot resolution)
export function simulate(owner, angle, speed, wind = E.world.wind) {
    const h = bowHand(owner);
    let x = h.x, y = h.y, vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed, t = 0, n = 0;
    const dt = SIM_DT;
    while (t < 6) {
        vx += wind * WIND_ACC * dt;
        vy += G * dt;
        x += vx * dt;
        y += vy * dt;
        t += dt;
        n++;
        const c = collide(x, y, owner, t);
        if (c) return { ...c, x, y, n, ang: Math.atan2(vy, vx) };
    }
    return { type: 'out', x, y, n, ang: Math.atan2(vy, vx) };
}

// Best shot from shooter at target (no error). The tournament enemy always shoots left.
export function bestShot(shooter, target, wind = E.world.wind) {
    const dir = target.x < shooter.x ? -1 : 1;
    shooter.facing = dir;
    const targetX = target.x, targetY = target.y - 55;
    let best = null, bestScore = Infinity;
    for (let deg = 12; deg <= 78; deg += 2) {
        const angle = dir < 0 ? Math.PI + deg * Math.PI / 180 : -deg * Math.PI / 180;
        for (let sp = MIN_SPEED; sp <= MAX_SPEED; sp += 25) {
            const r = simulate(shooter, angle, sp, wind);
            let score;
            if (r.type === 'archer' && r.archer === target) score = r.part === 'head' ? -2 : r.part === 'body' ? -1 : 0;
            else score = Math.hypot(r.x - targetX, (r.y - targetY) * 0.5) / 40;
            score += deg * 0.004;
            if (score < bestScore) { bestScore = score; best = { angle, speed: sp }; }
        }
    }
    return best;
}

// Online: resolve a shot on the shooter's browser. The result is what everyone else is told.
export function resolveShot(owner, angle, speed, wind) {
    owner.facing = facingFor(angle);
    const r = simulate(owner, angle, speed, wind);
    const res = { k: r.type, x: r.x, y: r.y, n: r.n, ang: r.ang };
    if (r.type === 'archer') {
        res.id = r.archer.id;
        res.part = r.part;
        res.dmg = Math.round(DAMAGE[r.part] + rand(-3, 3));
    }
    return res;
}

export function fireArrow(a, angle, speed) {
    const h = bowHand(a);
    E.world.arrows.push({
        x: h.x, y: h.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        owner: a, age: 0, stuck: null, done: false, trail: [],
    });
    a.draw = 0;
    sfx.twang();
}

// Online: an arrow that follows the fixed-step path and lands exactly where res says
export function fireScripted(a, angle, speed, wind, res) {
    a.facing = facingFor(angle);
    a.aim = angle;
    fireArrow(a, angle, speed);
    const ar = E.world.arrows[E.world.arrows.length - 1];
    ar.script = { res, wind, n: 0, acc: 0 };
    return ar;
}

export function updateArrows(dt) {
    const world = E.world;
    const steps = 4, h = dt / steps;
    for (const ar of world.arrows) {
        if (ar.stuck) continue;
        if (ar.script) { stepScripted(ar, dt); continue; }
        for (let s = 0; s < steps; s++) {
            ar.vx += world.wind * WIND_ACC * h;
            ar.vy += G * h;
            ar.x += ar.vx * h;
            ar.y += ar.vy * h;
            ar.age += h;
            const c = collide(ar.x, ar.y, ar.owner, ar.age);
            if (c) { land(ar, c); break; }
        }
        ar.trail.push({ x: ar.x, y: ar.y });
        if (ar.trail.length > 14) ar.trail.shift();
    }
}

function stepScripted(ar, dt) {
    const sc = ar.script, res = sc.res;
    sc.acc += dt;
    while (sc.acc >= SIM_DT && !ar.stuck) {
        sc.acc -= SIM_DT;
        ar.vx += sc.wind * WIND_ACC * SIM_DT;
        ar.vy += G * SIM_DT;
        ar.x += ar.vx * SIM_DT;
        ar.y += ar.vy * SIM_DT;
        ar.age += SIM_DT;
        sc.n++;
        if (sc.n >= res.n) {
            ar.x = res.x; ar.y = res.y;
            const target = res.k === 'archer' ? E.world.archers.find(a => a.id === res.id) : null;
            let c;
            if (res.k === 'archer') c = target ? { type: 'archer', archer: target, part: res.part, dmg: res.dmg } : { type: 'ground' };
            else c = { type: res.k };
            c.ang = res.ang;
            land(ar, c);
        }
    }
    ar.trail.push({ x: ar.x, y: ar.y });
    if (ar.trail.length > 14) ar.trail.shift();
}

function land(ar, c) {
    const angle = c.ang != null ? c.ang : Math.atan2(ar.vy, ar.vx);
    ar.stuck = c.type;
    ar.angle = angle;
    ar.trail = [];
    const world = E.world;
    if (c.type === 'out') {
        ar.gone = true;
        return;
    }
    if (c.type === 'archer') {
        const a = c.archer;
        const base = DAMAGE[c.part];
        const dmg = c.dmg != null ? c.dmg : Math.round(base + rand(-3, 3));
        a.hp = Math.max(0, a.hp - dmg);
        a.flinch = 1;
        // Store the arrow relative to the archer so it moves with them
        a.stuck.push({ rx: (ar.x - a.x) * a.facing, ry: ar.y - a.y, angle: a.facing > 0 ? angle : Math.PI - angle });
        ar.gone = true;
        const label = c.part === 'head' ? 'HEADSHOT' : c.part === 'body' ? 'Hit' : 'Leg hit';
        world.texts.push({ x: a.x, y: a.y - 120, text: `-${dmg}`, sub: label, color: c.part === 'head' ? '#ffd166' : '#ffffff', life: 1.6 });
        burst(ar.x, ar.y, a.color, 12, 220);
        burst(ar.x, ar.y, '#ffffff', 6, 160);
        E.shake = c.part === 'head' ? 14 : 8;
        c.part === 'head' ? sfx.head() : sfx.hit();
        if (a.hp <= 0) a.dead = true;
        if (E.onHit) E.onHit(a, c.part, dmg);
    } else if (c.type === 'rock') {
        burst(ar.x, ar.y, '#b9b3a8', 10, 200);
        ar.bounced = true;
        sfx.clink();
    } else if (c.type === 'tree') {
        burst(ar.x, ar.y, '#4e9a4a', 12, 160, true);
        sfx.thud();
    } else {
        burst(ar.x, ar.y, world.palette.dirt, 10, 180);
        sfx.thud();
    }
}

function burst(x, y, color, n, speed, leaf) {
    for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * speed;
        E.world.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: rand(0.5, 1), max: 1, color, r: rand(2, 4.5), leaf });
    }
}

// Per-frame archer idle animation
export function animateArchers(dt) {
    for (const a of E.world.archers) {
        a.breath += dt * 2;
        a.flinch = Math.max(0, a.flinch - dt * 4);
        if (a.dead) a.fall = Math.min(1, a.fall + dt * 2.5);
    }
}

// ============================================================
// Input helper: drag back to draw
// ============================================================
export function dragShot(maxDrag = MAX_DRAG) {
    const drag = E.drag;
    if (!drag) return null;
    const dx = drag.start.x - drag.cur.x, dy = drag.start.y - drag.cur.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) return null;
    const power = clamp(len / maxDrag, 0, 1);
    return { angle: Math.atan2(dy, dx), power, speed: lerp(MIN_SPEED, MAX_SPEED, power) };
}

// ============================================================
// Rendering
// ============================================================
export function worldTransform(parallax = 1) {
    const shake = E.shake;
    const sx = shake ? rand(-shake, shake) * 0.4 : 0, sy = shake ? rand(-shake, shake) * 0.4 : 0;
    const s = view.scale * view.dpr;
    ctx.setTransform(s, 0, 0, s, (-E.cam.x * parallax + sx) * s, sy * s + view.oy * view.dpr);
}
export function screenTransform() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

function drawSky() {
    const pal = E.world.palette;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    // Sun
    worldTransform(0.05);
    const sx = E.cam.x * 0.05 + view.ww * 0.72, sy = 150;
    const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, 160);
    sg.addColorStop(0, pal.sun);
    sg.addColorStop(0.25, pal.sun + 'cc');
    sg.addColorStop(1, pal.sun + '00');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, 160, 0, Math.PI * 2);
    ctx.fill();
}

function drawHills(parallax, color, base, amp, freq, seed) {
    worldTransform(parallax);
    const x0 = E.cam.x * parallax - 20, x1 = x0 + view.ww + 40;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, WORLD_H);
    for (let x = x0; x <= x1; x += 12) {
        const y = base - amp * (0.6 * Math.sin(x * freq + seed) + 0.3 * Math.sin(x * freq * 2.3 + seed * 1.7) + 0.1 * Math.sin(x * freq * 5.1));
        ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, WORLD_H);
    ctx.closePath();
    ctx.fill();
}

function drawClouds(dt) {
    const world = E.world;
    worldTransform(0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of world.clouds) {
        c.x += c.v * dt;
        const span = world.width * 0.3 + view.ww + 400;
        if (c.x > E.cam.x * 0.3 + view.ww + 300) c.x -= span;
        const x = c.x, y = c.y, s = c.s;
        ctx.beginPath();
        ctx.ellipse(x, y, 60 * s, 22 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x - 38 * s, y + 6 * s, 36 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 40 * s, y + 5 * s, 40 * s, 17 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 8 * s, y - 14 * s, 34 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawGround() {
    const world = E.world, cam = E.cam;
    const pal = world.palette;
    worldTransform(1);
    const x0 = Math.max(0, cam.x - 20), x1 = Math.min(world.width, cam.x + view.ww + 20);
    // Extend beyond the world edges so there is no gap
    const left = cam.x - 50, right = cam.x + view.ww + 50;

    const top = [];
    for (let x = left; x <= right; x += 6) top.push([x, world.groundAt(clamp(x, 0, world.width))]);

    // Fill well below the world so tall (portrait) screens have no gap under the ground
    const deep = WORLD_H + 50 + (view.oy ? view.h / view.scale : 0);
    ctx.fillStyle = pal.dirt;
    ctx.beginPath();
    ctx.moveTo(left, deep);
    for (const [x, y] of top) ctx.lineTo(x, y);
    ctx.lineTo(right, deep);
    ctx.closePath();
    ctx.fill();

    // Dirt layers
    ctx.strokeStyle = pal.dirtDark;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.35;
    for (const off of [60, 110]) {
        ctx.beginPath();
        top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + off + Math.sin(x * 0.02) * 6) : ctx.moveTo(x, y + off)));
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Grass band
    ctx.fillStyle = pal.grass;
    ctx.beginPath();
    top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = top.length - 1; i >= 0; i--) ctx.lineTo(top[i][0], top[i][1] + 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.grassDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 16) : ctx.moveTo(x, y + 16)));
    ctx.stroke();

    // Decorations
    for (const d of world.deco) {
        if (d.x < x0 - 80 || d.x > x1 + 80) continue;
        const y = world.groundAt(d.x);
        if (d.kind === 'bush') {
            ctx.fillStyle = pal.grassDark;
            ctx.beginPath();
            ctx.ellipse(d.x, y - 8 * d.s, 26 * d.s, 16 * d.s, 0, 0, Math.PI * 2);
            ctx.ellipse(d.x + 18 * d.s, y - 5 * d.s, 18 * d.s, 12 * d.s, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = pal.grassDark;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (let k = -2; k <= 2; k++) {
                ctx.moveTo(d.x + k * 5, y + 2);
                ctx.quadraticCurveTo(d.x + k * 6, y - 10 * d.s, d.x + k * 9, y - 16 * d.s);
            }
            ctx.stroke();
        }
    }
}

function drawObstacles() {
    const pal = E.world.palette;
    worldTransform(1);
    for (const o of E.world.obstacles) {
        if (o.type === 'rock') {
            ctx.fillStyle = '#8d8a84';
            ctx.beginPath();
            ctx.ellipse(o.x, o.y + 8, o.r * 1.05, o.r * 0.82, 0, Math.PI, 0);
            ctx.quadraticCurveTo(o.x + o.r * 1.1, o.y + o.r * 0.6, o.x, o.y + o.r * 0.7);
            ctx.quadraticCurveTo(o.x - o.r * 1.1, o.y + o.r * 0.6, o.x - o.r * 1.05, o.y + 8);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.beginPath();
            ctx.ellipse(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.45, o.r * 0.25, -0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.beginPath();
            ctx.ellipse(o.x + o.r * 0.35, o.y + o.r * 0.2, o.r * 0.5, o.r * 0.3, 0.3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            const top = o.y - o.trunkH;
            ctx.fillStyle = '#6b4a2f';
            ctx.beginPath();
            ctx.moveTo(o.x - 15, o.y + 4);
            ctx.lineTo(o.x - 9, top);
            ctx.lineTo(o.x + 9, top);
            ctx.lineTo(o.x + 15, o.y + 4);
            ctx.closePath();
            ctx.fill();
            const cy = top - 30;
            ctx.fillStyle = pal.grassDark;
            ctx.beginPath();
            ctx.arc(o.x, cy, o.canopyR, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = pal.grass;
            ctx.beginPath();
            ctx.arc(o.x - 22, cy - 18, o.canopyR * 0.62, 0, Math.PI * 2);
            ctx.arc(o.x + 26, cy - 8, o.canopyR * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawArrowShape(x, y, angle, len = 48) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Shaft
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(-4, 0);
    ctx.stroke();
    // Head
    ctx.fillStyle = '#d8dde3';
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(-8, -5);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-8, 5);
    ctx.closePath();
    ctx.fill();
    // Fletching
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.moveTo(-len + 2, 0);
    ctx.lineTo(-len - 6, -7);
    ctx.lineTo(-len + 12, 0);
    ctx.lineTo(-len - 6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawArcher(a, aiming) {
    const skin = '#f0c79a';
    const main = a.color;
    const dark = a.dark;
    ctx.save();
    ctx.translate(a.x, a.y);

    // Shadow stays flat on the ground even when the archer falls
    ctx.save();
    ctx.scale(1 + a.fall * 1.6, 0.25);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(-a.facing * a.fall * 30 / (1 + a.fall * 1.6), 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (a.fall) ctx.rotate(-a.facing * a.fall * (Math.PI / 2) * 0.95);
    ctx.scale(a.facing, 1);
    const bob = a.dead ? 0 : Math.sin(a.breath) * 1.2;
    const fl = a.flinch * 5;
    ctx.translate(-fl, 0);

    // Legs
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -36);
    ctx.lineTo(-10, -2);
    ctx.moveTo(4, -36);
    ctx.lineTo(10, -2);
    ctx.stroke();
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(-15, -4, 10, 5);
    ctx.fillRect(6, -4, 11, 5);

    // Quiver
    ctx.save();
    ctx.translate(-10, -66 + bob);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(-5, -10, 10, 30);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3, -10);
        ctx.lineTo(i * 3 - 2, -18);
        ctx.stroke();
    }
    ctx.restore();

    // Body (tunic)
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.moveTo(-12, -38);
    ctx.lineTo(-10, -72 + bob);
    ctx.quadraticCurveTo(0, -78 + bob, 10, -72 + bob);
    ctx.lineTo(12, -38);
    ctx.quadraticCurveTo(0, -32, -12, -38);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-12, -46, 24, 5);

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, HEAD_Y + bob, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
    // Hood / hat
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(0, HEAD_Y + bob - 2, HEAD_R + 1.5, Math.PI * 1.05, Math.PI * 2.05);
    ctx.lineTo(-HEAD_R - 6, HEAD_Y + bob + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1e2126';
    ctx.beginPath();
    ctx.arc(5, HEAD_Y + bob + 1, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Stuck arrows
    for (const s of a.stuck) drawArrowShape(s.rx, s.ry, s.angle, 30);

    // Bow arm and bow, rotated to the aim angle (in facing-local space)
    const local = a.facing > 0 ? a.aim : Math.PI - a.aim;
    const sx = 2, sy = -64 + bob;
    const armLen = 22;
    const hx = sx + Math.cos(local) * armLen, hy = sy + Math.sin(local) * armLen;
    const pull = 6 + a.draw * 20;
    const nx = hx - Math.cos(local) * pull, ny = hy - Math.sin(local) * pull;

    // Draw arm (back hand to string)
    ctx.strokeStyle = skin;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    // Bow arm
    ctx.strokeStyle = main;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    if (!a.dead) {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(local);
        const bend = 26;
        const tipBack = -8 + -a.draw * 4;
        // Bow limbs
        ctx.strokeStyle = '#6b4424';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tipBack, -bend);
        ctx.quadraticCurveTo(10, 0, tipBack, bend);
        ctx.stroke();
        // String to the pull point
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tipBack, -bend);
        ctx.lineTo(-pull, 0);
        ctx.lineTo(tipBack, bend);
        ctx.stroke();
        ctx.restore();
        // Nocked arrow while it's this archer's turn
        if (aiming) drawArrowShape(hx + Math.cos(local) * 12, hy + Math.sin(local) * 12, local, 44);
    }
    ctx.restore();
}

function drawTrajectoryPreview(p, shot) {
    const world = E.world;
    const h = bowHand(p);
    let x = h.x, y = h.y, vx = Math.cos(shot.angle) * shot.speed, vy = Math.sin(shot.angle) * shot.speed;
    const dt = 1 / 60;
    const total = 14; // only the first part of the arc, so aiming still takes skill
    for (let i = 0; i < total; i++) {
        for (let k = 0; k < 2; k++) {
            vx += world.wind * WIND_ACC * dt * 0.5;
            vy += G * dt * 0.5;
            x += vx * dt * 0.5;
            y += vy * dt * 0.5;
        }
        if (i % 2) continue;
        ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - i / total)})`;
        ctx.beginPath();
        ctx.arc(x, y, 4 - (i / total) * 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Angle and power box. (x, y) is the top-left text anchor in the current transform.
export function drawAimBox(x, y, deg, power) {
    const pct = Math.round(power * 100);
    ctx.font = '800 20px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(x - 10, y - 24, 132, 58, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(`${deg}°`, x, y);
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('angle', x + 50, y);
    // Power bar
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(x, y + 12, 110, 9, 5);
    ctx.fill();
    const hue = lerp(140, 10, power);
    ctx.fillStyle = `hsl(${hue}, 75%, 55%)`;
    roundRect(x, y + 12, 110 * power, 9, 5);
    ctx.fill();
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${pct}% power`, x, y + 36);
}

function drawAimReadout(p, shot) {
    drawAimBox(p.x - 20, p.y - 150, Math.round(-shot.angle * 180 / Math.PI), shot.power);
}

export function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawArrows() {
    for (const ar of E.world.arrows) {
        if (ar.gone) continue;
        if (!ar.stuck) {
            // Motion trail
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ar.trail.forEach((t, i) => (i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y)));
            ctx.stroke();
            drawArrowShape(ar.x, ar.y, Math.atan2(ar.vy, ar.vx));
        } else {
            // Embedded arrows sink in a little
            drawArrowShape(ar.x + Math.cos(ar.angle) * 8, ar.y + Math.sin(ar.angle) * 8, ar.angle);
        }
    }
}

function drawParticlesAndTexts(dt) {
    const world = E.world;
    for (const p of world.particles) {
        p.life -= dt;
        p.vy += 700 * dt;
        p.vx *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        if (p.leaf) {
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r * 1.6, p.r * 0.8, p.x * 0.1, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
        }
    }
    ctx.globalAlpha = 1;
    world.particles = world.particles.filter(p => p.life > 0);

    ctx.textAlign = 'center';
    for (const t of world.texts) {
        t.life -= dt;
        t.y -= 40 * dt;
        ctx.globalAlpha = clamp(t.life, 0, 1);
        ctx.font = '900 34px Inter, sans-serif';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.font = '800 14px Inter, sans-serif';
        ctx.strokeText(t.sub, t.x, t.y + 20);
        ctx.fillText(t.sub, t.x, t.y + 20);
    }
    ctx.globalAlpha = 1;
    world.texts = world.texts.filter(t => t.life > 0);
}

// opts: { isAiming(a), preview: { archer, shot, readout } | null, overlay() }
export function render(dt, opts) {
    const pal = E.world.palette;
    drawSky();
    drawClouds(dt);
    drawHills(0.2, pal.far, 470, 80, 0.0025, 1.3);
    drawHills(0.45, pal.mid, 540, 55, 0.004, 4.1);
    drawGround();
    drawObstacles();
    worldTransform(1);
    for (const a of E.world.archers) drawArcher(a, opts.isAiming(a));
    drawArrows();
    if (opts.preview) {
        drawTrajectoryPreview(opts.preview.archer, opts.preview.shot);
        if (opts.preview.readout) drawAimReadout(opts.preview.archer, opts.preview.shot);
    }
    drawParticlesAndTexts(dt);
    if (opts.overlay) opts.overlay();
}
