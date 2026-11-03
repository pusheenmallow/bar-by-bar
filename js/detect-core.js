// Finds the page in a photo, straightens it, and locates every bar.
// Pure functions on plain arrays, so it runs in a worker and can be tested on its own.

export const WORK_W = 1654;           // detection always runs at this width
const MAX_OUT_W = 2480;               // stored page width (about 300 dpi on A4)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- finding the page ---------- */

function downsample(img, targetW) {
  const step = Math.max(1, Math.floor(img.w / targetW));
  const w = Math.floor(img.w / step), h = Math.floor(img.h / step);
  const rgb = new Float32Array(w * h * 3);
  const { data } = img, stride = img.w * 4;
  const inner = Math.max(1, step >> 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let j = 0; j < step; j += inner) {
        let p = (y * step + j) * stride + x * step * 4;
        for (let i = 0; i < step; i += inner, p += 4 * inner) {
          rs += data[p]; gs += data[p + 1]; bs += data[p + 2]; n++;
        }
      }
      const q = (y * w + x) * 3;
      rgb[q] = rs / n; rgb[q + 1] = gs / n; rgb[q + 2] = bs / n;
    }
  }

  // Treat the brightest part of the picture as white, so a warm room still reads as paper.
  const brightness = new Float32Array(w * h);
  for (let i = 0; i < brightness.length; i++) brightness[i] = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  const cut = Float32Array.from(brightness).sort()[Math.floor(brightness.length * 0.9)];
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < brightness.length; i++) {
    if (brightness[i] >= cut) { sum[0] += rgb[i * 3]; sum[1] += rgb[i * 3 + 1]; sum[2] += rgb[i * 3 + 2]; count++; }
  }
  const top = Math.max(...sum);
  const gain = sum.map((c) => Math.min(2.5, top / Math.max(c, 1)));

  const s = new Uint8Array(w * h), v = new Uint8Array(w * h);
  for (let i = 0; i < v.length; i++) {
    const r = rgb[i * 3] * gain[0], g = rgb[i * 3 + 1] * gain[1], b = rgb[i * 3 + 2] * gain[2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    v[i] = Math.min(255, max);
    s[i] = max > 0 ? ((max - min) / max) * 255 : 0;
  }
  return { s, v, w, h, step };
}

function morph(mask, w, h, r, erode) {
  // Square erosion or dilation, done as two 1-D passes with running counts.
  const size = 2 * r + 1;
  const pass = (src, dst, W, H, get, set) => {
    for (let a = 0; a < H; a++) {
      let c = 0;
      for (let b = -r; b < W; b++) {
        const inP = b + r < W ? get(src, b + r, a) : (erode ? 0 : 0);
        c += inP;
        if (b - r - 1 >= 0) c -= get(src, b - r - 1, a);
        if (b >= 0) {
          const lo = Math.max(0, b - r), hi = Math.min(W - 1, b + r);
          set(dst, b, a, erode ? (c === hi - lo + 1 && hi - lo + 1 === size ? 1 : 0) : (c > 0 ? 1 : 0));
        }
      }
    }
  };
  const a = new Uint8Array(mask.length), b = new Uint8Array(mask.length);
  pass(mask, a, w, h, (m, x, y) => m[y * w + x], (m, x, y, val) => { m[y * w + x] = val; });
  pass(a, b, h, w, (m, y, x) => m[y * w + x], (m, y, x, val) => { m[y * w + x] = val; });
  return b;
}

function localBrightest(v, w, h, r) {
  const across = new Uint8Array(v.length), out = new Uint8Array(v.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) if (v[row + k] > m) m = v[row + k];
      across[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) if (across[k * w + x] > m) m = across[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}

function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null, bestN = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0, n = 0;
    const pts = [];
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p / w) | 0;
      let edge = false;
      const push = (q) => {
        if (mask[q]) { if (!seen[q]) { seen[q] = 1; stack[sp++] = q; } } else edge = true;
      };
      if (x > 0) push(p - 1); else edge = true;
      if (x < w - 1) push(p + 1); else edge = true;
      if (y > 0) push(p - w); else edge = true;
      if (y < h - 1) push(p + w); else edge = true;
      if (edge) pts.push([x, y]);
    }
    if (n > bestN) { bestN = n; best = pts; }
  }
  return { pts: best || [], area: bestN };
}

function fitLine(points) {
  // Total least squares with outliers trimmed: a neighbouring page or shadow can bulge an edge.
  let pts = points;
  let line = null;
  for (let iter = 0; iter < 4; iter++) {
    if (pts.length < 2) break;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let xx = 0, yy = 0, xy = 0;
    for (const p of pts) {
      const dx = p[0] - mx, dy = p[1] - my;
      xx += dx * dx; yy += dy * dy; xy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    const dir = [Math.cos(theta), Math.sin(theta)];
    line = { px: mx, py: my, dx: dir[0], dy: dir[1] };
    const res = pts.map((p) => Math.abs((p[0] - mx) * dir[1] - (p[1] - my) * dir[0]));
    const sorted = res.slice().sort((a, b) => a - b);
    const cut = Math.max(1.5, sorted[Math.floor(sorted.length * 0.5)] * 3);
    const next = pts.filter((_, i) => res[i] <= cut);
    if (next.length === pts.length) break;
    pts = next;
  }
  return line;
}

function intersect(a, b) {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return [a.px + t * a.dx, a.py + t * a.dy];
}

const quadArea = (q) => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

const TURN_AT = 1.3;               // only used on sideways photos, where either way up is possible
const MIN_PAGE = 0.07;                // share of the photo a page can fill and still be found

export const fullFrame = (w, h) => [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]];

export function detectPageCorners(img) {
  const full = fullFrame(img.w, img.h);
  const small = downsample(img, 420);
  const { s, v, w, h, step } = small;

  const sortedV = Uint8Array.from(v).sort();
  const bright = sortedV[Math.floor(sortedV.length * 0.9)];
  const vMin = bright * 0.38;

  // Paper is judged against the brightest thing nearby, so a shadow across the page still
  // counts as paper while the dark gap to a neighbouring page does not.
  const near = localBrightest(v, w, h, Math.max(6, Math.round(w * 0.045)));
  let mask = new Uint8Array(w * h);
  let on = 0;
  for (let i = 0; i < mask.length; i++) {
    if (s[i] < 45 && v[i] > vMin && v[i] > near[i] * 0.66) { mask[i] = 1; on++; }
  }
  if (on / mask.length > 0.97) return { corners: full, found: false };   // a flat scan with no background

  // If paper reaches the frame on every side, no table is showing, so use the whole picture.
  let rim = 0, rimOn = 0;
  const band = Math.max(2, Math.round(w * 0.012));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) { rim++; rimOn += mask[y * w + x]; }
    }
  }
  if (rimOn / rim > 0.85) return { corners: full, found: false };

  const r = Math.max(2, Math.round((31 / 2) * (w / 1659)));
  mask = morph(morph(mask, w, h, r, true), w, h, r, false);          // cuts thin links to a neighbouring page

  const { pts, area } = largestComponent(mask, w, h);
  if (area / mask.length < MIN_PAGE) return { corners: full, found: false };

  // Fit each side from the middle of the page, where a neighbouring sheet or a shadow
  // touching a corner can't pull the line away.
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const minX = new Int32Array(h).fill(w), maxX = new Int32Array(h).fill(-1);
  const minY = new Int32Array(w).fill(h), maxY = new Int32Array(w).fill(-1);
  for (const [x, y] of pts) {
    if (x < minX[y]) minX[y] = x;
    if (x > maxX[y]) maxX[y] = x;
    if (y < minY[x]) minY[x] = y;
    if (y > maxY[x]) maxY[x] = y;
  }
  const side = (from, to, point) => {
    const list = [];
    for (let i = Math.round(from + (to - from) * 0.2); i <= from + (to - from) * 0.8; i++) list.push(point(i));
    return fitLine(list);
  };
  const left = side(y0, y1, (y) => [minX[y], y]);
  const right = side(y0, y1, (y) => [maxX[y], y]);
  const top = side(x0, x1, (x) => [x, minY[x]]);
  const bottom = side(x0, x1, (x) => [x, maxY[x]]);
  const quad = [intersect(left, top), intersect(top, right), intersect(right, bottom), intersect(bottom, left)];
  if (!quad.every(Boolean)) return { corners: full, found: false };

  const scaled = quad.map(([x, y]) => [
    clamp((x + 0.5) * step, 0, img.w - 1),
    clamp((y + 0.5) * step, 0, img.h - 1),
  ]);
  const frac = quadArea(scaled) / (img.w * img.h);
  if (frac < MIN_PAGE || frac > 0.985) return { corners: full, found: false };
  // A small sheet in a wide photo, such as a tablet held sideways, must still be page-shaped.
  const { ratio } = pageShape(scaled);
  const long = ratio < 1 ? 1 / ratio : ratio;
  if (frac < 0.25 && (long < 1.15 || long > 1.75)) return { corners: full, found: false };
  return { corners: scaled, found: true };
}

/* ---------- straightening ---------- */

// Maps the unit square onto the quad (Heckbert's square-to-quad).
function unitToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function pageShape(corners) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [tl, tr, br, bl] = corners;
  const across = (d(tl, tr) + d(bl, br)) / 2, down = (d(tl, bl) + d(tr, br)) / 2;
  return { across, down, ratio: down / across };
}

// slope(yAtWorkScale) gives the leftover tilt of the staff lines at that height.
export function warp(src, corners, W, H, slope, workScale = 1) {
  const [a, b, c, d, e, f, g, h] = unitToQuad(corners);
  const out = new Uint8ClampedArray(W * H * 4);
  const { data, w: sw, h: sh } = src;
  const midX = W / 2;
  let o = 0;
  for (let y = 0; y < H; y++) {
    const s = slope ? slope(y / workScale) : 0;
    for (let x = 0; x < W; x++, o += 4) {
      const u = x / (W - 1);
      const v = (y + s * (x - midX)) / (H - 1);
      const den = g * u + h * v + 1;
      const sx = (a * u + b * v + c) / den, sy = (d * u + e * v + f) / den;
      const x0 = sx < 0 ? 0 : sx > sw - 2 ? sw - 2 : sx | 0;
      const y0 = sy < 0 ? 0 : sy > sh - 2 ? sh - 2 : sy | 0;
      const fx = clamp(sx - x0, 0, 1), fy = clamp(sy - y0, 0, 1);
      const p = (y0 * sw + x0) * 4, q = p + sw * 4;
      for (let k = 0; k < 3; k++) {
        const top = data[p + k] + (data[p + 4 + k] - data[p + k]) * fx;
        const bot = data[q + k] + (data[q + 4 + k] - data[q + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, w: W, h: H };
}

/* ---------- ink ---------- */

function maxChannel(img) {
  const n = img.w * img.h, v = new Uint8Array(n), d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    v[i] = r > g ? (r > b ? r : b) : g > b ? g : b;   // highlighter stays bright, ink stays dark
  }
  return v;
}

// Local paper brightness on a coarse grid, so shadows can be divided out.
function paperGrid(v, w, h, block) {
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
  const level = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      const yEnd = Math.min(h, (by + 1) * block), xEnd = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < yEnd; y += 2) {
        for (let x = bx * block; x < xEnd; x += 2) { hist[v[y * w + x]]++; n++; }
      }
      let c = 0, m = 0;
      for (m = 0; m < 256; m++) { c += hist[m]; if (c >= n * 0.6) break; }
      level[by * bw + bx] = m;
    }
  }
  return { level, bw, bh, block };
}

function paperAt(grid, x, y) {
  const { level, bw, bh, block } = grid;
  const fy = clamp(y / block - 0.5, 0, bh - 1.001), fx = clamp(x / block - 0.5, 0, bw - 1.001);
  const y0 = fy | 0, x0 = fx | 0, ty = fy - y0, tx = fx - x0;
  const a = level[y0 * bw + x0], b = level[y0 * bw + Math.min(bw - 1, x0 + 1)];
  const c = level[Math.min(bh - 1, y0 + 1) * bw + x0], d = level[Math.min(bh - 1, y0 + 1) * bw + Math.min(bw - 1, x0 + 1)];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function evenLight(v, w, h) {
  const grid = paperGrid(v, w, h, 31);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bg = paperAt(grid, x, y);
      const val = bg > 1 ? (v[y * w + x] * 255) / bg : 255;
      out[y * w + x] = val > 255 ? 255 : val;
    }
  }
  return out;
}

// Makes a phone photo read like a clean scan: white paper, dark ink, highlighter kept.
export function cleanScan(img) {
  const { data, w, h } = img;
  const v = maxChannel(img);
  const grid = paperGrid(v, w, h, Math.round((31 * w) / WORK_W));

  // Room light tints the paper, so measure that tint from plain paper and take it out.
  const hist = new Uint32Array(256);
  for (let i = 0; i < v.length; i += 11) hist[v[i]]++;
  let seen = 0, cut = 255;
  const wanted = (v.length / 11) * 0.3;
  for (; cut > 0; cut--) { seen += hist[cut]; if (seen >= wanted) break; }
  const sum = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < data.length; p += 44) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(r, g, b);
    if (max >= cut && max - Math.min(r, g, b) < 60) { sum[0] += r; sum[1] += g; sum[2] += b; count++; }
  }
  const brightest = count ? Math.max(...sum) : 1;
  const balance = count ? sum.map((c) => brightest / Math.max(c, 1)) : [1, 1, 1];

  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const bg = paperAt(grid, x, y);
      const gain = bg > 40 ? 255 / bg : 1;
      for (let k = 0; k < 3; k++) {
        const c = (data[p + k] * balance[k] * gain - 30) * 1.14;
        data[p + k] = c < 0 ? 0 : c > 255 ? 255 : c;
      }
    }
  }
  return img;
}

function threshold(n, thr) {
  const m = new Uint8Array(n.length);
  for (let i = 0; i < n.length; i++) m[i] = n[i] < thr ? 1 : 0;
  return m;
}

function keepHorizontalRuns(mask, w, h, minLen) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[row + x]) { x++; continue; }
      let e = x;
      while (e < w && mask[row + e]) e++;
      if (e - x >= minLen) out.fill(1, row + x, row + e);
      x = e;
    }
  }
  return out;
}

/* ---------- levelling leftover curl ---------- */

function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

function polyFit(xs, ys, ws, degree) {
  const n = degree + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  xs.forEach((x, k) => {
    const pow = [1];
    for (let i = 1; i < 2 * n - 1; i++) pow[i] = pow[i - 1] * x;
    for (let i = 0; i < n; i++) {
      b[i] += ws[k] * ys[k] * pow[i];
      for (let j = 0; j < n; j++) A[i][j] += ws[k] * pow[i + j];
    }
  });
  return solve(A, b);
}

export function estimateTilt(ink, W, H) {
  const hz = keepHorizontalRuns(ink, W, H, 45);
  const bandH = 150, stepY = 75;
  const samples = [];
  const mid = W / 2;
  for (let top = 0; top + bandH <= H; top += stepY) {
    const xs = [], ys = [];
    for (let y = top; y < top + bandH; y++) {
      for (let x = 0; x < W; x += 3) {
        if (hz[y * W + x]) { xs.push(x - mid); ys.push(y - top); }
      }
    }
    if (xs.length < 1200) continue;                    // not enough staff line in this band
    const hist = new Float64Array(bandH + 160);
    const sharpness = (s) => {
      hist.fill(0);
      for (let i = 0; i < xs.length; i++) {
        const r = Math.round(ys[i] - s * xs[i]) + 80;
        if (r >= 0 && r < hist.length) hist[r]++;
      }
      let score = 0;
      for (let r = 0; r < hist.length; r++) score += hist[r] * hist[r];
      return score;
    };
    let best = 0, bestScore = -1;
    for (let s = -0.032; s <= 0.0321; s += 0.001) {
      const score = sharpness(s);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    const coarse = best;
    for (let s = coarse - 0.001; s <= coarse + 0.00101; s += 0.0002) {
      const score = sharpness(s);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    samples.push({ y: (top + bandH / 2) / H - 0.5, s: best, w: xs.length });
  }
  if (!samples.length) return { coeffs: [0] };
  const mean = samples.reduce((a, b) => a + b.s * b.w, 0) / samples.reduce((a, b) => a + b.w, 0);
  if (samples.length < 5) return { coeffs: [mean] };
  let use = samples;
  let coeffs = polyFit(use.map((p) => p.y), use.map((p) => p.s), use.map((p) => p.w), 3);
  if (!coeffs) return { coeffs: [mean] };
  const evalAt = (y, c) => c.reduceRight((acc, k) => acc * y + k, 0);
  use = samples.filter((p) => Math.abs(p.s - evalAt(p.y, coeffs)) < 0.002);
  if (use.length >= 5) coeffs = polyFit(use.map((p) => p.y), use.map((p) => p.s), use.map((p) => p.w), 3) || coeffs;
  return { coeffs };
}

export const tiltFn = (coeffs, H) => (y) => {
  const t = clamp(y / H - 0.5, -0.5, 0.5);
  return coeffs.reduceRight((acc, k) => acc * t + k, 0);
};

/* ---------- staves and bars ---------- */

function staffLines(mask, W, H, minCover) {
  const hz = keepHorizontalRuns(mask, W, H, 45);
  const thick = new Uint8Array(hz.length);
  for (let i = W; i < hz.length - W; i++) thick[i] = hz[i] | hz[i - W] | hz[i + W];
  const x0 = Math.floor(W * 0.15), x1 = Math.floor(W * 0.9);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = x0; x < x1; x++) c += thick[y * W + x];
    if (c / (x1 - x0) > minCover) rows.push(y);
  }
  const groups = [];
  for (const y of rows) {
    const g = groups[groups.length - 1];
    if (g && y - g[g.length - 1] <= 2) g.push(y); else groups.push([y]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function groupStaves(lines) {
  const staves = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const s = lines.slice(i, i + 5);
    const gaps = s.slice(1).map((y, k) => y - s[k]);
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    const mean = gaps.reduce((a, b) => a + b, 0) / 4;
    if (hi - lo <= 3.5 && mean >= 7 && mean <= 30) { staves.push(s); i += 5; } else i += 1;
  }
  return staves;
}

function staffExtent(mask, W, staff, sp) {
  // Horizontal range where this staff exists, tolerating clefs and key signatures.
  const hz = keepHorizontalRuns(mask, W, Math.floor(mask.length / W), 25);
  const y0 = Math.round(staff[0]) - 4, y1 = Math.round(staff[4]) + 4;
  const cover = new Uint16Array(W);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) cover[x] += hz[y * W + x];
  const runs = [];
  let st = -1, pr = -1;
  const gap = Math.max(40, sp * 7);
  for (let x = 0; x < W; x++) {
    if (cover[x] < 4) continue;
    if (st < 0) st = x;
    else if (x - pr > gap) { runs.push([st, pr]); st = x; }
    pr = x;
  }
  if (st >= 0) runs.push([st, pr]);
  if (!runs.length) return null;
  return runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
}

function columnsCovered(mask, W, top, bottom, xFrom, xTo, lean = 0) {
  const prof = new Float32Array(W);
  const h = bottom - top + 1;
  for (let x = Math.max(1, xFrom); x <= Math.min(W - 2, xTo); x++) {
    let c = 0;
    for (let y = top; y <= bottom; y++) {
      const sx = Math.round(x + lean * (y - top));
      if (sx < 1 || sx > W - 2) continue;
      const i = y * W + sx;
      if (mask[i] | mask[i - 1] | mask[i + 1]) c++;   // lets a slightly leaning barline count
    }
    prof[x] = c / h;
  }
  return prof;
}

// If the page corners were a little off, barlines lean. Find the lean that makes them stand out.
function barlineLean(mask, W, top, bottom, x0, x1, sp) {
  const m = Math.round(sp * 2);
  let best = 0, bestScore = 0;
  for (let k = 0; k <= 16; k++) {
    const lean = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.004;     // tries small leans first
    const prof = columnsCovered(mask, W, top, bottom, x0 - m, x1 + m, lean);
    let score = 0;
    for (let x = Math.max(0, x0 - m); x <= Math.min(W - 1, x1 + m); x++) if (prof[x] > 0.8) score += prof[x];
    if (score > bestScore * 1.02) { bestScore = score; best = lean; }
  }
  return best;
}

function cluster(xs, gap, prof) {
  const groups = [];
  for (const x of xs) {
    const g = groups[groups.length - 1];
    if (g && x - g[g.length - 1] <= gap) g.push(x); else groups.push([x]);
  }
  return groups.map((g) => Math.round(g.reduce((a, b) => a + b, 0) / g.length));
}

function throughLines(mask, W, top, bottom, x0, x1, sp) {
  const m = Math.round(sp * 2);
  const lean = barlineLean(mask, W, top, bottom, x0, x1, sp);
  const prof = columnsCovered(mask, W, top, bottom, x0 - m, x1 + m, lean);
  const xs = [];
  for (let x = Math.max(0, x0 - m); x <= Math.min(W - 1, x1 + m); x++) if (prof[x] > 0.8) xs.push(x);
  const shift = lean * ((bottom - top) / 2);                      // report each line at mid-height
  return cluster(xs, Math.round(sp * 1.6)).map((x) => Math.round(x + shift));
}

function staffOnlyLines(mask, W, staff, x0, x1, sp) {
  // For engraving where barlines stop at each staff instead of running through both.
  const top = Math.round(staff[0]), bottom = Math.round(staff[4]);
  const m = Math.round(sp * 2);
  const inside = columnsCovered(mask, W, top, bottom, x0 - m, x1 + m);
  const capH = Math.max(3, Math.round(sp * 0.6));
  const above = columnsCovered(mask, W, Math.max(1, top - Math.round(sp) - capH), Math.max(1, top - Math.round(sp)), x0 - m, x1 + m);
  const below = columnsCovered(mask, W, bottom + Math.round(sp), bottom + Math.round(sp) + capH, x0 - m, x1 + m);
  const xs = [];
  for (let x = Math.max(0, x0 - m); x <= Math.min(W - 1, x1 + m); x++) {
    if (inside[x] > 0.93 && above[x] < 0.35 && below[x] < 0.35) xs.push(x);
  }
  return cluster(xs, Math.round(sp * 1.6));
}

function tidyLines(lines, x0, x1, sp) {
  let xs = lines.slice().sort((a, b) => a - b);
  if (!xs.length || xs[0] - x0 > sp * 4) xs.unshift(x0);
  if (x1 - xs[xs.length - 1] > sp * 4) xs.push(x1);
  const out = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - out[out.length - 1] >= sp * 2.5) out.push(xs[i]);
    else if (i === xs.length - 1) out[out.length - 1] = xs[i];
  }
  return out;
}

function leftEdge(mask, W, staves, firstLine, sp) {
  // Bar one starts at the clef, so walk left from the first barline through the ink.
  const top = Math.round(staves[0][0]), bottom = Math.round(staves[staves.length - 1][4]);
  let last = firstLine, x = firstLine - 1;
  while (x > 0 && last - x < Math.max(45, sp * 4)) {
    let c = 0;
    for (let y = top; y <= bottom; y += 2) c += mask[y * W + x];
    if (c > 0) last = x;
    x--;
  }
  return last;
}

function buildSystems(mask, W, H, staves) {
  const out = [];
  let i = 0;
  while (i < staves.length) {
    const a = staves[i], b = staves[i + 1];
    const sp = (a[4] - a[0]) / 4;
    const extA = staffExtent(mask, W, a, sp);
    if (!extA) { i += 1; continue; }

    let pair = false, lines = null, x0 = extA[0], x1 = extA[1];
    if (b && b[0] - a[4] < sp * 14) {
      const extB = staffExtent(mask, W, b, sp) || extA;
      const px0 = Math.min(extA[0], extB[0]), px1 = Math.max(extA[1], extB[1]);
      const through = throughLines(mask, W, Math.round(a[0]), Math.round(b[4]), px0, px1, sp);
      if (through.length >= 2) {
        pair = true; lines = through; x0 = px0; x1 = px1;
      } else {
        const la = staffOnlyLines(mask, W, a, px0, px1, sp), lb = staffOnlyLines(mask, W, b, px0, px1, sp);
        const shared = la.filter((x) => lb.some((y) => Math.abs(x - y) <= sp));
        if (shared.length >= 2 && shared.length >= 0.6 * Math.max(la.length, lb.length)) {
          pair = true; lines = shared; x0 = px0; x1 = px1;
        }
      }
    }
    if (!lines) lines = staffOnlyLines(mask, W, a, x0, x1, sp);

    const group = pair ? [a, b] : [a];
    const xs = tidyLines(lines, x0, x1, sp);
    xs[0] = Math.min(xs[0], leftEdge(mask, W, group, xs[0], sp));
    out.push({ staves: group, lines: xs, sp, top: group[0][0], bottom: group[group.length - 1][4] });
    i += pair ? 2 : 1;
  }
  // Give each row a margin for fingering and ledger lines, without running into its neighbours.
  out.forEach((s, k) => {
    const up = k ? (s.top - out[k - 1].bottom) / 2 : s.sp * 4;
    const down = k < out.length - 1 ? (out[k + 1].top - s.bottom) / 2 : s.sp * 4;
    s.y0 = Math.max(0, s.top - Math.min(up, s.sp * 4));
    s.y1 = Math.min(H - 1, s.bottom + Math.min(down, s.sp * 4));
  });
  return out;
}

export function findSystems(img) {
  const { w: W, h: H } = img;
  const n = evenLight(maxChannel(img), W, H);
  let best = null;
  for (const thr of [165, 185, 200, 212, 222]) {
    const mask = threshold(n, thr);
    for (const cover of [0.42, 0.3]) {
      const staves = groupStaves(staffLines(mask, W, H, cover));
      if (!best || staves.length > best.staves.length) best = { staves, mask, thr };
    }
  }
  const systems = buildSystems(best.mask, W, H, best.staves);
  return { systems, thr: best.thr };
}

/* ---------- the whole job for one page ---------- */

// A hazy photo has grey blacks, which clean-up would wash out to an empty page.
function liftContrast(src, sample) {
  const v = maxChannel(sample);
  const hist = new Uint32Array(256);
  for (let i = 0; i < v.length; i++) hist[v[i]]++;
  const at = (share) => {
    let seen = 0, level = 0;
    while (level < 255 && (seen += hist[level]) < v.length * share) level++;
    return level;
  };
  const black = at(0.005), white = at(0.93);
  if (white < 60 || black / white < 0.4) return;
  const scale = 255 / (white - black);
  const { data } = src;
  for (let p = 0; p < data.length; p += 4) {
    for (let k = 0; k < 3; k++) {
      const c = (data[p + k] - black) * scale;
      data[p + k] = c < 0 ? 0 : c > 255 ? 255 : c;
    }
  }
}

// Piano music has a brace and clef at the left of every line, so more ink sits there than at the right.
function rightHeaviness(ink, W, systems) {
  let left = 0, right = 0;
  const reach = Math.round(W * 0.05);
  const brace = Math.round(W * 0.014);
  for (const s of systems) {
    const x0 = Math.round(s.lines[0]), x1 = Math.round(s.lines[s.lines.length - 1]);
    for (let y = Math.round(s.y0); y < s.y1; y++) {
      for (let d = 3; d < reach; d++) {
        if (d < brace && x0 - d >= 0) left += ink[y * W + x0 - d] * 3;
        if (d < brace && x1 + d < W) right += ink[y * W + x1 + d] * 3;
        if (x0 + d < W) left += ink[y * W + x0 + d];
        if (x1 - d >= 0) right += ink[y * W + x1 - d];
      }
    }
  }
  return right / Math.max(left, 1);
}

export function processPage(src, opts = {}) {
  const page = opts.corners ? { corners: opts.corners, found: true } : detectPageCorners(src);
  const shape = pageShape(page.corners);
  const W = WORK_W, H = Math.round(W * clamp(shape.ratio, 0.55, 1.75));

  liftContrast(src, warp(src, page.corners, W, H, null));
  const first = warp(src, page.corners, W, H, null);
  const ink = threshold(evenLight(maxChannel(first), W, H), 185);
  const tilt = estimateTilt(ink, W, H);
  const tiltAt = tiltFn(tilt.coeffs, H);

  const level = warp(src, page.corners, W, H, tiltAt);
  const { systems, thr } = findSystems(level);

  const rightHeavy = systems.length ? rightHeaviness(threshold(evenLight(maxChannel(level), W, H), 185), W, systems) : 0;

  const outW = Math.round(clamp(shape.across, WORK_W, MAX_OUT_W));
  const outH = Math.round((outW * H) / W);
  const image = opts.skipImage ? null : cleanScan(warp(src, page.corners, outW, outH, tiltAt, outW / W));

  return {
    image,
    corners: page.corners,
    pageFound: page.found,
    width: outW,
    height: outH,
    thr,
    rightHeavy,
    upsideDown: rightHeavy > TURN_AT,
    rows: systems.map((s) => ({
      top: s.y0 / H,
      bottom: s.y1 / H,
      lines: s.lines.map((x) => x / W),
      staves: s.staves.length,
    })),
  };
}
