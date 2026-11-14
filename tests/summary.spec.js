// The week on one card for the teacher, as text and as a picture a grown-up can save.
import fs from 'node:fs';
import { teacherSummary, defaultStages, blankProgress, blankSchedule, blankAssignment } from '../js/model.js';
import { test, expect, seedPiece, openGrownUps } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const at = (page, day) => page.clock.setFixedTime(new Date(`${day}T16:00:00+11:00`));

const ids = Array.from({ length: 12 }, (_, i) => `b${i + 1}`);
const piece = {
  id: 'p', playerId: 'pl', title: 'Paper Boat Waltz', tempo: 100, stages: defaultStages(),
  layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: ids.map((_, i) => i / 12).concat(1), bars: ids.map((id) => ({ id, skip: false })) }] }],
};
const when = (day) => new Date(`${day}T12:00:00`).getTime();
const TODAY = '2026-11-14';

test('the summary says what a teacher wants to know, and leaves out what didn’t happen', () => {
  const progress = new Map(), schedule = new Map();
  const all = (day) => ({ rh: 1, lh: 1, melody: 1, slow: 1, full: when(day) });
  progress.set('b1', { ...blankProgress('p', 'b1'), done: { ...all('2026-10-20'), next: when('2026-10-22') } });       // long learned
  progress.set('b2', { ...blankProgress('p', 'b2'), done: { ...all('2026-11-05'), next: when('2026-11-10') } });       // gold this week
  progress.set('b3', { ...blankProgress('p', 'b3'), done: all('2026-11-09') });                                        // learned this week
  progress.set('b4', { ...blankProgress('p', 'b4'), done: all('2026-11-12') });
  progress.set('b9', { ...blankProgress('p', 'b9'), done: { ...all('2026-10-01'), next: 1 } });
  schedule.set('b9', { ...blankSchedule('p', 'b9'), lapses: 3, kept: true, lastDay: '2026-11-13', dueDay: '2026-11-14' });
  schedule.set('b1', { ...blankSchedule('p', 'b1'), lapses: 2, kept: true, lastDay: '2026-11-01', dueDay: '2026-12-01' });
  const play = (day, more) => ({ day, at: when(day), barIds: [], metronomeOn: false, tempoSet: null, ...more });
  const attempts = [
    play('2026-11-10', { source: 'check', result: 'clean', barIds: ['b2', 'b1'] }),
    play('2026-11-12', { source: 'check', result: 'slip', barIds: ['b9'] }),
    play('2026-11-13', { source: 'check', result: 'clean', barIds: ['b9'] }),                    // clean later, but it did slip this week
    play('2026-11-06', { source: 'check', result: 'slip', barIds: ['b5'] }),                     // last week: not counted
    play('2026-11-04', { source: 'whole', result: 'clean', metronomeOn: true, tempoSet: 76 }),
    play('2026-11-11', { source: 'whole', result: 'slip', metronomeOn: true, tempoSet: 84 }),
    play('2026-11-13', { source: 'whole', result: 'clean', metronomeOn: false, tempoSet: 120 }), // the dial, not a speed played to
  ];
  const days = new Map([
    ['2026-11-07', { seconds: 900, plays: 3, stops: false }],                                    // eight days ago: outside the week
    ['2026-11-08', { seconds: 400, plays: 3, stops: false }],
    ['2026-11-11', { seconds: 120, plays: 2, stops: true }],
    ['2026-11-13', { seconds: 200, plays: 2, stops: false }],
  ]);
  const seconds = new Map([['2026-11-07', 900], ['2026-11-08', 400], ['2026-11-11', 100], ['2026-11-13', 200]]);
  const assignment = { ...blankAssignment(piece), pins: '9, 12', lessonDate: '2026-11-18' };
  const takes = [{ day: '2026-11-12' }, { day: '2026-10-01' }];
  const s = teacherSummary({ piece, person: { name: 'Pip' }, progress, schedule, attempts, seconds, days, target: 4, assignment, takes, now: when(TODAY) });

  expect(s.title).toBe('Paper Boat Waltz');
  expect(s.sub).toMatch(/^Pip, Sun,? 8 Nov to Sat,? 14 Nov$/);
  expect(s.lines).toEqual([
    { label: 'Practice', text: '2 of 4 days, 12 min on this piece' },
    { label: 'Learned this week', text: 'Bars 3, 4' },
    { label: 'Still clean on a later day, for the first time', text: 'Bar 2' },
    { label: 'Checks', text: '2 bars clean, bar 9 slipped' },
    { label: 'Stuck (missed 3 or more checks)', text: 'Bar 9' },
    { label: 'Still pinned', text: 'Bars 9, 12' },
    { label: 'Play-through', text: '♩ = 84 (last week 76), 2 plays' },
    { label: 'Recordings made', text: '1, on the tablet' },
  ]);
  expect(s).toMatchObject({ practised: 2, learned: [3, 4], gold: [2], slipped: [9], stuck: [9], runTempo: 84, runTempoBefore: 76, recorded: 1 });

  // A week with nothing in it says so plainly, in one line.
  const empty = teacherSummary({ piece, progress: new Map(), now: when(TODAY) });
  expect(empty.lines).toEqual([{ label: 'Practice', text: 'No practice on this piece this week' }]);
  expect(empty.sub).not.toContain('undefined');
  // Play-throughs without the metronome give no speed.
  const quiet = teacherSummary({ piece, progress: new Map(), attempts: [play('2026-11-13', { source: 'whole', result: 'clean' })], now: when(TODAY) });
  expect(quiet.lines.at(-1)).toEqual({ label: 'Play-through', text: '1 play, without the metronome' });
});

test('a grown-up sees the week and saves it as a picture', async ({ page }) => {
  await page.goto('/');
  await at(page, TODAY);
  const seeded = await seedPiece(page, { learners: ['Pip', 'Juno'] });
  const pieceId = seeded.pieces.Pip;
  await page.evaluate(async ({ pieceId, bars }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const day = (n) => model.dayKey(Date.now() - n * 86400000);
    const then = Date.now() - 2 * 86400000;
    for (const barId of bars.slice(0, 2)) await store.put('progress', { ...model.blankProgress(pieceId, barId), done: Object.fromEntries(model.practiceStages(piece).map((s) => [s.id, then])) });
    await store.addTime(pieceId, day(1), 'bar', [bars[0]], 420);
    await store.addTime(pieceId, day(3), 'bar', [bars[0]], 360);
    await store.addAttempt(piece, { barIds: bars, source: 'whole', result: 'clean', metronomeOn: true, tempoSet: 72, at: then });
    await store.attemptsSaved();
  }, { pieceId, bars: seeded.bars });

  await openGrownUps(page, `/parent/piece/${pieceId}`);
  await page.getByRole('button', { name: 'Summary for the teacher' }).tap();
  await expect(page.getByRole('heading', { name: 'Summary for the teacher' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paper Boat Waltz' })).toBeVisible();
  const lines = page.locator('.summary-lines');
  await expect(lines).toContainText('2 of 4 days, 13 min on this piece');
  await expect(lines).toContainText('Bars 1, 2');
  await expect(lines).toContainText('♩ = 72, 1 play');

  const size = await page.locator('canvas.summary-card').evaluate((c) => ({ w: c.width, h: c.height, ink: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].some((v, i) => i % 4 === 0 && v < 80) }));
  expect(size.w).toBe(1080);
  expect(size.h).toBeGreaterThan(400);
  expect(size.ink).toBe(true);                                              // there is writing on it

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as a picture' }).tap()]);
  expect(download.suggestedFilename()).toBe(`bar-by-bar-week-${TODAY}.png`);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');     // a PNG
  expect(bytes.length).toBeGreaterThan(5000);

  // The other learner's week is their own.
  await page.getByRole('button', { name: 'Juno' }).tap();
  await expect(page.locator('.summary-lines')).toContainText('No practice on this piece this week');
  await expect(page.locator('.lead').first()).toContainText('Juno,');
});

test('the summary is behind the PIN, and making it calls nothing outside the tablet', async ({ page }) => {
  const seeded = await seedPiece(page);
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('http://localhost') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) outside.push(r.url()); });
  await page.goto(`/#/parent/summary/${seeded.pieces.Pip}`);
  await expect(page.locator('.keypad')).toBeVisible();
  await expect(page.locator('.summary-lines')).toHaveCount(0);
  await openGrownUps(page, `/parent/summary/${seeded.pieces.Pip}`);
  await expect(page.locator('.summary-lines')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as a picture' }).tap()]);
  await download.path();
  expect(outside).toEqual([]);
});
