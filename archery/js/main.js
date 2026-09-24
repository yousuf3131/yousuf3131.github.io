// Archery Duel: boot, main menu, input and the frame loop.
import {
    E, canvas, view, clamp, store, audio, sfx, isMuted, setMuted, STAGES, MAX_DRAG, MIN_SPEED, MAX_SPEED,
    buildWorld, bestShot, animateArchers, render, dragShot, setMinWorldWidth,
} from './engine.js?v=2';
import { tournament } from './tournament.js?v=2';
import { online } from './online.js?v=2';
import { $, showScreen, setStatus, hideBanner, setHint } from './ui.js?v=2';

let mode = null; // null (menu) | 'tour' | 'online'
const active = () => (mode === 'tour' ? tournament : mode === 'online' ? online : null);

function menuBackdrop() {
    buildWorld(0);
    E.world.wind = 0;
    E.onHit = null;
    E.cam.x = E.cam.target = 0;
    $('wind').textContent = '0 km/h';
    $('wind-arrow').style.opacity = 0.3;
    $('wind-arrow').style.transform = 'none';
    $('hp-player').style.width = '100%';
    $('hp-enemy').style.width = '100%';
    $('player-hp-text').textContent = E.world.player.hp;
    $('enemy-hp-text').textContent = E.world.enemy.hp;
    $('enemy-name').textContent = E.world.enemy.name;
    $('stage').textContent = `1/${STAGES.length}`;
}

function showMainMenu(reason) {
    mode = null;
    setMinWorldWidth(0);
    if (!E.world || E.world.online) menuBackdrop();
    hideBanner();
    setHint('');
    $('hud').classList.remove('hidden');
    showScreen('menu');
    const best = +(store.get('archeryBest') || 0);
    $('best').textContent = best ? `Tournament best: ${best} of ${STAGES.length} opponents defeated` : '';
    setStatus('menu-status', reason || '', !!reason);
}

function startTournament(i) {
    audio();
    mode = 'tour';
    setMinWorldWidth(0);
    $('hud').classList.remove('hidden');
    showScreen(null);
    tournament.start(i, (kicker, title, text, btn) => {
        $('tour-kicker').textContent = kicker;
        $('tour-title').textContent = title;
        $('tour-text').textContent = text;
        $('btn-tour-again').textContent = btn;
        showScreen('tour-over');
    });
}

online.init({
    onEnter() {
        audio();
        if (mode === 'tour') tournament.stop();
        mode = 'online';
        $('hud').classList.add('hidden');
    },
    onExit(reason) { showMainMenu(reason); },
});

$('btn-tour').addEventListener('click', () => startTournament(0));
$('btn-tour-again').addEventListener('click', () => startTournament(0));
$('btn-tour-menu').addEventListener('click', () => { tournament.stop(); showMainMenu(); });

$('btn-exit').addEventListener('click', e => {
    e.currentTarget.blur();
    if (online.inRoom) {
        if (confirm(document.body.classList.contains('is-host') ? 'Leave and close this room for everyone?' : 'Leave this room?')) online.leave();
    } else if (mode === 'tour') {
        tournament.stop();
        showMainMenu();
    } else {
        location.href = '../projects.html';
    }
});

// Mute
function syncMute() {
    $('icon-sound').classList.toggle('hidden', isMuted());
    $('icon-muted').classList.toggle('hidden', !isMuted());
}
syncMute();
$('mute').addEventListener('click', e => {
    setMuted(!isMuted());
    syncMute();
    e.currentTarget.blur();
});

// ============================================================
// Input: drag back to draw, release to shoot
// ============================================================
function pointerPos(e) { return { x: e.clientX, y: e.clientY }; }
canvas.addEventListener('pointerdown', e => {
    audio();
    const m = active();
    if (!m || !m.canAim()) return;
    E.drag = { start: pointerPos(e), cur: pointerPos(e) };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
    if (!E.drag) return;
    const m = active();
    const md = m ? m.maxDrag() : MAX_DRAG;
    const prevPower = dragShot(md)?.power || 0;
    E.drag.cur = pointerPos(e);
    const s = dragShot(md);
    if (s && Math.floor(s.power * 8) !== Math.floor(prevPower * 8)) sfx.creak();
});
function endDrag() {
    const m = active();
    if (!E.drag || !m || !m.canAim()) { E.drag = null; return; }
    const s = dragShot(m.maxDrag());
    E.drag = null;
    m.release(s);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { E.drag = null; const m = active(); if (m) m.cancel(); });

// ============================================================
// Loop
// ============================================================
let last = performance.now();
function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (E.world) {
        const m = active();
        if (m) m.tick(dt);
        else {
            // Menu backdrop
            animateArchers(dt);
            E.shake = Math.max(0, E.shake - dt * 40);
            render(dt, { isAiming: () => false, preview: null });
        }
    }
    requestAnimationFrame(frame);
}

// Boot
menuBackdrop();
const m = location.hash.match(/^#stage=(\d+)$/);
if (m) startTournament(clamp(+m[1] - 1, 0, STAGES.length - 1));
else showMainMenu();
requestAnimationFrame(frame);

// Read-only peek for automated tests; only exists with #debug in the URL
if (location.hash === '#debug') {
    window.archeryDebug = () => ({
        mode,
        tour: mode === 'tour' ? { state: tournament.state, stage: tournament.stage, player: pick(E.world.player), enemy: pick(E.world.enemy) } : null,
        online: online.debug(),
    });
    window.archerySuggest = id => {
        if (mode !== 'tour') return online.suggest(id);
        const w = E.world, b = bestShot(w.player, w.enemy);
        w.player.facing = 1;
        return { angle: b.angle, power: (b.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), maxDrag: MAX_DRAG };
    };
}
function pick(a) { return a ? { x: a.x, y: a.y, hp: a.hp, dead: a.dead } : null; }
