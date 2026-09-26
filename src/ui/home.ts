import { DIFFICULTIES, type Difficulty, type SongRecord } from '../types';
import { keyLabel, saveSettings, settings } from '../lib/settings';
import { coverArt, escapeHtml, formatTime, h, hash, cleanYouTubeTitle } from '../lib/util';
import { playSfx } from '../audio/sfx';
import { openSettings } from './settings';
import { confirmDialog, toast } from './feedback';

export interface YouTubeRef {
  id?: string;
  url?: string;
  title?: string;
  artist?: string;
  thumb?: string;
}

export interface HomeActions {
  importYouTube(ref: YouTubeRef): void;
  importFile(file: File): void;
  importDemo(): void;
  play(song: SongRecord, diff: Difficulty): void;
  remove(song: SongRecord): void;
  reanalyze(song: SongRecord): void;
}

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumb: string;
}

const YT_URL = /^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be)\//i;
const MARQUEE = '★ any song ★ hit that beat ★ d f j k ★ no mp3s required ★ full combo or bust ★ drop a file ★ paste a link ';

export function coverFor(song: SongRecord) {
  return song.thumb ?? coverArt(song.id + song.title, song.analysis.waveform);
}

function bestGrade(song: SongRecord) {
  for (const d of [...DIFFICULTIES].reverse()) {
    const b = song.best[d];
    if (b) return { d, b };
  }
  return null;
}

export class Home {
  el: HTMLElement;
  private songs: SongRecord[] = [];
  private grid: HTMLElement;
  private results: HTMLElement;
  private searchAbort: AbortController | null = null;
  private modal: HTMLElement | null = null;

  constructor(private actions: HomeActions) {
    this.el = h(`
      <div class="home">
        <div class="marquee"><div class="marquee-track"><span>${MARQUEE.repeat(4)}</span><span>${MARQUEE.repeat(4)}</span></div></div>
        <header class="top">
          <h1 class="logo" aria-label="hit that beat">
            <span class="w w1">hit</span><span class="w w2">that</span><span class="w w3">beat</span>
            <span class="logo-sticker">✦ any song ✦</span>
          </h1>
          <div class="top-right">
            <div class="keys-hint">${settings.keys.map((k, i) => `<span class="keycap lane-${i}">${keyLabel(k)}</span>`).join('')}</div>
            <button class="btn" data-act="settings">⚙ settings</button>
          </div>
        </header>

        <section class="hero">
          <div class="card add-card">
            <div class="card-label">01 — find a song</div>
            <h2>search youtube <span class="or">or</span> paste a link</h2>
            <form class="search-row">
              <input name="q" autocomplete="off" spellcheck="false" placeholder="e.g. daft punk one more time" />
              <button class="btn btn-pink" type="submit">go →</button>
            </form>
            <div class="search-results"></div>
          </div>
          <label class="card drop-card">
            <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.opus" hidden />
            <div class="card-label">02 — or bring your own</div>
            <div class="vinyl"><div class="vinyl-label"></div></div>
            <div class="drop-text"><b>drop an audio file</b><span>or click to browse · mp3 wav flac ogg m4a</span></div>
          </label>
        </section>

        <section class="crate">
          <div class="crate-head">
            <h2>your crate <span class="count">0</span></h2>
            <div class="crate-tools">
              <input class="filter" placeholder="filter…" spellcheck="false" />
              <button class="btn btn-small" data-act="demo">+ demo track</button>
            </div>
          </div>
          <div class="grid"></div>
        </section>

        <footer>made with web audio + too much caffeine · youtube audio stays on your machine · personal use only</footer>
      </div>`);

    this.grid = this.el.querySelector('.grid')!;
    this.results = this.el.querySelector('.search-results')!;

    const form = this.el.querySelector<HTMLFormElement>('.search-row')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (YT_URL.test(q)) {
        input.value = '';
        this.actions.importYouTube({ url: q });
      } else this.search(q);
    });

    const fileInput = this.el.querySelector<HTMLInputElement>('.drop-card input')!;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.actions.importFile(f);
      fileInput.value = '';
    });

    this.el.querySelector('.filter')!.addEventListener('input', () => this.renderGrid());
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'settings') openSettings(() => this.refreshKeys());
      if (act === 'demo') this.actions.importDemo();
    });

    this.grid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.song-card');
      const song = card && this.songs.find((s) => s.id === card.dataset.id);
      if (song) this.openSong(song);
    });

    this.checkYouTube();

    this.results.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.results-close')) {
        this.results.innerHTML = '';
        return;
      }
      const btn = target.closest<HTMLElement>('.result');
      if (!btn) return;
      const existing = this.songs.find((s) => s.ytId === btn.dataset.id);
      if (existing) return this.openSong(existing);
      this.actions.importYouTube({
        id: btn.dataset.id,
        title: btn.dataset.title,
        artist: btn.dataset.artist,
        thumb: btn.dataset.thumb,
      });
    });
  }

  private async checkYouTube() {
    let ok = false;
    try {
      const res = await fetch('/api/yt/status');
      ok = res.ok && (res.headers.get('content-type') ?? '').includes('json');
    } catch {}
    if (ok) return;
    const card = this.el.querySelector('.add-card')!;
    card.classList.add('yt-offline');
    card.querySelector('h2')!.innerHTML = 'youtube search <span class="or">runs locally</span>';
    card.querySelector('.search-row')!.replaceWith(
      h(`<p class="offline-note">this build has no youtube backend. clone the repo and run <code>npm run dev</code> to search & play any youtube song — or just drop an audio file →</p>`),
    );
  }

  private refreshKeys() {
    this.el.querySelector('.keys-hint')!.innerHTML = settings.keys
      .map((k, i) => `<span class="keycap lane-${i}">${keyLabel(k)}</span>`)
      .join('');
  }

  setSongs(songs: SongRecord[]) {
    this.songs = [...songs].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
    this.el.querySelector('.crate .count')!.textContent = String(songs.length);
    this.renderGrid();
    if (this.results.childElementCount) this.markInCrate();
  }

  private renderGrid() {
    const q = this.el.querySelector<HTMLInputElement>('.filter')!.value.trim().toLowerCase();
    const list = this.songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
    if (!this.songs.length) {
      this.grid.innerHTML = `
        <div class="empty">
          <div class="empty-sticker">your crate is empty</div>
          <p>search a song up there ↑, drop a file, or grab the <button class="link" data-act="demo">demo track</button> to warm up.</p>
        </div>`;
      return;
    }
    this.grid.innerHTML = list
      .map((s, i) => {
        const best = bestGrade(s);
        const tilt = ((hash(s.id) % 30) - 15) / 10;
        return `
          <button class="song-card" data-id="${escapeHtml(s.id)}" style="--tilt:${tilt}deg; --i:${i}">
            <div class="cover">
              <img src="${escapeHtml(coverFor(s))}" alt="" loading="lazy" />
              ${best ? `<span class="grade-sticker grade-${best.b.grade}" title="${best.d}">${best.b.grade}</span>` : ''}
              ${s.source === 'youtube' ? '<span class="src-chip">yt</span>' : s.source === 'demo' ? '<span class="src-chip">demo</span>' : ''}
            </div>
            <div class="song-meta">
              <div class="song-title">${escapeHtml(s.title)}</div>
              <div class="song-artist">${escapeHtml(s.artist || '—')}</div>
              <div class="song-tags"><span>${Math.round(s.analysis.bpm)} bpm</span><span>${formatTime(s.analysis.duration)}</span></div>
            </div>
          </button>`;
      })
      .join('');
  }

  private async search(q: string) {
    this.searchAbort?.abort();
    const ctrl = new AbortController();
    this.searchAbort = ctrl;
    this.results.innerHTML = `<div class="results-head"><span>searching “${escapeHtml(q)}”…</span></div>${'<div class="result skeleton"></div>'.repeat(4)}`;
    try {
      const res = await fetch(`/api/yt/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      const data = (await res.json()) as { results?: SearchResult[]; error?: string };
      if (!res.ok || !data.results) throw new Error(data.error ?? 'search failed');
      if (!data.results.length) {
        this.results.innerHTML = `<div class="results-head"><span>nothing found for “${escapeHtml(q)}”</span><button class="results-close">×</button></div>`;
        return;
      }
      this.results.innerHTML =
        `<div class="results-head"><span>pick one ↓</span><button class="results-close" aria-label="clear">×</button></div>` +
        data.results
          .map((r) => {
            const clean = cleanYouTubeTitle(r.title, r.artist);
            return `
              <button class="result" data-id="${r.id}" data-title="${escapeHtml(clean.title)}" data-artist="${escapeHtml(clean.artist)}" data-thumb="${escapeHtml(r.thumb)}">
                <img src="${escapeHtml(r.thumb)}" alt="" loading="lazy" />
                <div class="r-text">
                  <div class="r-title">${escapeHtml(r.title)}</div>
                  <div class="r-sub">${escapeHtml(r.artist)}${r.duration ? ` · ${formatTime(r.duration)}` : ''}</div>
                </div>
                <span class="r-add">+</span>
              </button>`;
          })
          .join('');
      this.markInCrate();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.results.innerHTML = '';
      toast(`search failed: ${(e as Error).message}. is the dev server running?`, 'error');
    }
  }

  private markInCrate() {
    this.results.querySelectorAll<HTMLElement>('.result[data-id]').forEach((r) => {
      const inCrate = this.songs.some((s) => s.ytId === r.dataset.id);
      r.classList.toggle('in-crate', inCrate);
      r.querySelector('.r-add')!.textContent = inCrate ? '▶' : '+';
    });
  }

  // ------------------------------------------------------------- song modal

  openSong(song: SongRecord) {
    this.closeSong();
    let diff: Difficulty = settings.lastDifficulty;
    const a = song.analysis;
    const el = h(`
      <div class="modal-veil">
        <div class="modal song-modal">
          <button class="close" aria-label="close">×</button>
          <div class="sm-cover"><img src="${escapeHtml(coverFor(song))}" alt="" /></div>
          <div class="sm-body">
            <div class="card-label">ready when you are</div>
            <h2 class="sm-title">${escapeHtml(song.title)}</h2>
            <div class="sm-artist">${escapeHtml(song.artist || '—')}</div>
            <div class="song-tags"><span>${Math.round(a.bpm)} bpm</span><span>${formatTime(a.duration)}</span><span>${song.source}</span></div>
            <div class="diff-grid">
              ${DIFFICULTIES.map((d, i) => {
                const c = a.charts[d];
                const best = song.best[d];
                return `
                  <button class="diff-btn diff-${d}" data-d="${d}">
                    <span class="diff-key">${i + 1}</span>
                    <span class="diff-name">${d}</span>
                    <span class="diff-stars">★ ${c.stars}</span>
                    <span class="diff-notes">${c.notes.length} notes</span>
                    <span class="diff-best">${best ? `${best.grade} · ${(best.accuracy * 100).toFixed(1)}%${best.fullCombo ? ' · fc' : ''}` : 'unplayed'}</span>
                  </button>`;
              }).join('')}
            </div>
            <button class="btn btn-play">play <span>▶</span></button>
            <div class="sm-foot">
              <span class="sm-keys">${settings.keys.map(keyLabel).join(' ')} · enter to play</span>
              <span>
                <button class="link" data-act="reanalyze">re-analyze</button>
                <button class="link danger" data-act="delete">delete</button>
              </span>
            </div>
          </div>
        </div>
      </div>`);
    document.body.appendChild(el);
    this.modal = el;
    requestAnimationFrame(() => el.classList.add('open'));

    const select = (d: Difficulty) => {
      diff = d;
      el.querySelectorAll('.diff-btn').forEach((b) => b.classList.toggle('selected', (b as HTMLElement).dataset.d === d));
    };
    select(diff);

    const play = () => {
      saveSettings({ lastDifficulty: diff });
      this.closeSong();
      this.actions.play(song, diff);
    };

    el.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === el || t.closest('.close')) return this.closeSong();
      const d = t.closest<HTMLElement>('.diff-btn')?.dataset.d as Difficulty | undefined;
      if (d) {
        playSfx('ui', 0.4);
        select(d);
      }
      if (t.closest('.btn-play')) play();
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'delete' && (await confirmDialog(`remove “${song.title}” from your crate?`, 'delete it', 'keep'))) {
        this.closeSong();
        this.actions.remove(song);
      }
      if (act === 'reanalyze') {
        this.closeSong();
        this.actions.reanalyze(song);
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.confirm-modal')) return;
      if (e.code === 'Escape') this.closeSong();
      else if (e.code === 'Enter') {
        e.preventDefault();
        play();
      } else if (/^Digit[1-4]$/.test(e.code)) select(DIFFICULTIES[+e.code.slice(5) - 1]);
      else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const i = DIFFICULTIES.indexOf(diff) + (e.code === 'ArrowRight' ? 1 : -1);
        select(DIFFICULTIES[(i + 4) % 4]);
      }
    };
    window.addEventListener('keydown', onKey);
    (el as HTMLElement & { cleanup?: () => void }).cleanup = () => window.removeEventListener('keydown', onKey);
  }

  closeSong() {
    const el = this.modal as (HTMLElement & { cleanup?: () => void }) | null;
    if (!el) return;
    el.cleanup?.();
    this.modal = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 200);
  }
}
