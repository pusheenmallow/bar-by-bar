// Players hear their bars from the teacher's recording, with a line moving along the music.

import { h } from './ui.js';
import { Clip } from './audio.js';
import { stretch } from './marks.js';

const SLOWEST = 0.4, FASTEST = 1.6;

export class Hearing {
  constructor(piece, sound) {
    this.piece = piece;
    this.sound = sound;
    this.clip = null;
    this.cursor = h('i', { class: 'follow', hidden: true });
  }

  static async load(piece, get) {
    if (!piece.recording) return null;
    const sound = await get('recordings', piece.id);
    return sound ? new Hearing(piece, sound) : null;
  }

  can(bars) { return !!stretch(this.piece.recording.marks, bars.map((b) => b.id)); }
  get playing() { return !!this.clip?.playing; }

  // At a metronome speed, or at the teacher's own speed when no tempo is given.
  async play(bars, { tempo = null, view = null, host = null, onEnd = null } = {}) {
    const span = stretch(this.piece.recording.marks, bars.map((b) => b.id));
    if (!span) return false;
    if (!this.clip) {
      this.clip = new Clip(this.sound.blob);
      (host || document.body).append(this.clip.el);
    }
    let rate = 1;
    if (tempo) {
      const seconds = span.starts.reduce((sum, t, k) => sum + (span.ends[k] - t), 0);
      const played = (bars.length * (this.piece.beats || 4) * 60) / Math.max(0.2, seconds);
      rate = Math.min(FASTEST, Math.max(SLOWEST, tempo / played));
      if (Math.abs(rate - 1) < 0.03) rate = 1;
    }
    if (view?.box && this.cursor.parentNode !== view.box) view.box.append(this.cursor);
    this.clip.onTick = (t) => this.follow(t, span, view);
    this.clip.onEnd = () => { this.cursor.hidden = true; onEnd?.(); };
    const started = await this.clip.play(span.from, span.to, rate);
    if (!started) this.cursor.hidden = true;
    return started;
  }

  follow(t, span, view) {
    const k = span.starts.findIndex((s, j) => t >= s && t < span.ends[j]);
    const spot = k >= 0 ? view?.spots?.[k] : null;
    if (!spot || !view.canvas.isConnected) { this.cursor.hidden = true; return; }
    const f = (t - span.starts[k]) / Math.max(0.01, span.ends[k] - span.starts[k]);
    this.cursor.hidden = false;
    Object.assign(this.cursor.style, {
      left: `${view.canvas.offsetLeft + spot.left + f * spot.width}px`,
      top: `${view.canvas.offsetTop + spot.top}px`,
      height: `${spot.height}px`,
    });
  }

  stop() {
    this.clip?.stop();
    this.cursor.hidden = true;
  }

  close() {
    this.clip?.close();
    this.clip = null;
    this.cursor.remove();
  }
}
