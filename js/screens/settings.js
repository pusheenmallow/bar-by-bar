import { h, go, goUp, icon, confirmSheet } from '../ui.js';
import { get, put, all, byIndex, deletePiece } from '../store.js';
import { KEYS, MASTERY_RUN, goodRun, penVar, listBars, mistakeList, newId, nextPen } from '../model.js';
import { session } from '../session.js';
import { field, stepper, missing, backTo, doneButton } from './common.js';
import { gate } from './parent.js';
import { goalText } from './add.js';

function patterns(piece, attempts) {
  const bars = listBars(piece);
  const number = (id) => bars.find((b) => b.id === id)?.n;
  const labels = new Map(mistakeList(piece).map((m) => [m.id, m.label]));
  ['hands', 'dynamics', 'melody'].forEach((t) => {
    if (!labels.has(t)) labels.set(t, { hands: 'Hands not together', dynamics: 'Too loud or soft', melody: 'Melody got lost' }[t]);
  });
  const clean = attempts.filter((a) => a.result === 'clean').length;
  const slips = attempts.filter((a) => a.result === 'slip');
  const groups = new Map();
  for (const a of slips) {
    if (!a.tag) continue;
    const g = groups.get(a.tag) || { n: 0, bars: new Set() };
    g.n += 1;
    a.barIds.forEach((id) => g.bars.add(number(id)));
    groups.set(a.tag, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  const tries = clean + slips.length;
  return [
    tries ? h('p', {}, `${clean} of ${tries} tries were clean (${Math.round((clean / tries) * 100)}%).`) : h('p', {}, 'No practice recorded yet.'),
    sorted.map(([tag, g]) => {
      const list = [...g.bars].filter(Boolean).sort((a, b) => a - b);
      return h('div', { class: 'pattern' },
        h('span', { class: 'row-main' }, labels.get(tag) || tag),
        h('span', { class: 'row-sub' }, `${g.n} ${g.n === 1 ? 'time' : 'times'}, ${list.length === 1 ? 'bar' : 'bars'} ${list.join(', ')}`));
    }),
  ];
}

export async function settings([id], ctx) {
  if (!session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const players = (await all('players')).sort((a, b) => a.createdAt - b.createdAt);
  const attempts = await byIndex('attempts', 'pieceId', id);
  const save = () => put('pieces', piece);

  const stageList = h('div', { class: 'stage-edit' });

  function drawStages() {
    stageList.replaceChildren(...piece.stages.map((s, i) => {
      const locked = s.pace === 'nextday';
      return h('div', { class: 'stage-line' },
        h('span', { class: 'swatch', style: { background: penVar(s.pen) } }),
        h('input', {
          type: 'text', value: s.name, 'aria-label': `Stage ${i + 1} name`,
          onChange: (e) => { s.name = e.target.value.trim() || s.name; e.target.value = s.name; save(); },
        }),
        h('button', { class: 'round small', 'aria-label': `Move ${s.name} up`, disabled: i === 0, onClick: () => move(i, -1) }, icon('up', 20)),
        h('button', { class: 'round small', 'aria-label': `Move ${s.name} down`, disabled: i === piece.stages.length - 1, onClick: () => move(i, 1) }, icon('down', 20)),
        h('button', {
          class: 'round small', 'aria-label': `Remove ${s.name}`,
          onClick: async () => {
            const yes = await confirmSheet({ title: `Remove “${s.name}”?`, body: 'Bars keep their other stages.', yes: 'Remove stage', danger: true });
            if (!yes) return;
            piece.stages.splice(piece.stages.indexOf(s), 1);
            await save();
            drawStages();
          },
        }, icon('bin', 20)));
    }));
  }

  function move(i, dir) {
    const [s] = piece.stages.splice(i, 1);
    piece.stages.splice(i + dir, 0, s);
    save();
    drawStages();
  }

  function addStage() {
    const before = piece.stages.findIndex((s) => s.pace === 'nextday');
    const stage = { id: newId(), name: 'New stage', hint: 'Play it the way you and your teacher agreed.', pace: 'free', dynamics: false, pen: nextPen(piece.stages) };
    piece.stages.splice(before < 0 ? piece.stages.length : before, 0, stage);
    save();
    drawStages();
  }

  ctx.onShow(drawStages);

  return h('main', { class: 'screen form' },
    h('header', { class: 'bar-top' },
      backTo('Grown-ups', '/parent'),
      h('h1', {}, piece.title),
      doneButton()),

    h('div', { class: 'row-buttons left' },
      h('button', { class: 'btn primary', onClick: () => go(`/parent/bars/${id}`) }, 'Add notes and mark bars'),
      h('button', { class: 'btn', onClick: () => go(`/parent/stats/${id}`) }, 'Stats'),
      h('button', { class: 'btn', onClick: () => go(`/parent/review/${id}`) }, 'Check the boxes')),

    h('section', { class: 'block' },
      h('h2', {}, 'Mistake patterns'),
      patterns(piece, attempts)),

    h('section', { class: 'block' },
      h('h2', {}, 'Details'),
      field('Name of the piece', h('input', { type: 'text', value: piece.title, onChange: (e) => { piece.title = e.target.value.trim() || piece.title; save(); } })),
      field('Who is learning it', h('select', { onChange: (e) => { piece.playerId = e.target.value; save(); } },
        players.map((p) => h('option', { value: p.id, selected: p.id === piece.playerId }, p.name)))),
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Full speed'),
          stepper({ label: 'Full speed in beats a minute', value: piece.tempo, min: 30, max: 240, step: 2, format: (v) => `♩ = ${v}`, onChange: (v) => { piece.tempo = v; save(); } })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Beats in a bar'),
          stepper({ label: 'Beats in a bar', value: piece.beats, min: 1, max: 12, onChange: (v) => { piece.beats = v; save(); } }))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Practice goal'),
        stepper({ label: 'Practice goal in minutes a day', value: piece.dailyGoal ?? 10, min: 0, max: 60, step: 5, format: goalText, onChange: (v) => { piece.dailyGoal = v; save(); } })),
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Clean in a row'),
          stepper({ label: 'Clean in a row', value: goodRun(piece), min: 2, max: MASTERY_RUN - 1, onChange: (v) => { piece.cleanTarget = v; save(); } }),
          h('span', { class: 'field-hint' }, `This colours a bar in. ${MASTERY_RUN} in a row wins a crown.`)),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Slow speed'),
          stepper({ label: 'Slow speed as a share of full speed', value: piece.slowPercent, min: 40, max: 90, step: 5, format: (v) => `${v}%`, onChange: (v) => { piece.slowPercent = v; save(); } }))),
      field('Key signature', h('select', { onChange: (e) => { piece.keySig = e.target.value; save(); } },
        KEYS.map((k) => h('option', { value: k.id, selected: k.id === piece.keySig }, k.label))))),

    h('section', { class: 'block' },
      h('h2', {}, 'Stages'),
      h('p', { class: 'field-hint' }, 'Rename, reorder or remove stages to suit this piece.'),
      stageList,
      h('button', { class: 'btn', onClick: addStage }, 'Add a stage')),

    h('section', { class: 'block' },
      h('h2', {}, 'Remove this piece'),
      h('button', {
        class: 'btn danger',
        onClick: async () => {
          const yes = await confirmSheet({ title: `Delete “${piece.title}”?`, body: 'Its pages and all progress will be removed from this tablet.', yes: 'Delete piece', danger: true });
          if (!yes) return;
          await deletePiece(id);
          if (session.exitTo.includes(id)) session.exitTo = '/';
          goUp('/parent');
        },
      }, 'Delete piece')));
}
