// Small helpers for building screens without a framework.

export function h(tag, attrs, ...kids) {
  const el = tag.startsWith('svg:')
    ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4))
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(`--${n}`, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

// Closing a panel steps back through history, which finishes a moment later.
// Anything that needs history in the meantime waits for that step.
let steppingBack = false;
let thenDo = null;
let pushAfter = false;

// Swaps an element's contents, skipping anything left out by a condition.
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

const whenReady = (move) => { if (steppingBack) thenDo = move; else move(); };

// The screens passed through to get here, so going back returns along the same path.
// Each history entry remembers its place, which keeps this right after a reload or a device back.
const trail = [];
let place = -1;
let swapping = false;

export function noteRoute(path) {
  if (history.state?.sheet) return;          // redrawing behind an open panel
  const known = history.state?.place;
  if (Number.isInteger(known)) place = known;
  else {
    if (!swapping) place += 1;
    history.replaceState({ ...history.state, place }, '');
  }
  swapping = false;
  trail.length = place + 1;
  trail[place] = path;
}

const currentPath = () => location.hash.slice(1) || '/';

// Deeper into the app.
export const go = (path) => whenReady(() => { location.hash = path; });

// Sideways, to a screen that takes this one's place.
const swap = (path) => {
  if (currentPath() === path) return;
  swapping = true;
  location.replace(`#${path}`);
};
export const swapTo = (path) => whenReady(() => swap(path));

// Up to a screen above this one, so the device's back button agrees with the app's.
export const goUp = (path) => whenReady(() => {
  const at = trail.lastIndexOf(path, place - 1);
  if (at >= 0 && place > 0) history.go(at - place); else swap(path);
});

/* ---------- gentle changes ---------- */

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Crossfades to a new screen. The old look stays up until the new one is ready.
// Older browsers just fade the new screen in.
export function softly(change, fadeIn) {
  if (still() || document.hidden) { change(); return Promise.resolve(); }
  if (!document.startViewTransition) {
    change();
    fadeIn?.()?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    return Promise.resolve();
  }
  const moving = document.startViewTransition(change);
  moving.ready.catch(() => {});       // skipped when another screen follows straight after
  moving.finished.catch(() => {});
  return moving.updateCallbackDone;
}

/* ---------- overlays ---------- */

const layer = () => document.getElementById('layer');
let openSheet = null;

export function closeSheet(fromHistory = false) {
  if (!openSheet) return;
  const { el, onClose } = openSheet;
  openSheet = null;
  if (still()) el.remove();
  else {
    el.classList.add('leaving');
    el.inert = true;
    setTimeout(() => el.remove(), 150);
  }
  onClose?.();
  if (!fromHistory && history.state?.sheet) {
    steppingBack = true;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (steppingBack) {
    steppingBack = false;
    if (thenDo) {
      const move = thenDo;
      thenDo = null;
      move();
    } else if (pushAfter && openSheet) {
      history.pushState({ sheet: 1 }, '');
    }
    pushAfter = false;
    return;
  }
  if (openSheet) closeSheet(true);
});

// A panel over the current screen. The Android back button closes it.
export function sheet(content, { onClose, dismiss = true, kind = '' } = {}) {
  const already = !!openSheet;
  if (already) {
    const old = openSheet;
    openSheet = null;
    old.el.remove();
    old.onClose?.();
  }
  const panel = h('section', { class: `sheet ${kind}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const el = h('div', {
    class: `scrim ${already ? 'staying' : ''}`,
    onClick: (e) => { if (dismiss && e.target === el) closeSheet(); },
  }, panel);
  layer().append(el);
  openSheet = { el, onClose };
  if (!already) {
    if (steppingBack) pushAfter = true;
    else history.pushState({ sheet: 1 }, '');
  }
  panel.querySelector('button, input, textarea, select')?.focus({ preventScroll: true });
  return panel;
}

export function replaceSheet(content) {
  if (!openSheet) return;
  const panel = openSheet.el.querySelector('.sheet');
  fill(panel, content);
  panel.scrollTop = 0;
  if (!still()) panel.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
}

let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  layer().append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

export function confirmSheet({ title, body, yes, no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    sheet([
      h('h2', {}, title),
      body && h('p', {}, body),
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onClick: () => closeSheet() }, no),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => { answer = true; closeSheet(); } }, yes)),
    ], { onClose: () => resolve(answer) });
  });
}

/* ---------- small pieces of drawing ---------- */

export function icon(name, size = 28) {
  const paths = {
    back: 'M19 12H6m6-7-7 7 7 7',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    close: 'M6 6l12 12M18 6 6 18',
    play: 'M8 5v14l11-7z',
    stop: 'M7 7h10v10H7z',
    flag: 'M6 21V4m0 1c5-3 8 2 13 0v9c-5 2-8-3-13 0',
    note: 'M5 4h14v11l-5 5H5zM14 20v-5h5M9 9h6M9 13h3',
    up: 'M12 19V6m-6 6 6-6 6 6',
    down: 'M12 5v13m6-6-6 6-6-6',
    bin: 'M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13',
    rotate: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
    sound: 'M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6',
  };
  return h('svg:svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    h('svg:path', { d: paths[name] }));
}

// The gold star a teacher puts on the page.
export function sticker(size = 72, label) {
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 13 : 30;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    star.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(52 + r * Math.sin(a)).toFixed(1)}`);
  }
  return h('svg:svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'sticker-art', role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true' },
    h('svg:circle', { cx: 50, cy: 50, r: 48, class: 'sticker-disc' }),
    h('svg:polygon', { points: star.join(' '), class: 'sticker-star' }));
}

const crownShape = () => [
  h('svg:path', { d: 'M25 67 19 37l17 14 14-23 14 23 17-14-6 30z' }),
  h('svg:rect', { x: 25, y: 71, width: 50, height: 7, rx: 2 }),
  ...[[19, 35], [50, 26], [81, 35]].map(([cx, cy]) => h('svg:circle', { cx, cy, r: 4.5 })),
];

// A plain little crown, in the colour of the text around it.
export function crown(size = 18, label) {
  return h('svg:svg', { viewBox: '12 18 76 64', width: size, height: size * 0.84, class: 'crown-art', role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true' }, crownShape());
}

// The same crown on a gold sticker, for the end of a run.
export function crownSticker(size = 72, label) {
  return h('svg:svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'sticker-art', role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true' },
    h('svg:circle', { cx: 50, cy: 50, r: 48, class: 'sticker-disc' }),
    h('svg:g', { class: 'sticker-star' }, crownShape()));
}
