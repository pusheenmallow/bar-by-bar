// The rules of the app, kept apart from the screens.

export const PENS = {
  sky: '#79D2FF',
  grape: '#C4A1FF',
  gum: '#FF9CCB',
  lemon: '#FFE84A',
  lime: '#B4EE45',
  gold: '#FFC02E',
  peach: '#FFB98A',
  mint: '#7FEBC8',
};
export const PLAYER_PENS = ['sky', 'grape', 'gum', 'lemon', 'lime', 'mint'];
const STAGE_PEN_ORDER = ['sky', 'grape', 'gum', 'lemon', 'lime', 'gold', 'peach', 'mint'];

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
  lastCheck: null, clean: 0, slips: 0, lastPractised: 0,
});

export const dayKey = (ts) => {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const practiceStages = (piece) => piece.stages.filter((s) => s.pace !== 'nextday');
export const checkStage = (piece) => piece.stages.find((s) => s.pace === 'nextday') || null;

export function nextStage(piece, prog) {
  const done = prog ? prog.done : {};
  return practiceStages(piece).find((s) => !done[s.id]) || null;
}

export function reachedCount(piece, prog) {
  if (!prog) return 0;
  return piece.stages.filter((s) => prog.done[s.id]).length;
}

// The pen colour for a bar: the furthest stage it has reached.
export function topStage(piece, prog) {
  if (!prog) return null;
  let top = null;
  for (const s of piece.stages) if (prog.done[s.id]) top = s;
  return top;
}

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

/* ---------- tempo ---------- */

const even = (n) => Math.round(n / 2) * 2;
export const clampTempo = (n) => Math.min(240, Math.max(30, Math.round(n)));
export const slowTempo = (piece) => clampTempo(even((piece.tempo * (piece.slowPercent || 65)) / 100));
export const easierTempo = (t) => clampTempo(even(t * 0.9));
export const fasterTempo = (t, target) => Math.min(target, clampTempo(even(t * 1.08 + 1)));

export function startTempo(piece, stage, bars, progress) {
  const best = Math.min(...bars.map((b) => progress.get(b.id)?.bestTempo || 0));
  const slow = slowTempo(piece);
  if (stage.pace === 'target') return Math.min(piece.tempo, Math.max(best, slow));
  if (stage.pace === 'slow') return slow;
  return slow;
}

/* ---------- the clean run ---------- */

export const afterClean = (run) => ({ tokens: run.tokens + 1, slipsInRow: 0 });
export const afterSlip = (run) => ({ tokens: Math.max(0, run.tokens - 1), slipsInRow: run.slipsInRow + 1 });
export const stageNeedsSpeed = (piece, stage, tempo) => stage.pace === 'target' && tempo < piece.tempo;
