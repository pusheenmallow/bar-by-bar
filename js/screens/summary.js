// The week on one card, for the teacher: did they practise, what moved, what is stuck, how fast
// the play-through went. It is shown here as text and drawn as a picture that a grown-up can save
// or share themselves. The app sends it nowhere.
import { h, toast } from '../ui.js';
import { get, byIndex, progressMap, scheduleMap, currentAssignment, takesFor, timeDocs, dayTotal, playerDays, attemptsSaved, timeSaved } from '../store.js';
import { teacherSummary, weekTarget, dayKey } from '../model.js';
import { session } from '../session.js';
import { missing, backTo, doneButton, learnerTabs, areaHome } from './common.js';
import { gate } from './parent.js';

// A plain white card, so it reads well wherever it is pasted.
export function drawSummary(canvas, summary) {
  const W = 1080, pad = 64, lineH = 46;
  const c = canvas.getContext('2d');
  const font = (px, weight = 400) => `${weight} ${px}px Lexend, system-ui, sans-serif`;
  const wrap = (text, px, weight) => {
    c.font = font(px, weight);
    const out = [];
    let cur = '';
    for (const word of String(text).split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && c.measureText(next).width > W - pad * 2) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const rows = [
    ...wrap(summary.title, 54, 600).map((t) => ({ t, px: 54, weight: 600, h: 70 })),
    ...wrap(summary.sub, 30, 400).map((t) => ({ t, px: 30, weight: 400, h: 44, soft: true })),
    { gap: 28 },
    ...summary.lines.flatMap((line) => [
      ...wrap(line.label, 26, 400).map((t) => ({ t, px: 26, weight: 400, h: 36, soft: true })),
      ...wrap(line.text, 34, 500).map((t) => ({ t, px: 34, weight: 500, h: lineH })),
      { gap: 20 },
    ]),
    { t: 'Bar by Bar', px: 24, weight: 400, h: 32, soft: true },
  ];
  canvas.width = W;
  canvas.height = pad * 2 + rows.reduce((sum, r) => sum + (r.gap || r.h), 0);
  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.textBaseline = 'top';
  let y = pad;
  for (const r of rows) {
    if (r.gap) { y += r.gap; continue; }
    c.font = font(r.px, r.weight);
    c.fillStyle = r.soft ? '#6B6B66' : '#1F2023';
    c.fillText(r.t, pad, y);
    y += r.h;
  }
  return canvas;
}

const pngOf = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

export async function summaryScreen([id], ctx, area = 'parent') {
  if (area === 'parent' ? !session.parent : !session.teacher) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const person = await get('players', piece.playerId);
  await attemptsSaved();
  await timeSaved();
  const now = Date.now();
  const summary = teacherSummary({
    piece, person, now,
    progress: await progressMap(id),
    schedule: await scheduleMap(id),
    attempts: await byIndex('attempts', 'pieceId', id),
    seconds: new Map((await timeDocs(id)).map((doc) => [doc.day, dayTotal(doc)])),
    days: await playerDays(piece.playerId),
    target: weekTarget(person),
    assignment: await currentAssignment(id),
    takes: await takesFor(id),
  });
  const home = areaHome(area, id);
  const tabs = await learnerTabs(piece, (other) => `/${area}/summary/${other}`);
  const canvas = drawSummary(h('canvas', { class: 'summary-card', role: 'img', 'aria-label': 'The summary as a picture' }), summary);
  const fileName = `bar-by-bar-week-${dayKey(now)}.png`;

  async function save() {
    const blob = await pngOf(canvas);
    const a = h('a', { href: URL.createObjectURL(blob), download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    toast('Picture saved to Downloads.');
  }

  // The tablet's own share sheet, when it has one. The grown-up picks where it goes.
  async function share() {
    const file = new File([await pngOf(canvas)], fileName, { type: 'image/png' });
    try { await navigator.share({ files: [file], title: summary.title }); } catch { /* closed without sharing */ }
  }
  const canShare = !!navigator.canShare?.({ files: [new File([''], fileName, { type: 'image/png' })] });

  return h('main', { class: 'screen form summary' },
    h('header', { class: 'bar-top' },
      backTo(home.back, home.path),
      h('h1', {}, 'Summary for the teacher'),
      doneButton()),
    tabs,
    h('section', { class: 'block flat' },
      h('h2', {}, summary.title),
      h('p', { class: 'lead' }, summary.sub),
      h('dl', { class: 'summary-lines' }, summary.lines.map((line) => [h('dt', {}, line.label), h('dd', {}, line.text)]))),
    h('div', { class: 'row-buttons left' },
      h('button', { class: 'btn primary', onClick: save }, 'Save as a picture'),
      canShare && h('button', { class: 'btn', onClick: share }, 'Share…')),
    h('p', { class: 'field-hint' }, 'The picture has the player’s first name on it. It is saved on this tablet, and goes nowhere unless you send it.'),
    h('div', { class: 'summary-preview' }, canvas));
}
