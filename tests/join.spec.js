// After a slip marked "Stuck between bars", the next play can take in the bar that follows.
import { test, expect, seedPiece, openTrainer, attemptsFor } from './helpers.js';

test('a join slip offers this bar with the next one, and keeps the stickers', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  const [one, two] = seeded.bars;
  await openTrainer(page, pieceId, one);
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();

  // Another kind of slip makes no such offer.
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.coach .fix')).toBeVisible();
  await expect(page.locator('.coach').getByRole('button', { name: /together/ })).toHaveCount(0);
  await page.locator('.answer.clean').tap();

  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Stuck between bars' }).tap();
  const offer = page.locator('.coach').getByRole('button', { name: 'Play bars 1 to 2 together' });
  await expect(offer).toBeVisible();
  await expect(page.locator('.train-top h1')).toHaveText('Bar 1');           // only an offer: nothing changes by itself
  await offer.tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bars 1 to 2');
  await expect(offer).toHaveCount(0);
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(1);    // 2, slip, 1 more, slip: one left, none taken by the change

  await page.locator('.answer.clean').tap();
  const plays = await attemptsFor(page, pieceId);
  expect(plays.at(-2)).toMatchObject({ result: 'slip', tag: 'join', barIds: [one] });
  expect(plays.at(-1)).toMatchObject({ result: 'clean', barIds: [one, two] });
});

test('the last bar of the piece has no next bar to offer', async ({ page }) => {
  const seeded = await seedPiece(page);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars.at(-1));
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Stuck between bars' }).tap();
  await expect(page.locator('.coach .fix')).toBeVisible();
  await expect(page.locator('.coach').getByRole('button', { name: /together/ })).toHaveCount(0);
});
