// Shadow grading: a grown-up's own verdict beside the child's, to see how far self-marking can be trusted.
import { shadowAgreement } from '../js/model.js';
import { test, expect, seedPiece, attemptsFor, finishStagesYesterday, openTrainer, openGrownUps, rows } from './helpers.js';

const prompt = (page) => page.getByRole('group', { name: 'Grown-up check' });
const grade = (page, verdict) => prompt(page).getByRole('button', { name: verdict }).tap();

async function switchOn(page) {
  await openGrownUps(page);
  await page.getByRole('checkbox', { name: 'Ask for my answer after each play on this tablet' }).check();
  await expect.poll(async () => (await rows(page, 'meta')).find((m) => m.key === 'shadowGrade')?.value).toBe(true);
}

// Puts graded plays straight into the database: [child's mark, grown-up's verdict] pairs.
async function addGraded(page, pieceId, pairs) {
  await page.evaluate(async ({ pieceId, pairs }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const barIds = [model.playableBars(piece)[0].id];
    for (const [result, shadow] of pairs) await store.addAttempt(piece, { barIds, stageId: 'rh', source: 'trainer', result, shadow });
  }, { pieceId, pairs });
}

test('agreement is worked out over graded plays only', () => {
  const play = (result, shadow) => ({ result, shadow });
  const tally = shadowAgreement([
    play('clean', 'clean'), play('clean', 'clean'), play('slip', 'slip'),
    play('clean', 'slip'), play('clean', 'slip'), play('slip', 'clean'),
    play('clean', null), play('slip', null), { result: 'clean' },
  ]);
  expect(tally).toEqual({ graded: 6, agreed: 3, percent: 50, childCleanAdultSlip: 2, childSlipAdultClean: 1, enough: false });
  expect(shadowAgreement([])).toMatchObject({ graded: 0, percent: null, enough: false });
  expect(shadowAgreement(Array.from({ length: 20 }, () => play('slip', 'slip')))).toMatchObject({ graded: 20, percent: 100, enough: true });
  expect(shadowAgreement(Array.from({ length: 3 }, (_, i) => play('clean', i ? 'clean' : 'slip'))).percent).toBe(67);
});

test('with shadow grading off there is no prompt and nothing in the stats', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openTrainer(page, pieceId, seeded.bars[0]);
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.fix')).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  expect((await attemptsFor(page, pieceId)).map((a) => a.shadow)).toEqual([null, null]);

  await openGrownUps(page, `/parent/stats/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Time on each bar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shadow grading' })).toHaveCount(0);
});

test('in the trainer the grown-up’s answer is saved on the play it belongs to', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await switchOn(page);
  await openTrainer(page, pieceId, seeded.bars[0], 'rh', 7);
  await expect(prompt(page)).toHaveCount(0);                       // nothing until the child taps

  // 1. Child: clean. Grown-up: slip.
  await page.locator('.answer.clean').tap();
  await expect(prompt(page)).toBeVisible();
  await grade(page, 'Slip');
  await expect(prompt(page)).toHaveCount(0);

  // 2. Child: slip. The grown-up answers before the child has picked a reason, so before it is saved.
  await page.locator('.answer.slip').tap();
  await grade(page, 'Slip');
  await page.locator('.chip', { hasText: 'Wrong note' }).tap();
  await expect(page.locator('.fix')).toBeVisible();

  // 3. Child: clean, skipped by the grown-up.
  await page.locator('.answer.clean').tap();
  await prompt(page).getByRole('button', { name: 'Skip' }).tap();
  await expect(prompt(page)).toHaveCount(0);

  // 4. Child: slip with no reason and no answer. 5. Child: clean, which the grown-up agrees with.
  await page.locator('.answer.slip').tap();
  await page.locator('.answer.clean').tap();
  await expect(prompt(page)).toHaveCount(1);
  await grade(page, 'Clean');

  const attempts = await attemptsFor(page, pieceId);
  expect(attempts.map((a) => [a.result, a.shadow])).toEqual([
    ['clean', 'slip'], ['slip', 'slip'], ['clean', null], ['slip', null], ['clean', 'clean'],
  ]);
  expect(attempts[1].tag).toBe('note');

  // The stickers follow the child's marks alone: slip, clean, slip, clean leaves one.
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(1);

  // The prompt goes when the screen is left.
  await page.locator('.answer.clean').tap();
  await expect(prompt(page)).toBeVisible();
  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit').first()).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
});

test('in the next-day check the prompt can be answered over the questions', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two, three, four, five] = seeded.bars;
  await finishStagesYesterday(page, pieceId, [one, two, three, four, five]);
  await switchOn(page);

  await page.goto(`/#/check/${pieceId}`);
  await expect(page.getByRole('heading', { name: 'Bars 1 to 4' })).toBeVisible();
  await page.locator('.answer.slip').tap();
  await expect(page.getByRole('heading', { name: 'Which bar slipped?' })).toBeVisible();
  await grade(page, 'Clean');                                      // the sheet is open underneath
  await page.getByRole('button', { name: 'Bar 2' }).tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();

  await expect(page.getByRole('heading', { name: 'Bar 5' })).toBeVisible();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  await grade(page, 'Clean');

  const checks = (await attemptsFor(page, pieceId)).filter((a) => a.source === 'check');
  expect(checks.map((a) => [a.barIds.length, a.result, a.shadow])).toEqual([[1, 'slip', 'clean'], [1, 'clean', 'clean']]);
  expect(checks[0].barIds).toEqual([two]);
});

test('grown-up stats show agreement after 20 graded plays, counted per player', async ({ page }) => {
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  // Pip: 19 graded plays, 14 the same. Juno: a few of her own, which must not count for Pip.
  await addGraded(page, seeded.pieces.Pip, [
    ...Array.from({ length: 12 }, () => ['clean', 'clean']), ['slip', 'slip'], ['slip', 'slip'],
    ['clean', 'slip'], ['clean', 'slip'], ['clean', 'slip'], ['clean', 'slip'], ['slip', 'clean'],
    ['clean', null], ['slip', null],
  ]);
  await addGraded(page, seeded.pieces.Juno, [['clean', 'slip'], ['clean', 'slip'], ['clean', 'clean']]);

  await openGrownUps(page, `/parent/stats/${seeded.pieces.Pip}`);
  const block = page.locator('.shadow-stats');
  await expect(block).toContainText('19 of 20 plays graded so far');
  await expect(block).not.toContainText('%');

  await addGraded(page, seeded.pieces.Pip, [['clean', 'clean']]);
  await page.reload();
  await openGrownUps(page, `/parent/stats/${seeded.pieces.Pip}`);
  await expect(block).toContainText('You and Pip agreed on 15 of 20 plays (75%).');
  await expect(block).toContainText('Pip said clean, you said slip: 4');
  await expect(block).toContainText('Pip said slip, you said clean: 1');

  // Juno's page counts only hers, and is still short of 20.
  await page.getByRole('button', { name: 'Juno' }).tap();
  await expect(block).toContainText('3 of 20 plays graded so far');

  // The child's own stats never show any of it.
  await page.goto(`/#/stats/${seeded.pieces.Pip}`);
  await expect(page.getByRole('heading', { name: 'Time on each bar' })).toBeVisible();
  await expect(page.locator('.shadow-stats')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/shadow|agreed/i);
});

test('switching it off again stops the prompt, and the results stay for grown-ups', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await switchOn(page);
  await openTrainer(page, pieceId, seeded.bars[0]);
  await page.locator('.answer.clean').tap();
  await grade(page, 'Clean');

  await openGrownUps(page);
  await page.getByRole('checkbox', { name: 'Ask for my answer after each play on this tablet' }).uncheck();
  await expect.poll(async () => (await rows(page, 'meta')).find((m) => m.key === 'shadowGrade')?.value).toBe(false);
  await openTrainer(page, pieceId, seeded.bars[0]);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  await expect(prompt(page)).toHaveCount(0);
  expect((await attemptsFor(page, pieceId)).map((a) => a.shadow)).toEqual(['clean', null]);

  await openGrownUps(page, `/parent/stats/${pieceId}`);
  await expect(page.locator('.shadow-stats')).toContainText('1 of 20 plays graded so far');
});
