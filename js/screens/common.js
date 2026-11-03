import { h, go } from '../ui.js';

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

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

export function busyPanel(text) {
  return h('div', { class: 'busy', role: 'status' }, h('div', { class: 'busy-stroke', 'aria-hidden': 'true' }), h('p', {}, text));
}
