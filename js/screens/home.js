import { h, go } from '../ui.js';
import { all } from '../store.js';
import { PENS } from '../model.js';

function welcome() {
  return h('main', { class: 'screen welcome' },
    h('div', { class: 'title-stack' },
      h('div', { class: 'stripes', 'aria-hidden': 'true' }, ['sky', 'grape', 'gum', 'lemon', 'lime', 'gold'].map((p) => h('i', { style: { background: PENS[p] } }))),
      h('h1', {}, 'Bar by Bar')),
    h('p', { class: 'lead' }, 'Colour in your piece, one bar at a time.'),
    h('button', { class: 'btn primary big', onClick: () => go('/parent') }, 'Set up'));
}

export async function home() {
  const players = await all('players');
  if (!players.length) return welcome();
  players.sort((a, b) => a.createdAt - b.createdAt);
  return h('main', { class: 'screen home' },
    h('h1', {}, 'Who’s practising?'),
    h('div', { class: 'names' }, players.map((p) => h('button', {
      class: 'name',
      vars: { pen: PENS[p.pen] },
      onClick: () => go(`/player/${p.id}`),
    }, h('span', {}, p.name)))),
    h('button', { class: 'quiet-link corner', onClick: () => go('/parent') }, 'Grown-ups'));
}
