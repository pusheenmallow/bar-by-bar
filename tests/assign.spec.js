// The week's assignment: typed in by a grown-up, it sets what is new and what is pinned.
import { parseBarNumbers, activePins, assignedBars, blankAssignment, defaultStages } from '../js/model.js';
import { test, expect, seedPiece, openGrownUps, rows } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const at = (page, day) => page.clock.setFixedTime(new Date(`${day}T16:00:00+11:00`));

const ids = Array.from({ length: 8 }, (_, i) => `b${i + 1}`);
const piece = {
  id: 'p', playerId: 'pl', tempo: 96, stages: defaultStages(),
  layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: ids.map((_, i) => i / 8).concat(1), bars: ids.map((id) => ({ id, skip: id === 'b3' })) }] }],
};

test('bar ranges are read the way a teacher writes them', () => {
  expect(parseBarNumbers('9-16, 21')).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 21]);
  expect(parseBarNumbers('3 to 5 and 1')).toEqual([1, 3, 4, 5]);
  expect(parseBarNumbers('7–8; 8 — 9')).toEqual([7, 8, 9]);
  expect(parseBarNumbers('5-3')).toEqual([3, 4, 5]);
  expect(parseBarNumbers('')).toEqual([]);
  expect(parseBarNumbers('the tricky bit, 4')).toEqual([4]);
});

test('pins let go after a clean check or once the lesson has passed, whichever is first', () => {
  const noon = (day) => new Date(`${day}T12:00:00`).getTime();
  const a = { ...blankAssignment(piece), bars: '5-8', pins: '2, 3, 4', lessonDate: '2026-11-21' };
  expect(a).toMatchObject({ status: 'current', stageId: 'full', tempo: 96, minutes: 15, pinsDone: [] });
  expect(assignedBars(piece, a).map((b) => b.id)).toEqual(['b5', 'b6', 'b7', 'b8']);
  expect([...activePins(piece, a, noon('2026-11-16'))]).toEqual(['b2', 'b4']);             // bar 3 is skipped in this piece
  expect([...activePins(piece, { ...a, pinsDone: ['b2'] }, noon('2026-11-16'))]).toEqual(['b4']);
  expect([...activePins(piece, a, noon('2026-11-21'))]).toEqual(['b2', 'b4']);             // still on, the day of the lesson
  expect([...activePins(piece, a, noon('2026-11-22'))]).toEqual([]);
  expect([...activePins(piece, { ...a, lessonDate: '' }, noon('2027-01-01'))]).toEqual(['b2', 'b4']);
  expect([...activePins(piece, { ...a, status: 'done' }, noon('2026-11-16'))]).toEqual([]);
  expect([...activePins(piece, null)]).toEqual([]);
  expect(assignedBars(piece, { ...a, status: 'done' })).toEqual([]);
});

// Bars with a gold crown that aren't due for a long time.
async function goldBars(page, pieceId, barIds) {
  await page.evaluate(async ({ pieceId, barIds }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const then = Date.now() - 5 * 86400000;
    for (const barId of barIds) {
      const p = model.blankProgress(pieceId, barId);
      for (const s of piece.stages) p.done[s.id] = then;
      await store.put('progress', p);
      await store.put('schedule', { ...model.blankSchedule(pieceId, barId), step: 5, kept: true, lastDay: model.dayKey(then), dueDay: '2026-12-25' });
    }
  }, { pieceId, barIds });
}
const fresh = async (page, path) => {
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();
  await page.goto(`/#${path}`);
};

test('a grown-up types in the assignment, and a new one replaces it', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-16');
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const pieceId = seeded.pieces.Pip;

  await openGrownUps(page, `/parent/piece/${pieceId}`);
  await page.getByRole('button', { name: 'This week’s assignment' }).tap();
  await expect(page.getByRole('heading', { name: 'This week’s assignment' })).toBeVisible();
  await expect(page.locator('.lead')).toHaveText('Paper Boat Waltz, for Pip');
  await page.getByRole('textbox', { name: 'New bars this week' }).fill('5-8, 40');
  await expect(page.locator('main')).toContainText('Bars 5 to 8. Not in this piece: 40.');
  await page.getByRole('textbox', { name: 'Bars to see every day' }).fill('2');
  await expect(page.locator('main')).toContainText('Bar 2.');
  await page.getByRole('combobox', { name: 'Take new bars as far as' }).selectOption({ label: 'Together slow' });
  await page.getByLabel('Next lesson').fill('2026-11-21');
  await page.getByRole('button', { name: 'More: Time for a session' }).tap();
  await page.getByRole('textbox', { name: 'A note for the player' }).fill('Curved fingers in bar 2');
  await page.getByRole('button', { name: 'Save assignment' }).tap();
  await expect(page.getByRole('button', { name: 'This week’s assignment' })).toBeVisible();

  let saved = await rows(page, 'assignments');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    pieceId, playerId: seeded.players.Pip, status: 'current', bars: '5-8, 40', pins: '2', stageId: 'slow',
    lessonDate: '2026-11-21', minutes: 20, note: 'Curved fingers in bar 2', pinsDone: [],
  });

  // It is Pip's alone: Juno, on the same music, has none.
  await page.getByRole('button', { name: 'This week’s assignment' }).tap();
  await expect(page.getByRole('textbox', { name: 'New bars this week' })).toHaveValue('5-8, 40');
  await page.getByRole('button', { name: 'Juno' }).tap();
  await expect(page.locator('.lead')).toHaveText('Paper Boat Waltz, for Juno');
  await expect(page.getByRole('textbox', { name: 'New bars this week' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Clear assignment' })).toHaveCount(0);

  // Clearing keeps the old one, marked done.
  await page.getByRole('button', { name: 'Pip' }).tap();
  await page.getByRole('button', { name: 'Clear assignment' }).tap();
  await expect(page.getByRole('button', { name: 'This week’s assignment' })).toBeVisible();
  saved = await rows(page, 'assignments');
  expect(saved.map((a) => a.status)).toEqual(['done']);

  // Taking a learner off the piece takes their assignments with them.
  await page.evaluate(async (id) => (await import('/js/store.js')).removeLearner(id), pieceId);
  expect(await rows(page, 'assignments')).toEqual([]);
});

test('a pinned bar is checked every session until it is clean, even when the ladder says wait', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-16');
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await goldBars(page, pieceId, [seeded.bars[1], seeded.bars[5]]);

  await fresh(page, `/check/${pieceId}`);
  await expect(page.locator('main')).toContainText('Nothing is ready for a next-day check yet.');

  await page.evaluate(async ({ pieceId }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    await store.saveAssignment({ ...model.blankAssignment(piece), pins: '2, 9', lessonDate: '2026-11-21' });      // bar 9 isn't learned yet
  }, { pieceId });

  await fresh(page, `/piece/${pieceId}`);
  await expect(page.locator('.bar-hit').nth(1)).toHaveAttribute('aria-label', /pinned for this week/);
  await expect(page.locator('.banner')).toContainText('1 bar is ready for a next-day check.');
  await page.getByRole('button', { name: 'Start check' }).tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bar 2');
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  expect((await rows(page, 'assignments'))[0].pinsDone).toEqual([]);

  // Not twice in one day. The next day it is back, and a clean check lets the pin go.
  await fresh(page, `/check/${pieceId}`);
  await expect(page.locator('main')).toContainText('Nothing is ready');
  await at(page, '2026-11-17');
  await fresh(page, `/check/${pieceId}`);
  await expect(page.locator('.train-top h1')).toHaveText('Bar 2');
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  expect((await rows(page, 'assignments'))[0].pinsDone).toEqual([seeded.bars[1]]);
  await at(page, '2026-11-18');
  await fresh(page, `/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await expect(page.locator('.bar-hit').nth(1)).not.toHaveAttribute('aria-label', /pinned/);
  await expect(page.getByRole('button', { name: 'Start check' })).toHaveCount(0);
});

test('a pin that is never played clean still lets go after the lesson', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-21');
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await goldBars(page, pieceId, [seeded.bars[1]]);
  await page.evaluate(async ({ pieceId }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    await store.saveAssignment({ ...model.blankAssignment(await store.get('pieces', pieceId)), pins: '2', lessonDate: '2026-11-21' });
  }, { pieceId });
  await fresh(page, `/piece/${pieceId}`);
  await expect(page.getByRole('button', { name: 'Start check' })).toBeVisible();          // the day of the lesson
  await at(page, '2026-11-22');
  await fresh(page, `/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Start check' })).toHaveCount(0);
});
