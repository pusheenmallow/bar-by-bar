// This week's assignment, typed in by a grown-up from the teacher's notebook: which bars to
// learn, which to see every day, how far to take them, and when the lesson is. It sets what is
// new and what is pinned. The schedule still decides the pace and the checks.
import { h, goUp, toast } from '../ui.js';
import { get, currentAssignment, saveAssignment } from '../store.js';
import {
  blankAssignment, parseBarNumbers, playableBars, practiceStages, numberRanges, dayKey, assignmentEnvelope, readAssignmentEnvelope,
} from '../model.js';
import { session } from '../session.js';
import { field, stepper, missing, backTo, doneButton, learnerTabs, areaHome } from './common.js';
import { gate } from './parent.js';

// `area` is 'parent' from Grown-ups, or 'teacher' from the Teacher screens.
export async function assign([id], ctx, area = 'parent') {
  if (area === 'parent' ? !session.parent : !session.teacher) return gate(() => ctx.rerender());
  const home = areaHome(area, id);
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const person = await get('players', piece.playerId);
  const existing = await currentAssignment(id);
  const a = existing ? { ...existing } : blankAssignment(piece);
  // An assignment loaded from a file fills the form. It isn't saved until Save is tapped.
  const loaded = session.loadedAssignment?.pieceId === id ? session.loadedAssignment : null;
  session.loadedAssignment = null;
  if (loaded) Object.assign(a, loaded.fields);
  const stages = practiceStages(piece);
  const numbers = playableBars(piece).map((b) => b.n);
  const tabs = await learnerTabs(piece, (other) => `/${area}/assign/${other}`);

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
    goUp(home.path);
  }

  async function clear() {
    if (existing) await saveAssignment({ ...existing, status: 'done', updatedAt: Date.now() });
    toast('Assignment cleared.');
    goUp(home.path);
  }

  // As a file, to hand to another tablet. It holds bar numbers and settings, and no names.
  function toFile() {
    const blob = new Blob([JSON.stringify(assignmentEnvelope(piece, a), null, 2)], { type: 'application/json' });
    const link = h('a', { href: URL.createObjectURL(blob), download: `bar-by-bar-assignment-${dayKey(Date.now())}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    toast('Assignment saved to Downloads.');
  }

  async function fromFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('That file is not a Bar by Bar assignment.'); }
      session.loadedAssignment = { pieceId: id, ...readAssignmentEnvelope(data, piece) };
      ctx.rerender();
    } catch (err) {
      toast(err.message);
    }
  }
  const picker = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Assignment file', onChange: fromFile });

  return h('main', { class: 'screen form' },
    h('header', { class: 'bar-top' },
      backTo(home.back, home.path),
      h('h1', {}, 'This week’s assignment'),
      doneButton()),
    tabs,
    h('p', { class: 'lead' }, `${piece.title}${person ? `, for ${person.name}` : ''}`),
    loaded && h('div', { class: 'banner loaded', role: 'status' },
      h('span', {}, ['Loaded from the file. Check it, then tap Save assignment.', ...loaded.warnings].join(' '))),

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
      existing && h('button', { class: 'btn', onClick: clear }, 'Clear assignment')),

    h('section', { class: 'block' },
      h('h2', {}, 'Pass it on'),
      h('p', { class: 'field-hint' }, 'Save what is in this form as a small file, or load one a teacher sent. The file holds bar numbers and settings only: no names, no music and no progress.'),
      h('div', { class: 'row-buttons left' },
        h('button', { class: 'btn', onClick: toFile }, 'Save as a file'),
        h('button', { class: 'btn', onClick: () => picker.click() }, 'Load from a file'),
        picker)));
}
