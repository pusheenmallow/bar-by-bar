import { getMeta, setMeta } from './store.js';

let ctx = null;
let muted = false;
getMeta('muted', false).then((m) => { muted = m; }).catch(() => {});

export const isMuted = () => muted;
export async function setMuted(value) { muted = value; await setMeta('muted', value); }

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function note(freq, at, length, level, type = 'sine') {
  const c = audio();
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + length + 0.02);
}

export function stickOn() { if (!muted) { note(660, 0, 0.12, 0.25, 'triangle'); note(990, 0.05, 0.14, 0.2, 'triangle'); } }
export function peelOff() { if (!muted) note(300, 0, 0.16, 0.14, 'triangle'); }
export function fanfare() {
  if (muted) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.09, 0.42, 0.24, 'triangle'));
}
