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
import { TipsPanel } from '@/components/ui/tips-panel-clean';
import { Count, Disclosure, Section, cx } from '@/components/controls';
import { IconArrowRight, IconBook, IconCalculator, IconHistory, IconList, IconStop, IconTrash } from '@/components/icons';
import type { Pod, Result, Row } from '../../cas/engine';
import { nodeML } from '../../cas/nodeformat';
import { parse, type Node } from '../../cas/parse';
import { sugar } from '../../cas/sugar';
import { PaneBar, setPane, useShown } from '../Dock';
import { usePanel } from '../navigation';
import { CalcPlot } from './CalcPlot';
import { DIGITS, abort, clearHistory, compute, setDigits, useCalc } from './calc-store';
import { EXAMPLES, KEYS } from './content';
import { Backdrop } from '../Backdrop';
import { cascade } from '../motion';
import './calculator.css';


/** Long plain numbers wrap as text; MathML would run off the card. */
const LONG = /^[−-]?[\d.e+−-]{70,}$/;

const subscribeHash = (notify: () => void) => { addEventListener('hashchange', notify); return () => removeEventListener('hashchange', notify); };

/** The preview of what was typed, or why it can't be read. */
function preview(value: string): { ml: string; error: string } {
  const v = value.trim();
  if (!v) return { ml: '', error: '' };
  try { return { ml: nodeML(parse(sugar(v))), error: '' }; } catch (e) { return { ml: '', error: (e as Error).message }; }
}

function RowView({ row }: { row: Row }) {
  return (
    <div className="b-pod-row">
      {LONG.test(row.text) ? <div className="b-pod-long">{row.text}</div> : <div className="b-pod-math" dangerouslySetInnerHTML={{ __html: row.ml }} />}
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
  const { history, digits } = useCalc();
  // ↑ ↓ walk through earlier questions; the line being typed comes back at the end
  const at = useRef(-1), draft = useRef('');
  const shown = preview(useDeferredValue(value));
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

function Suggestions({ run }: { run: (q: string) => void }) {
  const [topic, setTopic] = useState(EXAMPLES[0][0]);
  const items = EXAMPLES.find(([t]) => t === topic)?.[1] ?? [];
  return (
    <section className="b-calc-suggest" aria-label="Przykłady">
      <SegmentedControl
        kind="tabs"
        variant="underline"
        aria-label="Rodzaj przykładów"
        value={topic}
        onChange={setTopic}
        options={EXAMPLES.map(([t]) => ({ value: t, label: t, controls: 'calc-examples' }))}
      />
      <div id="calc-examples" role="tabpanel" aria-label={topic}>
        <TipsPanel
          key={topic}
          title={topic}
          showCount={false}
          tips={items.map(([q, label]) => ({ id: q, title: label, description: <code className="b-code">{q}</code>, action: 'Oblicz', doneLabel: 'Liczę…', onAction: () => run(q) }))}
        />
      </div>
    </section>
  );
}

function Side({ run: compute }: { run: (q: string) => void }) {
  const { history } = useCalc();
  const shown = { history: useShown('Historia'), examples: useShown('Przykłady'), syntax: useShown('Zapis') };
  // a question picked in a phone's sheet: the sheet steps aside for its answer
  const run = (q: string) => { setPane(null); compute(q); };
  return (
    <>
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
              <tr><td><code>[[1, 2], [3, 4]]</code>, <code>det</code>, <code>inverse</code>, <code>eigenvalues</code></td><td>macierze</td></tr>
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
  const { run: current, history } = useCalc();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const panel = usePanel();
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const run = (q: string) => { setValue(q); void compute(q); };

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
              <span className="b-calc-hero-icon" aria-hidden="true"><IconCalculator size={28} /></span>
              <h2>Kalkulator symboliczny</h2>
              <p>Wyniki dokładne — ułamki, pierwiastki, π — a cyfry dziesiętne tylko te, które są pewne. Wpisz wyrażenie, równanie albo polecenie po polsku lub angielsku.</p>
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
      {side && createPortal(<Side run={run} />, side)}
      <PaneBar
        panel="calculator"
        items={[
          { label: 'Historia', icon: <IconHistory />, count: history.length },
          { label: 'Przykłady', icon: <IconList /> },
          { label: 'Zapis', icon: <IconBook /> },
        ]}
      />
    </>
  );
}
