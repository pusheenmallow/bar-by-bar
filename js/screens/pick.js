import { h, go, icon, closeSheet } from '../ui.js';
import {
  penVar, practiceStages, checkStage, checkStatus, nextForBars, goodRun, MASTERY_RUN, allSolid, barsLabel,
} from '../model.js';
import { session } from '../session.js';

const QUESTION = 'What are you working on?';

// The choice before a practice: which stage, and how many clean in a row.
// Finished stages stay on the list, so a bar can be practised again at any time.
export function practicePicker({ piece, bars, progress, stageId = null, back = null }) {
  const stages = practiceStages(piece);
  const good = goodRun(piece);
  const asked = stages.find((s) => s.id === stageId);
  let chosen = (asked || nextForBars(piece, bars, progress) || stages.at(-1))?.id;
  let goal = session.runGoal === MASTERY_RUN ? MASTERY_RUN : good;

  const doneCount = (s) => bars.filter((b) => progress.get(b.id)?.done[s.id]).length;

  function status(s) {
    const n = doneCount(s);
    return h('span', { class: 'stage-status' },
      allSolid(bars, progress, s) ? 'Solid' : n === bars.length ? 'Done' : n ? `${n} of ${bars.length} bars` : '');
  }

  const stagesEl = h('div', { class: 'stages pick-list', role: 'group', 'aria-label': QUESTION });
  const goalEl = h('div', { class: 'goal-pick', role: 'group', 'aria-label': 'How many in a row?' });
  const sayEl = h('p', { class: 'pick-say' });

  function checkRow() {
    const s = checkStage(piece);
    if (!s) return null;
    const bar = bars[0];
    const prog = progress.get(bar.id);
    const done = doneCount(s) === bars.length;
    const text = done ? 'Done' : checkStatus(piece, bar, prog);
    const ready = !done && text === 'Ready now';
    return h(ready ? 'button' : 'div', {
      class: `stage-row ${ready ? '' : 'resting'}`,
      onClick: ready ? () => { closeSheet(); go(`/check/${piece.id}`); } : null,
    },
    h('span', { class: 'swatch', style: { background: penVar(s.pen) } }),
    h('span', { class: 'stage-name' }, s.name),
    h('span', { class: 'stage-status' }, text));
  }

  function draw() {
    stagesEl.replaceChildren(...stages.map((s) => h('button', {
      class: `stage-row ${chosen === s.id ? 'chosen' : ''}`,
      'aria-pressed': String(chosen === s.id),
      onClick: () => { chosen = s.id; draw(); },
    },
    h('span', { class: 'swatch', style: { background: penVar(s.pen) } }),
    h('span', { class: 'stage-name' }, s.name),
    status(s))));
    const row = checkRow();
    if (row) stagesEl.append(row);

    const option = (n, name) => h('button', {
      class: `goal-option ${goal === n ? 'chosen' : ''}`,
      'aria-pressed': String(goal === n),
      onClick: () => { goal = n; session.runGoal = n; draw(); },
    },
    h('span', { class: 'goal-number' }, n),
    h('span', { class: 'goal-name' }, name));
    goalEl.replaceChildren(option(good, 'Good'), option(MASTERY_RUN, 'Solid'));
    sayEl.textContent = goal === MASTERY_RUN
      ? `${MASTERY_RUN} clean in a row makes it solid.`
      : `${good} clean in a row colours it in.`;
  }
  draw();

  return [
    h('header', { class: 'sheet-head' },
      back ? h('button', { class: 'round', 'aria-label': 'Back', onClick: back }, icon('back')) : null,
      h('div', { class: 'pick-title' }, h('h2', {}, QUESTION), h('p', {}, barsLabel(bars))),
      h('button', { class: 'round', 'aria-label': 'Close', onClick: () => closeSheet() }, icon('close'))),
    stagesEl,
    h('p', { class: 'pick-label' }, 'How many in a row?'),
    goalEl,
    sayEl,
    h('button', {
      class: 'btn primary big wide',
      disabled: !chosen,
      onClick: () => {
        closeSheet();
        go(`/train/${piece.id}/${bars.map((b) => b.id).join(',')}/${chosen}/${goal}`);
      },
    }, 'Start'),
  ];
}
