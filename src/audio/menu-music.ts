import type { SongRecord } from '../types';
import { settings } from '../lib/settings';
import { audioCtx } from './engine';

const FADE = 0.5;

/** Background music for the menus: loops a song from its chorus-ish middle, with an analyser for the visualizer. */
export class MenuMusic {
  song: SongRecord | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(512);
  private startAt = 0;
  private from = 0;
  private duration = 0;
  paused = false;

  get playing() {
    return !!this.src && !this.paused;
  }

  play(song: SongRecord, buffer: AudioBuffer) {
    const ctx = audioCtx();
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.75;
      this.analyser.connect(ctx.destination);
    }
    this.fadeOut();
    // start on a downbeat about a third of the way in, where songs usually get going
    const { beats, downbeat } = song.analysis;
    let from = buffer.duration * 0.33;
    for (let i = downbeat; i < beats.length; i += 4) {
      if (beats[i] >= from) {
        from = beats[i];
        break;
      }
    }
    if (from > buffer.duration - 8) from = 0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(settings.musicVolume * 0.7, ctx.currentTime + FADE);
    gain.connect(this.analyser);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = from;
    src.loopEnd = buffer.duration;
    src.connect(gain);
    src.start(ctx.currentTime, from);

    this.src = src;
    this.gain = gain;
    this.song = song;
    this.startAt = ctx.currentTime;
    this.from = from;
    this.duration = buffer.duration;
    this.paused = false;
  }

  private fadeOut() {
    const { src, gain } = this;
    if (!src || !gain) return;
    const now = audioCtx().currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE * 0.6);
    src.stop(now + FADE * 0.6);
    src.onended = () => gain.disconnect();
    this.src = this.gain = null;
  }

  stop() {
    this.fadeOut();
    this.song = null;
    this.paused = false;
  }

  /** Pausing just mutes: the preview is a loop, so where it picks back up doesn't matter. */
  togglePause() {
    if (!this.src || !this.gain) return;
    this.paused = !this.paused;
    const now = audioCtx().currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(this.paused ? 0 : settings.musicVolume * 0.7, now + 0.25);
  }

  /** Seconds into the song, following the loop. */
  position() {
    if (!this.src) return 0;
    const t = audioCtx().currentTime - this.startAt;
    const first = this.duration - this.from;
    return this.from + (first > 0 ? t % first : t);
  }

  /** 0..1 decaying kick on each beat, stronger on downbeats. */
  pulse(): number {
    if (!this.src || !this.song || this.paused) return 0;
    const { beats, downbeat } = this.song.analysis;
    const t = this.position();
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (beats[m] <= t) lo = m + 1;
      else hi = m;
    }
    const i = lo - 1;
    if (i < 0) return 0;
    return Math.exp(-(t - beats[i]) * 8) * ((i - downbeat) % 4 === 0 ? 1 : 0.6);
  }

  /** Log-spaced spectrum, 0..1, written into `out`. */
  levels(out: Float32Array) {
    if (!this.analyser || !this.src || this.paused) {
      out.fill(0);
      return;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const n = out.length;
    const maxBin = 300;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(maxBin, i / n));
      const b = Math.max(a + 1, Math.floor(Math.pow(maxBin, (i + 1) / n)));
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, this.freq[k]);
      out[i] = m / 255;
    }
  }
}
