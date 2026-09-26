import { escapeHtml, h } from '../lib/util';

export function toast(message: string, kind: 'info' | 'error' = 'info') {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = h('<div class="toasts"></div>');
    document.body.appendChild(host);
  }
  const t = h(`<div class="toast toast-${kind}">${escapeHtml(message)}</div>`);
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 5200 : 2800);
  setTimeout(() => t.remove(), kind === 'error' ? 5600 : 3200);
}

const STAGES: Record<string, { label: string; from: number; to: number }> = {
  setup: { label: 'warming up the robots', from: 0, to: 0.03 },
  download: { label: 'grabbing the audio', from: 0.03, to: 0.35 },
  decoding: { label: 'unpacking the waveform', from: 0.35, to: 0.42 },
  listening: { label: 'listening really hard', from: 0.42, to: 0.82 },
  'finding the groove': { label: 'finding the groove', from: 0.82, to: 0.9 },
  'picking the hits': { label: 'picking the hits', from: 0.9, to: 0.93 },
  'writing charts': { label: 'writing four charts', from: 0.93, to: 1 },
};

const TIPS = [
  'notes with a ring in the middle are holds — keep the key down',
  'esc pauses. the song waits for you',
  'hits feel late? the results screen can fix your offset in one click',
  'crank scroll speed in settings if notes feel crowded',
  'every 50 combo the track gets a little more excited',
  'hit 100 combo and things get colourful',
  'expert charts follow the hi-hats. good luck',
  'drop any audio file anywhere on the page',
];

export interface ProgressHandle {
  update(stage: string, pct: number): void;
  close(): void;
}

export function showProgress(title: string): ProgressHandle {
  const el = h(`
    <div class="modal-veil progress-veil">
      <div class="progress-card">
        <div class="eq">${'<span></span>'.repeat(7)}</div>
        <div class="card-label">analyzing</div>
        <div class="progress-title">${escapeHtml(title)}</div>
        <div class="progress-stage">getting ready…</div>
        <div class="progress-track"><div class="progress-fill"></div></div>
        <div class="progress-tip">tip: ${escapeHtml(TIPS[Math.floor(Math.random() * TIPS.length)])}</div>
      </div>
    </div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const stageEl = el.querySelector<HTMLElement>('.progress-stage')!;
  const fill = el.querySelector<HTMLElement>('.progress-fill')!;
  let shown = 0;
  return {
    update(stage, pct) {
      const s = STAGES[stage];
      if (!s) return;
      stageEl.textContent = `${s.label}…`;
      const total = s.from + (s.to - s.from) * Math.max(0, Math.min(1, pct));
      shown = Math.max(shown, total);
      fill.style.transform = `scaleX(${shown})`;
    },
    close() {
      el.classList.remove('open');
      setTimeout(() => el.remove(), 250);
    },
  };
}

export function confirmDialog(message: string, yes = 'yes', no = 'nah'): Promise<boolean> {
  return new Promise((resolve) => {
    const el = h(`
      <div class="modal-veil">
        <div class="modal confirm-modal">
          <p>${escapeHtml(message)}</p>
          <div class="row">
            <button class="btn btn-pink" data-v="1">${escapeHtml(yes)}</button>
            <button class="btn btn-ghost" data-v="0">${escapeHtml(no)}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    const done = (v: boolean) => {
      el.remove();
      resolve(v);
    };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (b) done(b.dataset.v === '1');
      else if (e.target === el) done(false);
    });
  });
}
