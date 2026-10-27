/**
 * The calculator panel: one input line as the centre of the page, result cards below, history and examples in the
 * side panel (on phones, each its own sheet from a button of the pane bar). Results are exact as the engine gives them — fractions, roots, π, and only the decimal digits that
 * are certain — and are shown as they are, never animated or rounded here.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button-clean';
import { MessageActions } from '@/components/ui/message-actions-clean';
import { SmartRecommendation, type Recommendation } from '@/components/ui/smart-recommendation-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { Skeleton } from '@/components/ui/shimmer-loader';
import { ThinkingLoader } from '@/components/ui/thinking-loader-clean';
import { Count, Disclosure, Section, cx } from '@/components/controls';
import { IconArrowRight, IconBook, IconCalculator, IconClose, IconHistory, IconList, IconStop, IconTrash, IconVariable } from '@/components/icons';
import type { Pod, Result, Row } from '../../cas/engine';
import { nodeML, spelling } from '../../cas/nodeformat';
import { parse, type Node, type VarKind } from '../../cas/parse';
import { sugar } from '../../cas/sugar';
import { PaneBar, setPane, useShown } from '../Dock';
import { usePanel } from '../navigation';
import { CalcPlot } from './CalcPlot';
import { DIGITS, abort, clearHistory, clearVars, compute, removeVar, setDigits, useCalc } from './calc-store';
import { EXAMPLES, KEYS } from './content';
import { Backdrop } from '../Backdrop';
import { cascade } from '../motion';
import './calculator.css';


/** Long plain numbers wrap as text; MathML would run off the card. */
const LONG = /^[−-]?[\d.e+−-]{70,}$/;

const subscribeHash = (notify: () => void) => { addEventListener('hashchange', notify); return () => removeEventListener('hashchange', notify); };

/** The preview of what was typed, or why it can't be read; the variables' names read as names. */
function preview(value: string, names: Record<string, VarKind>, display: Record<string, string>): { ml: string; error: string } {
  const v = value.trim();
  if (!v) return { ml: '', error: '' };
  try { return { ml: nodeML(parse(sugar(v), { names }), spelling(v, n => display[n])), error: '' }; } catch (e) { return { ml: '', error: (e as Error).message }; }
}

/** A matrix too large to typeset: its entries in a table, numbered like a spreadsheet. */
function Grid({ cells }: { cells: string[][] }) {
  return (
    <div className="b-pod-grid" role="region" aria-label={`Macierz, ${cells.length} wierszy`}>
      <table>
        <thead><tr><th scope="col" aria-label="Wiersz" />{cells[0].map((_, j) => <th key={j} scope="col">{j + 1}</th>)}</tr></thead>
        <tbody>{cells.map((r, i) => <tr key={i}><th scope="row">{i + 1}</th>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function RowView({ row }: { row: Row }) {
  return (
    <div className="b-pod-row">
      {row.grid ? <Grid cells={row.grid} /> : LONG.test(row.text) ? <div className="b-pod-long">{row.text}</div> : <div className="b-pod-math" dangerouslySetInnerHTML={{ __html: row.ml }} />}
      {row.note && <span className="b-pod-row-note">{row.note}</span>}
    </div>
  );
}

function PodCard({ pod, primary, run }: { pod: Pod; primary: boolean; run: (q: string) => void }) {
  const text = pod.rows.map(r => r.text).join('\n');
  return (
    <section className={cx('b-pod', primary && 'is-primary', (!!pod.plot || !pod.rows.length) && 'is-wide')} data-ui-message aria-label={pod.title}>
      <header className="b-pod-head">
        <h3>{pod.title}</h3>
        {pod.rows.length > 0 && <MessageActions actions={['copy']} text={text} label={`Działania: ${pod.title}`} />}
      </header>
      {pod.rows.map((r, i) => <RowView key={i} row={r} />)}
      {pod.plot && <CalcPlot plot={pod.plot} />}
      {pod.note && <p className="b-pod-note">{pod.note}</p>}
      {pod.more && <Button variant="secondary" className="b-pod-more" iconRight={<IconArrowRight />} onClick={() => run(pod.more!.query)}>{pod.more.label}</Button>}
    </section>
  );
}

function Results({ result, query, busy, run }: { result: Result; query: string; busy: boolean; run: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // each answer arrives card by card
  useLayoutEffect(() => cascade(ref.current), [result]);
  return (
    <div ref={ref} className="b-calc-results" aria-live="polite" aria-busy={busy}>
      {result.input && (
        // the question as understood: a heading over the results, not a card of its own
        <header className="b-calc-query" data-ui-message>
          <div className="b-calc-query-main">
            <span className="b-calc-query-label">Wejście</span>
            <div className="b-pod-math" dangerouslySetInnerHTML={{ __html: result.input.ml }} />
            {result.interpreted && <p className="b-calc-query-note">Rozumiem jako: {result.interpreted}</p>}
            {result.used && <p className="b-calc-query-note">Ze zmiennych: {result.used}</p>}
          </div>
          <MessageActions actions={['regenerate']} text={query} regenerating={busy} onRegenerate={() => run(query)} label="Działania na pytaniu" />
        </header>
      )}
      {result.error && <section className="b-pod is-error" role="alert"><p>{result.error}</p></section>}
      {result.pods.map((p, i) => <PodCard key={i} pod={p} primary={i === 0 && !result.error} run={run} />)}
      {!busy && <NextSteps ans={result.ans} query={query} run={run} />}
    </div>
  );
}

/** The one-letter variables of a parsed answer (e and i are constants). */
function letters(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'id' && n.n.length === 1 && n.n !== 'e' && n.n !== 'i') out.add(n.n);
  else if (n.t === 'op') { letters(n.a, out); letters(n.b, out); }
  else if (n.t === 'neg' || n.t === 'post') letters(n.a, out);
  else if (n.t === 'call') n.args.forEach(a => letters(a, out));
  return out;
}

/** What can be done next with an answer that is a function of one variable; nothing for numbers, sets and the rest. */
function nextSteps(ans: string | undefined, query: string): Recommendation[] {
  if (!ans || ans.length > 160) return [];
  let node: Node;
  try { node = parse(sugar(ans)); } catch { return []; }
  const vars = [...letters(node)];
  if (node.t === 'list' || node.t === 'rel' || vars.length !== 1) return [];
  const [v] = vars, x = v === 'x';
  const steps: Recommendation[] = [
    ...x ? [{ id: `badanie funkcji ${ans}`, label: 'Badanie funkcji', reason: 'Dziedzina, granice, asymptoty, monotoniczność, ekstrema i wypukłość wyniku, z wykresem.', signal: 3 as const }] : [],
    { id: `${ans} = 0`, label: 'Miejsca zerowe', reason: `Rozwiązania równania ${ans} = 0 w postaci dokładnej.`, signal: 3 },
    { id: `diff(${ans}, ${v})`, label: 'Pochodna', reason: `Pochodna wyniku względem ${v}, uproszczona.`, signal: 3 },
    { id: `integrate(${ans}, ${v})`, label: 'Całka nieoznaczona', reason: 'Funkcja pierwotna wyniku, sprawdzona różniczkowaniem.', signal: 3 },
    ...x ? [{ id: `wykres ${ans}`, label: 'Wykres', reason: 'Wykres wyniku z miejscami zerowymi i ekstremami, do przeniesienia do Wykresów.', signal: 3 as const }] : [],
  ];
  return steps.filter(s => s.id !== query.trim());
}

/** "Co dalej z wynikiem": the answer's next questions, in the card of the Badanie panel's calculator offer. */
function NextSteps({ ans, query, run }: { ans: string | undefined; query: string; run: (q: string) => void }) {
  const options = nextSteps(ans, query);
  if (!options.length) return null;
  return (
    <SmartRecommendation
      key={`${query} ${ans}`}
      className="b-calc-next"
      title="Co dalej z wynikiem"
      options={options}
      showSignal={false}
      defaultOpen={false}
      acceptLabel={o => `Oblicz: ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}`}
      onAccept={o => run(o.id)}
    />
  );
}

/** Placeholders shaped like a result while the first answer is on its way. */
const Placeholder = () => (
  <div className="b-calc-results" aria-hidden="true">
    <div className="b-pod is-primary b-pod-skeleton"><Skeleton width={140} height={12} /><Skeleton height={28} /><Skeleton width="60%" height={10} /></div>
    <div className="b-pod b-pod-skeleton"><Skeleton width={110} height={12} /><Skeleton height={20} /></div>
  </div>
);

function Composer({ value, setValue, run, input }: { value: string; setValue: (v: string) => void; run: (q: string) => void; input: React.RefObject<HTMLInputElement | null> }) {
  const { history, digits, vars } = useCalc();
  // ↑ ↓ walk through earlier questions; the line being typed comes back at the end
  const at = useRef(-1), draft = useRef('');
  const names = Object.fromEntries(Object.entries(vars).map(([n, s]) => [n, s.kind]));
  const display = Object.fromEntries(Object.entries(vars).flatMap(([n, s]) => (s.display ? [[n, s.display]] : [])));
  const shown = preview(useDeferredValue(value), names, display);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !history.length) return;
    e.preventDefault();
    if (at.current === -1) draft.current = value;
    at.current = Math.max(-1, Math.min(history.length - 1, at.current + (e.key === 'ArrowUp' ? 1 : -1)));
    setValue(at.current === -1 ? draft.current : history[at.current]);
  };
  const insert = (text: string) => {
    const el = input.current!, a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a, selected = el.value.slice(a, b);
    // "sqrt()" and friends wrap the selection, or leave the caret between the parentheses
    const hole = text.indexOf('()') >= 0 ? text.indexOf('()') + 1 : text === '||' ? 1 : text.indexOf(',') >= 0 && text.startsWith('sum(') ? 4 : text.startsWith('[[') ? 2 : -1;
    const piece = hole >= 0 ? text.slice(0, hole) + selected + text.slice(hole) : text;
    el.setRangeText(piece, a, b, 'end');
    if (hole >= 0) { const c = a + hole + selected.length; el.setSelectionRange(c, c); }
    setValue(el.value);
    el.focus();
  };
  return (
    <form className="b-composer" role="search" aria-label="Obliczenie" onSubmit={e => { e.preventDefault(); at.current = -1; run(value); }}>
      <div className="b-composer-field">
        <input
          ref={input}
          id="calc-input"
          type="text"
          value={value}
          onChange={e => { at.current = -1; setValue(e.target.value); }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="go"
          aria-label="Wyrażenie, równanie lub polecenie"
          aria-describedby="calc-preview"
          placeholder="np. całka x^2 sin x dx, x^3 − 2 = 0, rozłóż 2^64 + 1"
        />
        <Button type="submit" className="b-composer-go" icon={<IconArrowRight />} aria-label="Oblicz" title="Oblicz  Enter" />
      </div>
      <div id="calc-preview" className={cx('b-composer-preview', !!shown.error && 'is-invalid')} aria-live="off">
        {shown.ml ? <span dangerouslySetInnerHTML={{ __html: shown.ml }} /> : shown.error}
      </div>
      <div className="b-composer-bar">
        <div className="b-keys" role="toolbar" aria-label="Wstaw symbol">
          {KEYS.map((group, g) => (
            <div className="b-keys-group" key={g}>
              {group.map(([label, text, name]) => (
                <button key={label} type="button" className="b-key" title={name} aria-label={name} onClick={() => insert(text)}>{label}</button>
              ))}
            </div>
          ))}
        </div>
        <div className="b-digits">
          <span id="calc-digits-label">Cyfry</span>
          <SegmentedControl
            size="sm"
            variant="tray"
            aria-labelledby="calc-digits-label"
            value={String(digits)}
            onChange={v => setDigits(Number(v))}
            options={DIGITS.map(d => ({ value: String(d), label: String(d), ariaLabel: `${d} cyfr` }))}
          />
        </div>
      </div>
    </form>
  );
}

/** While the engine works: what it is doing, and a way to stop it (it stops by itself after 20 s). */
function Status() {
  return (
    <div className="b-calc-status" role="status">
      <ThinkingLoader phases={['Liczę', 'Sprawdzam numerycznie', 'Jeszcze chwilę']} interval={3000} />
      <Button variant="secondary" icon={<IconStop />} onClick={abort}>Przerwij</Button>
    </div>
  );
}

/** The examples of the empty page: a card with the topics as tabs, each example a tile that runs it. */
function Suggestions({ run }: { run: (q: string) => void }) {
  const [topic, setTopic] = useState(EXAMPLES[0][0]);
  const items = EXAMPLES.find(([t]) => t === topic)?.[1] ?? [];
  const grid = useRef<HTMLDivElement>(null);
  // another topic: its tiles arrive one by one
  useLayoutEffect(() => cascade(grid.current), [topic]);
  return (
    <section className="b-calc-suggest" aria-labelledby="calc-suggest-title">
      <header className="b-calc-suggest-head">
        <h2 id="calc-suggest-title">Przykłady</h2>
        <span className="b-calc-suggest-hint">Kliknij, aby obliczyć</span>
      </header>
      <SegmentedControl
        kind="tabs"
        variant="underline"
        aria-label="Rodzaj przykładów"
        value={topic}
        onChange={setTopic}
        options={EXAMPLES.map(([t]) => ({ value: t, label: t, controls: 'calc-examples' }))}
      />
      <div ref={grid} id="calc-examples" className="b-calc-tiles" role="tabpanel" aria-label={topic}>
        {items.map(([q, label]) => (
          <button key={q} type="button" className="b-row b-calc-tile" onClick={() => run(q)}>
            <span className="b-calc-tile-label">{label}</span>
            <span className="b-calc-tile-query">{q}</span>
            <span className="b-calc-tile-go" aria-hidden="true"><IconArrowRight size={14} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Side({ run: compute, insert }: { run: (q: string) => void; insert: (text: string) => void }) {
  const { history, vars } = useCalc();
  const shown = { history: useShown('Historia'), vars: useShown('Zmienne'), examples: useShown('Przykłady'), syntax: useShown('Zapis') };
  // a question picked in a phone's sheet: the sheet steps aside for its answer
  const run = (q: string) => { setPane(null); compute(q); };
  const entries = Object.entries(vars);
  return (
    <>
      {shown.vars && <Section
        title="Zmienne"
        aside={entries.length > 0 && <Button variant="ghost" icon={<IconTrash />} aria-label="Usuń wszystkie zmienne" title="Usuń wszystkie zmienne" onClick={clearVars} />}
      >
        {entries.length ? (
          <ul className="b-vars">
            {entries.map(([n, s]) => (
              <li key={n} className="b-var">
                <button type="button" className="b-row b-var-row" title={`Wstaw ${s.display ?? n} do pola`} onClick={() => { setPane(null); insert(s.display ?? n); }}>
                  <span className="b-var-name">{s.display ?? n}{s.params ? `(${s.params.join(', ')})` : ''}</span>
                  <span className="b-var-label">{s.label}</span>
                  <span className="b-var-preview">{s.preview}</span>
                </button>
                <Button variant="ghost" className="b-var-remove" icon={<IconClose />} aria-label={`Usuń zmienną ${s.display ?? n}`} title={`Usuń ${s.display ?? n}`} onClick={() => removeVar(n)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="b-empty">
            <p>Zapisz wartość, by użyć jej w kolejnych obliczeniach: <code>A = [1 2; 3 4]</code>, <code>n = 10</code>, <code>f(x) = x^2</code>.</p>
          </div>
        )}
      </Section>}
      {shown.history && <Section
        title="Historia"
        aside={history.length > 0 && <Button variant="ghost" icon={<IconTrash />} aria-label="Wyczyść historię" title="Wyczyść historię" onClick={clearHistory} />}
      >
        {history.length ? (
          <ol className="b-history">
            {history.map(q => (
              <li key={q}>
                <button type="button" className="b-row b-history-row" title={q} onClick={() => run(q)}>
                  <span className="b-history-icon" aria-hidden="true"><IconHistory /></span>
                  <span className="b-history-text">{q}</span>
                  <span className="b-history-go" aria-hidden="true"><IconArrowRight /></span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="b-empty">
            <svg className="b-empty-art" viewBox="0 0 96 64" aria-hidden="true">
              <rect className="b-empty-soft" x="26" y="12" width="52" height="46" rx="8" />
              <rect x="18" y="6" width="52" height="46" rx="8" />
              <path d="M28 18h24M28 26h32M28 34h18" />
              <circle cx="58" cy="40" r="4" />
            </svg>
            <p>Tu pojawią się Twoje obliczenia. Strzałki ↑ ↓ w polu wpisywania przywołują poprzednie.</p>
          </div>
        )}
      </Section>}
      {shown.examples && <Section title="Przykłady">
        {EXAMPLES.map(([group, items]) => (
          <Disclosure key={group} title={group} aside={<Count>{items.length}</Count>} defaultOpen={false}>
            <div className="b-examples">
              {items.map(([q, label]) => (
                <button key={q} type="button" className="b-row b-example" title={q} onClick={() => run(q)}>
                  <span className="b-example-label">{label}</span>
                  <span className="b-example-query">{q}</span>
                </button>
              ))}
            </div>
          </Disclosure>
        ))}
      </Section>}
      {shown.syntax && <Section title="Zapis i polecenia">
        <Disclosure title="Pokaż zapis" defaultOpen={false}>
          <table className="b-syntax">
            <tbody>
              <tr><td><code>2x</code>, <code>x^2</code>, <code>x²</code>, <code>√x</code>, <code>|x|</code>, <code>n!</code></td><td>jak w wykresach; ułamki dziesiętne z kropką</td></tr>
              <tr><td><code>pi</code>, <code>e</code>, <code>i</code>, <code>inf</code>, <code>phi</code></td><td>stałe; <code>i</code> to jednostka urojona</td></tr>
              <tr><td><code>x^2 = 2</code>, <code>x + y = 3, x − y = 1</code></td><td>równania i układy</td></tr>
              <tr><td><code>x^2 &lt; 4</code>, <code>1 &lt; 2x &lt;= 5</code></td><td>nierówności</td></tr>
              <tr><td><code>diff(f, x, n)</code>, <code>pochodna f</code>, <code>d/dx f</code></td><td>pochodne</td></tr>
              <tr><td><code>integrate(f, x, a, b)</code>, <code>całka f dx</code>, <code>całka f od a do b</code></td><td>całki</td></tr>
              <tr><td><code>limit(f, x-&gt;a)</code>, <code>granica f przy x-&gt;0+</code></td><td>granice (też jednostronne)</td></tr>
              <tr><td><code>taylor(f, x, a, n)</code>, <code>sum(f, k, 1, inf)</code></td><td>szeregi i sumy</td></tr>
              <tr><td><code>solve</code>, <code>factor</code>, <code>expand</code>, <code>simplify</code>, <code>apart</code></td><td>algebra (też po polsku: <code>rozwiąż</code>, <code>rozłóż</code>, <code>rozwiń</code>, <code>uprość</code>)</td></tr>
              <tr><td><code>[[1, 2], [3, 4]]</code>, <code>[1 2; 3 4]</code>, <code>det</code>, <code>inverse</code>, <code>eigenvalues</code></td><td>macierze, także zapisem MATLAB-a</td></tr>
              <tr><td><code>A = [1 2; 3 4]</code>, <code>n = 10</code>, <code>p := x^2 − 1</code></td><td>zmienne; <code>=</code> z wolnymi literami po prawej to równanie, <code>:=</code> zawsze przypisuje; wielkość liter bez znaczenia</td></tr>
              <tr><td><code>f(x) = x^2</code>, <code>g = @(x, y) x*y</code>, <code>f(3)</code></td><td>funkcje</td></tr>
              <tr><td><code>1:5</code>, <code>0:0.5:2</code>, <code>A(2, :)</code>, <code>v(end)</code></td><td>zakresy i indeksy (od 1)</td></tr>
              <tr><td><code>A'</code>, <code>A .* B</code>, <code>A .^ 2</code>, <code>A\b</code>, <code>[A B; C D]</code></td><td>transpozycja, działania na elementach, układ A·x = b, sklejanie</td></tr>
              <tr><td><code>zeros(2, 3)</code>, <code>ones</code>, <code>eye</code>, <code>diag</code>, <code>linspace(0, 1, 5)</code>, <code>magic(4)</code>, <code>hilb</code></td><td>budowanie macierzy</td></tr>
              <tr><td><code>reshape(A, 2, 3)</code>, <code>repmat</code>, <code>kron</code>, <code>triu</code>, <code>fliplr</code>, <code>circshift</code></td><td>zmiana kształtu (elementy w dół kolumn)</td></tr>
              <tr><td><code>size</code>, <code>numel</code>, <code>length</code>, <code>find</code>, <code>any</code>, <code>all</code></td><td>pytania o macierz</td></tr>
              <tr><td><code>sum(A)</code>, <code>sum(A, 2)</code>, <code>prod</code>, <code>cumsum</code>, <code>diff(v)</code>, <code>mean</code>, <code>sort(v, 'descend')</code></td><td>na wektorze cały, na macierzy kolumnami; <code>sum(f, k, 1, n)</code> i <code>diff(f, x)</code> jak dotąd</td></tr>
              <tr><td><code>v &gt; 2</code>, <code>v(v &gt; 2)</code>, <code>sum(v &gt; 2)</code></td><td>porównanie elementów (1 lub 0) i wybór warunkiem</td></tr>
              <tr><td><code>lu</code>, <code>qr</code>, <code>chol</code>, <code>svd</code>, <code>eig</code>, <code>[L, U, P] = lu(A)</code></td><td>rozkłady macierzy; dokładne, gdy się da, inaczej numeryczne i sprawdzone</td></tr>
              <tr><td><code>cond</code>, <code>norm(A, 1)</code>, <code>pinv</code>, <code>expm</code>, <code>null</code>, <code>orth</code></td><td>uwarunkowanie, normy, pseudoodwrotność, eksponenta, jądro, baza kolumn</td></tr>
              <tr><td><code>roots([1 -6 11 -6])</code>, <code>poly</code>, <code>polyval</code>, <code>polyder</code>, <code>conv</code>, <code>deconv</code>, <code>residue</code></td><td>wielomiany jako wektory współczynników (od najwyższej potęgi)</td></tr>
              <tr><td><code>polyfit(x, y, 2)</code>, <code>fit(x, y, a*exp(b*x))</code></td><td>dopasowanie: wielomian (dokładnie dla danych wymiernych) i dowolny model</td></tr>
              <tr><td><code>interp1(x, y, xq, 'spline')</code>, <code>spline</code>, <code>pchip</code>, <code>trapz</code></td><td>interpolacja (także <code>spline(x, y, 'natural')</code>) i całkowanie danych</td></tr>
              <tr><td><code>plot(x, y)</code>, <code>scatter</code>, <code>stem</code>, <code>bar</code>, <code>histogram</code>, <code>errorbar</code>, <code>polarplot</code></td><td>wykresy danych</td></tr>
              <tr><td><code>fzero(f, x0)</code>, <code>fminbnd(f, a, b)</code>, <code>fminsearch(@(v) …, v0)</code>, <code>fsolve</code></td><td>zera, minima, układy równań; <code>v(1)</code>, <code>v(2)</code> to składowe wektora</td></tr>
              <tr><td><code>integral(@(x) …, a, b)</code>, <code>integral2(@(x, y) …, a, b, c, d)</code></td><td>całki (dokładnie, gdy się da)</td></tr>
              <tr><td><code>ode45(@(t, y) …, [0 5], y0)</code>, <code>ode45(y'' = -y, [0 10], [1 0])</code>, <code>ode23</code>, <code>ode15s</code></td><td>równania różniczkowe numerycznie, sprawdzane drugim obliczeniem</td></tr>
              <tr><td><code>dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)</code></td><td>równania różniczkowe dokładnie, sprawdzane podstawieniem</td></tr>
              <tr><td><code>double(A)</code>, <code>≈</code></td><td>liczby przybliżone (podwójna precyzja, jak w MATLAB-ie)</td></tr>
              <tr><td><code>who</code>, <code>clear x</code>, <code>clear</code></td><td>lista zmiennych, usuwanie</td></tr>
              <tr><td><code>\frac{'{1}{2}'}</code>, <code>\int_0^1 x^2\,dx</code>, <code>\lim_{'{x \\to 0}'}</code>, <code>\begin{'{pmatrix}'}…\end{'{pmatrix}'}</code></td><td>LaTeX: wklej wzór, także w <code>$…$</code></td></tr>
              <tr><td><code>wykres sin x, cos x</code>, <code>wykres x^2 + y^2 = 25</code></td><td>wykresy funkcji i krzywych</td></tr>
              <tr><td><code>isprime</code>, <code>gcd</code>, <code>lcm</code>, <code>powmod</code>, <code>crt</code>, <code>totient</code></td><td>teoria liczb</td></tr>
              <tr><td><code>N(x, 100)</code>, <code>ans</code></td><td>cyfry dziesiętne, poprzedni wynik</td></tr>
              <tr><td><code>badanie funkcji f</code>, <code>styczna do f w 1</code></td><td>przebieg zmienności, styczna</td></tr>
            </tbody>
          </table>
        </Disclosure>
      </Section>}
    </>
  );
}

export function CalculatorPanel() {
  const main = document.getElementById('calc'), side = document.getElementById('calc-side');
  const { run: current, history, vars } = useCalc();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const panel = usePanel();
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const run = (q: string) => { setValue(q); void compute(q); };
  /** A variable's name at the caret of the field. */
  const insert = (text: string) => {
    const el = input.current;
    if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.setRangeText(text, a, b, 'end');
    setValue(el.value);
    el.focus();
  };

  // #kalkulator?q=… runs that question (a link to a result); otherwise the field takes the focus on wide screens
  useEffect(() => {
    if (panel !== 'calculator') return;
    const m = hash.match(/^#kalkulator\?q=(.*)$/);
    let q: string | null = null;
    if (m) { try { q = decodeURIComponent(m[1]); } catch { q = null; } }
    if (q && q !== input.current?.value) { setValue(q); void compute(q); return; }
    // not while the mode switch is walked with the arrow keys: focus stays on its tabs
    const walking = document.activeElement?.matches('[role="tab"]:focus-visible');
    if (matchMedia('(min-width: 768px)').matches && !walking) input.current?.focus();
  }, [panel, hash]);
  // a new answer starts at the top of the page
  useLayoutEffect(() => { if (current.status === 'done') main?.scrollTo({ top: 0 }); }, [current.result, current.status, main]);

  const idle = current.status === 'idle', busy = current.status === 'busy';
  return (
    <>
      {main && createPortal(
        <>
        <Backdrop className="b-calc-backdrop" speed={7} />
        <div className="b-calc">
          {idle && (
            <div className="b-calc-hero">
              <span className="b-calc-hero-icon" aria-hidden="true"><IconCalculator size={22} /></span>
              <h2>Kalkulator symboliczny</h2>
              <p>Wpisz wyrażenie, równanie albo polecenie — po polsku lub angielsku.</p>
              <ul className="b-calc-hero-facts" aria-label="Co daje kalkulator">
                <li>wyniki dokładne: ułamki, pierwiastki, π</li>
                <li>tylko pewne cyfry dziesiętne</li>
                <li>sprawdzone numerycznie</li>
              </ul>
            </div>
          )}
          <Composer value={value} setValue={setValue} run={run} input={input} />
          {busy && <Status />}
          {idle && <Suggestions run={run} />}
          {current.result ? <Results result={current.result} query={current.query} busy={busy} run={run} /> : busy && <Placeholder />}
        </div>
        </>,
        main,
      )}
      {side && createPortal(<Side run={run} insert={insert} />, side)}
      <PaneBar
        panel="calculator"
        items={[
          { label: 'Historia', icon: <IconHistory />, count: history.length },
          { label: 'Zmienne', icon: <IconVariable />, count: Object.keys(vars).length },
          { label: 'Przykłady', icon: <IconList /> },
          { label: 'Zapis', icon: <IconBook /> },
        ]}
      />
    </>
  );
}
