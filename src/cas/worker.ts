import { run, type RunOptions } from './engine';

export interface CasRequest { id: number; input: string; options: RunOptions }

self.onmessage = (e: MessageEvent<CasRequest>) => {
  const { id, input, options } = e.data;
  try {
    self.postMessage({ id, result: run(input, options) });
  } catch (err) {
    // run() turns every expected failure into result.error; this is a bug, reported as such
    console.error(err);
    self.postMessage({ id, result: { input: null, pods: [], error: `Błąd wewnętrzny: ${(err as Error)?.message ?? err}` } });
  }
};
