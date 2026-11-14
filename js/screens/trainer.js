import { h, fill, goUp, swapTo, icon, sheet, closeSheet, sticker, toast } from '../ui.js';
import { get, put, progressMap, byIndex, addAttempt } from '../store.js';
import {
  penVar, listBars, barsLabel, blankProgress, mistakeList, rankMistakes, nextForBars, startTempo, clampTempo, easierTempo, fasterTempo,
  freshRun, afterClean, afterSlip, stageNeedsSpeed, goodRun, MASTERY_RUN, allSolid,
  slowAfterSlips, fasterAfterCleans, handsOnSpeed, speedPercent, OFFER_AFTER,
} from '../model.js';
import { drawBars } from '../images.js';
import { Metronome } from '../metronome.js';
import { PracticeClock, clockView, stayAwake } from '../clock.js';
import { stickOn, fanfare } from '../sound.js';
import { cssVar } from '../theme.js';
import { missing, speedControl, backTo, sessionHome } from './common.js';
import { Hearing } from '../hear.js';
import { Shadow } from '../shadow.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_BARS = 12;            // the longest phrase, as on the score

export async function trainer([id, csv, stageId, runGoal], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const allBars = listBars(piece);
  let bars = csv.split(',').map((b) => allBars.find((x) => x.id === b)).filter(Boolean);
  const stage = piece.stages.find((s) => s.id === stageId);
  if (!bars.length || !stage) return missing('That practice has gone.');
  const home = sessionHome(id);
  const progress = await progressMap(id);
  const tried = await byIndex('attempts', 'pieceId', id);
  const good = goodRun(piece);
  const chosenGoal = Number(runGoal) >= MASTERY_RUN ? MASTERY_RUN : good;
  let target = chosenGoal;

  let run = freshRun();
  let choseSlower = false;       // took the offer to slow down, and hasn't played clean since
  let ending = false;            // the last clean is saving, or its panel is open
  let tempo = startTempo(piece, stage);
  const clock = await new PracticeClock({ piece, bars }).load();
  clock.onGoal = () => toast('That’s today’s time done. Finish what you’re on, or keep going.');
  const met = new Metronome();
  met.bpm = tempo;
  met.beats = piece.beats || 4;
  const hearing = await Hearing.load(piece, get);
  const shadow = await Shadow.load();          // null unless a grown-up is grading alongside

  const coach = h('div', { class: 'coach', 'aria-live': 'polite' });
  const showHint = () => fill(coach, h('p', { class: 'goal' }, stage.hint, stage.dynamics ? ' Dynamics count.' : ''));
  showHint();

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
  // `auto` is the app stepping the speed down or back up. Any other change is someone's own choice.
  function setTempo(v, auto = false) {
    clock.touch();
    if (!auto) { run = handsOnSpeed(run); choseSlower = false; }
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
      if (met.running) met.stop();
      else { hearing?.stop(); await startMetronome(); }
    },
  }, icon('play', 24), 'Metronome');

  /* ---------- the teacher's recording ---------- */
  const hearBtn = hearing && h('button', { class: 'btn met-toggle hear', onClick: hear }, icon('sound', 24), 'Hear it');
  function showHearing(on) {
    fill(hearBtn, icon(on ? 'stop' : 'sound', 24), on ? 'Stop' : 'Hear it');
    hearBtn.classList.toggle('running', on);
  }
  async function hear() {
    clock.touch();
    if (hearing.playing) { hearing.stop(); return; }
    if (!hearing.can(bars)) { toast('These bars aren’t marked in the teacher’s recording yet.'); return; }
    if (met.running) met.stop();
    showHearing(true);
    const view = lastDraw && { box: cropBox, canvas: crop, spots: lastDraw.spots };
    const ok = await hearing.play(bars, { tempo, view, onEnd: () => showHearing(false) });
    if (!ok) showHearing(false);
  }
  function showMetronomeOff() {
    startBtn.replaceChildren(icon('play', 24), 'Metronome');
    startBtn.classList.remove('running');
  }

  /* ---------- the stickers ---------- */
  const slots = h('div', { class: 'slots', role: 'img' });
  const runLabel = h('p', { class: 'run-label' });
  function showTokens(change) {
    const forSolid = target >= MASTERY_RUN;
    slots.setAttribute('aria-label', `${run.tokens} of ${target} stickers`);
    slots.classList.toggle('long', forSolid);
    runLabel.textContent = `${target} stickers ${forSolid ? 'to make it solid' : 'to colour it in'}`;
    while (slots.children.length < target) slots.append(h('span', { class: 'slot' }));
    [...slots.children].forEach((slot, i) => {
      slot.classList.toggle('after-good', forSolid && i === good);
      const filled = i < run.tokens;
      const peeling = slot.querySelector('.sticker.peel');
      if (filled && peeling) peeling.remove();        // a clean play straight after a slip: the old sticker makes way now
      const has = !!slot.querySelector('.sticker');
      if (filled && !has) {
        slot.append(h('span', { class: `sticker ${change === 'clean' ? 'slap' : ''}` }, sticker(52)));
      } else if (!filled && has) {
        const s = slot.querySelector('.sticker');           // it fades out where it is: no sound, nothing moves
        s.classList.add('peel');
        setTimeout(() => s.remove(), calm() ? 0 : 420);
      }
    });
  }

  /* ---------- saving ---------- */
  // `tap` is how things stood when the button was tapped, which for a slip is before it is saved.
  const tapNow = () => ({ at: Date.now(), metronomeOn: met.running, tempoSet: tempo, runGoal: target });

  async function record(result, tag = null, { ticket = null, ...tap } = tapNow()) {
    const attempt = await addAttempt(piece, {
      barIds: bars.map((b) => b.id), stageId: stage.id, source: 'trainer', result, tag, ...tap, shadow: ticket?.grade ?? null,
    });
    shadow?.saved(ticket, attempt);
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
    saveSlip();
    showHint();
    if (stage.pace === 'target' && run.tokens && tempo > run.speed) {   // slower stickers don't carry up
      run = freshRun();
      toast('Faster now, so the count starts again.');
    }
    const slowedDown = run.slowed.length > 0;
    const playedAt = tempo;
    const tap = tapNow();                       // as it was played, before any step back up
    run = afterClean(run, tempo);
    // At a full-speed stage, a play made during a slow-down can't be the last sticker.
    if (slowedDown && stage.pace === 'target') run.tokens = Math.min(run.tokens, target - 1);
    const step = fasterAfterCleans(run, tempo);
    run = step.run;
    if (step.back) setTempo(step.tempo, true);
    if (slowedDown || choseSlower) sayKindly(slowWorked(playedAt, step.back ? step.tempo : null, slowedDown));
    choseSlower = false;
    // Climbing towards full speed takes a good run at each step. Only full speed needs the long run.
    const climbing = !slowedDown && stageNeedsSpeed(piece, stage, tempo);
    const finished = run.tokens >= (climbing ? good : target);
    const passedGood = !finished && !climbing && run.tokens === good;
    ending = finished;
    showTokens('clean');
    stickOn();
    await record('clean', null, { ...tap, ticket: shadow?.ask() });
    if (finished) await finishRun();
    else if (passedGood) await colourIn();
  }

  // A good run on the way to solid still counts, even if solid doesn't come today.
  async function colourIn() {
    const fresh = bars.some((b) => !progress.get(b.id)?.done[stage.id]);
    await settle();
    await mark();
    if (fresh) toast(`${barsLabel(bars)} coloured in. Keep going to make it solid.`);
  }

  async function settle() {
    await saveBest();
    for (const b of bars) {                     // a good run settles any slip from the whole piece
      const p = progress.get(b.id);
      if (p?.runSlip) { p.runSlip = 0; await put('progress', p); }
    }
  }

  async function mark(solid = false) {
    const now = Date.now();
    for (const b of bars) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      if (!p.done[stage.id]) p.done[stage.id] = now;
      if (solid) {                              // saved as `crowns`: see solidStages in model.js
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
        h('p', {}, `${target >= MASTERY_RUN ? 'Solid is' : 'The goal is'} at full speed, ${piece.tempo}. Try the next step up.`),
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
    const wasSolid = allSolid(bars, progress, stage);
    await mark(mastered);
    fanfare();
    await swipe();

    const label = barsLabel(bars);
    const one = bars.length === 1;
    const next = nextForBars(piece, bars, progress);
    const more = MASTERY_RUN - run.tokens;
    const canGoOn = !mastered && !wasSolid;

    const goForSolid = () => {
      closeSheet();
      target = MASTERY_RUN;
      ending = false;
      clearSwipe();
      showTokens();
      if (keepTime) startMetronome();
    };

    let title, line;
    if (mastered) {
      title = wasSolid ? 'Still solid!' : 'Solid!';
      line = wasSolid
        ? `${stage.name}, ${target} stickers.`
        : `${stage.name}, ${target} stickers. ${label} ${one ? 'is' : 'are'} solid now.`;
    } else if (wasDone) {
      title = 'Still got it!';
      line = `${stage.name}, ${target} stickers.`;
    } else {
      title = `${stage.name} done!`;
      line = `${label} ${one ? 'is' : 'are'} coloured in.`;
    }

    sheet([
      h('div', { class: 'cheer' }, sticker(mastered ? 92 : 76)),
      h('h2', { class: 'center' }, title),
      h('p', { class: 'center' }, line),
      h('div', { class: 'row-buttons narrow' },
        h('button', { class: `btn ${next || canGoOn ? '' : 'primary'}`, onClick: () => { closeSheet(); leave(); } }, home.done),
        canGoOn && h('button', { class: `btn ${next ? '' : 'primary'}`, onClick: goForSolid }, `${more} more to make it solid`),
        next && h('button', {
          class: 'btn primary',
          onClick: () => { closeSheet(); swapTo(`/train/${id}/${bars.map((b) => b.id).join(',')}/${next.id}/${chosenGoal}`); },
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
  // A slip counts on the first tap. The reason and the tip appear on the screen, so nothing
  // covers the music, and the tip stays up during the next try with nothing to dismiss.
  const reasons = rankMistakes(mistakeList(piece, stage), tried, bars.map((b) => b.id));
  let unsaved = null;            // the slip waiting for its reason, as it stood at the tap
  let lastReason = null;

  function saveSlip(tag = null) {
    if (!unsaved) return;
    const tap = unsaved;
    unsaved = null;
    record('slip', tag, tap);
  }

  // Said between plays, in ordinary text: no colour change, no sound.
  let slowNote = null;
  const sayKindly = (text) => fill(coach, h('p', { class: 'goal kind' }, text));
  const percentOf = (t) => Math.round(speedPercent(piece, t));
  function slowWorked(playedAt, backTo, auto) {
    const at = met.running ? ` Clean at ${percentOf(playedAt)}%.` : '';
    if (backTo) return `Slower worked.${at} Back up to ${backTo} now.`;
    return `Slower worked.${at}${auto ? ' One more like that.' : ''}`;
  }

  function slip() {
    if (ending) return;
    clock.touch();
    saveSlip();
    unsaved = { ...tapNow(), ticket: shadow?.ask() };
    run = afterSlip(run);
    const slow = slowAfterSlips(run, tempo);
    run = slow.run;
    slowNote = null;
    if (slow.slowed) {
      setTempo(slow.tempo, true);
      slowNote = h('p', { class: 'kind' }, met.running ? `Let’s take it slower for a bit: ${slow.tempo}.` : 'Let’s take it slower for a bit.');
    }
    showTokens('slip');
    fill(coach, slowNote, h('div', { class: 'chips' },
      h('span', { class: 'coach-ask' }, 'What happened?'),
      reasons.map((m) => h('button', {
        class: `chip ${m.id === lastReason ? 'last' : ''}`,
        onClick: () => {
          clock.touch();
          lastReason = m.id;
          saveSlip(m.id);
          showTip(m);
        },
      }, m.label))));
  }

  function showTip(m) {
    const twice = run.slipsInRow === OFFER_AFTER;
    fill(coach, slowNote, h('p', { class: 'fix' }, m.fix), m.id === 'join' ? joinOffer() : null, twice ? easier() : null);
  }

  // Practise different bars without leaving. The stickers already won stay.
  function useBars(list) {
    bars = list;
    clock.setBars(list);
    title.textContent = barsLabel(bars);
    paint();
  }

  // Stuck between bars: the join is the thing to practise, so offer this bar with the next one.
  function joinOffer() {
    const playable = allBars.filter((b) => !b.skip);
    const next = playable[playable.findIndex((b) => b.id === bars.at(-1).id) + 1];
    if (!next || bars.length >= MAX_BARS) return null;
    const longer = [...bars, next];
    const box = h('div', { class: 'coach-easier' });
    return fill(box, h('button', { class: 'btn', onClick: () => { useBars(longer); box.remove(); } },
      `Play ${barsLabel(longer).toLowerCase()} together`));
  }

  function easier() {
    const box = h('div', { class: 'coach-easier' });
    const option = (label, act) => h('button', { class: 'btn', onClick: () => { act(); box.remove(); } }, label);
    const options = [];
    if (met.running) {
      const slower = easierTempo(tempo);
      options.push(option(`Slow down to ${slower}`, () => { setTempo(slower); choseSlower = true; }));
    }
    if (bars.length > 1) {
      const half = Math.ceil(bars.length / 2);
      [bars.slice(0, half), bars.slice(half)].forEach((part) => options.push(option(`Just ${barsLabel(part).toLowerCase()}`, () => useBars(part))));
    }
    return fill(box,
      h('span', {}, options.length ? 'Two slips in a row. Make it easier:' : 'Two slips in a row. Go slower, just the beats around the slip.'),
      options);
  }

  /* ---------- leaving ---------- */
  function leave() { goUp(home.path); }

  let letSleep = () => {};

  const ro = new ResizeObserver(() => paint());
  ctx.onShow(() => {
    ro.observe(cropBox);
    letSleep = stayAwake(clock, met);
    showTokens();
    clock.start();
  });
  ctx.onLeave(() => {
    saveSlip();
    shadow?.close();
    hearing?.close();
    ro.disconnect();
    clock.stop();
    met.dispose();
    letSleep();
  });

  const title = h('h1', {}, barsLabel(bars));

  return h('main', { class: 'trainer', vars: { pen: penVar(stage.pen) } },
    h('header', { class: 'train-top' },
      backTo(home.back, home.path),
      title,
      clockView(clock),
      h('span', { class: 'stage-tag' }, h('i', {}), stage.name)),
    cropBox,
    h('section', { class: 'train-side' },
      coach,
      h('div', { class: 'met' },
        dots,
        h('div', { class: 'tempo' },
          h('button', { class: 'round', 'aria-label': 'Slower', onClick: () => setTempo(tempo - 2) }, '−'),
          h('span', { class: 'tempo-read' }, h('span', { class: 'crotchet', 'aria-hidden': 'true' }, '♩'), ' = ', tempoEl),
          h('button', { class: 'round', 'aria-label': 'Faster', onClick: () => setTempo(tempo + 2) }, '+')),
        h('div', { class: 'met-buttons' }, startBtn, hearBtn),
        speed.el),
      h('div', { class: 'run' }, slots, runLabel),
      h('div', { class: 'answers' },
        h('button', { class: 'answer slip', onClick: slip }, 'Slip'),
        h('button', { class: 'answer clean', onClick: clean }, 'Clean'))));
}
