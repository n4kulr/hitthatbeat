# hit that beat

A RoBeats-style 4-lane rhythm game for the browser. Drop any song in (or search YouTube when running locally) and it auto-generates easy / normal / hard / expert charts from the audio.

## Run locally (full version, with YouTube search)

```bash
npm install
npm run dev
```

The dev server downloads `yt-dlp` on first run and serves YouTube audio from your machine. Personal use only.

## Deployed build (e.g. Vercel)

Static only: file drop and the demo track work, YouTube search doesn't (there's no backend).

## Controls

`D F J K` by default (rebind in settings), `Esc` to pause. Touch works too.
