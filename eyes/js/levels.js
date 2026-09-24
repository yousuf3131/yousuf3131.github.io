// Level data and the rules both browsers share.
//
// Every level is a tile grid, top row = the far (north) end where the goal is. One character per tile:
//   .  void (fall)            #  floor               S  start          G  goal pad
//   C  checkpoint flag        F  fake tile (drops)   K  cracked tile (collapses a moment after you step on it)
//   W  wall block             |  narrow beam N-S     -  narrow beam E-W
//   ^ v < >  conveyor belt pushing that way
// Anything else is looked up in the level's legend: hazards, doors, bridges, moving platforms and switches.
//
// Hazards are pure functions of level time, so both players see them in the same phase without
// streaming them. Switches the guide flips can pause hazards; that shifts a hazard's own clock.

export const T = 2;              // tile size in world units
export const LIGHT_R = 1.7;      // radius of the walker's light: just themselves, the dark hides everything else
export const PIVOT_Y = 4.4;      // hammer pivot height
export const CRUSH_TOP = 3.2;    // crusher resting height (bottom face)
export const WALKER_R = 0.32;
export const SWITCH_COLORS = { door: 0x35d6ff, bridge: 0xb48cff, pause: 0xffb938 };

const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

export const LEVELS = [
    {
        name: 'Lights Out',
        hint: 'A gentle start. The guide opens the door with the switch.',
        par: [35, 70],
        grid: [
            '......#G#..',
            '......###..',
            '......#a#1.',
            '......###..',
            '......F#F..',
            '......###..',
            '......###..',
            '...........',
            '......###..',
            '......#C#..',
            '..######F..',
            '..#####....',
            '..#F#......',
            '..###......',
            '..#S#......',
        ],
        legend: {
            a: { type: 'door', sw: 0 },
            1: { type: 'switch', id: 0, kind: 'door', dur: 0 },
        },
    },
    {
        name: 'Crumble Walk',
        hint: 'Fake tiles everywhere. Only the guide can tell which ones are real.',
        par: [50, 95],
        grid: [
            '....#G#....',
            '....###....',
            '.....|.....',
            '.....|.....',
            '.....|.....',
            '....###....',
            '....#C#....',
            '.....K.....',
            '.....K.....',
            '.....K.....',
            '.....K.....',
            '...#####...',
            '...##C##...',
            '...#####...',
            '..FF#FFFF..',
            '..FF###FF..',
            '..#FFF#FF..',
            '..F####F#..',
            '..F#FFF#F..',
            '..#######..',
            '...##S##...',
        ],
        legend: {},
    },
    {
        name: 'Swing Shift',
        hint: 'Hammers, spinning blades and a belt that pulls you to the edge.',
        par: [55, 100],
        grid: [
            '....#G#....',
            '....###....',
            '....#x#....',
            '....###....',
            '....#y#....',
            '....###....',
            '...##C##...',
            '...<<<<<...',
            '...<<<<<...',
            '...<<<<<...',
            '...#####...',
            '....###....',
            '...W#h#W2..',
            '....###....',
            '...W#i#W...',
            '....###....',
            '...W#j#W...',
            '....###....',
            '....#C#....',
            '....###....',
            '....#S#....',
        ],
        legend: {
            x: { type: 'blade', speed: 2.0, phase: 0 },
            y: { type: 'blade', speed: -2.3, phase: 0.25 },
            h: { type: 'hammer', period: 3.0, phase: 0, grp: 2 },
            i: { type: 'hammer', period: 3.0, phase: 0.33, grp: 2 },
            j: { type: 'hammer', period: 3.0, phase: 0.66, grp: 2 },
            2: { type: 'switch', id: 2, kind: 'pause', dur: 4 },
        },
    },
    {
        name: 'Laser Lines',
        hint: 'Ride the platforms, time the lasers, and let the guide lay the bridge.',
        par: [60, 110],
        grid: [
            '......#G#....',
            '......###....',
            '......L##....',
            '......###....',
            '......M##....',
            '......###....',
            '......N##....',
            '......###....',
            '......#C#....',
            '.......b.....',
            '.......b..3..',
            '.......b.....',
            '......###....',
            '.............',
            '.............',
            '.............',
            '.......p.....',
            '......###....',
            '......#C#....',
            '......###....',
            '.###q..###...',
            '.###...###...',
            '.#S#.........',
        ],
        legend: {
            L: { type: 'laser', span: 3, period: 2.6, on: 0.45, phase: 0 },
            M: { type: 'laser', span: 3, period: 2.6, on: 0.45, phase: 0.35 },
            N: { type: 'laser', span: 3, period: 2.6, on: 0.45, phase: 0.7 },
            b: { type: 'bridge', sw: 3 },
            3: { type: 'switch', id: 3, kind: 'bridge', dur: 8 },
            p: { type: 'plat', to: [0, -3], period: 6, phase: 0 },
            q: { type: 'plat', to: [2, 0], period: 5, phase: 0 },
        },
    },
    {
        name: 'Crusher Works',
        hint: 'Beams, belts and three crushers. The door only stays open for a few seconds.',
        par: [70, 120],
        grid: [
            '.....#G#.....',
            '.....###.....',
            '.....###.....',
            '.....kmn.....',
            '.....###.....',
            '.....#a#..4..',
            '.....###.....',
            '.....#C#.....',
            '......|......',
            '......|......',
            '......|......',
            '....>>>>>....',
            '....>>>>>....',
            '....>>>>>....',
            '....##F##....',
            '....W#h#W....',
            '....#F#F#....',
            '....##C##....',
            '....#####....',
            '....#FKF#....',
            '....#K#K#....',
            '....F###F....',
            '.....#S#.....',
        ],
        legend: {
            k: { type: 'crusher', period: 2.4, phase: 0 },
            m: { type: 'crusher', period: 2.4, phase: 0.33 },
            n: { type: 'crusher', period: 2.4, phase: 0.66 },
            a: { type: 'door', sw: 4 },
            4: { type: 'switch', id: 4, kind: 'door', dur: 6 },
            h: { type: 'hammer', period: 2.8, phase: 0.2 },
        },
    },
    {
        name: 'The Gauntlet',
        hint: 'Everything at once. Good luck, both of you.',
        par: [100, 170],
        grid: [
            '.....#G#.....',
            '.....###.....',
            '.....L##.....',
            '.....###.....',
            '.....#x#.....',
            '.....###.....',
            '......b......',
            '......b...5..',
            '.....#C#.....',
            '.....###.....',
            '.....kmn.....',
            '.....###.....',
            '....W#h#W....',
            '.....###.....',
            '....W#i#W.6..',
            '.....###.....',
            '.....#C#.....',
            '.............',
            '.............',
            '......p......',
            '.....#C#.....',
            '.....KKK.....',
            '....F#FF#....',
            '....F#F##....',
            '....<<<<<....',
            '....<<<<<....',
            '.....#C#.....',
            '.....#y#.....',
            '.....###.....',
            '.....#a#..7..',
            '.....###.....',
            '.....#S#.....',
        ],
        legend: {
            L: { type: 'laser', span: 3, period: 2.2, on: 0.5, phase: 0.1 },
            x: { type: 'blade', speed: 2.4, phase: 0 },
            b: { type: 'bridge', sw: 5 },
            5: { type: 'switch', id: 5, kind: 'bridge', dur: 8 },
            k: { type: 'crusher', period: 2.4, phase: 0 },
            m: { type: 'crusher', period: 2.4, phase: 0.33 },
            n: { type: 'crusher', period: 2.4, phase: 0.66 },
            h: { type: 'hammer', period: 2.8, phase: 0, grp: 6 },
            i: { type: 'hammer', period: 2.8, phase: 0.5, grp: 6 },
            6: { type: 'switch', id: 6, kind: 'pause', dur: 4 },
            p: { type: 'plat', to: [0, -2], period: 4.5, phase: 0 },
            y: { type: 'blade', speed: -2.0, phase: 0.1 },
            a: { type: 'door', sw: 7 },
            7: { type: 'switch', id: 7, kind: 'door', dur: 0 },
        },
    },
];

// A tiny room for the menu backdrop
export const MENU_LEVEL = {
    name: 'Menu',
    par: [1, 1],
    grid: [
        '.......',
        '..###..',
        '.##F##.',
        '.#####.',
        '.##S##.',
        '.#####.',
        '..###..',
    ],
    legend: {},
};

const DEFAULTS = {
    hammer: { period: 3, phase: 0, amp: 0.73, len: 3.6 },
    blade: { speed: 2, phase: 0, len: 2.7 },
    laser: { span: 3, period: 2.6, on: 0.45, phase: 0 },
    crusher: { period: 2.6, phase: 0 },
    plat: { to: [0, -3], period: 5, phase: 0 },
};

const BASIC = {
    '#': 'floor', S: 'start', G: 'goal', C: 'cp', F: 'fake', K: 'crack', W: 'wall',
    '|': 'beamNS', '-': 'beamEW', '^': 'conv', v: 'conv', '<': 'conv', '>': 'conv',
};
const CONV_DIR = { '^': [0, -1], v: [0, 1], '<': [-1, 0], '>': [1, 0] };

// ============================================================
// Parsing
// ============================================================
export function parseLevel(def, index = 0) {
    const rows = def.grid.length;
    const cols = Math.max(...def.grid.map(r => r.length));
    const L = {
        def, index, name: def.name, rows, cols, tiles: [], hazards: [], plats: [], switches: [],
        doors: [], bridges: [], cps: [], dyn: [], start: null, goal: null,
        width: cols * T, depth: rows * T,
    };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const ch = def.grid[r][c] || '.';
            const x = c * T, z = r * T;
            const tile = { i: r * cols + c, c, r, x, z, ch, kind: 'void' };
            const leg = def.legend && def.legend[ch];
            if (leg) {
                const t = leg.type;
                if (t === 'hammer' || t === 'blade' || t === 'laser' || t === 'crusher') {
                    tile.kind = 'floor';
                    const h = { ...DEFAULTS[t], ...leg, x, z, c, r, id: L.hazards.length };
                    if (t === 'laser') { h.x0 = x - T / 2; h.x1 = h.x0 + h.span * T; }
                    L.hazards.push(h);
                } else if (t === 'plat') {
                    const p = { ...DEFAULTS.plat, ...leg, c, r, id: L.plats.length };
                    p.ax = x; p.az = z; p.bx = x + p.to[0] * T; p.bz = z + p.to[1] * T;
                    L.plats.push(p);
                } else if (t === 'door') {
                    tile.kind = 'door';
                    tile.sw = leg.sw;
                    L.doors.push(tile);
                } else if (t === 'bridge') {
                    tile.kind = 'bridge';
                    tile.sw = leg.sw;
                    L.bridges.push(tile);
                } else if (t === 'switch') {
                    tile.kind = 'switch';
                    L.switches.push({ id: leg.id, kind: leg.kind, dur: leg.dur || 0, x, z, c, r, idx: L.switches.length });
                }
            } else if (BASIC[ch]) {
                tile.kind = BASIC[ch];
                if (tile.kind === 'conv') tile.dir = CONV_DIR[ch];
            }
            if (tile.kind === 'start') L.start = tile;
            if (tile.kind === 'goal') L.goal = tile;
            if (tile.kind === 'cp') { tile.cp = L.cps.length; L.cps.push(tile); }
            if (tile.kind === 'fake' || tile.kind === 'crack') { tile.dyn = L.dyn.length; L.dyn.push(tile); }
            L.tiles.push(tile);
        }
    }
    if (!L.start) L.start = L.tiles.find(t => t.kind === 'floor');
    return L;
}

export function tileAt(L, x, z) {
    const c = Math.round(x / T), r = Math.round(z / T);
    if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return null;
    return L.tiles[r * L.cols + c];
}
export const tileRC = (L, c, r) => (c < 0 || r < 0 || c >= L.cols || r >= L.rows ? null : L.tiles[r * L.cols + c]);

// ============================================================
// Switches. State is a small plain object the host owns and broadcasts whole.
// ============================================================
export function newSwitchState(L) {
    return { seq: 0, list: L.switches.map(() => ({ on: false, at: -99, until: 0, pauses: [] })) };
}

const swIndex = (L, id) => L.switches.findIndex(s => s.id === id);

// Door and bridge switches: active while on (toggle) or for `dur` seconds after a press
export function switchActive(L, S, id, lt) {
    const i = swIndex(L, id);
    if (i < 0 || !S) return false;
    const s = S.list[i];
    return s.on && lt < s.until;
}

// Returns true if the press changed anything
export function pressSwitch(L, S, idx, lt) {
    const sw = L.switches[idx], s = S.list[idx];
    if (!sw || !s) return false;
    if (sw.kind === 'pause') {
        if (lt < s.at + sw.dur + 2) return false;
        s.at = lt;
        s.pauses.push([lt, lt + sw.dur]);
        if (s.pauses.length > 20) s.pauses.shift();
        s.on = true;
        s.until = lt + sw.dur;
    } else if (sw.dur > 0) {
        if (s.on && lt < s.until) return false;
        s.on = true;
        s.at = lt;
        s.until = lt + sw.dur;
    } else {
        s.on = !s.on;
        s.at = lt;
        s.until = s.on ? 1e9 : 0;
    }
    S.seq++;
    return true;
}

// Seconds of the level so far during which hazard group `grp` has been paused
function pausedFor(L, S, grp, lt) {
    if (grp == null || !S) return 0;
    const i = swIndex(L, grp);
    if (i < 0) return 0;
    let sum = 0;
    for (const [a, b] of S.list[i].pauses) if (lt > a) sum += Math.min(lt, b) - a;
    return sum;
}
export const hazTime = (L, S, h, lt) => lt - pausedFor(L, S, h.grp, lt);
export function isPaused(L, S, h, lt) {
    if (h.grp == null || !S) return false;
    const i = swIndex(L, h.grp);
    return i >= 0 && S.list[i].pauses.some(([a, b]) => lt >= a && lt < b);
}

// ============================================================
// Hazard motion (t = the hazard's own clock)
// ============================================================
export const hammerAngle = (h, t) => h.amp * Math.sin(TAU * (t / h.period + h.phase));
export function hammerHead(h, t) {
    const a = hammerAngle(h, t);
    return { x: h.x + Math.sin(a) * h.len, y: PIVOT_Y - Math.cos(a) * h.len, z: h.z, a };
}
export const bladeAngle = (h, t) => h.phase * TAU + h.speed * t;
export const laserPhase = (h, t) => frac(t / h.period + h.phase);
export const laserOn = (h, t) => laserPhase(h, t) < h.on;
// Seconds until the laser switches on (0 while it is on)
export function laserWarn(h, t) {
    const u = laserPhase(h, t);
    return u < h.on ? 0 : (1 - u) * h.period;
}
export function crusherY(h, t) {
    const u = frac(t / h.period + h.phase);
    if (u < 0.45) return CRUSH_TOP;
    if (u < 0.55) { const k = (u - 0.45) / 0.1; return CRUSH_TOP * (1 - k * k); }
    if (u < 0.75) return 0;
    const k = (u - 0.75) / 0.25;
    return CRUSH_TOP * k * k * (3 - 2 * k);
}
// Seconds until the next slam starts (for the guide's warning)
export function crusherWarn(h, t) {
    const u = frac(t / h.period + h.phase);
    return (u <= 0.45 ? 0.45 - u : 1.45 - u) * h.period;
}
export function platPos(p, t) {
    const s = 0.5 - 0.5 * Math.cos(TAU * (t / p.period + p.phase));
    return { x: p.ax + (p.bx - p.ax) * s, z: p.az + (p.bz - p.az) * s };
}

// ============================================================
// Cracked and fake tiles. `trig` = level time the walker first stood on it (or null).
// ============================================================
export const DYN = { fake: { shake: 0.12, gone: 3.6 }, crack: { shake: 0.65, gone: 4.6 } };
export function dynPhase(tile, trig, lt) {
    if (trig == null) return 'solid';
    const d = lt - trig, k = DYN[tile.kind];
    if (d < 0) return 'solid';
    if (d < k.shake) return 'shake';
    if (d < k.gone) return 'fallen';
    return 'reset';
}

// ============================================================
// Physics queries used by the walker (the authority) and by the bot guide
// ============================================================
export function groundAt(L, S, dyn, lt, x, z) {
    for (const p of L.plats) {
        const q = platPos(p, lt);
        if (Math.abs(x - q.x) < 1.0 && Math.abs(z - q.z) < 1.0) return { kind: 'plat', plat: p };
    }
    const tile = tileAt(L, x, z);
    if (!tile) return null;
    switch (tile.kind) {
        case 'void': return null;
        case 'beamNS': return Math.abs(x - tile.x) < 0.42 ? { kind: 'beam', tile } : null;
        case 'beamEW': return Math.abs(z - tile.z) < 0.42 ? { kind: 'beam', tile } : null;
        case 'bridge': return switchActive(L, S, tile.sw, lt - 0.35) ? { kind: 'bridge', tile } : null;
        case 'fake':
        case 'crack': {
            const ph = dynPhase(tile, dyn[tile.dyn], lt);
            return ph === 'fallen' ? null : { kind: tile.kind, tile };
        }
        default: return { kind: tile.kind, tile };
    }
}

// Walls and closed doors stop you
export function blockedAt(L, S, lt, x, z) {
    const tile = tileAt(L, x, z);
    if (!tile) return false;
    if (tile.kind === 'wall') return true;
    if (tile.kind === 'door') return !switchActive(L, S, tile.sw, lt);
    return false;
}

// Which hazard (if any) hits a walker standing at (x, y, z)
export function hazardHit(L, S, lt, x, y, z) {
    for (const h of L.hazards) {
        const t = hazTime(L, S, h, lt);
        if (h.type === 'hammer') {
            const hd = hammerHead(h, t);
            // head is a 1.4 x 1.1 x 1.1 drum; the walker is about 1.45 tall
            if (Math.abs(x - hd.x) < 0.98 && Math.abs(z - hd.z) < 0.85 && hd.y - 0.55 < y + 1.45 && hd.y + 0.55 > y) return h;
        } else if (h.type === 'blade') {
            if (y > 0.5) continue;
            const a = bladeAngle(h, t), dx = x - h.x, dz = z - h.z;
            const along = dx * Math.cos(a) + dz * Math.sin(a), perp = Math.abs(-dx * Math.sin(a) + dz * Math.cos(a));
            if (Math.abs(along) < h.len + 0.2 && perp < 0.42) return h;
        } else if (h.type === 'laser') {
            if (laserOn(h, t) && Math.abs(z - h.z) < 0.34 && x > h.x0 - 0.1 && x < h.x1 + 0.1 && y < 1.9) return h;
        } else if (h.type === 'crusher') {
            if (Math.abs(x - h.x) < 1.05 && Math.abs(z - h.z) < 1.05 && crusherY(h, t) < y + 1.25) return h;
        }
    }
    return null;
}

// ============================================================
// Route for the practice bot: distance to the goal from every tile, jumps over single gaps
// ============================================================
const PASS = { floor: 1, start: 1, goal: 1, cp: 1, conv: 1.4, beamNS: 1.3, beamEW: 1.3, door: 1.2, bridge: 1.2, crack: 2.5 };

export function buildRoute(L) {
    const n = L.tiles.length;
    const platCells = new Map();
    for (const p of L.plats) {
        const steps = Math.max(Math.abs(p.to[0]), Math.abs(p.to[1]));
        for (let k = 0; k <= steps; k++) {
            const c = p.c + Math.sign(p.to[0]) * k, r = p.r + Math.sign(p.to[1]) * k;
            platCells.set(r * L.cols + c, p);
        }
    }
    const cost = i => {
        const t = L.tiles[i];
        if (platCells.has(i)) return 2;
        return PASS[t.kind] || 0;
    };
    const dist = new Float32Array(n).fill(Infinity);
    const next = new Array(n).fill(null);
    const g = L.goal.i;
    dist[g] = 0;
    const open = [g];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (open.length) {
        // Small grids: a linear scan for the cheapest node is plenty fast
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
        const cur = open.splice(bi, 1)[0];
        const ct = L.tiles[cur];
        for (const [dc, dr] of dirs) {
            const nb = tileRC(L, ct.c + dc, ct.r + dr);
            if (!nb) continue;
            let from = null, w = 0, jump = false;
            if (cost(nb.i) > 0) { from = nb; w = cost(nb.i); }
            else if (nb.kind === 'void' && !platCells.has(nb.i)) {
                // A one-tile gap: you can jump it from the tile beyond
                const far = tileRC(L, ct.c + dc * 2, ct.r + dr * 2);
                if (far && cost(far.i) > 0 && !platCells.has(far.i) && cost(cur) > 0 && !platCells.has(cur)) { from = far; w = 3; jump = true; }
            }
            if (!from) continue;
            const d = dist[cur] + w;
            if (d < dist[from.i]) {
                dist[from.i] = d;
                next[from.i] = { to: cur, jump, plat: platCells.get(cur) || null };
                if (!open.includes(from.i)) open.push(from.i);
            }
        }
    }
    return { dist, next, platCells };
}

// Does something deadly cover the middle of this tile in the next `ahead` seconds?
export function tileDanger(L, S, lt, tile, ahead = 0.7, xOverride) {
    for (let k = 0; k <= ahead + 1e-6; k += 0.1) {
        const x = xOverride != null ? xOverride : tile.x;
        for (const dz of [-0.6, 0, 0.6]) {
            const h = hazardHit(L, S, lt + k, x, 0, tile.z + dz);
            if (h) return h;
        }
    }
    return null;
}

// Stars: 3 = under the first par time with at most one fall, 2 = under the second with at most four
export function starsFor(def, time, deaths) {
    if (time <= def.par[0] && deaths <= 1) return 3;
    if (time <= def.par[1] && deaths <= 4) return 2;
    return 1;
}
