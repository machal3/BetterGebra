import type { AnalysisRequest, AnalysisResult } from './compute';
import { analyse } from './compute';

/**
 * One request in flight at a time; while the worker is busy only the newest request waits. So a drag never
 * queues up stale work, and the answer always catches up with the latest view.
 */
export class AnalysisClient {
  private worker: Worker | null = null;
  private busy = false;
  private waiting: AnalysisRequest | null = null;
  private gen = 0;

  constructor(private onResult: (r: AnalysisResult) => void) {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
        this.busy = false;
        this.onResult(e.data);
        this.flush();
      };
      this.worker.onerror = () => { this.worker = null; this.busy = false; this.flush(); };
    } catch {
      this.worker = null; // no module workers: compute on the main thread
    }
  }

  /** Latest generation number; results with a lower one are stale. */
  get current() { return this.gen; }

  request(req: Omit<AnalysisRequest, 'gen'>): void {
    this.waiting = { ...req, gen: ++this.gen };
    this.flush();
  }

  private flush(): void {
    if (this.busy || !this.waiting) return;
    const req = this.waiting;
    this.waiting = null;
    if (this.worker) {
      this.busy = true;
      this.worker.postMessage(req);
    } else {
      this.busy = true;
      setTimeout(() => { this.busy = false; this.onResult(analyse(req)); this.flush(); });
    }
  }
}
