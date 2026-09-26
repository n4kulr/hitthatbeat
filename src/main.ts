import './style.css';
import type { Difficulty, SongRecord } from './types';
import { db } from './lib/db';
import { cleanMeta, h, hash, titleFromFilename } from './lib/util';
import { analyzeBuffer, decode } from './audio/engine';
import { ANALYZER_VERSION } from './audio/analyze';
import { renderDemoTrack } from './audio/demo';
import { Game } from './game/game';
import { Home } from './ui/home';
import { showProgress, toast, type ProgressHandle } from './ui/feedback';
import { showResults } from './ui/results';

const app = document.getElementById('app')!;
let songs: SongRecord[] = [];
const buffers = new Map<string, AudioBuffer>();
let busy = false;
let inGame = false;

const home = new Home({
  importFile,
  importDemo,
  play,
  remove: async (song) => {
    await db.remove(song.id);
    buffers.delete(song.id);
    toast(`removed “${song.title}”`);
    refresh();
  },
  reanalyze: async (song) => {
    const updated = await withProgress(song.title, (p) => reanalyze(song, p));
    if (updated) home.openSong(updated);
  },
});
app.appendChild(home.el);
home.show();

async function refresh() {
  songs = await db.all();
  for (const s of songs) {
    const m = cleanMeta(s.title, s.artist);
    if (s.source === 'file' && (m.title !== s.title || m.artist !== s.artist)) {
      Object.assign(s, m);
      await db.put(s);
    }
  }
  home.setSongs(songs);
}

async function withProgress<T>(title: string, fn: (p: ProgressHandle) => Promise<T>): Promise<T | null> {
  if (busy) {
    toast('hang on, still working on the last one');
    return null;
  }
  busy = true;
  const p = showProgress(title);
  try {
    return await fn(p);
  } catch (e) {
    toast((e as Error).message || 'something went wrong', 'error');
    return null;
  } finally {
    busy = false;
    p.close();
  }
}

async function getBuffer(song: SongRecord): Promise<AudioBuffer> {
  let buf = buffers.get(song.id);
  if (!buf) {
    buf = await decode(await song.audio.arrayBuffer());
    buffers.set(song.id, buf);
  }
  return buf;
}

async function reanalyze(song: SongRecord, p: ProgressHandle): Promise<SongRecord> {
  const buffer = await getBuffer(song);
  const analysis = await analyzeBuffer(buffer, p.update);
  const updated = { ...song, analysis };
  await db.put(updated);
  await refresh();
  return updated;
}

async function saveNew(
  base: Omit<SongRecord, 'analysis' | 'addedAt' | 'best'>,
  buffer: AudioBuffer,
  p: ProgressHandle,
): Promise<SongRecord> {
  const analysis = await analyzeBuffer(buffer, p.update);
  const song: SongRecord = { ...base, analysis, addedAt: Date.now(), best: {} };
  await db.put(song);
  buffers.set(song.id, buffer);
  await refresh();
  return song;
}

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|webm|mp4)$/i;

async function importFile(file: File) {
  if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) {
    toast("that doesn't look like an audio file", 'error');
    return;
  }
  const id = `file:${hash(`${file.name}:${file.size}`).toString(36)}`;
  const existing = songs.find((s) => s.id === id);
  if (existing) return home.openSong(existing);
  const meta = titleFromFilename(file.name);
  const song = await withProgress(meta.title, async (p) => {
    p.update('decoding', 0);
    const blob = new Blob([file], { type: file.type || 'audio/mpeg' });
    const buffer = await decode(await blob.arrayBuffer());
    return saveNew({ id, ...meta, source: 'file', audio: blob }, buffer, p);
  });
  if (song) home.openSong(song);
}

async function importDemo() {
  const existing = songs.find((s) => s.id === 'demo');
  if (existing) return home.openSong(existing);
  const song = await withProgress('starter track', async (p) => {
    p.update('decoding', 0);
    const blob = await renderDemoTrack();
    const buffer = await decode(await blob.arrayBuffer());
    return saveNew({ id: 'demo', title: 'starter track', artist: 'juke', source: 'demo', audio: blob }, buffer, p);
  });
  if (song) home.openSong(song);
}

function wipe(mid: () => void) {
  const w = h('<div class="wipe"><i></i><i></i><i></i><i></i></div>');
  document.body.appendChild(w);
  setTimeout(mid, 420);
  setTimeout(() => w.remove(), 1000);
}

async function play(song: SongRecord, diff: Difficulty) {
  if (song.analysis.version !== ANALYZER_VERSION) {
    const updated = await withProgress(song.title, (p) => reanalyze(song, p));
    if (!updated) return;
    song = updated;
  }
  let buffer: AudioBuffer;
  try {
    buffer = await getBuffer(song);
    await document.fonts.ready;
  } catch (e) {
    toast((e as Error).message, 'error');
    return;
  }
  inGame = true;
  wipe(() => {
    home.hide();
    const game = new Game({
      song,
      buffer,
      difficulty: diff,
      mount: app,
      onQuit: () => wipe(showHome),
      onFinish: async (result) => {
        const prev = song.best[diff];
        const newBest = result.score > 0 && (!prev || result.score > prev.score);
        const fresh = (await db.get(song.id)) ?? song;
        if (newBest) {
          fresh.best[diff] = {
            score: result.score,
            accuracy: result.accuracy,
            grade: result.grade,
            maxCombo: result.maxCombo,
            fullCombo: result.fullCombo,
            date: Date.now(),
          };
        }
        fresh.lastPlayed = Date.now();
        await db.put(fresh);
        song = fresh;
        refresh();
        wipe(() =>
          showResults(app, fresh, result, newBest, {
            onRetry: () => play(fresh, diff),
            onBack: () => wipe(showHome),
          }),
        );
      },
    });
    game.start();
  });
}

function showHome() {
  inGame = false;
  home.show();
  refresh();
}

// --------------------------------------------------------------- drag & drop anywhere

let dragDepth = 0;
const veil = h('<div class="drop-veil"><div class="drop-veil-text">drop it like it’s hot</div></div>');
document.body.appendChild(veil);
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || inGame) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (inGame) return;
  const file = e.dataTransfer?.files[0];
  if (file) importFile(file);
});

refresh();
