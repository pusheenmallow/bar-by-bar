// Every marked play is saved with the same set of fields, whichever screen it came from.
import { dayKey } from '../js/model.js';
import { test, expect, seedPiece, attemptsFor, finishStagesYesterday, openTrainer } from './helpers.js';

const FIELDS = [
  'id', 'pieceId', 'playerId', 'barIds', 'stageId', 'result', 'tag', 'at', 'day', 'source',
  'metronomeOn', 'tempoSet', 'tempo', 'firstTryToday', 'warmUps', 'runGoal', 'shadow',
];

function expectEveryField(attempt) {
  for (const field of FIELDS) expect(attempt, `attempt has "${field}"`).toHaveProperty(field);
  expect(attempt.day).toBe(dayKey(attempt.at));
}

test('a clean play in the trainer carries every field', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openTrainer(page, pieceId, seeded.bars[0]);

  const before = Date.now();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  let [first] = await attemptsFor(page, pieceId);
  expectEveryField(first);
  expect(first).toMatchObject({
    pieceId, playerId: seeded.players.Pip, barIds: [seeded.bars[0]], stageId: 'rh', result: 'clean', tag: null,
    source: 'trainer', metronomeOn: false, tempo: null, firstTryToday: true, warmUps: null, runGoal: 3,
  });
  expect(first.at).toBeGreaterThanOrEqual(before);
  expect(first.tempoSet).toBe(Number(await page.locator('.tempo-value').innerText()));

  // With the metronome ticking and the dial moved, both speeds are saved, and it is no longer the first try.
  await page.getByRole('button', { name: 'Faster' }).tap();
  await page.getByRole('button', { name: 'Metronome' }).tap();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(2);
  const second = (await attemptsFor(page, pieceId))[1];
  expectEveryField(second);
  expect(second).toMatchObject({ metronomeOn: true, tempoSet: first.tempoSet + 2, tempo: first.tempoSet + 2, firstTryToday: false, runGoal: 3 });
});

test('a crown run saves its goal, and another bar is a first try again', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openTrainer(page, pieceId, seeded.bars[0], 'rh', 7);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  await openTrainer(page, pieceId, [seeded.bars[0], seeded.bars[1]], 'lh', 3);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  await openTrainer(page, pieceId, seeded.bars[2], 'rh', 3);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);

  const [crown, overlap, fresh] = await attemptsFor(page, pieceId);
  expect(crown).toMatchObject({ runGoal: 7, firstTryToday: true });
  expect(overlap).toMatchObject({ runGoal: 3, stageId: 'lh', firstTryToday: false });   // bar 1 was already played today
  expect(fresh).toMatchObject({ firstTryToday: true });
});

test('a slip is timed at the tap, not when its reason is chosen', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openTrainer(page, pieceId, seeded.bars[0]);

  const tapped = Date.now();
  await page.locator('.answer.slip').tap();
  await expect(page.locator('.coach-ask')).toBeVisible();
  expect(await attemptsFor(page, pieceId)).toHaveLength(0);      // waiting for its reason
  await page.waitForTimeout(700);
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.fix')).toBeVisible();

  let [slip] = await attemptsFor(page, pieceId);
  expectEveryField(slip);
  expect(slip).toMatchObject({ result: 'slip', tag: 'rhythm', source: 'trainer', metronomeOn: false, tempo: null, firstTryToday: true, runGoal: 3 });
  expect(slip.at).toBeGreaterThanOrEqual(tapped);
  expect(slip.at).toBeLessThan(tapped + 600);

  // A slip with no reason is saved by the next tap, still with its own time and before the clean play.
  const second = Date.now();
  await page.locator('.answer.slip').tap();
  await page.waitForTimeout(500);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  const all = await attemptsFor(page, pieceId);
  expect(all.map((a) => a.result)).toEqual(['slip', 'slip', 'clean']);
  expect(all[1]).toMatchObject({ tag: null, firstTryToday: false });
  expect(all[1].at).toBeLessThan(second + 450);
  expect(all[2].at - all[1].at).toBeGreaterThanOrEqual(400);
  expect(all[2].firstTryToday).toBe(false);
  all.forEach(expectEveryField);
});

test('a next-day check counts the warm-ups before it', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two, three, four] = seeded.bars;
  await finishStagesYesterday(page, pieceId, [one, two, three, four]);

  // Two warm-up plays today on the first bar.
  await openTrainer(page, pieceId, one, 'full');
  await page.getByRole('button', { name: 'Metronome' }).tap();
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(2);

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Bars 1 to 4' })).toBeVisible();
  const tapped = Date.now();
  await page.locator('.answer.slip').tap();
  await page.getByRole('button', { name: 'Bar 3' }).tap();
  await page.waitForTimeout(600);
  await page.locator('.chip', { hasText: 'Wrong note' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();

  const checks = (await attemptsFor(page, pieceId)).filter((a) => a.source === 'check');
  expect(checks).toHaveLength(1);
  expectEveryField(checks[0]);
  expect(checks[0]).toMatchObject({
    barIds: [three], result: 'slip', tag: 'note', stageId: 'next', metronomeOn: false, tempoSet: null, tempo: null,
    firstTryToday: true, warmUps: 0, runGoal: null, playerId: seeded.players.Pip,
  });
  expect(checks[0].at).toBeLessThan(tapped + 500);
});

test('a clean next-day check on warmed-up bars says so', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two] = seeded.bars;
  await finishStagesYesterday(page, pieceId, [one, two]);
  await openTrainer(page, pieceId, one, 'rh');
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(2);

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Bars 1 to 2' })).toBeVisible();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toBeVisible();

  const check = (await attemptsFor(page, pieceId)).find((a) => a.source === 'check');
  expectEveryField(check);
  expect(check).toMatchObject({ barIds: [one, two], result: 'clean', tag: null, firstTryToday: false, warmUps: 2, metronomeOn: false, tempoSet: null, runGoal: null });
});

test('a whole-piece play carries every field', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;

  await page.goto(`/#/whole/${pieceId}`);
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.getByRole('button', { name: 'Clean all the way' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();

  await page.getByRole('button', { name: 'Play it again' }).tap();
  await page.getByRole('button', { name: 'Metronome' }).tap();
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.locator('.bar-hit').nth(4).tap();
  await page.getByRole('button', { name: 'Done, 1 bar slipped' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();

  const [clean, slip] = await attemptsFor(page, pieceId);
  [clean, slip].forEach(expectEveryField);
  expect(clean).toMatchObject({
    source: 'whole', mode: 'piece', result: 'clean', slipBars: [], barIds: seeded.bars, stageId: null, tag: null,
    metronomeOn: false, tempo: null, firstTryToday: true, warmUps: null, runGoal: null, playerId: seeded.players.Pip,
  });
  expect(typeof clean.tempoSet).toBe('number');
  expect(slip).toMatchObject({ source: 'whole', result: 'slip', slipBars: [seeded.bars[4]], metronomeOn: true, tempo: null, firstTryToday: false });
});

test('people sharing a piece keep their own attempts and their own first tries', async ({ page }) => {
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const bar = seeded.bars[0];

  await openTrainer(page, seeded.pieces.Pip, bar);
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(2);

  await openTrainer(page, seeded.pieces.Juno, bar);
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Wrong finger' }).tap();
  await expect(page.locator('.fix')).toBeVisible();

  const pips = await attemptsFor(page, seeded.pieces.Pip);
  const junos = await attemptsFor(page, seeded.pieces.Juno);
  expect(pips.map((a) => [a.playerId, a.result, a.firstTryToday])).toEqual([
    [seeded.players.Pip, 'clean', true], [seeded.players.Pip, 'clean', false],
  ]);
  expect(junos.map((a) => [a.playerId, a.result, a.firstTryToday])).toEqual([[seeded.players.Juno, 'slip', true]]);
  expect(junos[0].barIds).toEqual([bar]);      // the same bar of the same music, in her own record
});
