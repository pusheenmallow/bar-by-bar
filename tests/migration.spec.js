// Upgrades. Version 4 to 5 only adds two empty stores. The upgrade from database version 3 to 4: a backup first, then the attempts are re-keyed
// and nothing else changes. If anything goes wrong the database stays exactly as it was.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dayKey } from '../js/model.js';
import { test, expect, snapshot, counts, attemptsFor, openTrainer, seedPiece } from './helpers.js';
import { madeUpTablet, buildOldDatabase, saveUpgradeBackup } from './v3.js';

// The two stores version 5 adds start empty on every upgraded tablet.
const withNewStores = (c) => ({ ...c, schedule: 0, assignments: 0 });
const metaWithout = (snap, ...keys) => snap.stores.meta.rows.filter((row) => !keys.includes(row.key));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Everything but the attempts must be identical, row for row.
function expectOtherStoresUntouched(after, before) {
  for (const name of ['players', 'pieces', 'pages', 'progress', 'time', 'recordings']) {
    expect(after.stores[name], `the "${name}" store`).toEqual(before.stores[name]);
  }
  expect(metaWithout(after, 'lastBackup')).toEqual(metaWithout(before, 'lastBackup'));
}

test('a new tablet starts at version 5 with no backup step', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bar by Bar has an update' })).toHaveCount(0);
  const snap = await snapshot(page);
  expect(snap.version).toBe(5);
  expect(Object.keys(snap.stores)).toEqual(['assignments', 'attempts', 'meta', 'pages', 'pieces', 'players', 'progress', 'recordings', 'schedule', 'time']);
  expect(snap.stores.attempts).toMatchObject({ keyPath: 'id', autoIncrement: false, indexes: ['day', 'pieceId'] });
});

test('a version 3 tablet is backed up, then upgraded with nothing lost', async ({ page }) => {
  const tablet = await madeUpTablet(page);
  await buildOldDatabase(page, tablet);
  const before = await snapshot(page);
  expect(before.version).toBe(3);
  expect(before.stores.attempts).toMatchObject({ autoIncrement: true, indexes: ['pieceId'] });
  expect(counts(before)).toEqual({ meta: 3, players: 2, pieces: 3, pages: 2, progress: 7, attempts: 9, time: 3, recordings: 1 });

  // The app stops at the backup step. Until it is done, nothing is touched, even across a restart.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bar by Bar has an update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish the update' })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  const file = await saveUpgradeBackup(page, readFile);
  expect((await snapshot(page)).version).toBe(3);

  // The backup holds everything, and is a file this app can restore.
  expect(file).toMatchObject({ app: 'bar-by-bar', backupVersion: 3 });
  for (const name of ['players', 'pieces', 'pages', 'progress', 'attempts', 'time', 'recordings']) {
    expect(file[name], `"${name}" in the backup`).toHaveLength(before.stores[name].rows.length);
  }
  expect(file.attempts.map((a) => a.id)).toEqual([1, 2, 3, 5, 6, 9, 10, 14, 15]);

  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();
  await expect(page.locator('.name', { hasText: 'Juno' })).toBeVisible();

  const after = await snapshot(page);
  expect(after.version).toBe(5);
  expect(counts(after)).toEqual(withNewStores(counts(before)));
  expectOtherStoresUntouched(after, before);
  expect(after.stores.meta.rows.find((r) => r.key === 'lastBackup').value).toBeGreaterThan(before.stores.meta.rows.find((r) => r.key === 'lastBackup').value);

  // Attempts: the same rows under the same numbers, in a store that no longer numbers them itself.
  expect(after.stores.attempts).toMatchObject({ keyPath: 'id', autoIncrement: false, indexes: ['day', 'pieceId'] });
  const moved = new Map(after.stores.attempts.rows.map((a) => [a.id, a]));
  expect([...moved.keys()]).toEqual([1, 2, 3, 5, 6, 9, 10, 14, 15]);
  const owner = { 'piece-waltz-pip': 'player-pip', 'piece-waltz-juno': 'player-juno', 'piece-march-juno': 'player-juno' };
  for (const old of before.stores.attempts.rows) {
    const now = moved.get(old.id);
    expect(now, `attempt ${old.id} keeps everything it had`).toMatchObject(old);
    expect(now).toMatchObject({ day: dayKey(old.at), playerId: owner[old.pieceId] ?? null, source: old.source ?? 'legacy' });
  }
  expect(moved.get(3)).toMatchObject({ tempo: 108, tempoSet: 108, metronomeOn: true, firstTryToday: null, warmUps: null, runGoal: null });
  expect(moved.get(1)).toMatchObject({ tempo: null, tempoSet: null, metronomeOn: null });
  expect(moved.get(6)).toMatchObject({ mode: 'piece', slipBars: ['waltz-bar-02'] });
  expect(moved.get(14)).toMatchObject({ playerId: null, source: 'legacy' });                 // its piece was deleted long ago
  expect(moved.get(15)).toMatchObject({ source: 'trainer', firstTryToday: true, runGoal: 7 });   // already had the fields: left alone

  // Starting the app again goes straight in, and changes nothing more.
  await page.reload();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bar by Bar has an update' })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(after);
});

test('after the upgrade the app carries on: old progress shows and new plays get random ids', async ({ page }) => {
  await buildOldDatabase(page, await madeUpTablet(page));
  await page.goto('/');
  await saveUpgradeBackup(page);
  await page.getByRole('button', { name: 'Finish the update' }).tap();

  await page.locator('.name', { hasText: 'Pip' }).tap();
  await page.locator('.piece-row', { hasText: 'Paper Boat Waltz' }).tap();
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await page.locator('.bar-hit').first().tap();
  await expect(page.locator('.bar-sheet')).toContainText('Lift at the end of the slur');
  await expect(page.locator('.bar-sheet').getByRole('button', { name: 'Hear it' })).toBeVisible();

  await page.goto('/#/stats/piece-waltz-pip');
  await page.getByRole('button', { name: 'All time' }).tap();
  await expect(page.locator('.tile', { hasText: 'Whole-piece plays' })).toContainText('1');
  await expect(page.locator('.tile', { hasText: 'Clean tries' })).toContainText('60%');       // 3 clean of the 5 old plays

  await openTrainer(page, 'piece-waltz-pip', 'waltz-bar-03');
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.slot .sticker')).toHaveCount(1);
  const attempts = await attemptsFor(page, 'piece-waltz-pip');
  expect(attempts).toHaveLength(7);
  const fresh = attempts.slice(-2);
  expect(fresh.map((a) => a.result)).toEqual(['slip', 'clean']);
  for (const a of fresh) {
    expect(a.id).toMatch(UUID);
    expect(a).toMatchObject({ playerId: 'player-pip', source: 'trainer', day: dayKey(a.at) });
  }
  expect(fresh[0].firstTryToday).toBe(true);

  // Taking a learner off a shared piece still clears only their attempts, old and new alike.
  await page.evaluate(async () => (await import('/js/store.js')).removeLearner('piece-waltz-pip'));
  const left = (await snapshot(page)).stores.attempts.rows.map((a) => a.id);
  expect(left).toEqual([9, 10, 14, 15]);
});

for (const kind of ['an error thrown part-way', 'a row the new store refuses']) {
  test(`if the upgrade fails (${kind}), the version 3 data is untouched and it can be tried again`, async ({ page }) => {
    await page.addInitScript((kind) => {
      if (sessionStorage.getItem('break-upgrade') !== 'yes') return;
      const add = IDBObjectStore.prototype.add;
      let calls = 0;
      IDBObjectStore.prototype.add = function sabotaged(row) {
        calls += 1;
        if (this.name === 'attempts' && calls === 5) {
          if (kind === 'an error thrown part-way') throw new Error('Made-up failure in the middle of the copy');
          return add.call(this, { ...row, id: 1 });                    // a second attempt numbered 1
        }
        return add.call(this, row);
      };
    }, kind);

    await buildOldDatabase(page, await madeUpTablet(page));
    const before = await snapshot(page);
    await page.evaluate(() => sessionStorage.setItem('break-upgrade', 'yes'));

    await page.goto('/');
    await saveUpgradeBackup(page);
    await page.getByRole('button', { name: 'Finish the update' }).tap();
    await expect(page.getByRole('heading', { name: 'The update could not finish' })).toBeVisible();

    const failed = await snapshot(page);
    expect(failed.version).toBe(3);
    expect(failed.stores.attempts).toEqual(before.stores.attempts);       // rows, numbering and index all as they were
    expectOtherStoresUntouched(failed, before);

    await page.evaluate(() => sessionStorage.removeItem('break-upgrade'));
    await page.getByRole('button', { name: 'Try again' }).tap();
    await saveUpgradeBackup(page);
    await page.getByRole('button', { name: 'Finish the update' }).tap();
    await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();
    const after = await snapshot(page);
    expect(after.version).toBe(5);
    expect(counts(after)).toEqual(withNewStores(counts(before)));
    expectOtherStoresUntouched(after, before);
    expect(after.stores.attempts.rows.map((a) => a.id)).toEqual([1, 2, 3, 5, 6, 9, 10, 14, 15]);
  });
}

// The last version 3 app, straight from this repo's history, writes the data. Then today's app
// takes over at the same address. This checks the upgrade against what that app really stored.
test('data written by the version 3 app itself upgrades with nothing lost', async ({ page }) => {
  const V3_COMMIT = '39bd85d';
  const root = new URL('..', import.meta.url).pathname;
  const fromHistory = (path) => execFileSync('git', ['show', `${V3_COMMIT}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  let available = true;
  try { fromHistory('js/store.js'); } catch { available = false; }
  test.skip(!available, `Needs commit ${V3_COMMIT} in the git history.`);

  const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', webmanifest: 'application/manifest+json', woff2: 'font/woff2', png: 'image/png' };
  const serveOld = async (route) => {
    let path = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (path.startsWith('tests/')) return route.continue();
    try {
      await route.fulfill({ body: fromHistory(path), contentType: types[path.split('.').pop()] || 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  };
  await page.route('**/*', serveOld);

  await page.goto('/');
  expect(await page.evaluate(async () => (await fetch('/js/store.js')).text())).toContain('const VERSION = 3;');
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  await openTrainer(page, seeded.pieces.Pip, seeded.bars[0], 'rh', 7);
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  for (let i = 0; i < 7; i++) await page.locator('.answer.clean').tap();          // a crown
  await expect(page.locator('.cheer.crowned')).toBeVisible();
  await page.goto(`/#/whole/${seeded.pieces.Juno}`);
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.getByRole('button', { name: 'Clean all the way' }).tap();
  await expect(page.locator('.finish-body')).toBeVisible();
  await page.goto('/tests/blank.html');
  const before = await snapshot(page);
  expect(before.version).toBe(3);
  expect(before.stores.attempts.rows.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(before.stores.attempts.rows[0]).not.toHaveProperty('day');
  expect(before.stores.progress.rows.some((p) => p.crowns?.rh)).toBe(true);

  await page.unroute('**/*', serveOld);
  await page.goto('/');
  await saveUpgradeBackup(page);
  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();

  const after = await snapshot(page);
  expect(after.version).toBe(5);
  expect(counts(after)).toEqual(withNewStores({ ...counts(before), meta: counts(before).meta + 1 }));       // plus the time of the backup
  expectOtherStoresUntouched(after, before);
  expect(after.stores.attempts).toMatchObject({ keyPath: 'id', autoIncrement: false, indexes: ['day', 'pieceId'] });
  after.stores.attempts.rows.forEach((now, i) => {
    const old = before.stores.attempts.rows[i];
    expect(now).toMatchObject(old);
    expect(now).toMatchObject({ day: dayKey(old.at), source: 'legacy', playerId: old.pieceId === seeded.pieces.Pip ? seeded.players.Pip : seeded.players.Juno });
  });

  await page.goto(`/#/piece/${seeded.pieces.Pip}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await page.locator('.bar-hit').first().tap();
  await expect(page.locator('.bar-sheet')).toBeVisible();
});

test('a tablet still on version 2 upgrades too, gaining the stores it lacked', async ({ page }) => {
  const tablet = await madeUpTablet(page);
  for (const piece of tablet.pieces) delete piece.recording;
  await buildOldDatabase(page, tablet, { version: 2 });
  const before = await snapshot(page);
  expect(Object.keys(before.stores)).not.toContain('recordings');

  await page.goto('/');
  const file = await saveUpgradeBackup(page, readFile);
  expect(file.recordings).toEqual([]);
  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('.name', { hasText: 'Juno' })).toBeVisible();

  const after = await snapshot(page);
  expect(after.version).toBe(5);
  expect(after.stores.recordings.rows).toEqual([]);
  for (const name of ['players', 'pieces', 'pages', 'progress', 'time']) expect(after.stores[name]).toEqual(before.stores[name]);
  expect(after.stores.attempts.rows.map((a) => a.id)).toEqual([1, 2, 3, 5, 6, 9, 10, 14, 15]);
});

test('a version 4 tablet is backed up, then gains an empty schedule and assignments with nothing else touched', async ({ page }) => {
  const tablet = await madeUpTablet(page);
  // As the version 4 app left them: every attempt with its day, player and source.
  tablet.attempts = tablet.attempts.map((a) => ({ ...a, day: dayKey(a.at), playerId: tablet.pieces.find((p) => p.id === a.pieceId)?.playerId ?? null, source: 'legacy' }));
  await buildOldDatabase(page, tablet, { version: 4 });
  const before = await snapshot(page);
  expect(before.version).toBe(4);
  expect(Object.keys(before.stores)).not.toContain('schedule');

  await page.goto('/');
  const file = await saveUpgradeBackup(page, readFile);
  expect(file).toMatchObject({ app: 'bar-by-bar', backupVersion: 3, schedule: [], assignments: [] });
  expect((await snapshot(page)).version).toBe(4);                          // nothing changes until the backup is saved
  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();

  const after = await snapshot(page);
  expect(after.version).toBe(5);
  expectOtherStoresUntouched(after, before);
  expect(after.stores.attempts).toEqual(before.stores.attempts);
  expect(after.stores.schedule).toMatchObject({ keyPath: 'key', indexes: ['pieceId'], rows: [] });
  expect(after.stores.assignments).toMatchObject({ keyPath: 'id', indexes: ['pieceId'], rows: [] });

  // Opening the app again asks for nothing more.
  await page.reload();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bar by Bar has an update' })).toHaveCount(0);
});

test('an upgraded tablet and a new one end up with the same database shape', async ({ page, browser }) => {
  await buildOldDatabase(page, await madeUpTablet(page));
  await page.goto('/');
  await saveUpgradeBackup(page);
  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('.name', { hasText: 'Pip' })).toBeVisible();
  const upgraded = await snapshot(page);

  const other = await browser.newContext({ baseURL: new URL(page.url()).origin, serviceWorkers: 'block' });
  const fresh = await other.newPage();
  await seedPiece(fresh);
  const made = await snapshot(fresh);
  await other.close();

  const shape = (snap) => Object.fromEntries(Object.entries(snap.stores).map(([name, s]) => [name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: s.indexes }]));
  expect(shape(upgraded)).toEqual(shape(made));
  expect(upgraded.version).toBe(made.version);
});

// For one's own tablet. Run with REAL_BACKUP_PATH=/path/to/backup.json. The file is put into a
// version 3 database and upgraded. Only counts and fingerprints are compared or printed, never
// what is in it, and it must stay outside the repo.
test('a real backup upgrades with every count unchanged (only with REAL_BACKUP_PATH)', async ({ page }) => {
  test.skip(!process.env.REAL_BACKUP_PATH, 'Set REAL_BACKUP_PATH to a backup file to run this.');
  test.setTimeout(300_000);
  const print = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  const fingerprints = (snap, names) => Object.fromEntries(names.map((name) => [name, print(snap.stores[name]?.rows ?? [])]));
  const unchanged = ['players', 'pieces', 'pages', 'progress', 'time', 'recordings'];

  await buildOldDatabase(page, { file: process.env.REAL_BACKUP_PATH });
  const before = await snapshot(page);
  await page.goto('/');
  const file = await saveUpgradeBackup(page, readFile);
  await page.getByRole('button', { name: 'Finish the update' }).tap();
  await expect(page.locator('main:not(.upgrade)')).toBeVisible({ timeout: 120_000 });
  const after = await snapshot(page);

  console.log('rows before the upgrade:', JSON.stringify(counts(before)));
  console.log('rows after the upgrade: ', JSON.stringify(counts(after)));
  const tally = (snap) => ({ ...counts(snap), meta: metaWithout(snap, 'lastBackup').length });     // the backup step notes its own time
  expect(after.version).toBe(5);
  expect(tally(after)).toEqual(withNewStores(tally(before)));
  expect(print(metaWithout(after, 'lastBackup'))).toBe(print(metaWithout(before, 'lastBackup')));
  expect(fingerprints(after, unchanged)).toEqual(fingerprints(before, unchanged));
  expect(print(after.stores.attempts.rows.map((a) => a.id))).toBe(print(before.stores.attempts.rows.map((a) => a.id)));
  const same = before.stores.attempts.rows.every((old, i) => Object.entries(old)
    .every(([key, value]) => JSON.stringify(after.stores.attempts.rows[i][key]) === JSON.stringify(value)));
  expect(same, 'every attempt keeps what it had').toBe(true);
  expect(after.stores.attempts.rows.every((a) => a.day && a.source), 'every attempt has a day and a source').toBe(true);
  expect(counts({ stores: Object.fromEntries(['players', 'pieces', 'pages', 'progress', 'attempts'].map((n) => [n, { rows: file[n] }])) }))
    .toEqual(Object.fromEntries(['players', 'pieces', 'pages', 'progress', 'attempts'].map((n) => [n, before.stores[n].rows.length])));
});
