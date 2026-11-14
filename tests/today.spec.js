// Today's practice: a short queue of stops behind one button.
import { sessionPlan, processSentence, defaultStages, blankProgress, blankSchedule, blankAssignment } from '../js/model.js';
import { test, expect, seedPiece, attemptsFor, rows } from './helpers.js';

test.use({ timezoneId: 'Australia/Sydney' });
const TODAY = '2026-11-16';
const at = (page, day = TODAY, time = '16:00:00') => page.clock.setFixedTime(new Date(`${day}T${time}+11:00`));

/* ---------- the plan, as rules ---------- */

const ids = Array.from({ length: 24 }, (_, i) => `b${i + 1}`);
const piece = {
  id: 'p', playerId: 'pl', tempo: 100, cleanTarget: 3, stages: defaultStages(),
  layout: [{ pageId: 'pg', rows: [{ top: 0, bottom: 1, lines: ids.map((_, i) => i / 24).concat(1), bars: ids.map((id) => ({ id, skip: false })) }] }],
};
const now = new Date(`${TODAY}T12:00:00`).getTime();
const learned = { rh: 1, lh: 1, melody: 1, slow: 1, full: 1 };
// Bars given as numbers: `gold` are safely learned, `due` are ready for a check, `started` have only the first stage.
function state({ gold = [], due = [], started = [] } = {}) {
  const progress = new Map(), schedule = new Map();
  for (const n of gold) {
    progress.set(`b${n}`, { ...blankProgress('p', `b${n}`), done: { ...learned, next: 1 } });
    schedule.set(`b${n}`, { ...blankSchedule('p', `b${n}`), step: 5, kept: true, lastDay: '2026-11-10', dueDay: '2026-12-20' });
  }
  for (const n of due) {
    progress.set(`b${n}`, { ...blankProgress('p', `b${n}`), done: { ...learned, next: 1 } });
    schedule.set(`b${n}`, { ...blankSchedule('p', `b${n}`), step: 2, kept: true, lastDay: '2026-11-12', dueDay: '2026-11-14' });
  }
  for (const n of started) progress.set(`b${n}`, { ...blankProgress('p', `b${n}`), done: { rh: 1 } });
  return { progress, schedule };
}
const plan = (st, more = {}) => sessionPlan({ piece, now, ...st, ...more });
const shape = (p) => p.stops.map((s) => `${s.kind}:${s.size}`).join(' ');

test('an ordinary session: warm-up and checks, two new bars, the join, then a play-through', () => {
  const p = plan(state({ gold: [1, 2], due: [3, 5], started: [6] }));
  expect(shape(p)).toBe('review:3 new:1 new:1 join:1 run:1');                // two checks and a warm-up count as three stops
  expect(p.total).toBe(7);
  expect(p).toMatchObject({ warm: true, reviewCap: 8, minutes: 15, note: '' });
  expect(p.stops.map((s) => s.label)).toEqual([
    '2 checks', 'bar 4, right hand', 'bar 6, left hand', 'bars 3 to 4 together', 'bars 1 to 6, all the way through',
  ]);
  expect(p.stops.map((s) => s.path)).toEqual(['/check/p', '/train/p/b4/rh/3', '/train/p/b6/lh/3', '/train/p/b3,b4/rh/3', '/whole/p/1/6']);
});

test('the caps: eight checks in a session, four when short, and never more than two new bars', () => {
  const many = state({ gold: [1], due: [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23] });
  expect(plan(many).stops[0]).toMatchObject({ kind: 'review', size: 9, label: '8 checks' });
  expect(plan(many).stops.filter((s) => s.kind === 'new')).toHaveLength(2);
  expect(shape(plan(many, { quick: true }))).toBe('review:4');               // quick: no warm-up, nothing new, no play-through
  expect(shape(plan(many, { back: true }))).toBe('review:5');                // back after a gap: a warm-up and four checks
});

test('short sessions with nothing to check still have one stop', () => {
  expect(shape(plan(state(), { quick: true }))).toBe('new:1');
  expect(shape(plan(state({ gold: [1, 2, 3] }), { back: true }))).toBe('run:1');           // nothing new on the first day back
  expect(shape(plan(state(), { back: true }))).toBe('new:1');                              // unless nothing has been learned at all
  expect(shape(plan(state()))).toBe('new:1 new:1 run:1');                                  // a brand-new piece
  const all = state({ gold: ids.map((_, i) => i + 1) });
  expect(plan(all).stops.map((s) => s.path)).toEqual(['/whole/p']);                        // all learned, none due: just play it
});

test('the assignment sets what is new and how far; pins and the note come through', () => {
  const st = state({ gold: [1, 2], started: [9] });
  const a = { ...blankAssignment(piece), bars: '9-12', stageId: 'lh', minutes: 25, note: '  Curved fingers  ', pins: '2, 20' };
  const p = plan(st, { assignment: a });
  // Bar 20 is pinned but not learned yet, so it goes first and is taken as a new bar. Bar 2 is pinned and learned: a check.
  expect(p.stops.map((s) => s.label)).toEqual([
    '1 check', 'bar 20, right hand', 'bar 9, left hand', 'bars 1 to 20, all the way through',
  ]);
  expect(p).toMatchObject({ minutes: 25, note: 'Curved fingers' });
  // Past the target stage, an assigned bar is no longer new.
  st.progress.get('b9').done.lh = 1;
  expect(plan(st, { assignment: { ...a, pins: '' } }).stops.filter((s) => s.kind === 'new').map((s) => s.label)).toEqual(['bar 10, right hand', 'bar 11, right hand']);
  // An assignment that is finished with changes nothing.
  expect(shape(plan(st, { assignment: { ...a, status: 'done' } }))).toBe(shape(plan(st)));
});

test('the end-of-session sentence names what was done, most telling first', () => {
  const play = (n, result, more = {}) => ({ source: 'trainer', barIds: [`b${n}`], result, at: more.at ?? 0, metronomeOn: false, tempoSet: 66, ...more });
  expect(processSentence(piece, [])).toBe('You did every stop today.');
  expect(processSentence(piece, [], { finished: false })).toBe('You turned up and practised today.');
  expect(processSentence(piece, [play(3, 'clean', { at: 1 })])).toBe('You did every stop today.');
  expect(processSentence(piece, [{ source: 'check', barIds: ['b7', 'b5'], result: 'clean', at: 1 }])).toBe('Bars 5 to 7 were still clean on the first try.');
  expect(processSentence(piece, [{ source: 'check', barIds: ['b7'], result: 'clean', at: 1 }])).toBe('Bar 7 was still clean on the first try.');
  const wentBack = [play(12, 'slip', { at: 1 }), play(12, 'clean', { at: 2 }), { source: 'check', barIds: ['b7'], result: 'clean', at: 3 }];
  expect(processSentence(piece, wentBack)).toBe('You went back to bar 12, and then it was clean.');
  expect(processSentence(piece, [play(12, 'clean', { at: 1 }), play(12, 'slip', { at: 2 })])).toBe('You did every stop today.');     // clean first isn't "going back"
  const slower = [
    play(12, 'slip', { at: 1, metronomeOn: true, tempoSet: 80 }), play(12, 'clean', { at: 2, metronomeOn: true, tempoSet: 72 }),
    play(4, 'slip', { at: 3 }), play(4, 'clean', { at: 4 }),
  ];
  expect(processSentence(piece, slower)).toBe('Slower worked on bar 12: clean at 72.');
  for (const text of [processSentence(piece, wentBack), processSentence(piece, slower)]) expect(text).not.toMatch(/you are|clever|talent|best|\d+ ?(min|points)/i);
});

/* ---------- the screens ---------- */

// The made-up piece in the app, set up the same way as `state` above.
async function setUp(page, pieceId, bars, { gold = [], due = [], started = [] }) {
  await page.evaluate(async ({ pieceId, bars, gold, due, started }) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    const piece = await store.get('pieces', pieceId);
    const then = Date.now() - 6 * 86400000;
    const all = Object.fromEntries(piece.stages.map((s) => [s.id, then]));
    for (const n of [...gold, ...due]) {
      const barId = bars[n - 1];
      await store.put('progress', { ...model.blankProgress(pieceId, barId), done: { ...all } });
      const far = gold.includes(n);
      await store.put('schedule', { ...model.blankSchedule(pieceId, barId), step: far ? 5 : 2, kept: true, lastDay: model.dayKey(then), dueDay: far ? '2026-12-25' : model.dayKey(Date.now() - 86400000) });
    }
    for (const n of started) await store.put('progress', { ...model.blankProgress(pieceId, bars[n - 1]), done: { rh: then } });
  }, { pieceId, bars, gold, due, started });
}
const practisedOn = (page, pieceId, day, seconds = 600) => page.evaluate(async ({ pieceId, day, seconds }) => {
  const store = await import('/js/store.js');
  const model = await import('/js/model.js');
  await store.addTime(pieceId, day, 'bar', [model.playableBars(await store.get('pieces', pieceId))[0].id], seconds);
}, { pieceId, day, seconds });

async function openPlayer(page, playerId) {
  await page.goto('/#/');
  await expect(page.locator('.name').first()).toBeVisible();
  await page.goto(`/#/player/${playerId}`);
  await expect(page.getByRole('button', { name: 'Today’s practice' })).toBeVisible();
}
const hub = (page) => page.locator('.today-body');
const stopLabel = (page) => page.locator('.clock.stop-count');
const cleanRun = async (page, times = 3) => {
  for (let i = 0; i < times; i++) await page.locator('.answer.clean').tap();
  await page.locator('.scrim:not(.leaving) .sheet').getByRole('button', { name: 'Next stop' }).tap();
};

test('a whole session, stop by stop, from the one button to the end card', async ({ page }) => {
  await page.goto('/');
  await at(page);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await setUp(page, pieceId, seeded.bars, { gold: [1, 2], due: [3, 4] });
  await practisedOn(page, pieceId, '2026-11-15');                           // yesterday, so today is an ordinary day
  await page.evaluate(async (id) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    await store.saveAssignment({ ...model.blankAssignment(await store.get('pieces', id)), note: 'Curved fingers in bar 5' });
  }, pieceId);

  await openPlayer(page, seeded.players.Pip);
  await expect(page.locator('.week i.on')).toHaveCount(0);                  // yesterday was last week
  await page.getByRole('button', { name: 'Today’s practice' }).tap();

  // The queue: one check with its warm-up, two new bars, the join, and a play-through of bars 1 to 6.
  await expect(hub(page)).toContainText('Stop 1 of 6');
  await expect(page.locator('.week-note')).toContainText('Curved fingers in bar 5');
  await expect(page.locator('.stops i')).toHaveCount(6);
  await expect(page.locator('main')).not.toContainText(/\d{4}|due|step|ladder|tomorrow|overdue|\bmin\b/i);
  await page.getByRole('button', { name: 'Start: 1 check' }).tap();

  await expect(page.getByRole('heading', { name: 'Warm-up' })).toBeVisible();
  await expect(stopLabel(page)).toHaveText('Stop 1 of 6');
  await page.getByRole('button', { name: 'Ready' }).tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bars 3 to 4');
  await expect(stopLabel(page)).toHaveText('Stop 2 of 6');
  await page.locator('.answer.clean').tap();
  await expect(page.locator('.finish-body')).toContainText('2 bars stuck');
  await page.getByRole('button', { name: 'Next stop' }).tap();

  await expect(hub(page)).toContainText('Stop 3 of 6');
  await expect(page.locator('.stops i.on')).toHaveCount(2);
  await at(page, TODAY, '16:03:00');
  await page.getByRole('button', { name: 'Next: bar 5, right hand' }).tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bar 5');
  await expect(stopLabel(page)).toHaveText('Stop 3 of 6');
  await expect(page.locator('.clock-fill')).toHaveCount(0);                 // stops in place of the time bar
  await page.locator('.answer.slip').tap();
  await page.locator('.chip', { hasText: 'Rhythm' }).tap();
  await at(page, TODAY, '16:04:00');
  await cleanRun(page, 4);

  await expect(hub(page)).toContainText('Stop 4 of 6');
  await page.getByRole('button', { name: 'Next: bar 6, right hand' }).tap();
  await cleanRun(page);
  await page.getByRole('button', { name: 'Next: bars 4 to 5 together' }).tap();
  await expect(page.locator('.train-top h1')).toHaveText('Bars 4 to 5');
  await cleanRun(page);

  await expect(hub(page)).toContainText('Stop 6 of 6');
  await page.getByRole('button', { name: 'Next: bars 1 to 6, all the way through' }).tap();
  await expect(page.getByRole('heading', { name: 'Bars 1 to 6' })).toBeVisible();
  await expect(page.locator('.bar-hit').nth(6)).toBeDisabled();             // bar 7 isn't part of this play
  await page.getByRole('button', { name: 'Start playing' }).tap();
  await at(page, TODAY, '16:06:00');
  await page.getByRole('button', { name: 'Finished' }).tap();
  await page.getByRole('button', { name: 'Clean all the way' }).tap();
  await page.getByRole('button', { name: 'Next stop' }).tap();

  // The end card: stops, one sentence about the practice, and the week's dots. No score, no minutes.
  const end = page.locator('.today-end');
  await expect(end.getByRole('heading', { name: 'That’s today done' })).toBeVisible();
  await expect(end.locator('.stops i.on')).toHaveCount(6);
  await expect(end.locator('.process')).toHaveText('You went back to bar 5, and then it was clean.');
  await expect(end.locator('.week i.on')).toHaveCount(1);                   // finishing the stops ticks today
  await expect(end).not.toContainText(/\bmin\b|points|score|\d:\d\d|%/i);

  const plays = await attemptsFor(page, pieceId);
  expect(plays.filter((a) => a.stopsDone)).toHaveLength(1);
  expect(plays.find((a) => a.source === 'whole').barIds).toEqual(seeded.bars.slice(0, 6));
  expect((await rows(page, 'schedule')).filter((s) => s.lastDay === TODAY).map((s) => s.step)).toEqual([3, 3]);

  // Back at the pieces, and into the session again: what was done isn't asked for twice.
  await end.getByRole('button', { name: 'Back to my pieces' }).tap();
  await page.getByRole('button', { name: 'Today’s practice' }).tap();
  await expect(page.getByRole('button', { name: 'Start: bar 5, left hand' })).toBeVisible();
  await expect(hub(page)).not.toContainText('check');
});

test('when the session’s time is up, new bars and the join are dropped; checks and the play-through stay', async ({ page }) => {
  await page.goto('/');
  await at(page);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await setUp(page, pieceId, seeded.bars, { gold: [1, 2], due: [3, 4] });
  await practisedOn(page, pieceId, '2026-11-15');
  await openPlayer(page, seeded.players.Pip);
  await page.getByRole('button', { name: 'Today’s practice' }).tap();
  await expect(hub(page)).toContainText('Stop 1 of 6');
  await page.getByRole('button', { name: 'Start: 1 check' }).tap();
  await page.getByRole('button', { name: 'Ready' }).tap();
  await at(page, TODAY, '16:16:00');                                        // the checks took the whole fifteen minutes
  await page.locator('.answer.clean').tap();
  await page.getByRole('button', { name: 'Next stop' }).tap();
  await expect(hub(page)).toContainText('Stop 3 of 3');
  await expect(page.getByRole('button', { name: /^Next: bars 1 to 4, all the way through|^Next: bars 1 to 6/ })).toBeVisible();
});

test('the first session back after days away is a warm-up and four checks, and Quick practice is four checks', async ({ page }) => {
  await page.goto('/');
  await at(page);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await setUp(page, pieceId, seeded.bars, { gold: [12], due: [1, 3, 5, 7, 9] });
  await practisedOn(page, pieceId, '2026-11-12');                           // away Friday, Saturday and Sunday

  await openPlayer(page, seeded.players.Pip);
  await page.getByRole('button', { name: 'Today’s practice' }).tap();
  await expect(hub(page)).toContainText('Stop 1 of 5');
  await expect(page.getByRole('button', { name: 'Start: 4 checks' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/away|missed|welcome back|been a while|days/i);
  await page.getByRole('button', { name: 'Start: 4 checks' }).tap();
  await expect(page.getByRole('heading', { name: 'Warm-up' })).toBeVisible();
  await page.getByRole('button', { name: 'Ready' }).tap();
  await expect(page.getByRole('group', { name: 'Which one first?' }).getByRole('button')).toHaveCount(4);

  await openPlayer(page, seeded.players.Pip);
  await page.getByRole('button', { name: /Quick practice/ }).tap();
  await expect(hub(page)).toContainText('Stop 1 of 4');
  await page.getByRole('button', { name: 'Start: 4 checks' }).tap();
  await expect(page.getByRole('heading', { name: 'Warm-up' })).toHaveCount(0);
  const choices = page.getByRole('group', { name: 'Which one first?' }).getByRole('button');
  await expect(choices).toHaveCount(4);
  await choices.first().tap();
  for (let i = 0; i < 4; i++) {
    await expect(stopLabel(page)).toHaveText(`Stop ${i + 1} of 4`);
    await page.locator('.answer.clean').tap();
  }
  await page.getByRole('button', { name: 'Next stop' }).tap();
  await expect(page.getByRole('heading', { name: 'That’s today done' })).toBeVisible();
  await expect(page.locator('.today-end .process')).toContainText('still clean on the first try');
  await expect(page.locator('.today-end .week i.on')).toHaveCount(1);       // a short day still counts
});

test('stopping early is fine: a kind card, and the day isn’t marked as finished', async ({ page }) => {
  await page.goto('/');
  await at(page);
  const seeded = await seedPiece(page);
  const pieceId = seeded.pieces.Pip;
  await practisedOn(page, pieceId, '2026-11-15');
  await openPlayer(page, seeded.players.Pip);
  await page.getByRole('button', { name: 'Today’s practice' }).tap();
  await expect(hub(page)).toContainText('Stop 1 of 3');                     // a brand-new piece: two new bars and a play of them
  await page.getByRole('button', { name: 'Start: bar 1, right hand' }).tap();
  await cleanRun(page);
  await expect(hub(page)).toContainText('Stop 2 of 3');
  await page.getByRole('button', { name: 'Stop here for today' }).tap();
  const end = page.locator('.today-end');
  await expect(end.getByRole('heading', { name: 'Good work today' })).toBeVisible();
  await expect(end.locator('.process')).toHaveText('You turned up and practised today.');
  await expect(end).not.toContainText(/left|missed|unfinished|only/i);
  expect((await attemptsFor(page, pieceId)).some((a) => a.stopsDone)).toBe(false);
  await expect(end.locator('.week i.on')).toHaveCount(0);

  // Free practice from the score is as it was, and goes back to the score.
  await page.goto(`/#/piece/${pieceId}`);
  await expect(page.locator('.bar-hit')).toHaveCount(12);
  await page.goto(`/#/train/${pieceId}/${seeded.bars[2]}/rh/3`);
  await expect(page.locator('.answer.clean')).toBeVisible();
});
