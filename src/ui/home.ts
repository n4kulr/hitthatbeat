import { DIFFICULTIES, type Difficulty, type SongRecord } from '../types';
import { keyLabel, settings } from '../lib/settings';
import { coverArt, escapeHtml, formatTime, h, hash } from '../lib/util';
import { playSfx } from '../audio/sfx';
import { MenuMusic } from '../audio/menu-music';
import { LANE_COLORS } from '../game/render';
import { openSettings } from './settings';
import { confirmDialog } from './feedback';
import { MenuStage } from './menu-stage';

export interface HomeActions {
  importFile(file: File): void;
  importDemo(): void;
  play(song: SongRecord, diff: Difficulty): void;
  remove(song: SongRecord): void;
  reanalyze(song: SongRecord): void;
  getBuffer(song: SongRecord): Promise<AudioBuffer>;
}

type View = 'idle' | 'menu' | 'select';

const svg = (body: string, size = 30) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON_PLAY = svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>');
const ICON_IMPORT = svg('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>');
const ICON_DEMO = svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 9 9"/>');
const ICON_GEAR = svg(
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
);
const ICON_PAUSE = svg('<path d="M8 5v14M16 5v14"/>', 16);
const ICON_RESUME = svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>', 16);
const ICON_NEXT = svg('<path d="M5 5v14l10-7z" fill="currentColor"/><path d="M19 5v14"/>', 16);

const CODE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const DIFF_COLORS = ['#3fe0b5', '#7b8cff', '#ff8a3d', '#ff4f8b'];

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

/**
 * The menus, osu!-style: a big logo that beats to the music, a button band that slides
 * out of it, and a curved song carousel.
 */
export class Home {
  el: HTMLElement;
  private songs: SongRecord[] = [];
  private codes = new Map<string, string>();
  private crateBody: HTMLElement;
  private modal: HTMLElement | null = null;
  private view: View = 'idle';
  private logo: HTMLElement;
  private disc: HTMLElement;
  private stage: MenuStage;
  private music = new MenuMusic();
  private levels = new Float32Array(48);
  private raf = 0;
  private running = false;
  private last = 0;
  private mx = 0;
  private my = 0;
  private gestured = false;
  private loading: SongRecord | null = null;
  private narrow = matchMedia('(max-width: 760px)');

  constructor(private actions: HomeActions) {
    this.el = h(`
      <div class="home" data-view="idle">
        <canvas class="stage"></canvas>

        <header class="topbar">
          <div class="tb-brand"><span class="wordmark-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>juke</div>
          <div class="np" hidden>
            <span class="np-eq" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="np-text"><small>now playing</small><b class="np-title"></b></span>
            <button class="np-btn" data-act="np-toggle" aria-label="pause music">${ICON_PAUSE}</button>
            <button class="np-btn" data-act="np-next" aria-label="next song">${ICON_NEXT}</button>
          </div>
        </header>

        <div class="band">
          <nav class="menu" aria-label="main menu">
            <button class="mbtn" style="--c:var(--pink)" data-act="play"><span class="mbtn-in">${ICON_PLAY}<b>Play</b><small>song select</small></span></button>
            <button class="mbtn" style="--c:var(--lemon)" data-act="import"><span class="mbtn-in">${ICON_IMPORT}<b>Import</b><small>any audio file</small></span></button>
            <button class="mbtn" style="--c:var(--mint)" data-act="demo"><span class="mbtn-in">${ICON_DEMO}<b>Demo</b><small>built-in track</small></span></button>
            <button class="mbtn" style="--c:var(--peri)" data-act="settings"><span class="mbtn-in">${ICON_GEAR}<b>Options</b><small>keys · offset</small></span></button>
          </nav>
        </div>

        <button class="logo" aria-label="juke: open the menu">
          <span class="logo-disc"><span class="logo-tris"></span><span class="logo-word">juke</span></span>
        </button>
        <p class="logo-hint"><span>click the circle</span><small>any song, four lanes</small></p>

        <section class="select" aria-label="song select">
          <div class="select-head">
            <h2 class="list-title">Song select <span class="count">0</span></h2>
            <input class="filter" placeholder="Search" spellcheck="false" aria-label="search songs" />
          </div>
          <div class="select-list crate-body"></div>
        </section>

        <button class="back" data-act="back"><span>‹ back</span></button>

        <footer class="home-foot">
          <span class="foot-keys"></span>
          <span>audio never leaves your device</span>
        </footer>
        <input class="file-input" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.opus" hidden />
      </div>`);

    this.crateBody = this.el.querySelector('.crate-body')!;
    this.logo = this.el.querySelector('.logo')!;
    this.disc = this.el.querySelector('.logo-disc')!;
    this.stage = new MenuStage(this.el.querySelector('canvas')!);
    this.refreshKeys();

    const fileInput = this.el.querySelector<HTMLInputElement>('.file-input')!;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.actions.importFile(f);
      fileInput.value = '';
    });

    this.el.querySelector('.filter')!.addEventListener('input', () => this.renderCrate());
    this.crateBody.addEventListener('scroll', () => this.curve(), { passive: true });
    window.addEventListener('resize', () => {
      if (!this.running) return;
      this.stage.resize();
      this.curve();
    });
    this.el.addEventListener('pointermove', (e) => {
      this.mx = (e.clientX / window.innerWidth) * 2 - 1;
      this.my = (e.clientY / window.innerHeight) * 2 - 1;
    });
    this.el.addEventListener('pointerdown', () => this.gesture());

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.logo')) {
        playSfx('ui', 0.5);
        return this.setView(this.view === 'idle' ? 'menu' : this.view === 'menu' ? 'select' : 'menu');
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) playSfx('ui', 0.4);
      if (act === 'play') this.setView('select');
      if (act === 'import') fileInput.click();
      if (act === 'demo') this.actions.importDemo();
      if (act === 'settings') openSettings(() => this.refreshKeys());
      if (act === 'back') this.setView('menu');
      if (act === 'np-toggle') this.togglePause();
      if (act === 'np-next') this.nextSong();

      const row = t.closest<HTMLElement>('.row[data-song]');
      if (!row) return;
      const song = this.songs.find((s) => s.id === row.dataset.song);
      if (song) this.openSong(song);
    });

    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || document.querySelector('.modal-veil')) return;
      if ((e.target as HTMLElement).matches?.('input')) {
        if (e.code === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      this.gesture();
      if (this.view === 'idle' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.setView('menu');
      } else if (this.view === 'menu') {
        if (e.code === 'Escape') this.setView('idle');
        else if (e.code === 'Enter' || e.code === 'KeyP') this.setView('select');
      } else if (this.view === 'select') {
        if (e.code === 'Escape') this.setView('menu');
        else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          e.preventDefault();
          this.moveFocus(e.code === 'ArrowDown' ? 1 : -1);
        }
      }
    });
  }

  private setView(v: View) {
    if (v === this.view) return;
    this.view = v;
    this.el.dataset.view = v;
    if (v === 'select') {
      requestAnimationFrame(() => this.curve());
      if (matchMedia('(pointer: fine)').matches) setTimeout(() => this.el.querySelector<HTMLElement>('.row')?.focus({ preventScroll: true }), 350);
    }
  }

  private moveFocus(dir: number) {
    const rows = [...this.crateBody.querySelectorAll<HTMLElement>('.row')];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + dir))];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  show() {
    this.el.hidden = false;
    if (this.running) return;
    this.running = true;
    this.stage.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if (this.gestured) this.ensureMusic();
  }

  hide() {
    this.el.hidden = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.music.stop();
    this.updateNowPlaying();
  }

  // ------------------------------------------------------------- music

  /** Browsers only allow audio after the first click or key press. */
  private gesture() {
    if (this.gestured) return;
    this.gestured = true;
    this.ensureMusic();
  }

  private ensureMusic() {
    if (!this.music.song && this.songs.length) this.playSong(this.songs[0]);
  }

  private async playSong(song: SongRecord) {
    if (this.music.song?.id === song.id || this.loading === song) return;
    this.loading = song;
    try {
      const buf = await this.actions.getBuffer(song);
      if (this.loading !== song || this.el.hidden) return;
      this.music.play(song, buf);
      this.updateNowPlaying();
    } catch {
      // a song that won't decode just doesn't preview
    } finally {
      if (this.loading === song) this.loading = null;
    }
  }

  private nextSong() {
    if (!this.songs.length) return;
    const i = this.songs.findIndex((s) => s.id === this.music.song?.id);
    const next = this.songs[(i + 1) % this.songs.length];
    if (next.id !== this.music.song?.id) this.playSong(next);
  }

  private togglePause() {
    this.music.togglePause();
    this.updateNowPlaying();
  }

  private updateNowPlaying() {
    const np = this.el.querySelector<HTMLElement>('.np')!;
    const song = this.music.song;
    np.hidden = !song;
    if (!song) return;
    np.querySelector('.np-title')!.textContent = song.artist ? `${song.artist} — ${song.title}` : song.title;
    np.classList.toggle('paused', this.music.paused);
    const btn = np.querySelector<HTMLElement>('[data-act="np-toggle"]')!;
    btn.innerHTML = this.music.paused ? ICON_RESUME : ICON_PAUSE;
    btn.setAttribute('aria-label', this.music.paused ? 'resume music' : 'pause music');
  }

  // ------------------------------------------------------------- frame

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    this.music.levels(this.levels);
    // no music yet: breathe slowly so the logo still feels alive
    const pulse = this.music.playing ? this.music.pulse() : 0.18 * (0.5 + 0.5 * Math.sin(t * 2.2));
    this.disc.style.setProperty('--pulse', pulse.toFixed(3));
    const r = this.logo.getBoundingClientRect();
    // on phones the logo steps aside for the song list
    const hidden = this.narrow.matches && this.view === 'select';
    this.stage.draw({
      dt,
      t,
      pulse,
      levels: this.levels,
      logo: { x: r.left + r.width / 2, y: r.top + r.height / 2, r: hidden ? 0 : (r.width / 2) * (1 + pulse * 0.035) },
      mx: this.mx,
      my: this.my,
      effects: settings.effects,
    });
  }

  /** Bend the carousel: cards slide right the further they are from the middle. */
  private curve() {
    const box = this.crateBody.getBoundingClientRect();
    const mid = box.top + box.height / 2;
    for (const row of this.crateBody.querySelectorAll<HTMLElement>('.row')) {
      const rr = row.getBoundingClientRect();
      const d = (rr.top + rr.height / 2 - mid) / (box.height / 2 || 1);
      row.style.setProperty('--curve', `${Math.round(Math.min(1.4, d * d) * 70)}px`);
    }
  }

  private refreshKeys() {
    this.el.querySelector('.foot-keys')!.innerHTML = settings.keys
      .map((k, i) => `<span class="ring" style="--c:${LANE_COLORS[i]}">${keyLabel(k)}</span>`)
      .join('');
  }

  // ------------------------------------------------------------- library

  setSongs(songs: SongRecord[]) {
    // jukebox selection codes follow the order songs were added, so they never shuffle
    this.codes = new Map(
      [...songs].sort((a, b) => a.addedAt - b.addedAt).map((s, i) => [s.id, `${CODE_LETTERS[Math.floor(i / 9) % CODE_LETTERS.length]}${(i % 9) + 1}`]),
    );
    this.songs = [...songs].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
    this.el.querySelector('.list-title .count')!.textContent = String(songs.length);
    if (this.music.song && !songs.some((s) => s.id === this.music.song!.id)) {
      this.music.stop();
      this.updateNowPlaying();
    }
    if (this.gestured && this.running) this.ensureMusic();
    this.renderCrate();
  }

  private renderCrate() {
    const q = this.el.querySelector<HTMLInputElement>('.filter')!.value.trim().toLowerCase();
    const list = this.songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
    const importCard = `
      <button class="row row-import" data-act="import">
        <span class="row-plus">+</span>
        <span class="row-text"><b>Import a track</b><small>drop a file anywhere, or click · mp3 wav flac ogg m4a</small></span>
      </button>`;
    const demoCard = this.songs.some((s) => s.source === 'demo')
      ? ''
      : `<button class="row row-import" data-act="demo">
          <span class="row-plus">♪</span>
          <span class="row-text"><b>Play the demo track</b><small>a built-in 124 bpm warm-up</small></span>
        </button>`;
    if (q && !list.length) {
      this.crateBody.innerHTML = `<div class="empty">No match for “${escapeHtml(q)}”</div>`;
      return;
    }
    this.crateBody.innerHTML =
      importCard +
      list
        .map((s) => {
          const best = bestGrade(s);
          const cover = escapeHtml(coverFor(s));
          return `
          <button class="row" data-song="${escapeHtml(s.id)}" style="--c:${LANE_COLORS[hash(s.id) % 4]}">
            <span class="row-bg" style="background-image:url('${cover}')"></span>
            <span class="row-cover"><img src="${cover}" alt="" loading="lazy" /></span>
            <span class="row-text">
              <b>${escapeHtml(s.title)}</b>
              <small>${escapeHtml(s.artist || (s.source === 'file' ? 'Local file' : '—'))}</small>
              <span class="row-meta">
                <span class="row-code">${this.codes.get(s.id) ?? ''}</span>
                ${DIFFICULTIES.map((d, i) => `<i style="--d:${DIFF_COLORS[i]}" title="${d} ${s.analysis.charts[d].stars}★">${s.analysis.charts[d].stars.toFixed(1)}</i>`).join('')}
                <span>${Math.round(s.analysis.bpm)} bpm · ${formatTime(s.analysis.duration)}</span>
              </span>
            </span>
            ${best ? `<span class="row-grade grade-${best.b.grade}" title="best on ${best.d}">${best.b.grade}</span>` : ''}
          </button>`;
        })
        .join('') +
      demoCard;
    requestAnimationFrame(() => this.curve());
  }

  // ------------------------------------------------------------- song modal

  openSong(song: SongRecord) {
    this.closeSong();
    if (this.gestured) this.playSong(song);
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
