// The teacher's corner: a PIN of the teacher's own that opens the assignment, the week and the
// recordings for each learner's piece, and nothing else.
import { test, expect, seedPiece, openGrownUps, typePin, rows } from './helpers.js';

const TEACHER = '1357';
const sheet = (page) => page.locator('.scrim:not(.leaving) .sheet');

async function setTeacherPin(page, pin = TEACHER) {
  await openGrownUps(page);
  await page.getByRole('button', { name: 'Set a teacher PIN' }).tap();
  await sheet(page).getByLabel('Teacher PIN', { exact: true }).fill(pin);
  await sheet(page).getByLabel('Teacher PIN again').fill(pin);
  await sheet(page).getByRole('button', { name: 'Save teacher PIN' }).tap();
}
async function lockAndGoHome(page) {
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();
}
async function unlockAsTeacher(page, path = '/parent') {
  await page.goto(`/#${path}`);
  await expect(page.locator('.keypad')).toBeVisible();
  await typePin(page, TEACHER);
  await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
}

test('a grown-up sets a teacher PIN, which must be four digits and not their own', async ({ page }) => {
  await seedPiece(page);
  await openGrownUps(page);
  await page.getByRole('button', { name: 'Set a teacher PIN' }).tap();
  const save = sheet(page).getByRole('button', { name: 'Save teacher PIN' });
  const fill = async (a, b = a) => {
    await sheet(page).getByLabel('Teacher PIN', { exact: true }).fill(a);
    await sheet(page).getByLabel('Teacher PIN again').fill(b);
    await save.tap();
  };
  await fill('12a4');
  await expect(page.locator('.toast').last()).toContainText('Use four digits.');
  await fill('1357', '1358');
  await expect(page.locator('.toast').last()).toContainText('did not match');
  const { PIN } = await import('./helpers.js');
  await fill(PIN);
  await expect(page.locator('.toast').last()).toContainText('different from the grown-up PIN');
  expect((await rows(page, 'meta')).some((m) => m.key === 'teacherPinHash' && m.value)).toBe(false);
  await fill(TEACHER);
  await expect(page.getByRole('button', { name: 'Change the teacher PIN' })).toBeVisible();
  const meta = await rows(page, 'meta');
  const saved = meta.find((m) => m.key === 'teacherPinHash').value;
  expect(saved).toMatch(/^[0-9a-f]{64}$/);                                  // kept as a hash, like the grown-up PIN
  expect(saved).not.toBe(meta.find((m) => m.key === 'pinHash').value);
});

test('the teacher PIN opens the Teacher screens and only those', async ({ page }) => {
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const pieceId = seeded.pieces.Pip;
  await page.evaluate(async (id) => {
    const store = await import('/js/store.js');
    const audio = await import('/js/audio.js');
    await store.put('takes', {
      id: crypto.randomUUID(), pieceId: id, playerId: null, at: Date.now(), day: (await import('/js/model.js')).dayKey(Date.now()), seconds: 1,
      tempo: null, bars: [1, 12], whole: true, slips: 0, mime: 'audio/wav', blob: audio.wavBlob(new Float32Array(12000).map((_, i) => 0.3 * Math.sin(i / 9))),
    });
  }, pieceId);
  await setTeacherPin(page);
  await lockAndGoHome(page);

  // The same lock the grown-ups use. With two PINs, the keypad says so.
  await page.locator('.name', { hasText: 'Pip' }).tap();
  await page.getByRole('button', { name: 'Grown-ups' }).tap();
  await expect(page.getByRole('heading', { name: 'Enter a PIN' })).toBeVisible();
  await typePin(page, TEACHER);
  await expect(page).toHaveURL(/#\/teacher$/);
  await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Pip');
  await expect(page.locator('main')).toContainText('Juno');
  await expect(page.locator('main')).not.toContainText(/Back up|Restore|Add a piece|Shadow|Players|Delete/);

  // The assignment, set there and then.
  await page.getByRole('button', { name: 'Assignment: Paper Boat Waltz, Pip' }).tap();
  await expect(page).toHaveURL(new RegExp(`#/teacher/assign/${pieceId}$`));
  await page.getByRole('textbox', { name: 'New bars this week' }).fill('5-8');
  await page.getByRole('textbox', { name: 'Bars to see every day' }).fill('2');
  await page.getByRole('button', { name: 'Save assignment' }).tap();
  await expect(page).toHaveURL(/#\/teacher$/);
  await expect(page.locator('.teacher-piece').first()).toContainText('Assignment set');
  expect(await rows(page, 'assignments')).toMatchObject([{ pieceId, bars: '5-8', pins: '2', status: 'current' }]);

  // The week, and the recordings, which the teacher can hear but not delete.
  await page.getByRole('button', { name: 'This week: Paper Boat Waltz, Pip' }).tap();
  await expect(page.getByRole('heading', { name: 'Summary for the teacher' })).toBeVisible();
  await expect(page.locator('.summary-lines')).toContainText('Recordings made');
  await page.getByRole('button', { name: 'Teacher', exact: true }).tap();
  await page.getByRole('button', { name: 'Recordings: Paper Boat Waltz, Pip' }).tap();
  await expect(page.getByRole('heading', { name: 'Pip’s recordings' })).toBeVisible();
  await expect(page.locator('.take-row')).toHaveCount(1);
  await expect(page.locator('.take-row').getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  // Grown-ups stays shut to the teacher: its screens ask for the PIN, and the teacher's doesn't open them.
  for (const path of ['/parent', `/parent/piece/${pieceId}`, `/parent/bars/${pieceId}`, '/parent/add', `/parent/takes/${pieceId}`]) {
    await page.goto(`/#${path}`);
    await expect(page.locator('.keypad')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/Back up|Delete this piece|Add a piece/);
  }
  await typePin(page, TEACHER);
  await expect(page).toHaveURL(/#\/teacher$/);                               // sent to the teacher's own screens, never let in

  // Done locks it. Coming back asks again.
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await page.goto('/#/teacher');
  await expect(page.locator('.keypad')).toBeVisible();
  await page.goto(`/#/teacher/assign/${pieceId}`);
  await expect(page.locator('.keypad')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'New bars this week' })).toHaveCount(0);
});

test('the grown-up PIN also opens the Teacher screens, and a removed teacher PIN stops working', async ({ page }) => {
  await seedPiece(page);
  await setTeacherPin(page);
  await lockAndGoHome(page);
  await page.goto('/#/teacher');
  await expect(page.locator('.keypad')).toBeVisible();
  await typePin(page);
  await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
  // Unlocked there as the teacher, not as a grown-up: Grown-ups still asks.
  await page.goto('/#/parent');
  await expect(page.locator('.keypad')).toBeVisible();

  await typePin(page);
  await page.getByRole('button', { name: 'Remove the teacher PIN' }).tap();
  await expect(page.getByRole('button', { name: 'Set a teacher PIN' })).toBeVisible();
  await lockAndGoHome(page);
  await page.goto('/#/parent');
  await expect(page.getByRole('heading', { name: 'Enter the grown-up PIN' })).toBeVisible();
  await typePin(page, TEACHER);
  await expect(page.locator('.toast')).toContainText('That PIN is not right.');
  await expect(page.locator('.keypad')).toBeVisible();
});

test('the teacher’s corner makes no request off the tablet', async ({ page }) => {
  const seeded = await seedPiece(page);
  await setTeacherPin(page);
  await lockAndGoHome(page);
  const outside = [];
  page.on('request', (r) => { if (!/^(http:\/\/(127\.0\.0\.1|localhost)|blob:|data:)/.test(r.url())) outside.push(r.url()); });
  await unlockAsTeacher(page);
  await page.getByRole('button', { name: /^Assignment:/ }).tap();
  await page.getByRole('textbox', { name: 'A note for the player' }).fill('Lovely tone today');
  await page.getByRole('button', { name: 'Save assignment' }).tap();
  await page.getByRole('button', { name: /^This week:/ }).tap();
  await expect(page.locator('.summary-lines')).toBeVisible();
  expect(outside).toEqual([]);
  expect(seeded.bars).toHaveLength(12);
});
