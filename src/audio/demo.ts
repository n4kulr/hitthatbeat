/** Renders a small built-in track so there's always something to play. */
export async function renderDemoTrack(): Promise<Blob> {
  const sr = 44100;
  const bpm = 124;
  const beat = 60 / bpm;
  const bars = 24;
  const duration = bars * 4 * beat + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);

  const master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, sr, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const kick = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  };
  const noiseHit = (t: number, freq: number, len: number, vol: number, type: BiquadFilterType) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + len + 0.02);
  };
  const tone = (t: number, freq: number, len: number, vol: number, type: OscillatorType, cutoff = 4000) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff / 6), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f).connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
  };

  const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  // Am - F - C - G
  const roots = [57, 53, 60, 55];
  const chords = [
    [69, 72, 76],
    [65, 69, 72],
    [67, 72, 76],
    [67, 71, 74],
  ];
  const melody = [76, 79, 81, 79, 76, 74, 72, 74, 76, 76, 79, 84, 83, 81, 79, 76];

  const start = 0.5;
  for (let bar = 0; bar < bars; bar++) {
    const section = bar < 4 ? 0 : bar < 12 ? 1 : bar < 16 ? 2 : 3;
    const ci = bar % 4;
    for (let b = 0; b < 4; b++) {
      const t = start + (bar * 4 + b) * beat;
      if (section !== 2 || b === 0) kick(t);
      if (section >= 1 && (b === 1 || b === 3)) noiseHit(t, 1800, 0.18, 0.7, 'bandpass');
      if (section >= 1) {
        noiseHit(t + beat / 2, 8000, 0.05, 0.35, 'highpass');
        if (section === 3) noiseHit(t + beat / 4, 9000, 0.03, 0.2, 'highpass');
      }
      tone(t + beat / 2, midi(roots[ci] - 12), beat * 0.45, 0.45, 'sawtooth', 900);
      if (section === 0 || section === 2) {
        if (b === 0) for (const n of chords[ci]) tone(t, midi(n), beat * 3.5, 0.12, 'triangle', 3000);
      } else if (b === 0 || b === 2) {
        for (const n of chords[ci]) tone(t, midi(n), beat * 0.5, 0.1, 'square', 2500);
      }
      if (section === 3 || section === 1) {
        const m = melody[((bar % 4) * 4 + b) % melody.length];
        tone(t, midi(m), beat * 0.4, 0.16, 'square', 5000);
        if (section === 3) tone(t + beat / 2, midi(m + (b % 2 ? 3 : 5)), beat * 0.3, 0.12, 'square', 5000);
      }
    }
  }

  const out = await ctx.startRendering();
  return encodeWav(out);
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
