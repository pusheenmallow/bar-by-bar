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
let goAfter = null;
let pushAfter = false;

// Swaps an element's contents, skipping anything left out by a condition.
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

export const go = (path) => {
  if (steppingBack) goAfter = path; else location.hash = path;
};

/* ---------- overlays ---------- */

const layer = () => document.getElementById('layer');
let openSheet = null;

export function closeSheet(fromHistory = false) {
  if (!openSheet) return;
  const { el, onClose } = openSheet;
  openSheet = null;
  el.remove();
  onClose?.();
  if (!fromHistory && history.state?.sheet) {
    steppingBack = true;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (steppingBack) {
    steppingBack = false;
    if (goAfter) {
      const path = goAfter;
      goAfter = null;
      location.hash = path;
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
    class: 'scrim',
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

// The star sticker a teacher puts on the page.
export function sticker(size = 72, label) {
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const r = i % 2 ? 46 : 50;
    const a = (i / 28) * Math.PI * 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 15 : 33;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    star.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(52 + r * Math.sin(a)).toFixed(1)}`);
  }
  return h('svg:svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'sticker-art', role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true' },
    h('svg:polygon', { points: pts.join(' '), fill: '#FFC02E', stroke: '#2F3237', 'stroke-width': 3, 'stroke-linejoin': 'round' }),
    h('svg:polygon', { points: star.join(' '), fill: '#FFF6D6', stroke: '#2F3237', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
}

export function pen(colour, size = 44) {
  return h('svg:svg', { viewBox: '0 0 64 26', width: size * 1.6, height: size * 0.65, class: 'pen-art', 'aria-hidden': 'true' },
    h('svg:path', { d: 'M2 5q1-3 4-3h34q3 0 3 3v16q0 3-3 3H6q-3 0-4-3z', fill: '#fff', stroke: '#2F3237', 'stroke-width': 2.2 }),
    h('svg:path', { d: 'M43 6l9 1q2 0 2 2v8q0 2-2 2l-9 1z', fill: colour, stroke: '#2F3237', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
    h('svg:path', { d: 'M54 10l8 1v5l-8 2z', fill: colour, stroke: '#2F3237', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
    h('svg:rect', { x: 8, y: 9, width: 28, height: 8, rx: 3, fill: colour }));
}

export function seeded(seedText) {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) { hash ^= seedText.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return () => {
    hash |= 0; hash = (hash + 0x6d2b79f5) | 0;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One rough highlighter stroke, as a canvas path.
export function strokePath(ctx, x0, x1, y0, y1, rand, wobble = 2) {
  const steps = Math.max(5, Math.round((x1 - x0) / 34));
  const lean = (rand() - 0.5) * wobble * 3;
  ctx.beginPath();
  ctx.moveTo(x0 + (rand() - 0.5) * wobble * 2, y0 + rand() * wobble);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    ctx.lineTo(x0 + (x1 - x0) * t, y0 + lean * t + (rand() - 0.5) * wobble);
  }
  ctx.lineTo(x1 + (rand() - 0.5) * wobble * 3, (y0 + y1) / 2 + lean / 2);
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    ctx.lineTo(x0 + (x1 - x0) * t, y1 + lean * t + (rand() - 0.5) * wobble);
  }
  ctx.closePath();
}
