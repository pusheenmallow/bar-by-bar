// Page images come from IndexedDB; crops are drawn straight from them.
import { get } from './store.js';

const urls = new Map();
const images = new Map();

export async function pageUrl(pageId) {
  if (!urls.has(pageId)) {
    const page = await get('pages', pageId);
    if (!page) throw new Error('A page image is missing.');
    urls.set(pageId, URL.createObjectURL(page.blob));
  }
  return urls.get(pageId);
}

export function forgetPage(pageId) {
  const url = urls.get(pageId);
  if (url) URL.revokeObjectURL(url);
  urls.delete(pageId);
  images.delete(pageId);
}

export function pageImage(pageId) {
  if (!images.has(pageId)) {
    images.set(pageId, pageUrl(pageId).then((url) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('A page image could not be read.'));
      img.src = url;
    })));
  }
  return images.get(pageId);
}

// Draws bars at one height, as large as the box allows. Returns where each bar landed.
export async function drawBars(canvas, bars, box) {
  const imgs = await Promise.all(bars.map((b) => pageImage(b.pageId)));
  const cuts = bars.map((b, i) => {
    const img = imgs[i];
    return {
      img,
      sx: b.x0 * img.naturalWidth, sy: b.y0 * img.naturalHeight,
      sw: (b.x1 - b.x0) * img.naturalWidth, sh: (b.y1 - b.y0) * img.naturalHeight,
    };
  });
  const height = Math.max(...cuts.map((c) => c.sh));
  const widths = cuts.map((c) => c.sw * (height / c.sh));
  const gap = height * 0.06;

  // Longer chunks read better over a few lines when the screen is tall.
  const plans = [];
  for (let count = 1; count <= Math.min(4, cuts.length); count++) {
    const perLine = Math.ceil(cuts.length / count);
    const lines = [];
    for (let i = 0; i < cuts.length; i += perLine) lines.push(cuts.slice(i, i + perLine).map((_, k) => i + k));
    plans.push(lines);
  }
  const measure = (lines) => {
    const across = Math.max(...lines.map((line) => line.reduce((sum, i) => sum + widths[i], 0)));
    const down = lines.length * height + (lines.length - 1) * gap;
    return { lines, across, down, scale: Math.min(box.width / across, box.height / down) };
  };
  const plan = plans.map(measure).reduce((a, b) => (b.scale > a.scale * 1.05 ? b : a));

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = Math.round(plan.across * plan.scale), cssH = Math.round(plan.down * plan.scale);
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const spots = [];
  plan.lines.forEach((line, row) => {
    let x = 0;
    const y = row * (height + gap) * plan.scale * dpr;
    line.forEach((i) => {
      const c = cuts[i];
      const w = widths[i] * plan.scale * dpr, ht = height * plan.scale * dpr;
      ctx.drawImage(c.img, c.sx, c.sy, c.sw, c.sh, x, y, w, ht);
      spots.push({ bar: bars[i], left: x / dpr, top: y / dpr, width: w / dpr, height: ht / dpr });
      x += w;
    });
  });
  return { cssW, cssH, spots };
}
