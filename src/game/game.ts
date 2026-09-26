import type { Difficulty, Grade, SongRecord } from '../types';
import { audioCtx } from '../audio/engine';
import { keyLabel, settings } from '../lib/settings';
import { escapeHtml } from '../lib/util';
import { Renderer, type Judgment, type RNote } from './render';

export const WINDOWS = { perfect: 0.05, great: 0.1, okay: 0.145 };
const WEIGHT: Record<Judgment, number> = { perfect: 1, great: 0.7, okay: 0.4, miss: 0 };
const HOLD_RELEASE_GRACE = 0.16;

export interface GameResult {
  difficulty: Difficulty;
  score: number;
  accuracy: number;
  grade: Grade;
  maxCombo: number;
  total: number;
  counts: Record<Judgment, number>;
  fullCombo: boolean;
  allPerfect: boolean;
  meanErrorMs: number;
  errors: number[];
}

export interface GameOptions {
  song: SongRecord;
  buffer: AudioBuffer;
  difficulty: Difficulty;
  mount: HTMLElement;
  onFinish: (r: GameResult) => void;
  onQuit: () => void;
}

export function gradeFor(accuracy: number, fullCombo: boolean): Grade {
  if (accuracy >= 0.99 && fullCombo) return 'SS';
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.9) return 'A';
  if (accuracy >= 0.8) return 'B';
  if (accuracy >= 0.7) return 'C';
  return 'D';
}

export class Game {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private hud: Record<'score' | 'acc' | 'bar' | 'overlay' | 'count', HTMLElement>;

  private notes: RNote[] = [];
  private lanes: RNote[][] = [[], [], [], []];
  private cursor = [0, 0, 0, 0];
  private from = 0;
  private total = 0;
  private endTime = 0;
  private leadIn = 2.4;
  private lookahead = 1.2;

  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private analyser: AnalyserNode;
  private freq: Uint8Array<ArrayBuffer>;
  private startAt = 0;
  private clockOffset = NaN;
  private bass = 0;
  private lastFrame = 0;
  private frameMs = 16.7;

  private pressed = [false, false, false, false];
  private holding: (RNote | null)[] = [null, null, null, null];
  private lastSpark = 0;
  private lastHitT = -1;
  private pointerLanes = new Map<number, number>();

  private combo = 0;
  private maxCombo = 0;
  private counts: Record<Judgment, number> = { perfect: 0, great: 0, okay: 0, miss: 0 };
  private judged = 0;
  private weightSum = 0;
  private errors: number[] = [];
  private shownScore = 0;

  private raf = 0;
  private paused = false;
  private frozenT = 0;
  private resuming = false;
  private finished = false;
  private fading = false;
  private disposers: (() => void)[] = [];

  constructor(private opts: GameOptions) {
    const { song, difficulty } = opts;
    const chart = song.analysis.charts[difficulty];
    this.el = document.createElement('div');
    this.el.className = 'game';
    this.el.innerHTML = `
      <canvas class="game-canvas"></canvas>
      <div class="hud">
        <div class="hud-progress"><div class="hud-bar"></div></div>
        <div class="hud-left">
          <div class="hud-title">${escapeHtml(song.title)}</div>
          <div class="hud-sub"><span class="diff-chip diff-${difficulty}">${difficulty}</span> ★ ${chart.stars}</div>
        </div>
        <div class="hud-right">
          <div class="hud-score">0000000</div>
          <div class="hud-acc">100.00%</div>
        </div>
        <div class="hud-hint">esc to pause</div>
      </div>
      <div class="game-count"></div>
      <div class="pause-overlay hidden">
        <div class="pause-card">
          <div class="pause-title">paused</div>
          <button class="btn btn-pink" data-act="resume">resume <kbd>esc</kbd></button>
          <button class="btn" data-act="restart">restart <kbd>R</kbd></button>
          <button class="btn btn-ghost" data-act="quit">quit <kbd>Q</kbd></button>
        </div>
      </div>`;
    opts.mount.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.renderer = new Renderer(this.canvas);
    this.hud = {
      score: this.el.querySelector('.hud-score')!,
      acc: this.el.querySelector('.hud-acc')!,
      bar: this.el.querySelector('.hud-bar')!,
      overlay: this.el.querySelector('.pause-overlay')!,
      count: this.el.querySelector('.game-count')!,
    };

    const ctx = audioCtx();
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.gain.connect(this.analyser).connect(ctx.destination);

    this.bindInput();
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    const chart = this.opts.song.analysis.charts[this.opts.difficulty];
    this.notes = chart.notes.map((n) => ({ ...n, state: 'pending' as const }));
    this.lanes = [[], [], [], []];
    for (const n of this.notes) this.lanes[n.lane].push(n);
    this.cursor = [0, 0, 0, 0];
    this.from = 0;
    this.total = this.notes.reduce((s, n) => s + (n.end !== undefined ? 2 : 1), 0);
    const last = this.notes.reduce((m, n) => Math.max(m, n.end ?? n.t), 0);
    this.endTime = Math.min(this.opts.buffer.duration, last + 2.5);
    this.lookahead = 6 / settings.speed;
    const first = this.notes[0]?.t ?? 0;
    this.leadIn = Math.max(2.4, this.lookahead + 0.8 - first);

    this.combo = this.maxCombo = this.judged = this.weightSum = this.shownScore = 0;
    this.counts = { perfect: 0, great: 0, okay: 0, miss: 0 };
    this.errors = [];
    this.holding = [null, null, null, null];
    this.finished = this.fading = this.paused = this.resuming = false;
    this.hud.overlay.classList.add('hidden');

    const ctx = audioCtx();
    this.source?.stop();
    this.source?.disconnect();
    this.source = ctx.createBufferSource();
    this.source.buffer = this.opts.buffer;
    this.source.connect(this.gain);
    this.gain.gain.cancelScheduledValues(0);
    this.gain.gain.value = settings.musicVolume;
    this.startAt = ctx.currentTime + this.leadIn;
    this.source.start(this.startAt);
    this.clockOffset = NaN;

    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      this.frame(now);
      if (!this.finished) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.finished = true;
    try {
      this.source?.stop();
    } catch {}
    this.source?.disconnect();
    this.gain.disconnect();
    this.analyser.disconnect();
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    this.disposers.forEach((d) => d());
    this.el.remove();
  }

  // ------------------------------------------------------------- clock

  private syncClock() {
    const ctx = audioCtx();
    const perf = performance.now() / 1000;
    const ts = ctx.getOutputTimestamp?.();
    let raw: number;
    if (ts && ts.contextTime && ts.performanceTime) {
      raw = ts.contextTime - this.startAt - ts.performanceTime / 1000;
    } else {
      raw = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - this.startAt - perf;
    }
    if (Number.isNaN(this.clockOffset) || Math.abs(raw - this.clockOffset) > 0.04) this.clockOffset = raw;
    else this.clockOffset += (raw - this.clockOffset) * 0.04;
  }

  private songTime(perfMs: number) {
    if (this.paused) return this.frozenT;
    return perfMs / 1000 + this.clockOffset - settings.offsetMs / 1000;
  }

  // ------------------------------------------------------------- loop

  private frame(now: number) {
    if (!this.paused) this.syncClock();
    const t = this.songTime(now);
    // A frame drawn now reaches the screen one refresh later, so draw where the song will
    // be then; otherwise notes look a frame behind the music. Judging still uses real time.
    if (this.lastFrame) this.frameMs += (Math.min(50, now - this.lastFrame) - this.frameMs) * 0.05;
    this.lastFrame = now;
    const drawT = this.paused ? t : t + this.frameMs / 1000;

    if (!this.paused) {
      this.processMisses(t);
      this.processHolds(t, now);
      if (t >= this.endTime - 1.2 && !this.fading) {
        this.fading = true;
        const ctx = audioCtx();
        this.gain.gain.setValueAtTime(this.gain.gain.value, ctx.currentTime);
        this.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
      }
      if (t >= this.endTime) return this.finish();
    }

    while (this.from < this.notes.length) {
      const n = this.notes[this.from];
      const settled = n.state === 'done' || n.state === 'missed' || n.state === 'dropped';
      if (settled && (n.end ?? n.t) < t - 0.6) this.from++;
      else break;
    }

    this.analyser.getByteFrequencyData(this.freq);
    let b = 0;
    for (let i = 1; i < 5; i++) b += this.freq[i];
    const level = Math.max(0, (b / 4 / 255 - 0.5) / 0.5);
    this.bass += (level - this.bass) * 0.3;

    this.renderer.draw({
      t: drawT,
      lookahead: this.lookahead,
      notes: this.notes,
      from: this.from,
      beats: this.opts.song.analysis.beats,
      downbeat: this.opts.song.analysis.downbeat,
      pressed: this.pressed,
      combo: this.combo,
      keyLabels: settings.keys.map(keyLabel),
      bass: this.paused ? 0 : this.bass,
      effects: settings.effects,
      showTiming: settings.showTiming,
    });
    this.updateHud(t);
  }

  private processMisses(t: number) {
    for (let l = 0; l < 4; l++) {
      const lane = this.lanes[l];
      while (this.cursor[l] < lane.length && lane[this.cursor[l]].state !== 'pending') this.cursor[l]++;
      let i = this.cursor[l];
      while (i < lane.length && lane[i].state === 'pending' && t - lane[i].t > WINDOWS.okay) {
        const n = lane[i];
        n.state = 'missed';
        this.register('miss', l, 0);
        if (n.end !== undefined) this.register('miss', l, 0, true);
        i++;
      }
    }
  }

  private processHolds(t: number, now: number) {
    for (let l = 0; l < 4; l++) {
      const h = this.holding[l];
      if (!h) continue;
      if (t >= h.end!) {
        h.state = 'done';
        this.holding[l] = null;
        this.register('perfect', l, 0, true);
      } else if (!this.pressed[l]) {
        this.release(l, t);
      } else if (now - this.lastSpark > 45) {
        this.lastSpark = now;
        if (settings.effects) this.renderer.holdSpark(l);
      }
    }
  }

  // ------------------------------------------------------------- judging

  private press(lane: number, perfMs: number) {
    if (this.paused || this.finished) {
      this.pressed[lane] = true;
      return;
    }
    this.pressed[lane] = true;
    if (this.holding[lane]) return;
    const t = this.songTime(perfMs);
    const notes = this.lanes[lane];
    let i = this.cursor[lane];
    while (i < notes.length && notes[i].state !== 'pending') i++;
    const n = notes[i];
    if (!n) return;
    const err = t - n.t;
    if (err < -WINDOWS.okay || err > WINDOWS.okay) return;
    const a = Math.abs(err);
    const kind: Judgment = a <= WINDOWS.perfect ? 'perfect' : a <= WINDOWS.great ? 'great' : 'okay';
    if (n.end !== undefined) {
      n.state = 'holding';
      this.holding[lane] = n;
    } else n.state = 'done';
    const chord = this.lastHitT === n.t;
    this.lastHitT = n.t;
    this.register(kind, lane, err, false, chord);
  }

  private release(lane: number, t: number) {
    this.pressed[lane] = false;
    const h = this.holding[lane];
    if (!h) return;
    this.holding[lane] = null;
    if (t >= h.end! - HOLD_RELEASE_GRACE) {
      h.state = 'done';
      this.register('perfect', lane, 0, true);
    } else {
      h.state = 'dropped';
      this.register('miss', lane, 0, true);
    }
  }

  private register(kind: Judgment, lane: number, err: number, tail = false, chord = false) {
    this.counts[kind]++;
    this.judged++;
    this.weightSum += WEIGHT[kind];
    if (kind === 'miss') {
      const broke = this.combo >= 10;
      this.combo = 0;
      this.renderer.miss(lane, broke);
      return;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (!tail) this.errors.push(Math.round(err * 1000));
    if (tail) this.renderer.hit(lane, kind, 0);
    else this.renderer.hit(lane, kind, err, chord);
    if (this.combo % 50 === 0) this.renderer.celebrate(this.combo);
  }

  private score() {
    if (!this.total) return 0;
    return Math.round(1_000_000 * (0.85 * (this.weightSum / this.total) + 0.15 * (this.maxCombo / this.total)));
  }

  private accuracy() {
    return this.judged ? this.weightSum / this.judged : 1;
  }

  private updateHud(t: number) {
    const target = this.score();
    this.shownScore += (target - this.shownScore) * 0.25;
    if (Math.abs(target - this.shownScore) < 1) this.shownScore = target;
    this.hud.score.textContent = String(Math.round(this.shownScore)).padStart(7, '0');
    this.hud.acc.textContent = `${(this.accuracy() * 100).toFixed(2)}%`;
    this.hud.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, t / this.endTime))})`;

    if (this.resuming) return;
    const c = this.hud.count;
    if (t < -0.5) this.setCount(t < -1.4 ? 'ready?' : 'set', 'count-ready');
    else if (t < 0.35) this.setCount('go!', 'count-go');
    else if (c.textContent) this.setCount('', '');
  }

  private setCount(text: string, cls: string) {
    const c = this.hud.count;
    if (c.textContent === text) return;
    c.textContent = text;
    c.className = `game-count ${cls}`;
  }

  // ------------------------------------------------------------- pause / end

  pause() {
    if (this.paused || this.finished) return;
    this.frozenT = this.songTime(performance.now());
    this.paused = true;
    this.resuming = false;
    audioCtx().suspend();
    this.pressed = [false, false, false, false];
    this.hud.overlay.classList.remove('hidden');
    this.setCount('', '');
  }

  private resume() {
    if (!this.paused || this.resuming) return;
    this.resuming = true;
    this.hud.overlay.classList.add('hidden');
    const steps = ['3', '2', '1'];
    let i = 0;
    const tick = () => {
      if (!this.paused || !this.resuming) return;
      if (i < steps.length) {
        this.setCount(steps[i++], 'count-num');
        setTimeout(tick, 420);
      } else {
        this.setCount('', '');
        this.resuming = false;
        this.paused = false;
        this.clockOffset = NaN;
        audioCtx().resume();
      }
    };
    tick();
  }

  private restart() {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    this.start();
  }

  private quit() {
    this.destroy();
    this.opts.onQuit();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const accuracy = this.accuracy();
    const fullCombo = this.counts.miss === 0 && this.total > 0;
    const errs = this.errors;
    const result: GameResult = {
      difficulty: this.opts.difficulty,
      score: this.score(),
      accuracy,
      grade: gradeFor(accuracy, fullCombo),
      maxCombo: this.maxCombo,
      total: this.total,
      counts: { ...this.counts },
      fullCombo,
      allPerfect: fullCombo && this.counts.great === 0 && this.counts.okay === 0,
      meanErrorMs: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0,
      errors: errs,
    };
    this.destroy();
    this.opts.onFinish(result);
  }

  // ------------------------------------------------------------- input

  private bindInput() {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      this.disposers.push(() => window.removeEventListener(type, fn));
    };

    on('keydown', (e) => {
      const lane = settings.keys.indexOf(e.code);
      if (this.paused && !this.resuming) {
        if (e.code === 'Escape' || e.code === 'Enter') this.resume();
        else if (e.code === 'KeyR') this.restart();
        else if (e.code === 'KeyQ') this.quit();
        e.preventDefault();
        return;
      }
      if (e.code === 'Escape') {
        this.pause();
        e.preventDefault();
        return;
      }
      if (lane < 0) return;
      e.preventDefault();
      if (e.repeat) return;
      this.press(lane, e.timeStamp);
    });

    on('keyup', (e) => {
      const lane = settings.keys.indexOf(e.code);
      if (lane < 0) return;
      e.preventDefault();
      this.release(lane, this.songTime(e.timeStamp));
    });

    on('blur', () => this.pause());
    on('resize', () => this.renderer.resize());
    const vis = () => document.hidden && this.pause();
    document.addEventListener('visibilitychange', vis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', vis));

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const lane = this.renderer.laneAtX(e.offsetX);
      this.pointerLanes.set(e.pointerId, lane);
      this.canvas.setPointerCapture(e.pointerId);
      this.press(lane, e.timeStamp);
    });
    const up = (e: PointerEvent) => {
      const lane = this.pointerLanes.get(e.pointerId);
      if (lane === undefined) return;
      this.pointerLanes.delete(e.pointerId);
      this.release(lane, this.songTime(e.timeStamp));
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    this.el.querySelector('.pause-card')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'resume') this.resume();
      if (act === 'restart') this.restart();
      if (act === 'quit') this.quit();
    });
  }
}
