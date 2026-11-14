// Counts active practice on a piece today. Time is only saved when something happens, such as
// a Clean or Slip tap, so a tablet left on the music stand doesn't keep adding minutes.
import { addTime, secondsOn } from './store.js';
import { dayKey, goalSeconds, practiceMode } from './model.js';
import { session } from './session.js';
import { h } from './ui.js';

export class PracticeClock {
  constructor({ piece, bars, mode = null, limit = 120, keepOverLimit = false }) {
    this.pieceId = piece.id;
    this.goal = goalSeconds(piece);
    this.bars = bars;
    this.mode = mode;
    this.limit = limit;
    this.keepOverLimit = keepOverLimit;      // a long whole-piece play still counts, up to the limit
    this.saved = 0;
    this.running = false;
    this.goalDone = false;
    this.onChange = null;
    this.onGoal = null;
  }

  async load() {
    this.saved = await secondsOn(this.pieceId, dayKey(Date.now()));
    this.goalDone = this.goal > 0 && this.saved >= this.goal;
    return this;
  }

  start() {
    this.last = Date.now();
    this.running = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.beat(), 1000);
    this.beat();
  }

  get pending() { return this.running ? (Date.now() - this.last) / 1000 : 0; }
  get idle() { return this.running && this.pending > this.limit; }
  get seconds() { return this.saved + (this.idle && !this.keepOverLimit ? 0 : Math.min(this.pending, this.limit)); }

  // The bar fills as time passes, but reaching the goal is only announced at a tap, which is
  // between plays. Nothing pops up or sounds while someone is in the middle of playing.
  beat(atTap = false) {
    if (atTap && !this.goalDone && this.goal && this.seconds >= this.goal) {
      this.goalDone = true;
      this.onGoal?.();
    }
    this.onChange?.();
  }

  commit() {
    if (!this.running) return;
    const waited = this.pending;
    const credit = waited > this.limit ? (this.keepOverLimit ? this.limit : 0) : waited;
    this.last = Date.now();
    if (credit >= 0.5) {
      this.saved += credit;
      const mode = this.mode || practiceMode(this.bars.length);
      addTime(this.pieceId, dayKey(Date.now()), mode, this.bars.map((b) => b.id), credit);
    }
    this.beat(true);
  }

  touch() {
    this.commit();
    this.last = Date.now();
    this.onChange?.();
  }

  setBars(bars) {
    this.touch();
    this.bars = bars;
  }

  pause() {
    if (!this.running) return;
    this.commit();
    this.running = false;
    this.paused = true;
    this.onChange?.();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.last = Date.now();
    this.running = true;
    this.onChange?.();
  }

  stop() {
    this.commit();
    this.running = false;
    this.paused = false;
    clearInterval(this.timer);
  }
}

// Keeps the tablet awake during practice, and stops the clock and metronome if the app is left.
export function stayAwake(clock, metronome) {
  let lock = null;
  const request = async () => {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
  };
  const changed = () => {
    if (document.visibilityState === 'visible') {
      request();
      clock.resume();
    } else {
      metronome?.stop();
      clock.pause();
    }
  };
  request();
  document.addEventListener('visibilitychange', changed);
  return () => {
    lock?.release?.();
    document.removeEventListener('visibilitychange', changed);
  };
}

// What the player sees of the clock: a bar that fills, and a word. No minutes and no countdown.
// During Today's practice it shows which stop this is, in place of the bar.
export function clockView(clock) {
  const t = session.today;
  if (t && t.pieceId === clock.pieceId) {
    const el = h('div', { class: 'clock stop-count', role: 'status' });
    const show = () => { el.textContent = `Stop ${Math.min(t.total, t.done + (t.within || 0) + 1)} of ${t.total}`; };
    clock.onChange = show;
    show();
    return el;
  }
  const fill = h('i', { class: 'clock-fill' });
  const text = h('span', { class: 'clock-text' });
  const el = h('div', { class: 'clock', role: 'group', 'aria-label': 'Practice time today' },
    h('span', { class: 'clock-track', 'aria-hidden': 'true' }, fill), text);
  const show = () => {
    const { seconds, goal } = clock;
    fill.style.width = goal ? `${Math.min(100, (seconds / goal) * 100)}%` : '0';
    el.classList.toggle('reached', goal > 0 && seconds >= goal);
    el.classList.toggle('no-goal', !goal);
    if (clock.idle && !clock.keepOverLimit) text.textContent = 'Paused';
    else text.textContent = goal && seconds >= goal ? 'Goal done' : '';
  };
  clock.onChange = show;
  show();
  return el;
}
