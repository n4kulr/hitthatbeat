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

export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const ART_COLORS = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff', '#ff8a3d', '#c77dff'];

/** Deterministic cover art: a record label whose grooves are the song's own loudness curve. */
export function coverArt(seed: string, waveform: number[] = []): string {
  const r = hash(seed);
  const a = ART_COLORS[r % ART_COLORS.length];
  let b = ART_COLORS[(r >> 4) % ART_COLORS.length];
  if (b === a) b = ART_COLORS[(ART_COLORS.indexOf(a) + 2) % ART_COLORS.length];
  const angle = (r >> 8) % 360;
  const N = 56;
  const bars = Array.from({ length: N }, (_, i) => {
    const v = waveform.length ? (waveform[Math.floor((i / N) * waveform.length)] ?? 0.3) : 0.5;
    const th = (i / N) * Math.PI * 2 + (angle * Math.PI) / 180;
    const r0 = 17;
    const r1 = r0 + 4 + v * 25;
    const p = (rad: number) => `${(50 + Math.cos(th) * rad).toFixed(1)} ${(50 + Math.sin(th) * rad).toFixed(1)}`;
    return `M${p(r0)}L${p(r1)}`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" gradientTransform="rotate(${angle % 90 + 20} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><path d="${bars}" stroke="#0b0a10" stroke-width="2.4" stroke-linecap="round" opacity=".88"/><circle cx="50" cy="50" r="12" fill="#0b0a10"/><circle cx="50" cy="50" r="2.6" fill="${a}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PLACEHOLDER_ARTIST = /^(na|n\/a|none|unknown( artist)?|various( artists)?)$/i;
const TITLE_NOISE = /\s*[([](official|lyric|lyrics|audio|video|music video|visuali[sz]er|hd|hq|4k|mv|m\/v|remaster(ed)?)[^)\]]*[)\]]/gi;

/** Tidy "NA - Artist - Song (Official Video)" style names into a real title + artist. */
export function cleanMeta(title: string, artist: string): { title: string; artist: string } {
  let t = title.replace(TITLE_NOISE, '').replace(/\s+/g, ' ').trim();
  let a = PLACEHOLDER_ARTIST.test(artist.trim()) ? '' : artist.trim();
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && PLACEHOLDER_ARTIST.test(m[1].trim())) t = m[2].trim();
  const m2 = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!a && m2) {
    a = m2[1].trim();
    t = m2[2].trim();
  }
  return { title: t || title, artist: a };
}

export function titleFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return cleanMeta(base || 'untitled', '');
}
