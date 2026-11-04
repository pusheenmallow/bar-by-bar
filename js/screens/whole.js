import { h, goUp, icon, sticker, sheet, toast, softly } from '../ui.js';
import { get, put, progressMap } from '../store.js';
import {
  listBars, playableBars, slowTempo, clampTempo, runLimit, clockText, blankProgress, numberRanges,
} from '../model.js';
import { Metronome } from '../metronome.js';
import { PracticeClock, clockView, stayAwake } from '../clock.js';
import { stickOn, fanfare } from '../sound.js';
import { cssVar } from '../theme.js';
import { missing, speedControl, backTo } from './common.js';
import { scorePages, layer, hitPlace } from './score.js';
import { practicePicker } from './pick.js';

export async function whole([id], ctx) {
  const piece = await get('pieces', id);
  if (!piece) return missing('That piece has gone.');
  const progress = await progressMap(id);
  const bars = listBars(piece);
  const playable = playableBars(piece);
  if (!playable.length) return missing('This piece has no bars to play.');

  const clock = await new PracticeClock({ piece, bars: playable, mode: 'piece', limit: runLimit(piece, playable.length), keepOverLimit: true }).load();
  clock.onGoal = () => { stickOn(); toast('That’s today’s time done.'); };

  let state = 'ready';            // ready, playing, marking
  let began = 0;
  let played = 0;
  const slipped = new Set();
  let tempo = piece.runTempo || slowTempo(piece);
  const met = new Metronome();
  met.bpm = tempo;
  met.beats = piece.beats || 4;

  const { el: pagesEl, views } = await scorePages(piece, bars);

  function draw(view) {
    const pad = layer(view);
    if (!pad) return;
    const { c, px } = pad;
    for (const bar of view.bars) {
      const { x0, x1, y0, y1 } = px(bar);
      if (bar.skip) {
        c.fillStyle = cssVar('--skip');
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else if (slipped.has(bar.id)) {
        c.fillStyle = cssVar('--wash-gum');
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  function chips(view) {
    view.hits.replaceChildren(...view.bars.map((bar) => h('button', {
      class: `bar-hit ${bar.skip ? 'skipped' : ''}`,
      disabled: bar.skip || state === 'ready',
      'aria-label': `Bar ${bar.n}${slipped.has(bar.id) ? ', marked as slipped' : ''}`,
      'aria-pressed': String(slipped.has(bar.id)),
      style: hitPlace(bar, view),
      onClick: () => {
        if (slipped.has(bar.id)) slipped.delete(bar.id); else slipped.add(bar.id);
        views.forEach((v) => { draw(v); chips(v); });
        footer();
      },
    }, h('span', { class: 'num' }, bar.n))));
  }

  /* ---------- metronome ---------- */
  const dots = h('div', { class: 'beats', 'aria-hidden': 'true' },
    Array.from({ length: met.beats }, (_, i) => h('i', { class: i === 0 ? 'first' : '' })));
  met.onBeat = (beat) => {
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === beat));
    if (beat < 0) showMetronomeOff();
  };
  const tempoEl = h('output', { class: 'tempo-value' }, tempo);
  const setTempo = (v) => { tempo = clampTempo(v); met.bpm = tempo; tempoEl.textContent = tempo; speed.show(tempo); };
  const speed = speedControl(piece, setTempo);
  speed.show(tempo);
  const metBtn = h('button', {
    class: 'btn met-toggle',
    onClick: async () => {
      if (met.running) { met.stop(); return; }
      await met.start();
      metBtn.replaceChildren(icon('stop', 24), 'Stop');
      metBtn.classList.add('running');
    },
  }, icon('play', 24), 'Metronome');
  function showMetronomeOff() {
    metBtn.replaceChildren(icon('play', 24), 'Metronome');
    metBtn.classList.remove('running');
  }
  const metRow = h('div', { class: 'met compact' }, dots,
    h('div', { class: 'tempo' },
      h('button', { class: 'round', 'aria-label': 'Slower', onClick: () => setTempo(tempo - 2) }, '−'),
      h('span', { class: 'tempo-read' }, h('span', { class: 'crotchet', 'aria-hidden': 'true' }, '♩'), ' = ', tempoEl),
      h('button', { class: 'round', 'aria-label': 'Faster', onClick: () => setTempo(tempo + 2) }, '+')),
    metBtn);

  /* ---------- playing ---------- */
  const footEl = h('footer', { class: 'whole-foot' });
  const runTime = h('output', { class: 'run-time' });
  let tick = null;

  function footer() {
    if (state === 'ready') {
      footEl.replaceChildren(metRow, speed.el, h('button', { class: 'answer clean wide', onClick: start }, 'Start playing'));
    } else if (state === 'playing') {
      footEl.replaceChildren(metRow, h('div', { class: 'answers even' },
        runTime,
        h('button', { class: 'answer clean', onClick: stopPlaying }, 'Finished')));
    } else {
      const n = slipped.size;
      footEl.replaceChildren(
        h('p', { class: 'goal' }, 'Tap any bar that slipped.'),
        h('button', { class: 'answer clean wide', onClick: done },
          n ? `Done, ${n} ${n === 1 ? 'bar' : 'bars'} slipped` : 'Clean all the way'));
    }
  }

  function start() {
    state = 'playing';
    began = Date.now();
    clock.start();
    runTime.textContent = '0:00';
    tick = setInterval(() => { runTime.textContent = clockText((Date.now() - began) / 1000); }, 500);
    views.forEach(chips);
    footer();
  }

  function stopPlaying() {
    clearInterval(tick);
    clock.stop();
    met.stop();
    played = (Date.now() - began) / 1000;
    state = 'marking';
    footer();
  }

  async function done() {
    const list = playable.filter((b) => slipped.has(b.id));
    await put('attempts', {
      pieceId: id, mode: 'piece', barIds: playable.map((b) => b.id), slipBars: list.map((b) => b.id),
      stageId: null, tempo: null, result: list.length ? 'slip' : 'clean', tag: null, at: Date.now(),
    });
    for (const b of playable) {
      const p = progress.get(b.id) || blankProgress(id, b.id);
      if (slipped.has(b.id)) { p.slips += 1; p.runSlip = Date.now(); } else { p.clean += 1; p.runSlip = 0; }
      p.lastPractised = Date.now();
      await put('progress', p);
      progress.set(b.id, p);
    }
    piece.runTempo = tempo;
    await put('pieces', piece);
    summary(list, played);
  }

  function practiseLink(bar) {
    return h('button', {
      class: 'btn',
      onClick: () => sheet(practicePicker({ piece, bars: [bar], progress }), { kind: 'bar-sheet' }),
    }, `Practise bar ${bar.n}`);
  }

  function summary(list, took) {
    if (!list.length) fanfare();
    softly(() => { root.className = 'screen finish'; root.replaceChildren(h('div', { class: 'finish-body' },
      !list.length && h('div', { class: 'cheer' }, sticker(76)),
      h('h1', { class: 'center' }, list.length ? `${list.length} ${list.length === 1 ? 'bar' : 'bars'} to look at` : 'Clean all the way!'),
      h('p', { class: 'center lead' }, list.length
        ? `Bars ${numberRanges(list.map((b) => b.n))} slipped. You played for ${clockText(took)}.`.replace(/^Bars (\d+) /, 'Bar $1 ')
        : `You played for ${clockText(took)}.`),
      list.length ? h('div', { class: 'row-buttons narrow' }, list.slice(0, 4).map(practiseLink)) : null,
      h('div', { class: 'row-buttons narrow' },
        h('button', { class: 'btn', onClick: () => ctx.rerender() }, 'Play it again'),
        h('button', { class: 'btn primary', onClick: () => goUp(`/piece/${id}`) }, 'Back to my piece')))); }, () => root);
  }

  const ro = new ResizeObserver(() => views.forEach(draw));
  const redraw = () => views.forEach(draw);
  let letSleep = () => {};
  ctx.onShow(() => {
    views.forEach((v) => { ro.observe(v.box); draw(v); chips(v); });
    footer();
    letSleep = stayAwake(clock, met);
    window.addEventListener('themechange', redraw);
  });
  ctx.onLeave(() => {
    window.removeEventListener('themechange', redraw);
    ro.disconnect();
    clearInterval(tick);
    clock.stop();
    met.dispose();
    letSleep();
  });

  const root = h('main', { class: 'screen whole' },
    h('header', { class: 'bar-top' },
      backTo('My piece', `/piece/${id}`),
      h('h1', {}, 'Whole piece'),
      clockView(clock)),
    pagesEl, footEl);
  return root;
}
