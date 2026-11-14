// The next-day checks come in a mixed-up order, and the player chooses only which one is first.
import { shuffle, seededRandom, withFirst } from '../js/model.js';
import { test, expect, seedPiece, attemptsFor } from './helpers.js';

test('a seeded shuffle is repeatable, keeps every item, and the first pick moves nothing else', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  const once = shuffle(list, seededRandom(42));
  expect(shuffle(list, seededRandom(42))).toEqual(once);
  expect(once.slice().sort()).toEqual(list);
  expect(list).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);                      // the list given is left alone
  expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => shuffle(list, seededRandom(seed)).join(''))).size).toBeGreaterThan(4);

  const picked = withFirst(once, once[3]);
  expect(picked[0]).toBe(once[3]);
  expect(picked.slice(1)).toEqual(once.filter((x) => x !== once[3]));
  expect(withFirst(once, 'not there')).toEqual(once);
});

// Bars 1, 3, 5, 7 and 9 finished every stage yesterday: five separate stops for today.
async function fiveStops(page) {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const ids = [0, 2, 4, 6, 8].map((i) => seeded.bars[i]);
  await page.evaluate(async ({ pieceId, ids }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    for (const barId of ids) {
      const p = model.blankProgress(pieceId, barId);
      for (const s of model.practiceStages(piece)) p.done[s.id] = Date.now() - 26 * 3600 * 1000;
      await store.put('progress', p);
    }
  }, { pieceId, ids });
  return { seeded, pieceId };
}

const seed = (page, value) => page.evaluate(async (v) => { (await import('/js/session.js')).session.shuffleSeed = v; }, value);
const labels = ['Bar 1', 'Bar 3', 'Bar 5', 'Bar 7', 'Bar 9'];

test('the checks follow the seeded order after the one the player picks first', async ({ page }) => {
  const { pieceId } = await fiveStops(page);
  await seed(page, 7);
  const dealt = shuffle(labels, seededRandom(7));
  expect(dealt).not.toEqual(labels);                                        // this seed does mix them up
  const first = dealt[2];
  const expected = withFirst(dealt, first);

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Next-day check' })).toBeVisible();
  await expect(page.locator('.answer')).toHaveCount(0);                     // nothing to mark until a start is chosen
  const choices = page.getByRole('group', { name: 'Which one first?' }).getByRole('button');
  await expect(choices).toHaveText(labels);                                 // offered in the order of the music

  await choices.filter({ hasText: new RegExp(`^${first}$`) }).tap();
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const heading = page.locator('.train-top h1');
    await expect(heading).toHaveText(expected[i]);
    seen.push(await heading.textContent());
    if (i === 1) {                                                          // one slip along the way
      await page.locator('.answer.slip').tap();
      await page.locator('.chip', { hasText: 'Rhythm' }).tap();
    } else await page.locator('.answer.clean').tap();
  }
  expect(seen).toEqual(expected);

  // "Try again tomorrow" is as it was: the slipped bar waits a day, the others are done.
  await expect(page.locator('.finish-body')).toContainText('4 bars stuck');
  await expect(page.locator('.finish-body')).toContainText(`${expected[1]} needs a bit more. Try again tomorrow.`);
  const checks = (await attemptsFor(page, pieceId)).filter((a) => a.source === 'check');
  expect(checks.map((a) => a.result)).toEqual(['clean', 'slip', 'clean', 'clean', 'clean']);
  await page.goto('/#/');
  await page.goto(`/#/check/${pieceId}`);
  await expect(page.locator('main')).toContainText('Nothing is ready for a next-day check yet.');
});

test('the same seed deals the same order again, and one stop needs no choosing', async ({ page }) => {
  const { seeded, pieceId } = await fiveStops(page);
  await seed(page, 7);
  const dealt = shuffle(labels, seededRandom(7));
  await page.goto(`/#/check/${pieceId}`);
  await page.getByRole('group', { name: 'Which one first?' }).getByRole('button', { name: dealt[0], exact: true }).tap();
  for (let i = 0; i < 4; i++) {
    await expect(page.locator('.train-top h1')).toHaveText(dealt[i]);
    await page.locator('.answer.clean').tap();
  }
  // Leave with one still to do. Coming back, there is only one stop, so it starts straight away.
  await expect(page.locator('.train-top h1')).toHaveText(dealt[4]);
  await page.goto('/#/');
  await page.goto(`/#/check/${pieceId}`);
  await expect(page.locator('.train-top h1')).toHaveText(dealt[4]);
  await expect(page.locator('.answer.clean')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which one first?' })).toHaveCount(0);
  expect(seeded.bars).toHaveLength(12);
});
