// The score as tappable pages, shared by the bar map and whole-piece practice.
import { h } from '../ui.js';
import { pageUrl } from '../images.js';

export async function scorePages(piece, bars) {
  const views = [];
  const el = h('div', { class: 'pages' });
  for (const [index, pg] of piece.layout.entries()) {
    if (!pg.rows.length) continue;
    const top = Math.max(0, pg.rows[0].top - 0.026);
    const bottom = Math.min(1, pg.rows[pg.rows.length - 1].bottom + 0.003);
    const span = bottom - top;
    const canvas = h('canvas', { class: 'ink', 'aria-hidden': 'true' });
    const hits = h('div', { class: 'hits' });
    const box = h('div', { class: 'score', style: { aspectRatio: `${pg.width} / ${pg.height * span}` } },
      h('img', { src: await pageUrl(pg.pageId), alt: `Page ${index + 1} of the music`, style: { top: `${(-top / span) * 100}%` } }),
      canvas, hits);
    el.append(box);
    views.push({ box, canvas, hits, top, span, bars: bars.filter((b) => b.page === index) });
  }
  return { el, views };
}

// Readies a page's drawing layer. Returns the context and a bar-to-pixels helper.
export function layer(view) {
  const { box, canvas, top, span } = view;
  const w = box.clientWidth, height = box.clientHeight;
  if (!w) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.globalCompositeOperation = 'multiply';
  const px = (b) => ({ x0: b.x0 * w, x1: b.x1 * w, y0: ((b.y0 - top) / span) * height, y1: ((b.y1 - top) / span) * height });
  return { c, px };
}

export const hitPlace = (bar, view) => ({
  left: `${bar.x0 * 100}%`,
  width: `${(bar.x1 - bar.x0) * 100}%`,
  top: `${((bar.y0 - view.top) / view.span) * 100}%`,
  height: `${((bar.y1 - bar.y0) / view.span) * 100}%`,
});
