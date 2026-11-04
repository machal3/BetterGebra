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
import { IconArrowRight, IconBook, IconChevronDown, IconClose, IconHistory, IconList, IconPlus, IconSearch, IconStop, IconTrash, IconVariable } from '@/components/icons';
import { DATA_POPOVER, DataImport } from './DataImport';
import type { Pod, Result, Row, Step } from '../../cas/engine';
import { nodeML, spelling } from '../../cas/nodeformat';
import { parse, type Node, type VarKind } from '../../cas/parse';
import { sugar } from '../../cas/sugar';
import { PaneBar, setPane, useShown } from '../Dock';
import { usePanel } from '../navigation';
import { CalcPlot } from './CalcPlot';
import { DIGITS, abort, clearHistory, clearVars, compute, removeVar, setDigits, useCalc } from './calc-store';
import { BOX, EXAMPLES, PALETTE } from './content';
import { SLOT, SLOT_NAME, fillTemplate, nextSlot, oneLine, prettify, prettyText, withSlots, type Replacement } from './composer-text';
import { Backdrop } from '../Backdrop';
import { cascade } from '../motion';
import './calculator.css';


/** Long plain numbers wrap as text; MathML would run off the card. */
const LONG = /^[−-]?[\d.e+−-]{70,}$/;

const subscribeHash = (notify: () => void) => { addEventListener('hashchange', notify); return () => removeEventListener('hashchange', notify); };

/** The preview of what was typed, or why it can't be read; the variables' names read as names. */
function preview(value: string, names: Record<string, VarKind>, display: Record<string, string>): { ml: string; error: string } {
  const slots = value.includes(SLOT), v = oneLine(withSlots(value));
  if (!v) return { ml: '', error: '' };
  try {
    // an empty □ is read as a name and drawn as a box; while one is left, name = □ is an equation being written
    const node = parse(sugar(v), slots ? { names: { ...names, [SLOT_NAME]: 'scalar' }, assign: false } : { names });
    const ml = nodeML(node, spelling(v, n => display[n]));
    return { ml: slots ? ml.replaceAll(`<mi mathvariant="normal">${SLOT_NAME}</mi>`, BOX) : ml, error: '' };
  } catch (e) { return { ml: '', error: (e as Error).message }; }
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

/** A card that is one short value (Rząd 2, Wyznacznik −2, Ślad 5). */
const isFact = (p: Pod) => !p.plot && !p.more && !p.note && p.rows.length === 1 && !p.rows[0].grid && p.rows[0].text.length <= 16
  // a matrix or a formula with its own left side (A⁻¹ = …, det(λI − A) = …) needs the card's width
  && !/<mtable|<mo>=<\/mo>/.test(p.rows[0].ml);
/** The cards in order, short values next to each other gathered into one card of tiles. */
function grouped(pods: Pod[]): (Pod | Pod[])[] {
  const out: (Pod | Pod[])[] = [];
  for (let i = 0; i < pods.length; i++) {
    // the first card is the answer and stays on its own; two short values or more make a card of tiles
    if (i > 0 && i + 1 < pods.length && isFact(pods[i]) && isFact(pods[i + 1])) {
      const facts: Pod[] = [];
      while (i < pods.length && isFact(pods[i])) facts.push(pods[i++]);
      out.push(facts);
      i--;
    } else out.push(pods[i]);
  }
  return out;
}

/** Short values side by side: a title over each, one copy for all of them. */
function FactsCard({ pods }: { pods: Pod[] }) {
  const text = pods.map(p => `${p.title}: ${p.rows[0].text}`).join('\n');
  return (
    <section className="b-pod b-facts is-wide" data-ui-message aria-label={pods.map(p => p.title).join(', ')}>
      <div className="b-facts-grid">
        {pods.map(p => (
          <div className="b-fact" key={p.title}>
            <h3>{p.title}</h3>
            <div className="b-pod-math" dangerouslySetInnerHTML={{ __html: p.rows[0].ml }} />
            {p.rows[0].note && <span className="b-fact-note">{p.rows[0].note}</span>}
          </div>
        ))}
      </div>
      <MessageActions actions={['copy']} text={text} label="Działania: wartości" />
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
            {result.interpreted && <p className="b-calc-query-note">Rozumiem jako: <span className="b-formula-text">{prettyText(result.interpreted)}</span></p>}
            {result.used && <p className="b-calc-query-note">Ze zmiennych: {result.used}</p>}
          </div>
          <MessageActions actions={['regenerate']} text={query} regenerating={busy} onRegenerate={() => run(query)} label="Działania na pytaniu" />
        </header>
      )}
      {result.error && <section className="b-pod is-error" role="alert"><p>{result.error}</p></section>}
      {grouped(result.pods).map((p, i) => (Array.isArray(p) ? <FactsCard key={i} pods={p} /> : <PodCard key={i} pod={p} primary={i === 0 && !result.error} run={run} />))}
      {!busy && <NextSteps ans={result.ans} next={result.next} query={query} run={run} />}
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
function NextSteps({ ans, next, query, run }: { ans: string | undefined; next: Step[] | undefined; query: string; run: (q: string) => void }) {
  // a function of one variable's steps, then the engine's MATLAB ones for matrices and lists
  const options = [...nextSteps(ans, query), ...(next ?? []).filter(s => s.query !== query.trim()).map((s): Recommendation => ({ id: s.query, label: s.label, reason: s.reason, signal: 3 }))];
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

const PALETTE_KEY = 'bettergebra.calc.palette';
const readOpen = () => { try { return localStorage.getItem(PALETTE_KEY) === '1'; } catch { return false; } };

/** A template (or plain text) at the field's caret, the selection in its first □; the next □ is selected, to be typed over. */
function place(el: HTMLTextAreaElement, template: string, setValue: (v: string) => void) {
  const a = el.selectionStart, b = el.selectionEnd;
  const { text, select } = fillTemplate(template, el.value.slice(a, b), el.value.slice(0, a));
  el.focus();
  el.setRangeText(text, a, b, 'end');
  el.setSelectionRange(a + select[0], a + select[1]);
  setValue(el.value);
}

/** The field as tall as its lines. */
function fit(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const Hint = () => (
  <p className="b-composer-hint">
    <span><kbd>Enter</kbd> oblicza</span>
    <span><kbd>Shift</kbd> + <kbd>Enter</kbd> nowa linia: układ, wiersz macierzy</span>
    <span><kbd>Tab</kbd> następne pole <span className="b-slot-chip" role="img" aria-label="□" /></span>
  </p>
);

function Composer({ value, setValue, run, input }: { value: string; setValue: (v: string) => void; run: (q: string) => void; input: React.RefObject<HTMLTextAreaElement | null> }) {
  const { history, digits, vars } = useCalc();
  // ↑ ↓ walk through earlier questions; the line being typed comes back at the end
  const at = useRef(-1), draft = useRef('');
  // the last automatic replacement (<= → ≤): Backspace right after it gives the typed text back
  const undo = useRef<Replacement | null>(null);
  const [open, setOpen] = useState(readOpen);
  const [tab, setTab] = useState(PALETTE[0].id);
  // Enter with a □ still empty: it is selected, and said why nothing was computed
  const [missing, setMissing] = useState(false);
  const names = Object.fromEntries(Object.entries(vars).filter(([n]) => !n.startsWith('#')).map(([n, s]) => [n, s.kind]));
  const display = Object.fromEntries(Object.entries(vars).flatMap(([n, s]) => (s.display ? [[n, s.display]] : [])));
  const shown = preview(useDeferredValue(value), names, display);

  // the field grows with its lines
  useLayoutEffect(() => fit(input.current), [value, input]);
  // and with its width: lines wrap differently once the page has its size
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(el); } });
    watch.observe(el);
    return () => watch.disconnect();
  }, [input]);

  const toggle = () => {
    try { localStorage.setItem(PALETTE_KEY, open ? '0' : '1'); } catch { /* not remembered */ }
    setOpen(!open);
  };
  const submit = () => {
    at.current = -1;
    undo.current = null;
    const k = value.indexOf(SLOT), el = input.current;
    if (k >= 0 && el) { el.focus(); el.setSelectionRange(k, k + 1); setMissing(true); return; }
    run(oneLine(value));
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    const typed = el.value.length - value.length === 1 && el.selectionStart === el.selectionEnd && !(e.nativeEvent as InputEvent).isComposing;
    at.current = -1;
    undo.current = null;
    setMissing(false);
    const r = typed ? prettify(el.value, el.selectionStart) : null;
    if (r) {
      el.setRangeText(r.undo.to, r.undo.at, r.undo.at + r.undo.from.length);
      el.setSelectionRange(r.caret, r.caret);
      undo.current = r.undo;
    }
    setValue(el.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = nextSlot(el.value, el.selectionStart, el.selectionEnd, e.shiftKey);
      if (k !== null) { e.preventDefault(); el.setSelectionRange(k, k + 1); }
      return;
    }
    const u = undo.current;
    if (e.key === 'Backspace' && u && el.selectionStart === el.selectionEnd && el.selectionStart === u.at + u.to.length) {
      e.preventDefault();
      undo.current = null;
      el.setRangeText(u.from, u.at, u.at + u.to.length, 'end');
      setValue(el.value);
      return;
    }
    if (e.key !== 'Shift') undo.current = null;
    // a field of several lines moves between them; one line walks through the history
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !history.length || value.includes('\n')) return;
    e.preventDefault();
    if (at.current === -1) draft.current = value;
    at.current = Math.max(-1, Math.min(history.length - 1, at.current + (e.key === 'ArrowUp' ? 1 : -1)));
    setValue(at.current === -1 ? draft.current : history[at.current]);
  };

  const page = PALETTE.find(p => p.id === tab) ?? PALETTE[0];
  return (
    <form className="b-composer" role="search" aria-label="Obliczenie" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="b-composer-field">
        <span className="b-composer-icon" aria-hidden="true"><IconSearch size={18} /></span>
        <textarea
          ref={input}
          id="calc-input"
          rows={1}
          value={value}
          onChange={onChange}
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
      {missing && <p className="b-composer-missing" role="alert">Uzupełnij puste pola <span className="b-slot-chip" role="img" aria-label="□" /> — <kbd>Tab</kbd> przechodzi do następnego.</p>}
      <div className="b-composer-bar">
        {open
          ? (
            <SegmentedControl
              kind="tabs"
              variant="underline"
              size="sm"
              className="b-palette-tabs"
              aria-label="Rodzaj symboli"
              value={tab}
              onChange={setTab}
              options={PALETTE.map(p => ({ value: p.id, label: p.name, controls: 'calc-palette' }))}
            />
          )
          : null}
        <div className="b-composer-tools">
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
          <Button
            variant="ghost"
            size="sm"
            className={cx('b-palette-toggle', open && 'is-open')}
            iconRight={<IconChevronDown />}
            aria-expanded={open}
            aria-controls="calc-palette"
            onClick={toggle}
          >
            Symbole
          </Button>
        </div>
      </div>
      {open && (
        <div id="calc-palette" className="b-palette" role="tabpanel" aria-label={page.name}>
          <div className="b-palette-keys" key={page.id}>
            {page.keys.map(k => (
              <button
                key={k.name}
                type="button"
                className={cx('b-key', k.word && 'is-word', k.wide && 'is-wide')}
                title={k.name}
                aria-label={k.name}
                // the field keeps the focus and its selection
                onMouseDown={e => e.preventDefault()}
                onClick={() => input.current && place(input.current, k.text, setValue)}
                {...(k.word ? { children: k.label } : { dangerouslySetInnerHTML: { __html: k.label } })}
              />
            ))}
          </div>
          <Hint />
        </div>
      )}
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
    <section className="b-calc-suggest" aria-label="Przykłady">
      {/* all the topics in view, wrapped: sixteen tabs in one row would run off the card */}
      <div className="b-calc-topics" role="tablist" aria-label="Rodzaj przykładów">
        {EXAMPLES.map(([t]) => (
          <button key={t} type="button" role="tab" className="b-chip b-calc-topic" data-topic={t} aria-selected={t === topic} aria-controls="calc-examples"
            tabIndex={t === topic ? 0 : -1} onClick={() => setTopic(t)} onKeyDown={e => {
              // ← → walk the topics, as tabs do
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const k = EXAMPLES.findIndex(([s]) => s === t), next = EXAMPLES[(k + step + EXAMPLES.length) % EXAMPLES.length][0];
              setTopic(next);
              (e.currentTarget.parentElement?.querySelector(`[data-topic="${next}"]`) as HTMLElement | null)?.focus();
            }}>
            {t}
          </button>
        ))}
      </div>
      <div ref={grid} id="calc-examples" className="b-calc-tiles" role="tabpanel" aria-label={topic}>
        {items.map(([q, label]) => (
          <button key={q} type="button" className="b-row b-calc-tile" onClick={() => run(q)}>
            <span className="b-calc-tile-icon" aria-hidden="true"><IconSearch size={14} /></span>
            <span className="b-calc-tile-query">{q}</span>
            <span className="b-calc-tile-label">{label}</span>
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
  const entries = Object.entries(vars).filter(([n]) => !n.startsWith('#'));
  return (
    <>
      {shown.vars && <Section
        title="Zmienne"
        aside={<>
          <Button variant="ghost" icon={<IconPlus />} aria-label="Wklej dane z tabeli" title="Wklej dane z tabeli albo pliku CSV" popoverTarget={DATA_POPOVER} />
          {entries.length > 0 && <Button variant="ghost" icon={<IconTrash />} aria-label="Usuń wszystkie zmienne" title="Usuń wszystkie zmienne" onClick={clearVars} />}
        </>}
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
            <p>Zapisz wartość, by użyć jej w kolejnych obliczeniach: <code>A = [1 2; 3 4]</code>, <code>n = 10</code>, <code>f(x) = x^2</code>. Dane z arkusza wkleisz przyciskiem +.</p>
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
              <tr><td><code>mode</code>, <code>prctile(v, 90)</code>, <code>iqr</code>, <code>skewness</code>, <code>cov</code>, <code>corrcoef</code>, <code>var(v, 1)</code></td><td>statystyka opisowa (dokładnie)</td></tr>
              <tr><td><code>normcdf(x, μ, σ)</code>, <code>norminv</code>, <code>tcdf</code>, <code>chi2inv</code>, <code>binopdf</code>, <code>poisscdf</code>, …</td><td>rozkłady: …pdf, …cdf, …inv</td></tr>
              <tr><td><code>fitlm(x, y)</code>, <code>rand(3)</code>, <code>randn</code>, <code>randi([1 6], 1, 10)</code>, <code>rng(42)</code></td><td>regresja z testami; liczby losowe (powtarzalne po rng)</td></tr>
              <tr><td><code>fft(x)</code>, <code>ifft</code>, <code>fftshift</code>, <code>filter(b, a, x)</code>, <code>periodogram(x, fs)</code>, <code>angle</code></td><td>sygnały: widmo, filtry, gęstość widmowa mocy</td></tr>
              <tr><td><code>surf(f)</code>, <code>mesh(f, [a b c d])</code>, <code>plot3([x(t), y(t), z(t)])</code>, <code>contour(f, n)</code>, <code>quiver([P, Q])</code>, <code>meshgrid</code></td><td>wykresy w przestrzeni (obrót przeciągnięciem) i pola</td></tr>
              <tr><td>przycisk + w części Zmienne</td><td>wklejenie tabeli albo pliku CSV: kolumny jako wektory, całość jako <code>dane</code></td></tr>
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
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = usePanel();
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  // the field keeps its lines when they are what was asked
  const run = (q: string) => { if (q !== oneLine(input.current?.value ?? '')) setValue(q); void compute(q); };
  /** A variable's name at the caret of the field. */
  const insert = (text: string) => { if (input.current) place(input.current, text, setValue); };

  // #kalkulator?q=… runs that question (a link to a result); otherwise the field takes the focus on wide screens
  useEffect(() => {
    if (panel !== 'calculator') return;
    const m = hash.match(/^#kalkulator\?q=(.*)$/);
    let q: string | null = null;
    if (m) { try { q = decodeURIComponent(m[1]); } catch { q = null; } }
    if (q && q !== oneLine(input.current?.value ?? '')) { setValue(q); void compute(q); return; }
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
        <div className={idle ? 'b-calc is-idle' : 'b-calc'}>
          <Composer value={value} setValue={setValue} run={run} input={input} />
          {busy && <Status />}
          {idle && <Suggestions run={run} />}
          {current.result ? <Results result={current.result} query={current.query} busy={busy} run={run} /> : busy && <Placeholder />}
        </div>
        </>,
        main,
      )}
      {side && createPortal(<Side run={run} insert={insert} />, side)}
      {createPortal(<DataImport />, document.body)}
      <PaneBar
        panel="calculator"
        items={[
          { label: 'Historia', icon: <IconHistory />, count: history.length },
          { label: 'Zmienne', icon: <IconVariable />, count: Object.keys(vars).filter(n => !n.startsWith('#')).length },
          { label: 'Przykłady', icon: <IconList /> },
          { label: 'Zapis', icon: <IconBook /> },
        ]}
      />
    </>
  );
}
