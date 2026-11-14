import { h, go, goUp, swapTo, fill, icon, confirmSheet, toast } from '../ui.js';
import { get, all, byIndex, deletePiece, savePiece, learnersOf, addLearner, removeLearner } from '../store.js';
import { KEYS, MASTERY_RUN, goodRun, penVar, listBars, mistakeList, newId, nextPen, clockText, nameList } from '../model.js';
import { placedCount } from '../marks.js';
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
  const learners = await learnersOf(piece);
  const attempts = (await Promise.all(learners.map((l) => byIndex('attempts', 'pieceId', l.id)))).flat();     // everyone's tries
  const save = () => savePiece(piece);                // settings are shared by everyone learning the piece
  const nameOf = (playerId) => players.find((p) => p.id === playerId)?.name || 'Someone';

  // Who is learning it. Each person gets their own progress on the same music.
  const whoBox = h('div', { class: 'learners', role: 'group', 'aria-label': 'Who is learning it' });
  function drawWho() {
    fill(whoBox, players.map((p) => h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: learners.some((l) => l.playerId === p.id), onChange: (e) => toggleLearner(p, e.target) }),
      h('span', {}, p.name))));
  }
  async function toggleLearner(player, input) {
    const mine = learners.find((l) => l.playerId === player.id);
    if (input.checked) {
      if (mine) return;
      learners.push(await addLearner(piece, player.id));
      toast(`${player.name} can practise “${piece.title}” now.`);
    } else {
      if (!mine) return;
      if (learners.length === 1) {
        input.checked = true;
        toast('Someone needs to be learning it. To remove the piece, use Delete piece below.');
        return;
      }
      const yes = await confirmSheet({
        title: `Take ${player.name} off this piece?`,
        body: `${player.name}’s progress, notes and practice time on it will be deleted. Everyone else keeps theirs.`,
        yes: `Take ${player.name} off`,
        danger: true,
      });
      if (!yes) { input.checked = true; return; }
      await removeLearner(mine.id);
      learners.splice(learners.indexOf(mine), 1);
      if (session.exitTo.includes(mine.id)) session.exitTo = '/';
      if (mine.id === id) { swapTo(`/parent/piece/${learners[0].id}`); return; }
    }
    drawWho();
  }
  drawWho();

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
      h('h2', {}, 'Who is learning it'),
      whoBox,
      h('p', { class: 'field-hint' }, 'Each person keeps their own progress, notes and practice time. The pages, bars, recording and settings are shared.')),

    h('section', { class: 'block' },
      h('h2', {}, 'Teacher’s recording'),
      piece.recording
        ? h('p', {}, `${clockText(piece.recording.duration)} long. ${placedCount(piece.recording.marks)} of ${piece.recording.marks.lines.length} bars placed.`)
        : h('p', { class: 'field-hint' }, 'Record the teacher playing the piece, so players can hear any bar at their practice speed.'),
      h('button', { class: 'btn', onClick: () => go(`/parent/recording/${id}`) }, icon(piece.recording ? 'sound' : 'mic', 20), piece.recording ? 'Mark the bars' : 'Add a recording')),

    h('section', { class: 'block' },
      h('h2', {}, 'Mistake patterns'),
      learners.length > 1 && h('p', { class: 'field-hint' }, 'Everyone’s tries together. Stats shows each person’s.'),
      patterns(piece, attempts)),

    h('section', { class: 'block' },
      h('h2', {}, 'Details'),
      field('Name of the piece', h('input', { type: 'text', value: piece.title, onChange: (e) => { piece.title = e.target.value.trim() || piece.title; save(); } })),
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
          h('span', { class: 'field-hint' }, `This colours a bar in. ${MASTERY_RUN} in a row makes it solid.`)),
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
          const body = learners.length > 1
            ? `Its pages, recording and everyone’s progress on it (${nameList(learners.map((l) => nameOf(l.playerId)))}) will be removed from this tablet.`
            : 'Its pages and all progress will be removed from this tablet.';
          const yes = await confirmSheet({ title: `Delete “${piece.title}”?`, body, yes: 'Delete piece', danger: true });
          if (!yes) return;
          await deletePiece(id);
          if (learners.some((l) => session.exitTo.includes(l.id))) session.exitTo = '/';
          goUp('/parent');
        },
      }, 'Delete piece')));
}
