// This week's assignment, typed in by a grown-up from the teacher's notebook: which bars to
// learn, which to see every day, how far to take them, and when the lesson is. It sets what is
// new and what is pinned. The schedule still decides the pace and the checks.
import { h, goUp, toast } from '../ui.js';
import { get, currentAssignment, saveAssignment } from '../store.js';
import { blankAssignment, parseBarNumbers, playableBars, practiceStages, numberRanges, dayKey } from '../model.js';
import { session } from '../session.js';
import { field, stepper, missing, backTo, doneButton, learnerTabs } from './common.js';
import { gate } from './parent.js';

export async function assign([id], ctx) {
  if (!session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const person = await get('players', piece.playerId);
  const existing = await currentAssignment(id);
  const a = existing ? { ...existing } : blankAssignment(piece);
  const stages = practiceStages(piece);
  const numbers = playableBars(piece).map((b) => b.n);
  const tabs = await learnerTabs(piece, (other) => `/parent/assign/${other}`);

  // Says back what was understood, so a typing slip shows before it is saved.
  const understood = (text, empty) => {
    const wanted = parseBarNumbers(text);
    const found = wanted.filter((n) => numbers.includes(n));
    const lost = wanted.filter((n) => !numbers.includes(n));
    if (!wanted.length) return empty;
    return `${found.length ? `${found.length === 1 ? 'Bar' : 'Bars'} ${numberRanges(found)}.` : 'None of those bars are in this piece.'}${lost.length ? ` Not in this piece: ${numberRanges(lost)}.` : ''}`;
  };
  const barsHint = h('span', { class: 'field-hint' });
  const pinsHint = h('span', { class: 'field-hint' });
  const showHints = () => {
    barsHint.textContent = understood(a.bars, 'Left empty, new bars come in the order of the music.');
    pinsHint.textContent = understood(a.pins, 'Left empty, nothing is pinned.');
  };
  showHints();

  async function save() {
    a.updatedAt = Date.now();
    await saveAssignment(a);
    toast('Assignment saved.');
    goUp(`/parent/piece/${id}`);
  }

  async function clear() {
    if (existing) await saveAssignment({ ...existing, status: 'done', updatedAt: Date.now() });
    toast('Assignment cleared.');
    goUp(`/parent/piece/${id}`);
  }

  return h('main', { class: 'screen form' },
    h('header', { class: 'bar-top' },
      backTo('Piece settings', `/parent/piece/${id}`),
      h('h1', {}, 'This week’s assignment'),
      doneButton()),
    tabs,
    h('p', { class: 'lead' }, `${piece.title}${person ? `, for ${person.name}` : ''}`),

    h('section', { class: 'block' },
      h('h2', {}, 'What to practise'),
      field('New bars this week', h('input', {
        type: 'text', value: a.bars, autocomplete: 'off', inputmode: 'text', placeholder: '9-16, 21',
        'aria-label': 'New bars this week',
        onInput: (e) => { a.bars = e.target.value; showHints(); },
      })),
      barsHint,
      field('Bars to see every day', h('input', {
        type: 'text', value: a.pins, autocomplete: 'off', placeholder: '12',
        'aria-label': 'Bars to see every day',
        onInput: (e) => { a.pins = e.target.value; a.pinsDone = []; showHints(); },
      })),
      pinsHint,
      h('p', { class: 'field-hint' }, 'A pinned bar comes up in every session until it is played clean in a check, or until the lesson, whichever is first.')),

    h('section', { class: 'block' },
      h('h2', {}, 'How far'),
      h('div', { class: 'two' },
        field('Take new bars as far as', h('select', { 'aria-label': 'Take new bars as far as', onChange: (e) => { a.stageId = e.target.value; } },
          stages.map((s) => h('option', { value: s.id, selected: s.id === a.stageId }, s.name)))),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Speed to aim for'),
          stepper({ label: 'Speed to aim for', value: a.tempo, min: 30, max: 240, step: 2, format: (v) => `♩ = ${v}`, onChange: (v) => { a.tempo = v; } })))),

    h('section', { class: 'block' },
      h('h2', {}, 'When'),
      h('div', { class: 'two' },
        field('Next lesson', h('input', {
          type: 'date', class: 'date', value: a.lessonDate || '', min: dayKey(Date.now()), 'aria-label': 'Next lesson',
          onChange: (e) => { a.lessonDate = e.target.value; },
        }), 'With a date, every learned bar is checked at least twice before it.'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Time for a session'),
          stepper({ label: 'Time for a session', value: a.minutes, min: 5, max: 60, step: 5, format: (v) => `${v} min`, onChange: (v) => { a.minutes = v; } }),
          h('span', { class: 'field-hint' }, 'When time runs short, new bars are dropped first. Checks and the play-through stay.')))),

    h('section', { class: 'block' },
      h('h2', {}, 'A note for the player'),
      h('textarea', {
        rows: 2, maxlength: 160, 'aria-label': 'A note for the player', placeholder: 'What did the teacher ask for?',
        onInput: (e) => { a.note = e.target.value; },
      }, a.note || '')),

    h('div', { class: 'row-buttons left' },
      h('button', { class: 'btn primary', onClick: save }, 'Save assignment'),
      existing && h('button', { class: 'btn', onClick: clear }, 'Clear assignment')));
}
