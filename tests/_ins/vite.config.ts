import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: resolve(__dirname),
  resolve: { alias: { '@shared': resolve(__dirname, '../../src/shared'), '@': resolve(__dirname, '../../src/renderer/src') } },
  plugins: [react()],
  define: { __WEB_MOCK__: 'true' },
  server: { port: 5198, host: '127.0.0.1', fs: { strict: false } },
});
