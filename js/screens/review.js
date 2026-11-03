import { h, go, fill, icon, sheet, closeSheet, toast } from '../ui.js';
import { get, put } from '../store.js';
import { listBars, newId, rowsToLayoutRows } from '../model.js';
import { findBars } from '../detect-client.js';
import { pageUrl, forgetPage } from '../images.js';
import { session } from '../session.js';
import { busyPanel, stepper, missing } from './common.js';
import { gate } from './parent.js';

const MIN_GAP = 0.012;

export async function review([id], ctx) {
  if (!session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  let pi = 0;
  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => put('pieces', piece), 200); };
  const saveNow = () => { clearTimeout(saveTimer); return put('pieces', piece); };

  const stageEl = h('div', { class: 'review-page' });
  const summary = h('p', { class: 'review-sum' });
  const tools = h('div', { class: 'row-buttons left' });
  const pager = h('div', { class: 'pager' });

  const total = () => listBars(piece).length;

  function dragger(el, onMove, onEnd) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const rect = stageEl.getBoundingClientRect();
      const move = (ev) => onMove((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        onEnd();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  function barActions(rowIndex, i, n, tapX) {
    const pg = piece.layout[pi];
    const row = pg.rows[rowIndex];
    const bar = row.bars[i];
    const change = () => { closeSheet(); save(); drawOverlay(); };
    sheet([
      h('h2', {}, `Bar ${n}`),
      h('div', { class: 'stack-buttons' },
        h('button', { class: 'btn', onClick: () => { bar.skip = !bar.skip; change(); } }, bar.skip ? 'Keep this bar' : 'Skip this bar'),
        h('button', {
          class: 'btn',
          onClick: () => {
            row.lines.splice(i + 1, 0, tapX);
            row.bars.splice(i + 1, 0, { id: newId(), skip: false });
            change();
          },
        }, 'Split this bar where I tapped'),
        i < row.bars.length - 1 && h('button', {
          class: 'btn',
          onClick: () => {
            row.lines.splice(i + 1, 1);
            row.bars.splice(i + 1, 1);
            change();
          },
        }, 'Join with the next bar'),
        h('button', {
          class: 'btn danger',
          onClick: () => { pg.rows.splice(rowIndex, 1); change(); },
        }, 'Remove this whole row')),
    ]);
  }

  function drawOverlay() {
    const pg = piece.layout[pi];
    const bars = listBars(piece).filter((b) => b.page === pi);
    const overlay = stageEl.querySelector('.review-boxes');
    const items = [];
    pg.rows.forEach((row, r) => {
      const box = h('div', {
        class: 'r-row',
        style: { top: `${row.top * 100}%`, height: `${(row.bottom - row.top) * 100}%` },
      });
      items.push(box);
      row.bars.forEach((bar, i) => {
        const info = bars.find((b) => b.id === bar.id);
        box.append(h('button', {
          class: `r-bar ${bar.skip ? 'skip' : ''}`,
          style: { left: `${row.lines[i] * 100}%`, width: `${(row.lines[i + 1] - row.lines[i]) * 100}%` },
          'aria-label': `Bar ${info.n}${bar.skip ? ', skipped' : ''}. Tap to change.`,
          onClick: (e) => {
            const rect = stageEl.getBoundingClientRect();
            barActions(r, i, info.n, (e.clientX - rect.left) / rect.width);
          },
        }, h('span', { class: 'num' }, info.n)));
      });
      row.lines.forEach((x, i) => {
        const line = h('div', { class: 'r-line', style: { left: `${x * 100}%` } });
        dragger(line, (nx) => {
          const lo = i ? row.lines[i - 1] + MIN_GAP : 0;
          const hi = i < row.lines.length - 1 ? row.lines[i + 1] - MIN_GAP : 1;
          row.lines[i] = Math.min(hi, Math.max(lo, nx));
          line.style.left = `${row.lines[i] * 100}%`;
        }, () => { save(); drawOverlay(); });
        box.append(line);
      });
      const edge = (name, key) => {
        const bar = h('div', { class: `r-edge ${name}` });
        dragger(bar, (_, ny) => {
          const lo = key === 'top' ? (r ? pg.rows[r - 1].bottom : 0) : row.top + 0.03;
          const hi = key === 'top' ? row.bottom - 0.03 : (r < pg.rows.length - 1 ? pg.rows[r + 1].top : 1);
          row[key] = Math.min(hi, Math.max(lo, ny));
          box.style.top = `${row.top * 100}%`;
          box.style.height = `${(row.bottom - row.top) * 100}%`;
        }, () => { save(); drawOverlay(); });
        box.append(bar);
      };
      edge('top', 'top');
      edge('bottom', 'bottom');
    });
    overlay.replaceChildren(...items);
    const count = bars.length, skipped = bars.filter((b) => b.skip).length;
    summary.textContent = `Page ${pi + 1} of ${piece.layout.length}: ${count} ${count === 1 ? 'bar' : 'bars'}${skipped ? `, ${skipped} skipped` : ''}. ${total()} in the piece.`;
  }

  async function redo(options) {
    const pg = piece.layout[pi];
    const page = await get('pages', pg.pageId);
    sheet(busyPanel('Finding the bars again'), { dismiss: false });
    try {
      const found = await findBars(page.original, { rotate: page.rotate, corners: options.corners || null });
      Object.assign(page, { blob: found.blob, width: found.width, height: found.height, corners: found.corners, sourceWidth: found.sourceWidth, sourceHeight: found.sourceHeight });
      await put('pages', page);
      forgetPage(page.id);
      piece.layout[pi] = { pageId: page.id, width: found.width, height: found.height, rows: rowsToLayoutRows(found.rows) };
      await saveNow();
    } catch (err) {
      toast(`That page could not be read: ${err.message}`);
    }
    closeSheet();
    await showPage();
  }

  async function turn() {
    sheet(busyPanel('Turning the page'), { dismiss: false });
    const page = await get('pages', piece.layout[pi].pageId);
    page.rotate = (page.rotate + 90) % 360;
    await put('pages', page);
    await redo({});
  }

  async function fixCorners() {
    const page = await get('pages', piece.layout[pi].pageId);
    const bmp = await createImageBitmap(page.original);
    const w = page.sourceWidth, ht = page.sourceHeight;        // the picture the corners were measured on
    const scale = Math.min(1, 1400 / Math.max(w, ht));
    const canvas = h('canvas', { width: Math.round(w * scale), height: Math.round(ht * scale) });
    const c = canvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.scale(scale, scale);
    c.translate(w / 2, ht / 2);
    c.rotate((page.rotate * Math.PI) / 180);
    const across = page.rotate % 180 ? ht : w, down = page.rotate % 180 ? w : ht;
    c.drawImage(bmp, -across / 2, -down / 2, across, down);
    bmp.close();

    const corners = page.corners.map(([x, y]) => [x / w, y / ht]);
    const poly = h('svg:polygon', { fill: 'rgba(121,210,255,.25)', stroke: '#2F3237', 'stroke-width': 0.4, 'vector-effect': 'non-scaling-stroke' });
    const svg = h('svg:svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'corner-svg', 'aria-hidden': 'true' }, poly);
    const frame = h('div', { class: 'corner-frame', style: { aspectRatio: `${w} / ${ht}` } }, canvas, svg);
    const drawPoly = () => poly.setAttribute('points', corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
    drawPoly();
    corners.forEach((pt, i) => {
      const dot = h('div', { class: 'corner-dot', style: { left: `${pt[0] * 100}%`, top: `${pt[1] * 100}%` } });
      dot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dot.setPointerCapture(e.pointerId);
        const rect = frame.getBoundingClientRect();
        const move = (ev) => {
          pt[0] = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
          pt[1] = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
          dot.style.left = `${pt[0] * 100}%`; dot.style.top = `${pt[1] * 100}%`;
          drawPoly();
        };
        const up = () => { dot.removeEventListener('pointermove', move); dot.removeEventListener('pointerup', up); };
        dot.addEventListener('pointermove', move);
        dot.addEventListener('pointerup', up);
      });
      frame.append(dot);
    });
    sheet([
      h('h2', {}, 'Drag the dots to the page corners'),
      frame,
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onClick: () => closeSheet() }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            closeSheet();
            redo({ corners: corners.map(([x, y]) => [x * (w - 1), y * (ht - 1)]) });
          },
        }, 'Use these corners')),
    ], { kind: 'wide' });
  }

  function addRow() {
    const pg = piece.layout[pi];
    const rows = pg.rows;
    const edges = [0, ...rows.flatMap((r) => [r.top, r.bottom]), 1];
    let best = { size: -1, at: 0 };
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const size = edges[i + 1] - edges[i];
      if (size > best.size) best = { size, at: edges[i] };
    }
    const height = Math.min(0.12, best.size * 0.8);
    if (height < 0.03) { toast('There is no room for another row. Move a row first.'); return; }
    const top = best.at + (best.size - height) / 2;
    rows.push({ top, bottom: top + height, lines: [0.08, 0.92], bars: [{ id: newId(), skip: false }] });
    rows.sort((a, b) => a.top - b.top);
    save();
    drawOverlay();
  }

  async function showPage() {
    const pg = piece.layout[pi];
    const page = await get('pages', pg.pageId);
    const hasOriginal = !!page.original;
    stageEl.style.aspectRatio = `${pg.width} / ${pg.height}`;
    stageEl.replaceChildren(h('img', { src: await pageUrl(pg.pageId), alt: `Page ${pi + 1}` }), h('div', { class: 'review-boxes' }));
    drawOverlay();
    fill(tools,
      h('button', { class: 'btn', onClick: addRow }, 'Add a row'),
      hasOriginal && h('button', { class: 'btn', onClick: turn }, icon('rotate', 22), 'Turn the page'),
      hasOriginal && h('button', { class: 'btn', onClick: fixCorners }, 'Fix the corners'));
    pager.replaceChildren(...(piece.layout.length > 1 ? [
      h('button', { class: 'round', 'aria-label': 'Previous page', disabled: pi === 0, onClick: () => { pi -= 1; showPage(); } }, icon('back')),
      h('button', { class: 'round flip', 'aria-label': 'Next page', disabled: pi === piece.layout.length - 1, onClick: () => { pi += 1; showPage(); } }, icon('back')),
    ] : []));
    window.scrollTo(0, 0);
  }

  async function finish() {
    if (!total()) { toast('Add at least one bar first.'); return; }
    const wasDraft = piece.draft;
    delete piece.draft;
    await saveNow();
    if (wasDraft) {
      for (const pg of piece.layout) {
        const page = await get('pages', pg.pageId);
        delete page.original;
        await put('pages', page);
      }
      try { await navigator.storage?.persist?.(); } catch { /* the browser decides */ }
    }
    go(`/piece/${id}`);
  }

  ctx.onShow(showPage);
  ctx.onLeave(() => saveNow());

  return h('main', { class: 'screen review' },
    h('header', { class: 'bar-top' },
      h('button', { class: 'round', 'aria-label': 'Back', onClick: () => go(piece.draft ? '/parent/add' : `/parent/piece/${id}`) }, icon('back')),
      h('h1', {}, 'Check the boxes')),
    h('p', { class: 'field-hint' }, 'Each box should hold one bar, and the numbers should match the printed ones. Drag a line to move it. Tap a bar to skip, split or join it.'),
    summary, tools, stageEl,
    h('div', { class: 'review-end' },
      pager,
      h('div', { class: 'field inline' },
        h('span', { class: 'field-label' }, 'First bar number'),
        stepper({ label: 'First bar number', value: piece.firstBar ?? 1, min: 0, max: 999, compact: true, onChange: (v) => { piece.firstBar = v; save(); drawOverlay(); } })),
      h('button', { class: 'btn primary big', onClick: finish }, piece.draft ? 'Save piece' : 'Done')));
}
