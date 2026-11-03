import { h, go, icon, sheet, closeSheet, replaceSheet, sticker, crown, crownSticker, toast } from '../ui.js';
import { get, put, progressMap } from '../store.js';
import {
  penVar, listBars, barsLabel, blankProgress, mistakeList, nextForBars, startTempo, clampTempo, easierTempo, fasterTempo,
  freshRun, afterClean, afterSlip, stageNeedsSpeed, goodRun, MASTERY_RUN, allCrowned,
} from '../model.js';
import { drawBars } from '../images.js';
import { Metronome } from '../metronome.js';
import { PracticeClock, clockView, stayAwake } from '../clock.js';
import { stickOn, peelOff, fanfare, crownFanfare } from '../sound.js';
import { cssVar } from '../theme.js';
import { missing, speedControl } from './common.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function trainer([id, csv, stageId, runGoal], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const allBars = listBars(piece);
  let bars = csv.split(',').map((b) => allBars.find((x) => x.id === b)).filter(Boolean);
  const stage = piece.stages.find((s) => s.id === stageId);
  if (!bars.length || !stage) return missing('That practice has gone.');
  const progress = await progressMap(id);
  const good = goodRun(piece);
  const chosenGoal = Number(runGoal) >= MASTERY_RUN ? MASTERY_RUN : good;
  let target = chosenGoal;

  let run = freshRun();
  let ending = false;            // the last clean is saving, or its panel is open
  let tempo = startTempo(piece, stage);
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
    speed.show(tempo);
  }
  const speed = speedControl(piece, setTempo);
  speed.show(tempo);
  async function startMetronome() {
    await met.start();
    startBtn.replaceChildren(icon('stop', 24), 'Stop');
    startBtn.classList.add('running');
  }
  const startBtn = h('button', {
    class: 'btn met-toggle',
    onClick: async () => {
      clock.touch();
      if (met.running) met.stop(); else await startMetronome();
    },
  }, icon('play', 24), 'Metronome');
  function showMetronomeOff() {
    startBtn.replaceChildren(icon('play', 24), 'Metronome');
    startBtn.classList.remove('running');
  }

  /* ---------- the stickers ---------- */
  const slots = h('div', { class: 'slots', role: 'img' });
  const runLabel = h('p', { class: 'run-label' });
  function showTokens(change) {
    const forCrown = target >= MASTERY_RUN;
    slots.setAttribute('aria-label', `${run.tokens} of ${target} clean in a row`);
    slots.classList.toggle('long', forCrown);
    runLabel.textContent = `${target} clean in a row${forCrown ? ' for the crown' : ''}`;
    while (slots.children.length < target) slots.append(h('span', { class: 'slot' }));
    [...slots.children].forEach((slot, i) => {
      const crownSlot = forCrown && i === target - 1;
      slot.classList.toggle('after-good', forCrown && i === good);
      if (crownSlot && !slot.querySelector('.ghost')) slot.append(h('span', { class: 'ghost' }, crown(30)));
      const filled = i < run.tokens;
      const has = !!slot.querySelector('.sticker');
      if (filled && !has) {
        slot.append(h('span', { class: `sticker ${change === 'clean' ? 'slap' : ''}` }, crownSlot ? crownSticker(52) : sticker(52)));
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
    if (ending) return;
    if (stage.pace === 'target' && !met.running) {
      toast('Start the metronome first. This stage is at full speed.');
      return;
    }
    clock.touch();
    if (stage.pace === 'target' && run.tokens && tempo > run.speed) {   // slower stickers don't carry up
      run = freshRun();
      toast('Faster now, so the count starts again.');
    }
    run = afterClean(run, tempo);
    // Climbing towards full speed takes a good run at each step. Only full speed needs the long run.
    const climbing = stageNeedsSpeed(piece, stage, tempo);
    const finished = run.tokens >= (climbing ? good : target);
    const passedGood = !finished && !climbing && run.tokens === good;
    ending = finished;
    showTokens('clean');
    stickOn();
    await record('clean');
    if (finished) await finishRun();
    else if (passedGood) await colourIn();
  }

  // A good run on the way to the crown still counts, even if the crown doesn't come today.
  async function colourIn() {
    const fresh = bars.some((b) => !progress.get(b.id)?.done[stage.id]);
    await settle();
    await mark();
    if (fresh) toast(`${barsLabel(bars)} coloured in. Keep going for the crown.`);
  }

  async function settle() {
    await saveBest();
    for (const b of bars) {                     // a good run settles any slip from the whole piece
      const p = progress.get(b.id);
      if (p?.runSlip) { p.runSlip = 0; await put('progress', p); }
    }
  }

  async function mark(crowned = false) {
    const now = Date.now();
    for (const b of bars) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      if (!p.done[stage.id]) p.done[stage.id] = now;
      if (crowned) {
        p.crowns ||= {};
        p.crowns[stage.id] ||= now;
      }
      await put('progress', p);
      progress.set(b.id, p);
    }
  }

  async function finishRun() {
    await settle();
    if (stageNeedsSpeed(piece, stage, tempo)) {
      const up = fasterTempo(tempo, piece.tempo);
      sheet([
        h('h2', {}, `${run.tokens} clean at ${tempo}`),
        h('p', {}, `${target >= MASTERY_RUN ? 'The crown is' : 'The goal is'} at full speed, ${piece.tempo}. Try the next step up.`),
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', onClick: () => { closeSheet(); leave(); } }, 'Stop here'),
          h('button', {
            class: 'btn primary',
            onClick: () => { run = freshRun(); ending = false; setTempo(up); showTokens(); closeSheet(); },
          }, `Speed up to ${up}`)),
      ], { dismiss: false });
      return;
    }
    await celebrate();
  }

  async function celebrate() {
    const keepTime = met.running;
    met.stop();
    const mastered = target >= MASTERY_RUN;
    const wasDone = bars.every((b) => progress.get(b.id)?.done[stage.id]);
    const wasCrowned = allCrowned(bars, progress, stage);
    await mark(mastered);
    if (mastered) crownFanfare(); else fanfare();
    await swipe();

    const label = barsLabel(bars);
    const one = bars.length === 1;
    const next = nextForBars(piece, bars, progress);
    const more = MASTERY_RUN - run.tokens;
    const canGoOn = !mastered && !wasCrowned;

    const goForCrown = () => {
      closeSheet();
      target = MASTERY_RUN;
      ending = false;
      clearSwipe();
      showTokens();
      if (keepTime) startMetronome();
    };

    let title, line;
    if (mastered) {
      title = wasCrowned ? 'Mastered again!' : 'Mastered!';
      line = wasCrowned
        ? `${stage.name}, ${target} clean in a row.`
        : `${stage.name}, ${target} clean in a row. ${label} ${one ? 'gets a crown' : 'get crowns'}.`;
    } else if (wasDone) {
      title = 'Still got it!';
      line = `${stage.name}, ${target} clean in a row.`;
    } else {
      title = `${stage.name} done!`;
      line = `${label} ${one ? 'is' : 'are'} coloured in.`;
    }

    sheet([
      h('div', { class: `cheer ${mastered ? 'crowned' : ''}` }, mastered ? crownSticker(104) : sticker(76)),
      h('h2', { class: 'center' }, title),
      h('p', { class: 'center' }, line),
      h('div', { class: 'row-buttons narrow' },
        h('button', { class: `btn ${next || canGoOn ? '' : 'primary'}`, onClick: () => { closeSheet(); leave(); } }, 'Back to my piece'),
        canGoOn && h('button', { class: `btn ${next ? '' : 'primary'}`, onClick: goForCrown }, crown(22), `${more} more for the crown`),
        next && h('button', {
          class: 'btn primary',
          onClick: () => { closeSheet(); go(`/train/${id}/${bars.map((b) => b.id).join(',')}/${next.id}/${chosenGoal}`); },
        }, `Next: ${next.name}`)),
    ], { dismiss: false });
  }

  const clearSwipe = () => { fx.width = 0; };

  // The stage's colour wipes across the music.
  function swipe() {
    return new Promise((resolve) => {
      if (!lastDraw) { resolve(); return; }
      const { cssW, cssH } = lastDraw;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = cssW * dpr; fx.height = cssH * dpr;
      fx.style.width = `${cssW}px`; fx.style.height = `${cssH}px`;
      const c = fx.getContext('2d');
      c.scale(dpr, dpr);
      c.fillStyle = cssVar(`--wash-${stage.pen}`);
      const paintAt = (t) => { c.clearRect(0, 0, cssW, cssH); c.fillRect(0, 0, cssW * t, cssH); };
      if (calm()) { paintAt(1); setTimeout(resolve, 200); return; }
      const began = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - began) / 560);
        paintAt(1 - (1 - t) ** 3);
        if (t < 1) requestAnimationFrame(step); else setTimeout(resolve, 240);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------- slip ---------- */
  function slip() {
    if (ending) return;
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

  return h('main', { class: 'trainer', vars: { pen: penVar(stage.pen) } },
    h('header', { class: 'train-top' },
      h('button', { class: 'round', 'aria-label': 'Back to the bar map', onClick: leave }, icon('back')),
      title,
      clockView(clock),
      h('span', { class: 'stage-tag' }, h('i', {}), stage.name)),
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
        speed.el),
      h('div', { class: 'run' }, slots, runLabel),
      h('div', { class: 'answers' },
        h('button', { class: 'answer slip', onClick: slip }, 'Slip'),
        h('button', { class: 'answer clean', onClick: clean }, 'Clean'))));
}
