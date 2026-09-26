export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const ART_COLORS = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff', '#ff8a3d', '#c77dff'];

/** Deterministic sticker-ish cover art for songs without a thumbnail. */
export function coverArt(seed: string, waveform: number[] = []): string {
  const r = hash(seed);
  const pick = (n: number) => ART_COLORS[(r >> n) % ART_COLORS.length];
  const bg = pick(0);
  let fg = pick(5);
  if (fg === bg) fg = ART_COLORS[(ART_COLORS.indexOf(bg) + 2) % ART_COLORS.length];
  const shape = (r >> 9) % 3;
  const bars = waveform.length
    ? Array.from({ length: 24 }, (_, i) => {
        const v = waveform[Math.floor((i / 24) * waveform.length)] ?? 0.3;
        const hgt = 8 + v * 52;
        return `<rect x="${6 + i * 3.7}" y="${92 - hgt}" width="2.4" height="${hgt}" rx="1.2" fill="#1b1a1f" opacity=".85"/>`;
      }).join('')
    : '';
  const shapes = [
    `<circle cx="50" cy="40" r="26" fill="${fg}" stroke="#1b1a1f" stroke-width="3"/>`,
    `<rect x="26" y="16" width="48" height="48" rx="6" transform="rotate(12 50 40)" fill="${fg}" stroke="#1b1a1f" stroke-width="3"/>`,
    `<path d="M50 12 L58 32 L80 34 L63 48 L68 70 L50 58 L32 70 L37 48 L20 34 L42 32 Z" fill="${fg}" stroke="#1b1a1f" stroke-width="3" stroke-linejoin="round"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${shapes[shape]}${bars}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function titleFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || 'untitled', artist: '' };
}

/** Strip the usual YouTube title noise: "(Official Video)", "[4K]", etc. */
export function cleanYouTubeTitle(title: string, channel: string): { title: string; artist: string } {
  let t = title
    .replace(/\s*[([](official|lyric|lyrics|audio|video|music video|visualizer|hd|4k|mv|m\/v)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  let artist = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) {
    artist = m[1].trim();
    t = m[2].trim();
  }
  return { title: t || title, artist };
}
