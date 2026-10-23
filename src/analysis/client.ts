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
  /** Sent to the worker, not answered yet: if the worker fails, it is computed here instead. */
  private inflight: AnalysisRequest | null = null;
  private gen = 0;

  constructor(private onResult: (r: AnalysisResult) => void) {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
        this.busy = false;
        this.inflight = null;
        this.onResult(e.data);
        this.flush();
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.busy = false;
        // the request it failed on would leave the panel at "…": a newer one replaces it, otherwise it goes again here
        this.waiting ??= this.inflight;
        this.inflight = null;
        this.flush();
      };
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
    this.busy = true;
    if (this.worker) {
      this.inflight = req;
      this.worker.postMessage(req);
    } else {
      setTimeout(() => {
        this.busy = false;
        try { this.onResult(analyse(req)); } catch { /* the panel keeps the last answer */ }
        this.flush();
      });
    }
  }
}
