// An assignment as a small file, passed between tablets by hand.
import fs from 'node:fs';
import { assignmentEnvelope, readAssignmentEnvelope, blankAssignment, defaultStages } from '../js/model.js';
import { test, expect, seedPiece, openGrownUps, rows } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const at = (page, day) => page.clock.setFixedTime(new Date(`${day}T16:00:00+11:00`));

const makePiece = (n, more = {}) => {
  const ids = Array.from({ length: n }, (_, i) => `b${i + 1}`);
  return {
    id: 'p', playerId: 'made-up-player', title: 'Paper Boat Waltz', tempo: 100, stages: defaultStages(),
    layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: ids.map((_, i) => i / n).concat(1), bars: ids.map((id) => ({ id, skip: false })) }] }],
    ...more,
  };
};
const now = new Date('2026-11-14T12:00:00').getTime();

test('the round trip keeps every setting, and the file holds no names or ids', () => {
  const piece = makePiece(12);
  const a = { ...blankAssignment(piece), bars: '5-8', pins: '2', pinsDone: ['b2'], stageId: 'slow', tempo: 84, lessonDate: '2026-11-21', minutes: 20, note: 'Curved fingers' };
  const file = assignmentEnvelope(piece, a, now);
  expect(file).toMatchObject({ app: 'bar-by-bar', kind: 'assignment', envelopeVersion: 1, piece: { title: 'Paper Boat Waltz', bars: 12 } });
  const text = JSON.stringify(file);
  for (const secret of [a.id, 'made-up-player', 'pinsDone', 'playerId', 'pieceId']) expect(text).not.toContain(secret);

  const back = readAssignmentEnvelope(JSON.parse(text), piece, now);
  expect(back.warnings).toEqual([]);
  expect(back.fields).toEqual({ bars: '5-8', pins: '2', pinsDone: [], stageId: 'slow', tempo: 84, lessonDate: '2026-11-21', minutes: 20, note: 'Curved fingers' });
});

test('a file for a different piece still loads, and says what to look at', () => {
  const piece = makePiece(12);
  const other = makePiece(32, { title: 'Tin Drum March', tempo: 72, stages: [{ id: 'x1', name: 'Hands apart', pace: 'free' }, { id: 'x2', name: 'Together slow', pace: 'slow' }, { id: 'x3', name: 'Clean next day', pace: 'nextday' }] });
  const file = assignmentEnvelope(piece, { ...blankAssignment(piece), bars: '5-8', stageId: 'slow', lessonDate: '2026-11-10' }, now);
  const read = readAssignmentEnvelope(file, other, now);
  expect(read.fields.stageId).toBe('x2');                                                  // matched by its name
  expect(read.warnings).toEqual(['It was written for “Paper Boat Waltz”.', 'It was written for a piece of 12 bars. This one has 32.', 'The lesson date in it has passed.']);
  const odd = readAssignmentEnvelope({ ...file, assignment: { ...file.assignment, stageId: 'rh', stageName: 'Right hand', tempo: 900, minutes: 'lots', lessonDate: 'next Tuesday', note: 'x'.repeat(500) } }, other, now);
  expect(odd.fields).toMatchObject({ stageId: 'x2', tempo: 240, minutes: 15, lessonDate: '' });
  expect(odd.fields.note).toHaveLength(160);
  expect(odd.warnings[0]).toBe('“Right hand” isn’t a stage of this piece, so new bars go as far as Together slow.');
});

test('files that aren’t assignments are turned away in plain words', () => {
  const piece = makePiece(12);
  const good = assignmentEnvelope(piece, blankAssignment(piece), now);
  expect(() => readAssignmentEnvelope({ app: 'bar-by-bar', backupVersion: 4, players: [] }, piece)).toThrow('That is a backup file, not an assignment.');
  expect(() => readAssignmentEnvelope({ hello: 'there' }, piece)).toThrow('That file is not a Bar by Bar assignment.');
  expect(() => readAssignmentEnvelope(null, piece)).toThrow('That file is not a Bar by Bar assignment.');
  expect(() => readAssignmentEnvelope({ ...good, kind: 'progress' }, piece)).toThrow('That file is not a Bar by Bar assignment.');
  expect(() => readAssignmentEnvelope({ ...good, envelopeVersion: 2 }, piece)).toThrow('newer version of Bar by Bar');
});

test('saved from one learner’s form and loaded into another’s', async ({ page }) => {
  await page.goto('/');
  await at(page, '2026-11-14');
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });

  await openGrownUps(page, `/parent/assign/${seeded.pieces.Pip}`);
  await page.getByRole('textbox', { name: 'New bars this week' }).fill('5-8');
  await page.getByRole('textbox', { name: 'Bars to see every day' }).fill('2');
  await page.getByRole('combobox', { name: 'Take new bars as far as' }).selectOption({ label: 'Together slow' });
  await page.getByLabel('Next lesson').fill('2026-11-21');
  await page.getByRole('textbox', { name: 'A note for the player' }).fill('Curved fingers');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as a file' }).tap()]);
  expect(download.suggestedFilename()).toBe('bar-by-bar-assignment-2026-11-14.json');
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).not.toMatch(/Pip|Juno/);
  expect(text).not.toContain(seeded.pieces.Pip);
  expect(JSON.parse(text).assignment).toMatchObject({ bars: '5-8', pins: '2', stageName: 'Together slow', lessonDate: '2026-11-21', note: 'Curved fingers' });
  expect(await rows(page, 'assignments')).toEqual([]);                                     // saving a file doesn't save the assignment

  await page.getByRole('button', { name: 'Juno' }).tap();
  await expect(page.locator('.lead').first()).toHaveText('Paper Boat Waltz, for Juno');
  await page.getByLabel('Assignment file').setInputFiles({ name: 'from-teacher.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('.banner.loaded')).toHaveText('Loaded from the file. Check it, then tap Save assignment.');
  await expect(page.getByRole('textbox', { name: 'New bars this week' })).toHaveValue('5-8');
  await expect(page.getByRole('textbox', { name: 'Bars to see every day' })).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: 'Take new bars as far as' })).toHaveValue('slow');
  await expect(page.getByLabel('Next lesson')).toHaveValue('2026-11-21');
  await expect(page.getByRole('textbox', { name: 'A note for the player' })).toHaveValue('Curved fingers');
  expect(await rows(page, 'assignments')).toEqual([]);                                     // nothing is saved until Save is tapped
  await page.getByRole('button', { name: 'Save assignment' }).tap();
  await expect(page.getByRole('button', { name: 'This week’s assignment' })).toBeVisible();
  const saved = await rows(page, 'assignments');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ pieceId: seeded.pieces.Juno, playerId: seeded.players.Juno, status: 'current', bars: '5-8', pins: '2', stageId: 'slow', lessonDate: '2026-11-21', note: 'Curved fingers', pinsDone: [] });
});

test('loading the wrong kind of file changes nothing and says why', async ({ page }) => {
  const seeded = await seedPiece(page);
  await openGrownUps(page, `/parent/assign/${seeded.pieces.Pip}`);
  await page.getByRole('textbox', { name: 'New bars this week' }).fill('3-4');
  const load = (body) => page.getByLabel('Assignment file').setInputFiles({ name: 'file.json', mimeType: 'application/json', buffer: Buffer.from(body) });
  await load(JSON.stringify({ app: 'bar-by-bar', backupVersion: 4, players: [], pieces: [] }));
  await expect(page.locator('.toast')).toContainText('That is a backup file, not an assignment.');
  await load('not json at all');
  await expect(page.locator('.toast').last()).toContainText('That file is not a Bar by Bar assignment.');
  await expect(page.getByRole('textbox', { name: 'New bars this week' })).toHaveValue('3-4');
  await expect(page.locator('.banner.loaded')).toHaveCount(0);
});
