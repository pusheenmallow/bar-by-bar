import { h, fill, icon, toast, sheet, closeSheet, confirmSheet } from '../ui.js';
import { get, put, del, savePiece, groupOf } from '../store.js';
import { listBars, clockText } from '../model.js';
import { session } from '../session.js';
import { cssVar } from '../theme.js';
import { drawBars } from '../images.js';
import { prepare, startRecording, Clip, STEP } from '../audio.js';
import { freshMarks, times, place, tapPlace, jump, placedCount, lineAt } from '../marks.js';
import { gate } from './parent.js';
import { backTo, doneButton, busyPanel, missing, stepper } from './common.js';

const SPEEDS = [{ label: 'Full', rate: 1 }, { label: '3/4', rate: 0.75 }, { label: 'Half', rate: 0.5 }];
const LATENCY = 0.07;          // a tap lands a little after the sound, through the speaker and the screen
const LABEL = 30;              // the band at the top of the waveform for bar numbers
const LONGEST = 15 * 60;

const exact = (t) => {
  const tenths = Math.max(0, Math.round(t * 10));
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

export async function recordingScreen([id], ctx) {
  if (!session.parent) return gate(() => ctx.rerender());
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const bars = listBars(piece);
  const body = h('div', { class: 'rec-body' });
  const root = h('main', { class: 'screen rec-screen' },
    h('header', { class: 'bar-top' }, backTo('Piece settings', `/parent/piece/${id}`), h('h1', {}, 'Teacher’s recording'), doneButton()),
    body);

  let recorder = null;
  let closeEditor = null;
  let gone = false;
  ctx.onLeave(() => { gone = true; recorder?.cancel(); recorder = null; closeEditor?.(); });

  const group = groupOf(piece);                      // everyone learning the piece shares the recording
  const saved = piece.recording ? await get('recordings', group) : null;
  if (saved) edit(saved); else intro();
  return root;

  /* ---------- getting a recording ---------- */

  function intro(problem = null) {
    closeEditor?.();
    closeEditor = null;
    const input = h('input', {
      type: 'file', accept: 'audio/*,video/*', hidden: true, 'aria-label': 'Recording file',
      onChange: (e) => { const file = e.target.files[0]; if (file) use(file); },
    });
    fill(body, h('section', { class: 'block flat rec-intro' },
      h('p', { class: 'lead' }, 'Record the teacher playing the whole piece, or choose a recording they sent you.'),
      h('p', {}, 'Then mark where each bar starts. Players can then hear any bar at their practice speed.'),
      problem && h('p', { class: 'warn', role: 'alert' }, problem),
      h('div', { class: 'row-buttons left' },
        h('button', { class: 'btn primary', onClick: record }, icon('mic', 22), 'Record'),
        h('button', { class: 'btn', onClick: () => input.click() }, icon('file', 22), 'Choose a file'),
        input),
      h('p', { class: 'field-hint' }, 'Put the tablet near the piano in a quiet room. A video works too.'),
      piece.recording && h('button', { class: 'btn', onClick: () => ctx.rerender() }, 'Keep the current recording')));
  }

  async function record() {
    const clock = h('output', { class: 'rec-time' }, '0:00');
    const live = h('canvas', { class: 'rec-live', 'aria-hidden': 'true' });
    const levels = [];
    let started = 0;
    let lock = null;
    fill(body, h('section', { class: 'rec-now' },
      h('p', { class: 'rec-state' }, h('i', { class: 'rec-dot' }), 'Recording'),
      clock,
      live,
      h('div', { class: 'row-buttons narrow' },
        h('button', { class: 'btn', onClick: () => { recorder?.cancel(); recorder = null; lock?.release().catch(() => {}); intro(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onClick: finish }, icon('stop', 22), 'Stop'))));

    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = live.clientWidth, ht = live.clientHeight;
      if (!w) return;
      live.width = Math.round(w * dpr);
      live.height = Math.round(ht * dpr);
      const g = live.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = cssVar('--brass');
      const shown = levels.slice(-Math.floor(w / 3));
      shown.forEach((v, k) => {
        const bar = Math.max(1.5, Math.sqrt(Math.min(1, v)) * (ht - 4));
        g.fillRect(w - (shown.length - k) * 3, (ht - bar) / 2, 2, bar);
      });
    }

    async function finish() {
      const r = recorder;
      recorder = null;
      lock?.release().catch(() => {});
      if (!r) return;
      use(await r.stop());
    }

    try {
      recorder = await startRecording((peak) => {
        levels.push(peak);
        const seconds = (performance.now() - started) / 1000;
        clock.textContent = clockText(seconds);
        if (seconds > LONGEST) finish();
        draw();
      });
    } catch (err) {
      intro(err.message);
      return;
    }
    started = performance.now();
    lock = await navigator.wakeLock?.request('screen').catch(() => null);
  }

  async function use(blob) {
    fill(body, busyPanel('Getting the recording ready…'));
    try {
      const ready = await prepare(blob);
      if (gone) return;
      const sound = {
        pieceId: group, blob: ready.blob, peaks: ready.peaks, onsets: ready.onsets, strengths: ready.strengths,
        start: ready.start, end: ready.end, duration: ready.duration, added: Date.now(),
      };
      await put('recordings', sound);
      piece.recording = { duration: ready.duration, added: sound.added, marks: freshMarks(bars, ready.start, ready.end) };
      await savePiece(piece);
      edit(sound);
      toast('Lines are spread evenly to start. Tap along or drag them into place.');
    } catch (err) {
      intro(err.message || 'That recording couldn’t be read.');
    }
  }

  /* ---------- marking the bars ---------- */

  function edit(sound) {
    const marks = piece.recording.marks;
    const duration = sound.duration;
    const clip = new Clip(sound.blob);
    let at = times(marks);
    let selected = 0;                       // a line, or marks.lines.length for the end
    let view = 0, pps = 0;                  // the waveform's left edge in seconds, and pixels per second
    let playhead = at[0] ?? 0;
    let rate = 1;
    let tapping = null;
    let drawn = null;                       // what the music box shows
    const undo = [];

    const count = () => marks.lines.length;
    const timeOf = (i) => (i >= count() ? marks.end : at[i]);
    const barOf = (i) => bars.find((b) => b.id === marks.lines[Math.min(i, count() - 1)]?.bar) || null;
    const refresh = () => { at = times(marks); };

    let saveTimer = 0;
    const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = 0; savePiece(piece); }, 300); };
    const snapshot = () => JSON.stringify({ lines: marks.lines, end: marks.end });
    const remember = (state = snapshot()) => {
      undo.push(state);
      if (undo.length > 40) undo.shift();
      undoBtn.disabled = false;
    };

    const changedBars = marks.lines.some((l) => !bars.some((b) => b.id === l.bar));
    const staleNote = changedBars && h('p', { class: 'warn', role: 'status' }, 'The bars have changed since these lines were placed. Use “Spread the lines evenly again” below to start fresh.');
    const music = h('canvas', {});
    const musicBox = h('div', { class: 'rec-music' }, music);
    const musicLabel = h('p', { class: 'rec-music-label' });
    const wave = h('canvas', { class: 'rec-wave', role: 'img', 'aria-label': 'The recording, with a line where each bar starts' });
    const over = h('canvas', { class: 'rec-over', 'aria-label': 'Whole recording. Tap to jump there.' });
    const waves = h('div', { class: 'rec-waves' }, wave, over);
    const clockEl = h('output', { class: 'rec-clock' });
    const summary = h('p', { class: 'rec-summary' });
    const undoBtn = h('button', { class: 'btn', disabled: true, onClick: stepBack }, icon('undo', 20), 'Undo');
    const playBtn = h('button', { class: 'round play-round', 'aria-label': 'Play', onClick: togglePlay }, icon('play', 24));
    const speedEl = h('div', { class: 'rec-speed', role: 'group', 'aria-label': 'Playback speed' });
    const linePanel = h('div', { class: 'rec-line' });
    const tapBox = h('div', { class: 'rec-tap' });

    fill(body,
      staleNote,
      h('div', { class: 'rec-top' }, summary, undoBtn),
      h('div', { class: 'rec-music-wrap' }, musicBox, musicLabel),
      waves,
      h('div', { class: 'rec-transport' },
        h('button', { class: 'round', 'aria-label': 'Previous bar', onClick: () => step(-1) }, icon('prev', 22)),
        playBtn,
        h('button', { class: 'round', 'aria-label': 'Next bar', onClick: () => step(1) }, icon('next', 22)),
        clockEl,
        h('span', { class: 'seg-gap' }),
        speedEl,
        h('span', { class: 'zoom' },
          h('button', { class: 'round small', 'aria-label': 'Zoom out', onClick: () => zoomBy(1 / 1.6) }, icon('minus', 20)),
          h('button', { class: 'round small', 'aria-label': 'Zoom in', onClick: () => zoomBy(1.6) }, icon('plus', 20)))),
      linePanel,
      tapBox,
      h('p', { class: 'field-hint rec-help' },
        'Drag a line to where its bar starts, or tap along. Lines you place stay put, and the guesses between them spread out evenly.'),
      h('section', { class: 'block' },
        h('h2', {}, 'Start over'),
        h('div', { class: 'row-buttons left' },
          h('button', { class: 'btn', onClick: restart }, 'Spread the lines evenly again'),
          h('button', { class: 'btn', onClick: replace }, 'Replace the recording'),
          h('button', { class: 'btn danger', onClick: remove }, 'Delete the recording'))),
      clip.el);

    clip.onTick = (t) => { playhead = t; follow(); };
    clip.onEnd = () => { showPlaying(false); showMusic(); drawAll(); };

    /* drawing */

    function sized(canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = canvas.clientWidth, ht = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(ht * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(ht * dpr);
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, ht);
      return { g, w, ht };
    }

    function colours() {
      return {
        ink: cssVar('--ink'), ink2: cssVar('--ink-2'), brass: cssVar('--brass'), brassText: cssVar('--brass-text'),
        surface: cssVar('--surface'), paper: cssVar('--paper'), onAccent: cssVar('--on-accent'), danger: cssVar('--danger'),
      };
    }

    function peakAt(t0, t1) {
      const k0 = Math.max(0, Math.floor(t0 / STEP));
      const k1 = Math.min(sound.peaks.length, Math.max(k0 + 1, Math.floor(t1 / STEP)));
      let v = 0;
      for (let k = k0; k < k1; k++) if (sound.peaks[k] > v) v = sound.peaks[k];
      return v / 255;
    }

    function pill(g, c, x, text, kind) {
      g.font = '500 13px Lexend, system-ui, sans-serif';
      const w = Math.max(26, g.measureText(text).width + 14), ht = 22, y = 3;
      g.beginPath();
      g.roundRect(x - w / 2, y, w, ht, 11);
      if (kind === 'selected') { g.fillStyle = c.brassText; g.fill(); g.fillStyle = c.onAccent; }
      else if (kind === 'placed') { g.fillStyle = c.ink; g.fill(); g.fillStyle = c.surface; }
      else { g.fillStyle = c.surface; g.fill(); g.strokeStyle = c.ink2; g.lineWidth = 1; g.stroke(); g.fillStyle = c.ink; }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x, y + ht / 2 + 0.5);
    }

    function drawWave() {
      const { g, w, ht } = sized(wave);
      if (!w) return;
      wave.dataset.view = view.toFixed(4);                     // where the view sits, for checking
      wave.dataset.pps = pps.toFixed(4);
      const c = colours();
      const mid = LABEL + (ht - LABEL) / 2, amp = (ht - LABEL) / 2 - 8;
      g.fillStyle = c.ink2;
      g.globalAlpha = 0.5;
      for (let x = 0; x < w; x++) {
        const t0 = view + x / pps;
        if (t0 > duration) break;
        const half = Math.max(0.5, peakAt(t0, t0 + 1 / pps) * amp);
        g.fillRect(x, mid - half, 1, half * 2);
      }
      g.globalAlpha = 1;
      if (pps >= 60) {                                         // note starts, as small ticks along the bottom
        g.fillStyle = c.brass;
        sound.onsets.forEach((t, k) => {
          const x = (t - view) * pps;
          if (x < 0 || x > w) return;
          g.globalAlpha = 0.25 + (0.6 * sound.strengths[k]) / 255;
          g.fillRect(x - 0.75, ht - 7, 1.5, 5);
        });
        g.globalAlpha = 1;
      }
      let lastLabel = -Infinity;
      const order = [...Array(count() + 1).keys()].filter((i) => i !== selected).concat(selected);
      const labels = [];
      for (const i of order) {
        const x = (timeOf(i) - view) * pps;
        if (x < -40 || x > w + 40) continue;
        const placed = i >= count() || marks.lines[i].t !== null;
        const isSelected = i === selected;
        g.strokeStyle = isSelected ? c.brass : placed ? c.ink : c.ink2;
        g.lineWidth = isSelected ? 3 : placed ? 2 : 1.5;
        g.setLineDash(placed || isSelected ? [] : [5, 4]);
        g.beginPath();
        g.moveTo(x, LABEL - 2);
        g.lineTo(x, ht);
        g.stroke();
        g.setLineDash([]);
        labels.push({ i, x, kind: isSelected ? 'selected' : placed ? 'placed' : 'guess' });
      }
      labels.sort((a, b) => a.x - b.x);
      for (const l of labels) {                                // labels that would overlap are left off, except the chosen one
        if (l.kind !== 'selected' && l.x - lastLabel < 34) continue;
        const next = labels.find((o) => o.kind === 'selected');
        if (l.kind !== 'selected' && next && Math.abs(next.x - l.x) < 34) continue;
        pill(g, c, l.x, l.i >= count() ? 'End' : String(barOf(l.i)?.n ?? '?'), l.kind);
        lastLabel = l.x;
      }
      const px = (playhead - view) * pps;
      if (px >= -2 && px <= w + 2) {
        g.fillStyle = c.danger;
        g.fillRect(px - 1, LABEL - 2, 2, ht - LABEL + 2);
      }
    }

    function drawOver() {
      const { g, w, ht } = sized(over);
      if (!w) return;
      const c = colours();
      const per = duration / w;
      g.fillStyle = c.ink2;
      g.globalAlpha = 0.4;
      for (let x = 0; x < w; x++) {
        const half = Math.max(0.5, peakAt(x * per, (x + 1) * per) * (ht / 2 - 4));
        g.fillRect(x, ht / 2 - half, 1, half * 2);
      }
      g.globalAlpha = 0.8;
      for (let i = 0; i <= count(); i++) g.fillRect(timeOf(i) / per - 0.5, 0, 1, 7);
      g.globalAlpha = 1;
      g.strokeStyle = c.brass;
      g.lineWidth = 2;
      g.strokeRect(view / per + 1, 1, Math.max(4, wave.clientWidth / pps / per - 2), ht - 2);
      g.fillStyle = c.danger;
      g.fillRect(playhead / per - 1, 0, 2, ht);
    }

    function drawAll() {
      drawWave();
      drawOver();
      clockEl.textContent = `${exact(playhead)} / ${exact(duration)}`;
    }

    async function showMusic(i = clip.playing ? lineAt(marks, at, playhead) : selected) {
      const index = i === null ? null : Math.min(i, count() - 1);
      const bar = index === null ? null : barOf(index);
      musicLabel.textContent = bar
        ? `${clip.playing ? 'Playing bar' : 'Bar'} ${bar.n}${i >= count() ? ', the last bar' : ''}`
        : clip.playing ? 'Before the first bar' : '';
      const key = `${bar?.id}|${musicBox.clientWidth}|${musicBox.clientHeight}`;
      if (key === drawn) return;
      drawn = key;
      if (!bar) { music.width = 0; return; }
      const box = { width: Math.max(80, musicBox.clientWidth - 16), height: Math.max(60, musicBox.clientHeight - 16) };
      await drawBars(music, [bar], box);
    }

    function summaryText() {
      const placed = placedCount(marks);
      summary.textContent = `${clockText(duration)} long. ${placed} of ${count()} bars placed.`;
    }

    function showPlaying(on) {
      fill(playBtn, icon(on ? 'pause' : 'play', 24));
      playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    }

    function showSpeed() {
      fill(speedEl, SPEEDS.map((s) => h('button', {
        class: `seg ${rate === s.rate ? 'on' : ''}`,
        'aria-pressed': String(rate === s.rate),
        onClick: () => { rate = s.rate; if (clip.playing) clip.rate = rate; showSpeed(); },
      }, s.label)));
    }

    function showLine() {
      const i = selected;
      if (i >= count()) {
        fill(linePanel,
          h('div', { class: 'rec-line-head' }, h('strong', {}, 'End of the piece'), h('span', {}, exact(marks.end))),
          h('div', { class: 'rec-line-tools' },
            h('button', { class: 'btn', onClick: () => toNote(-1) }, icon('prev', 20), 'Note'),
            h('button', { class: 'btn', onClick: () => toNote(1) }, 'Note', icon('next', 20)),
            h('button', { class: 'btn', onClick: () => audition(i) }, icon('play', 20), 'Play the last bar')));
      } else {
        const bar = barOf(i);
        const placed = marks.lines[i].t !== null;
        fill(linePanel,
          h('div', { class: 'rec-line-head' },
            h('strong', {}, bar ? `Bar ${bar.n}` : 'A bar that has changed'),
            h('span', {}, `starts at ${exact(at[i])}`),
            h('span', { class: `line-tag ${placed ? 'placed' : 'guess'}` }, placed ? 'Placed' : 'Guess')),
          h('div', { class: 'rec-line-tools' },
            h('button', { class: 'btn', 'aria-label': 'Move to the note before', onClick: () => toNote(-1) }, icon('prev', 20), 'Note'),
            h('button', { class: 'btn', 'aria-label': 'Move to the note after', onClick: () => toNote(1) }, 'Note', icon('next', 20)),
            h('button', { class: 'btn', onClick: () => audition(i) }, icon('play', 20), bar ? `Play bar ${bar.n}` : 'Play this bar'),
            i > 0 && h('button', { class: 'btn', onClick: () => askJump(i) }, 'Repeat or jump')));
      }
      if (!clip.playing) showMusic();
    }

    function showTapBox() {
      if (tapping) {
        const next = tapping.next;
        const label = next >= count() ? 'Tap when the piece ends' : `Tap at the start of bar ${barOf(next)?.n ?? '?'}`;
        const tapBtn = h('button', {
          class: 'answer clean tap-big',
          onPointerdown: (e) => { e.preventDefault(); tap(); },
          onKeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(); } },
        }, label);
        fill(tapBox, tapBtn, h('button', { class: 'btn', onClick: stopTapping }, icon('stop', 20), 'Stop'));
        requestAnimationFrame(() => tapBtn.focus({ preventScroll: true }));
      } else {
        const from = barOf(Math.min(selected, count() - 1));
        fill(tapBox,
          h('button', { class: 'btn primary', onClick: startTapping }, 'Tap along'),
          h('span', { class: 'field-hint' }, `Plays from bar ${from?.n ?? 1}. Tap on the first beat of each bar.`));
      }
    }

    /* moving around */

    function setView(v) {
      const w = wave.clientWidth || 1;
      view = Math.max(0, Math.min(Math.max(0, duration - w / pps), v));
      drawAll();
    }

    function setZoom(next, anchorTime, anchorX) {
      const w = wave.clientWidth || 600;
      pps = Math.max(w / Math.max(1, duration), Math.min(600, next));
      setView(anchorTime - anchorX / pps);
    }

    function zoomBy(factor) {
      const w = wave.clientWidth;
      const t = timeOf(selected);
      const x = (t - view) * pps;
      const inside = x >= 0 && x <= w;
      setZoom(pps * factor, inside ? t : view + w / 2 / pps, inside ? x : w / 2);
    }

    function keepVisible(t) {
      const w = wave.clientWidth, x = (t - view) * pps;
      if (x < w * 0.08 || x > w * 0.92) setView(t - (w * 0.3) / pps);
    }

    function follow() {
      const w = wave.clientWidth, x = (playhead - view) * pps;
      if (x > w * 0.85 || x < 0) view = Math.max(0, Math.min(duration - w / pps, playhead - (w * 0.15) / pps));
      showMusic();
      drawAll();
    }

    function select(i, { move = true, scroll = true } = {}) {
      selected = Math.max(0, Math.min(count(), i));
      if (move && !clip.playing) playhead = timeOf(selected);
      if (scroll) keepVisible(timeOf(selected));
      showLine();
      showTapBox();
      drawAll();
    }

    const step = (dir) => select(selected + dir);

    /* listening */

    function playRange(from, to) {
      playhead = from;
      clip.play(from, to, rate).then((ok) => { showPlaying(ok); if (ok) showMusic(); });
    }

    function togglePlay() {
      if (clip.playing) { clip.stop(); return; }
      playRange(playhead >= duration - 0.05 ? 0 : playhead, null);
    }

    function audition(i) {
      if (tapping) return;
      if (i >= count()) playRange(timeOf(count() - 1), Math.min(duration, marks.end + 0.6));
      else playRange(timeOf(i), timeOf(i + 1));
    }

    /* placing lines */

    function nearestNote(t, radius) {
      const o = sound.onsets;
      let lo = 0, hi = o.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (o[m] < t) lo = m + 1; else hi = m; }
      let best = null, gap = radius;
      for (const k of [lo - 1, lo]) {
        if (k >= 0 && k < o.length && Math.abs(o[k] - t) <= gap) { gap = Math.abs(o[k] - t); best = o[k]; }
      }
      return best;
    }
    const snap = (t, radius) => nearestNote(t, radius) ?? t;

    // The clearest note start between two times.
    function clearestNote(from, to) {
      let best = null, score = 39;
      sound.onsets.forEach((t, k) => {
        if (t >= from && t <= to && sound.strengths[k] > score) { score = sound.strengths[k]; best = t; }
      });
      return best;
    }

    function changed() {
      refresh();
      save();
      summaryText();
      showLine();
      drawAll();
    }

    function toNote(dir) {
      const t = timeOf(selected);
      const o = sound.onsets, s = sound.strengths;
      let target = null;
      if (dir < 0) { for (let k = o.length - 1; k >= 0; k--) if (o[k] < t - 0.015 && s[k] >= 40) { target = o[k]; break; } }
      else { for (let k = 0; k < o.length; k++) if (o[k] > t + 0.015 && s[k] >= 40) { target = o[k]; break; } }
      if (target === null) return;
      remember();
      place(marks, selected, target, duration);
      changed();
      keepVisible(timeOf(selected));
      audition(selected);
    }

    function askJump(i) {
      const current = barOf(i);
      let choice = current?.n ?? bars[0].n;
      sheet([
        h('h2', {}, 'Where does the music go here?'),
        h('p', {}, 'Use this where the teacher goes back for a repeat or D.S., or jumps to the Coda. The bars after this line will count on from the bar you pick.'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'This line starts bar'),
          stepper({ label: 'Bar number', value: choice, min: bars[0].n, max: bars.at(-1).n, onChange: (v) => { choice = v; } })),
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', onClick: () => closeSheet() }, 'Cancel'),
          h('button', {
            class: 'btn primary',
            onClick: () => {
              const target = bars.find((b) => b.n === choice);
              closeSheet();
              if (!target || target.id === marks.lines[i].bar) return;
              remember();
              jump(marks, i, target.id, bars);
              selected = Math.min(i, count());
              changed();
              toast(`The bars after this line now count on from bar ${target.n}.`);
            },
          }, 'Save')),
      ]);
    }

    function startTapping() {
      remember();
      const i = Math.min(selected, count());
      tapping = { next: i, lags: [] };
      selected = i;
      showTapBox();
      playRange(Math.max(0, timeOf(i) - 2), null);
      clip.onEnd = () => { stopTapping(); };
      drawAll();
    }

    function tap() {
      if (!tapping || !clip.playing) return;
      const i = tapping.next;
      // Taps come a little after the sound. How long after is learned from the first few taps,
      // since it differs between tablets and speakers.
      const heard = clip.time, speed = clip.rate;
      const lags = tapping.lags.slice().sort((a, b) => a - b);
      const lag = lags.length >= 2 ? lags[lags.length >> 1] : LATENCY;
      let t = nearestNote(heard - lag * speed, 0.1 * speed + 0.03);
      if (t === null) t = clearestNote(heard - 0.45 * speed, heard + 0.1 * speed);
      if (t !== null) tapping.lags.push(Math.max(-0.15, Math.min(0.45, (heard - t) / speed)));
      else t = heard - lag * speed;
      tapPlace(marks, i, t, duration);
      tapping.next = i + 1;
      selected = Math.min(i + 1, count());
      refresh();
      save();
      summaryText();
      if (i >= count()) { stopTapping(); return; }
      showTapBox();
      drawAll();
    }

    function stopTapping() {
      if (!tapping) return;
      tapping = null;
      clip.onEnd = () => { showPlaying(false); showMusic(); drawAll(); };
      clip.stop();
      showPlaying(false);
      changed();
      showTapBox();
    }

    function stepBack() {
      const last = undo.pop();
      if (!last) return;
      const state = JSON.parse(last);
      marks.lines = state.lines;
      marks.end = state.end;
      undoBtn.disabled = !undo.length;
      selected = Math.min(selected, count());
      changed();
    }

    async function restart() {
      const yes = await confirmSheet({ title: 'Spread the lines evenly again?', body: 'Every line you placed goes back to an even guess. You can undo this.', yes: 'Spread evenly' });
      if (!yes) return;
      remember();
      const fresh = freshMarks(bars, sound.start, sound.end);
      marks.lines = fresh.lines;
      marks.end = fresh.end;
      selected = 0;
      if (staleNote) staleNote.remove();
      changed();
    }

    async function replace() {
      const yes = await confirmSheet({ title: 'Replace the recording?', body: 'The new recording starts with fresh lines. The current one stays until the new one is ready.', yes: 'Replace' });
      if (yes) intro();
    }

    async function remove() {
      const yes = await confirmSheet({ title: 'Delete the recording?', body: 'Players won’t be able to hear their bars until you add another.', yes: 'Delete', danger: true });
      if (!yes) return;
      closeEditor?.();
      closeEditor = null;
      await del('recordings', group);
      delete piece.recording;
      await savePiece(piece);
      intro();
    }

    /* touch */

    const pointers = new Map();
    let gesture = null;
    const pos = (e) => { const r = wave.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    function hitLine(x, y) {
      let best = -1, dist = Infinity;
      for (let i = 0; i <= count(); i++) {
        const d = Math.abs((timeOf(i) - view) * pps - x);
        const reach = y < LABEL + 4 ? 26 : 20;
        if (d <= reach && (d < dist || (d === dist && i === selected))) { best = i; dist = d; }
      }
      return best;
    }

    wave.addEventListener('pointerdown', (e) => {
      wave.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p.x);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = { kind: 'pinch', d0: Math.max(1, Math.abs(a - b)), pps0: pps, t: view + (a + b) / 2 / pps };
        return;
      }
      if (pointers.size > 2 || tapping) { gesture = null; return; }
      const i = hitLine(p.x, p.y);
      if (i >= 0) {
        gesture = { kind: 'line', i, x0: p.x, moved: false, before: snapshot() };
        select(i, { move: false, scroll: false });
      } else {
        gesture = { kind: 'pan', x0: p.x, view0: view, moved: false };
      }
    });

    wave.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      const p = pos(e);
      pointers.set(e.pointerId, p.x);
      if (gesture.kind === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        setZoom((gesture.pps0 * Math.max(1, Math.abs(a - b))) / gesture.d0, gesture.t, (a + b) / 2);
        return;
      }
      if (!gesture.moved && Math.abs(p.x - gesture.x0) < 6) return;
      gesture.moved = true;
      if (gesture.kind === 'line') {
        if (clip.playing) clip.stop();
        place(marks, gesture.i, snap(view + p.x / pps, 14 / pps), duration);
        refresh();
        playhead = timeOf(gesture.i);
        showLine();
        drawAll();
      } else {
        setView(gesture.view0 - (p.x - gesture.x0) / pps);
      }
    });

    const lift = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size) return;
      const done = gesture;
      gesture = null;
      if (!done || e.type === 'pointercancel') return;
      if (done.kind === 'line' && done.moved) {
        remember(done.before);
        changed();
        audition(done.i);
      } else if (done.kind === 'pan' && !done.moved) {
        const t = Math.max(0, Math.min(duration, view + pos(e).x / pps));
        if (clip.playing) { playRange(t, null); return; }
        playhead = t;
        const line = lineAt(marks, at, t);
        select(line === null ? (t >= marks.end ? count() : 0) : line, { move: false, scroll: false });
      }
    };
    wave.addEventListener('pointerup', lift);
    wave.addEventListener('pointercancel', lift);

    const overMove = (e) => {
      if (!e.buttons && e.type === 'pointermove') return;
      const r = over.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width) * duration;
      setView(t - wave.clientWidth / pps / 2);
    };
    over.addEventListener('pointerdown', (e) => { over.setPointerCapture(e.pointerId); overMove(e); });
    over.addEventListener('pointermove', overMove);

    /* start */

    let sizedOnce = false;
    const ro = new ResizeObserver(() => {
      if (!wave.clientWidth) return;
      if (!sizedOnce) {
        sizedOnce = true;
        const span = Math.max(1, (marks.end - (at[0] ?? 0)) / Math.max(1, count()));
        pps = wave.clientWidth / Math.min(20, Math.max(4, span * 4));
        view = Math.max(0, (at[0] ?? 0) - 0.6);
      } else {
        pps = Math.max(wave.clientWidth / Math.max(1, duration), pps);
      }
      drawn = null;
      drawAll();
      showMusic();
    });
    ro.observe(waves);
    ro.observe(musicBox);
    const redraw = () => { drawn = null; drawAll(); showMusic(); };
    window.addEventListener('themechange', redraw);

    closeEditor = () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; savePiece(piece); }
      ro.disconnect();
      window.removeEventListener('themechange', redraw);
      clip.close();
    };

    summaryText();
    showSpeed();
    showPlaying(false);
    showLine();
    showTapBox();
  }
}
