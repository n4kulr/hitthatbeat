import type { Plugin, Connect } from 'vite';
import type { ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BIN_DIR = path.join(ROOT, '.ytdlp');
const AUDIO_DIR = path.join(ROOT, '.cache', 'audio');
const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const LOCAL_BIN = path.join(BIN_DIR, BIN_NAME);
const RELEASE_ASSET =
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${RELEASE_ASSET}`;
const UPDATE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumb: string;
  file: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], onLine?: (line: string) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const feed = (chunk: string) => {
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) onLine(l);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
      feed(d);
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
      feed(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function onPath(): Promise<boolean> {
  try {
    const r = await run('yt-dlp', ['--version']);
    return r.code === 0;
  } catch {
    return false;
  }
}

let binPromise: Promise<string> | null = null;

function ensureYtDlp(): Promise<string> {
  binPromise ??= (async () => {
    if (fs.existsSync(LOCAL_BIN)) {
      const age = Date.now() - fs.statSync(LOCAL_BIN).mtimeMs;
      if (age > UPDATE_AFTER_MS) {
        // YouTube breaks old yt-dlp versions often, so keep the local copy fresh.
        run(LOCAL_BIN, ['-U'])
          .then(() => fs.utimesSync(LOCAL_BIN, new Date(), new Date()))
          .catch(() => {});
      }
      return LOCAL_BIN;
    }
    if (await onPath()) return 'yt-dlp';
    console.log('\n  [hitthatbeat] downloading yt-dlp (one-time)...');
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const res = await fetch(RELEASE_URL);
    if (!res.ok) throw new Error(`could not download yt-dlp (${res.status})`);
    fs.writeFileSync(LOCAL_BIN, Buffer.from(await res.arrayBuffer()));
    if (process.platform !== 'win32') fs.chmodSync(LOCAL_BIN, 0o755);
    console.log('  [hitthatbeat] yt-dlp ready\n');
    return LOCAL_BIN;
  })();
  binPromise.catch(() => (binPromise = null));
  return binPromise;
}

// yt-dlp needs a JavaScript runtime to solve YouTube's player challenges; Node is already here.
const JS_RUNTIME_ARGS = ['--js-runtimes', `node:${process.execPath}`];

function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith('youtu.be')) {
      const id = u.pathname.slice(1, 12);
      return ID_RE.test(id) ? id : null;
    }
    const v = u.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function metaPath(id: string) {
  return path.join(AUDIO_DIR, `${id}.meta.json`);
}

function readCached(id: string): TrackMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8')) as TrackMeta;
    return fs.existsSync(path.join(AUDIO_DIR, meta.file)) ? meta : null;
  } catch {
    return null;
  }
}

function firstError(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((l) => l.startsWith('ERROR:'));
  return (line ?? stderr.trim().split(/\r?\n/).pop() ?? 'yt-dlp failed').replace(/^ERROR:\s*/, '').slice(0, 300);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function handleSearch(q: string, res: ServerResponse) {
  const bin = await ensureYtDlp();
  const r = await run(bin, ['--flat-playlist', '-J', '--no-warnings', ...JS_RUNTIME_ARGS, `ytsearch12:${q}`]);
  if (r.code !== 0) return json(res, 502, { error: firstError(r.stderr) });
  const data = JSON.parse(r.stdout) as { entries?: Record<string, unknown>[] };
  const results = (data.entries ?? [])
    .filter((e) => typeof e.id === 'string' && ID_RE.test(e.id as string))
    .map((e) => ({
      id: e.id as string,
      title: (e.title as string) ?? 'untitled',
      artist: ((e.channel ?? e.uploader) as string) ?? '',
      duration: (e.duration as number) ?? 0,
      thumb: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    }));
  json(res, 200, { results });
}

async function handleFetch(input: string, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');
  const done = (meta: TrackMeta) => {
    send({ type: 'done', meta, audio: `/api/yt/audio/${meta.id}` });
    res.end();
  };

  const knownId = parseVideoId(input);
  if (knownId) {
    const cached = readCached(knownId);
    if (cached) return done(cached);
  }

  let bin: string;
  try {
    send({ type: 'progress', stage: 'setup', pct: 0 });
    bin = await ensureYtDlp();
  } catch (e) {
    send({ type: 'error', message: (e as Error).message });
    return res.end();
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const target = knownId ? `https://www.youtube.com/watch?v=${knownId}` : input;
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestaudio[ext=m4a]/bestaudio',
    '-o',
    path.join(AUDIO_DIR, '%(id)s.%(ext)s'),
    '--no-simulate',
    '--newline',
    '--progress',
    '--progress-template',
    'download:PROG %(progress._percent_str)s',
    '-O',
    'after_move:%(.{id,title,uploader,channel,duration,filepath})j',
    ...JS_RUNTIME_ARGS,
    target,
  ];

  let info: Record<string, unknown> | null = null;
  const r = await run(bin, args, (line) => {
    const prog = line.match(/PROG\s+([\d.]+)%/);
    if (prog) return send({ type: 'progress', stage: 'download', pct: parseFloat(prog[1]) });
    if (line.startsWith('{')) {
      try {
        info = JSON.parse(line);
      } catch {}
    }
  });

  const got = info as Record<string, unknown> | null;
  if (r.code !== 0 || !got || typeof got.filepath !== 'string') {
    send({ type: 'error', message: firstError(r.stderr) });
    return res.end();
  }

  const id = got.id as string;
  const meta: TrackMeta = {
    id,
    title: (got.title as string) ?? 'untitled',
    artist: ((got.channel ?? got.uploader) as string) ?? '',
    duration: (got.duration as number) ?? 0,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    file: path.basename(got.filepath as string),
  };
  fs.writeFileSync(metaPath(id), JSON.stringify(meta));
  done(meta);
}

const MIME: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function handleAudio(id: string, res: ServerResponse) {
  const meta = ID_RE.test(id) ? readCached(id) : null;
  if (!meta) return json(res, 404, { error: 'not downloaded' });
  const file = path.join(AUDIO_DIR, meta.file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(file).size);
  fs.createReadStream(file).pipe(res);
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith('/api/yt/')) return next();
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.slice('/api/yt/'.length);

  const fail = (e: unknown) => {
    if (!res.headersSent) json(res, 500, { error: (e as Error).message ?? String(e) });
    else res.end();
  };

  if (route === 'status') {
    ensureYtDlp()
      .then(() => json(res, 200, { ready: true }))
      .catch((e) => json(res, 200, { ready: false, error: (e as Error).message }));
    return;
  }
  if (route === 'search') {
    const q = url.searchParams.get('q')?.trim();
    if (!q) return json(res, 400, { error: 'missing q' });
    handleSearch(q.slice(0, 200), res).catch(fail);
    return;
  }
  if (route === 'fetch') {
    const input = url.searchParams.get('url')?.trim();
    if (!input) return json(res, 400, { error: 'missing url' });
    handleFetch(input, res).catch(fail);
    return;
  }
  if (route.startsWith('audio/')) {
    try {
      handleAudio(route.slice('audio/'.length), res);
    } catch (e) {
      fail(e);
    }
    return;
  }
  json(res, 404, { error: 'unknown route' });
};

export function youtubePlugin(): Plugin {
  return {
    name: 'hitthatbeat-youtube',
    configureServer(server) {
      server.middlewares.use(middleware);
      ensureYtDlp().catch((e) => console.warn('  [hitthatbeat] yt-dlp unavailable:', e.message));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
