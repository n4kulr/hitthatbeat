import { audioCtx } from './engine';

type SfxName = 'tick' | 'tickHi' | 'ui';

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
  buffers.set('tick', render(0.05, (t) => Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 90)));
  buffers.set('tickHi', render(0.05, (t) => Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t * 90)));
  buffers.set(
    'ui',
    render(0.06, (t) => Math.sin(2 * Math.PI * (600 + t * 6000) * t) * Math.exp(-t * 60) * 0.4),
  );
}

export function playSfx(name: SfxName, volume = 1, when = 0) {
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
