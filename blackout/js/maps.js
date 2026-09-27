// Blackout maps. Each map is a grid of 2m tiles drawn as text, plus its mood (light, fog, weather).
//
//   .  open ground        ,  dirt path           i  indoor floor        g  grass patch
//   c  corn (slow, hides you and blocks sight)   L  lamp (walkable)
//   S  survivor spawn     H  hunter spawn
//   #  wall               T  pine tree           ~  water               x  shipping container
//   v  car wreck          f  fence               o  silo / rock / tyres F  campfire
//   =  furniture (bed, table, bench)

export const TILE = 2;

export const MAPS = [
    {
        id: 'camp', name: 'Pinewood Camp',
        blurb: 'A summer camp deep in the pines. Cabins, a black lake and one dying campfire.',
        ground: 'grass', border: 'T', weather: 'mist', props: 'forest',
        wall: 'logs', floor: 'planks', rock: 'rock',
        sky: 0x05070d, fog: 0x070a10, fogDensity: 0.045,
        moon: { color: 0x9fb4ff, intensity: 1.7 }, ambient: 0x5a6c9a,
        rows: [
            'TT....TT....TTT.........TT.......TTT..TT',
            'T..........T.......#####i####.......T..T',
            '..S..,,,,,,,,,,,,,,#iiiiiiii#...........',
            '.....,......T......#i==ii==i#....o....T.',
            'T....,.............#iiiiiiii#.........TT',
            'T....,......o......####ii####.....S...T.',
            '..T..,...................,,,,,,,,,,.....',
            '.....,..........L........,.......,....T.',
            '....###i###..............,.......,......',
            '....#iiiii#.....~~~~~....,....T..,..T...',
            '....#i=ii=#...~~~~~~~~...,.......,......',
            'T...#iiiii#..~~~~~~~~~~..,...###i###...T',
            'T...###i###..~~~~~~~~~~..,...#iiiii#...T',
            '.......,......~~~~~~~~...,...#i=i=i#....',
            '..T....,,,,,,,,,~~~~,,,,,F,,,iiiiii#....',
            '..............,.........,....#######..T.',
            '...o..........,.....H...,...............',
            'T.............,.........,.....L....T...T',
            'TT....T.......,,,,,,,,,,,,,,,,,,,,,,,..T',
            'T.............,.......T.........,.......',
            '....####i####.,...........o.....,...S...',
            '....#iiiiiii#.,.....TT..........,......T',
            '....#i=i=i=i#.,.................,.....TT',
            '....#iiiiiii#.L......####i####..,.......',
            '....#########........#iiiiiii#..,....T..',
            '..S........T.........#i==i==i#.S,.......',
            'T.....o..............#iiiiiii#..,,,,,,.T',
            'TT........TT.........#########.......TTT',
        ],
    },
    {
        id: 'farm', name: 'Harlow Farm',
        blurb: 'Rain over endless corn. Nobody can see you in the rows, and you can\'t see them either.',
        ground: 'dirt', border: 'c', weather: 'rain', props: 'farm',
        wall: 'barn', floor: 'planks', rock: 'silo',
        sky: 0x06070a, fog: 0x0a0c10, fogDensity: 0.05,
        moon: { color: 0xa8b8d8, intensity: 1.4 }, ambient: 0x56627e,
        rows: [
            'cccccccccccc.......ffffffffff....cccccccc',
            'cccccccccccc.S.....f........f....cccccccc',
            'cc.ccccc.ccc.......f..v.....f....cc.ccccc',
            'cc.ccccc.ccc.......f........f....cc.ccccc',
            'cc.ccccc.ccc.......ffff..ffff....cc.ccccc',
            'cc.ccccc.ccc.....................cc.ccccc',
            'cc.......ccc...######i######.....cc....cc',
            'cccccccc.ccc...#iiiiiiiiiii#.....ccccc.cc',
            'cccccccc.......#i=iiiii=iii#..o..ccccc.cc',
            '...............iiiiiiiiiiiii.....ccccc.cc',
            '..o..o.........#iiiiiiiiiii#..o..........',
            '...............#i==iiiii==i#.............',
            '.L.............######i######.....L.......',
            '.....,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.',
            '.....,......................H........,...',
            'ccccc,cccccccccc...v......cccccccccc,cccc',
            'ccccc,cccccccccc..........cccccccccc,cccc',
            'c.....cc...ccccc..####i##.cccc...ccc,cccc',
            'c.cccccc.c.ccccc..#iiiii#.cccc.c.ccc,cccc',
            'c.cccccc.c.ccccc..#i=i=i#.cccc.c.ccc,cccc',
            'c.....cc.c........#iiiii#......c....,....',
            'cccc.ccc.ccccccc..#######.cccc.cccc.,.S..',
            'cccc.....ccccccc..........cccc.cccc.,....',
            'cccccccc.ccccccc..S..ff.f.cccc......,..v.',
            'cccccccc.ccccccc.....f..f.cccccccccc,....',
            '...S.....ccccccc.....ffff.cccccccccc.....',
        ],
    },
    {
        id: 'asylum', name: 'St. Agnes Asylum',
        blurb: 'Closed since 1974. Long halls, flickering lights and far too many doors.',
        ground: 'tiles', border: '#', weather: 'dust', props: 'asylum',
        wall: 'plaster', floor: 'tiles', rock: 'rock',
        sky: 0x040404, fog: 0x07080a, fogDensity: 0.05,
        moon: { color: 0x8fa0c0, intensity: 0.9 }, ambient: 0x4e5666, indoor: true,
        rows: [
            '########################################',
            '#S.....#......#..........#......#.....S#',
            '#.=.=..#.=.=..#....==....#..=.=.#.=.=..#',
            '#......#......#..........#......#......#',
            '#..L...#...L..#....L.....#..L...#...L..#',
            '###.#####.#######.....######.#####.#####',
            '#......................................#',
            '#...L..........L.............L......L..#',
            '#......................................#',
            '###.####.####.###.gggggg.###.####.####.#',
            '#......#.#......#.gggggg.#......#.#....#',
            '#.=.=..#.#..=...#.gg~~gg.#.=.=..#.#.=..#',
            '#......#.#......#.gg~~gg.#......#.#....#',
            '#..L......L.......gggggg....L.......L..#',
            '#......#.#......#.gggggg.#......#.#....#',
            '###.####.####.###........###.####.####.#',
            '#............................H.........#',
            '#...L.............L..............L.....#',
            '#......................................#',
            '###.#####.#######.....######.#####.#####',
            '#......#......#..........#......#......#',
            '#.=.=..#..=.=.#....==....#.=..=.#.=.=..#',
            '#..L...#...L..#....L.....#...L..#...L..#',
            '#S.....#......#..........#......#.....S#',
            '########################################',
        ],
    },
    {
        id: 'yard', name: 'Rust Yard',
        blurb: 'A scrapyard maze of stacked containers under failing floodlights.',
        ground: 'gravel', border: 'f', weather: 'none', props: 'yard',
        wall: 'brick', floor: 'concrete', rock: 'tyres',
        sky: 0x07070a, fog: 0x0b0a0c, fogDensity: 0.042,
        moon: { color: 0xb0b4c8, intensity: 1.6 }, ambient: 0x5a5868,
        rows: [
            'xxxx....vv......xxxxxxxx.....vv....xxxxx',
            'xxxx.S..........xxxxxxxx.........S.xxxxx',
            '........xxxx.............xxxx...........',
            '..vv....xxxx....o....o...xxxx....vv.....',
            '........xxxx.............xxxx...........',
            '.....L...............L..............L...',
            'xxxxxx.....vv...xxxxxx.......xxxxxx.....',
            'xxxxxx..........xxxxxx...o...xxxxxx..o..',
            '........o.......................vv......',
            '...xxxx.....######i####...............xx',
            '...xxxx.....#iiiiiiiii#....xxxx..vv...xx',
            '...xxxx..L..#i==iii=ii#....xxxx.......xx',
            '............#iiiiiiiii#..H.xxxx.........',
            '..vv........###i#######.................',
            '........o.............L.......o...xxxxxx',
            'xxxxx.........vv..............~~..xxxxxx',
            'xxxxx...xxxx......xxxxxx.....~~~~.......',
            '.....S..xxxx......xxxxxx......~~...vv...',
            '..o.....xxxx...L..............L.........',
            '..............o.......vv.......xxxx..S..',
            'xxxxxxx...vv.....xxxx..........xxxx.....',
            'xxxxxxx..........xxxx...o......xxxx.....',
        ],
    },
];

// Tiles you can't walk through, and tiles you can't see (or shine a light) through
const BLOCKS = new Set(['#', 'T', '~', 'x', 'v', 'f', 'o', 'F', '=']);
const OPAQUE = new Set(['#', 'T', 'x', 'c', 'o']);
const PAD = 2; // ring of border tiles around every map

export const blocks = ch => BLOCKS.has(ch);
export const opaque = ch => OPAQUE.has(ch);

export function parseMap(def) {
    const inner = Math.max(...def.rows.map(r => r.length));
    const W = inner + PAD * 2, H = def.rows.length + PAD * 2;
    const cells = [];
    for (let r = 0; r < H; r++) {
        let row = '';
        for (let c = 0; c < W; c++) {
            const ir = r - PAD, ic = c - PAD;
            const inside = ir >= 0 && ir < def.rows.length && ic >= 0 && ic < inner;
            row += inside ? (def.rows[ir][ic] || '.') : def.border;
        }
        cells.push(row);
    }
    // The border ring is always solid, even when it's drawn as corn
    const edge = (r, c) => r < PAD || c < PAD || r >= H - PAD || c >= W - PAD;
    const map = {
        def, W, H, cells,
        ox: -W * TILE / 2, oz: -H * TILE / 2,
        at(c, r) { return c < 0 || r < 0 || c >= W || r >= H ? '#' : cells[r][c]; },
        solid(c, r) { return edge(r, c) || blocks(this.at(c, r)); },
        seeThrough(c, r) { return !opaque(this.at(c, r)); },
        col(x) { return Math.floor((x - this.ox) / TILE); },
        row(z) { return Math.floor((z - this.oz) / TILE); },
        cx(c) { return this.ox + (c + 0.5) * TILE; },
        cz(r) { return this.oz + (r + 0.5) * TILE; },
        charAt(x, z) { return this.at(this.col(x), this.row(z)); },
    };
    // Spawn points, lamps, and every open tile (for pickups and wandering bots)
    map.spawnS = []; map.spawnH = []; map.lamps = []; map.open = []; map.fires = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const ch = cells[r][c];
        if (ch === 'S') map.spawnS.push({ c, r });
        if (ch === 'H') map.spawnH.push({ c, r });
        if (ch === 'L') map.lamps.push({ c, r });
        if (ch === 'F') map.fires.push({ c, r });
        if (!map.solid(c, r)) map.open.push({ c, r });
    }
    // Keep only the tiles connected to the survivors' first spawn, so nothing spawns in a sealed pocket
    const start = map.spawnS[0] || map.open[0];
    const dist = distanceField(map, [start]);
    map.open = map.open.filter(t => dist[t.r * W + t.c] >= 0);
    return map;
}

// Walking distance (in tiles) from the given tiles to every tile; -1 where unreachable.
// 8-way moves, but no cutting a corner past a solid tile.
export function distanceField(map, sources) {
    const { W, H } = map;
    const dist = new Int16Array(W * H).fill(-1);
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (const s of sources) {
        if (s.c < 0 || s.r < 0 || s.c >= W || s.r >= H) continue;
        const i = s.r * W + s.c;
        if (dist[i] === -1) { dist[i] = 0; q[tail++] = i; }
    }
    while (head < tail) {
        const i = q[head++];
        const c = i % W, r = (i - c) / W, d = dist[i] + 1;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nc = c + dc, nr = r + dr;
            if (map.solid(nc, nr)) continue;
            if (dr && dc && (map.solid(c + dc, r) || map.solid(c, r + dr))) continue;
            const j = nr * W + nc;
            if (dist[j] !== -1) continue;
            dist[j] = d; q[tail++] = j;
        }
    }
    return dist;
}

// Step downhill on a distance field: the neighbouring tile that is closest to the field's source
export function downhill(map, field, c, r) {
    const W = map.W;
    let best = null, bd = field[r * W + c];
    if (bd < 0) bd = 1e9;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (map.solid(nc, nr)) continue;
        if (dr && dc && (map.solid(c + dc, r) || map.solid(c, r + dr))) continue;
        const d = field[nr * W + nc];
        if (d >= 0 && d < bd) { bd = d; best = { c: nc, r: nr }; }
    }
    return best;
}

// Can a straight line from (x1,z1) to (x2,z2) see through? Walks the tiles the line crosses.
export function lineOfSight(map, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (TILE * 0.25));
    const c2 = map.col(x2), r2 = map.row(z2);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const c = map.col(x1 + dx * t), r = map.row(z1 + dz * t);
        if (c === c2 && r === r2) return true;
        if (!map.seeThrough(c, r)) return false;
    }
    return true;
}

// Push a circle out of every solid tile it overlaps. Returns the corrected position.
export function collide(map, x, z, rad) {
    for (let pass = 0; pass < 2; pass++) {
        const c0 = map.col(x - rad), c1 = map.col(x + rad);
        const r0 = map.row(z - rad), r1 = map.row(z + rad);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            if (!map.solid(c, r)) continue;
            const minx = map.ox + c * TILE, minz = map.oz + r * TILE;
            const px = Math.max(minx, Math.min(x, minx + TILE));
            const pz = Math.max(minz, Math.min(z, minz + TILE));
            let dx = x - px, dz = z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rad * rad) continue;
            if (d2 < 1e-8) {
                // Centre is inside the tile: push out through the nearest face
                const exits = [[x - minx, -1, 0], [minx + TILE - x, 1, 0], [z - minz, 0, -1], [minz + TILE - z, 0, 1]];
                exits.sort((a, b) => a[0] - b[0]);
                x += exits[0][1] * (exits[0][0] + rad); z += exits[0][2] * (exits[0][0] + rad);
                continue;
            }
            const d = Math.sqrt(d2);
            x = px + dx / d * rad; z = pz + dz / d * rad;
        }
    }
    return { x, z };
}
