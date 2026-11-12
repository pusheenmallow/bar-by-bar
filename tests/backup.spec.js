// The backup file: version 2 goes out and comes back whole, and version 1 files still restore.
import { readFile } from 'node:fs/promises';
import { dayKey } from '../js/model.js';
import {
  test, expect, seedPiece, openTrainer, openGrownUps, exportBackup, restoreBackup, wipeDatabase, snapshot, counts,
  addRecording, attemptsFor, rows,
} from './helpers.js';

// A used tablet: a shared piece, some progress and a crown, plays of each kind, and a recording.
async function usedTablet(page) {
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  await addRecording(page, seeded.pieces.Pip);
  await page.evaluate(async ({ pieceId, barId }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const p = model.blankProgress(pieceId, barId);
    p.done.rh = Date.now() - 3 * 86400000;
    p.crowns.rh = Date.now() - 2 * 86400000;
    p.notes = [{ id: 'n1', who: 'teacher', text: 'Curved fingers here', at: Date.now() - 86400000 }];
    p.flagged = true;
    await store.put('progress', p);
  }, { pieceId: seeded.pieces.Juno, barId: seeded.bars[3] });

  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0]);
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  for (let i = 0; i < 3; i++) await page.locator('.answer.clean').tap();
  await expect(page.locator('.cheer')).toBeVisible();
  await page.goto(`/#/whole/${seeded.pieces.Juno}`);
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.getByRole('button', { name: 'Clean all the way' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  return seeded;
}

// What a file saved before the extra attempt fields looked like.
function asVersion1(backup, pieceId, barIds) {
  const day = 86400000;
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const old = noon.getTime() - 9 * day;
  return {
    ...backup,
    backupVersion: 1,
    attempts: [
      { id: 1, pieceId, barIds: [barIds[0]], stageId: 'rh', tempo: null, result: 'slip', tag: 'note', at: old },
      { id: 2, pieceId, barIds: [barIds[0]], stageId: 'rh', tempo: null, result: 'clean', tag: null, at: old + 60000 },
      { id: 3, pieceId, barIds: [barIds[0], barIds[1]], stageId: 'full', tempo: 96, result: 'clean', tag: null, at: old + day },
      { id: 7, pieceId, mode: 'piece', barIds, slipBars: [barIds[2]], stageId: null, tempo: null, result: 'slip', tag: null, at: old + 2 * day },
    ],
  };
}

test('a version 2 backup restores everything exactly', async ({ page }) => {
  const seeded = await usedTablet(page);
  await openGrownUps(page);
  const before = await snapshot(page);
  expect(counts(before)).toMatchObject({ players: 2, pieces: 2, pages: 1, recordings: 1, attempts: 5 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a backup file' }).tap();
  const file = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  await expect(page.locator('.toast')).toContainText('Backup saved');
  expect(file.backupVersion).toBe(2);
  expect(file.attempts).toHaveLength(5);
  for (const a of file.attempts) expect(a).toMatchObject({ day: dayKey(a.at), source: expect.stringMatching(/^(trainer|whole)$/) });

  await wipeDatabase(page);
  await page.goto('/');
  await restoreBackup(page, file);
  const after = await snapshot(page);
  delete before.stores.meta; delete after.stores.meta;          // the first holds "last backup", made after the file
  expect(after).toEqual(before);

  // And the restored app is usable: the shared piece opens with its progress and its recording.
  await page.goto(`/#/piece/${seeded.pieces.Juno}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await page.locator('.bar-hit').nth(3).tap();
  await expect(page.locator('.bar-sheet').getByRole('button', { name: 'Hear it' })).toBeVisible();
});

test('a version 1 backup restores, with the new attempt fields filled in', async ({ page }) => {
  const seeded = await usedTablet(page);
  const file = asVersion1(await exportBackup(page), seeded.pieces.Pip, seeded.bars);
  delete file.recordings;                                        // the oldest files have no recordings
  delete file.time;                                              // or practice time

  await wipeDatabase(page);
  await page.goto('/');
  await restoreBackup(page, file);
  const snap = await snapshot(page);
  expect(counts(snap)).toMatchObject({ players: 2, pieces: 2, pages: 1, progress: file.progress.length, attempts: 4, time: 0, recordings: 0 });

  const attempts = await attemptsFor(page, seeded.pieces.Pip);
  expect(attempts.map((a) => a.id)).toEqual([1, 2, 3, 7]);
  for (const a of attempts) {
    expect(a).toMatchObject({ day: dayKey(a.at), playerId: seeded.players.Pip, source: 'legacy', firstTryToday: null, warmUps: null, runGoal: null });
  }
  expect(attempts[0]).toMatchObject({ result: 'slip', tag: 'note', tempo: null, tempoSet: null, metronomeOn: null });
  expect(attempts[2]).toMatchObject({ tempo: 96, tempoSet: 96, metronomeOn: true });
  expect(attempts[3]).toMatchObject({ mode: 'piece', slipBars: [seeded.bars[2]] });
  expect(await rows(page, 'progress')).toEqual(file.progress);

  // Old and new plays sit together: stats opens, and a new play is saved beside the old ones.
  await page.goto(`/#/stats/${seeded.pieces.Pip}`);
  await page.getByRole('button', { name: 'All time' }).tap();
  await expect(page.locator('.tile', { hasText: 'Whole-piece plays' })).toContainText('1');
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0]);
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  const now = await attemptsFor(page, seeded.pieces.Pip);
  expect(now).toHaveLength(5);
  expect(now[4]).toMatchObject({ source: 'trainer', firstTryToday: true });
});

test('a file that is not a backup, or from a newer app, changes nothing', async ({ page }) => {
  await usedTablet(page);
  const good = await exportBackup(page);
  const before = await snapshot(page);

  await restoreBackup(page, 'not json at all', { expectToast: 'not a Bar by Bar backup' });
  await restoreBackup(page, { ...good, app: 'something-else' }, { expectToast: 'not a Bar by Bar backup' });
  await restoreBackup(page, { ...good, backupVersion: 3 }, { expectToast: 'newer version of Bar by Bar' });

  const after = await snapshot(page);
  delete before.stores.meta; delete after.stores.meta;          // choosing the PIN came in between
  expect(after).toEqual(before);
});
