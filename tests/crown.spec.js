// Gold is the only crown: a bar that was still clean on a later day. Crowns won under the old
// rules (the long run in one sitting) are kept, and show as a solid colour instead.
import { barStep, blankProgress, defaultStages, hasGold, solidStages } from '../js/model.js';
import { test, expect, seedPiece, finishStagesYesterday } from './helpers.js';

const piece = { id: 'p', stages: defaultStages() };
const prog = (more) => ({ ...blankProgress('p', 'b'), ...more });

test('a bar steps through none, started, good, solid and gold', () => {
  expect(barStep(piece, undefined)).toBe('none');
  expect(barStep(piece, prog())).toBe('none');
  expect(barStep(piece, prog({ slips: 1 }))).toBe('started');
  expect(barStep(piece, prog({ clean: 2, done: { rh: 1 } }))).toBe('good');
  expect(barStep(piece, prog({ done: { rh: 1 }, crowns: { rh: 1 } }))).toBe('solid');
  // Solid follows the furthest stage reached: an old crown lower down stays on that stage's line.
  expect(barStep(piece, prog({ done: { rh: 1, lh: 2 }, crowns: { rh: 1 } }))).toBe('good');
  expect(solidStages(piece, prog({ done: { rh: 1, lh: 2 }, crowns: { rh: 1 } })).map((s) => s.id)).toEqual(['rh']);
  // An old crown is never a gold crown, however many there are.
  const all = Object.fromEntries(defaultStages().filter((s) => s.pace !== 'nextday').map((s) => [s.id, 1]));
  expect(hasGold(piece, prog({ done: all, crowns: all }))).toBe(false);
  expect(barStep(piece, prog({ done: { ...all, next: 5 }, crowns: all }))).toBe('gold');
});

// Progress saved the way the old rules saved it: stage crowns, and no next-day pass.
async function oldCrowns(page, pieceId, barId, stages) {
  await page.evaluate(async ({ pieceId, barId, stages }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const p = model.blankProgress(pieceId, barId);
    const then = Date.now() - 5 * 86400000;
    for (const s of stages) { p.done[s] = then; p.crowns[s] = then; }
    p.clean = 9;
    await store.put('progress', p);
  }, { pieceId, barId, stages });
}

test('crowns from the old rules show as solid, with no crown and no crown count', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await oldCrowns(page, pieceId, seeded.bars[0], ['rh']);
  await oldCrowns(page, pieceId, seeded.bars[1], ['rh', 'lh']);

  await page.goto(`/#/piece/${pieceId}`);
  const bars = page.locator('.bar-hit');
  await expect(bars).toHaveCount(12);
  await expect(bars.nth(0)).toHaveAttribute('data-step', 'solid');
  await expect(bars.nth(0)).toHaveAttribute('aria-label', /solid for Right hand/);
  await expect(bars.nth(1)).toHaveAttribute('aria-label', /solid for Right hand and Left hand/);
  await expect(bars.nth(2)).toHaveAttribute('data-step', 'none');
  await expect(page.locator('.crown-art')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/crown/i);
  await expect(page.locator('.tray')).toContainText('2 of 12');

  // The saved crowns are still there, untouched.
  const saved = await page.evaluate(async (key) => (await import('/js/store.js')).get('progress', key), `${pieceId}|${seeded.bars[1]}`);
  expect(Object.keys(saved.crowns).sort()).toEqual(['lh', 'rh']);

  // The stage picker says Solid in words, and offers no crown.
  await bars.nth(0).tap();
  await page.getByRole('button', { name: 'Practise bar 1' }).tap();
  const sheet = page.locator('.scrim:not(.leaving) .sheet');
  await expect(sheet.locator('.stage-row', { hasText: 'Right hand' })).toContainText('Solid');
  await expect(sheet).not.toContainText(/crown/i);
  await expect(sheet.locator('.crown-art')).toHaveCount(0);
});

test('the long run makes a bar solid, with no crown anywhere', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await page.goto(`/#/train/${pieceId}/${seeded.bars[0]}/rh/7`);
  await expect(page.locator('.answer.clean')).toBeVisible();
  await expect(page.locator('main .crown-art')).toHaveCount(0);
  for (let i = 0; i < 7; i++) await page.locator('.answer.clean').tap();
  const sheet = page.locator('.scrim:not(.leaving) .sheet');
  await expect(sheet.getByRole('heading', { name: 'Solid!' })).toBeVisible();
  await expect(sheet).toContainText('Bar 1 is solid now.');
  await expect(sheet).not.toContainText(/crown|master/i);
  await expect(page.locator('.crown-art')).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Back to my piece' }).tap();
  await expect(page.locator('.bar-hit').first()).toHaveAttribute('data-step', 'solid');
  await expect(page.locator('.crown-art')).toHaveCount(0);
});

test('a fresh next-day pass shows a gold crown, which shimmers once', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two] = seeded.bars;
  await oldCrowns(page, pieceId, seeded.bars[5], ['rh']);
  await finishStagesYesterday(page, pieceId, [one, two]);

  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await expect(page.locator('.mark.crown')).toHaveCount(0);

  await page.getByRole('button', { name: 'Start check' }).tap();
  await expect(page.getByRole('heading', { name: 'Bars 1 to 2' })).toBeVisible();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toContainText('2 bars stuck');
  await expect(page.locator('.finish-body .crown-art')).toHaveCount(0);        // the crown is drawn on the score only
  await page.getByRole('button', { name: 'Back to my piece' }).tap();

  const bars = page.locator('.bar-hit');
  await expect(bars.nth(0)).toHaveAttribute('data-step', 'gold');
  await expect(bars.nth(0)).toHaveAttribute('aria-label', /gold crown/);
  await expect(page.locator('.mark.crown')).toHaveCount(2);
  await expect(page.locator('.mark.crown.shimmer')).toHaveCount(2);
  await expect(bars.nth(5).locator('.mark.crown')).toHaveCount(0);            // old crown: solid, not gold
  await expect(page.locator('.tray')).not.toContainText(/crown/i);

  // Next time the score is shown the crowns are simply there.
  await page.goto('/#/');
  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.mark.crown')).toHaveCount(2);
  await expect(page.locator('.mark.crown.shimmer')).toHaveCount(0);
});

test('grown-ups mark a stage solid with a word, not a crown', async ({ page }) => {
  const { openGrownUps } = await import('./helpers.js');
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openGrownUps(page, `/parent/bars/${pieceId}`);
  await page.locator('.bar-hit').first().tap();
  const sheet = page.locator('.scrim:not(.leaving) .sheet');
  await sheet.getByRole('button', { name: 'Solid for Right hand on this bar' }).tap();
  await expect(sheet.getByRole('button', { name: 'Solid for Right hand on this bar' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.crown-art')).toHaveCount(0);
  await expect(page.locator('.bar-hit').first()).toHaveAttribute('data-step', 'solid');
});
