// The schedule: bars come back for a check play at growing gaps. The clock is pinned and moved a
// day at a time, in Sydney time.
import {
  LADDER, addDays, afterReview, afterRunSlip, blankSchedule, scheduleOf, squeezeGap, reviewGroups, waitingForCheck,
  defaultStages, blankProgress,
} from '../js/model.js';
import { test, expect, seedPiece, rows, openTrainer } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const at = (page, day, time = '16:00:00') => page.clock.setFixedTime(new Date(`${day}T${time}+11:00`));
const D = (n) => addDays('2026-11-02', n);              // day 0 is a Monday

const entry = (more) => ({ ...blankSchedule('p', 'b'), dueDay: D(0), ...more });

test('the ladder: a clean check climbs 1, 2, 4, 7, 14 days and stops there', () => {
  expect(LADDER).toEqual([0, 1, 2, 4, 7, 14]);
  let e = entry({ step: 0 });
  let today = D(0);
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    e = afterReview(e, { clean: true, today });
    gaps.push((new Date(`${e.dueDay}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
    today = e.dueDay;
  }
  expect(gaps).toEqual([1, 2, 4, 7, 14, 14, 14]);
  expect(e).toMatchObject({ step: 5, kept: true, lapses: 0 });
});

test('a slip comes back tomorrow, one step down, and the gap after that is shortened once', () => {
  const start = entry({ step: 4, kept: true, lastDay: D(0), dueDay: D(7) });
  const slipped = afterReview(start, { clean: false, today: D(7) });
  expect(slipped).toMatchObject({ step: 3, lapses: 1, dueDay: D(8), lastDay: D(7), kept: true, shortNext: true });   // kept is never taken back
  const back = afterReview(slipped, { clean: true, today: D(8) });
  expect(back).toMatchObject({ step: 4, shortNext: false, dueDay: D(8 + 4) });           // step 4 would be 7 days: shortened to 4, once
  expect(afterReview(back, { clean: true, today: D(12) })).toMatchObject({ step: 5, dueDay: D(12 + 14) });
  expect(afterReview(entry({ step: 1 }), { clean: false, today: D(0) })).toMatchObject({ step: 1, dueDay: D(1) });     // never below 1
});

test('a clean check after a lot of warming up repeats its gap', () => {
  const e = entry({ step: 2, lastDay: D(0), dueDay: D(2) });
  expect(afterReview(e, { clean: true, warmUps: 2, today: D(2) })).toMatchObject({ step: 3, dueDay: D(6) });
  expect(afterReview(e, { clean: true, warmUps: 3, today: D(2) })).toMatchObject({ step: 2, dueDay: D(4), kept: true });
});

test('the deadline squeeze: no gap is longer than half the days to the lesson', () => {
  expect(squeezeGap(14, D(0), D(8))).toBe(4);
  expect(squeezeGap(14, D(0), D(3))).toBe(1);
  expect(squeezeGap(14, D(0), D(1))).toBe(1);
  expect(squeezeGap(2, D(0), D(20))).toBe(2);
  expect(squeezeGap(7, D(0), null)).toBe(7);
  expect(squeezeGap(7, D(5), D(5))).toBe(7);                                              // the lesson is today or past: no squeeze
  const e = entry({ step: 4, lastDay: D(0), dueDay: D(7) });
  expect(afterReview(e, { clean: true, today: D(7), lessonDay: D(13) })).toMatchObject({ step: 5, dueDay: D(10) });
  expect(afterReview(e, { clean: true, today: D(7), lessonDay: D(6) })).toMatchObject({ dueDay: D(21) });
});

test('a tablet with the wrong date never moves a due day backwards', () => {
  const e = entry({ step: 3, lastDay: D(10), dueDay: D(14) });
  const wound = afterReview(e, { clean: true, today: D(3) });                              // the clock says a week earlier
  expect(wound.lastDay).toBe(D(10));
  expect(wound.dueDay).toBe(D(10 + 7));
  expect(wound.dueDay > e.dueDay).toBe(true);
  expect(afterReview(e, { clean: false, today: D(3) }).dueDay).toBe(D(11));
});

test('a slip in the whole piece brings a bar back tomorrow, and never pushes one later', () => {
  expect(afterRunSlip(entry({ step: 4, dueDay: D(20) }), D(5))).toMatchObject({ step: 3, dueDay: D(6) });
  expect(afterRunSlip(entry({ step: 1, dueDay: D(3) }), D(5))).toMatchObject({ step: 1, dueDay: D(3) });
});

test('bars learned before the schedule existed join it from their progress', () => {
  const piece = { id: 'p', stages: defaultStages() };
  const bar = { id: 'b', skip: false };
  const noon = (day) => new Date(`${day}T12:00:00`).getTime();
  const all = { rh: 1, lh: 1, melody: 1, slow: 1, full: noon(D(3)) };
  expect(scheduleOf(piece, bar, undefined)).toBe(null);
  expect(scheduleOf(piece, bar, { ...blankProgress('p', 'b'), done: { rh: 1, lh: 1 } })).toBe(null);          // still being learned
  expect(scheduleOf(piece, bar, { ...blankProgress('p', 'b'), done: all })).toMatchObject({ step: 1, dueDay: D(4), kept: false });
  expect(scheduleOf(piece, bar, { ...blankProgress('p', 'b'), done: { ...all, next: noon(D(5)) } })).toMatchObject({ step: 2, dueDay: D(7), kept: true });
  expect(scheduleOf(piece, { id: 'b', skip: true }, { ...blankProgress('p', 'b'), done: all })).toBe(null);
  const saved = entry({ step: 5, dueDay: D(30) });
  expect(scheduleOf(piece, bar, { ...blankProgress('p', 'b'), done: all }, saved)).toBe(saved);                 // a saved record wins
  expect(waitingForCheck(piece, bar, { ...blankProgress('p', 'b'), done: all }, noon(D(3)))).toBe(false);
  expect(waitingForCheck(piece, bar, { ...blankProgress('p', 'b'), done: all }, noon(D(4)))).toBe(true);
  expect(waitingForCheck(piece, bar, { ...blankProgress('p', 'b'), done: all, lastCheck: D(4) }, noon(D(4)))).toBe(false);
});

test('the queue is capped: pinned first, then the most overdue for their gap, then the most missed', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `b${i + 1}`);
  const piece = { id: 'p', stages: defaultStages(), layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: ids.map((_, i) => i / 24).concat(1), bars: ids.map((id) => ({ id, skip: false })) }] }] };
  const noon = (day) => new Date(`${day}T12:00:00`).getTime();
  const progress = new Map(), schedule = new Map();
  // Every second bar is due, so each is a stop of its own: twelve stops.
  ids.forEach((id, i) => {
    if (i % 2) return;
    progress.set(id, { ...blankProgress('p', id), done: { rh: 1, lh: 1, melody: 1, slow: 1, full: 1, next: 1 } });
    schedule.set(id, { ...blankSchedule('p', id), step: 2, kept: true, lastDay: D(0), dueDay: D(9) });
  });
  schedule.get('b23').dueDay = D(2);                                                       // the most overdue
  schedule.get('b21').lapses = 3;                                                          // the most missed of the rest
  const pick = (opts) => reviewGroups(piece, progress, schedule, { now: noon(D(10)), ...opts }).map((g) => g.map((b) => b.id).join('+'));
  expect(pick({ cap: 20 })).toHaveLength(12);
  expect(pick()).toHaveLength(8);
  expect(pick({ cap: 3 })).toEqual(['b1', 'b21', 'b23']);                                  // back in score order
  expect(pick({ cap: 3, pinned: new Set(['b15']) })).toEqual(['b15', 'b21', 'b23']);
  // A pinned bar comes up even when it isn't due, but not twice in a day, and not before it is learned.
  schedule.get('b1').dueDay = D(30);
  expect(pick({ cap: 20 })).not.toContain('b1');
  expect(pick({ cap: 20, pinned: new Set(['b1', 'b2']) })).toContain('b1');
  expect(pick({ cap: 20, pinned: new Set(['b1', 'b2']) }).flatMap((g) => g.split('+'))).not.toContain('b2');
  schedule.get('b1').lastDay = D(10);
  expect(pick({ cap: 20, pinned: new Set(['b1']) })).not.toContain('b1');
  // Neighbours that are both due share a stop.
  progress.set('b4', progress.get('b3'));
  schedule.set('b4', { ...schedule.get('b3'), barId: 'b4', key: 'p|b4' });
  expect(pick({ cap: 20 })).toContain('b3+b4+b5');
});

// One bar that finished every stage the day before day 0.
async function learnedBar(page, pieceId, barId, when) {
  await page.evaluate(async ({ pieceId, barId, when }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const p = model.blankProgress(pieceId, barId);
    for (const s of model.practiceStages(piece)) p.done[s.id] = when;
    await store.put('progress', p);
  }, { pieceId, barId, when });
}
const scheduleRow = async (page, pieceId, barId) => (await rows(page, 'schedule')).find((s) => s.key === `${pieceId}|${barId}`);
const ready = async (page, pieceId) => {
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();             // the old screen has gone before the score is read
  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  return page.getByRole('button', { name: 'Start check' }).count();
};

test('with the clock moved a day at a time, a bar comes back on the ladder’s days and no others', async ({ page }) => {
  await page.goto('/');
  await at(page, D(0));
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one] = seeded.bars;
  await learnedBar(page, pieceId, one, new Date(`${D(-1)}T16:00:00+11:00`).getTime());

  const check = async (result) => {
    await page.goto('/#/');
    await expect(page.locator('.name').first()).toBeVisible();
    await page.goto(`/#/check/${pieceId}`);
    await page.locator(`.answer.${result}`).tap();
    if (result === 'slip') await page.locator('.chip', { hasText: 'Rhythm' }).tap();
    await expect(page.locator('.finish-body')).toBeVisible();
  };

  // Day 0: the first check, clean. Gold crown, and the next one is two days on.
  expect(await ready(page, pieceId)).toBe(1);
  await check('clean');
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 2, dueDay: D(2), lastDay: D(0), kept: true, lapses: 0 });
  expect(await ready(page, pieceId)).toBe(0);
  await expect(page.locator('.bar-hit').first().locator('.mark.crown')).toHaveCount(1);

  await at(page, D(1));
  expect(await ready(page, pieceId)).toBe(0);
  await at(page, D(2), '00:20:00');                                                       // just past midnight is already the day
  expect(await ready(page, pieceId)).toBe(1);
  await check('clean');
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 3, dueDay: D(6) });

  await at(page, D(5));
  expect(await ready(page, pieceId)).toBe(0);
  await at(page, D(6));
  expect(await ready(page, pieceId)).toBe(1);
  await check('slip');                                                                    // back tomorrow, and the crown stays
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 2, dueDay: D(7), lapses: 1, kept: true });
  expect(await ready(page, pieceId)).toBe(0);
  await expect(page.locator('.bar-hit').first().locator('.mark.crown')).toHaveCount(1);
  await expect(page.locator('.bar-hit').first()).toHaveAttribute('data-step', 'gold');

  await at(page, D(7));
  expect(await ready(page, pieceId)).toBe(1);
  await check('clean');                                                                   // step 3 again, but the gap is shortened once
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 3, dueDay: D(9), shortNext: false });

  // Missing days costs nothing: a fortnight late it is simply checked, and climbs as usual.
  await at(page, D(23));
  expect(await ready(page, pieceId)).toBe(1);
  await check('clean');
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 4, dueDay: D(30), lapses: 1 });
});

test('warming up a lot before a check, and a lesson date, both shorten what comes next', async ({ page }) => {
  await page.goto('/');
  await at(page, D(0));
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, , three] = seeded.bars;
  const before = new Date(`${D(-1)}T16:00:00+11:00`).getTime();
  await learnedBar(page, pieceId, one, before);
  await learnedBar(page, pieceId, three, before);
  await page.evaluate(async ({ pieceId, lesson }) => {
    const store = await import('/js/store.js');
    await store.put('schedule', { key: `${pieceId}|x`, pieceId, barId: 'x', step: 1, dueDay: '2099-01-01', lastDay: null, lapses: 0, kept: false, shortNext: false });
    await store.saveAssignment({ id: 'made-up', pieceId, status: 'current', createdAt: 1, lessonDate: lesson });
  }, { pieceId, lesson: D(3) });

  await openTrainer(page, pieceId, one, 'full');                                          // three warm-up plays on bar 1 today
  await page.getByRole('button', { name: 'Metronome' }).tap();
  for (let i = 0; i < 3; i++) await page.locator('.answer.clean').tap();

  await page.goto(`/#/check/${pieceId}`);
  await page.getByRole('group', { name: 'Which one first?' }).getByRole('button', { name: 'Bar 1', exact: true }).tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bar 3');
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toBeVisible();

  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 1, dueDay: D(1), kept: true });        // warmed up: same gap again
  expect(await scheduleRow(page, pieceId, three)).toMatchObject({ step: 2, dueDay: D(1), kept: true });      // 2 days, squeezed to 1 by the lesson
});

test('a bar marked as slipped in the whole piece is due for a check the next day', async ({ page }) => {
  await page.goto('/');
  await at(page, D(0));
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two] = seeded.bars;
  await page.evaluate(async ({ pieceId, bars, due }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    for (const barId of bars) {
      const p = model.blankProgress(pieceId, barId);
      for (const s of piece.stages) p.done[s.id] = Date.now() - 5 * 86400000;
      await store.put('progress', p);
      await store.put('schedule', { ...model.blankSchedule(pieceId, barId), step: 4, kept: true, lastDay: model.addDays(due, -7), dueDay: due });
    }
  }, { pieceId, bars: [one, two], due: D(6) });

  await page.goto(`/#/whole/${pieceId}`);
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.locator('.bar-hit').nth(1).tap();
  await page.getByRole('button', { name: 'Done, 1 bar slipped' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  expect(await scheduleRow(page, pieceId, two)).toMatchObject({ step: 3, dueDay: D(1), kept: true });
  expect(await scheduleRow(page, pieceId, one)).toMatchObject({ step: 4, dueDay: D(6) });
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();
  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit').nth(1).locator('.mark.crown')).toHaveCount(1);     // nothing the player sees went down
});
