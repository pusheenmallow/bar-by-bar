import { h, go, fill, icon, sticker, sheet, closeSheet } from '../ui.js';
import { get, put, progressMap, timeDocs, dayTotal, timeSaved } from '../store.js';
import {
  penVar, listBars, playableBars, blankProgress, nextStage, practiceStages, checkStage, waitingForCheck,
  checkGroups, topStage, dayKey, barsLabel, newId, goalSeconds, timeText, clockText, numberRanges,
} from '../model.js';
import { drawBars } from '../images.js';
import { cssVar } from '../theme.js';
import { session } from '../session.js';
import { missing, stepper } from './common.js';
import { scorePages, layer, hitPlace } from './score.js';

const MAX_CHUNK = 12;
const HEAT_STEPS = 4;              // one hue in the stylesheet: stronger means more time

export async function mapScreen([id], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  await timeSaved();
  let progress = await progressMap(id);
  const docs = await timeDocs(id);
  const bars = listBars(piece);
  const playable = playableBars(piece);
  const parent = session.parent;
  let painting = null;
  let viewing = 'stages';
  let tool = 'bar';
  let firstPick = null;

  const barTime = new Map();
  for (const doc of docs) {
    for (const [barId, row] of Object.entries(doc.bars)) barTime.set(barId, (barTime.get(barId) || 0) + row[0] + row[1] + row[2]);
  }
  const mostTime = Math.max(0, ...barTime.values());
  const totalTime = docs.reduce((sum, d) => sum + dayTotal(d), 0);
  const today = docs.find((d) => d.day === dayKey(Date.now()));
  const todaySeconds = dayTotal(today);
  const goal = goalSeconds(piece);

  const { el: pagesEl, views } = await scorePages(piece, bars);

  const timeBin = (seconds) => Math.min(HEAT_STEPS - 1, Math.floor((seconds / mostTime) * HEAT_STEPS));

  function draw(view) {
    const pad = layer(view);
    if (!pad) return;
    const { c, px } = pad;
    for (const bar of view.bars) {
      const { x0, x1, y0, y1 } = px(bar);
      if (bar.skip) {
        c.fillStyle = cssVar('--skip');
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        continue;
      }
      if (viewing === 'time') {
        const seconds = barTime.get(bar.id);
        if (!seconds) continue;
        c.fillStyle = cssVar(`--heat-${timeBin(seconds) + 1}`);
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        continue;
      }
      const prog = progress.get(bar.id);
      const top = topStage(piece, prog);
      if (!top) continue;

      // A soft wash in the furthest stage's colour, and a thin line of stages along the bottom.
      c.fillStyle = cssVar(`--wash-${top.pen}`);
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
      const inset = 5, gap = 2, tall = 3;
      const each = (x1 - x0 - inset * 2 - gap * (piece.stages.length - 1)) / piece.stages.length;
      piece.stages.forEach((st, i) => {
        c.fillStyle = prog.done[st.id] ? cssVar(`--tick-${st.pen}`) : cssVar('--tick-empty');
        c.fillRect(x0 + inset + i * (each + gap), y1 - tall - 3, each, tall);
      });
    }
  }

  function chips(view) {
    const busiest = [...barTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    view.hits.replaceChildren(...view.bars.map((bar) => {
      const prog = progress.get(bar.id);
      const reached = topStage(piece, prog);
      const waiting = waitingForCheck(piece, bar, prog);
      const checked = checkStage(piece) && prog?.done[checkStage(piece).id];
      const seconds = barTime.get(bar.id) || 0;
      const inStages = viewing === 'stages';
      const label = [
        `Bar ${bar.n}`,
        bar.skip ? 'skipped' : reached ? `reached ${reached.name}` : 'not started',
        seconds ? `${timeText(seconds)} practised` : '',
        prog?.flagged ? 'tough bar' : '',
        prog?.runSlip ? 'slipped in the last whole-piece play' : '',
        prog?.notes.length ? 'has a note' : '',
        waiting ? 'ready for a next-day check' : '',
      ].filter(Boolean).join(', ');
      return h('button', {
        class: `bar-hit ${bar.skip ? 'skipped' : ''} ${waiting && inStages ? 'waiting' : ''} ${firstPick?.id === bar.id ? 'picked' : ''}`,
        'aria-label': label,
        disabled: bar.skip && !parent,
        style: hitPlace(bar, view),
        onClick: () => onBar(bar),
      },
      h('span', { class: 'num' }, bar.n),
      !inStages && busiest.includes(bar.id) && seconds ? h('span', { class: 'bar-time' }, clockText(seconds)) : null,
      inStages && h('span', { class: 'marks' },
        prog?.runSlip ? h('span', { class: 'mark slipped', title: 'Slipped in the whole piece' }, '!') : null,
        prog?.flagged && h('span', { class: 'mark flag' }, icon('flag', 18)),
        prog?.notes.length ? h('span', { class: 'mark note' }, icon('note', 18)) : null,
        checked && h('span', { class: 'mark star' }, sticker(20))));
    }));
  }

  const counts = () => piece.stages.map((s) => playable.filter((b) => progress.get(b.id)?.done[s.id]).length);

  const trayEl = h('footer', { class: 'tray' });
  function tray() {
    if (viewing === 'time') {
      trayEl.replaceChildren(h('div', { class: 'time-key' },
        h('span', { class: 'tray-name' }, `Total ${timeText(totalTime)}`),
        h('span', { class: 'tray-count' }, 'Less'),
        [1, 2, 3, 4].map((n) => h('i', { style: { background: `var(--heat-${n})` } })),
        h('span', { class: 'tray-count' }, 'More'),
        h('span', { class: 'tray-count key-note' }, 'Phrase and whole-piece time is shared evenly across the bars played.')));
      return;
    }
    const c = counts();
    trayEl.replaceChildren(...piece.stages.map((s, i) => h(parent ? 'button' : 'div', {
      class: `tray-pen ${painting === s.id ? 'active' : ''}`,
      'aria-pressed': parent ? String(painting === s.id) : null,
      onClick: parent ? () => { painting = painting === s.id ? null : s.id; tray(); hint(); } : null,
    }, h('i', { class: 'tray-swatch', style: { background: penVar(s.pen) } }), h('span', { class: 'tray-name' }, s.name), h('span', { class: 'tray-count' }, `${c[i]} of ${playable.length}`))));
  }

  /* ---------- how to practise ---------- */
  const modeEl = h('div', { class: 'mode-row', role: 'group', 'aria-label': 'How to practise' });
  function modes() {
    const seg = (label, active, onClick) => h('button', { class: `seg ${active ? 'on' : ''}`, 'aria-pressed': String(active), onClick }, label);
    modeEl.replaceChildren(
      seg('One bar', tool === 'bar', () => { tool = 'bar'; firstPick = null; refresh(); }),
      seg('Phrase', tool === 'phrase', () => { tool = 'phrase'; firstPick = null; viewing = 'stages'; refresh(); }),
      h('button', { class: 'seg', onClick: () => go(`/whole/${id}`) }, 'Whole piece'),
      h('span', { class: 'seg-gap' }),
      seg('Time map', viewing === 'time', () => { viewing = viewing === 'time' ? 'stages' : 'time'; refresh(); }),
      h('button', { class: 'seg', onClick: () => go(`/stats/${id}`) }, 'Stats'));
  }

  const clockEl = h('div', { class: 'clock wide' });
  function clockLine() {
    const reached = goal && todaySeconds >= goal;
    clockEl.classList.toggle('reached', !!reached);
    clockEl.classList.toggle('no-goal', !goal);
    fill(clockEl,
      goal ? h('span', { class: 'clock-track', 'aria-hidden': 'true' }, h('i', { class: 'clock-fill', style: { width: `${Math.min(100, (todaySeconds / goal) * 100)}%` } })) : null,
      h('span', { class: 'clock-text' }, goal
        ? `${timeText(todaySeconds)} of ${timeText(goal)} today`
        : `${timeText(todaySeconds)} today`));
  }

  const bannerEl = h('div', { class: 'banner-slot' });
  function banner() {
    const count = checkGroups(piece, progress).flat().length;
    const slipped = playable.filter((b) => progress.get(b.id)?.runSlip);
    const nudge = goal && todaySeconds >= goal * 0.7 && !(today?.modes.piece > 0) && playable.length > 2;
    let content = [];
    if (count) {
      content = [sticker(34), h('p', {}, `${count} ${count === 1 ? 'bar is' : 'bars are'} ready for a next-day check.`),
        h('button', { class: 'btn primary', onClick: () => go(`/check/${id}`) }, 'Start check')];
    } else if (slipped.length) {
      content = [h('span', { class: 'mark slipped big' }, '!'),
        h('p', {}, `${slipped.length === 1 ? 'Bar' : 'Bars'} ${numberRanges(slipped.map((b) => b.n))} slipped in the whole piece.`),
        h('button', { class: 'btn primary', onClick: () => openBar(slipped[0]) }, `Fix bar ${slipped[0].n}`)];
    } else if (nudge) {
      content = [sticker(34), h('p', {}, 'Nearly at today’s goal. Finish with the whole piece?'),
        h('button', { class: 'btn primary', onClick: () => go(`/whole/${id}`) }, 'Whole piece')];
    }
    bannerEl.replaceChildren(...(content.length ? [h('div', { class: 'banner' }, content)] : []));
  }

  const hintEl = h('p', { class: 'paint-hint' });
  function hint() {
    if (parent) {
      const s = piece.stages.find((x) => x.id === painting);
      hintEl.textContent = s ? `Tap bars to mark or clear “${s.name}”. Tap the pen again to stop.` : 'Tap a bar to add a teacher note. Tap a pen, then tap bars, to mark what is already learned.';
      return;
    }
    if (tool === 'phrase') hintEl.textContent = firstPick ? `Bar ${firstPick.n} is the start. Now tap the last bar.` : 'Tap the first bar of the phrase.';
    else hintEl.textContent = viewing === 'time' ? 'Deeper colour means more time on that bar.' : '';
  }

  function refresh() {
    views.forEach((v) => { draw(v); chips(v); });
    tray(); banner(); modes(); hint(); clockLine();
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
    if (tool === 'phrase') {
      if (!firstPick) { firstPick = bar; refresh(); return; }
      let a = playable.findIndex((b) => b.id === firstPick.id), b = playable.findIndex((x) => x.id === bar.id);
      if (a > b) [a, b] = [b, a];
      firstPick = null; tool = 'bar';
      refresh();
      openBar(playable[a], Math.min(MAX_CHUNK, b - a + 1));
      return;
    }
    openBar(bar);
  }

  function openBar(bar, startCount = 1) {
    let count = startCount;
    let chosen = null;
    const startAt = playable.findIndex((b) => b.id === bar.id);
    const prog = () => progress.get(bar.id) || blankProgress(id, bar.id);
    const chunk = () => (startAt < 0 ? [bar] : playable.slice(startAt, startAt + count));

    if (bar.skip) {
      sheet([h('h2', {}, `Bar ${bar.n} is skipped`), h('p', {}, 'Change this in the piece settings, under Check the boxes.')]);
      return;
    }

    const cropBox = h('div', { class: 'crop' }, h('canvas', {}));
    const body = h('div', { class: 'bar-body' });
    const heading = h('h2', {}, barsLabel(chunk()));

    async function paintCrop() {
      const width = cropBox.clientWidth || 560;
      await drawBars(cropBox.firstChild, chunk(), { width, height: count > 4 ? 300 : 220 });
    }

    function stageRow(s) {
      const p = prog();
      const isCheck = s.pace === 'nextday';
      const isDone = chunk().every((b) => progress.get(b.id)?.done[s.id]);
      const waiting = isCheck && waitingForCheck(piece, bar, progress.get(bar.id));
      const today2 = isCheck && p.lastCheck === dayKey(Date.now());
      const status = isDone ? 'Done' : isCheck ? (waiting ? 'Ready now' : today2 ? 'Try again tomorrow' : 'After full speed') : '';
      const select = isCheck ? null : () => { chosen = s.id; renderBody(); };
      return h(select ? 'button' : 'div', {
        class: `stage-row ${chosen === s.id ? 'chosen' : ''}`,
        'aria-pressed': select ? String(chosen === s.id) : null,
        onClick: select,
      },
      h('span', { class: 'swatch', style: { background: penVar(s.pen) } }),
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
      heading.textContent = barsLabel(list);
      if (!chosen) chosen = (nextStage(piece, p) || practiceStages(piece).at(-1))?.id;
      const stage = piece.stages.find((s) => s.id === chosen);
      const seconds = barTime.get(bar.id) || 0;
      const tries = p.clean + p.slips;
      fill(body,
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
        count === 1 && (seconds || tries) ? h('p', { class: 'bar-facts' },
          `${timeText(seconds)} on bar ${bar.n}. ${tries ? `${p.clean} of ${tries} tries clean.` : ''}`) : null,
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
        heading,
        h('button', { class: 'round', 'aria-label': 'Close', onClick: () => closeSheet() }, icon('close'))),
      cropBox, body,
    ], { kind: 'bar-sheet' });
    renderBody();
    requestAnimationFrame(() => paintCrop());
  }

  const ro = new ResizeObserver(() => views.forEach(draw));
  const redraw = () => views.forEach(draw);
  ctx.onShow(() => {
    views.forEach((v) => ro.observe(v.box));
    refresh();
    window.addEventListener('themechange', redraw);
  });
  ctx.onLeave(() => {
    ro.disconnect();
    window.removeEventListener('themechange', redraw);
  });

  return h('main', { class: 'screen map' },
    h('header', { class: 'bar-top' },
      h('button', {
        class: 'round', 'aria-label': 'Back',
        onClick: () => go(parent ? `/parent/piece/${id}` : `/player/${piece.playerId}`),
      }, icon('back')),
      h('h1', {}, piece.title)),
    clockEl,
    !parent && modeEl,
    hintEl,
    bannerEl, pagesEl, trayEl);
}
