import { parentPort } from 'node:worker_threads';
import type { ThumbSize } from '@shared/types';
import { renderHeic } from './heic';

export interface HeicRequest { id: number; file: string; size: ThumbSize }

parentPort?.on('message', async (m: HeicRequest) => {
  try {
    const buf = await renderHeic(m.file, m.size);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    parentPort!.postMessage({ id: m.id, buf: ab }, [ab]);
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String((e as Error)?.message ?? e) });
  }
});
