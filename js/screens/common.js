import { h, go, goUp, swapTo, icon } from '../ui.js';
import { session } from '../session.js';
import { SPEEDS, SPEED_STEP, speedTempo, speedPercent } from '../model.js';
import { all, learnersOf } from '../store.js';

// Where a practice screen goes when it is finished, and what it calls that: the score, or, during
// Today's practice, back to the queue for the next stop.
export function sessionHome(pieceId) {
  const t = session.today;
  return t && t.pieceId === pieceId
    ? { inSession: true, path: t.path, back: 'Today', done: 'Next stop' }
    : { inSession: false, path: `/piece/${pieceId}`, back: 'My piece', done: 'Back to my piece' };
}

// Where the staff screens (assignment, summary, recordings) go back to. Grown-ups come from a
// piece's settings; the teacher, who has no settings, from the Teacher screen.
export const areaHome = (area, pieceId) => (area === 'teacher'
  ? { back: 'Teacher', path: '/teacher' }
  : { back: 'Piece settings', path: `/parent/piece/${pieceId}` });

export const missing = (text) => h('main', { class: 'screen' },
  h('p', { class: 'lead' }, text),
  h('button', { class: 'btn', onClick: () => go('/') }, 'Back to the start'));

// Back says where it goes, so nobody has to guess.
export const backTo = (label, path) => h('button', { class: 'back', onClick: () => goUp(path) }, icon('back', 22), h('span', {}, label));

export function leaveGrownUps() {
  session.parent = false;
  session.teacher = false;
  goUp(session.exitTo);
}

// On a piece several people learn, grown-ups look at one learner's progress at a time.
export async function learnerTabs(piece, pathFor) {
  const learners = await learnersOf(piece);
  if (learners.length < 2) return null;
  const players = await all('players');
  const nameOf = (playerId) => players.find((p) => p.id === playerId)?.name || 'Someone';
  return h('div', { class: 'learner-tabs', role: 'group', 'aria-label': 'Whose progress to show' },
    h('span', { class: 'learner-label' }, 'Showing'),
    learners.map((l) => h('button', {
      class: `seg ${l.id === piece.id ? 'on' : ''}`,
      'aria-pressed': String(l.id === piece.id),
      onClick: () => { if (l.id !== piece.id) swapTo(pathFor(l.id)); },
    }, nameOf(l.playerId))));
}

export const doneButton = () => h('button', { class: 'btn lock', onClick: leaveGrownUps }, 'Done');
export const grownUpsButton = (path) => h('button', { class: 'round quiet', 'aria-label': 'Grown-ups', onClick: () => go(path) }, icon('lock', 20));

export function stepper({ label, value, min, max, step = 1, onChange, format = (v) => v, compact = false }) {
  const show = h('output', { class: 'step-value' }, format(value));
  let current = value;
  const set = (v) => {
    current = Math.min(max, Math.max(min, v));
    show.textContent = format(current);
    onChange(current);
  };
  return h('div', { class: `stepper ${compact ? 'compact' : ''}`, role: 'group', 'aria-label': label },
    h('button', { class: 'round', type: 'button', 'aria-label': `Less: ${label}`, onClick: () => set(current - step) }, '−'),
    show,
    h('button', { class: 'round', type: 'button', 'aria-label': `More: ${label}`, onClick: () => set(current + step) }, '+'));
}

// Half, three-quarter and full speed in one tap, with a slider for the steps between.
export function speedControl(piece, onPick) {
  const low = SPEEDS[0].percent, high = SPEEDS.at(-1).percent;
  const range = h('input', {
    type: 'range', class: 'speed-range', min: low, max: high, step: 1, 'aria-label': 'Speed',
    onInput: (e) => onPick(speedTempo(piece, Math.round(e.target.value / SPEED_STEP) * SPEED_STEP)),
  });
  const stops = SPEEDS.map((s) => {
    const tempo = speedTempo(piece, s.percent);
    return h('button', { class: 'seg speed-stop', 'aria-label': `${s.label} speed, ${tempo}`, onClick: () => onPick(tempo) },
      s.label, h('span', { class: 'speed-bpm' }, tempo));
  });
  function show(tempo) {
    range.value = speedPercent(piece, tempo);
    range.style.setProperty('--fill', `${((range.value - low) / (high - low)) * 100}%`);
    range.setAttribute('aria-valuetext', `${tempo} beats a minute`);
    stops.forEach((stop, i) => {
      const on = tempo === speedTempo(piece, SPEEDS[i].percent);
      stop.classList.toggle('on', on);
      stop.setAttribute('aria-pressed', String(on));
    });
  }
  return { el: h('div', { class: 'speed' }, range, h('div', { class: 'speed-stops' }, stops)), show };
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

export function busyPanel(text) {
  return h('div', { class: 'busy', role: 'status' }, h('div', { class: 'busy-stroke', 'aria-hidden': 'true' }), h('p', {}, text));
}
