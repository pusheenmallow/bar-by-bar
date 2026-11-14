// Counts active practice on a piece today. Time is only saved when something happens, such as
// a Clean or Slip tap, so a tablet left on the music stand doesn't keep adding minutes.
import { addTime, secondsOn, playerDays } from './store.js';
import { dayKey, goalSeconds, practiceMode, clockText, QUICK_SECONDS } from './model.js';
import { session } from './session.js';
import { h } from './ui.js';

export class PracticeClock {
  constructor({ piece, bars, mode = null, limit = 120, keepOverLimit = false }) {
    this.pieceId = piece.id;
    // A Quick practice fills the bar in five minutes, counting everything this player did today.
    this.quickFor = session.quick && session.quick === piece.playerId ? piece.playerId : null;
    this.goal = this.quickFor ? QUICK_SECONDS : goalSeconds(piece);
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
    const today = dayKey(Date.now());
    this.saved = this.quickFor ? ((await playerDays(this.quickFor)).get(today)?.seconds || 0) : await secondsOn(this.pieceId, today);
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

  beat() {
    if (!this.goalDone && this.goal && this.seconds >= this.goal) {
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
    if (credit < 0.5) return;
    this.saved += credit;
    const mode = this.mode || practiceMode(this.bars.length);
    addTime(this.pieceId, dayKey(Date.now()), mode, this.bars.map((b) => b.id), credit);
    this.beat();
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

export function clockView(clock) {
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
    else if (!goal) text.textContent = `${clockText(seconds)} today`;
    else if (seconds < goal) text.textContent = `${clockText(goal - seconds)} to go`;
    else text.textContent = 'Goal done';
  };
  clock.onChange = show;
  show();
  return el;
}
