import { h, fill } from '../ui.js';
import { get, all, byIndex, timeDocs, dayTotal, timeSaved, attemptsSaved } from '../store.js';
import { MODES, playableBars, dayKey, goalSeconds, timeText, clockText, numberRanges, shadowAgreement, SHADOW_ENOUGH } from '../model.js';
import { shadowStatsOn } from '../shadow.js';
import { session } from '../session.js';
import { missing, backTo, doneButton, learnerTabs } from './common.js';
import { gate } from './parent.js';

const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: 'Last 7 days', days: 7 },
  { id: 'all', label: 'All time', days: Infinity },
];

const dayStart = (offset) => {
  const d = new Date(Date.now());
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d;
};

function dailyChart(rows, goal) {
  const width = 720, height = 210;
  const m = { left: 34, right: 46, top: 18, bottom: 26 };
  const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
  const top = Math.max(goal / 60, ...rows.map((r) => r.seconds / 60), 5);
  const step = top <= 10 ? 2 : top <= 25 ? 5 : top <= 60 ? 10 : 20;
  const ceiling = Math.ceil(top / step) * step;
  const y = (v) => m.top + plotH - (v / ceiling) * plotH;
  const band = plotW / rows.length;
  const barW = Math.min(24, band * 0.62);

  const readout = h('p', { class: 'chart-read' }, 'Tap a day to see its time.');
  const svg = h('svg:svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img',
    'aria-label': `Minutes practised on each of the last ${rows.length} days. ${rows.map((r) => `${r.label}: ${Math.round(r.seconds / 60)}`).join(', ')}.`,
  });
  for (let v = 0; v <= ceiling; v += step) {
    svg.append(h('svg:line', { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(h('svg:text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, v));
  }
  if (goal) {
    svg.append(h('svg:line', { x1: m.left, x2: width - m.right, y1: y(goal / 60), y2: y(goal / 60), class: 'goal-line' }));
    svg.append(h('svg:text', { x: width - m.right + 6, y: y(goal / 60) + 4, class: 'tick strong' }, 'Goal'));
  }
  rows.forEach((row, i) => {
    const x = m.left + band * i + (band - barW) / 2;
    const minutes = row.seconds / 60;
    if (minutes > 0) {
      const yTop = y(minutes), r = Math.min(4, barW / 2, m.top + plotH - yTop);
      svg.append(h('svg:path', {
        class: `col ${i === rows.length - 1 ? 'today' : ''}`,
        d: `M${x},${m.top + plotH}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + barW - r}Q${x + barW},${yTop} ${x + barW},${yTop + r}V${m.top + plotH}Z`,
      }));
    }
    if (i % 2 === (rows.length - 1) % 2) svg.append(h('svg:text', { x: x + barW / 2, y: height - 8, 'text-anchor': 'middle', class: 'tick' }, row.short));
    svg.append(h('svg:rect', {
      x: m.left + band * i, y: m.top, width: band, height: plotH, class: 'hit',
      onClick: () => { readout.textContent = `${row.label}: ${timeText(row.seconds)}`; },
    }, h('svg:title', {}, `${row.label}: ${timeText(row.seconds)}`)));
  });
  return [svg, readout];
}

function splitBar(totals) {
  const sum = MODES.reduce((s, m) => s + totals[m.id], 0);
  return [
    h('div', {
      class: 'split', role: 'img',
      'aria-label': MODES.map((m) => `${m.name}: ${timeText(totals[m.id])}`).join(', '),
    }, MODES.filter((m) => totals[m.id] > 0).map((m) => {
      const share = totals[m.id] / sum;
      return h('span', {
        style: { flexGrow: totals[m.id], background: m.colour, color: m.ink },
        title: `${m.name}: ${timeText(totals[m.id])}`,
      }, share >= 0.12 ? `${Math.round(share * 100)}%` : '');
    })),
    h('div', { class: 'legend' }, MODES.map((m) => h('span', { class: 'legend-item' },
      h('i', { style: { background: m.colour } }), `${m.name} ${timeText(totals[m.id])}`))),
  ];
}

// For grown-ups only: how a grown-up's verdicts compared with the player's own, over all their pieces.
// Shown only while its own setting in Grown-ups is on, whether or not the prompt is.
async function shadowBlock(piece) {
  if (!(await shadowStatsOn())) return null;
  await attemptsSaved();
  const theirs = (await all('attempts')).filter((a) => a.playerId === piece.playerId);
  const tally = shadowAgreement(theirs);
  const name = (await get('players', piece.playerId))?.name || 'The player';
  const plays = (n) => `${n} ${n === 1 ? 'play' : 'plays'}`;
  return h('section', { class: 'block shadow-stats' },
    h('h2', {}, 'Shadow grading'),
    tally.enough
      ? [
        h('p', {}, `You and ${name} agreed on ${tally.agreed} of ${plays(tally.graded)} (${tally.percent}%).`),
        h('ul', { class: 'shadow-split' },
          h('li', {}, `${name} said clean, you said slip: ${tally.childCleanAdultSlip}`),
          h('li', {}, `${name} said slip, you said clean: ${tally.childSlipAdultClean}`)),
      ]
      : h('p', {}, `${tally.graded} of ${SHADOW_ENOUGH} plays graded so far. Agreement shows after ${SHADOW_ENOUGH}.`),
    h('p', { class: 'field-hint' }, `Counts the plays you graded on all of ${name}’s pieces. Only grown-ups see this.`));
}

export async function stats([id], ctx, grownUp = false) {
  if (grownUp && !session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  await timeSaved();
  const docs = await timeDocs(id);
  const attempts = await byIndex('attempts', 'pieceId', id);
  const playable = playableBars(piece);
  const goal = goalSeconds(piece);

  let range = 'week';
  let order = 'bars';

  const byDay = new Map(docs.map((d) => [d.day, d]));
  const chartRows = Array.from({ length: 14 }, (_, i) => {
    const date = dayStart(13 - i);
    return {
      day: dayKey(date.getTime()),
      seconds: dayTotal(byDay.get(dayKey(date.getTime()))),
      label: date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
      short: date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
    };
  });

  const body = h('div', { class: 'stats-body' });

  function draw() {
    const chosen = RANGES.find((r) => r.id === range);
    const from = chosen.days === Infinity ? '' : dayKey(dayStart(chosen.days - 1).getTime());
    const fromTime = chosen.days === Infinity ? 0 : (() => { const d = dayStart(chosen.days - 1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    const inRange = docs.filter((d) => d.day >= from);
    const tries = attempts.filter((a) => a.at >= fromTime);

    const totals = { bar: 0, phrase: 0, piece: 0 };
    const perBar = new Map();
    for (const doc of inRange) {
      MODES.forEach((m) => { totals[m.id] += doc.modes[m.id]; });
      for (const [barId, row] of Object.entries(doc.bars)) {
        const cur = perBar.get(barId) || [0, 0, 0];
        row.forEach((v, i) => { cur[i] += v; });
        perBar.set(barId, cur);
      }
    }
    const total = totals.bar + totals.phrase + totals.piece;

    const cleanBy = new Map();
    for (const a of tries) {
      for (const barId of a.barIds) {
        const c = cleanBy.get(barId) || { clean: 0, tries: 0 };
        c.tries += 1;
        const missed = a.slipBars ? a.slipBars.includes(barId) : a.result === 'slip';
        if (!missed) c.clean += 1;
        cleanBy.set(barId, c);
      }
    }
    const cleanTries = tries.filter((a) => a.result === 'clean').length;
    const plays = tries.filter((a) => a.mode === 'piece').length;

    const rows = playable.map((b) => {
      const parts = perBar.get(b.id) || [0, 0, 0];
      return { bar: b, parts, seconds: parts[0] + parts[1] + parts[2], ...(cleanBy.get(b.id) || { clean: 0, tries: 0 }) };
    });
    const most = Math.max(1, ...rows.map((r) => r.seconds));
    const sorted = order === 'time' ? rows.slice().sort((a, b) => b.seconds - a.seconds) : rows;

    const untouched = rows.filter((r) => !r.seconds).map((r) => r.bar.n);
    const stuck = rows.filter((r) => r.parts[0] + r.parts[1] >= 60 && r.tries >= 4 && r.clean / r.tries < 0.5).map((r) => r.bar.n);

    const seg = (label, active, onClick) => h('button', { class: `seg ${active ? 'on' : ''}`, 'aria-pressed': String(active), onClick }, label);

    fill(body,
      h('div', { class: 'mode-row', role: 'group', 'aria-label': 'Time range' },
        RANGES.map((r) => seg(r.label, r.id === range, () => { range = r.id; draw(); }))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Time practised'), h('span', { class: 'tile-value' }, timeText(total))),
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Clean tries'), h('span', { class: 'tile-value' }, tries.length ? `${Math.round((cleanTries / tries.length) * 100)}%` : 'None yet')),
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Whole-piece plays'), h('span', { class: 'tile-value' }, plays))),
      total ? splitBar(totals) : h('p', { class: 'insight quiet' }, 'No practice in this period yet.'),
      stuck.length ? h('p', { class: 'insight' }, `Lots of time but few clean tries on ${stuck.length === 1 ? 'bar' : 'bars'} ${numberRanges(stuck)}. Try a slower speed or a smaller chunk.`) : null,
      untouched.length && untouched.length < playable.length ? h('p', { class: 'insight quiet' }, `Not practised in this period: ${untouched.length === 1 ? 'bar' : 'bars'} ${numberRanges(untouched)}.`) : null,

      h('section', { class: 'block' },
        h('h2', {}, 'Time on each bar'),
        h('p', { class: 'field-hint' }, 'Phrase and whole-piece time is shared evenly across the bars played, so these add up to the total.'),
        h('div', { class: 'mode-row', role: 'group', 'aria-label': 'Sort bars' },
          seg('In bar order', order === 'bars', () => { order = 'bars'; draw(); }),
          seg('Most time first', order === 'time', () => { order = 'time'; draw(); })),
        h('table', { class: 'bar-table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Bar'), h('th', { scope: 'col', class: 'wide-col' }, 'Time'), h('th', { scope: 'col', class: 'num-col' }, 'Min:sec'), h('th', { scope: 'col', class: 'num-col' }, 'Clean'))),
          h('tbody', {}, sorted.map((r) => h('tr', {},
            h('th', { scope: 'row' }, r.bar.n),
            h('td', { class: 'wide-col' }, h('div', {
              class: 'thin', style: { width: `${(r.seconds / most) * 100}%` }, 'aria-hidden': 'true',
            }, MODES.map((m, i) => (r.parts[i] > 0 ? h('i', { style: { flexGrow: r.parts[i], background: m.colour } }) : null)))),
            h('td', { class: 'num-col' }, r.seconds ? clockText(r.seconds) : '–'),
            h('td', { class: 'num-col' }, r.tries ? `${r.clean} of ${r.tries}` : '–')))))));
  }

  ctx.onShow(draw);
  const tabs = grownUp ? await learnerTabs(piece, (other) => `/parent/stats/${other}`) : null;

  return h('main', { class: 'screen stats' },
    h('header', { class: 'bar-top' },
      grownUp ? backTo('Piece settings', `/parent/piece/${id}`) : backTo('My piece', `/piece/${id}`),
      h('h1', {}, piece.title),
      grownUp ? doneButton() : null),
    tabs,
    h('section', { class: 'block flat' },
      h('h2', {}, 'Minutes a day, last 14 days'),
      dailyChart(chartRows, goal)),
    body,
    grownUp ? await shadowBlock(piece) : null);
}
