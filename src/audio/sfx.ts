import { audioCtx } from './engine';
import { settings } from '../lib/settings';

type SfxName = 'hit' | 'break' | 'tick' | 'tickHi' | 'ui';

const buffers = new Map<SfxName, AudioBuffer>();

function render(duration: number, fn: (t: number) => number): AudioBuffer {
  const ctx = audioCtx();
  const buf = ctx.createBuffer(1, Math.ceil(duration * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = fn(i / ctx.sampleRate);
  return buf;
}

function build() {
  if (buffers.size) return;
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // Unpitched on purpose: a tonal blip clashes with whatever key the song is in,
  // while a short hat-like tick sits on top of any mix.
  let hp = 0;
  let px = 0;
  buffers.set(
    'hit',
    render(0.045, (t) => {
      const x = noise();
      hp = 0.75 * (hp + x - px); // one-pole high-pass, keeps only the crisp top end
      px = x;
      const click = t < 0.003 ? x * (1 - t / 0.003) * 0.35 : 0;
      return hp * Math.exp(-t * 110) * 0.9 + click;
    }),
  );
  let lp = 0;
  buffers.set(
    'break',
    render(0.2, (t) => {
      lp += 0.06 * (noise() - lp); // low-passed noise: a muffled thud, no pitch
      return lp * 4 * Math.exp(-t * 18);
    }),
  );
  buffers.set('tick', render(0.05, (t) => Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 90)));
  buffers.set('tickHi', render(0.05, (t) => Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t * 90)));
  buffers.set(
    'ui',
    render(0.06, (t) => Math.sin(2 * Math.PI * (600 + t * 6000) * t) * Math.exp(-t * 60) * 0.4),
  );
}

export function playSfx(name: SfxName, volume = settings.hitVolume, when = 0) {
  if (volume <= 0) return;
  build();
  const ctx = audioCtx();
  const src = ctx.createBufferSource();
  src.buffer = buffers.get(name)!;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start(when);
}
