// Today's practice: one button, and a short queue of stops behind it. The player sees how many
// stops there are and which is next. They never see dates, steps or a schedule.
//
// The stops are the app's ordinary screens (the check, the trainer, the whole-piece play), visited
// in order. This screen is where each one returns to. The queue lives only for this sitting: it is
// built from what is saved, so starting again later simply builds what is still left to do.
import { h, go, fill, sticker } from '../ui.js';
import { get, byIndex, progressMap, scheduleMap, currentAssignment, playerDays, markStopsDone, attemptsSaved, timeSaved } from '../store.js';
import { penVar, sessionPlan, shortReturn, dayKey, weekSummary, weekTarget, processSentence } from '../model.js';
import { session } from '../session.js';
import { fanfare } from '../sound.js';
import { missing, backTo } from './common.js';

async function start(piece, path, quick) {
  const now = Date.now();
  const plan = sessionPlan({
    piece, quick, now,
    progress: await progressMap(piece.id),
    schedule: await scheduleMap(piece.id),
    assignment: await currentAssignment(piece.id),
    back: shortReturn(await playerDays(piece.playerId), now),
  });
  return { pieceId: piece.id, path, quick, day: dayKey(now), startedAt: now, at: 0, done: 0, within: 0, out: false, ended: false, trimmed: false, ...plan };
}

const dotsRow = (cls, label, list) => h('div', { class: cls, role: 'img', 'aria-label': label }, list.map((on) => h('i', { class: on ? 'on' : '' })));

export async function today([id, mode], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const person = await get('players', piece.playerId);
  const quick = mode === 'quick';
  const path = `/today/${id}${quick ? '/quick' : ''}`;
  const piecesPath = `/player/${piece.playerId}`;

  let t = session.today;
  if (!t || t.path !== path || t.day !== dayKey(Date.now())) {
    t = await start(piece, path, quick);
    session.today = t;
  } else if (t.out) {                       // back from a stop: it is done, however it went
    t.done += t.stops[t.at].size;
    t.at += 1;
    t.out = false;
    t.within = 0;
  }

  // Out of time: new bars and the join go first. The checks and the play-through stay.
  if (!t.trimmed && Date.now() - t.startedAt >= t.minutes * 60000) {
    t.stops = t.stops.filter((s, i) => i < t.at || (s.kind !== 'new' && s.kind !== 'join'));
    t.total = t.stops.reduce((sum, s) => sum + s.size, 0);
    t.trimmed = true;
  }

  const head = h('header', { class: 'bar-top' },
    backTo(person ? `${person.name}’s pieces` : 'Pieces', piecesPath),
    h('h1', {}, piece.title));
  const pips = () => dotsRow('stops', `${t.done} of ${t.total} stops done`, Array.from({ length: t.total }, (_, i) => i < t.done));

  if (t.ended || t.at >= t.stops.length) return finish();

  const stop = t.stops[t.at];
  return h('main', { class: 'screen today', vars: { pen: penVar(person?.pen || 'sky') } },
    head,
    t.note ? h('p', { class: 'week-note' }, h('span', { class: 'who' }, 'This week'), t.note) : null,
    h('div', { class: 'today-body' },
      pips(),
      h('p', { class: 'lead' }, `Stop ${Math.min(t.total, t.done + 1)} of ${t.total}`),
      h('button', {
        class: 'btn primary big today-go',
        onClick: () => { t.out = true; go(stop.path); },
      }, `${t.done ? 'Next' : 'Start'}: ${stop.label}`),
      h('button', { class: 'quiet-link', onClick: () => { t.ended = true; ctx.rerender(); } }, 'Stop here for today')));

  // One quiet card: the stops, the week, and one true sentence about how the practice went.
  async function finish() {
    const all = t.at >= t.stops.length && t.total > 0;
    if (all && !t.marked) { t.marked = true; await markStopsDone(id); }
    await attemptsSaved();
    await timeSaved();
    const plays = (await byIndex('attempts', 'pieceId', id)).filter((a) => (a.day || dayKey(a.at)) === t.day);
    const week = weekSummary(await playerDays(piece.playerId), weekTarget(person));
    const body = h('div', { class: 'finish-body' });
    fill(body,
      h('div', { class: 'cheer' }, sticker(76)),
      h('h1', { class: 'center' }, all ? 'That’s today done' : 'Good work today'),
      t.done ? pips() : null,
      h('p', { class: 'center lead process' }, processSentence(piece, plays, { finished: all })),
      dotsRow(`week ${week.met ? 'met' : ''}`, `Practice days this week: ${week.practised} ${week.practised === 1 ? 'dot' : 'dots'} filled`, week.dots),
      h('div', { class: 'row-buttons narrow' },
        h('button', { class: 'btn primary', onClick: () => go(piecesPath) }, 'Back to my pieces')));
    if (all && !t.cheered) { t.cheered = true; ctx.onShow(() => fanfare()); }
    return h('main', { class: 'screen finish today-end', vars: { pen: penVar(person?.pen || 'sky') } }, body);
  }
}
