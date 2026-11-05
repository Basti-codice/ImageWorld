import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const repo = '/home/user/ImageWorld';
export default defineConfig({
  root: resolve(repo, '.tmp-photos-harness'),
  resolve: { alias: { '@shared': resolve(repo, 'src/shared'), '@': resolve(repo, 'src/renderer/src') } },
  plugins: [react()],
  server: { port: 5311, host: '127.0.0.1', fs: { strict: false } },
  cacheDir: '/tmp/claude-0/-home-user-ImageWorld/75d7d373-b95a-54ae-bf9a-b31004413442/scratchpad/photos/vitecache',
});
