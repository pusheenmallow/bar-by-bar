import { h, go, icon } from '../ui.js';
import { get, byIndex, progressMap, secondsOn } from '../store.js';
import { penVar, playableBars, topStage, checkGroups, dayKey, goalSeconds, timeText } from '../model.js';
import { missing } from './common.js';

function strip(piece, bars, progress) {
  return h('div', { class: 'strip', 'aria-hidden': 'true' }, bars.map((b) => {
    const top = topStage(piece, progress.get(b.id));
    return h('i', { style: top ? { background: penVar(top.pen) } : {} });
  }));
}

export async function player([id]) {
  const person = await get('players', id);
  if (!person) return missing('That player has gone.');
  const pieces = (await byIndex('pieces', 'playerId', id)).filter((p) => !p.draft);
  pieces.sort((a, b) => a.createdAt - b.createdAt);

  const rows = [];
  for (const piece of pieces) {
    const progress = await progressMap(piece.id);
    const bars = playableBars(piece);
    const started = bars.filter((b) => topStage(piece, progress.get(b.id))).length;
    const checks = checkGroups(piece, progress).flat().length;
    const today = await secondsOn(piece.id, dayKey(Date.now()));
    const goal = goalSeconds(piece);
    rows.push(h('button', { class: 'piece-row', onClick: () => go(`/piece/${piece.id}`) },
      h('span', { class: 'piece-title' }, piece.title),
      strip(piece, bars, progress),
      h('span', { class: 'piece-sub' },
        checks ? `${checks} ${checks === 1 ? 'bar is' : 'bars are'} ready for a next-day check`
          : `${started} of ${bars.length} bars started`),
      h('span', { class: 'piece-sub' }, goal ? `${timeText(today)} of ${timeText(goal)} today` : `${timeText(today)} today`)));
  }

  return h('main', { class: 'screen player', vars: { pen: penVar(person.pen) } },
    h('header', { class: 'bar-top' },
      h('button', { class: 'round', 'aria-label': 'Back', onClick: () => go('/') }, icon('back')),
      h('h1', { class: 'name-title' }, h('span', {}, person.name))),
    rows.length ? h('div', { class: 'piece-list' }, rows)
      : h('p', { class: 'lead empty' }, 'No pieces yet. Ask a grown-up to add one.'));
}
