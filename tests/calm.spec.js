// The calm rules: nothing is counted "in a row", the player sees no minutes, a slip makes no
// sound, and nothing pops up while someone is in the middle of playing.
import { test, expect, seedPiece, openTrainer, openGrownUps, finishStagesYesterday } from './helpers.js';

// Counts every sound the app starts, by counting the oscillators it makes.
const countSounds = (page) => page.addInitScript(() => {
  window.soundsMade = 0;
  const make = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (...args) { window.soundsMade += 1; return make.apply(this, args); };
});
const sounds = (page) => page.evaluate(() => window.soundsMade);

test('stickers are counted as stickers, not "in a row", wherever the count is described', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;

  await page.goto(`/#/piece/${pieceId}`);
  await page.locator('.bar-hit').first().tap();
  await page.getByRole('button', { name: 'Practise bar 1' }).tap();
  const sheet = page.locator('.scrim:not(.leaving) .sheet');
  await expect(sheet.locator('.pick-label')).toHaveText('How many stickers?');
  await expect(sheet.locator('.pick-say')).toHaveText('3 stickers colour it in. A slip takes one off.');
  await sheet.getByRole('button', { name: /Solid/ }).tap();
  await expect(sheet.locator('.pick-say')).toHaveText('7 stickers make it solid. A slip takes one off.');
  await expect(sheet).not.toContainText(/in a row/i);
  await sheet.getByRole('button', { name: 'Start' }).tap();

  await expect(page.locator('.run-label')).toHaveText('7 stickers to make it solid');
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.getByRole('img', { name: '2 of 7 stickers' })).toBeVisible();
  await page.locator('.answer.slip').tap();                                 // one comes off; the count doesn't start again
  await expect(page.getByRole('img', { name: '1 of 7 stickers' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/clean in a row/i);

  await openTrainer(page, pieceId, seeded.bars[1]);
  await expect(page.locator('.run-label')).toHaveText('3 stickers to colour it in');
  for (let i = 0; i < 3; i++) await page.locator('.answer.clean').tap();
  await expect(page.locator('.scrim:not(.leaving) .sheet')).toContainText('Bar 2 is coloured in.');
  await expect(page.locator('.scrim:not(.leaving) .sheet')).not.toContainText(/in a row|crown/i);

  await openGrownUps(page, `/parent/piece/${pieceId}`);
  await expect(page.getByRole('group', { name: 'Stickers to colour in' })).toBeVisible();
  await expect(page.locator('main')).toContainText('A clean play adds a sticker and a slip takes one off');
  await expect(page.locator('main')).not.toContainText(/wins a crown|Clean in a row/);
});

test('the player sees a bar that fills, and no minutes or countdown', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await page.evaluate(async ({ pieceId, barId }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    await store.addTime(pieceId, model.dayKey(Date.now()), 'bar', [barId], 240);
  }, { pieceId, barId: seeded.bars[0] });
  const noNumbers = /\d:\d\d|to go|\bmin\b|\bsec\b|today/;

  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await expect(page.locator('.clock .clock-fill')).toHaveAttribute('style', /width: 40%/);
  await expect(page.locator('.clock')).not.toContainText(noNumbers);
  await expect(page.locator('.clock-text')).toHaveText('');

  await openTrainer(page, pieceId, seeded.bars[0]);
  await expect(page.locator('.clock .clock-fill')).toBeVisible();
  await expect(page.locator('.clock')).not.toContainText(noNumbers);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.clock')).not.toContainText(noNumbers);

  await page.goto(`/#/whole/${pieceId}`);
  await expect(page.getByRole('button', { name: 'Start playing' })).toBeVisible();
  await expect(page.locator('.clock')).not.toContainText(noNumbers);

  await finishStagesYesterday(page, pieceId, [seeded.bars[4]]);
  await page.goto(`/#/check/${pieceId}`);
  await expect(page.locator('.answer.clean')).toBeVisible();
  await expect(page.locator('.clock')).not.toContainText(noNumbers);

  // Grown-ups still get the minutes, on their own view of the bars.
  await openGrownUps(page, `/parent/bars/${pieceId}`);
  await expect(page.locator('.clock')).toContainText('4 min of 10 min today');
});

test('a slip is silent and its sticker fades where it is; a clean play still has its sound', async ({ page }) => {
  await countSounds(page);
  const seeded = await seedPiece(page);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0]);
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(2);
  const before = await sounds(page);
  expect(before).toBeGreaterThan(0);

  await page.locator('.answer.slip').tap();
  const leaving = page.locator('.slot .sticker.peel');
  await expect(leaving).toHaveCount(1);
  expect(await leaving.evaluate((el) => getComputedStyle(el).animationName)).toBe('peel');
  const frames = await page.evaluate(() => [...document.styleSheets].flatMap((s) => [...s.cssRules])
    .find((r) => r.type === CSSRule.KEYFRAMES_RULE && r.name === 'peel').cssText);
  expect(frames).toContain('opacity');
  expect(frames).not.toMatch(/transform|scale|translate/);                   // it doesn't move, it only fades
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(1);
  expect(await sounds(page)).toBe(before);                                  // no sound for the slip or its reason

  // Nothing about a slip is drawn in the warning colour.
  const danger = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('.coach *, .answer.slip, .slots *')].some((el) => {
      const s = getComputedStyle(el);
      return s.color === colour || s.backgroundColor === colour || s.borderTopColor === colour;
    });
  });
  expect(danger).toBe(false);

  await page.locator('.answer.clean').tap();
  expect(await sounds(page)).toBeGreaterThan(before);
});

test('reaching the day’s time is only said at the next tap, never in the middle of playing', async ({ page }) => {
  await page.goto('/');
  await page.clock.install({ time: new Date('2026-11-14T16:00:00') });
  await countSounds(page);
  await page.reload();
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await page.evaluate(async ({ pieceId, barId }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    await store.addTime(pieceId, model.dayKey(Date.now()), 'bar', [barId], 595);      // five seconds short of ten minutes
  }, { pieceId, barId: seeded.bars[0] });

  await openTrainer(page, pieceId, seeded.bars[0]);
  await page.clock.runFor(20_000);                                          // playing: the goal passes with no tap
  await expect(page.locator('.clock')).toHaveClass(/reached/);              // the bar is full, quietly
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await sounds(page)).toBe(0);

  await page.locator('.answer.slip').tap();                                 // the play is over
  await expect(page.locator('.toast')).toContainText('That’s today’s time done.');
  expect(await sounds(page)).toBe(0);                                       // said in words only
});
