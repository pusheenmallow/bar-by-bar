import { h, go, icon, sheet, closeSheet, replaceSheet, sticker, seeded, strokePath, toast } from '../ui.js';
import { get, put, progressMap } from '../store.js';
import {
  PENS, listBars, barsLabel, blankProgress, mistakeList, practiceStages, startTempo, clampTempo,
  easierTempo, fasterTempo, afterClean, afterSlip, stageNeedsSpeed,
} from '../model.js';
import { drawBars } from '../images.js';
import { Metronome } from '../metronome.js';
import { PracticeClock, clockView, stayAwake } from '../clock.js';
import { stickOn, peelOff, fanfare } from '../sound.js';
import { missing } from './common.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function trainer([id, csv, stageId], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const allBars = listBars(piece);
  let bars = csv.split(',').map((b) => allBars.find((x) => x.id === b)).filter(Boolean);
  const stage = piece.stages.find((s) => s.id === stageId);
  if (!bars.length || !stage) return missing('That practice has gone.');
  const progress = await progressMap(id);
  const target = piece.cleanTarget || 3;

  let run = { tokens: 0, slipsInRow: 0 };
  let tempo = startTempo(piece, stage, bars, progress);
  const clock = await new PracticeClock({ piece, bars }).load();
  clock.onGoal = () => { stickOn(); toast('That’s today’s time done. Finish what you’re on, or keep going.'); };
  const met = new Metronome();
  met.bpm = tempo;
  met.beats = piece.beats || 4;

  /* ---------- the music ---------- */
  const crop = h('canvas', {});
  const fx = h('canvas', { class: 'swipe-fx', 'aria-hidden': 'true' });
  const cropBox = h('div', { class: 'train-crop' }, crop, fx);
  let lastDraw = null;
  async function paint() {
    const box = { width: cropBox.clientWidth - 8, height: cropBox.clientHeight - 8 };
    if (box.width < 40 || box.height < 40) return;
    lastDraw = await drawBars(crop, bars, box);
  }

  /* ---------- the metronome ---------- */
  const dots = h('div', { class: 'beats', 'aria-hidden': 'true' },
    Array.from({ length: met.beats }, (_, i) => h('i', { class: i === 0 ? 'first' : '' })));
  met.onBeat = (beat) => {
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === beat));
    if (beat < 0) showMetronomeOff();
  };
  const tempoEl = h('output', { class: 'tempo-value' }, tempo);
  function setTempo(v) {
    clock.touch();
    tempo = clampTempo(v);
    met.bpm = tempo;
    tempoEl.textContent = tempo;
  }
  const startBtn = h('button', {
    class: 'btn met-toggle',
    onClick: async () => {
      clock.touch();
      if (met.running) { met.stop(); return; }
      await met.start();
      startBtn.replaceChildren(icon('stop', 24), 'Stop');
      startBtn.classList.add('running');
    },
  }, icon('play', 24), 'Metronome');
  function showMetronomeOff() {
    startBtn.replaceChildren(icon('play', 24), 'Metronome');
    startBtn.classList.remove('running');
  }

  /* ---------- the stickers ---------- */
  const slots = h('div', { class: 'slots', role: 'img' });
  function showTokens(change) {
    slots.setAttribute('aria-label', `${run.tokens} of ${target} clean in a row`);
    while (slots.children.length < target) slots.append(h('span', { class: 'slot' }));
    [...slots.children].forEach((slot, i) => {
      const filled = i < run.tokens;
      const has = !!slot.querySelector('.sticker');
      if (filled && !has) {
        const tilt = (seeded(`${Date.now()}${i}`)() - 0.5) * 24;
        slot.append(h('span', { class: `sticker ${change === 'clean' ? 'slap' : ''}`, vars: { tilt: `${tilt}deg` } }, sticker(68)));
      } else if (!filled && has) {
        const s = slot.querySelector('.sticker');
        s.classList.add('peel');
        setTimeout(() => s.remove(), calm() ? 0 : 420);
      }
    });
  }

  /* ---------- saving ---------- */
  async function record(result, tag = null) {
    await put('attempts', {
      pieceId: id, barIds: bars.map((b) => b.id), stageId: stage.id,
      tempo: met.running ? tempo : null, result, tag, at: Date.now(),
    });
    for (const b of bars) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      if (result === 'clean') p.clean += 1; else p.slips += 1;
      p.lastPractised = Date.now();
      await put('progress', p);
      progress.set(b.id, p);
    }
  }

  async function saveBest() {
    if (!met.running) return;
    for (const b of bars) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      p.bestTempo = Math.max(p.bestTempo, tempo);
      await put('progress', p);
      progress.set(b.id, p);
    }
  }

  /* ---------- clean ---------- */
  async function clean() {
    if (stage.pace === 'target' && !met.running) {
      toast('Start the metronome first. This stage is at full speed.');
      return;
    }
    clock.touch();
    run = afterClean(run);
    showTokens('clean');
    stickOn();
    await record('clean');
    if (run.tokens >= target) await finishRun();
  }

  async function finishRun() {
    await saveBest();
    for (const b of bars) {                     // this run settles any slip from the whole piece
      const p = progress.get(b.id);
      if (p?.runSlip) { p.runSlip = 0; await put('progress', p); }
    }
    if (stageNeedsSpeed(piece, stage, tempo)) {
      const up = fasterTempo(tempo, piece.tempo);
      sheet([
        h('h2', {}, `${target} clean at ${tempo}`),
        h('p', {}, `The goal is ${piece.tempo}. Try the next step up.`),
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', onClick: () => { closeSheet(); leave(); } }, 'Stop here'),
          h('button', {
            class: 'btn primary',
            onClick: () => { setTempo(up); run = { tokens: 0, slipsInRow: 0 }; showTokens(); closeSheet(); },
          }, `Speed up to ${up}`)),
      ], { dismiss: false });
      return;
    }
    await celebrate();
  }

  async function celebrate() {
    met.stop();
    const now = Date.now();
    for (const b of bars) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      if (!p.done[stage.id]) p.done[stage.id] = now;
      await put('progress', p);
      progress.set(b.id, p);
    }
    fanfare();
    await swipe();
    const after = practiceStages(piece);
    const next = after[after.findIndex((s) => s.id === stage.id) + 1];
    const label = barsLabel(bars);
    sheet([
      h('div', { class: 'cheer' }, sticker(110)),
      h('h2', { class: 'center' }, `${stage.name} done!`),
      h('p', { class: 'center' }, `${label} ${bars.length === 1 ? 'is' : 'are'} coloured in.`),
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onClick: () => { closeSheet(); leave(); } }, 'Back to my piece'),
        next && h('button', {
          class: 'btn primary',
          onClick: () => { closeSheet(); go(`/train/${id}/${bars.map((b) => b.id).join(',')}/${next.id}`); },
        }, `Next: ${next.name}`)),
    ], { dismiss: false });
  }

  // The stage's pen sweeps across the bar.
  function swipe() {
    return new Promise((resolve) => {
      if (!lastDraw) { resolve(); return; }
      const { cssW, cssH } = lastDraw;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = cssW * dpr; fx.height = cssH * dpr;
      fx.style.width = `${cssW}px`; fx.style.height = `${cssH}px`;
      const c = fx.getContext('2d');
      c.scale(dpr, dpr);
      const rand = seeded(stage.id + csv);
      const strokes = Array.from({ length: 3 }, (_, i) => ({ y0: (cssH / 3) * i - 3, y1: (cssH / 3) * (i + 1) + 3, seed: rand() }));
      const paintAt = (t) => {
        c.clearRect(0, 0, cssW, cssH);
        c.fillStyle = PENS[stage.pen];
        strokes.forEach((s, i) => {
          const local = Math.min(1, Math.max(0, t * 3 - i));
          if (!local) return;
          const fromRight = i % 2 === 1;
          c.save();
          c.beginPath();
          if (fromRight) c.rect(cssW * (1 - local), s.y0 - 8, cssW * local, s.y1 - s.y0 + 16);
          else c.rect(0, s.y0 - 8, cssW * local, s.y1 - s.y0 + 16);
          c.clip();
          strokePath(c, 4, cssW - 4, s.y0, s.y1, seeded(String(s.seed)), 5);
          c.fill();
          c.restore();
        });
      };
      if (calm()) { paintAt(1); setTimeout(resolve, 200); return; }
      const began = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - began) / 900);
        paintAt(t);
        if (t < 1) requestAnimationFrame(step); else setTimeout(resolve, 260);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------- slip ---------- */
  function slip() {
    clock.touch();
    run = afterSlip(run);
    showTokens('slip');
    peelOff();
    let saved = false;
    const save = (tag) => { if (!saved) { saved = true; record('slip', tag); } };
    const list = mistakeList(piece, stage);

    const easier = () => {
      const options = [];
      if (met.running) {
        const slower = easierTempo(tempo);
        options.push(h('button', {
          class: 'btn primary',
          onClick: () => { setTempo(slower); run.slipsInRow = 0; closeSheet(); },
        }, `Slow down to ${slower}`));
      }
      if (bars.length > 1) {
        const half = Math.ceil(bars.length / 2);
        const parts = [bars.slice(0, half), bars.slice(half)];
        parts.forEach((part) => options.push(h('button', {
          class: `btn ${options.length ? '' : 'primary'}`,
          onClick: () => {
            closeSheet();
            bars = part;
            clock.setBars(part);
            title.textContent = barsLabel(bars);
            run.slipsInRow = 0;
            paint();
          },
        }, `Just ${barsLabel(part).toLowerCase()}`)));
      }
      replaceSheet([
        h('h2', {}, 'Two slips in a row'),
        h('p', {}, options.length ? 'Make it easier so the next try is clean.' : 'Make it easier: play it slower, and only the beats around the slip.'),
        h('div', { class: 'stack-buttons' }, options,
          h('button', { class: 'btn', onClick: () => { run.slipsInRow = 0; closeSheet(); } }, options.length ? 'Keep going' : 'Got it')),
      ]);
    };

    const afterFix = () => { if (run.slipsInRow >= 2) easier(); else closeSheet(); };

    const showFix = (m) => {
      save(m.id);
      replaceSheet([
        h('h2', {}, 'Try this'),
        h('p', { class: 'fix' }, m.fix),
        h('button', { class: 'btn primary big wide', onClick: afterFix }, 'Got it'),
      ]);
    };

    sheet([
      h('h2', {}, 'What happened?'),
      h('div', { class: 'chips' }, list.map((m) => h('button', { class: 'chip', onClick: () => showFix(m) }, m.label))),
    ], { onClose: () => save(null) });
  }

  /* ---------- leaving ---------- */
  function leave() { go(`/piece/${id}`); }

  let letSleep = () => {};

  const ro = new ResizeObserver(() => paint());
  ctx.onShow(() => {
    ro.observe(cropBox);
    letSleep = stayAwake(clock, met);
    showTokens();
    clock.start();
  });
  ctx.onLeave(() => {
    ro.disconnect();
    clock.stop();
    met.dispose();
    letSleep();
  });

  const title = h('h1', {}, barsLabel(bars));

  return h('main', { class: 'trainer', vars: { pen: PENS[stage.pen] } },
    h('header', { class: 'train-top' },
      h('button', { class: 'round', 'aria-label': 'Back to the bar map', onClick: leave }, icon('back')),
      title,
      clockView(clock),
      h('span', { class: 'stage-tag' }, stage.name)),
    cropBox,
    h('section', { class: 'train-side' },
      h('p', { class: 'goal' }, stage.hint, stage.dynamics ? ' Dynamics count.' : ''),
      h('div', { class: 'met' },
        dots,
        h('div', { class: 'tempo' },
          h('button', { class: 'round', 'aria-label': 'Slower', onClick: () => setTempo(tempo - 2) }, '−'),
          h('span', { class: 'tempo-read' }, h('span', { class: 'crotchet', 'aria-hidden': 'true' }, '♩'), ' = ', tempoEl),
          h('button', { class: 'round', 'aria-label': 'Faster', onClick: () => setTempo(tempo + 2) }, '+')),
        startBtn,
        h('p', { class: 'tempo-goal' }, `Full speed is ${piece.tempo}`)),
      h('div', { class: 'run' },
        slots,
        h('p', { class: 'run-label' }, `${target} clean in a row`)),
      h('div', { class: 'answers' },
        h('button', { class: 'answer slip', onClick: slip }, 'Slip'),
        h('button', { class: 'answer clean', onClick: clean }, 'Clean'))));
}
