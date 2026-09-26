import { Renderer, type RNote } from '../game/render';
import { keyLabel, settings } from '../lib/settings';
import type { Lane } from '../types';

const BEAT = 60 / 124;

/** Arcade-style "demo play": the real track renderer autoplaying a generated pattern behind the menu. */
export class Attract {
  private renderer: Renderer;
  private notes: RNote[] = [];
  private beats: number[] = [];
  private generatedUntil = 1;
  private t0 = performance.now();
  private raf = 0;
  private running = false;
  private pressedUntil = [0, 0, 0, 0];
  private combo = 0;
  private seed = 7;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, { centerX: 0.7, hud: false });
    window.addEventListener('resize', () => this.running && this.renderer.resize());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.renderer.resize();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private generate(until: number) {
    while (this.generatedUntil < until) {
      const bar = this.generatedUntil;
      for (let b = 0; b < 4; b++) this.beats.push(bar + b * BEAT);
      let prev = Math.floor(this.rand() * 4);
      let busy = -1;
      let busyUntil = 0;
      for (let step = 0; step < 8; step++) {
        const t = bar + (step * BEAT) / 2;
        const onBeat = step % 2 === 0;
        if (onBeat ? this.rand() < 0.08 : this.rand() < 0.5) continue;
        let lane = (prev + 1 + Math.floor(this.rand() * 3)) % 4;
        if (lane === busy && t < busyUntil) lane = (lane + 2) % 4;
        const note: RNote = { t, lane: lane as Lane, state: 'pending' };
        if (step === 0 && this.rand() < 0.35) {
          note.end = t + BEAT * 1.5;
          busy = lane;
          busyUntil = note.end + 0.05;
        }
        this.notes.push(note);
        if (step % 4 === 0 && this.rand() < 0.3) {
          const other = ((lane < 2 ? 2 : 0) + Math.floor(this.rand() * 2)) as Lane;
          if (!(other === busy && t < busyUntil)) this.notes.push({ t, lane: other, state: 'pending' });
        }
        prev = lane;
      }
      this.generatedUntil += 4 * BEAT;
    }
  }

  private frame(now: number) {
    const t = (now - this.t0) / 1000;
    this.generate(t + 3);
    this.notes = this.notes.filter((n) => (n.end ?? n.t) > t - 1);
    while (this.beats.length > 8 && this.beats[4] < t - 1) this.beats.splice(0, 4);

    for (const n of this.notes) {
      if (n.state === 'pending' && n.t <= t) {
        n.state = n.end !== undefined ? 'holding' : 'done';
        this.renderer.hit(n.lane, this.rand() < 0.82 ? 'perfect' : 'great', 0);
        this.pressedUntil[n.lane] = n.end ?? t + 0.09;
        if (++this.combo % 50 === 0) this.renderer.celebrate(this.combo);
        if (this.combo >= 160) this.combo = 0;
      } else if (n.state === 'holding') {
        if (t >= n.end!) {
          n.state = 'done';
          this.renderer.hit(n.lane, 'perfect', 0);
          this.combo++;
        } else if (settings.effects && this.rand() < 0.3) this.renderer.holdSpark(n.lane);
      }
    }

    const pulse = Math.exp(-((t - 1 + BEAT * 100) % BEAT) * 7);
    document.documentElement.style.setProperty('--pulse', pulse.toFixed(3));

    this.renderer.draw({
      t,
      lookahead: 1.3,
      notes: this.notes,
      from: 0,
      beats: this.beats,
      downbeat: 0,
      pressed: this.pressedUntil.map((u) => u > t),
      combo: this.combo,
      keyLabels: settings.keys.map(keyLabel),
      bass: pulse * 0.5,
      effects: settings.effects,
      showTiming: false,
    });
  }
}
