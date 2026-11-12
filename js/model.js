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
//   source       where it was played: 'trainer', 'check' or 'whole' ('legacy' for records from before these fields)
//   at, day      the moment of the tap, and its local day
//   metronomeOn  whether the metronome was ticking
//   tempoSet     what the speed dial showed, ticking or not (null where there is no dial)
//   tempo        the speed played with the metronome in the trainer, else null (as it always was)
//   firstTryToday  no earlier play today touched any of these bars
//   warmUps      next-day checks only: how many earlier plays today touched these bars
//   runGoal      the clean-in-a-row goal in force, where there is one
// `earlier` is this piece record's attempts so far. Each learner has their own record, so their days stay apart.
export function makeAttempt({
  piece, barIds, source, result, stageId = null, tag = null, at = Date.now(),
  metronomeOn = false, tempoSet = null, runGoal = null, earlier = [], extra = {},
}) {
  const day = dayKey(at);
  const here = new Set(barIds);
  const before = earlier.filter((a) => (a.day || dayKey(a.at)) === day && a.barIds.some((id) => here.has(id))).length;
  return {
    ...extra,
    pieceId: piece.id, playerId: piece.playerId ?? null, barIds, stageId, result, tag, at, day, source,
    metronomeOn: !!metronomeOn, tempoSet,
    tempo: source === 'trainer' && metronomeOn ? tempoSet : null,
    firstTryToday: before === 0,
    warmUps: source === 'check' ? before : null,
    runGoal,
  };
}

// Fills in what an attempt from before these fields lacks, using only what is known for certain.
// The rest stays null, meaning "not recorded". `playerOf` gives a piece record's player.
export function withAttemptDefaults(a, playerOf = () => null) {
  return {
    ...a,
    day: a.day ?? dayKey(a.at),
    playerId: a.playerId ?? playerOf(a.pieceId) ?? null,
    source: a.source ?? 'legacy',
    metronomeOn: a.metronomeOn ?? (a.tempo != null ? true : null),      // a saved tempo meant it was ticking
    tempoSet: a.tempoSet ?? a.tempo ?? null,
    firstTryToday: a.firstTryToday ?? null,
    warmUps: a.warmUps ?? null,
    runGoal: a.runGoal ?? null,
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

export const crownStages = (piece, prog) => practiceStages(piece).filter((s) => prog?.crowns?.[s.id]);
export const allCrowned = (bars, progress, stage) => bars.every((b) => progress.get(b.id)?.crowns?.[stage.id]);

export function waitingForCheck(piece, bar, prog, now = Date.now()) {
  const check = checkStage(piece);
  if (!check || !prog || bar.skip || prog.done[check.id]) return false;
  const stages = practiceStages(piece);
  const last = stages[stages.length - 1];
  if (!last) return false;
  const when = prog.done[last.id];
  if (!when) return false;
  const today = dayKey(now);
  return dayKey(when) < today && prog.lastCheck !== today;
}

export function checkStatus(piece, bar, prog, now = Date.now()) {
  if (waitingForCheck(piece, bar, prog, now)) return 'Ready now';
  return prog?.lastCheck === dayKey(now) ? 'Try again tomorrow' : 'After full speed';
}

export function checkGroups(piece, progress, now = Date.now(), size = 4) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const bar of playableBars(piece)) {
    if (waitingForCheck(piece, bar, progress.get(bar.id), now)) {
      cur.push(bar);
      if (cur.length === size) flush();
    } else flush();
  }
  flush();
  return groups;
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

export const freshRun = () => ({ tokens: 0, slipsInRow: 0, speed: 0 });
export const afterClean = (run, tempo) => ({ ...run, tokens: run.tokens + 1, slipsInRow: 0, speed: tempo });
export const afterSlip = (run) => ({ ...run, tokens: Math.max(0, run.tokens - 1), slipsInRow: run.slipsInRow + 1 });
export const stageNeedsSpeed = (piece, stage, tempo) => stage.pace === 'target' && tempo < piece.tempo;
