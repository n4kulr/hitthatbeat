import { DIFFICULTIES, type Difficulty, type SongRecord } from '../types';
import { keyLabel, saveSettings, settings } from '../lib/settings';
import { coverArt, escapeHtml, formatTime, h, hash, cleanYouTubeTitle } from '../lib/util';
import { playSfx } from '../audio/sfx';
import { LANE_COLORS } from '../game/render';
import { openSettings } from './settings';
import { confirmDialog, toast } from './feedback';
import { Attract } from './attract';

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
const EXAMPLES = [
  'daft punk — one more time',
  'paste a youtube link…',
  'kendrick lamar — not like us',
  'the weeknd — blinding lights',
  'porter robinson — shelter',
  'fred again.. — delilah',
];
const ICON_SEARCH = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

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

const laneColor = (id: string) => LANE_COLORS[hash(id) % 4];

export class Home {
  el: HTMLElement;
  private songs: SongRecord[] = [];
  private crateBody: HTMLElement;
  private resultsBody: HTMLElement;
  private searchAbort: AbortController | null = null;
  private modal: HTMLElement | null = null;
  private attract: Attract;
  private placeholderTimer = 0;

  constructor(private actions: HomeActions) {
    this.el = h(`
      <div class="home">
        <canvas class="attract"></canvas>
        <div class="scrim"></div>

        <aside class="panel">
          <div class="eyebrow"><span class="live-dot"></span>rhythm game for any song</div>
          <h1 class="logo" aria-label="hit that beat">
            <span class="l1">hit</span><span class="l2">that</span><span class="l3">beat</span>
          </h1>

          <form class="omni">
            <span class="omni-icon">${ICON_SEARCH}</span>
            <input name="q" autocomplete="off" spellcheck="false" aria-label="search youtube or paste a link" />
            <kbd>↵</kbd>
          </form>
          <div class="alt-row">
            <label class="chip">
              <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.opus" hidden />
              ${ICON_FILE}<span>drop or pick a file</span>
            </label>
            <button class="chip" data-act="demo"><span class="chip-dot"></span><span>demo track</span></button>
          </div>

          <section class="list">
            <div class="list-head">
              <div class="tabs">
                <button class="tab active" data-tab="crate">crate <span class="count">0</span></button>
                <button class="tab" data-tab="results" hidden>results</button>
              </div>
              <input class="filter" placeholder="filter" spellcheck="false" />
            </div>
            <div class="list-body crate-body"></div>
            <div class="list-body results-body" hidden></div>
          </section>

          <footer class="panel-foot">
            <span class="foot-keys"></span>
            <span>esc pause · audio stays on your machine</span>
          </footer>
        </aside>

        <button class="icon-btn settings-btn" data-act="settings" aria-label="settings">${ICON_GEAR}</button>
        <div class="demo-tag"><span class="blink"></span>demo play<em>pick a song to play for real</em></div>
      </div>`);

    this.crateBody = this.el.querySelector('.crate-body')!;
    this.resultsBody = this.el.querySelector('.results-body')!;
    this.attract = new Attract(this.el.querySelector('canvas')!);
    this.refreshKeys();

    const form = this.el.querySelector<HTMLFormElement>('.omni')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      if (YT_URL.test(q)) {
        input.value = '';
        this.actions.importYouTube({ url: q });
      } else this.search(q);
    });
    let ex = 0;
    const cycle = () => (input.placeholder = `try “${EXAMPLES[ex++ % EXAMPLES.length]}”`);
    cycle();
    this.placeholderTimer = window.setInterval(cycle, 2800);

    const fileInput = this.el.querySelector<HTMLInputElement>('.chip input')!;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.actions.importFile(f);
      fileInput.value = '';
    });

    this.el.querySelector('.filter')!.addEventListener('input', () => this.renderCrate());
    this.el.querySelector('.tabs')!.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')?.dataset.tab;
      if (tab) this.showTab(tab as 'crate' | 'results');
    });

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'settings') openSettings(() => this.refreshKeys());
      if (act === 'demo') this.actions.importDemo();

      const row = t.closest<HTMLElement>('.row');
      if (!row) return;
      if (row.dataset.song) {
        const song = this.songs.find((s) => s.id === row.dataset.song);
        if (song) this.openSong(song);
      } else if (row.dataset.yt) {
        const existing = this.songs.find((s) => s.ytId === row.dataset.yt);
        if (existing) return this.openSong(existing);
        this.actions.importYouTube({
          id: row.dataset.yt,
          title: row.dataset.title,
          artist: row.dataset.artist,
          thumb: row.dataset.thumb,
        });
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || this.modal || document.querySelector('.modal-veil')) return;
      const typing = document.activeElement instanceof HTMLInputElement;
      if (!typing && (e.key === '/' || (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.metaKey && !e.ctrlKey))) {
        if (e.key === '/') e.preventDefault();
        input.focus();
      }
      if (e.key === 'Escape' && typing) (document.activeElement as HTMLElement).blur();
    });

    this.checkYouTube();
  }

  show() {
    this.el.hidden = false;
    this.attract.start();
  }

  hide() {
    this.el.hidden = true;
    this.attract.stop();
  }

  private showTab(tab: 'crate' | 'results') {
    this.el.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.crateBody.hidden = tab !== 'crate';
    this.resultsBody.hidden = tab !== 'results';
    this.el.querySelector<HTMLElement>('.filter')!.hidden = tab !== 'crate';
  }

  private async checkYouTube() {
    let ok = false;
    try {
      const res = await fetch('/api/yt/status');
      ok = res.ok && (res.headers.get('content-type') ?? '').includes('json');
    } catch {}
    if (ok) return;
    const form = this.el.querySelector('.omni')!;
    form.replaceWith(
      h(`<div class="offline-note"><b>youtube search runs locally.</b> clone the repo and <code>npm run dev</code> to play any youtube song. here, drop an audio file anywhere on the page.</div>`),
    );
    clearInterval(this.placeholderTimer);
  }

  private refreshKeys() {
    this.el.querySelector('.foot-keys')!.innerHTML = settings.keys
      .map((k, i) => `<span class="ring" style="--c:${LANE_COLORS[i]}">${keyLabel(k)}</span>`)
      .join('');
  }

  setSongs(songs: SongRecord[]) {
    this.songs = [...songs].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
    this.el.querySelector('.tab .count')!.textContent = String(songs.length);
    this.renderCrate();
    this.markInCrate();
  }

  private renderCrate() {
    const q = this.el.querySelector<HTMLInputElement>('.filter')!.value.trim().toLowerCase();
    const list = this.songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
    if (!this.songs.length) {
      this.crateBody.innerHTML = `
        <div class="empty">
          <div class="empty-title">nothing in the crate yet</div>
          <p>search a song above, drop an audio file anywhere, or warm up with the <button class="inline-link" data-act="demo">demo track</button>.</p>
        </div>`;
      return;
    }
    if (!list.length) {
      this.crateBody.innerHTML = `<div class="empty"><p>no match for “${escapeHtml(q)}”</p></div>`;
      return;
    }
    this.crateBody.innerHTML = list
      .map((s, i) => {
        const best = bestGrade(s);
        return `
          <button class="row" data-song="${escapeHtml(s.id)}" style="--i:${i}; --c:${laneColor(s.id)}">
            <span class="row-n">${String(i + 1).padStart(2, '0')}</span>
            <span class="row-cover"><img src="${escapeHtml(coverFor(s))}" alt="" loading="lazy" /></span>
            <span class="row-text"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.artist || (s.source === 'file' ? 'local file' : '—'))}</small></span>
            <span class="row-meta"><span>${Math.round(s.analysis.bpm)} bpm</span><span>${formatTime(s.analysis.duration)}</span></span>
            ${best ? `<span class="row-grade grade-${best.b.grade}" title="best on ${best.d}">${best.b.grade}</span>` : '<span class="row-grade none">new</span>'}
          </button>`;
      })
      .join('');
  }

  private async search(q: string) {
    this.searchAbort?.abort();
    const ctrl = new AbortController();
    this.searchAbort = ctrl;
    const tab = this.el.querySelector<HTMLElement>('.tab[data-tab="results"]')!;
    tab.hidden = false;
    this.showTab('results');
    this.resultsBody.innerHTML = `<div class="searching">searching “${escapeHtml(q)}”</div>${'<div class="row skeleton"><span></span><span></span><span></span></div>'.repeat(5)}`;
    try {
      const res = await fetch(`/api/yt/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      const data = (await res.json()) as { results?: SearchResult[]; error?: string };
      if (!res.ok || !data.results) throw new Error(data.error ?? 'search failed');
      if (!data.results.length) {
        this.resultsBody.innerHTML = `<div class="empty"><p>nothing found for “${escapeHtml(q)}”</p></div>`;
        return;
      }
      this.resultsBody.innerHTML = data.results
        .map((r, i) => {
          const clean = cleanYouTubeTitle(r.title, r.artist);
          return `
            <button class="row" data-yt="${r.id}" data-title="${escapeHtml(clean.title)}" data-artist="${escapeHtml(clean.artist)}" data-thumb="${escapeHtml(r.thumb)}" style="--i:${i}; --c:${laneColor(r.id)}">
              <span class="row-n">${String(i + 1).padStart(2, '0')}</span>
              <span class="row-cover wide"><img src="${escapeHtml(r.thumb)}" alt="" loading="lazy" /></span>
              <span class="row-text"><b>${escapeHtml(clean.title)}</b><small>${escapeHtml(clean.artist || r.artist)}</small></span>
              <span class="row-meta"><span>${r.duration ? formatTime(r.duration) : ''}</span></span>
              <span class="row-add">+</span>
            </button>`;
        })
        .join('');
      this.markInCrate();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.resultsBody.innerHTML = '';
      this.showTab('crate');
      tab.hidden = true;
      toast(`search failed: ${(e as Error).message}`, 'error');
    }
  }

  private markInCrate() {
    this.resultsBody.querySelectorAll<HTMLElement>('.row[data-yt]').forEach((r) => {
      const inCrate = this.songs.some((s) => s.ytId === r.dataset.yt);
      r.classList.toggle('in-crate', inCrate);
      const add = r.querySelector('.row-add');
      if (add) add.textContent = inCrate ? '▶' : '+';
    });
  }

  // ------------------------------------------------------------- song modal

  openSong(song: SongRecord) {
    this.closeSong();
    let diff: Difficulty = settings.lastDifficulty;
    const a = song.analysis;
    const cover = escapeHtml(coverFor(song));
    const el = h(`
      <div class="modal-veil">
        <div class="modal song-modal">
          <div class="sm-bg" style="background-image:url('${cover}')"></div>
          <button class="close" aria-label="close">×</button>
          <div class="sm-cover"><img src="${cover}" alt="" /></div>
          <div class="sm-body">
            <div class="eyebrow"><span class="live-dot"></span>${song.source === 'youtube' ? 'from youtube' : song.source === 'demo' ? 'built-in' : 'local file'} · ${Math.round(a.bpm)} bpm · ${formatTime(a.duration)}</div>
            <h2 class="sm-title">${escapeHtml(song.title)}</h2>
            <div class="sm-artist">${escapeHtml(song.artist || '—')}</div>
            <div class="diff-grid">
              ${DIFFICULTIES.map((d, i) => {
                const c = a.charts[d];
                const best = song.best[d];
                return `
                  <button class="diff-btn diff-${d}" data-d="${d}">
                    <span class="diff-top"><span class="diff-name">${d}</span><kbd>${i + 1}</kbd></span>
                    <span class="diff-stars">${'●'.repeat(Math.min(10, Math.max(1, Math.round(c.stars))))}<i>${c.stars}</i></span>
                    <span class="diff-foot"><span>${c.notes.length} notes</span><span>${best ? `${best.grade} · ${(best.accuracy * 100).toFixed(1)}%${best.fullCombo ? ' fc' : ''}` : 'unplayed'}</span></span>
                  </button>`;
              }).join('')}
            </div>
            <button class="btn-play">play<kbd>↵</kbd></button>
            <div class="sm-foot">
              <button class="inline-link" data-act="reanalyze">re-analyze</button>
              <button class="inline-link danger" data-act="delete">delete</button>
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
