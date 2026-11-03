// Clicks are scheduled ahead on the audio clock, so they stay even while the screen is busy.

export class Metronome {
  constructor() {
    this.bpm = 80;
    this.beats = 4;
    this.running = false;
    this.onBeat = null;
    this.ctx = null;
    this.queue = [];
    this.planned = [];       // kept for checking timing
  }

  async start() {
    if (this.running) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.running = true;
    this.beat = 0;
    this.next = this.ctx.currentTime + 0.08;
    this.queue = [];
    this.planned = [];
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.frame = requestAnimationFrame(() => this.draw());
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    this.queue = [];
    this.onBeat?.(-1);
  }

  schedule() {
    while (this.next < this.ctx.currentTime + 0.14) {
      this.click(this.next, this.beat === 0);
      this.queue.push({ t: this.next, beat: this.beat });
      this.planned.push(this.next);
      if (this.planned.length > 400) this.planned.shift();
      this.next += 60 / this.bpm;
      this.beat = (this.beat + 1) % this.beats;
    }
  }

  click(t, accent) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1760 : 1245;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.95 : 0.6, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  draw() {
    if (!this.running) return;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const now = this.ctx.currentTime - latency;
    let beat = null;
    while (this.queue.length && this.queue[0].t <= now) beat = this.queue.shift().beat;
    if (beat !== null) this.onBeat?.(beat);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  dispose() {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
  }
}
