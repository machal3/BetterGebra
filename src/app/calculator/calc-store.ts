/**
 * The calculator's state outside React: the remembered history and number of digits (localStorage
 * 'bettergebra.calc', the same format as before), and the question in flight. The engine runs in a worker
 * (src/cas/client.ts) with its 20 s limit; a newer question or Przerwij ends the one before.
 */
import { useSyncExternalStore } from 'react';
import { CasClient } from '../../cas/client';
import type { Result } from '../../cas/engine';

const STORE = 'bettergebra.calc';
const MAX_HISTORY = 60;
export const DIGITS = [15, 25, 50, 100] as const;
interface Saved { history: string[]; digits: number }

function load(): Saved {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (d && Array.isArray(d.history)) return { history: d.history.filter((s: unknown) => typeof s === 'string').slice(0, MAX_HISTORY), digits: (DIGITS as readonly number[]).includes(d.digits) ? d.digits : 25 };
  } catch { /* corrupt or blocked: start fresh */ }
  return { history: [], digits: 25 };
}

export interface Run {
  status: 'idle' | 'busy' | 'done';
  /** The question as sent. */
  query: string;
  result: Result | null;
  /** When the question went to the worker (for the loader's clock). */
  startedAt: number;
}

interface Snapshot { history: string[]; digits: number; run: Run }
let snap: Snapshot = { ...load(), run: { status: 'idle', query: '', result: null, startedAt: 0 } };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => { snap = { ...snap, ...patch }; for (const l of listeners) l(); };
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ history: snap.history, digits: snap.digits })); } catch { /* private mode: just don't remember */ } };

export const useCalc = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snap);

let client: CasClient | null = null;
/** The previous answer, for `ans` in the next question. */
let ans: string | null = null;

export function setDigits(digits: number): void { set({ digits }); persist(); }
export function clearHistory(): void { set({ history: [] }); persist(); }

export async function compute(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // the address holds the question, so a reload or a shared link shows the same result
  try { history.replaceState(null, '', `#kalkulator?q=${encodeURIComponent(q)}`); } catch { /* sandboxed: fine */ }
  set({ history: [q, ...snap.history.filter(s => s !== q)].slice(0, MAX_HISTORY), run: { status: 'busy', query: q, result: snap.run.result, startedAt: Date.now() } });
  persist();
  client ??= new CasClient();
  const r = await client.run(q, { digits: snap.digits, ans });
  if (client.busy) return; // a newer question took over
  if (r.ans) ans = r.ans;
  set({ run: { status: 'done', query: q, result: r, startedAt: snap.run.startedAt } });
}

export const abort = () => client?.abort();
