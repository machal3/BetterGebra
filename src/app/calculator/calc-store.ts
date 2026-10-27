/**
 * The calculator's state outside React: the remembered history, number of digits and variables (localStorage
 * 'bettergebra.calc'; history and digits in the same format as before, vars added), and the question in flight.
 * The engine runs in a worker (src/cas/client.ts) with its 20 s limit; a newer question or Przerwij ends the one
 * before. The worker keeps nothing between questions, so each question carries the variables with it.
 */
import { useSyncExternalStore } from 'react';
import { CasClient } from '../../cas/client';
import type { Result, Saved } from '../../cas/engine';

const STORE = 'bettergebra.calc';
const MAX_HISTORY = 60;
export const DIGITS = [15, 25, 50, 100] as const;
type Vars = Record<string, Saved>;
interface Stored { history: string[]; digits: number; vars: Vars }

/** A stored variable as the engine wrote it; anything else (a hand-edited or older store) is dropped. */
const isSaved = (v: unknown): v is Saved => {
  const s = v as Saved;
  return !!s && typeof s.code === 'string' && typeof s.label === 'string' && typeof s.preview === 'string'
    && ['scalar', 'list', 'matrix', 'fn'].includes(s.kind) && (s.display === undefined || typeof s.display === 'string') && (s.params === undefined || (Array.isArray(s.params) && s.params.every(p => typeof p === 'string')));
};

function load(): Stored {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (d && Array.isArray(d.history)) {
      const vars: Vars = {};
      if (d.vars && typeof d.vars === 'object') for (const [k, v] of Object.entries(d.vars)) if (/^[a-z][a-z0-9_]*$/.test(k) && isSaved(v)) vars[k] = v;
      return { history: d.history.filter((s: unknown) => typeof s === 'string').slice(0, MAX_HISTORY), digits: (DIGITS as readonly number[]).includes(d.digits) ? d.digits : 25, vars };
    }
  } catch { /* corrupt or blocked: start fresh */ }
  return { history: [], digits: 25, vars: {} };
}

export interface Run {
  status: 'idle' | 'busy' | 'done';
  /** The question as sent. */
  query: string;
  result: Result | null;
  /** When the question went to the worker (for the loader's clock). */
  startedAt: number;
}

interface Snapshot { history: string[]; digits: number; vars: Vars; run: Run }
let snap: Snapshot = { ...load(), run: { status: 'idle', query: '', result: null, startedAt: 0 } };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => { snap = { ...snap, ...patch }; for (const l of listeners) l(); };
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ history: snap.history, digits: snap.digits, vars: snap.vars })); } catch { /* private mode or full: just don't remember */ } };

export const useCalc = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snap);

let client: CasClient | null = null;
/** The previous answer in the engine's notation, for `ans` in the next question. */
let ans: string | null = null;

export function setDigits(digits: number): void { set({ digits }); persist(); }
export function clearHistory(): void { set({ history: [] }); persist(); }
export function removeVar(name: string): void { const vars = { ...snap.vars }; delete vars[name]; set({ vars }); persist(); }
export function clearVars(): void { set({ vars: {} }); persist(); }

export async function compute(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // the address holds the question, so a reload or a shared link shows the same result
  try { history.replaceState(null, '', `#kalkulator?q=${encodeURIComponent(q)}`); } catch { /* sandboxed: fine */ }
  set({ history: [q, ...snap.history.filter(s => s !== q)].slice(0, MAX_HISTORY), run: { status: 'busy', query: q, result: snap.run.result, startedAt: Date.now() } });
  persist();
  client ??= new CasClient();
  const r = await client.run(q, { digits: snap.digits, ans, vars: snap.vars });
  if (client.busy) return; // a newer question took over
  if (r.ansCode) ans = r.ansCode;
  let vars = snap.vars;
  if (r.assigned) {
    vars = { ...vars };
    for (const [k, v] of Object.entries(r.assigned)) { if (v) vars[k] = v; else delete vars[k]; }
  }
  set({ vars, run: { status: 'done', query: q, result: r, startedAt: snap.run.startedAt } });
  if (r.assigned) persist();
}

export const abort = () => client?.abort();
