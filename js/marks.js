// Where each bar starts in the teacher's recording.
// Lines a grown-up has placed keep their time. The rest spread out evenly between them,
// so placing a few landmarks fixes everything in between.

export const GAP = 0.08;                 // the closest two lines can sit, in seconds

// The bars the recording follows from a bar onwards: printed order without skipped bars,
// except a run of skipped bars that starts at that bar, like a first-time ending the teacher played.
export function sequenceFrom(all, barId) {
  const at = all.findIndex((b) => b.id === barId);
  if (at < 0) return [];
  const out = [all[at].id];
  let inSkipped = !!all[at].skip;
  for (let k = at + 1; k < all.length; k++) {
    const b = all[k];
    if (b.skip) {
      if (inSkipped) out.push(b.id);
      continue;
    }
    inSkipped = false;
    out.push(b.id);
  }
  return out;
}

export function freshMarks(all, start, end) {
  const first = all.find((b) => !b.skip);
  const ids = first ? sequenceFrom(all, first.id) : [];
  return { lines: ids.map((bar, i) => ({ bar, t: i === 0 ? start : null })), end };
}

// The time of every line: placed lines as placed, the others evenly between them.
export function times(marks) {
  const { lines, end } = marks;
  const out = new Array(lines.length);
  let a = 0;
  let ta = lines.length && lines[0].t !== null ? lines[0].t : 0;
  for (let j = 1; j <= lines.length; j++) {
    const tj = j === lines.length ? end : lines[j].t;
    if (tj === null) continue;
    for (let k = a; k < j; k++) out[k] = ta + ((k - a) / (j - a)) * (tj - ta);
    a = j;
    ta = tj;
  }
  return out;
}

export const placedCount = (marks) => marks.lines.filter((l) => l.t !== null).length;

// How far a line can move without crossing a placed line. Index lines.length is the end.
export function room(marks, i) {
  const { lines, end } = marks;
  const n = lines.length;
  let lo = 0, hi = Infinity;
  for (let k = i - 1; k >= 0; k--) {
    if (lines[k].t !== null) { lo = lines[k].t + GAP * (i - k); break; }
  }
  if (i < n) {
    hi = end - GAP * (n - i);
    for (let k = i + 1; k < n; k++) {
      if (lines[k].t !== null) { hi = lines[k].t - GAP * (k - i); break; }
    }
  }
  return [lo, hi];
}

export function place(marks, i, t, duration = Infinity) {
  const [lo, hi] = room(marks, i);
  const v = Math.max(lo, Math.min(hi, duration, t));
  if (i >= marks.lines.length) marks.end = v;
  else marks.lines[i].t = v;
  return v;
}

// While tapping along, a tap wins over older lines it would cross.
export function tapPlace(marks, i, t, duration) {
  const n = marks.lines.length;
  if (i < n) {
    for (let k = i + 1; k < n; k++) {
      const line = marks.lines[k];
      if (line.t !== null && line.t < t + GAP * (k - i)) line.t = null;
    }
    if (marks.end < t + GAP * (n - i)) marks.end = duration;
  }
  return place(marks, i, t, duration);
}

// From line i on, the bars count on from another bar, as where the music goes back for a repeat.
export function jump(marks, i, barId, all) {
  const ids = sequenceFrom(all, barId);
  const rest = marks.lines.slice(i);
  marks.lines = marks.lines.slice(0, i).concat(ids.map((bar, k) => ({ bar, t: rest[k] ? rest[k].t : null })));
}

// Where some bars are in the recording: the first place they follow one another,
// or else each bar where it first comes, if they come in order.
export function stretch(marks, barIds) {
  if (!marks?.lines?.length || !barIds.length) return null;
  const at = times(marks);
  const { lines, end } = marks;
  const endOf = (k) => (k + 1 < lines.length ? at[k + 1] : end);
  const span = (idx) => ({
    from: at[idx[0]],
    to: endOf(idx[idx.length - 1]),
    starts: idx.map((k) => at[k]),
    ends: idx.map(endOf),
  });
  for (let i = 0; i + barIds.length <= lines.length; i++) {
    if (barIds.every((id, k) => lines[i + k].bar === id)) return span(barIds.map((_, k) => i + k));
  }
  const idx = barIds.map((id) => lines.findIndex((l) => l.bar === id));
  if (idx.some((k, j) => k < 0 || (j > 0 && k <= idx[j - 1]))) return null;
  return span(idx);
}

// The line whose bar is playing at a time, or null outside the piece.
export function lineAt(marks, at, t) {
  if (!marks.lines.length || t < at[0] || t >= marks.end) return null;
  let k = 0;
  while (k + 1 < at.length && at[k + 1] <= t) k++;
  return k;
}
