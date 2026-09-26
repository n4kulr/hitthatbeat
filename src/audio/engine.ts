import type { Analysis } from '../types';

const ANALYSIS_RATE = 22050;

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  try {
    return await audioCtx().decodeAudioData(data.slice(0));
  } catch {
    throw new Error("couldn't decode that audio — try an mp3, wav, ogg, flac or m4a");
  }
}

async function toMono(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * ANALYSIS_RATE);
  const off = new OfflineAudioContext(1, length, ANALYSIS_RATE);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

export type AnalyzeProgress = (stage: string, pct: number) => void;

export async function analyzeBuffer(buffer: AudioBuffer, onProgress: AnalyzeProgress): Promise<Analysis> {
  onProgress('decoding', 0.5);
  const mono = await toMono(buffer);
  const samples = new Float32Array(mono);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.stage, msg.pct);
      else {
        worker.terminate();
        if (msg.type === 'done') resolve(msg.analysis as Analysis);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'analysis crashed'));
    };
    worker.postMessage({ samples, sr: ANALYSIS_RATE }, [samples.buffer]);
  });
}
