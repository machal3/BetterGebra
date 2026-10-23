/**
 * The calculator panel: one input line, result cards below, history and examples in the side pane. The engine
 * runs in a worker (src/cas/client.ts); this module only renders what it returns.
 */
import { CasClient } from '../cas/client';
import type { Pod, Result, Row } from '../cas/engine';
import { nodeML } from '../cas/nodeformat';
import { parse } from '../cas/parse';
import { sugar } from '../cas/sugar';
import { plotView } from './calc-plot';
import { $, FI, h, toast } from './dom';

const STORE = 'bettergebra.calc';
const MAX_HISTORY = 60;
interface Saved { history: string[]; digits: number }

function load(): Saved {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (d && Array.isArray(d.history)) return { history: d.history.filter((s: unknown) => typeof s === 'string').slice(0, MAX_HISTORY), digits: [15, 25, 50, 100].includes(d.digits) ? d.digits : 25 };
  } catch { /* corrupt or blocked: start fresh */ }
  return { history: [], digits: 25 };
}
const saved = load();
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: just don't remember */ } };

export const EXAMPLES: [string, [string, string][]][] = [
  ['Liczby', [['2^200', 'potęga'], ['100!', 'silnia'], ['1/7 + 2/3', 'ułamki'], ['sqrt(72)', 'pierwiastek'], ['N(pi, 100)', '100 cyfr π'], ['(1+2i)/(3-i)', 'zespolone'], ['e^(i pi/4)', 'postać wykładnicza']]],
  ['Algebra', [['rozłóż x^4 - 5x^2 + 4', 'rozkład'], ['rozwiń (a + b)^5', 'rozwinięcie'], ['uprość (x^2 - 1)/(x + 1)', 'upraszczanie'], ['apart((3x + 1)/(x^2 - 1))', 'ułamki proste'], ['x^3 - 6x^2 + 11x - 6 = 0', 'wielomian'], ['x^3 - 3x + 1 = 0', 'wzory Viète’a']]],
  ['Analiza', [['pochodna x^x', 'pochodna'], ['całka x^2 e^x dx', 'całka'], ['całka e^(-x^2) od -inf do inf', 'całka Gaussa'], ['granica (1 + 1/n)^n przy n->inf', 'granica'], ['szereg tan x', 'szereg Taylora'], ['badanie funkcji x^3 - 3x', 'przebieg zmienności'], ['sum(1/k^2, k, 1, inf)', 'szereg']]],
  ['Wykresy', [['wykres sin x, cos x', 'dwie funkcje'], ['wykres x^2 + y^2 = 25, y = x - 1', 'okrąg i prosta'], ['x^2/9 + y^2/4 = 1', 'elipsa'], ['wykres [cos t, sin(2t)]', 'krzywa parametryczna'], ['badanie funkcji (x^2 + 1)/(x - 1)', 'asymptoty'], ['całka sin x od 0 do 2pi', 'pole ze znakiem']]],
  ['LaTeX', [[String.raw`\int_0^{\pi} \sin x \, dx`, 'całka'], [String.raw`\lim_{x \to 0} \frac{\sin x}{x}`, 'granica'], [String.raw`\sum_{k=1}^{\infty} \frac{1}{k^2}`, 'szereg'], [String.raw`\frac{d}{dx} x^x`, 'pochodna'], [String.raw`\begin{cases} x + y = 5 \\ x y = 6 \end{cases}`, 'układ'], [String.raw`\det\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, 'wyznacznik']]],
  ['Równania', [['sin(x) = 1/2', 'trygonometryczne'], ['2^x = 3^(x - 1)', 'wykładnicze'], ['sqrt(x + 3) = x - 3', 'z pierwiastkiem'], ['x + y = 5, x y = 6', 'układ'], ['x + y = 5, x - y = 1', 'układ liniowy'], ['(x - 1)/(x + 2) >= 0', 'nierówność'], ['x^5 - x - 1 = 0', 'numerycznie']]],
  ['Macierze', [['[[2, 1], [1, 2]]', 'macierz'], ['det([[a, b], [c, d]])', 'wyznacznik'], ['inverse([[1, 2, 3], [0, 1, 4], [5, 6, 0]])', 'odwrotna'], ['eigenvalues([[4, 1], [2, 3]])', 'wartości własne'], ['adjugate([[1, 2], [3, 4]])', 'macierz dołączona'], ['linsolve([[2, 1], [1, -1]], [5, 1])', 'układ macierzowy'], ['linsolve([[1, 2], [2, 4]], [3, 7])', 'układ sprzeczny'], ['x + y = 5, x - y = 1', 'układ i macierz'], ['diag(1, 2, 3)', 'macierz diagonalna'], ['echelon([[1, 2, 3], [4, 5, 6], [7, 8, 10]])', 'eliminacja Gaussa'], ['charpoly([[1, 2], [3, 4]])', 'wielomian charakterystyczny']]],
  ['Teoria liczb', [['rozłóż 2^64 + 1', 'czynniki'], ['isprime(2^89 - 1)', 'pierwszość'], ['nwd(462, 1071)', 'NWD'], ['crt([2, 3, 2], [3, 5, 7])', 'kongruencje'], ['totient(10^12)', 'φ Eulera'], ['fibonacci(300)', 'Fibonacci']]],
  ['Statystyka', [['{2, 4, 4, 4, 5, 5, 7, 9}', 'statystyki'], ['median(3, 1, 4, 1, 5, 9, 2, 6)', 'mediana']]],
];

/** Symbol keys in groups; a divider goes between groups. */
const KEYS: [string, string, string][][] = [
  [['√', 'sqrt()', 'pierwiastek'], ['^', '^', 'potęga'], ['|x|', '||', 'wartość bezwzględna'], ['n!', '!', 'silnia']],
  [['π', 'π', 'pi'], ['e', 'e', 'liczba e'], ['i', 'i', 'jednostka urojona'], ['∞', '∞', 'nieskończoność']],
  [['≤', '<=', 'mniejsze lub równe'], ['≥', '>=', 'większe lub równe'], ['→', '->', 'dąży do (granica)']],
  [['d/dx', 'pochodna ', 'pochodna'], ['∫', 'całka ', 'całka'], ['lim', 'granica ', 'granica'], ['Σ', 'sum(, k, 1, n)', 'suma'], ['[ ]', '[[, ], [, ]]', 'macierz']],
];

let client: CasClient | null = null;
let ans: string | null = null;
let historyAt = -1;
let draft = '';

export function initCalculator(): void {
  const form = $<HTMLFormElement>('calc-form'), input = $<HTMLInputElement>('calc-input');
  const digits = $<HTMLSelectElement>('calc-digits');
  digits.value = String(saved.digits);
  digits.addEventListener('change', () => { saved.digits = Number(digits.value); persist(); });

  form.addEventListener('submit', e => { e.preventDefault(); compute(input.value); });
  let previewTimer = 0;
  input.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = window.setTimeout(preview, 120); historyAt = -1; });
  input.addEventListener('keydown', e => {
    // ↑ ↓ walk through earlier questions
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!saved.history.length) return;
    e.preventDefault();
    if (historyAt === -1) draft = input.value;
    historyAt = Math.max(-1, Math.min(saved.history.length - 1, historyAt + (e.key === 'ArrowUp' ? 1 : -1)));
    input.value = historyAt === -1 ? draft : saved.history[historyAt];
    preview();
  });

  const keys = $('calc-keys');
  KEYS.forEach((group, g) => {
    if (g) keys.append(h('span', { class: 'calc-key-sep', 'aria-hidden': 'true' }));
    for (const [label, insert, title] of group) {
      const b = h('button', { type: 'button', class: 'calc-key', title, 'aria-label': title }, label);
      b.addEventListener('click', () => insertAtCursor(input, insert));
      keys.append(b);
    }
  });

  const run = (q: string) => { input.value = q; preview(); compute(q); };
  const example = (cls: string, q: string, label: string) => {
    const b = h('button', { type: 'button', class: cls, title: q }, h('span', { class: 'ex-label' }, label), h('span', { class: 'ex-query' }, q));
    b.addEventListener('click', () => run(q));
    return b;
  };
  // Side pane: one collapsible group per topic
  $('calc-examples').append(...EXAMPLES.map(([group, items]) => h('details', { class: 'calc-acc' },
    h('summary', {}, h('span', {}, group), h('span', { class: 'count' }, String(items.length))),
    h('div', { class: 'calc-ex-list' }, ...items.map(([q, label]) => example('calc-ex', q, label))))));

  // Empty state: topics as tabs, the chosen topic's examples as tiles
  const tabs = $('calc-empty-tabs'), tiles = $('calc-empty-examples');
  const pick = (i: number, focus = false) => {
    [...tabs.children].forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); (t as HTMLElement).tabIndex = k === i ? 0 : -1; });
    if (focus) (tabs.children[i] as HTMLElement).focus();
    tiles.setAttribute('aria-labelledby', tabs.children[i].id);
    tiles.replaceChildren(...EXAMPLES[i][1].map(([q, label]) => example('calc-tile', q, label)));
  };
  EXAMPLES.forEach(([group], i) => {
    const t = h('button', { type: 'button', role: 'tab', id: `calc-tab-${i}`, 'aria-controls': 'calc-empty-examples' }, group);
    t.addEventListener('click', () => pick(i));
    tabs.append(t);
  });
  tabs.addEventListener('keydown', e => {
    const at = [...tabs.children].findIndex(t => t.getAttribute('aria-selected') === 'true'), n = EXAMPLES.length;
    const to = e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(to, true);
  });
  pick(0);

  $('calc-clear-history').addEventListener('click', () => { saved.history = []; persist(); renderHistory(); });
  $('calc-stop').addEventListener('click', () => client?.abort());
  renderHistory();
}

/** Runs the question in the address (#kalkulator?q=…), or just focuses the field. */
export function calculatorFromHash(): void {
  const input = $<HTMLInputElement>('calc-input');
  const m = location.hash.match(/^#kalkulator\?q=(.*)$/);
  let q: string | null = null;
  if (m) { try { q = decodeURIComponent(m[1]); } catch { q = null; } }
  if (q && q !== input.value) { input.value = q; preview(); compute(q); return; }
  if (matchMedia('(min-width: 761px)').matches) input.focus();
}

function insertAtCursor(input: HTMLInputElement, text: string): void {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  const selected = input.value.slice(a, b);
  // "sqrt()" and friends wrap the selection, or leave the caret between the parentheses
  const hole = text.indexOf('()') >= 0 ? text.indexOf('()') + 1 : text === '||' ? 1 : text.indexOf(',') >= 0 && text.startsWith('sum(') ? 4 : text.startsWith('[[') ? 2 : -1;
  const value = hole >= 0 ? text.slice(0, hole) + selected + text.slice(hole) : text;
  input.setRangeText(value, a, b, 'end');
  if (hole >= 0) { const at = a + hole + selected.length; input.setSelectionRange(at, at); }
  input.focus();
  preview();
}

function preview(): void {
  const input = $<HTMLInputElement>('calc-input'), out = $('calc-preview');
  const value = input.value.trim();
  out.classList.remove('invalid');
  if (!value) { out.replaceChildren(); return; }
  try {
    out.innerHTML = nodeML(parse(sugar(value)));
  } catch (err) {
    out.classList.add('invalid');
    out.textContent = (err as Error).message;
  }
}

async function compute(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // the address holds the question, so a reload or a shared link shows the same result
  try { history.replaceState(null, '', `#kalkulator?q=${encodeURIComponent(q)}`); } catch { /* sandboxed: fine */ }
  saved.history = [q, ...saved.history.filter(s => s !== q)].slice(0, MAX_HISTORY);
  persist();
  renderHistory();
  historyAt = -1;
  client ??= new CasClient();
  const status = $('calc-status'), results = $('calc-results');
  status.hidden = false;
  results.classList.add('busy');
  $('calc-empty').hidden = $('calc-suggest').hidden = true;
  const r = await client.run(q, { digits: saved.digits, ans });
  if (client.busy) return; // a newer question took over
  status.hidden = true;
  results.classList.remove('busy');
  if (r.ans) ans = r.ans;
  render(r);
}

function render(r: Result): void {
  const results = $('calc-results');
  const cards: HTMLElement[] = [];
  if (r.input) {
    // the question as understood: a heading over the results, not a card of its own
    const head = h('header', { class: 'calc-query' }, h('span', { class: 'calc-query-label' }, 'Wejście'), h('div', { class: 'pod-math', html: r.input.ml }));
    if (r.interpreted) head.append(h('p', { class: 'calc-query-note' }, `Rozumiem jako: ${r.interpreted}`));
    cards.push(head);
  }
  if (r.error) cards.push(h('section', { class: 'pod pod-error', role: 'alert' }, h('p', {}, r.error)));
  r.pods.forEach((p, i) => {
    const c = podCard(p, i === 0 && !r.error);
    // the first card is the answer; plots and cards without rows take the full width
    if (i === 0 && !r.error) c.classList.add('pod-primary');
    if (p.plot || !p.rows.length) c.classList.add('pod-wide');
    cards.push(c);
  });
  results.replaceChildren(...cards);
  results.scrollTop = 0;
  $('calc').scrollTo({ top: 0 });
}

function card(title: string, body: HTMLElement[], note?: string, copy?: string, extra?: HTMLElement): HTMLElement {
  const head = h('header', { class: 'pod-head' }, h('h3', {}, title));
  if (copy !== undefined) {
    const b = h('button', { type: 'button', class: 'icon-button small', title: 'Kopiuj jako tekst', 'aria-label': `Kopiuj: ${title}`, html: FI.copy });
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copy); toast('Skopiowano.'); } catch { toast('Nie udało się skopiować.'); }
    });
    head.append(b);
  }
  const section = h('section', { class: 'pod' }, head, ...body);
  if (note) section.append(h('p', { class: 'pod-note' }, note));
  if (extra) section.append(extra);
  return section;
}

/** Long plain numbers wrap as text; MathML would run off the card. */
const LONG = /^[−-]?[\d.e+−-]{70,}$/;

function podCard(p: Pod, openSteps = false): HTMLElement {
  const rows = p.rows.map(rowEl);
  if (p.plot) rows.push(plotView(p.plot));
  if (p.steps?.length) rows.push(stepsEl(p.steps, openSteps));
  let extra: HTMLElement | undefined;
  if (p.more) {
    const more = p.more;
    const b = h('button', { type: 'button', class: 'pod-more' }, more.label);
    b.addEventListener('click', () => { $<HTMLInputElement>('calc-input').value = more.query; preview(); compute(more.query); });
    extra = b;
  }
  return card(p.title, rows, p.note, p.rows.length ? p.rows.map(r => r.text).join('\n') : undefined, extra);
}

/** The worked solution under a result: numbered operations, each with the matrix it produced. */
function stepsEl(steps: NonNullable<Pod['steps']>, open: boolean): HTMLElement {
  const items = steps.map((s, i) => {
    const item = h('li', { class: 'pod-step' },
      h('div', { class: 'pod-step-head' },
        h('span', { class: 'pod-step-no' }, `${i + 1}.`),
        h('span', { class: 'pod-step-op' }, s.op)),
    );
    if (s.ml) item.append(h('div', { class: 'pod-math pod-step-math', html: s.ml }));
    if (s.note) item.append(h('p', { class: 'pod-step-note' }, s.note));
    return item;
  });
  return h('details', { class: 'pod-steps', open },
    h('summary', {},
      h('span', {}, 'Kroki rozwiązania'),
      h('span', { class: 'count' }, String(steps.length))),
    h('ol', { class: 'pod-steps-list' }, ...items));
}

function rowEl(r: Row): HTMLElement {
  const content = LONG.test(r.text) ? h('div', { class: 'pod-long' }, r.text) : h('div', { class: 'pod-math', html: r.ml });
  const el = h('div', { class: 'pod-row' }, content);
  if (r.note) el.append(h('span', { class: 'pod-row-note' }, r.note));
  return el;
}

function renderHistory(): void {
  const list = $('calc-history');
  $('calc-history-empty').hidden = saved.history.length > 0;
  $('calc-clear-history').hidden = !saved.history.length;
  list.replaceChildren(...saved.history.map(q => {
    const b = h('button', { type: 'button', class: 'calc-history-item', title: q }, q);
    b.addEventListener('click', () => { $<HTMLInputElement>('calc-input').value = q; preview(); compute(q); });
    return h('li', {}, b);
  }));
}
