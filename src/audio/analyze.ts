import type { Analysis, ChartInfo, Difficulty, Lane, Note } from '../types';

/** Bump when chart generation changes so stored songs get re-analyzed. */
export const ANALYZER_VERSION = 3;

export type ProgressFn = (stage: string, pct: number) => void;

const N = 1024;
const HOP = 256;

// ---------------------------------------------------------------- dsp utils

function makeFFT(n: number) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return (re: Float32Array, im: Float32Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
}

function movingMean(x: Float32Array, before: number, after: number): Float32Array {
  const n = x.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - before);
    const b = Math.min(n, i + after + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

function lowerBound(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------- features

interface Features {
  fps: number;
  frames: number;
  /** spectral flux per band: sub/kick, low-mid, mid/snare, high/hats */
  flux: Float32Array[];
  /** log energy of the tonal range, for sustain detection */
  tonal: Float32Array;
  centroid: Float32Array;
  rms: Float32Array;
  /** how much the set of sounding pitches changed: new melody/vocal notes, not drums */
  pitch: Float32Array;
}

function extractFeatures(x: Float32Array, sr: number, progress: ProgressFn): Features {
  const frames = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const fft = makeFFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const bin = (hz: number) => Math.min(N / 2, Math.max(1, Math.round((hz * N) / sr)));
  const edges = [bin(30), bin(150), bin(600), bin(3000), bin(10000)];
  const tonalLo = bin(150);
  const tonalHi = bin(3000);
  // pitch class (0-11) of each bin in the melodic range, for chroma
  const chromaLo = bin(200);
  const chromaHi = bin(2000);
  const pc = new Int8Array(N / 2 + 1);
  for (let k = chromaLo; k < chromaHi; k++) pc[k] = (((Math.round(12 * Math.log2((k * sr) / N / 440)) % 12) + 12) % 12);
  const K = chromaHi - chromaLo;
  const melMag = new Float32Array(frames * K); // magnitudes in the melodic range, kept for HPSS

  const flux = [0, 1, 2, 3].map(() => new Float32Array(frames));
  const tonal = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const rms = new Float32Array(frames);

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const half = N / 2 + 1;
  let prev = new Float32Array(half);
  let cur = new Float32Array(half);
  const binHz = sr / N;
  const reportEvery = Math.max(1, Math.floor(frames / 40));

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let sq = 0;
    for (let i = 0; i < N; i++) {
      const s = x[off + i] ?? 0;
      sq += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(sq / N);
    fft(re, im);

    let tonalSum = 0;
    let cNum = 0;
    let cDen = 0;

    for (let k = 0; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      cur[k] = Math.log1p(10 * mag);
      if (k >= tonalLo && k < tonalHi) tonalSum += mag;
      if (k >= chromaLo && k < chromaHi) melMag[f * K + k - chromaLo] = mag;
      if (k >= tonalLo && k < edges[4]) {
        cNum += mag * k * binHz;
        cDen += mag;
      }
    }
    tonal[f] = Math.log1p(tonalSum);
    if (f > 0) {
      for (let b = 0; b < 4; b++) {
        let sum = 0;
        for (let k = edges[b]; k < edges[b + 1]; k++) {
          // "superflux": compare against the max of neighbouring bins to ignore vibrato
          const p = Math.max(prev[k - 1] ?? 0, prev[k], prev[k + 1] ?? 0);
          const d = cur[k] - p;
          if (d > 0) sum += d;
        }
        flux[b][f] = sum;
      }
    }
    const t = prev;
    prev = cur;
    cur = t;
    if (f % reportEvery === 0) progress('listening', f / frames);
  }
  const pitch = pitchChange(melMag, frames, K, chromaLo, pc);
  return { fps: sr / HOP, frames, flux, tonal, centroid, rms, pitch };
}

/**
 * Melody onsets: how much the set of sounding pitches changes. Drum hits are removed first
 * by keeping each bin's median over ~120ms (a tone lasts, a drum transient doesn't), then
 * chroma is compared as a distribution so loudness alone doesn't count as change.
 */
function pitchChange(mag: Float32Array, frames: number, K: number, lo: number, pc: Int8Array): Float32Array {
  const R = 5;
  const harm = new Float32Array(frames * K);
  const win = new Float32Array(2 * R + 1);
  for (let k = 0; k < K; k++) {
    for (let f = 0; f < frames; f++) {
      let n = 0;
      for (let j = Math.max(0, f - R); j <= Math.min(frames - 1, f + R); j++) win[n++] = mag[j * K + k];
      const w = win.subarray(0, n).sort();
      harm[f * K + k] = w[n >> 1];
    }
  }
  const out = new Float32Array(frames);
  const energy = new Float32Array(frames);
  let prev = new Float32Array(12);
  let cur = new Float32Array(12);
  for (let f = 0; f < frames; f++) {
    cur.fill(0);
    for (let k = 0; k < K; k++) {
      const m = harm[f * K + k];
      cur[pc[k + lo]] += m * m;
    }
    let sum = 0;
    for (let c = 0; c < 12; c++) sum += cur[c];
    energy[f] = sum;
    if (sum > 1e-9) {
      for (let c = 0; c < 12; c++) cur[c] /= sum;
      if (f > 0) for (let c = 0; c < 12; c++) out[f] += Math.max(0, cur[c] - prev[c]);
      // a new note adds tone; a fading one only shifts the balance — don't count fades
      if (energy[f] < energy[f - 1] * 0.98) out[f] *= 0.2;
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  // near-silent frames have meaningless chroma: scale change by how much tone is present
  const eMed = median(Array.from(energy).filter((e) => e > 1e-9)) || 1;
  for (let f = 0; f < frames; f++) out[f] *= Math.min(1.5, Math.sqrt(energy[f] / eMed));
  return out;
}

// ---------------------------------------------------------------- tempo & beats

function estimateTempo(env: Float32Array, fps: number): number {
  const n = env.length;
  const minLag = Math.max(2, Math.floor((fps * 60) / 220));
  const maxLag = Math.min(n - 1, Math.ceil((fps * 60) / 55));
  if (maxLag <= minLag) return 120;
  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    s /= n - lag;
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    score[lag] = s * w;
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score[lag] > score[best]) best = lag;
  // parabolic refinement
  const a = score[best - 1] ?? score[best];
  const b = score[best];
  const c = score[best + 1] ?? score[best];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  let bpm = (60 * fps) / (best + shift);
  // Denser grids snap better than sparse ones, so lean toward the faster reading.
  while (bpm < 85) bpm *= 2;
  while (bpm > 195) bpm /= 2;
  return bpm;
}

/** Dynamic-programming beat tracker (Ellis 2007). Returns beat frame indices. */
function trackBeats(env: Float32Array, fps: number, bpm: number): number[] {
  const n = env.length;
  const period = (fps * 60) / bpm;
  const smoothW = Math.max(1, Math.round(period / 16));
  const local = movingMean(env, smoothW, smoothW);
  const tightness = 100;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(2 * period);
  const hi = Math.max(1, Math.round(period / 2));
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let arg = -1;
    for (let j = Math.max(0, i - lo); j <= i - hi; j++) {
      const r = Math.log((i - j) / period);
      const s = cum[j] - tightness * r * r;
      if (s > best) {
        best = s;
        arg = j;
      }
    }
    cum[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  let last = Math.max(0, n - Math.round(2 * period));
  for (let i = last; i < n; i++) if (cum[i] > cum[last]) last = i;
  const beats: number[] = [];
  for (let i = last; i >= 0; i = back[i]) beats.push(i);
  return beats.reverse();
}

/**
 * Frames are ~12ms wide, so a spectral-flux peak only says "somewhere in here".
 * Look at the raw samples in 2ms blocks and return where the energy actually jumps.
 */
function refineOnset(x: Float32Array, sr: number, t: number): number {
  const B = Math.max(8, Math.round(sr * 0.002));
  const a = Math.max(0, Math.round((t - 0.045) * sr));
  const blocks = Math.floor((Math.min(x.length, Math.round((t + 0.03) * sr)) - a) / B);
  if (blocks < 4) return t;
  const e = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    for (let i = 0; i < B; i++) {
      const v = x[a + b * B + i];
      sum += v * v;
    }
    e[b] = Math.log(sum / B + 1e-9);
  }
  let best = -Infinity;
  let arg = -1;
  for (let b = 2; b < blocks; b++) {
    const d = e[b] - e[b - 2];
    if (d > best) {
      best = d;
      arg = b;
    }
  }
  // ponytail: fixed jump threshold; soft attacks (pads, swells) fall back to the frame time
  return best > 0.7 ? (a + (arg - 1) * B) / sr : t;
}

function lineFit(xs: number[], ys: number[]): { a: number; p: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const p = den > 0 ? num / den : 0;
  return { a: my - p * mx, p };
}

/**
 * Tracked beats jitter by a frame or two. Pull each onto the nearest real attack,
 * then fit a straight tempo line (steady songs) or a sliding local line (live/tempo drift),
 * so the grid every note snaps to is evenly spaced.
 */
function fitBeats(beats: number[], attacks: number[], period: number): number[] {
  if (beats.length < 8) return beats;
  const pulled = beats.map((b) => {
    const i = lowerBound(attacks, b);
    let best = b;
    let d = period / 6;
    for (const o of [attacks[i - 1], attacks[i]]) {
      if (o !== undefined && Math.abs(o - b) < d) {
        d = Math.abs(o - b);
        best = o;
      }
    }
    return best;
  });
  // beat numbers: the tracker can skip or double a beat
  const k = [0];
  for (let i = 1; i < pulled.length; i++) k.push(k[i - 1] + Math.max(1, Math.round((pulled[i] - pulled[i - 1]) / period)));
  const last = k[k.length - 1];

  const global = lineFit(k, pulled);
  const resid = pulled.map((t, i) => Math.abs(t - (global.a + global.p * k[i])));
  if (quantile(resid, 0.9) < 0.02) return Array.from({ length: last + 1 }, (_, j) => global.a + global.p * j);

  const out: number[] = [];
  for (let j = 0, i = 0; j <= last; j++) {
    while (i < k.length - 1 && k[i + 1] <= j) i++;
    const lo = Math.max(0, i - 4);
    const hi = Math.min(k.length, i + 5);
    const f = lineFit(k.slice(lo, hi), pulled.slice(lo, hi));
    out.push(f.a + f.p * j);
  }
  return out;
}

// ---------------------------------------------------------------- onsets

interface Onset {
  t: number;
  frame: number;
  strength: number;
  centroid: number;
  /** how strongly the melody/vocal changed pitch here (0 = drums only) */
  melody: number;
  level: number;
  score: number;
}

interface GridPoint {
  t: number;
  level: number;
  beatDur: number;
}

function buildGrid(beats: number[], duration: number): GridPoint[] {
  const grid: GridPoint[] = [];
  if (beats.length < 2) {
    for (let t = 0; t < duration; t += 0.125) grid.push({ t, level: [0, 2, 1, 2][Math.round(t / 0.125) % 4], beatDur: 0.5 });
    return grid;
  }
  const intervals = beats.slice(1).map((b, i) => b - beats[i]);
  const med = median(intervals);
  const ext = [...beats];
  while (ext[0] - med > -med) ext.unshift(ext[0] - med);
  while (ext[ext.length - 1] < duration + med) ext.push(ext[ext.length - 1] + med);
  for (let i = 0; i < ext.length - 1; i++) {
    const d = ext[i + 1] - ext[i];
    for (let k = 0; k < 4; k++) grid.push({ t: ext[i] + (k * d) / 4, level: k === 0 ? 0 : k === 2 ? 1 : 2, beatDur: d });
  }
  return grid;
}

const gridTimes = new WeakMap<GridPoint[], Float64Array>();

function nearestGrid(grid: GridPoint[], t: number): GridPoint {
  let times = gridTimes.get(grid);
  if (!times) {
    times = Float64Array.from(grid, (g) => g.t);
    gridTimes.set(grid, times);
  }
  const i = lowerBound(times, t);
  const a = grid[Math.max(0, i - 1)];
  const b = grid[Math.min(grid.length - 1, i)];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

// ---------------------------------------------------------------- charts

interface DiffConfig {
  minGap: number;
  minGapBeats: number;
  keepFrac: number;
  chordFrac: number;
  fillBeats: number;
  holdMinBeats: number;
  holdCooldownBeats: number;
  holdMaxBeats: number;
  /** holds may overlap notes in other lanes */
  holdOverlap: boolean;
  jackGap: number;
  /** how much drum hits vs melody notes count; the easy charts follow the tune */
  drumWeight: number;
  melodyWeight: number;
}

const CONFIGS: Record<Difficulty, DiffConfig> = {
  easy: {
    minGap: 0.42,
    minGapBeats: 0.98,
    keepFrac: 0.6,
    chordFrac: 0,
    fillBeats: 2,
    holdMinBeats: 1.5,
    holdCooldownBeats: 6,
    holdMaxBeats: 3,
    holdOverlap: false,
    jackGap: 0.4,
    drumWeight: 0.5,
    melodyWeight: 2.5,
  },
  normal: {
    minGap: 0.24,
    minGapBeats: 0.49,
    keepFrac: 0.78,
    chordFrac: 0.05,
    fillBeats: 2,
    holdMinBeats: 1,
    holdCooldownBeats: 4,
    holdMaxBeats: 4,
    holdOverlap: false,
    jackGap: 0.3,
    drumWeight: 0.75,
    melodyWeight: 1.8,
  },
  hard: {
    minGap: 0.15,
    minGapBeats: 0.24,
    keepFrac: 0.9,
    chordFrac: 0.1,
    fillBeats: 1.5,
    holdMinBeats: 1,
    holdCooldownBeats: 3,
    holdMaxBeats: 3,
    holdOverlap: true,
    jackGap: 0.24,
    drumWeight: 1,
    melodyWeight: 1.3,
  },
  expert: {
    minGap: 0.1,
    minGapBeats: 0.24,
    keepFrac: 1,
    chordFrac: 0.16,
    fillBeats: 1.5,
    holdMinBeats: 1,
    holdCooldownBeats: 2,
    holdMaxBeats: 3,
    holdOverlap: true,
    jackGap: 0.18,
    drumWeight: 1,
    melodyWeight: 1,
  },
};

const LEVEL_WEIGHT = [1.3, 1.12, 1];

interface Context {
  feats: Features;
  onsets: Onset[];
  grid: GridPoint[];
  beats: number[];
}

function selectTimes(ctx: Context, cfg: DiffConfig): Onset[] {
  const score = (o: Onset) => LEVEL_WEIGHT[o.level] * (o.strength * cfg.drumWeight + o.melody * cfg.melodyWeight);
  const pool = ctx.onsets;
  const cut = quantile(pool.map(score), 1 - cfg.keepFrac);
  const sorted = pool.filter((o) => score(o) >= cut).sort((a, b) => score(b) - score(a));
  const accepted: Onset[] = [];
  const times: number[] = [];
  const gapAt = (t: number) => Math.max(cfg.minGap, cfg.minGapBeats * nearestGrid(ctx.grid, t).beatDur);
  const fits = (t: number) => {
    const i = lowerBound(times, t);
    const g = gapAt(t) - 1e-3;
    return (i === 0 || t - times[i - 1] >= g) && (i === times.length || times[i] - t >= g);
  };
  const insert = (o: Onset) => {
    const i = lowerBound(times, o.t);
    times.splice(i, 0, o.t);
    accepted.splice(i, 0, o);
  };
  for (const o of sorted) if (fits(o.t)) insert(o);

  // Long gaps: fall back to the quieter real hits that land on a beat. Never invent a
  // note where nothing is playing.
  const onsetTimes = ctx.onsets.map((o) => o.t);
  for (let i = 0; i < ctx.beats.length; i++) {
    const t = ctx.beats[i];
    const beatDur = (ctx.beats[i + 1] ?? t + 0.5) - t;
    const k = lowerBound(onsetTimes, t - 0.02);
    const real = ctx.onsets[k];
    if (!real || real.t > t + 0.02) continue;
    const j = lowerBound(times, t);
    const prevGap = j > 0 ? t - times[j - 1] : Infinity;
    const nextGap = j < times.length ? times[j] - t : Infinity;
    if (prevGap >= cfg.fillBeats * beatDur && nextGap >= gapAt(t) && fits(real.t)) insert(real);
  }
  return accepted;
}

function sustainSeconds(feats: Features, frame: number, limitSec: number): number {
  let ref = 0;
  for (let f = frame; f < Math.min(feats.frames, frame + 4); f++) ref = Math.max(ref, feats.tonal[f]);
  const limit = Math.min(feats.frames, frame + Math.ceil(limitSec * feats.fps));
  let f = frame + 4;
  while (f < limit && feats.tonal[f] > ref - 1.1) f++;
  return (f - frame) / feats.fps;
}

const hand = (l: number) => (l < 2 ? 0 : 1);

function assignLanes(ctx: Context, cfg: DiffConfig, picks: Onset[]): Note[] {
  const notes: Note[] = [];
  const busyUntil = [-1, -1, -1, -1];
  const recent: number[] = [];
  let prevLane = -1;
  let prevT = -Infinity;
  let prevCentroid = 0;
  let lastHoldEnd = -Infinity;
  const chordCut = quantile(
    picks.map((p) => p.score),
    1 - cfg.chordFrac,
  );
  const cents = picks.map((p) => p.centroid);
  const pickTimes = picks.map((p) => p.t);

  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const g = nearestGrid(ctx.grid, p.t);
    const beat = g.beatDur;
    const gapPrev = p.t - prevT;
    const gapNext = (picks[i + 1]?.t ?? Infinity) - p.t;

    // Pitch → lane: rank this onset's brightness among its neighbours (~6s either side).
    const a = lowerBound(pickTimes, p.t - 6);
    const b = lowerBound(pickTimes, p.t + 6);
    let below = 0;
    for (let k = a; k < b; k++) if (cents[k] < p.centroid) below++;
    const rank = (below + 0.5) / Math.max(1, b - a);
    const desired = Math.min(3, Math.max(0, rank * 4 - 0.5));

    const activeHold = busyUntil.findIndex((u) => u > p.t);
    const cost = (l: number) => {
      if (busyUntil[l] > p.t - 0.03) return Infinity;
      let c = Math.abs(l - desired);
      if (l === prevLane) c += gapPrev < cfg.jackGap ? 50 : 0.7;
      if (prevLane >= 0 && gapPrev < 0.2 && hand(l) === hand(prevLane)) c += 1.2;
      for (const r of recent) if (r === l) c += 0.25;
      if (prevLane >= 0 && prevCentroid > 0) {
        const ratio = p.centroid / prevCentroid;
        if (ratio > 1.15 && l < prevLane) c += 0.8;
        if (ratio < 0.87 && l > prevLane) c += 0.8;
      }
      if (activeHold >= 0 && hand(l) === hand(activeHold)) c += 2;
      return c;
    };
    let lane = 0;
    let best = Infinity;
    for (let l = 0; l < 4; l++) {
      const c = cost(l);
      if (c < best) {
        best = c;
        lane = l;
      }
    }
    if (best === Infinity) continue;

    const note: Note = { t: +p.t.toFixed(4), lane: lane as Lane };

    // holds
    const cooled = p.t - lastHoldEnd >= cfg.holdCooldownBeats * beat;
    const roomy = cfg.holdOverlap || gapNext >= (cfg.holdMinBeats + 0.5) * beat;
    if (cooled && roomy && p.level <= 1 && activeHold < 0) {
      const maxLen = Math.min(cfg.holdMaxBeats * beat, cfg.holdOverlap ? Infinity : gapNext - 0.5 * beat);
      const sus = Math.min(sustainSeconds(ctx.feats, p.frame, maxLen + 0.1), maxLen);
      if (sus >= cfg.holdMinBeats * beat) {
        let end = nearestGrid(ctx.grid, p.t + sus).t;
        if (end > p.t + maxLen + 1e-3) end -= beat / 4;
        const within = lowerBound(pickTimes, end) - i - 1;
        const denseOk = !cfg.holdOverlap || within <= ((end - p.t) / beat) * 2;
        if (end - p.t >= 0.75 * beat && denseOk) {
          note.end = +end.toFixed(4);
          busyUntil[lane] = end + 0.06;
          lastHoldEnd = end;
        }
      }
    }
    notes.push(note);

    // chords on big accents
    if (
      cfg.chordFrac > 0 &&
      note.end === undefined &&
      activeHold < 0 &&
      p.level === 0 &&
      p.score >= chordCut &&
      gapNext >= Math.max(cfg.minGap * 1.8, 0.2) &&
      gapPrev >= Math.max(cfg.minGap * 1.8, 0.2)
    ) {
      let second = -1;
      let sBest = Infinity;
      for (let l = 0; l < 4; l++) {
        if (l === lane || hand(l) === hand(lane) || busyUntil[l] > p.t - 0.03) continue;
        const c = Math.abs(l - (3 - desired));
        if (c < sBest) {
          sBest = c;
          second = l;
        }
      }
      if (second >= 0) notes.push({ t: note.t, lane: second as Lane });
    }

    recent.push(lane);
    if (recent.length > 6) recent.shift();
    prevLane = lane;
    prevT = p.t;
    prevCentroid = p.centroid;
  }
  return notes.sort((x, y) => x.t - y.t || x.lane - y.lane);
}

function rate(notes: Note[]): { stars: number; nps: number } {
  if (notes.length < 2) return { stars: 0, nps: 0 };
  const span = Math.max(1, notes[notes.length - 1].t - notes[0].t);
  const weight = (n: Note) => (n.end !== undefined ? 1.4 : 1);
  const total = notes.reduce((s, n) => s + weight(n), 0);
  const nps = total / span;
  let peak = 0;
  let j = 0;
  let windowSum = 0;
  for (let i = 0; i < notes.length; i++) {
    windowSum += weight(notes[i]);
    while (notes[i].t - notes[j].t > 4) windowSum -= weight(notes[j++]);
    peak = Math.max(peak, windowSum / 4);
  }
  const stars = Math.max(0.5, Math.min(10, 0.55 * nps + 0.4 * peak));
  return { stars: +stars.toFixed(1), nps: +nps.toFixed(2) };
}

// ---------------------------------------------------------------- main

export function analyze(samples: Float32Array, sr: number, progress: ProgressFn): Analysis {
  const duration = samples.length / sr;
  const feats = extractFeatures(samples, sr, progress);
  const { fps, frames } = feats;

  progress('finding the groove', 0);
  // Weighted multi-band novelty, each band normalized so no single band dominates.
  const weights = [1.0, 0.7, 1.0, 0.6];
  const nov = new Float32Array(frames);
  feats.flux.forEach((band, b) => {
    const m = mean(band) || 1;
    for (let i = 0; i < frames; i++) nov[i] += (weights[b] * band[i]) / m;
  });
  const trend = movingMean(nov, Math.round(0.35 * fps), Math.round(0.35 * fps));
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) env[i] = Math.max(0, nov[i] - trend[i]);
  const envMean = mean(env) || 1;
  for (let i = 0; i < frames; i++) env[i] /= envMean;

  const bpmGuess = estimateTempo(env, fps);
  progress('finding the groove', 0.4);
  const beatFrames = trackBeats(env, fps, bpmGuess);
  const frameTime = (f: number) => (f * HOP + N / 2) / sr;

  // Onsets per band (kick, low-mid, snare/vocal, hats) plus pitch change (melody), each
  // judged against its own recent level — so a hat or a vocal note counts even while a
  // loud kick dominates.
  const PITCH = 4;
  const BAND_WEIGHT = [1, 0.75, 1, 0.8, 1];
  const w = 3;
  const rmsMed = median(Array.from(feats.rms).filter((r) => r > 1e-4)) || 1e-3;
  const cands: { t: number; frame: number; sal: number; band: number }[] = [];
  [...feats.flux, feats.pitch].forEach((band, bi) => {
    const around = movingMean(band, Math.round(0.5 * fps), Math.round(0.5 * fps));
    // pitch change is already on a fixed 0..1 scale: a real new note reads ~0.4-0.8, drum
    // leakage and fades ~0.01-0.05. The spectral bands only make sense relative to themselves.
    const resting = median(Array.from(band));
    const floor = bi === PITCH ? 0.15 : resting * 2;
    for (let i = 1; i < frames - 1; i++) {
      const v = band[i];
      if (v <= floor) continue;
      // near-silence shouldn't make every wobble look huge: the baseline never drops below
      // half the band's resting level
      const prominence = bi === PITCH ? v / 0.5 : v / Math.max(around[i], resting * 0.5, 1e-6);
      if (bi !== PITCH && prominence < 1.5) continue;
      let isMax = true;
      for (let k = Math.max(0, i - w); k <= Math.min(frames - 1, i + w); k++) {
        if (band[k] > v || (k < i && band[k] === v)) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      // quiet passages still get charted, just a little less eagerly than loud ones
      const loud = Math.min(1.4, Math.max(0.5, Math.sqrt(feats.rms[i] / rmsMed)));
      cands.push({ t: frameTime(i), frame: i, sal: prominence * BAND_WEIGHT[bi] * loud, band: bi });
    }
  });
  // Put the bands on one scale: a typical hit in any band scores ~1, so a quiet melody
  // note can compete with a kick that spikes far harder in absolute terms.
  for (let bi = 0; bi < PITCH; bi++) {
    const typical = median(cands.filter((c) => c.band === bi).map((c) => c.sal)) || 1;
    for (const c of cands) if (c.band === bi) c.sal /= typical;
  }
  // under half a typical hit is texture, not a note
  const hits = cands.filter((c) => c.sal >= 0.5);

  // kick + snare attacks, moved to where they really start, anchor the beat grid
  const attacks = hits
    .filter((c) => c.band === 0 || c.band === 2)
    .map((c) => refineOnset(samples, sr, c.t))
    .sort((x, y) => x - y);

  const beats = fitBeats(
    beatFrames.map(frameTime),
    attacks,
    60 / bpmGuess,
  );
  const intervals = beats.slice(1).map((b, i) => b - beats[i]);
  const bpm = intervals.length ? 60 / median(intervals) : bpmGuess;

  // downbeat phase: which of every 4 beats carries the most kick energy
  const lowMean = mean(feats.flux[0]) || 1;
  const phase = [0, 0, 0, 0];
  beats.forEach((t, i) => {
    const f = Math.round(t * fps);
    let m = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(frames - 1, f + 2); k++) m = Math.max(m, feats.flux[0][k] / lowMean);
    phase[i % 4] += m;
  });
  const downbeat = phase.indexOf(Math.max(...phase));
  progress('finding the groove', 0.8);

  // every note sits on the 16th grid; anything between grid lines is noise, not rhythm
  progress('picking the hits', 0);
  const grid = buildGrid(beats, duration);
  // Snap every detector's hits to the 16th grid. Drum bands landing on the same spot stack
  // into a stronger accent (kick + hat); pitch change is kept apart as the melody strength.
  const at = new Map<GridPoint, { o: Onset; peak: number; extra: number }>();
  for (const c of hits) {
    const g = nearestGrid(grid, c.t);
    let cur = at.get(g);
    if (!cur) {
      const o: Onset = { t: g.t, frame: c.frame, strength: 0, centroid: 0, melody: 0, level: g.level, score: 0 };
      at.set(g, (cur = { o, peak: 0, extra: 0 }));
    }
    if (c.band === PITCH) cur.o.melody = Math.max(cur.o.melody, c.sal);
    else if (c.sal > cur.peak) {
      cur.extra += cur.peak * 0.35;
      cur.peak = c.sal;
      cur.o.frame = c.frame;
    } else cur.extra += c.sal * 0.35;
  }
  const onsets = [...at.values()]
    .map(({ o, peak, extra }) => {
      o.strength = peak + extra;
      o.centroid = feats.centroid[Math.min(frames - 1, o.frame + 1)] || feats.centroid[o.frame];
      o.score = LEVEL_WEIGHT[o.level] * (o.strength + o.melody);
      return o;
    })
    .sort((x, y) => x.t - y.t);
  progress('picking the hits', 1);

  const ctx: Context = { feats, onsets, grid, beats };

  const charts = {} as Record<Difficulty, ChartInfo>;
  (['easy', 'normal', 'hard', 'expert'] as Difficulty[]).forEach((d, i) => {
    progress('writing charts', i / 4);
    const cfg = CONFIGS[d];
    const notes = assignLanes(ctx, cfg, selectTimes(ctx, cfg));
    charts[d] = { notes, ...rate(notes) };
  });
  progress('writing charts', 1);

  const buckets = 200;
  const waveform: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b / buckets) * frames);
    const z = Math.max(a + 1, Math.floor(((b + 1) / buckets) * frames));
    let m = 0;
    for (let f = a; f < z && f < frames; f++) m = Math.max(m, feats.rms[f]);
    waveform.push(m);
  }
  const wMax = Math.max(...waveform) || 1;

  return {
    version: ANALYZER_VERSION,
    duration,
    bpm: +bpm.toFixed(1),
    beats: beats.map((b) => +b.toFixed(4)),
    downbeat,
    waveform: waveform.map((v) => +(v / wMax).toFixed(3)),
    charts,
  };
}
