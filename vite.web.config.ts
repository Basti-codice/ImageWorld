// Plain-browser dev/preview of the renderer with the in-memory mock API (no Electron needed).
// Used for UI development, screenshots and automated visual checks.  `npm run dev:web`
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react()],
  define: { __WEB_MOCK__: 'true' },
  server: { port: 5199, host: '127.0.0.1' },
  preview: { port: 5199, host: '127.0.0.1' },
});
