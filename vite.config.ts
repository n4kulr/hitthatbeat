import { defineConfig } from 'vite';
import { youtubePlugin } from './server/youtube.ts';

export default defineConfig({
  plugins: [youtubePlugin()],
  server: { open: true, port: 5173 },
  worker: { format: 'es' },
});
