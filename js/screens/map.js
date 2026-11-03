import { h, go, icon, pen, sticker, sheet, closeSheet, seeded, strokePath } from '../ui.js';
import { get, put, progressMap } from '../store.js';
import {
  PENS, listBars, playableBars, blankProgress, nextStage, practiceStages, checkStage, waitingForCheck,
  checkGroups, topStage, dayKey, barsLabel, newId,
} from '../model.js';
import { pageUrl, drawBars } from '../images.js';
import { session } from '../session.js';
import { missing, stepper } from './common.js';

const MAX_CHUNK = 4;

export async function mapScreen([id], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  let progress = await progressMap(id);
  const bars = listBars(piece);
  const parent = session.parent;
  let painting = null;

  const views = [];
  const pagesEl = h('div', { class: 'pages' });
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
    pagesEl.append(box);
    views.push({ box, canvas, hits, top, span, bars: bars.filter((b) => b.page === index) });
  }

  function draw(view) {
    const { box, canvas, top, span } = view;
    const w = box.clientWidth, height = box.clientHeight;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr);
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    c.globalCompositeOperation = 'multiply';
    const px = (b) => ({ x0: b.x0 * w, x1: b.x1 * w, y0: ((b.y0 - top) / span) * height, y1: ((b.y1 - top) / span) * height });
    for (const bar of view.bars) {
      const { x0, x1, y0, y1 } = px(bar);
      if (bar.skip) {
        c.fillStyle = '#D9DCE0';
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        continue;
      }
      const prog = progress.get(bar.id);
      if (!prog) continue;
      const band = (y1 - y0) / piece.stages.length;
      piece.stages.forEach((st, i) => {
        if (!prog.done[st.id]) return;
        const rand = seeded(bar.id + st.id);
        const topEdge = y0 + band * i;
        strokePath(c, x0 + 1, x1 - 1, topEdge - 1, topEdge + band + 1, rand, Math.max(1.5, band * 0.14));
        c.fillStyle = PENS[st.pen];
        c.fill();
      });
    }
  }

  function chips(view) {
    const { top, span } = view;
    view.hits.replaceChildren(...view.bars.map((bar) => {
      const prog = progress.get(bar.id);
      const reached = topStage(piece, prog);
      const waiting = waitingForCheck(piece, bar, prog);
      const checked = checkStage(piece) && prog?.done[checkStage(piece).id];
      const label = [
        `Bar ${bar.n}`,
        bar.skip ? 'skipped' : reached ? `reached ${reached.name}` : 'not started',
        prog?.flagged ? 'tough bar' : '',
        prog?.notes.length ? 'has a note' : '',
        waiting ? 'ready for a next-day check' : '',
      ].filter(Boolean).join(', ');
      return h('button', {
        class: `bar-hit ${bar.skip ? 'skipped' : ''} ${waiting ? 'waiting' : ''}`,
        'aria-label': label,
        disabled: bar.skip && !parent,
        style: {
          left: `${bar.x0 * 100}%`, width: `${(bar.x1 - bar.x0) * 100}%`,
          top: `${((bar.y0 - top) / span) * 100}%`, height: `${((bar.y1 - bar.y0) / span) * 100}%`,
        },
        onClick: () => onBar(bar),
      },
      h('span', { class: 'num' }, bar.n),
      h('span', { class: 'marks' },
        prog?.flagged && h('span', { class: 'mark flag' }, icon('flag', 18)),
        prog?.notes.length ? h('span', { class: 'mark note' }, icon('note', 18)) : null,
        checked && h('span', { class: 'mark star' }, sticker(26))));
    }));
  }

  const counts = () => piece.stages.map((s) => playableBars(piece).filter((b) => progress.get(b.id)?.done[s.id]).length);

  const trayEl = h('footer', { class: 'tray' });
  function tray() {
    const c = counts();
    const total = playableBars(piece).length;
    trayEl.replaceChildren(...piece.stages.map((s, i) => h(parent ? 'button' : 'div', {
      class: `tray-pen ${painting === s.id ? 'active' : ''}`,
      'aria-pressed': parent ? String(painting === s.id) : null,
      onClick: parent ? () => { painting = painting === s.id ? null : s.id; tray(); hint(); } : null,
    }, pen(PENS[s.pen], 30), h('span', { class: 'tray-name' }, s.name), h('span', { class: 'tray-count' }, `${c[i]} of ${total}`))));
  }

  const bannerEl = h('div', { class: 'banner-slot' });
  function banner() {
    const groups = checkGroups(piece, progress);
    const count = groups.flat().length;
    bannerEl.replaceChildren(...(count ? [h('div', { class: 'banner' },
      sticker(46),
      h('p', {}, `${count} ${count === 1 ? 'bar is' : 'bars are'} ready for a next-day check.`),
      h('button', { class: 'btn primary', onClick: () => go(`/check/${id}`) }, 'Start check'))] : []));
  }

  const hintEl = h('p', { class: 'paint-hint' });
  function hint() {
    if (!parent) return;
    const s = piece.stages.find((x) => x.id === painting);
    hintEl.textContent = s ? `Tap bars to mark or clear “${s.name}”. Tap the pen again to stop.` : 'Tap a bar to add a teacher note. Tap a pen, then tap bars, to mark what is already learned.';
  }

  function refresh() {
    views.forEach((v) => { draw(v); chips(v); });
    tray(); banner();
  }

  async function saveProg(prog) {
    await put('progress', prog);
    progress.set(prog.barId, prog);
  }

  async function onBar(bar) {
    if (painting) {
      const prog = progress.get(bar.id) || blankProgress(id, bar.id);
      if (prog.done[painting]) delete prog.done[painting];
      else prog.done[painting] = Date.now();
      await saveProg(prog);
      refresh();
      return;
    }
    openBar(bar);
  }

  function openBar(bar) {
    let count = 1;
    let chosen = null;
    const playable = playableBars(piece);
    const startAt = playable.findIndex((b) => b.id === bar.id);
    const prog = () => progress.get(bar.id) || blankProgress(id, bar.id);
    const chunk = () => (startAt < 0 ? [bar] : playable.slice(startAt, startAt + count));

    if (bar.skip) {
      sheet([h('h2', {}, `Bar ${bar.n} is skipped`), h('p', {}, 'Change this in the piece settings, under Check the boxes.')]);
      return;
    }

    const cropBox = h('div', { class: 'crop' }, h('canvas', {}));
    const body = h('div', { class: 'bar-body' });

    async function paintCrop() {
      const width = cropBox.clientWidth || 560;
      await drawBars(cropBox.firstChild, chunk(), { width, height: 220 });
    }

    function stageRow(s) {
      const p = prog();
      const isCheck = s.pace === 'nextday';
      const isDone = chunk().every((b) => progress.get(b.id)?.done[s.id]);
      const waiting = isCheck && waitingForCheck(piece, bar, progress.get(bar.id));
      const today = isCheck && p.lastCheck === dayKey(Date.now());
      const status = isDone ? 'Done' : isCheck ? (waiting ? 'Ready now' : today ? 'Try again tomorrow' : 'After full speed') : '';
      const select = isCheck ? null : () => { chosen = s.id; renderBody(); };
      return h(select ? 'button' : 'div', {
        class: `stage-row ${chosen === s.id ? 'chosen' : ''}`,
        'aria-pressed': select ? String(chosen === s.id) : null,
        onClick: select,
      },
      h('span', { class: 'swatch', style: { background: PENS[s.pen] } }),
      h('span', { class: 'stage-name' }, s.name),
      h('span', { class: 'stage-status' }, status),
      parent && h('input', {
        type: 'checkbox',
        class: 'tick',
        'aria-label': `${s.name} done for this bar`,
        checked: !!p.done[s.id],
        onClick: (e) => e.stopPropagation(),
        onChange: async (e) => {
          const next = prog();
          if (e.target.checked) next.done[s.id] = Date.now(); else delete next.done[s.id];
          await saveProg(next);
          refresh(); renderBody();
        },
      }));
    }

    function notes() {
      const p = prog();
      const input = h('textarea', { rows: 2, 'aria-label': 'New note', placeholder: parent ? 'What did the teacher say about this bar?' : 'Add my own note' });
      return h('div', { class: 'notes' },
        p.notes.map((n) => h('div', { class: 'note-line' },
          h('span', { class: 'who' }, n.who === 'teacher' ? 'Teacher' : 'Me'),
          h('p', {}, n.text),
          (parent || n.who === 'me') && h('button', {
            class: 'round small', 'aria-label': 'Delete note',
            onClick: async () => {
              const next = prog();
              next.notes = next.notes.filter((x) => x.id !== n.id);
              await saveProg(next);
              refresh(); renderBody();
            },
          }, icon('close', 18)))),
        input,
        h('button', {
          class: 'btn', onClick: async () => {
            const text = input.value.trim();
            if (!text) { input.focus(); return; }
            const next = prog();
            next.notes = [...next.notes, { id: newId(), who: parent ? 'teacher' : 'me', text, at: Date.now() }];
            await saveProg(next);
            refresh(); renderBody();
          },
        }, 'Save note'));
    }

    function renderBody() {
      const p = prog();
      const list = chunk();
      if (!chosen) chosen = (nextStage(piece, p) || practiceStages(piece).at(-1))?.id;
      const stage = piece.stages.find((s) => s.id === chosen);
      body.replaceChildren(
        h('div', { class: 'chunk-line' },
          h('span', {}, 'Practise'),
          stepper({
            label: 'Bars to practise', value: count, min: 1, max: Math.min(MAX_CHUNK, playable.length - startAt), compact: true,
            format: (v) => `${v} ${v === 1 ? 'bar' : 'bars'}`,
            onChange: (v) => { count = v; paintCrop(); renderBody(); },
          })),
        h('div', { class: 'stages' }, piece.stages.map(stageRow)),
        stage && h('button', {
          class: 'btn primary big wide',
          onClick: () => {
            const ids = list.map((b) => b.id).join(',');
            closeSheet();
            go(`/train/${id}/${ids}/${chosen}`);
          },
        }, `Practise ${barsLabel(list).toLowerCase()}`),
        h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox', checked: !!p.flagged,
            onChange: async (e) => {
              const next = prog();
              next.flagged = e.target.checked;
              await saveProg(next);
              refresh();
            },
          }),
          h('span', {}, 'Tough bar')),
        notes());
    }

    sheet([
      h('header', { class: 'sheet-head' },
        h('h2', {}, `Bar ${bar.n}`),
        h('button', { class: 'round', 'aria-label': 'Close', onClick: () => closeSheet() }, icon('close'))),
      cropBox, body,
    ], { kind: 'bar-sheet' });
    renderBody();
    requestAnimationFrame(() => paintCrop());
  }

  const ro = new ResizeObserver(() => views.forEach(draw));
  ctx.onShow(() => { views.forEach((v) => ro.observe(v.box)); refresh(); hint(); });
  ctx.onLeave(() => ro.disconnect());

  return h('main', { class: 'screen map' },
    h('header', { class: 'bar-top' },
      h('button', {
        class: 'round', 'aria-label': 'Back',
        onClick: () => go(parent ? `/parent/piece/${id}` : `/player/${piece.playerId}`),
      }, icon('back')),
      h('h1', {}, piece.title)),
    parent && hintEl,
    bannerEl, pagesEl, trayEl);
}
