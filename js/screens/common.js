import { h, go } from '../ui.js';
import { SPEEDS, SPEED_STEP, speedTempo, speedPercent } from '../model.js';

export const missing = (text) => h('main', { class: 'screen' },
  h('p', { class: 'lead' }, text),
  h('button', { class: 'btn', onClick: () => go('/') }, 'Back to the start'));

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
