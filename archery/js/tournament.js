// Single-player tournament: seven opponents, each farther away and more accurate.
import {
    E, $, clamp, lerp, rand, gauss, store, view, ctx, sfx, STAGES, MIN_SPEED, MAX_SPEED, MAX_DRAG,
    buildWorld, fireArrow, updateArrows, animateArchers, dragShot, bestShot, render,
} from './engine.js?v=2';
import { banner, hideBanner } from './ui.js?v=2';

let state = 'menu', stateT = 0, turn = 'player';
let stageIndex = 0;
let hintShown = false;
let onEnd = null;

function newWind() {
    const world = E.world;
    const s = world.st.wind;
    world.wind = Math.round(rand(-s, s) * 20) / 20;
    const kmh = Math.round(Math.abs(world.wind) * 30);
    $('wind').textContent = `${kmh} km/h`;
    $('wind-arrow').style.transform = world.wind < 0 ? 'scaleX(-1)' : 'none';
    $('wind-arrow').style.opacity = kmh === 0 ? 0.3 : 1;
}

function updateHud() {
    const world = E.world;
    const p = world.player, e = world.enemy;
    $('hp-player').style.width = `${(p.hp / p.maxHp) * 100}%`;
    $('hp-enemy').style.width = `${(e.hp / e.maxHp) * 100}%`;
    $('player-hp-text').textContent = p.hp;
    $('enemy-hp-text').textContent = e.hp;
    $('enemy-name').textContent = e.name;
    $('stage').textContent = `${world.stageIndex + 1}/${STAGES.length}`;
}

function startStage(i) {
    stageIndex = i;
    buildWorld(i);
    E.onHit = updateHud;
    newWind();
    updateHud();
    const cam = E.cam;
    cam.x = cam.target = clamp(E.world.player.x - view.ww * 0.3, 0, Math.max(0, E.world.width - view.ww));
    state = 'intro';
    stateT = 1.8;
    banner(E.world.enemy.name, `STAGE ${i + 1}`, '#fff');
}

function beginTurn(who) {
    turn = who;
    state = who === 'player' ? 'aim' : 'enemyThink';
    stateT = who === 'player' ? 0 : 0.7;
    newWind();
    banner(who === 'player' ? 'Your turn' : 'Enemy turn', null, who === 'player' ? '#2ec495' : '#ff7b6e', 1100);
    $('hint').textContent = 'Drag back anywhere, then release to shoot';
    $('hint').classList.toggle('hidden', !(who === 'player' && E.world.stageIndex === 0 && !hintShown));
}

// Enemy picks the best shot it can find, then adds human-like error
function planEnemyShot() {
    const world = E.world;
    const best = bestShot(world.enemy, world.player);
    const err = world.st.err * world.aiErr;
    world.aiErr = Math.max(0.45, world.aiErr * 0.82); // it zeroes in after each shot
    return {
        angle: best.angle + gauss() * 0.1 * err,
        speed: clamp(best.speed * (1 + gauss() * 0.09 * err), MIN_SPEED, MAX_SPEED),
    };
}

function afterShot() {
    const world = E.world;
    const p = world.player, e = world.enemy;
    if (e.dead || p.dead) {
        state = 'ko';
        stateT = 2.2;
        if (e.dead) {
            sfx.win();
            banner(stageIndex + 1 >= STAGES.length ? 'Champion!' : 'Victory', `${e.name.toUpperCase()} DEFEATED`, '#2ec495');
            const best = +(store.get('archeryBest') || 0);
            if (stageIndex + 1 > best) store.set('archeryBest', stageIndex + 1);
        } else {
            sfx.lose();
            banner('Defeated', `STAGE ${stageIndex + 1}`, '#ff7b6e');
        }
        return;
    }
    state = 'pan';
    stateT = 0.9;
}

function updateFlow(dt) {
    const world = E.world, cam = E.cam;
    const p = world.player, e = world.enemy;
    const flying = world.arrows.some(a => !a.stuck);

    if (state === 'intro') {
        stateT -= dt;
        if (stateT <= 0) { hideBanner(); beginTurn('player'); }
    } else if (state === 'aim') {
        cam.target = p.x - view.ww * 0.3;
    } else if (state === 'flight') {
        const ar = world.arrows[world.arrows.length - 1];
        if (ar && !ar.stuck) cam.target = ar.x - view.ww * 0.5;
        if (!flying) {
            stateT -= dt;
            if (stateT <= 0) afterShot();
        }
    } else if (state === 'pan') {
        stateT -= dt;
        const next = turn === 'player' ? e : p;
        cam.target = next.isPlayer ? next.x - view.ww * 0.3 : next.x - view.ww * 0.7;
        if (stateT <= 0) beginTurn(turn === 'player' ? 'enemy' : 'player');
    } else if (state === 'enemyThink') {
        cam.target = e.x - view.ww * 0.7;
        stateT -= dt;
        if (stateT <= 0) {
            e.plan = planEnemyShot();
            state = 'enemyDraw';
            stateT = 1.0;
            e.drawFrom = e.aim;
        }
    } else if (state === 'enemyDraw') {
        cam.target = e.x - view.ww * 0.7;
        stateT -= dt;
        const k = clamp(1 - stateT / 1.0, 0, 1);
        const ease = 1 - (1 - k) ** 3;
        e.aim = lerp(e.drawFrom, e.plan.angle, ease);
        e.draw = ease * ((e.plan.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
        if (Math.random() < dt * 8) sfx.creak();
        if (stateT <= 0) {
            fireArrow(e, e.plan.angle, e.plan.speed);
            state = 'flight';
            stateT = 0.7;
        }
    } else if (state === 'ko') {
        stateT -= dt;
        if (stateT <= 0) {
            hideBanner();
            if (e.dead && stageIndex + 1 < STAGES.length) startStage(stageIndex + 1);
            else if (e.dead) {
                state = 'menu';
                onEnd && onEnd('Tournament complete', 'Champion', `You defeated all ${STAGES.length} archers. Nothing left to prove, but you can always go again.`, 'Play again');
            } else {
                state = 'menu';
                onEnd && onEnd('Game over', 'Defeated', `${e.name} got the better of you at stage ${stageIndex + 1}.`, 'Try again');
            }
        }
    }
    cam.target = clamp(cam.target, 0, Math.max(0, world.width - view.ww));
    cam.x = lerp(cam.x, cam.target, 1 - Math.exp(-dt * (state === 'flight' ? 7 : 3.5)));
}

// Off-screen markers for the opponent and for arrows above the view
function drawIndicators() {
    const world = E.world, cam = E.cam;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const toScreen = x => (x - cam.x) * view.scale;
    const e = world.enemy, p = world.player;
    const other = state === 'aim' || turn === 'player' ? e : p;
    const sx = toScreen(other.x);
    if (sx > view.w + 10 || sx < -10) {
        const right = sx > view.w;
        const x = right ? view.w - 28 : 28, y = (other.y - 60) * view.scale;
        const dist = Math.round(Math.abs(other.x - (turn === 'player' ? p.x : e.x)) / 20);
        ctx.fillStyle = other.isPlayer ? '#2ec495' : '#e0584f';
        ctx.beginPath();
        ctx.moveTo(x + (right ? 14 : -14), y);
        ctx.lineTo(x + (right ? -6 : 6), y - 12);
        ctx.lineTo(x + (right ? -6 : 6), y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.font = '800 13px Inter, sans-serif';
        ctx.textAlign = right ? 'right' : 'left';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${dist} m`, x + (right ? -10 : 10), y + 30);
    }
    for (const ar of world.arrows) {
        if (ar.stuck || ar.y > 0) continue;
        const x = clamp(toScreen(ar.x), 20, view.w - 20);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x - 8, 22);
        ctx.lineTo(x + 8, 22);
        ctx.closePath();
        ctx.fill();
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(-ar.y / 10)} m`, x, 38);
    }
}

const isAiming = a => (a.isPlayer && state === 'aim') || (!a.isPlayer && (state === 'enemyDraw' || state === 'enemyThink'));

export const tournament = {
    get state() { return state; },
    get stage() { return stageIndex; },
    start(i, endCallback) {
        onEnd = endCallback;
        startStage(clamp(i, 0, STAGES.length - 1));
    },
    stop() { state = 'menu'; hideBanner(); $('hint').classList.add('hidden'); },
    maxDrag: () => MAX_DRAG,
    canAim: () => state === 'aim',
    release(s) {
        if (state !== 'aim') return;
        const p = E.world.player;
        if (!s || s.power < 0.08) { p.draw = 0; return; }
        hintShown = true;
        $('hint').classList.add('hidden');
        fireArrow(p, s.angle, s.speed);
        state = 'flight';
        stateT = 0.7;
    },
    cancel() { if (E.world && E.world.player) E.world.player.draw = 0; },
    tick(dt) {
        const world = E.world;
        if (state !== 'menu') {
            updateArrows(dt);
            updateFlow(dt);
        }
        animateArchers(dt);
        const p = world.player;
        const shot = state === 'aim' ? dragShot() : null;
        if (shot) {
            p.aim = shot.angle;
            p.draw = shot.power;
        } else if (state === 'aim') {
            p.draw = 0;
        }
        E.shake = Math.max(0, E.shake - dt * 40);
        render(dt, {
            isAiming,
            preview: shot ? { archer: p, shot, readout: true } : null,
            overlay: drawIndicators,
        });
    },
};
