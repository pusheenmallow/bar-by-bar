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
