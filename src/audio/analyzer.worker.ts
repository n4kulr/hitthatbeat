import { analyze } from './analyze';

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sr: number }>) => {
  try {
    const analysis = analyze(e.data.samples, e.data.sr, (stage, pct) => {
      self.postMessage({ type: 'progress', stage, pct });
    });
    self.postMessage({ type: 'done', analysis });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
