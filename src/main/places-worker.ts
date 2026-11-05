// worker_thread entry: builds the offline city index off the main thread and answers requests.
import { parentPort } from 'node:worker_threads';
import { getPlaceIndex } from './places';

export type PlaceRequest =
  | { id: number; type: 'reverse'; points: Array<[number, number]> }
  | { id: number; type: 'search'; query: string; lang: string; limit?: number }
  | { id: number; type: 'warm' };

parentPort?.on('message', async (m: PlaceRequest) => {
  try {
    const idx = await getPlaceIndex();
    if (m.type === 'reverse') parentPort!.postMessage({ id: m.id, result: idx.reverseMany(m.points) });
    else if (m.type === 'search') parentPort!.postMessage({ id: m.id, result: idx.search(m.query, m.lang, m.limit) });
    else parentPort!.postMessage({ id: m.id, result: idx.size });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String((e as Error)?.stack ?? e) });
  }
});
