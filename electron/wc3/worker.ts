// The importer on a worker thread, so the window stays responsive while it runs.
import { parentPort, workerData } from 'node:worker_threads';
import { importWarcraft } from './importer';

const { dir, outDir, files } = workerData as { dir: string; outDir: string; files?: Record<string, string[]> };
void importWarcraft(dir, outDir, (p) => parentPort?.postMessage({ type: 'progress', progress: p }), { files }).then(
  (report) => parentPort?.postMessage({ type: 'done', report }),
  (e: Error) => parentPort?.postMessage({ type: 'error', message: String(e?.stack ?? e) }),
);
