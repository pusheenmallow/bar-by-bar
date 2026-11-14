// A mistake means slow down, never a penalty: an offer at two slips in a row, an automatic notch
// down at three, and a step back up after two clean plays.
import { freshRun, afterClean, afterSlip, slowAfterSlips, fasterAfterCleans, handsOnSpeed, easierTempo } from '../js/model.js';
import { test, expect, seedPiece, openTrainer, attemptsFor } from './helpers.js';

// Plays a string of marks through the same steps the trainer takes. 's' is a slip, 'c' a clean play.
function play(marks, start = 100) {
  let run = freshRun(), tempo = start;
  const speeds = [];
  for (const mark of marks) {
    if (mark === 's') {
      ({ run, tempo } = slowAfterSlips(afterSlip(run), tempo));
    } else {
      ({ run, tempo } = fasterAfterCleans(afterClean(run, tempo), tempo));
    }
    speeds.push(tempo);
  }
  return { run, tempo, speeds };
}

test('the step logic: down one notch at three slips, back up after two clean plays', () => {
  const notch = easierTempo(100);
  expect(notch).toBe(90);
  expect(play('ss').speeds).toEqual([100, 100]);                            // two slips only offer
  expect(play('sss').speeds).toEqual([100, 100, 90]);
  expect(play('sssc').speeds.at(-1)).toBe(90);                              // one clean play isn't enough
  expect(play('ssscc').speeds).toEqual([100, 100, 90, 90, 100]);
  expect(play('ssscc').run.slowed).toEqual([]);

  // A clean play in between means it was never three in a row.
  expect(play('sscss').tempo).toBe(100);
  // A slip while slowed doesn't undo the clean play already made there.
  expect(play('ssscsc').tempo).toBe(100);
  // Three more slips while slowed go one more notch, and each pair of clean plays climbs one back.
  const twice = play('ssssss');
  expect(twice.tempo).toBe(easierTempo(90));
  expect(twice.run.slowed).toEqual([100, 90]);
  expect(play('sssssscc').tempo).toBe(90);
  expect(play('sssssscccc').tempo).toBe(100);

  // Stickers are never lost to the speed changing: only the usual one per slip.
  const kept = play('cccssscc');
  expect(kept.run.tokens).toBe(2);
  expect(kept.run.speed).toBe(100);                                         // so the step up doesn't restart the count

  // At the slowest speed there is nowhere to go, and nothing breaks.
  expect(play('sss', 30)).toMatchObject({ tempo: 30, run: { slowed: [], slipsInRow: 0 } });
  // Setting the speed by hand lets go of the automatic steps.
  expect(handsOnSpeed(play('sss').run)).toMatchObject({ slowed: [], cleanSlow: 0 });
});

const slipWith = async (page, reason = 'Rhythm') => {
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: reason }).tap();
};

test('three slips in a row slow the metronome by itself, and two clean plays bring it back', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await openTrainer(page, pieceId, seeded.bars[0], 'slow', 7);
  await page.getByRole('button', { name: 'Metronome' }).tap();
  const speed = page.locator('.tempo-value');
  const coach = page.locator('.coach');
  await expect(speed).toHaveText('66');                                     // slow speed is 65% of 100, on an even number

  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();

  await slipWith(page);
  await expect(coach.getByRole('button', { name: /Slow down to/ })).toHaveCount(0);
  await slipWith(page);
  await expect(coach).toContainText('Two slips in a row. Make it easier:');   // the offer that was already there
  await expect(speed).toHaveText('66');
  await page.locator('.answer.slip').tap();
  await expect(speed).toHaveText('60');                                     // the third slip: one notch, without asking
  await expect(coach).toContainText('Let’s take it slower for a bit: 60.');
  await expect(coach).toContainText('What happened?');                      // the usual question is still there
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await expect(coach.locator('.fix')).toBeVisible();
  await expect(coach).toContainText('Let’s take it slower for a bit: 60.');

  await page.locator('.answer.clean').tap();
  await expect(coach).toHaveText('Slower worked. Clean at 60%. One more like that.');
  await expect(speed).toHaveText('60');
  await page.locator('.answer.clean').tap();
  await expect(coach).toHaveText('Slower worked. Clean at 60%. Back up to 66 now.');
  await expect(speed).toHaveText('66');

  // Four stickers, three slips, two more: three left. The speed changes took none.
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(3);
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(4);
  await expect(coach).toContainText('Hands together, slowly.');             // back to the ordinary hint

  // What was saved shows the speeds that were really set.
  const plays = await attemptsFor(page, pieceId);
  expect(plays.map((a) => `${a.result[0]}${a.tempoSet}`).join(' ')).toBe('c66 c66 c66 c66 s66 s66 s66 c60 c60 c66');
});

test('with the metronome off the slow-down is still said, without a number it can’t know', async ({ page }) => {
  const seeded = await seedPiece(page);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0], 'rh');
  const coach = page.locator('.coach');
  for (let i = 0; i < 3; i++) await page.locator('.answer.slip').tap();
  await expect(coach).toContainText('Let’s take it slower for a bit.');
  await expect(coach).not.toContainText('%');
  await page.locator('.answer.clean').tap();
  await expect(coach).toHaveText('Slower worked. One more like that.');
  await page.locator('.answer.clean').tap();
  await expect(coach).toContainText('Slower worked. Back up to');
});

test('changing the speed by hand lets go of the automatic steps', async ({ page }) => {
  const seeded = await seedPiece(page);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0], 'slow');
  await page.getByRole('button', { name: 'Metronome' }).tap();
  for (let i = 0; i < 3; i++) await page.locator('.answer.slip').tap();
  await expect(page.locator('.tempo-value')).toHaveText('60');
  await page.getByRole('button', { name: 'Slower', exact: true }).tap();
  await expect(page.locator('.tempo-value')).toHaveText('58');
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.tempo-value')).toHaveText('58');              // it stays where the player put it
});

test('taking the offer to slow down gets the same kind word on the next clean play', async ({ page }) => {
  const seeded = await seedPiece(page);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0], 'slow');
  await page.getByRole('button', { name: 'Metronome' }).tap();
  await slipWith(page);
  await slipWith(page);
  await page.locator('.coach').getByRole('button', { name: 'Slow down to 60' }).tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.coach')).toHaveText('Slower worked. Clean at 60%.');
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.tempo-value')).toHaveText('60');              // a chosen speed isn't stepped back up
});

test('at a full-speed stage, a slow-down never hands out the last sticker', async ({ page }) => {
  const seeded = await seedPiece(page);
  await page.evaluate(async (id) => {
    const store = await import('/js/store.js');
    const piece = await store.get('pieces', id);
    piece.cleanTarget = 2;
    await store.savePiece(piece);
  }, seeded.pieces.Pip);
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0], 'full', 2);
  await page.getByRole('button', { name: 'Metronome' }).tap();
  await expect(page.locator('.tempo-value')).toHaveText('100');
  for (let i = 0; i < 3; i++) await page.locator('.answer.slip').tap();
  await expect(page.locator('.tempo-value')).toHaveText('90');
  await page.locator('.answer.clean').tap();
  await page.locator('.answer.clean').tap();                                // back to 100, one sticker, not finished
  await expect(page.locator('.tempo-value')).toHaveText('100');
  await expect(page.locator('.slot .sticker:not(.peel)')).toHaveCount(1);
  await expect(page.locator('.scrim')).toHaveCount(0);
  await page.locator('.answer.clean').tap();                                // the last one is at full speed
  await expect(page.locator('.scrim:not(.leaving) .sheet')).toContainText('Together full speed done!');
});
