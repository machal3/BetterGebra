/**
 * A row's settings in a popover (a bottom sheet on phones): its domain — or the range of a set's unknowns — with
 * closed or open ends, its colour, its line, and Duplicate, Delete and the calculator's view of it. The content
 * is only rendered while the popover is open.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { ColorPicker, ErrorText, Field, Slider, placePopover } from '@/components/controls';
import { IconCopy, IconSearch, IconTrash } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import { calculatorQuery } from '../../calculator-query';
import { domainText, symbolic } from '../../format';
import { constant } from '../../math';
import { compiled } from '../../model';
import { MAX_FUNCTIONS, PALETTE, PALETTE_NAMES, addFunction, patchFunction, setActive, state, type Dash, type FnState, type Mode } from '../../state';
import { toast } from '../toast';
import { removeRow } from './FunctionList';

/** An interval end as typed back into its field: π/2, −√2, 0.75; empty when unbounded. */
const endText = (v: number) => !Number.isFinite(v) ? '' : symbolic(v) ?? String(v);
/** Empty = unbounded. While a value is unfinished ("pi/", "2*") the graph keeps the last valid interval. */
const read = (input: HTMLInputElement, empty: number): number | string => {
  if (!input.value.trim()) return empty;
  try { return constant(input.value); } catch (e) { return (e as Error).message; }
};

const DASHES: [Dash, string][] = [['', 'Ciągła'], ['8 6', 'Przerywana'], ['1 5', 'Kropkowana']];
const dashIcon = (d: Dash) => <svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true"><path d="M3 8h26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray={d || undefined} fill="none" /></svg>;

function Settings({ f, close }: { f: FnState; close: () => void }) {
  useStore(['list', 'expr', 'active', 'mode', 'style'], s => s.functions.length);
  const mode = state.mode, c = compiled(f, mode, state.params);
  const from = useRef<HTMLInputElement>(null), to = useRef<HTMLInputElement>(null);
  const width = useRef<HTMLInputElement>(null), widthValue = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const [invalid, setInvalid] = useState<[boolean, boolean]>([false, false]);
  const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
  // a graph has a domain in x; a number with unknowns (t + 2i) a range of them; a condition neither
  const showDomain = mode !== 'complex' && !(!!c.set && !unknowns?.length);
  const q = c.ok ? calculatorQuery(f, mode, state.params) : null;

  // Fields follow state unless they are being typed in or hold a wrong interval that is being fixed.
  useLayoutEffect(() => {
    for (const [el, v] of [[from.current, f.from], [to.current, f.to]] as const) if (el && document.activeElement !== el && !problem) el.value = endText(v);
    if (width.current) { width.current.value = String(Math.min(6, f.width)); }
    if (widthValue.current && document.activeElement !== widthValue.current) widthValue.current.value = String(Number(f.width.toFixed(2)));
  });

  const readEnds = () => {
    const a = read(from.current!, -Infinity), b = read(to.current!, Infinity);
    setInvalid([typeof a === 'string', typeof b === 'string']);
    const p = typeof a === 'string' ? a : typeof b === 'string' ? b : a < b ? '' : 'Początek przedziału musi być mniejszy niż koniec.';
    setProblem(p);
    if (!p) patchFunction(f.id, { from: a as number, to: b as number });
  };
  // On leaving a valid field, show the value in its tidy form (pi/2 → π/2); a wrong one stays as typed, to be fixed.
  const tidy = (el: HTMLInputElement, v: number) => { if (!problem) el.value = endText(v); };

  const end = (which: 'from' | 'to') => {
    const finite = Number.isFinite(f[which]), open = !finite || f[`${which}Open`];
    const [closed, opened] = which === 'from' ? ['⟨', '('] : ['⟩', ')'];
    return (
      <span title={finite ? undefined : 'Nieskończoność: zawsze otwarty'}>
        <SegmentedControl
          size="sm"
          variant="tray"
          className="b-brackets"
          aria-label={which === 'from' ? 'Początek przedziału' : 'Koniec przedziału'}
          disabled={!finite}
          value={open ? 'open' : 'closed'}
          onChange={v => patchFunction(f.id, { [`${which}Open`]: v === 'open' })}
          options={[{ value: 'closed', label: closed, ariaLabel: 'Domknięty: należy do przedziału' }, { value: 'open', label: opened, ariaLabel: 'Otwarty: nie należy do przedziału' }]}
        />
      </span>
    );
  };

  return (
    <div className="b-rowset">
      {showDomain && (
        <section className="b-rowset-group" aria-labelledby={`fn-${f.id}-domain`}>
          <div className="b-rowset-head">
            <h3 id={`fn-${f.id}-domain`}>{c.set ? `Zakres ${unknowns?.join(', ') ?? ''}` : 'Dziedzina'}</h3>
            <output className="b-rowset-preview">{domainText(f, c.set ? unknowns?.join(', ') ?? 't' : 'x')}</output>
          </div>
          <div className="b-interval">
            <label htmlFor={`fn-${f.id}-from`}>od</label>
            <Field ref={from} id={`fn-${f.id}-from`} mono placeholder="−∞" title="Liczba lub stała, np. 2, pi/2, −e, √2" aria-invalid={invalid[0]} onInput={readEnds} onBlur={e => tidy(e.currentTarget, f.from)} />
            {end('from')}
            <label htmlFor={`fn-${f.id}-to`}>do</label>
            <Field ref={to} id={`fn-${f.id}-to`} mono placeholder="+∞" title="Liczba lub stała, np. 2, pi/2, −e, √2" aria-invalid={invalid[1]} onInput={readEnds} onBlur={e => tidy(e.currentTarget, f.to)} />
            {end('to')}
          </div>
          <ErrorText>{problem}</ErrorText>
        </section>
      )}

      <section className="b-rowset-group" aria-labelledby={`fn-${f.id}-color`}>
        <div className="b-rowset-head"><h3 id={`fn-${f.id}-color`}>Kolor</h3></div>
        <ColorPicker
          label="Kolor"
          value={f.color}
          swatches={PALETTE.map((color, i) => ({ color, label: PALETTE_NAMES[i] }))}
          onPick={color => { if (color) patchFunction(f.id, { color }); }}
          onDrag={color => patchFunction(f.id, { color })}
        />
      </section>

      {/* the complex plane is coloured, no line is drawn */}
      {mode !== 'complex' && (
        <section className="b-rowset-group" aria-labelledby={`fn-${f.id}-line`}>
          <div className="b-rowset-head"><h3 id={`fn-${f.id}-line`}>Linia</h3></div>
          <SegmentedControl<Dash>
            fullWidth
            variant="tray"
            aria-label="Styl linii"
            value={f.dash}
            onChange={dash => patchFunction(f.id, { dash })}
            options={DASHES.map(([value, label]) => ({ value, icon: dashIcon(value), ariaLabel: label }))}
          />
          <div className="b-width">
            <Slider ref={width} min={1} max={6} step={0.25} defaultValue={Math.min(6, f.width)} aria-label="Grubość linii" onInput={e => patchFunction(f.id, { width: e.currentTarget.valueAsNumber })} />
            {/* Typing allows thicker lines than the slider reaches; out-of-range values wait for blur, then snap back. */}
            <Field
              ref={widthValue}
              type="number"
              mono
              min={0.25}
              max={20}
              step="any"
              aria-label="Grubość linii (liczba)"
              onInput={e => { const w = e.currentTarget.valueAsNumber; if (w >= 0.25 && w <= 20) patchFunction(f.id, { width: w }); }}
              onBlur={e => { e.currentTarget.value = String(Number(f.width.toFixed(2))); }}
            />
          </div>
        </section>
      )}

      <div className="b-rowset-actions">
        {q && (
          // The calculator studies the row exactly: zeros, extrema, asymptotes, monotonicity, with its own plots.
          <Button variant="secondary" icon={<IconSearch />} title={q.title} onClick={() => { close(); location.hash = `#kalkulator?q=${encodeURIComponent(q.query)}`; }}>{q.label}</Button>
        )}
        <Button
          variant="secondary"
          icon={<IconCopy />}
          disabled={state.functions.length >= MAX_FUNCTIONS}
          onClick={() => {
            const { expression, from: a, to: b, fromOpen, toOpen, width: w, dash } = f;
            close();
            if (!addFunction(expression, { from: a, to: b, fromOpen, toOpen, width: w, dash }, f)) toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`);
          }}
        >
          Duplikuj
        </Button>
        <Button variant="destructive" icon={<IconTrash />} onClick={() => { close(); removeRow(f); }}>Usuń</Button>
      </div>
    </div>
  );
}

export function RowSettings({ f, n, mode, onOpenChange }: { f: FnState; n: number; mode: Mode; onOpenChange: (open: boolean) => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = pop.current!;
    const before = (e: Event) => { if ((e as ToggleEvent).newState === 'open') { setActive(f.id); setOpen(true); } };
    const toggled = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      onOpenChange(isOpen);
      const anchor = document.querySelector<HTMLElement>(`[popovertarget="fn-settings-${f.id}"]`);
      // beside the side panel on wide screens, under the button otherwise
      if (isOpen && anchor) placePopover(el, anchor, 'right', anchor.closest('.sidebar')?.getBoundingClientRect().right);
    };
    el.addEventListener('beforetoggle', before);
    el.addEventListener('toggle', toggled);
    return () => { el.removeEventListener('beforetoggle', before); el.removeEventListener('toggle', toggled); };
  }, [f.id, onOpenChange]);
  // Its own colour, so the heading of the sheet says which row it belongs to
  return (
    <div ref={pop} id={`fn-settings-${f.id}`} className="b-popover b-rowset-pop" popover="auto" role="dialog" aria-label={`Ustawienia funkcji ${n}`} style={{ '--c': f.color } as React.CSSProperties} data-mode={mode}>
      {open && <Settings f={f} close={() => pop.current?.hidePopover()} />}
    </div>
  );
}
