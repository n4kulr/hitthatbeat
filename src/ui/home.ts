import { DIFFICULTIES, type Difficulty, type SongRecord } from '../types';
import { keyLabel, settings } from '../lib/settings';
import { coverArt, escapeHtml, formatTime, h, hash } from '../lib/util';
import { playSfx } from '../audio/sfx';
import { LANE_COLORS } from '../game/render';
import { openSettings } from './settings';
import { confirmDialog } from './feedback';
import { Attract } from './attract';

export interface HomeActions {
  importFile(file: File): void;
  importDemo(): void;
  play(song: SongRecord, diff: Difficulty): void;
  remove(song: SongRecord): void;
  reanalyze(song: SongRecord): void;
}

const ICON_FILE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

const CODE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function coverFor(song: SongRecord) {
  return coverArt(song.id + song.title, song.analysis.waveform);
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
  private codes = new Map<string, string>();
  private crateBody: HTMLElement;
  private modal: HTMLElement | null = null;
  private attract: Attract;

  constructor(private actions: HomeActions) {
    this.el = h(`
      <div class="home">
        <canvas class="attract"></canvas>
        <div class="stage-shade" aria-hidden="true"></div>

        <aside class="panel">
          <header class="brand">
            <h1 class="wordmark" aria-label="juke">
              <span class="wordmark-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>juke
            </h1>
            <button class="icon-btn" data-act="settings" aria-label="settings">${ICON_GEAR}</button>
          </header>

          <section class="hero">
            <h2 class="headline">Any song.<br /><span>Four lanes.</span></h2>
            <p class="lede">Drop in an audio file. juke finds the beat and writes four charts, easy to expert, without the song ever leaving your browser.</p>
          </section>

          <label class="drop">
            <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.opus" hidden />
            <span class="drop-icon">${ICON_FILE}</span>
            <span class="drop-text"><b>Drop a track</b><small>mp3 · wav · flac · ogg · m4a</small></span>
            <span class="drop-cta">Browse</span>
          </label>

          <section class="list">
            <div class="list-head">
              <h2 class="list-title">Library <span class="count">0</span></h2>
              <input class="filter" placeholder="Search" spellcheck="false" aria-label="search library" />
            </div>
            <div class="list-body crate-body"></div>
          </section>

          <footer class="panel-foot">
            <span class="foot-keys"></span>
            <span class="foot-note"><kbd>esc</kbd> pause</span>
          </footer>
        </aside>

        <div class="stage-tag"><span class="live-dot"></span>autoplay</div>
      </div>`);

    this.crateBody = this.el.querySelector('.crate-body')!;
    this.attract = new Attract(this.el.querySelector('canvas')!);
    this.refreshKeys();

    const fileInput = this.el.querySelector<HTMLInputElement>('.drop input')!;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.actions.importFile(f);
      fileInput.value = '';
    });

    this.el.querySelector('.filter')!.addEventListener('input', () => this.renderCrate());
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'settings') openSettings(() => this.refreshKeys());
      if (act === 'demo') this.actions.importDemo();

      const row = t.closest<HTMLElement>('.row');
      if (!row) return;
      const song = this.songs.find((s) => s.id === row.dataset.song);
      if (song) this.openSong(song);
    });
  }

  show() {
    this.el.hidden = false;
    this.attract.start();
  }

  hide() {
    this.el.hidden = true;
    this.attract.stop();
  }

  private refreshKeys() {
    this.el.querySelector('.foot-keys')!.innerHTML = settings.keys
      .map((k, i) => `<span class="ring" style="--c:${LANE_COLORS[i]}">${keyLabel(k)}</span>`)
      .join('');
  }

  setSongs(songs: SongRecord[]) {
    // jukebox selection codes follow the order songs were added, so they never shuffle
    this.codes = new Map(
      [...songs].sort((a, b) => a.addedAt - b.addedAt).map((s, i) => [s.id, `${CODE_LETTERS[Math.floor(i / 9) % CODE_LETTERS.length]}${(i % 9) + 1}`]),
    );
    this.songs = [...songs].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
    this.el.querySelector('.list-title .count')!.textContent = String(songs.length);
    this.renderCrate();
  }

  private renderCrate() {
    const q = this.el.querySelector<HTMLInputElement>('.filter')!.value.trim().toLowerCase();
    const list = this.songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
    if (!this.songs.length) {
      this.crateBody.innerHTML = `
        <div class="empty">
          <div class="empty-slots" aria-hidden="true">${'<i></i>'.repeat(3)}</div>
          <div class="empty-title">Nothing in the jukebox yet</div>
          <p>Drop a song above, or warm up with the <button class="inline-link" data-act="demo">demo track</button>.</p>
        </div>`;
      return;
    }
    if (!list.length) {
      this.crateBody.innerHTML = `<div class="empty"><p>No match for “${escapeHtml(q)}”</p></div>`;
      return;
    }
    this.crateBody.innerHTML = list
      .map((s) => {
        const best = bestGrade(s);
        return `
          <button class="row" data-song="${escapeHtml(s.id)}" style="--c:${LANE_COLORS[hash(s.id) % 4]}">
            <span class="row-code">${this.codes.get(s.id) ?? ''}</span>
            <span class="row-cover"><img src="${escapeHtml(coverFor(s))}" alt="" loading="lazy" /></span>
            <span class="row-text"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.artist || (s.source === 'file' ? 'Local file' : '—'))}</small></span>
            <span class="row-meta"><span>${Math.round(s.analysis.bpm)} bpm</span><span>${formatTime(s.analysis.duration)}</span></span>
            <span class="row-grade ${best ? `grade-${best.b.grade}` : 'grade-none'}" title="${best ? `best on ${best.d}` : 'not played yet'}">${best ? best.b.grade : '–'}</span>
          </button>`;
      })
      .join('');
    if (!this.songs.some((s) => s.source === 'demo'))
      this.crateBody.insertAdjacentHTML('beforeend', '<button class="inline-link list-demo" data-act="demo">+ add the demo track</button>');
  }

  // ------------------------------------------------------------- song modal

  openSong(song: SongRecord) {
    this.closeSong();
    let diff: Difficulty = 'normal';
    const a = song.analysis;
    const cover = escapeHtml(coverFor(song));
    const el = h(`
      <div class="modal-veil sheet-veil">
        <div class="modal song-modal" role="dialog" aria-label="${escapeHtml(song.title)}">
          <div class="sm-hero">
            <div class="sm-bg" style="background-image:url('${cover}')"></div>
            <div class="sm-cover"><img src="${cover}" alt="" /></div>
            <button class="close" aria-label="close">×</button>
          </div>
          <div class="sm-body">
            <div class="sm-code">${this.codes.get(song.id) ?? ''} · ${song.source === 'demo' ? 'built-in' : 'your file'}</div>
            <h2 class="sm-title">${escapeHtml(song.title)}</h2>
            <div class="sm-artist">${escapeHtml(song.artist || 'Unknown artist')}</div>
            <dl class="sm-stats">
              <div><dt>tempo</dt><dd>${Math.round(a.bpm)}<small>bpm</small></dd></div>
              <div><dt>length</dt><dd>${formatTime(a.duration)}</dd></div>
              <div><dt>notes</dt><dd>${a.charts.expert.notes.length}<small>max</small></dd></div>
            </dl>
            <div class="diff-grid" role="radiogroup" aria-label="difficulty">
              ${DIFFICULTIES.map((d, i) => {
                const c = a.charts[d];
                const best = song.best[d];
                const lit = Math.min(10, Math.max(1, Math.round(c.stars)));
                return `
                  <button class="diff-btn diff-${d}" data-d="${d}" role="radio">
                    <kbd>${i + 1}</kbd>
                    <span class="diff-name">${d}</span>
                    <span class="diff-stars" title="${c.stars} stars">${'<i class="on"></i>'.repeat(lit)}${'<i></i>'.repeat(10 - lit)}<b>${c.stars.toFixed(1)}</b></span>
                    <span class="diff-foot">${best ? `<span class="diff-best grade-${best.grade}">${best.grade}</span>${(best.accuracy * 100).toFixed(1)}%${best.fullCombo ? ' · FC' : ''}` : `${c.notes.length} notes`}</span>
                  </button>`;
              }).join('')}
            </div>
            <button class="btn-play"><span>Play</span><kbd>↵</kbd></button>
            <div class="sm-foot">
              <span class="sm-keys">${settings.keys.map((k, i) => `<span class="ring" style="--c:${LANE_COLORS[i]}">${keyLabel(k)}</span>`).join('')}</span>
              <span class="sm-links">
                <button class="inline-link" data-act="reanalyze">Re-analyze</button>
                <button class="inline-link danger" data-act="delete">Delete</button>
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
      el.querySelectorAll('.diff-btn').forEach((b) => {
        const on = (b as HTMLElement).dataset.d === d;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', String(on));
      });
    };
    select(diff);

    const play = () => {
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
      if (act === 'delete' && (await confirmDialog(`Remove “${song.title}” from your library?`, 'Delete', 'Keep it'))) {
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
