import type { GameResult } from '../game/game';
import { WINDOWS } from '../game/game';
import { saveSettings, settings } from '../lib/settings';
import { escapeHtml, h } from '../lib/util';
import type { SongRecord } from '../types';
import { toast } from './feedback';

const GRADE_LINES: Record<string, string[]> = {
  SS: ['flawless. are you ok?', 'literally perfect', 'the beat hit YOU'],
  S: ['absolutely cooking', 'certified groove machine', 'that was clean'],
  A: ['big rhythm energy', 'so close to S', 'very nice'],
  B: ['solid run!', 'getting there', 'the groove is strong'],
  C: ['warming up', 'run it back?', 'not bad at all'],
  D: ['the beat won this round', 'try a lower difficulty?', 'everyone starts somewhere'],
};

export interface ResultsActions {
  onRetry: () => void;
  onBack: () => void;
}

export function showResults(mount: HTMLElement, song: SongRecord, r: GameResult, newBest: boolean, actions: ResultsActions) {
  const lines = GRADE_LINES[r.grade];
  const line = lines[Math.floor(Math.random() * lines.length)];
  const badges = [
    r.allPerfect ? '<span class="badge badge-ap">all perfect</span>' : r.fullCombo ? '<span class="badge badge-fc">full combo</span>' : '',
    newBest ? '<span class="badge badge-new">new best!</span>' : '',
  ].join('');
  const maxCount = Math.max(1, r.counts.perfect, r.counts.great, r.counts.okay, r.counts.miss);
  const row = (k: keyof GameResult['counts'], label: string) =>
    `<div class="count-row count-${k}"><span>${label}</span><div class="count-bar"><i style="--w:${r.counts[k] / maxCount}"></i></div><b>${r.counts[k]}</b></div>`;
  const mean = Math.round(r.meanErrorMs);
  const canFix = r.errors.length >= 20 && Math.abs(mean) >= 8;
  // consistent early/late hits mean the audio path has latency: correct it automatically
  const offsetBefore = settings.offsetMs;
  if (canFix) saveSettings({ offsetMs: Math.max(-250, Math.min(250, offsetBefore + mean)) });

  const el = h(`
    <div class="results">
      <div class="res-grade-col">
        <div class="grade-burst grade-${r.grade}">
          <svg viewBox="0 0 200 200" class="burst"><path d="${burstPath()}"/></svg>
          <span class="grade-letter">${r.grade}</span>
        </div>
        <div class="grade-line">${escapeHtml(line)}</div>
        <div class="badges">${badges}</div>
      </div>
      <div class="card res-card">
        <div class="card-label">results · <span class="diff-chip diff-${r.difficulty}">${r.difficulty}</span></div>
        <h2 class="res-title">${escapeHtml(song.title)}</h2>
        <div class="res-artist">${escapeHtml(song.artist)}</div>
        <div class="res-score">0</div>
        <div class="res-stats">
          <div><small>accuracy</small><b>${(r.accuracy * 100).toFixed(2)}%</b></div>
          <div><small>max combo</small><b>${r.maxCombo}<em>/${r.total}</em></b></div>
          <div><small>avg timing</small><b>${mean > 0 ? '+' : ''}${mean}<em>ms</em></b></div>
        </div>
        <div class="counts">
          ${row('perfect', 'perfect')}${row('great', 'great')}${row('okay', 'okay')}${row('miss', 'miss')}
        </div>
        <canvas class="res-hist" width="560" height="90"></canvas>
        <div class="res-hist-legend"><span>early</span><span>late</span></div>
        ${
          canFix
            ? `<div class="offset-tip">you were hitting <b>${Math.abs(mean)}ms ${mean > 0 ? 'late' : 'early'}</b>, so timing is now shifted to match you.
               <button class="btn btn-small" data-act="undo">undo</button></div>`
            : ''
        }
        <div class="res-actions">
          <button class="btn btn-pink" data-act="retry">retry <kbd>R</kbd></button>
          <button class="btn" data-act="back">back to crate <kbd>esc</kbd></button>
        </div>
      </div>
    </div>`);
  mount.appendChild(el);

  // score count-up
  const scoreEl = el.querySelector<HTMLElement>('.res-score')!;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / 1100);
    const eased = 1 - Math.pow(1 - k, 3);
    scoreEl.textContent = Math.round(r.score * eased).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  drawHistogram(el.querySelector('canvas')!, r.errors);
  if (r.grade === 'SS' || r.grade === 'S' || newBest) confetti(el);

  const done = (fn: () => void) => {
    window.removeEventListener('keydown', onKey);
    el.remove();
    fn();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyR') done(actions.onRetry);
    else if (e.code === 'Escape' || e.code === 'Enter') done(actions.onBack);
  };
  window.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'retry') done(actions.onRetry);
    if (act === 'back') done(actions.onBack);
    if (act === 'undo') {
      saveSettings({ offsetMs: offsetBefore });
      toast(`offset back to ${offsetBefore > 0 ? '+' : ''}${offsetBefore}ms`);
      el.querySelector('.offset-tip')?.remove();
    }
  });
}

function drawHistogram(canvas: HTMLCanvasElement, errors: number[]) {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const range = WINDOWS.okay * 1000;
  const bins = 41;
  const counts = new Array(bins).fill(0);
  for (const e of errors) {
    const i = Math.round(((Math.max(-range, Math.min(range, e)) + range) / (2 * range)) * (bins - 1));
    counts[i]++;
  }
  const max = Math.max(1, ...counts);
  const zone = (ms: number, color: string) => {
    const w = (ms / range) * (W / 2);
    g.fillStyle = color;
    g.fillRect(W / 2 - w, H - 6, w * 2, 6);
  };
  zone(WINDOWS.okay * 1000, '#8fa0ff');
  zone(WINDOWS.great * 1000, '#3fe0b5');
  zone(WINDOWS.perfect * 1000, '#ffd84d');
  const bw = W / bins;
  counts.forEach((c, i) => {
    const bh = (c / max) * (H - 14);
    const ms = Math.abs((i / (bins - 1)) * 2 * range - range);
    g.fillStyle = ms <= WINDOWS.perfect * 1000 ? '#ffd84d' : ms <= WINDOWS.great * 1000 ? '#3fe0b5' : '#8fa0ff';
    g.strokeStyle = '#1b1a1f';
    g.lineWidth = 2;
    g.fillRect(i * bw + 1, H - 8 - bh, bw - 2, bh);
    if (bh > 2) g.strokeRect(i * bw + 1, H - 8 - bh, bw - 2, bh);
  });
  g.fillStyle = '#1b1a1f';
  g.fillRect(W / 2 - 1, 0, 2, H);
}

function burstPath() {
  const pts: string[] = [];
  const spikes = 14;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const r = i % 2 ? 72 : 96;
    pts.push(`${(100 + Math.cos(a) * r).toFixed(1)},${(100 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

function confetti(host: HTMLElement) {
  const colors = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff', '#ff8a3d'];
  const layer = h('<div class="confetti"></div>');
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    c.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    c.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    c.style.setProperty('--drift', `${(Math.random() - 0.5) * 200}px`);
    layer.appendChild(c);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 4000);
}
