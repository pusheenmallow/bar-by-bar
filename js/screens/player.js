import { h, go } from '../ui.js';
import { get, byIndex, progressMap, scheduleMap, playerDays } from '../store.js';
import { penVar, playableBars, topStage, checkGroups, weekSummary, weekTarget, quickPath } from '../model.js';
import { session } from '../session.js';
import { missing, backTo, grownUpsButton } from './common.js';

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

  session.quick = null;                       // back at the pieces, so any Quick practice is over
  // This week as dots that fill. No numbers, no streak, and a missed day leaves no mark.
  const week = weekSummary(await playerDays(id), weekTarget(person));
  const dots = h('div', {
    class: `week ${week.met ? 'met' : ''}`, role: 'img',
    'aria-label': `Practice days this week: ${week.practised} ${week.practised === 1 ? 'dot' : 'dots'} filled`,
  }, week.dots.map((on) => h('i', { class: on ? 'on' : '' })));

  const rows = [];
  let latest = null;                          // the piece practised most recently, for Quick practice
  for (const piece of pieces) {
    const progress = await progressMap(piece.id);
    const bars = playableBars(piece);
    const started = bars.filter((b) => topStage(piece, progress.get(b.id))).length;
    const schedule = await scheduleMap(piece.id);
    const checks = checkGroups(piece, progress, Date.now(), 4, schedule).flat().length;
    const last = Math.max(0, ...[...progress.values()].map((p) => p.lastPractised || 0));
    if (bars.length && (!latest || last > latest.last)) latest = { piece, progress, schedule, last };
    rows.push(h('button', { class: 'piece-row', onClick: () => go(`/piece/${piece.id}`) },
      h('span', { class: 'piece-title' }, piece.title),
      strip(piece, bars, progress),
      h('span', { class: 'piece-sub' },
        checks ? `${checks} ${checks === 1 ? 'bar is' : 'bars are'} ready for a next-day check`
          : `${started} of ${bars.length} bars started`)));
  }

  // Always there beside the pieces: five minutes on whatever is most useful. A short day beats a skipped one.
  const quick = latest && h('button', {
    class: 'btn quick',
    onClick: () => { session.quick = id; go(quickPath(latest.piece, latest.progress, Date.now(), latest.schedule)); },
  }, 'Quick practice', h('span', { class: 'quick-sub' }, '5 minutes'));

  return h('main', { class: 'screen player', vars: { pen: penVar(person.pen) } },
    h('header', { class: 'bar-top' },
      backTo('Players', '/'),
      h('h1', { class: 'name-title' }, h('span', {}, person.name)),
      grownUpsButton('/parent')),
    h('div', { class: 'week-row' }, dots, quick),
    rows.length ? h('div', { class: 'piece-list' }, rows)
      : h('p', { class: 'lead empty' }, 'No pieces yet. Ask a grown-up to add one.'));
}
