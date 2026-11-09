// The teacher's recording: reading it in, finding where notes start, and playing parts of it back.

import { h } from './ui.js';

export const RATE = 24000;             // plenty for a piano, and keeps recordings small
export const STEP = 0.01;              // the waveform and note starts are measured every 10 ms
const LONGEST = 15 * 60;

const MESSAGES = {
  unreadable: 'That file has no sound this tablet can read. Try an audio file, or record in the app.',
  long: 'That recording is longer than 15 minutes. Trim it to the piece first.',
  silent: 'That recording is silent.',
};

// Any audio, or the sound from a video, as one quiet-evened channel at RATE.
export async function readAudio(blob) {
  const data = await blob.arrayBuffer();
  let buffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(data);
  } catch {
    throw new Error(MESSAGES.unreadable);
  }
  if (buffer.duration > LONGEST) throw new Error(MESSAGES.long);
  const n = buffer.length;
  const pcm = new Float32Array(n);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] += ch[i] / channels;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a > peak) peak = a;
  }
  if (peak < 0.001) throw new Error(MESSAGES.silent);
  const gain = Math.min(0.89 / peak, 30);          // a quiet recording is brought up, so every bar is easy to hear
  for (let i = 0; i < n; i++) pcm[i] *= gain;
  return pcm;
}

// Plain 16-bit WAV. It is bigger than a compressed file, but it seeks to the exact bar.
export function wavBlob(pcm, rate = RATE) {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  out.setUint32(4, 36 + pcm.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] < -1 ? -1 : pcm[i] > 1 ? 1 : pcm[i];
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

// The waveform to draw, where notes start, and where the playing begins and ends.
export function analyse(pcm, rate = RATE) {
  const win = Math.round(rate * STEP);
  const count = Math.ceil(pcm.length / win);
  const level = new Float32Array(count);
  const bright = new Float32Array(count);          // the click of a hammer on a string is bright
  let prev = 0;
  for (let k = 0; k < count; k++) {
    let peak = 0, sum = 0;
    const from = k * win, to = Math.min(pcm.length, from + win);
    for (let i = from; i < to; i++) {
      const v = pcm[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      const d = v - 0.97 * prev;
      prev = v;
      sum += d * d;
    }
    level[k] = peak;
    bright[k] = Math.sqrt(sum / Math.max(1, to - from));
  }

  const peaks = new Uint8Array(count);
  for (let k = 0; k < count; k++) peaks[k] = Math.round(Math.sqrt(Math.min(1, level[k])) * 255);

  // A note starts where the bright sound jumps well above the moment before.
  let loudest = 0;
  for (let k = 0; k < count; k++) if (bright[k] > loudest) loudest = bright[k];
  const floor = loudest * 0.004 + 1e-6;
  const rise = new Float32Array(count);
  for (let k = 3; k < count; k++) {
    const before = (bright[k - 1] + bright[k - 2] + bright[k - 3]) / 3;
    const r = Math.log((bright[k] + floor) / (before + floor));
    rise[k] = r > 0 ? r : 0;
  }
  const times = [], scores = [];
  const near = 5;                                   // one note start per 50 ms
  for (let k = 3; k < count; k++) {
    if (rise[k] < 0.5 || level[k] < 0.02) continue;
    let top = true;
    for (let j = Math.max(0, k - near); j <= Math.min(count - 1, k + near) && top; j++) {
      if (rise[j] > rise[k] || (rise[j] === rise[k] && j < k)) top = false;
    }
    if (!top) continue;
    times.push(k * STEP);
    scores.push(rise[k] * Math.sqrt(level[Math.min(count - 1, k + 1)]));
  }
  const best = Math.max(1e-6, ...scores);
  const strengths = Uint8Array.from(scores, (s) => Math.round(Math.min(1, s / best) * 255));

  // The playing runs from the first clear note to where the last one has died away.
  let maxLevel = 0;
  for (let k = 0; k < count; k++) if (level[k] > maxLevel) maxLevel = level[k];
  let first = 0, last = count - 1;
  while (first < count - 1 && level[first] < maxLevel * 0.08) first++;
  while (last > first && level[last] < maxLevel * 0.04) last--;
  const duration = pcm.length / rate;
  let start = first * STEP;
  const onset = times.find((t) => t >= start - 0.12);
  if (onset !== undefined && onset < start + 0.12) start = onset;
  const end = Math.min(duration, last * STEP + 0.25);
  return { peaks, onsets: Float32Array.from(times), strengths, start, end: Math.max(end, start + 1), duration };
}

export async function prepare(blob) {
  const pcm = await readAudio(blob);
  const info = analyse(pcm);
  return { ...info, blob: wavBlob(pcm) };
}

/* ---------- recording in the app ---------- */

// Phone-call clean-up is turned off, since it spoils the sound of a piano.
export async function startRecording(onLevel) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('This browser can’t record. Choose a file instead.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    throw new Error(err?.name === 'NotAllowedError'
      ? 'The microphone isn’t allowed. Allow it for this app in the browser’s site settings, or choose a file instead.'
      : 'The microphone couldn’t start. Choose a file instead.');
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
  });

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume().catch(() => {});
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(meter);
  const wave = new Float32Array(meter.fftSize);
  let frame = 0;
  const listen = () => {
    meter.getFloatTimeDomainData(wave);
    let peak = 0;
    for (let i = 0; i < wave.length; i++) { const a = Math.abs(wave[i]); if (a > peak) peak = a; }
    onLevel(peak);
    frame = requestAnimationFrame(listen);
  };
  recorder.start(500);
  listen();

  const release = () => {
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return {
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
      return finished;
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/* ---------- playing it back ---------- */

// Plays a stretch of the recording, slowed or sped up without changing the pitch.
export class Clip {
  constructor(blob) {
    this.url = URL.createObjectURL(blob);
    this.el = h('audio', { preload: 'auto', src: this.url, class: 'clip' });
    this.el.preservesPitch = true;
    this.frame = 0;
    this.until = null;
    this.onTick = null;
    this.onEnd = null;
  }

  get playing() { return !this.el.paused; }
  get time() { return this.el.currentTime; }
  get rate() { return this.el.playbackRate; }
  set rate(value) { this.el.playbackRate = value; }

  ready() {
    if (this.el.readyState >= 1) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.el.addEventListener('loadedmetadata', () => resolve(true), { once: true });
      this.el.addEventListener('error', () => resolve(false), { once: true });
    });
  }

  async play(from, to = null, rate = 1) {
    this.halt();
    if (!(await this.ready())) return false;
    const el = this.el;
    el.playbackRate = rate;
    el.preservesPitch = true;
    el.volume = 1;
    el.currentTime = Math.max(0, from);
    this.until = to;
    try {
      await el.play();
    } catch {
      return false;
    }
    const tick = () => {
      const t = el.currentTime;
      if (this.until !== null) {
        const left = this.until - t;
        if (left <= 0.006) { this.finish(); return; }
        el.volume = Math.max(0, Math.min(1, left / (0.06 * el.playbackRate)));      // a short fade, so the cut doesn't click
      }
      if (el.paused || el.ended) { this.finish(); return; }
      this.onTick?.(t);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    return true;
  }

  halt() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.until = null;
    if (!this.el.paused) this.el.pause();
  }

  finish() {
    this.halt();
    this.onEnd?.();
  }

  stop() {
    if (this.playing || this.frame) this.finish();
  }

  close() {
    this.halt();
    this.onEnd = null;
    this.onTick = null;
    this.el.removeAttribute('src');
    this.el.load();
    this.el.remove();
    URL.revokeObjectURL(this.url);
  }
}
