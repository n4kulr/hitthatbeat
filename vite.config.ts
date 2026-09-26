import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true, port: 5173 },
  worker: { format: 'es' },
});
