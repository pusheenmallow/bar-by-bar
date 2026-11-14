// Showing up: weekly dots, the five-minute rule, Quick practice and the short session after time away.
// The clock is pinned, in Sydney time, so that "local day" and "Monday" are really tested.
import {
  weekDays, weekSummary, dayCounts, daysAway, shortReturn, weekTarget, quickPath, defaultStages, blankProgress,
} from '../js/model.js';
import { test, expect, seedPiece, openGrownUps, attemptsFor } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });

const at = (page, local) => page.clock.setFixedTime(new Date(`${local}+11:00`));
const SAT = '2026-11-14', SUN = '2026-11-15', MON = '2026-11-16';

// Practice time put straight into the database for a day.
async function addSeconds(page, pieceId, day, seconds) {
  await page.evaluate(async ({ pieceId, day, seconds }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    await store.addTime(pieceId, day, 'bar', [model.playableBars(piece)[0].id], seconds);
  }, { pieceId, day, seconds });
}

// Bars that finished every stage a while ago, so each is its own next-day check today.
async function readyBars(page, pieceId, barIds, { gold = [] } = {}) {
  await page.evaluate(async ({ pieceId, barIds, gold }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const then = Date.now() - 6 * 86400000;
    for (const barId of [...barIds, ...gold]) {
      const p = model.blankProgress(pieceId, barId);
      for (const s of model.practiceStages(piece)) p.done[s.id] = then;
      if (gold.includes(barId)) p.done[model.checkStage(piece).id] = then;
      await store.put('progress', p);
    }
  }, { pieceId, barIds, gold });
}

const dots = (page) => page.locator('.week i');
const filled = (page) => page.locator('.week i.on');
async function showPlayer(page, playerId) {
  await page.goto('/#/');
  await page.goto(`/#/player/${playerId}`);
  await expect(page.locator('.week')).toBeVisible();
}

test('the rules: a week runs Monday to Sunday, and a day counts at five minutes or on finishing the stops', () => {
  const noon = (day) => new Date(`${day}T12:00:00`).getTime();
  expect(weekDays(noon('2026-11-11'))).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  expect(weekDays(noon(SUN))[0]).toBe('2026-11-09');
  expect(weekDays(noon(MON))[0]).toBe(MON);

  expect(dayCounts(undefined)).toBe(false);
  expect(dayCounts({ seconds: 299, plays: 30, stops: false })).toBe(false);
  expect(dayCounts({ seconds: 300, plays: 0, stops: false })).toBe(true);
  expect(dayCounts({ seconds: 45, plays: 2, stops: true })).toBe(true);

  const days = new Map([
    ['2026-11-08', { seconds: 900, plays: 9, stops: false }],             // last week
    ['2026-11-09', { seconds: 600, plays: 5, stops: false }],
    ['2026-11-11', { seconds: 100, plays: 2, stops: false }],             // too short to count, but its time is still time
    ['2026-11-12', { seconds: 60, plays: 1, stops: true }],
  ]);
  expect(weekSummary(days, 4, noon('2026-11-13'))).toEqual({ practised: 2, target: 4, seconds: 760, met: false, dots: [true, true, false, false] });
  expect(weekSummary(days, 1, noon('2026-11-13')).dots).toEqual([true, true]);        // past the target: an extra dot, never fewer
  expect(weekSummary(days, 4, noon(MON)).dots).toEqual([false, false, false, false]);

  expect(daysAway(new Map(), noon(MON))).toBe(null);
  expect(daysAway(days, noon('2026-11-12'))).toBe(0);
  expect(daysAway(days, noon('2026-11-13'))).toBe(0);
  expect(daysAway(days, noon('2026-11-15'))).toBe(2);
  expect(shortReturn(days, noon('2026-11-15'))).toBe(false);
  expect(shortReturn(days, noon(MON))).toBe(true);                                    // away Friday, Saturday and Sunday
  expect(shortReturn(new Map(), noon(MON))).toBe(false);                              // a brand-new player isn't "back"

  expect(weekTarget({})).toBe(4);
  expect(weekTarget({ weekTarget: 9 })).toBe(7);
  expect(weekTarget({ weekTarget: 0 })).toBe(1);
});

test('a Quick practice starts with what is waiting, then what slipped, then what comes next', () => {
  const bar = (id) => ({ id, skip: false });
  const piece = { id: 'p', stages: defaultStages(), cleanTarget: 3, layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: [0, 0.3, 0.6, 1], bars: [bar('a'), bar('b'), bar('c')] }] }] };
  const now = new Date('2026-11-14T10:00:00').getTime();
  const all = (when, more = {}) => ({ ...blankProgress('p', 'x'), done: { rh: when, lh: when, melody: when, slow: when, full: when, ...more } });
  const progress = new Map();
  expect(quickPath(piece, progress, now)).toBe('/train/p/a/rh/3');
  progress.set('a', all(now - 3 * 86400000, { next: now - 86400000 }));
  expect(quickPath(piece, progress, now)).toBe('/train/p/b/rh/3');
  progress.set('c', { ...blankProgress('p', 'c'), runSlip: now - 1000 });
  expect(quickPath(piece, progress, now)).toBe('/train/p/c/rh/3');
  progress.set('b', all(now - 2 * 86400000));
  expect(quickPath(piece, progress, now)).toBe('/check/p');
  progress.set('b', all(now - 2 * 86400000, { next: now }));
  progress.set('c', all(now - 2 * 86400000, { next: now }));
  expect(quickPath(piece, progress, now)).toBe('/whole/p');
});

test('dots fill for practised days, show no missed days, and start again on Monday, local time', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SUN}T23:30:00`);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await addSeconds(page, pieceId, '2026-11-10', 600);          // Tuesday
  await addSeconds(page, pieceId, '2026-11-12', 200);          // Thursday: under five minutes
  await addSeconds(page, pieceId, SAT, 300);
  await addSeconds(page, pieceId, SUN, 420);

  await showPlayer(page, seeded.players.Pip);
  await expect(dots(page)).toHaveCount(4);                     // the default target
  await expect(filled(page)).toHaveCount(3);
  // Filled from the left, so a gap in the week can't be seen. Nothing names a day, a miss or a streak.
  expect(await dots(page).evaluateAll((els) => els.map((el) => el.className))).toEqual(['on', 'on', 'on', '']);
  await expect(page.locator('main')).not.toContainText(/miss|streak|in a row|\bmin\b|today|\d:\d\d/i);
  await expect(page.locator('.week')).toHaveAttribute('aria-label', 'Practice days this week: 3 dots filled');

  // Half an hour later it is Monday in Sydney, though still Sunday in UTC.
  await at(page, `${MON}T00:30:00`);
  await showPlayer(page, seeded.players.Pip);
  await expect(dots(page)).toHaveCount(4);
  await expect(filled(page)).toHaveCount(0);

  await addSeconds(page, pieceId, MON, 301);
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(1);
});

test('the five-minute rule: under five is no dot, five is, and it adds up over a player’s pieces only', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const second = await seedPiece(page, { learners: ['Pip'], title: 'Tin Drum March' });
  await addSeconds(page, seeded.pieces.Pip, SAT, 299);
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(0);

  await addSeconds(page, seeded.pieces.Juno, SAT, 500);        // someone else's minutes on the shared piece
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(0);
  await showPlayer(page, seeded.players.Juno);
  await expect(filled(page)).toHaveCount(1);

  await addSeconds(page, second.pieces.Pip, SAT, 1);           // 299 on one piece and 1 on another
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(1);
  await addSeconds(page, seeded.pieces.Pip, SAT, 2000);        // more the same day is still one dot
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(1);
});

test('finishing the day’s stops ticks the day before five minutes are up', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await addSeconds(page, pieceId, '2026-11-13', 400);          // practised yesterday, so today is an ordinary day
  await readyBars(page, pieceId, [seeded.bars[0], seeded.bars[2]]);
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(1);

  await page.goto(`/#/check/${pieceId}`);
  await page.getByRole('group', { name: 'Which one first?' }).getByRole('button', { name: 'Bar 1', exact: true }).tap();
  await page.locator('.answer.clean').tap();
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(1);                   // one stop still to do, and well under five minutes

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.locator('.train-top h1')).toHaveText('Bar 3');
  await page.locator('.answer.slip').tap();                    // a slip finishes the stops just the same
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  const checks = (await attemptsFor(page, pieceId)).filter((a) => a.source === 'check');
  expect(checks.map((a) => [a.result, !!a.stopsDone]).sort()).toEqual([['clean', false], ['slip', true]]);
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(2);
});

test('after three days away the first session is short: a warm-up and four checks, with no word about the gap', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const ready = [0, 2, 4, 6, 8, 10].map((i) => seeded.bars[i]);
  await readyBars(page, pieceId, ready, { gold: [seeded.bars[11]] });
  await addSeconds(page, pieceId, '2026-11-10', 600);          // last practised Tuesday: away Wednesday, Thursday, Friday

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Warm-up' })).toBeVisible();
  await expect(page.locator('.train-side')).toContainText('Play bar 12 once, any way you like.');
  await expect(page.locator('.answer.slip')).toHaveCount(0);   // a warm-up isn't marked
  await page.getByRole('button', { name: 'Ready' }).tap();

  const choices = page.getByRole('group', { name: 'Which one first?' }).getByRole('button');
  await expect(choices).toHaveText(['Bar 1', 'Bar 3', 'Bar 5', 'Bar 7']);
  await choices.first().tap();
  for (let i = 0; i < 4; i++) {
    await expect(page.locator('.answer.clean')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/away|missed|welcome back|been a while|days/i);
    await page.locator('.answer.clean').tap();
  }
  await expect(page.locator('.finish-body')).toContainText('4 bars stuck');
  await expect(page.locator('.finish-body')).not.toContainText(/away|missed|welcome back|been a while|days/i);

  const plays = await attemptsFor(page, pieceId);
  expect(plays).toHaveLength(4);                               // the warm-up saved nothing
  expect(plays.filter((a) => a.stopsDone)).toHaveLength(1);     // the clock is pinned, so the plays share a time and have no order
  await showPlayer(page, seeded.players.Pip);
  await expect(filled(page)).toHaveCount(2);                   // Tuesday, and today for finishing the short session

  // The other two are still ready, and now that today has practice in it, it's an ordinary session again.
  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Warm-up' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Which one first?' }).getByRole('button')).toHaveText(['Bar 9', 'Bar 11']);
});

test('after two days away it is an ordinary session, with every check and no warm-up', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await readyBars(page, pieceId, [0, 2, 4, 6, 8, 10].map((i) => seeded.bars[i]), { gold: [seeded.bars[11]] });
  await addSeconds(page, pieceId, '2026-11-11', 600);          // Wednesday: away Thursday and Friday only
  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Next-day check' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which one first?' }).getByRole('button')).toHaveCount(6);
});

test('grown-ups set the weekly target and see days and minutes; the player sees only dots', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page);
  await addSeconds(page, seeded.pieces.Pip, '2026-11-10', 620);
  await addSeconds(page, seeded.pieces.Pip, SAT, 130);

  await openGrownUps(page);
  const row = page.locator('.list-row', { hasText: 'Pip' }).first();
  await expect(row).toContainText('This week: 1 of 4 days, 13 min');
  await row.tap();
  const sheet = page.locator('.scrim:not(.leaving) .sheet');
  await sheet.getByRole('button', { name: 'More: Practice days a week' }).tap();
  await sheet.getByRole('button', { name: 'More: Practice days a week' }).tap();
  await sheet.getByRole('button', { name: 'Save player' }).tap();
  await expect(page.locator('.list-row', { hasText: 'Pip' }).first()).toContainText('This week: 1 of 6 days, 13 min');

  await showPlayer(page, seeded.players.Pip);
  await expect(dots(page)).toHaveCount(6);
  await expect(filled(page)).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText(/\bmin\b|today|of 6|\d:\d\d/);
  await expect(page.locator('.piece-row')).toContainText('0 of 12 bars started');
});

test('Quick practice is always offered, and its bar fills in five minutes of the player’s day', async ({ page }) => {
  await page.goto('/');
  await at(page, `${SAT}T16:00:00`);
  const seeded = await seedPiece(page);
  const second = await seedPiece(page, { learners: ['Pip'], title: 'Tin Drum March' });
  await addSeconds(page, seeded.pieces.Pip, SAT, 150);         // two and a half minutes already, on the other piece
  await page.evaluate(async ({ pieceId, barId }) => {          // the march was practised last, so Quick practice goes there
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    await store.put('progress', { ...model.blankProgress(pieceId, barId), slips: 1, lastPractised: Date.now() - 1000 });
  }, { pieceId: second.pieces.Pip, barId: second.bars[0] });

  await showPlayer(page, seeded.players.Pip);
  const quick = page.getByRole('button', { name: /Quick practice/ });
  await expect(quick).toContainText('5 minutes');
  await quick.tap();
  await expect(page).toHaveURL(new RegExp(`#/train/${second.pieces.Pip}/${second.bars[0]}/rh/3$`));
  await expect(page.locator('.answer.clean')).toBeVisible();
  const share = () => page.locator('.clock-fill').evaluate((el) => parseFloat(el.style.width));
  expect(await share()).toBeGreaterThanOrEqual(50);            // 150 of 300 seconds, not of the piece's ten minutes
  expect(await share()).toBeLessThan(60);

  // An ordinary visit to the same bar measures against the piece's own goal again.
  await showPlayer(page, seeded.players.Pip);
  await page.goto(`/#/train/${second.pieces.Pip}/${second.bars[0]}/rh/3`);
  await expect(page.locator('.answer.clean')).toBeVisible();
  expect(await share()).toBeLessThan(5);
});
