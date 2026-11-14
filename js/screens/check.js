import { h, fill, goUp, softly, sheet, closeSheet, replaceSheet, sticker } from '../ui.js';
import { get, put, byIndex, progressMap, scheduleMap, currentAssignment, addAttempt, playerDays } from '../store.js';
import { session } from '../session.js';
import {
  reviewGroups, scheduleOf, afterReview, checkStage, barsLabel, dayKey, mistakeList, blankProgress, shuffle, seededRandom, withFirst,
  shortReturn, warmUpBar, RETURN_STOPS, REVIEW_CAP, activePins,
} from '../model.js';
import { drawBars } from '../images.js';
import { stickOn, fanfare } from '../sound.js';
import { PracticeClock, clockView, stayAwake } from '../clock.js';
import { missing, backTo } from './common.js';
import { practicePicker } from './pick.js';
import { Shadow } from '../shadow.js';

export async function check([id], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const progress = await progressMap(id);
  const stage = checkStage(piece);
  // Back after a few days away, the first session is a short one: a warm-up and a few checks.
  // The rest stay ready for next time, and nothing is said about the gap.
  const back = shortReturn(await playerDays(piece.playerId));
  const schedule = await scheduleMap(id);
  const assignment = await currentAssignment(id);
  const today = dayKey(Date.now());
  const earlier = (await byIndex('attempts', 'pieceId', id)).filter((a) => (a.day || dayKey(a.at)) === today);
  // Opening the check is the "Ready" tap. Plays made on a bar earlier today were its warm-ups.
  const warmUpsOn = (bar) => earlier.filter((a) => a.barIds.includes(bar.id)).length;
  const pinned = activePins(piece, assignment);
  const inScoreOrder = reviewGroups(piece, progress, schedule, { pinned, cap: back ? RETURN_STOPS : REVIEW_CAP });
  let warmUp = back && stage ? warmUpBar(piece, progress, inScoreOrder) : null;
  // Mixed up, so the bars aren't always met in the order they come in the music.
  let groups = shuffle(inScoreOrder, session.shuffleSeed == null ? Math.random : seededRandom(session.shuffleSeed));
  let started = groups.length < 2;          // with more than one, the player picks where to start
  if (!stage || !groups.length) {
    return h('main', { class: 'screen' },
      h('p', { class: 'lead' }, 'Nothing is ready for a next-day check yet.'),
      h('button', { class: 'btn', onClick: () => goUp(`/piece/${id}`) }, 'Back to my piece'));
  }

  const clock = await new PracticeClock({ piece, bars: warmUp ? [warmUp] : groups[0] }).load();
  const shadow = await Shadow.load();          // null unless a grown-up is grading alongside
  let index = 0, passed = 0;
  const again = [];
  const crop = h('canvas', {});
  const cropBox = h('div', { class: 'train-crop' }, crop);
  const title = h('h1', {});
  let spots = [];

  async function paint() {
    if (!started && !warmUp) { crop.width = 0; return; }
    const box = { width: cropBox.clientWidth - 8, height: cropBox.clientHeight - 8 };
    if (box.width < 40 || box.height < 40) return;
    spots = (await drawBars(crop, warmUp ? [warmUp] : groups[index], box)).spots;
  }

  const save = async (bar, ok) => {
    const p = progress.get(bar.id) || blankProgress(id, bar.id);
    p.lastCheck = dayKey(Date.now());
    if (ok && !p.done[stage.id]) session.freshGold.add(`${id}|${bar.id}`);       // its first gold crown
    // Where the bar goes on the ladder is worked out before the pass is written, from how it stood.
    const entry = scheduleOf(piece, bar, progress.get(bar.id), schedule.get(bar.id));
    if (ok) p.done[stage.id] ||= Date.now();                  // the gold crown keeps the day it was first won
    await put('progress', p);
    progress.set(bar.id, p);
    if (entry) {
      const next = afterReview(entry, { clean: ok, warmUps: warmUpsOn(bar), today: dayKey(Date.now()), lessonDay: assignment?.lessonDate || null });
      await put('schedule', next);
      schedule.set(bar.id, next);
    }
    if (ok && pinned.has(bar.id)) {                           // played clean in a check: the pin lets go
      assignment.pinsDone = [...(assignment.pinsDone || []), bar.id];
      await put('assignments', assignment);
    }
    if (ok) passed += 1; else again.push(bar);
  };

  const advance = () => {
    index += 1;
    if (index < groups.length) {
      clock.setBars(groups[index]);
      title.textContent = barsLabel(groups[index]);
      paint();
    } else {
      clock.stop();
      finish();
    }
  };

  // The play that finishes today's stops says so, which is what ticks the day even on a short one.
  const lastStop = () => (index === groups.length - 1 ? { stopsDone: true } : {});

  async function clean() {
    stickOn();
    const at = Date.now();
    const ticket = shadow?.ask();
    for (const b of groups[index]) await save(b, true);
    const attempt = await addAttempt(piece, {
      barIds: groups[index].map((b) => b.id), stageId: stage.id, source: 'check', result: 'clean', at, shadow: ticket?.grade ?? null,
      extra: lastStop(),
    });
    shadow?.saved(ticket, attempt);
    advance();
  }

  const recordSlip = async (bar, tag, at, ticket) => {
    for (const b of groups[index]) await save(b, b.id !== bar.id);
    const attempt = await addAttempt(piece, {
      barIds: [bar.id], stageId: stage.id, source: 'check', result: 'slip', tag, at, shadow: ticket?.grade ?? null, extra: lastStop(),
    });
    shadow?.saved(ticket, attempt);
  };

  function slip() {
    const at = Date.now();          // the slip happened now, not when the questions are answered
    const ticket = shadow?.ask();
    const group = groups[index];
    const tags = (bar) => {
      let saved = false;
      const finish = async (tag) => { if (saved) return; saved = true; await recordSlip(bar, tag, at, ticket); };
      replaceSheet([
        h('h2', {}, 'What happened?'),
        h('div', { class: 'chips' }, mistakeList(piece, stage).map((m) => h('button', {
          class: 'chip',
          onClick: async () => { await finish(m.id); closeSheet(); advance(); },
        }, m.label))),
      ]);
    };
    if (group.length === 1) {
      sheet([h('div', {})], { dismiss: false });
      tags(group[0]);
      return;
    }
    sheet([
      h('h2', {}, 'Which bar slipped?'),
      h('div', { class: 'chips' }, group.map((b) => h('button', { class: 'chip', onClick: () => tags(b) }, `Bar ${b.n}`))),
    ], { dismiss: false });
  }

  function finish() {
    fanfare();
    const backStage = piece.stages[piece.stages.findIndex((s) => s.id === stage.id) - 1]?.id || stage.id;
    softly(() => { root.className = 'screen finish'; root.replaceChildren(h('div', { class: 'finish-body' },
      h('div', { class: 'cheer' }, sticker(76)),
      h('h1', { class: 'center' }, passed === 1 ? '1 bar stuck' : `${passed} bars stuck`),
      passed ? h('p', { class: 'center lead' }, `${passed === 1 ? 'It has' : 'They have'} a gold crown on your piece now.`) : null,
      again.length ? h('p', { class: 'center lead' }, `${again.length === 1 ? `Bar ${again[0].n} needs` : `Bars ${again.map((b) => b.n).join(', ')} need`} a bit more. Try again tomorrow.`) : null,
      h('div', { class: 'row-buttons narrow' },
        again.length ? h('button', {
          class: 'btn',
          onClick: () => sheet(practicePicker({ piece, bars: [again[0]], progress, stageId: backStage }), { kind: 'bar-sheet' }),
        }, `Practise bar ${again[0].n}`) : null,
        h('button', { class: 'btn primary', onClick: () => goUp(`/piece/${id}`) }, 'Back to my piece')))); }, () => root);
  }

  const ro = new ResizeObserver(() => paint());
  let letSleep = () => {};
  // The one choice the player gets: which stop goes first.
  const side = h('section', { class: 'train-side' });
  function showSide() {
    if (warmUp) {                           // not marked and not saved: it is only to get going
      title.textContent = 'Warm-up';
      fill(side,
        h('p', { class: 'goal' }, `Play bar ${warmUp.n} once, any way you like.`),
        h('button', { class: 'answer clean wide', onClick: () => { clock.touch(); warmUp = null; clock.setBars(groups[0]); showSide(); paint(); } }, 'Ready'));
      return;
    }
    if (started) {
      title.textContent = barsLabel(groups[index]);
      fill(side,
        h('p', { class: 'goal' }, 'One go, first try. No warm-up.'),
        h('div', { class: 'answers' },
          h('button', { class: 'answer slip', onClick: slip }, 'Slip'),
          h('button', { class: 'answer clean', onClick: clean }, 'Clean')));
      return;
    }
    title.textContent = 'Next-day check';
    fill(side,
      h('p', { class: 'goal' }, 'Which one first?'),
      h('div', { class: 'chips first-pick', role: 'group', 'aria-label': 'Which one first?' },
        inScoreOrder.map((group) => h('button', {
          class: 'chip',
          onClick: () => {
            groups = withFirst(groups, group);
            started = true;
            clock.setBars(groups[0]);
            showSide();
            paint();
          },
        }, barsLabel(group)))));
  }

  ctx.onShow(() => {
    showSide();
    ro.observe(cropBox);
    letSleep = stayAwake(clock);
    clock.start();
  });
  ctx.onLeave(() => { shadow?.close(); ro.disconnect(); clock.stop(); letSleep(); });

  const root = h('main', { class: 'trainer check', vars: { pen: 'var(--tick-gold)' } },
    h('header', { class: 'train-top' },
      backTo('My piece', `/piece/${id}`),
      title,
      clockView(clock),
      h('span', { class: 'stage-tag' }, h('i', {}), stage.name)),
    cropBox,
    side);
  return root;
}
