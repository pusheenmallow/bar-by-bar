import { test, expect, openGrownUps, addPlayer, scorePng } from './helpers.js';

test('the app loads, and a grown-up can add a player and a piece', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Bar by Bar/);

  await openGrownUps(page);
  await expect(page.getByRole('heading', { name: 'Grown-ups' })).toBeVisible();
  await addPlayer(page, 'Pip');

  await page.getByRole('button', { name: 'Add a piece' }).tap();
  await page.locator('.field', { hasText: 'Name of the piece' }).locator('input').fill('Paper Boat Waltz');
  await expect(page.getByRole('group', { name: 'Who is learning it' }).getByRole('checkbox', { name: 'Pip' })).toBeChecked();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: await scorePng(page) });
  await expect(page.locator('.page-row')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.page-row')).toContainText('12 bars in 3 rows');

  await page.getByRole('button', { name: 'Check the boxes' }).tap();
  await expect(page.locator('.r-bar')).toHaveCount(12);
  await page.getByRole('button', { name: 'Save piece' }).tap();
  await expect(page.locator('.score')).toBeVisible();

  // The player finds the piece on their own screen.
  await page.goto('/#/');
  await page.locator('.name', { hasText: 'Pip' }).tap();
  await expect(page.locator('.piece-row')).toContainText('Paper Boat Waltz');
  await page.locator('.piece-row').tap();
  await expect(page.locator('.bar-hit')).toHaveCount(12);
});
