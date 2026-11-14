// The rules of the app, kept apart from the screens.

// Pen colours live in the stylesheet, one set for each theme.
export const penVar = (pen) => `var(--tick-${pen})`;
export const PLAYER_PENS = ['sky', 'grape', 'gum', 'lemon', 'lime', 'mint'];
const STAGE_PEN_ORDER = ['sky', 'grape', 'gum', 'lemon', 'lime', 'gold', 'peach', 'mint'];

// “Ana and Ben”, or “Ana, Ben and Cal”.
export const nameList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const defaultStages = () => [
  { id: 'rh', name: 'Right hand', hint: 'Right hand on its own.', pace: 'free', dynamics: false, pen: 'sky' },
  { id: 'lh', name: 'Left hand', hint: 'Left hand on its own.', pace: 'free', dynamics: false, pen: 'grape' },
  { id: 'melody', name: 'Melody and left hand', hint: 'Only the top notes of the right hand, with the left hand.', pace: 'free', dynamics: false, pen: 'gum' },
  { id: 'slow', name: 'Together slow', hint: 'Hands together, slowly.', pace: 'slow', dynamics: true, pen: 'lemon' },
  { id: 'full', name: 'Together full speed', hint: 'Hands together, at full speed.', pace: 'target', dynamics: true, pen: 'lime' },
  { id: 'next', name: 'Clean next day', hint: 'First go, no warm-up.', pace: 'nextday', dynamics: true, pen: 'gold' },
];

export const nextPen = (stages) => {
  const used = new Set(stages.map((s) => s.pen));
  return STAGE_PEN_ORDER.find((p) => !used.has(p)) || 'peach';
};

export const KEYS = [
  { id: 'none', label: 'No sharps or flats', notes: [] },
  { id: 'b1', label: '1 flat: B♭', notes: ['B♭'] },
  { id: 'b2', label: '2 flats: B♭, E♭', notes: ['B♭', 'E♭'] },
  { id: 'b3', label: '3 flats: B♭, E♭, A♭', notes: ['B♭', 'E♭', 'A♭'] },
  { id: 'b4', label: '4 flats: B♭, E♭, A♭, D♭', notes: ['B♭', 'E♭', 'A♭', 'D♭'] },
  { id: 's1', label: '1 sharp: F♯', notes: ['F♯'] },
  { id: 's2', label: '2 sharps: F♯, C♯', notes: ['F♯', 'C♯'] },
  { id: 's3', label: '3 sharps: F♯, C♯, G♯', notes: ['F♯', 'C♯', 'G♯'] },
  { id: 's4', label: '4 sharps: F♯, C♯, G♯, D♯', notes: ['F♯', 'C♯', 'G♯', 'D♯'] },
];

const say = (note) => note.replace('♭', ' flat').replace('♯', ' sharp');

export function mistakeList(piece, stage) {
  const key = KEYS.find((k) => k.id === piece.keySig);
  const list = [{ id: 'note', label: 'Wrong note', fix: 'Play it again and slow down just before that beat, without stopping.' }];
  if (key && key.notes.length) {
    const names = key.notes.length > 2 ? (key.id[0] === 'b' ? 'the flats' : 'the sharps') : key.notes.join(' or ');
    const spoken = key.notes.length === 1 ? `Say "${say(key.notes[0])}" as you play it slowly.` : 'Say each note name as you play it slowly.';
    list.push({ id: 'key', label: `Forgot ${names}`, fix: `Point to every ${names === 'the flats' || names === 'the sharps' ? names.slice(4, -1) : names} in this bar before you play. ${spoken}` });
  }
  list.push({ id: 'rhythm', label: 'Rhythm', fix: 'Clap the rhythm and count out loud. Then play it with the metronome on.' });
  if (!stage || stage.pace === 'slow' || stage.pace === 'target' || stage.pace === 'nextday' || stage.id === 'melody') {
    list.push({ id: 'hands', label: 'Hands not together', fix: 'Go one beat at a time. Play, stop, get ready, then play the next beat.' });
  }
  list.push({ id: 'finger', label: 'Wrong finger', fix: 'Find the finger number on the page. Play just those notes slowly with that finger.' });
  list.push({ id: 'join', label: 'Stuck between bars', fix: 'Play only the last beat of this bar and the first beat of the next. Loop that until it flows.' });
  if (stage && stage.dynamics) {
    list.push({ id: 'dynamics', label: 'Too loud or soft', fix: 'Make it bigger than you need: very soft, very loud. Then play it the way it is written.' });
  }
  if (piece.stages.some((s) => s.id === 'melody') && (!stage || stage.pace !== 'free')) {
    list.push({ id: 'melody', label: 'Melody got lost', fix: 'Play only the top notes with the left hand. Then add the other notes back in, very softly.' });
  }
  list.push({ id: 'unsure', label: 'Not sure', fix: 'Play just the first half of the bar, then just the second half. Find where it goes wrong.' });
  return list;
}

// The player's usual mistakes first, counting this bar's most. The order stays put during a practice.
export function rankMistakes(list, attempts, barIds) {
  const here = new Set(barIds);
  const score = new Map();
  for (const a of attempts) {
    if (!a.tag) continue;
    score.set(a.tag, (score.get(a.tag) || 0) + (a.barIds.some((id) => here.has(id)) ? 3 : 1));
  }
  const rank = (m) => (m.id === 'unsure' ? -1 : score.get(m.id) || 0);
  return list.slice().sort((a, b) => rank(b) - rank(a));
}

/* ---------- bars ---------- */

export function listBars(piece) {
  const out = [];
  let n = piece.firstBar ?? 1;
  piece.layout.forEach((pg, page) => {
    pg.rows.forEach((row, r) => {
      row.bars.forEach((bar, i) => {
        out.push({
          id: bar.id, n: n++, skip: !!bar.skip, pageId: pg.pageId, page, row: r, i,
          x0: row.lines[i], x1: row.lines[i + 1], y0: row.top, y1: row.bottom,
        });
      });
    });
  });
  return out;
}

export const playableBars = (piece) => listBars(piece).filter((b) => !b.skip);

export function barsLabel(bars) {
  if (bars.length === 1) return `Bar ${bars[0].n}`;
  return `Bars ${bars[0].n} to ${bars[bars.length - 1].n}`;
}

export const rowsToLayoutRows = (rows) => rows.map((r) => ({
  top: r.top,
  bottom: r.bottom,
  lines: r.lines.slice(),
  bars: r.lines.slice(1).map(() => ({ id: newId(), skip: false })),
}));

/* ---------- stages and progress ---------- */

export const blankProgress = (pieceId, barId) => ({
  key: `${pieceId}|${barId}`, pieceId, barId, done: {}, flagged: false, notes: [], bestTempo: 0,
  lastCheck: null, clean: 0, slips: 0, lastPractised: 0, runSlip: 0, crowns: {},
});

export const dayKey = (ts) => {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/* ---------- attempts ---------- */

// One play that a player marked. Every screen builds its record here, so the fields can't drift apart.
//   id           a random id made here, so it means the same on any device (older attempts keep their numbers)
//   source       where it was played: 'trainer', 'check' or 'whole' ('legacy' for records from before these fields)
//   at, day      the moment of the tap, and its local day
//   metronomeOn  whether the metronome was ticking
//   tempoSet     what the speed dial showed, ticking or not (null where there is no dial)
//   tempo        the speed played with the metronome in the trainer, else null (as it always was)
//   firstTryToday  no earlier play today touched any of these bars
//   warmUps      next-day checks only: how many earlier plays today touched these bars
//   runGoal      the clean-in-a-row goal in force, where there is one
//   shadow       a grown-up's own verdict on the same play, 'clean' or 'slip', when shadow grading is on
// `earlier` is this piece record's attempts so far. Each learner has their own record, so their days stay apart.
export function makeAttempt({
  piece, barIds, source, result, stageId = null, tag = null, at = Date.now(),
  metronomeOn = false, tempoSet = null, runGoal = null, shadow = null, earlier = [], extra = {},
}) {
  const day = dayKey(at);
  const here = new Set(barIds);
  const before = earlier.filter((a) => (a.day || dayKey(a.at)) === day && a.barIds.some((id) => here.has(id))).length;
  return {
    ...extra,
    id: crypto.randomUUID(),
    pieceId: piece.id, playerId: piece.playerId ?? null, barIds, stageId, result, tag, at, day, source,
    metronomeOn: !!metronomeOn, tempoSet,
    tempo: source === 'trainer' && metronomeOn ? tempoSet : null,
    firstTryToday: before === 0,
    warmUps: source === 'check' ? before : null,
    runGoal,
    shadow,
  };
}

// Fills in what an attempt from before these fields lacks, using only what is known for certain.
// The rest stays null, meaning "not recorded". `playerOf` gives a piece record's player.
export function withAttemptDefaults(a, playerOf = () => null) {
  return {
    ...a,
    id: a.id ?? crypto.randomUUID(),
    day: a.day ?? dayKey(a.at),
    playerId: a.playerId ?? playerOf(a.pieceId) ?? null,
    source: a.source ?? 'legacy',
    metronomeOn: a.metronomeOn ?? (a.tempo != null ? true : null),      // a saved tempo meant it was ticking
    tempoSet: a.tempoSet ?? a.tempo ?? null,
    firstTryToday: a.firstTryToday ?? null,
    warmUps: a.warmUps ?? null,
    runGoal: a.runGoal ?? null,
    shadow: a.shadow ?? null,
  };
}

// How often a grown-up's verdict matched the child's, over the plays the grown-up graded.
// Shown only once there are enough plays for the number to mean something.
export const SHADOW_ENOUGH = 20;
export function shadowAgreement(attempts) {
  const graded = attempts.filter((a) => a.shadow === 'clean' || a.shadow === 'slip');
  const agreed = graded.filter((a) => a.shadow === a.result).length;
  return {
    graded: graded.length,
    agreed,
    percent: graded.length ? Math.round((agreed / graded.length) * 100) : null,
    childCleanAdultSlip: graded.filter((a) => a.result === 'clean' && a.shadow === 'slip').length,
    childSlipAdultClean: graded.filter((a) => a.result === 'slip' && a.shadow === 'clean').length,
    enough: graded.length >= SHADOW_ENOUGH,
  };
}

export const practiceStages = (piece) => piece.stages.filter((s) => s.pace !== 'nextday');
export const checkStage = (piece) => piece.stages.find((s) => s.pace === 'nextday') || null;

export function reachedCount(piece, prog) {
  if (!prog) return 0;
  return piece.stages.filter((s) => prog.done[s.id]).length;
}

// The first stage still to finish across a group of bars.
export const nextForBars = (piece, bars, progress) => practiceStages(piece)
  .find((s) => !bars.every((b) => progress.get(b.id)?.done[s.id])) || null;

// The pen colour for a bar: the furthest stage it has reached.
export function topStage(piece, prog) {
  if (!prog) return null;
  let top = null;
  for (const s of piece.stages) if (prog.done[s.id]) top = s;
  return top;
}

// A stage is "solid" on a bar once the long run was won there. The field is still called `crowns`,
// from when that earned a crown, so nothing saved under the old rules is lost: it shows as solid.
export const solidStages = (piece, prog) => practiceStages(piece).filter((s) => prog?.crowns?.[s.id]);
export const allSolid = (bars, progress, stage) => bars.every((b) => progress.get(b.id)?.crowns?.[stage.id]);

// The only crown is gold: the bar was still clean on a later day.
export function hasGold(piece, prog) {
  const check = checkStage(piece);
  return !!(check && prog?.done?.[check.id]);
}

// How far a bar has come, as one of five colour steps: none, started, good, solid, gold.
export function barStep(piece, prog) {
  if (!prog) return 'none';
  if (hasGold(piece, prog)) return 'gold';
  const top = topStage(piece, prog);
  if (!top) return prog.clean || prog.slips ? 'started' : 'none';
  return prog.crowns?.[top.id] ? 'solid' : 'good';
}

/* ---------- the schedule ---------- */
// Once a bar has finished its last practice stage it comes back for a check play on later days,
// at growing gaps. A clean check moves it up the ladder, a slip brings it back tomorrow. The
// player never sees any of this: no dates, no steps, and nothing that goes down.

export const LADDER = [0, 1, 2, 4, 7, 14];           // days until the next check, by step
export const EASY_WARM_UPS = 2;                      // a clean check after more warm-ups than this repeats its gap
export const REVIEW_CAP = 8;                         // the most check stops in one session

const dayNoon = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day, n) => { const d = dayNoon(day); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
const dayGap = (from, to) => Math.round((dayNoon(to) - dayNoon(from)) / 86400000);

export const blankSchedule = (pieceId, barId) => ({
  key: `${pieceId}|${barId}`, pieceId, barId, step: 1, dueDay: null, lastDay: null, lapses: 0, kept: false, shortNext: false,
});

// A bar's place on the ladder. `saved` is its record in the schedule store, if it has one yet.
// Without one it is worked out from progress, so bars learned before the schedule existed join it
// with nothing to convert: a bar waiting for its first check is due the day after it was learned,
// and a bar that already has its gold crown comes back two days after it was won.
export function scheduleOf(piece, bar, prog, saved = null) {
  if (saved) return saved;
  const check = checkStage(piece);
  const last = practiceStages(piece).at(-1);
  if (!check || !last || !prog || bar.skip || !prog.done[last.id]) return null;
  const blank = blankSchedule(piece.id, bar.id);
  if (prog.done[check.id]) {
    const won = dayKey(prog.done[check.id]);
    return { ...blank, step: 2, kept: true, lastDay: won, dueDay: addDays(won, LADDER[2]) };
  }
  return { ...blank, lastDay: prog.lastCheck || null, dueDay: addDays(dayKey(prog.done[last.id]), 1) };
}

// With a lesson or exam coming, no gap is longer than half the days left, so everything is seen
// at least twice before the date.
export function squeezeGap(gap, today, lessonDay) {
  if (!lessonDay || lessonDay <= today) return gap;
  return Math.min(gap, Math.max(1, Math.floor(dayGap(today, lessonDay) / 2)));
}

// The result of one check play. A tablet with the wrong date never sends things backwards:
// a check can't count as earlier than the one before it.
export function afterReview(entry, { clean, warmUps = 0, today, lessonDay = null }) {
  const day = entry.lastDay && today < entry.lastDay ? entry.lastDay : today;
  if (!clean) {
    return { ...entry, step: Math.max(1, entry.step - 1), lapses: entry.lapses + 1, shortNext: true, lastDay: day, dueDay: addDays(day, 1) };
  }
  const step = warmUps <= EASY_WARM_UPS ? Math.min(LADDER.length - 1, entry.step + 1) : entry.step;
  // After a slip the following gap is shortened once.
  const gap = entry.shortNext ? LADDER[Math.max(1, step - 1)] : LADDER[step];
  return { ...entry, step, kept: true, shortNext: false, lastDay: day, dueDay: addDays(day, squeezeGap(gap, day, lessonDay)) };
}

// A bar marked as slipped in a whole-piece play comes back tomorrow, one step down.
export function afterRunSlip(entry, today) {
  const tomorrow = addDays(today, 1);
  return { ...entry, step: Math.max(1, entry.step - 1), dueDay: entry.dueDay && entry.dueDay < tomorrow ? entry.dueDay : tomorrow };
}

/* ---------- the week's assignment ---------- */

// "9-16, 21" as numbers. Dashes of any kind and the word "to" all make a range.
export function parseBarNumbers(text) {
  const out = new Set();
  for (const part of String(text || '').split(/[,;]|\band\b/)) {
    const m = part.trim().match(/^(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?$/);
    if (!m) continue;
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    for (let n = Math.min(from, to); n <= Math.max(from, to) && out.size < 2000; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export const DEFAULT_SESSION_MINUTES = 15;
export const blankAssignment = (piece) => ({
  id: crypto.randomUUID(), pieceId: piece.id, playerId: piece.playerId ?? null, status: 'current', createdAt: Date.now(),
  bars: '', pins: '', pinsDone: [], stageId: practiceStages(piece).at(-1)?.id ?? null, tempo: piece.tempo,
  lessonDate: '', minutes: DEFAULT_SESSION_MINUTES, note: '',
});

const barsNumbered = (piece, text) => {
  const wanted = new Set(parseBarNumbers(text));
  return playableBars(piece).filter((b) => wanted.has(b.n));
};
// The pool of new material, in score order. Empty means "whatever comes next in the music".
export const assignedBars = (piece, assignment) => (assignment?.status === 'current' ? barsNumbered(piece, assignment.bars) : []);

// Pins beat the ladder: a pinned bar is seen every session. A pin lets go once the bar is played
// clean in a check, or once the lesson date has passed, whichever is first.
export function activePins(piece, assignment, now = Date.now()) {
  if (!assignment || assignment.status !== 'current') return new Set();
  if (assignment.lessonDate && dayKey(now) > assignment.lessonDate) return new Set();
  const cleared = new Set(assignment.pinsDone || []);
  return new Set(barsNumbered(piece, assignment.pins).map((b) => b.id).filter((id) => !cleared.has(id)));
}

export function waitingForCheck(piece, bar, prog, now = Date.now(), saved = null) {
  const entry = scheduleOf(piece, bar, prog, saved);
  if (!entry || !entry.dueDay) return false;
  const today = dayKey(now);
  return entry.dueDay <= today && entry.lastDay !== today;
}

export function checkStatus(piece, bar, prog, now = Date.now(), saved = null) {
  if (waitingForCheck(piece, bar, prog, now, saved)) return 'Ready now';
  return prog?.lastCheck === dayKey(now) ? 'Try again tomorrow' : 'After full speed';
}

// Today's check stops for a session: bars that are due, and any pinned bars, in groups of
// neighbours. When there are more than the cap, the ones kept are pinned first, then the most
// overdue for their gap, then the ones missed most often. They come back in score order.
export function reviewGroups(piece, progress, schedule, { now = Date.now(), pinned = new Set(), cap = REVIEW_CAP, size = 4 } = {}) {
  const today = dayKey(now);
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  const entryOf = (bar) => scheduleOf(piece, bar, progress.get(bar.id), schedule.get(bar.id));
  playableBars(piece).forEach((bar) => {
    const entry = entryOf(bar);
    const pin = pinned.has(bar.id) && entry && entry.lastDay !== today;
    if (pin || waitingForCheck(piece, bar, progress.get(bar.id), now, schedule.get(bar.id))) {
      cur.push(bar);
      if (cur.length === size) flush();
    } else flush();
  });
  flush();
  if (groups.length <= cap) return groups;
  const rank = (group) => {
    const entries = group.map(entryOf);
    return {
      pin: group.some((b) => pinned.has(b.id)) ? 1 : 0,
      late: Math.max(...entries.map((e) => dayGap(e.dueDay, today) / Math.max(1, LADDER[e.step]))),
      lapses: Math.max(...entries.map((e) => e.lapses)),
    };
  };
  const ranked = groups.map((group, i) => ({ group, i, ...rank(group) }))
    .sort((a, b) => b.pin - a.pin || b.late - a.late || b.lapses - a.lapses || a.i - b.i);
  return ranked.slice(0, cap).sort((a, b) => a.i - b.i).map((r) => r.group);
}

export function checkGroups(piece, progress, now = Date.now(), size = 4, schedule = new Map()) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const bar of playableBars(piece)) {
    if (waitingForCheck(piece, bar, progress.get(bar.id), now, schedule.get(bar.id))) {
      cur.push(bar);
      if (cur.length === size) flush();
    } else flush();
  }
  flush();
  return groups;
}

// A new order for a list. `random` can be swapped for a repeatable one.
export function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Random numbers that come out the same every time for the same seed. Used by the tests.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Today's next-day checks come in a mixed-up order, which helps them stick. The player may choose
// which one to start with, and only that: the rest keep the order they were dealt.
export const withFirst = (order, first) => (order.includes(first) ? [first, ...order.filter((g) => g !== first)] : order);

/* ---------- showing up ---------- */
// Any practice counts. A day is ticked after five minutes, or after finishing the day's stops,
// whichever comes first. There is no streak: a week has a target number of days, shown as dots
// that fill. Missed days are not shown at all, and every Monday starts clean.

export const DAY_SECONDS = 5 * 60;
export const QUICK_SECONDS = 5 * 60;          // a Quick practice is exactly enough to tick the day
export const DEFAULT_WEEK_TARGET = 4;
export const RETURN_AFTER_DAYS = 3;           // this many days away makes the first session back a short one
export const RETURN_STOPS = 4;

export const weekTarget = (player) => Math.min(7, Math.max(1, Math.round(player?.weekTarget ?? DEFAULT_WEEK_TARGET)));

const noon = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const daysBetween = (from, to) => Math.round((noon(to) - noon(from)) / 86400000);

// The seven local days of the week `now` falls in, Monday first.
export function weekDays(now = Date.now()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 12).getTime()));
}

// `entry` is one day of a player's practice: { seconds, stops, plays }. See playerDays in store.js.
export const dayCounts = (entry) => !!entry && (entry.seconds >= DAY_SECONDS || !!entry.stops);

// This week for one player. `dots` is what the child sees: one dot for each target day, filled from
// the left as days are practised, with an extra filled dot for any day beyond the target.
export function weekSummary(days, target, now = Date.now()) {
  const week = weekDays(now);
  const practised = week.filter((day) => dayCounts(days.get(day))).length;
  const seconds = week.reduce((sum, day) => sum + (days.get(day)?.seconds || 0), 0);
  return {
    practised, target, seconds, met: practised >= target,
    dots: Array.from({ length: Math.max(target, practised) }, (_, i) => i < practised),
  };
}

// Whole days with no practice at all since the last time, or null for someone who has never practised.
export function daysAway(days, now = Date.now()) {
  const today = dayKey(now);
  const last = [...days.entries()].filter(([day, e]) => day <= today && (e.seconds > 0 || e.plays > 0)).map(([day]) => day).sort().at(-1);
  return last ? Math.max(0, daysBetween(last, today) - 1) : null;
}
export const shortReturn = (days, now = Date.now()) => (daysAway(days, now) ?? 0) >= RETURN_AFTER_DAYS;

// A bar the player already has, to start a session back with something that goes well.
// Never one that is about to be checked, since a check is a first try.
export function warmUpBar(piece, progress, checking) {
  const busy = new Set(checking.flat().map((b) => b.id));
  const free = playableBars(piece).filter((b) => !busy.has(b.id));
  return free.find((b) => hasGold(piece, progress.get(b.id)))
    || free.find((b) => progress.get(b.id)?.crowns && Object.keys(progress.get(b.id).crowns).length)
    || free.find((b) => topStage(piece, progress.get(b.id)))
    || null;
}

// Where a Quick practice starts on a piece: what is waiting, then what slipped, then what comes next.
export function quickPath(piece, progress, now = Date.now(), schedule = new Map()) {
  if (checkStage(piece) && checkGroups(piece, progress, now, 4, schedule).length) return `/check/${piece.id}`;
  const bars = playableBars(piece);
  const unfinished = (b) => nextForBars(piece, [b], progress);
  const bar = bars.find((b) => progress.get(b.id)?.runSlip)
    || bars.find((b) => progress.get(b.id)?.flagged && unfinished(b))
    || bars.find(unfinished);
  const stage = bar && (unfinished(bar) || practiceStages(piece).at(-1));
  return bar && stage ? `/train/${piece.id}/${bar.id}/${stage.id}/${goodRun(piece)}` : `/whole/${piece.id}`;
}

/* ---------- practice time ---------- */

export const practiceMode = (count) => (count <= 2 ? 'bar' : 'phrase');
export const MODES = [
  { id: 'bar', name: 'Short bars', colour: 'var(--mode-1)', ink: 'var(--mode-1-ink)' },
  { id: 'phrase', name: 'Phrases', colour: 'var(--mode-2)', ink: 'var(--mode-2-ink)' },
  { id: 'piece', name: 'Whole piece', colour: 'var(--mode-3)', ink: 'var(--mode-3-ink)' },
];
export const goalSeconds = (piece) => (piece.dailyGoal ?? 10) * 60;

// The longest a whole-piece play should take, with room for slow playing and a pause.
export const runLimit = (piece, count) => Math.max(180, Math.round(((count * (piece.beats || 4) * 60) / (piece.tempo || 100)) * 2.5));

export const clockText = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const timeText = (seconds) => {
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
};

export function numberRanges(numbers) {
  const parts = [];
  const list = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j += 1;
    parts.push(j > i + 1 ? `${list[i]} to ${list[j]}` : j === i + 1 ? `${list[i]}, ${list[j]}` : `${list[i]}`);
    i = j;
  }
  return parts.join(', ');
}

/* ---------- tempo ---------- */

const even = (n) => Math.round(n / 2) * 2;
export const clampTempo = (n) => Math.min(240, Math.max(30, Math.round(n)));
export const slowTempo = (piece) => clampTempo(even((piece.tempo * (piece.slowPercent || 65)) / 100));
export const easierTempo = (t) => clampTempo(even(t * 0.9));
export const fasterTempo = (t, target) => Math.min(target, clampTempo(even(t * 1.08 + 1)));

export const startTempo = (piece, stage) => (stage.pace === 'target' ? piece.tempo : slowTempo(piece));

// Quick speeds, and the slider's steps between them, as shares of full speed.
export const SPEEDS = [{ label: 'Half', percent: 50 }, { label: '3/4', percent: 75 }, { label: 'Full', percent: 100 }];
export const SPEED_STEP = 5;
export const speedTempo = (piece, percent) => (percent >= 100 ? piece.tempo : clampTempo(even((piece.tempo * percent) / 100)));
export const speedPercent = (piece, tempo) => (tempo / piece.tempo) * 100;

/* ---------- the clean run ---------- */

export const MASTERY_RUN = 7;
export const goodRun = (piece) => Math.min(piece.cleanTarget || 3, MASTERY_RUN - 1);

// `slowed` is the speeds stepped down from, most recent last, while an automatic slow-down is on.
// `cleanSlow` counts the clean plays since the last step down.
export const freshRun = () => ({ tokens: 0, slipsInRow: 0, speed: 0, slowed: [], cleanSlow: 0 });
export const afterClean = (run, tempo) => ({ ...run, tokens: run.tokens + 1, slipsInRow: 0, speed: tempo });
export const afterSlip = (run) => ({ ...run, tokens: Math.max(0, run.tokens - 1), slipsInRow: run.slipsInRow + 1 });

// A mistake means slow down, never a penalty. Two slips in a row offer something easier. At three
// the speed drops one notch by itself, and it steps back up after two clean plays.
export const OFFER_AFTER = 2;
export const SLOW_AFTER = 3;
export const FASTER_AFTER = 2;

// Call after afterSlip. Gives the run and the speed to use next.
export function slowAfterSlips(run, tempo) {
  if (run.slipsInRow < SLOW_AFTER) return { run, tempo, slowed: false };
  const slower = easierTempo(tempo);
  const counted = { ...run, slipsInRow: 0 };                       // the count to three starts again
  if (slower >= tempo) return { run: counted, tempo, slowed: false };       // already as slow as it goes
  return { run: { ...counted, slowed: [...run.slowed, tempo], cleanSlow: 0 }, tempo: slower, slowed: true };
}

// Call after afterClean. Steps back up one notch once enough clean plays have been made slower.
// Stickers earned at the slower speed are kept.
export function fasterAfterCleans(run, tempo) {
  if (!run.slowed.length) return { run, tempo, back: false };
  const cleanSlow = run.cleanSlow + 1;
  if (cleanSlow < FASTER_AFTER) return { run: { ...run, cleanSlow }, tempo, back: false };
  const up = run.slowed.at(-1);
  return { run: { ...run, slowed: run.slowed.slice(0, -1), cleanSlow: 0, speed: up }, tempo: up, back: true };
}

// Someone set the speed by hand, so the automatic steps let go.
export const handsOnSpeed = (run) => ({ ...run, slowed: [], cleanSlow: 0 });
export const stageNeedsSpeed = (piece, stage, tempo) => stage.pace === 'target' && tempo < piece.tempo;
