// Shared steps for the tests. Everything here is made up: invented names, a drawn page of
// music and generated sound. Nothing from a real tablet belongs in this folder.
import { test as base, expect } from '@playwright/test';

export { expect };

// Every test fails on an uncaught error or a console error from the app.
export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon/.test(msg.text())) problems.push(`console error: ${msg.text()}`);
    });
    await use(page);
    expect(problems, 'errors while the app ran').toEqual([]);
  },
});

export const PIN = '2468';

// A drawn page of piano music: `systems` rows of two staves, `barsPerRow` bars in each.
export async function scorePng(page, { systems = 3, barsPerRow = 4 } = {}) {
  const dataUrl = await page.evaluate(({ systems, barsPerRow }) => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#000'; g.fillStyle = '#000';
    const left = 110, right = 1130, gap = 14;
    for (let s = 0; s < systems; s++) {
      const top = 220 + s * 430;
      const staffTops = [top, top + 150];
      g.lineWidth = 2;
      for (const y0 of staffTops) {
        for (let l = 0; l < 5; l++) {
          g.beginPath(); g.moveTo(left, y0 + l * gap); g.lineTo(right, y0 + l * gap); g.stroke();
        }
      }
      const bottom = staffTops[1] + 4 * gap;
      g.lineWidth = 3;
      for (let b = 0; b <= barsPerRow; b++) {
        const x = left + ((right - left) * b) / barsPerRow;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke();
      }
      // A few note heads and stems, so the page isn't only lines.
      for (let b = 0; b < barsPerRow; b++) {
        for (let n = 0; n < 4; n++) {
          const x = left + ((right - left) * (b + (n + 0.6) / 4.4)) / barsPerRow;
          for (const y0 of staffTops) {
            const y = y0 + gap * (1 + ((b + n + s) % 3));
            g.beginPath(); g.ellipse(x, y, 8, 6, -0.3, 0, Math.PI * 2); g.fill();
            g.lineWidth = 2; g.beginPath(); g.moveTo(x + 7, y); g.lineTo(x + 7, y - 44); g.stroke();
          }
        }
      }
    }
    return c.toDataURL('image/png');
  }, { systems, barsPerRow });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

export async function typePin(page, digits = PIN) {
  for (const d of digits) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).tap();
}

// Into Grown-ups. The first visit chooses the PIN, later visits enter it.
// Grown-ups locks again whenever the app leaves its screens, so only a move inside it skips the PIN.
export async function openGrownUps(page, path = '/parent') {
  const inside = await page.evaluate(() => location.hash.startsWith('#/parent') && !document.querySelector('.keypad')).catch(() => false);
  await page.goto(`/#${path}`);
  if (inside) return;
  const keypad = page.locator('.keypad');
  await expect(keypad).toBeVisible();
  const choosing = await page.getByRole('heading', { name: 'Choose a 4-digit PIN' }).count();
  await typePin(page);
  if (choosing) {
    await expect(page.getByRole('heading', { name: 'Enter it once more' })).toBeVisible();
    await typePin(page);
  }
  await expect(keypad).toHaveCount(0);
}

const openSheet = (page) => page.locator('.scrim:not(.leaving) .sheet');

export async function addPlayer(page, name) {
  await page.getByRole('button', { name: 'Add a player' }).tap();
  await openSheet(page).locator('input[type=text]').fill(name);
  await openSheet(page).getByRole('button', { name: 'Add player' }).tap();
  await expect(page.locator('.list-row', { hasText: name })).toBeVisible();
}

/* ---------- data put straight into the app's database ---------- */

// Adds players and one piece without going through the screens, using the app's own bar finder
// on the drawn page. `learners` are player names; more than one makes it a shared piece.
// Returns { players: { name: id }, pieces: { name: pieceId }, bars: [barId...], stages: [stageId...] }.
export async function seedPiece(page, { learners = ['Pip'], title = 'Paper Boat Waltz', tempo = 100 } = {}) {
  if (!page.url().startsWith('http')) await page.goto('/');
  const png = (await scorePng(page)).toString('base64');
  return page.evaluate(async ({ learners, title, tempo, png }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const { findBars } = await import('/js/detect-client.js');
    const { blankPiece } = await import('/js/screens/add.js');

    const known = await store.all('players');
    const players = {};
    for (const [i, name] of learners.entries()) {
      const existing = known.find((p) => p.name === name);
      const player = existing || { id: model.newId(), name, pen: model.PLAYER_PENS[i % model.PLAYER_PENS.length], createdAt: Date.now() + i };
      if (!existing) await store.put('players', player);
      players[name] = player.id;
    }

    const image = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const found = await findBars(image);
    const piece = { ...blankPiece(players[learners[0]]), title, tempo, beats: 3 };
    delete piece.draft;
    const pageId = model.newId();
    await store.put('pages', { id: pageId, pieceId: piece.id, blob: found.blob, width: found.width, height: found.height });
    piece.layout.push({ pageId, width: found.width, height: found.height, rows: model.rowsToLayoutRows(found.rows) });
    await store.savePiece(piece);

    const pieces = { [learners[0]]: piece.id };
    for (const name of learners.slice(1)) pieces[name] = (await store.addLearner(piece, players[name])).id;
    return { players, pieces, bars: model.playableBars(piece).map((b) => b.id), stages: piece.stages.map((s) => s.id) };
  }, { learners, title, tempo, png });
}

// Everything in one of the app's stores, once any saves still on their way have landed.
export async function rows(page, storeName) {
  return page.evaluate(async (name) => {
    const store = await import('/js/store.js');
    await store.attemptsSaved?.();
    await store.timeSaved();
    return store.all(name);
  }, storeName);
}

export async function attemptsFor(page, pieceId) {
  return (await rows(page, 'attempts')).filter((a) => a.pieceId === pieceId).sort((a, b) => a.at - b.at);
}

// Marks bars as having finished every practice stage on an earlier day, so the next-day check is ready.
export async function finishStagesYesterday(page, pieceId, barIds) {
  await page.evaluate(async ({ pieceId, barIds }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const yesterday = Date.now() - 26 * 3600 * 1000;
    for (const barId of barIds) {
      const p = model.blankProgress(pieceId, barId);
      for (const s of model.practiceStages(piece)) p.done[s.id] = yesterday;
      await store.put('progress', p);
    }
  }, { pieceId, barIds });
}

export async function openTrainer(page, pieceId, barIds, stageId = 'rh', goal = 3) {
  await page.goto(`/#/train/${pieceId}/${[].concat(barIds).join(',')}/${stageId}/${goal}`);
  await expect(page.locator('.answer.clean')).toBeVisible();
}
