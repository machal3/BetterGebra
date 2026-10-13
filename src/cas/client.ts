/**
 * The calculator's engine runs in a worker, one question at a time. A newer question or the stop button
 * terminates a busy worker (a factorisation or 5000 digits of Γ can't be interrupted otherwise), and so does
 * the time limit.
 */
import type { Result, RunOptions } from './engine';
import type { CasRequest } from './worker';

export const TIME_LIMIT = 20000;

export class CasClient {
  private worker: Worker | null = null;
  private id = 0;
  private pending: { id: number; resolve: (r: Result) => void; timer: number } | null = null;

  private spawn(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result: Result }>) => {
        if (!this.pending || e.data.id !== this.pending.id) return;
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(e.data.result);
      };
      this.worker.onerror = () => this.finish({ input: null, pods: [], error: 'Obliczenia przerwał nieoczekiwany błąd.' }, true);
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  /** Ends the question in flight (if any) with `result`; `kill` stops the worker too. */
  private finish(result: Result, kill: boolean): void {
    if (kill && this.worker) { this.worker.terminate(); this.worker = null; }
    const p = this.pending;
    this.pending = null;
    if (p) { clearTimeout(p.timer); p.resolve(result); }
  }

  get busy(): boolean { return !!this.pending; }

  run(input: string, options: RunOptions): Promise<Result> {
    if (this.pending) this.finish({ input: null, pods: [], error: 'Przerwane.' }, true);
    const id = ++this.id;
    return new Promise(resolve => {
      const worker = this.spawn();
      if (!worker) {
        // no module workers: run on the main thread
        import('./engine').then(m => resolve(m.run(input, options)));
        return;
      }
      const timer = window.setTimeout(() => this.finish({ input: null, pods: [], error: `Przekroczono limit czasu (${TIME_LIMIT / 1000} s). Spróbuj prostszego zapytania albo mniejszej liczby cyfr.` }, true), TIME_LIMIT);
      this.pending = { id, resolve, timer };
      worker.postMessage({ id, input, options } satisfies CasRequest);
    });
  }

  abort(): void {
    if (this.pending) this.finish({ input: null, pods: [], error: 'Przerwano obliczenia.' }, true);
  }
}
