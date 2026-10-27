/**
 * The single source of truth. UI handlers mutate `state` and call `commit(topics)`; listeners subscribed to those
 * topics run once per microtask, however many commits happened. Nothing else keeps its own copy of this data.
 */
/** Wykresy (graphs y = f(x) and sets on the plane, row by row) or Zespolone (f(z) by colour). */
export type Mode = 'graph' | 'complex';
/** Axis labels: plain numbers, multiples of π, or radians shown in degrees. */
export type AxisUnit = 'num' | 'pi' | 'deg';
export type Dash = '' | '8 6' | '1 5';
export type Theme = 'light' | 'dark';

export interface FnState {
  id: number;
  expression: string;
  color: string;
  visible: boolean;
  /** Domain (or the interval of the unknowns of a set); ±Infinity when unbounded. */
  from: number;
  to: number;
  fromOpen: boolean;
  toOpen: boolean;
  width: number;
  dash: Dash;
}

/** min/max: visible x range; cy: y at the vertical centre; ratio: y units per x unit on screen (1 = equal axes). */
export interface View { min: number; max: number; cy: number; ratio: number }

export interface State {
  functions: FnState[];
  activeId: number;
  /** Shared by all functions. Never reassigned: compiled functions hold a reference to it. */
  readonly params: Record<string, number>;
  view: View;
  mode: Mode;
  grid: boolean;
  axes: boolean;
  snap: boolean;
  xUnit: AxisUnit;
  yUnit: AxisUnit;
  analysisOpen: boolean;
  /** null = follow the system. */
  theme: Theme | null;
}

export type Topic = 'list' | 'expr' | 'style' | 'params' | 'view' | 'mode' | 'toggles' | 'active' | 'theme' | 'panel';

export const MAX_FUNCTIONS = 8;
// Fluent 2 data-visualisation palette.
export const PALETTE = ['#637cef', '#e3008c', '#2aa0a4', '#9373c0', '#13a10e', '#3a96dd', '#ca5010', '#57811b'];
export const PALETTE_NAMES = ['Niebieski', 'Różowy', 'Morski', 'Fioletowy', 'Zielony', 'Błękitny', 'Pomarańczowy', 'Oliwkowy'];
export const DEFAULT_VIEW: View = { min: -10, max: 10, cy: 0, ratio: 1 };
export const TRIG_VIEW: View = { min: -2 * Math.PI, max: 2 * Math.PI, cy: 0, ratio: 1 };

export const state: State = {
  functions: [],
  activeId: 0,
  params: Object.create(null),
  view: { ...DEFAULT_VIEW },
  mode: 'graph',
  grid: true,
  axes: true,
  snap: true,
  xUnit: 'num',
  yUnit: 'num',
  analysisOpen: false,
  theme: null,
};

type Listener = (topics: ReadonlySet<Topic>) => void;
const listeners: { topics: Set<Topic>; fn: Listener }[] = [];
let pending = new Set<Topic>();

/** Subscribes to some topics; returns the way to unsubscribe (React components leave, the old modules never did). */
export function on(topics: Topic[], fn: Listener): () => void {
  const entry = { topics: new Set(topics), fn };
  listeners.push(entry);
  return () => { const i = listeners.indexOf(entry); if (i >= 0) listeners.splice(i, 1); };
}

export function commit(...topics: Topic[]): void {
  if (!pending.size) queueMicrotask(flush);
  for (const t of topics) pending.add(t);
}

function flush(): void {
  const topics = pending;
  pending = new Set();
  // a copy: a listener may unsubscribe (a component unmounting) while the others run
  for (const l of listeners.slice()) if ([...topics].some(t => l.topics.has(t))) l.fn(topics);
  scheduleSave();
}

// --- Functions ---

let nextId = 1;
export const activeFn = () => state.functions.find(f => f.id === state.activeId);
export const fnById = (id: number) => state.functions.find(f => f.id === id);

export function addFunction(expression = '', settings: Partial<Omit<FnState, 'id'>> = {}, after?: FnState): FnState | null {
  if (state.functions.length >= MAX_FUNCTIONS) return null;
  const color = PALETTE.find(c => !state.functions.some(g => g.color === c)) ?? PALETTE[state.functions.length % PALETTE.length];
  const f: FnState = {
    id: nextId++, expression, color, visible: true,
    from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2, dash: '',
    ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)),
  };
  if (!(f.from < f.to)) { f.from = -Infinity; f.to = Infinity; }
  const at = after ? state.functions.indexOf(after) + 1 : state.functions.length;
  state.functions.splice(at, 0, f);
  state.activeId = f.id;
  commit('list', 'expr', 'active');
  return f;
}

export function removeFunction(id: number): void {
  const index = state.functions.findIndex(f => f.id === id);
  if (index < 0) return;
  state.functions.splice(index, 1);
  if (!state.functions.length) { addFunction(); return; }
  if (state.activeId === id) state.activeId = state.functions[Math.max(0, index - 1)].id;
  commit('list', 'expr', 'active');
}

/** Changes some settings of a function and tells the listeners (by default as a change of style). */
export function patchFunction(id: number, patch: Partial<Omit<FnState, 'id'>>, ...topics: Topic[]): void {
  const f = fnById(id);
  if (!f) return;
  Object.assign(f, patch);
  commit(...(topics.length ? topics : ['style' as const]));
}

export function setActive(id: number): void {
  if (state.activeId === id) return;
  state.activeId = id;
  commit('active');
}

// --- Persistence ---

const STORE = 'bettergebra.v2', LEGACY = 'bettergebra';
const toggleNames = ['grid', 'axes', 'snap'] as const;

interface Saved {
  version: 2;
  functions: Omit<FnState, 'id'>[];
  active: number;
  params: Record<string, number>;
  view: View;
  mode: Mode;
  toggles: boolean[];
  units: AxisUnit[];
  analysisOpen: boolean;
  theme: Theme | null;
}

let saveTimer = 0;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 400);
}

export function save(): void {
  const data: Saved = {
    version: 2,
    functions: state.functions.map(({ id: _, ...rest }) => rest),
    active: state.functions.findIndex(f => f.id === state.activeId),
    params: { ...state.params },
    view: state.view,
    mode: state.mode,
    toggles: toggleNames.map(k => state[k]),
    units: [state.xUnit, state.yUnit],
    analysisOpen: state.analysisOpen,
    theme: state.theme,
  };
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* private mode or full storage: just don't remember */ }
}

const num = (v: unknown, fallback: number) => typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
const validView = (v: Partial<View> | undefined): View | null =>
  v && [v.min, v.max, v.cy, v.ratio].every(n => typeof n === 'number' && Number.isFinite(n)) && v.max! > v.min! && v.ratio! > 0 ? v as View : null;

/**
 * A row saved in the former Zbiory mode, where x was another name for z (|x − 1| ≤ 2). In Wykresy x and y without
 * z or i are the coordinates, so such a row is rewritten with z to keep its meaning.
 */
const zbioryRow = (text: string) => /(?<![a-z])[zi](?![a-z])/i.test(text) ? text : text.replace(/(?<![a-z])x(?![a-z])/gi, 'z');

/** Restores the last session (also from v1's storage). Returns false when there was nothing to restore. */
export function restore(): boolean {
  let data: Partial<Saved> & { graphs?: Omit<FnState, 'id'>[]; parameters?: Record<string, number> } | null = null;
  try { data = JSON.parse(localStorage.getItem(STORE) ?? localStorage.getItem(LEGACY) ?? 'null'); } catch { /* corrupt: start fresh */ }
  const fns = data?.functions ?? data?.graphs;
  if (!data || !Array.isArray(fns) || !fns.length) return false;
  const modes: Mode[] = ['graph', 'complex'], units: AxisUnit[] = ['num', 'pi', 'deg'];
  // The former Zbiory mode is part of Wykresy now: its rows (|z − 1| ≤ 2, t + 2i) are recognised as sets there.
  state.mode = modes.includes(data.mode as Mode) ? data.mode as Mode : 'graph';
  const fromSets = String(data.mode) === 'set';
  // The former trigonometry mode is now the graph mode with π on the x axis.
  [state.xUnit, state.yUnit] = [0, 1].map(i => units.includes(data!.units?.[i] as AxisUnit) ? data!.units![i] : i === 0 && String(data!.mode) === 'trig' ? 'pi' : 'num');
  toggleNames.forEach((k, i) => { state[k] = data!.toggles?.[i] ?? true; });
  for (const [k, v] of Object.entries(data.params ?? data.parameters ?? {})) if (/^[a-z]$/.test(k) && Number.isFinite(v)) state.params[k] = v;
  state.view = validView(data.view) ?? { ...DEFAULT_VIEW };
  state.analysisOpen = !!data.analysisOpen;
  state.theme = data.theme === 'light' || data.theme === 'dark' ? data.theme : null;
  for (const g of fns.slice(0, MAX_FUNCTIONS)) {
    addFunction(fromSets ? zbioryRow(String(g.expression ?? '')) : String(g.expression ?? ''), {
      // JSON writes ±Infinity (an unbounded end) as null.
      color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : undefined,
      visible: g.visible !== false,
      from: num(g.from, -Infinity), to: num(g.to, Infinity),
      fromOpen: !!g.fromOpen, toOpen: !!g.toOpen,
      width: Math.min(20, Math.max(0.25, num(g.width, 2))),
      dash: (['', '8 6', '1 5'] as Dash[]).includes(g.dash) ? g.dash : '',
    });
  }
  state.activeId = (state.functions[data.active ?? 0] ?? state.functions[0]).id;
  return true;
}
