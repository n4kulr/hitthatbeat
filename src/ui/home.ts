import { DIFFICULTIES, type Difficulty, type SongRecord } from '../types';
import { keyLabel, saveSettings, settings } from '../lib/settings';
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

const ICON_FILE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

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
  private crateBody: HTMLElement;
  private modal: HTMLElement | null = null;
  private attract: Attract;

  constructor(private actions: HomeActions) {
    this.el = h(`
      <div class="home">
        <canvas class="attract"></canvas>
        <div class="scrim"></div>

        <aside class="panel">
          <div class="lanes" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <h1 class="logo" aria-label="hit that beat">
            <span class="l1">hit</span><span class="l2">that</span><span class="l3">beat</span>
          </h1>
          <p class="tagline">Turn any song into a four-lane chart and play it.</p>

          <label class="drop">
            <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.opus" hidden />
            <span class="drop-icon">${ICON_FILE}</span>
            <span class="drop-text"><b>Drop an audio file</b><small>or click to browse · mp3, wav, flac, ogg, m4a</small></span>
          </label>
          <button class="chip" data-act="demo">No file handy? Try the demo track</button>

          <section class="list">
            <div class="list-head">
              <h2 class="list-title">Library <span class="count">0</span></h2>
              <input class="filter" placeholder="filter…" spellcheck="false" />
            </div>
            <div class="list-body crate-body"></div>
          </section>

          <footer class="panel-foot">
            <span class="foot-keys"></span>
            <span>audio never leaves your device</span>
          </footer>
        </aside>

        <button class="icon-btn settings-btn" data-act="settings" aria-label="settings">${ICON_GEAR}</button>
        <div class="demo-tag">autoplay preview</div>
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
          <div class="empty-title">your library is empty</div>
          <p>Drop a song above and it gets four charts, easy to expert. Or warm up with the <button class="inline-link" data-act="demo">demo track</button>.</p>
        </div>`;
      return;
    }
    if (!list.length) {
      this.crateBody.innerHTML = `<div class="empty"><p>no match for “${escapeHtml(q)}”</p></div>`;
      return;
    }
    this.crateBody.innerHTML = list
      .map((s) => {
        const best = bestGrade(s);
        return `
          <button class="row" data-song="${escapeHtml(s.id)}" style="--c:${LANE_COLORS[hash(s.id) % 4]}">
            <span class="row-cover"><img src="${escapeHtml(coverFor(s))}" alt="" loading="lazy" /></span>
            <span class="row-text"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.artist || (s.source === 'file' ? 'local file' : '—'))}</small></span>
            <span class="row-meta"><span>${Math.round(s.analysis.bpm)} bpm</span><span>${formatTime(s.analysis.duration)}</span></span>
            ${best ? `<span class="row-grade grade-${best.b.grade}" title="best on ${best.d}">${best.b.grade}</span>` : ''}
          </button>`;
      })
      .join('');
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
            <div class="sm-meta">${song.source === 'demo' ? 'built-in' : 'your file'} · ${Math.round(a.bpm)} bpm · ${formatTime(a.duration)}</div>
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
