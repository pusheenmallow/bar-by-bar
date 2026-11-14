// The learner's own recordings: made with the tablet's microphone (a pretend one here), kept on
// the tablet, and never shared with the others who learn the same music.
import { thenAndNow, agoText } from '../js/model.js';
import { test, expect, seedPiece, openGrownUps, rows } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const at = (page, day, time = '16:00:00') => page.clock.setFixedTime(new Date(`${day}T${time}+11:00`));

test('then and now needs a first recording three weeks older than the latest', () => {
  const take = (id, day) => ({ id, day, at: new Date(`${day}T12:00:00`).getTime() });
  expect(thenAndNow([])).toBe(null);
  expect(thenAndNow([take('a', '2026-11-01')])).toBe(null);
  expect(thenAndNow([take('a', '2026-11-01'), take('b', '2026-11-21')])).toBe(null);                 // twenty days
  expect(thenAndNow([take('b', '2026-11-22'), take('a', '2026-11-01'), take('m', '2026-11-10')])).toMatchObject({ then: { id: 'a' }, now: { id: 'b' } });
  expect(agoText('2026-11-22', '2026-11-22')).toBe('Today');
  expect(agoText('2026-11-21', '2026-11-22')).toBe('Yesterday');
  expect(agoText('2026-11-12', '2026-11-22')).toBe('10 days ago');
  expect(agoText('2026-11-01', '2026-11-22')).toBe('3 weeks ago');
  expect(agoText('2026-08-01', '2026-11-22')).toBe('3 months ago');
});

// A short made-up recording put straight into the database, as if made on an earlier day.
async function oldTake(page, pieceId, day) {
  await page.evaluate(async ({ pieceId, day }) => {
    const store = await import('/js/store.js');
    const audio = await import('/js/audio.js');
    const pcm = new Float32Array(audio.RATE / 2).map((_, i) => 0.3 * Math.sin(i / 9));
    await store.put('takes', {
      id: crypto.randomUUID(), pieceId, playerId: null, at: new Date(`${day}T16:00:00+11:00`).getTime(), day, seconds: 1,
      tempo: null, bars: [1, 12], whole: true, slips: 0, mime: 'audio/wav', blob: audio.wavBlob(pcm),
    });
  }, { pieceId, day });
}

async function playWhole(page, pieceId, { record }) {
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();
  await page.goto(`/#/whole/${pieceId}`);
  const toggle = page.getByRole('button', { name: 'Record this play' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');             // off every time: recording is asked for, never assumed
  if (record) {
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await expect(page.getByRole('button', { name: 'Finished' })).toBeVisible();
  await page.waitForTimeout(1500);                                          // long enough for the pretend microphone to give some sound
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.getByRole('button', { name: 'Clean all the way' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
}

test('a play is recorded only when asked, and the take is kept with its sound', async ({ page }) => {
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const pieceId = seeded.pieces.Pip;

  await playWhole(page, pieceId, { record: false });
  expect(await rows(page, 'takes')).toEqual([]);
  await expect(page.getByRole('button', { name: 'Hear it back' })).toHaveCount(0);

  await playWhole(page, pieceId, { record: true });
  const saved = await rows(page, 'takes');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ pieceId, playerId: seeded.players.Pip, bars: [1, 12], whole: true, slips: 0, tempo: null });
  const sound = await page.evaluate(async () => {
    const [take] = await (await import('/js/store.js')).all('takes');
    const decoded = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(await take.blob.arrayBuffer());
    return { size: take.blob.size, type: take.blob.type, mime: take.mime, seconds: decoded.duration };
  });
  expect(sound.size).toBeGreaterThan(500);
  expect(sound.type).toContain('opus');                                     // small, compressed sound
  expect(sound.mime).toBe(sound.type);
  expect(sound.seconds).toBeGreaterThan(0.5);

  // Heard back straight away, and from the score afterwards.
  await page.getByRole('button', { name: 'Hear it back' }).tap();
  await expect(page.getByRole('heading', { name: 'My recordings' })).toBeVisible();
  const row = page.locator('.take-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Today');
  await expect(row).toContainText('Whole piece');
  await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);  // not the player's to delete
  await expect(page.getByRole('region', { name: 'Then and now' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Play' }).tap();
  await expect(row.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Play' }).tap();                    // tapping again stops it
  await expect(row.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');

  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.getByRole('button', { name: 'My recordings' })).toBeVisible();

  // The others who learn this music have none of it: not now, and not when someone new is added.
  await page.goto(`/#/piece/${seeded.pieces.Juno}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'My recordings' })).toHaveCount(0);
  const added = await page.evaluate(async (id) => {
    const store = await import('/js/store.js');
    const player = { id: 'made-up-third', name: 'Wren', pen: 'sky', createdAt: Date.now() };
    await store.put('players', player);
    const piece = await store.get('pieces', id);
    const copy = await store.addLearner(piece, player.id);
    await store.savePiece(await store.get('pieces', id));                   // saving the shared piece copies settings, not takes
    return { copy: copy.id, theirs: (await store.takesFor(copy.id)).length, all: (await store.all('takes')).map((t) => t.pieceId) };
  }, pieceId);
  expect(added.theirs).toBe(0);
  expect(added.all).toEqual([pieceId]);

  // Taking Pip off the piece takes Pip's recordings too, and no one else's.
  await oldTake(page, seeded.pieces.Juno, '2026-10-01');
  await page.evaluate(async (id) => (await import('/js/store.js')).removeLearner(id), pieceId);
  expect((await rows(page, 'takes')).map((t) => t.pieceId)).toEqual([seeded.pieces.Juno]);
});

test('leaving part-way through a recorded play keeps nothing', async ({ page }) => {
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await page.goto(`/#/whole/${pieceId}`);
  await page.getByRole('button', { name: 'Record this play' }).tap();
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await expect(page.getByRole('button', { name: 'Finished' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'My piece' }).tap();
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  expect(await rows(page, 'takes')).toEqual([]);
});

test('then and now appears once there is an early recording to compare, and the player chooses what to hear', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-14');
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await oldTake(page, pieceId, '2026-10-10');
  await oldTake(page, pieceId, '2026-11-02');
  await oldTake(page, pieceId, '2026-11-13');

  await page.goto(`/#/piece/${pieceId}`);
  await page.getByRole('button', { name: 'My recordings' }).tap();
  await expect(page.locator('.take-row .take-when')).toHaveText(['Yesterday', '12 days ago', '5 weeks ago']);
  const pair = page.getByRole('region', { name: 'Then and now' });
  const then = pair.getByRole('button', { name: 'Then: 5 weeks ago' });
  const now = pair.getByRole('button', { name: 'Now: yesterday' });
  await expect(then).toHaveAttribute('aria-pressed', 'false');              // nothing plays by itself
  await expect(now).toHaveAttribute('aria-pressed', 'false');
  await then.tap();
  await expect(then).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.take-row').nth(2).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true');      // the same recording, lit in the list too
  await now.tap();                                                          // one sound at a time
  await expect(now).toHaveAttribute('aria-pressed', 'true');
  await expect(then).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('main')).not.toContainText(/\d{4}|\d:\d\d|score|slips?\b/i);
});

test('a grown-up can delete a recording; the player cannot', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-14');
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await oldTake(page, pieceId, '2026-11-02');
  await oldTake(page, pieceId, '2026-11-13');
  await openGrownUps(page, `/parent/piece/${pieceId}`);
  await page.getByRole('button', { name: 'Recordings' }).tap();
  await expect(page.getByRole('heading', { name: 'Pip’s recordings' })).toBeVisible();
  await page.locator('.take-row', { hasText: '12 days ago' }).getByRole('button', { name: 'Delete' }).tap();
  await page.locator('.scrim:not(.leaving) .sheet').getByRole('button', { name: 'Delete' }).tap();
  await expect(page.locator('.take-row')).toHaveCount(1);
  expect((await rows(page, 'takes')).map((t) => t.day)).toEqual(['2026-11-13']);
});
