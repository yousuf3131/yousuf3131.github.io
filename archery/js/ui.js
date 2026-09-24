// Small DOM helpers shared by the tournament and the online mode.
export const $ = id => document.getElementById(id);

const SCREENS = ['menu', 'lobby', 'results', 'tour-over'];
export function showScreen(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
}

export function setStatus(el, msg, err) {
    const s = $(el);
    s.textContent = msg || '';
    s.classList.toggle('error', !!err);
}

export function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3500);
}

export function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

let bannerTimer = null;
export function banner(text, sub, color, hideAfter) {
    clearTimeout(bannerTimer);
    if (hideAfter) bannerTimer = setTimeout(hideBanner, hideAfter);
    const el = $('banner');
    el.innerHTML = (sub ? `<small>${esc(sub)}</small>` : '') + esc(text);
    el.style.color = color || '#fff';
    el.classList.add('hidden');
    void el.offsetWidth;
    el.classList.remove('hidden');
}
export function hideBanner() {
    clearTimeout(bannerTimer);
    $('banner').classList.add('hidden');
}

export function setHint(text) {
    const h = $('hint');
    if (text) h.textContent = text;
    h.classList.toggle('hidden', !text);
}
