/**
 * What floats over the geometry board: the tool's hint, the inspector of the selected object (its coordinates, its
 * look, and for a line, segment, ray or circle its way to Wykresy and the calculator), the toolbar, and the dialog
 * that asks for a length, radius, angle or scale. On phones the toolbar keeps undo, redo and zoom, the rest is in
 * the Widok popover (a sheet), and the inspector shows the look on request.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { SmartRecommendation, type Recommendation } from '@/components/ui/smart-recommendation-clean';
import { ColorPicker, ErrorText, Field, Menu, Slider, Switch } from '@/components/controls';
import { IconAxes, IconClose, IconDownload, IconGrid, IconRedo, IconReset, IconSliders, IconTrash, IconUndo, IconZoomIn, IconZoomOut } from '@/components/icons';
import { PHONE, useMedia } from '@/hooks/use-media';
import { definition } from '../../geometry/commands';
import { isPoint, type GeoObject, type Shape, type Style } from '../../geometry/construct';
import {
  DEFAULT_WIDTH, FILLED, PALETTE, TOOLS, applyCoords, clearAll, coordText, decimal, defaultSize, endStyling, exportPng, onFocusCoords, readAsk, redo,
  resetStyle, resetView, restyle, select, styled, toggleAxes, toggleGrid, undo, zoomIn, zoomOut,
} from '../../geometry/controller';
import { addFunction, commit, state, MAX_FUNCTIONS } from '../../state';
import { openSection } from '../navigation';
import { toast } from '../toast';
import { useGeo } from './use-geo';

export function Hint() {
  const geo = useGeo(), t = TOOLS[geo.tool];
  return <p className="b-ghint" aria-live="polite"><b>{t.label}</b> {t.hint}</p>;
}

export function Toolbar() {
  const geo = useGeo();
  return (
    <div className="b-toolbar" role="toolbar" aria-label="Narzędzia rysunku" aria-orientation="vertical">
      <div className="b-tool-group">
        <Button variant="ghost" icon={<IconUndo />} aria-label="Cofnij" title="Cofnij  Ctrl+Z" disabled={!geo.canUndo} onClick={undo} />
        <Button variant="ghost" icon={<IconRedo />} aria-label="Ponów" title="Ponów  Ctrl+Y" disabled={!geo.canRedo} onClick={redo} />
      </div>
      <div className="b-tool-group">
        <Button variant="ghost" icon={<IconZoomIn />} aria-label="Przybliż" title="Przybliż" onClick={zoomIn} />
        <Button variant="ghost" icon={<IconZoomOut />} aria-label="Oddal" title="Oddal" onClick={zoomOut} />
        <Button variant="ghost" className="b-tool-wide" icon={<IconReset />} aria-label="Przywróć widok" title="Przywróć widok" onClick={resetView} />
      </div>
      <div className="b-tool-group b-tool-wide">
        <Button variant="ghost" className="b-tool-toggle" icon={<IconGrid />} aria-pressed={geo.grid} aria-label="Kratka" title="Kratka" onClick={toggleGrid} />
        <Button variant="ghost" className="b-tool-toggle" icon={<IconAxes />} aria-pressed={geo.axes} aria-label="Układ współrzędnych" title="Układ współrzędnych" onClick={toggleAxes} />
        <Button variant="ghost" icon={<IconDownload />} aria-label="Zapisz rysunek jako PNG" title="Zapisz PNG" onClick={exportPng} />
        <Button variant="ghost" className="b-gclear" icon={<IconTrash />} aria-label="Wyczyść rysunek" title="Wyczyść rysunek" disabled={!geo.objects.length} onClick={clearAll} />
      </div>
    </div>
  );
}

/** Kratka, układ, widok, PNG and clearing: a phone's pane bar opens it, as its toolbar has no room for them. */
export function ViewPanel({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const geo = useGeo(), pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pop.current!, toggled = (e: Event) => onOpenChange((e as ToggleEvent).newState === 'open');
    el.addEventListener('toggle', toggled);
    return () => el.removeEventListener('toggle', toggled);
  }, [onOpenChange]);
  const close = () => pop.current?.hidePopover();
  return (
    <div ref={pop} id="geo-view" className="b-popover b-settings b-gview" popover="auto" role="dialog" aria-labelledby="geo-view-title">
      <h3 id="geo-view-title" className="b-popover-title">Widok</h3>
      <div className="b-gview-body">
        <Switch checked={geo.grid} onChange={toggleGrid}>Kratka</Switch>
        <Switch checked={geo.axes} onChange={toggleAxes}>Układ współrzędnych</Switch>
        <div className="b-gview-actions">
          <Button variant="secondary" size="sm" icon={<IconReset />} onClick={() => { resetView(); close(); }}>Przywróć widok</Button>
          <Button variant="secondary" size="sm" icon={<IconDownload />} onClick={exportPng}>Zapisz PNG</Button>
          <Button variant="secondary" size="sm" className="b-gclear" icon={<IconTrash />} disabled={!geo.objects.length} onClick={() => { clearAll(); close(); }}>Wyczyść rysunek</Button>
        </div>
      </div>
    </div>
  );
}

const DASHES: [string, string, string][] = [['', 'Ciągła', ''], ['dashed', 'Kreskowana', '5 3.5'], ['dotted', 'Kropkowana', '0.1 4.5']];
const SHAPES: [string, string][] = [['', 'Kropka'], ['ring', 'Pierścień'], ['cross', 'Krzyżyk']];
const shapeIcon = (s: string) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    {s === 'cross' ? <path d="M8 8l8 8M16 8l-8 8" /> : <circle cx="12" cy="12" r="5" fill={s ? 'none' : 'currentColor'} />}
  </svg>
);
const dashIcon = (d: string) => <svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true"><path d="M3 8h26" stroke="currentColor" strokeWidth={d === '0.1 4.5' ? 2 : 1.6} strokeLinecap="round" strokeDasharray={d || undefined} fill="none" /></svg>;

/** A slider whose drag is one undo step: input restyles live, letting go starts the next step. */
function StyleSlider(props: React.ComponentProps<typeof Slider>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = ref.current!; el.addEventListener('change', endStyling); return () => el.removeEventListener('change', endStyling); }, []);
  return <Slider ref={ref} {...props} />;
}

function Coordinates() {
  const geo = useGeo();
  const x = useRef<HTMLInputElement>(null), y = useRef<HTMLInputElement>(null);
  const shown = useRef<[string, string]>(['', '']);
  const [error, setError] = useState('');
  const o = geo.objects.find(o => o.id === geo.selected), s = o && geo.shapes.get(o.id);
  const editable = !!o && (o.def === 'free' || o.def === 'on');
  const names = new Map(geo.objects.map(o => [o.id, o.name]));
  // Follow the point (a drag, an undo), but don't overwrite what is being typed.
  useLayoutEffect(() => {
    const vals: [string, string] = [isPoint(s) && Number.isFinite(s.x) ? coordText(s.x) : '—', isPoint(s) && Number.isFinite(s.y) ? coordText(s.y) : '—'];
    shown.current = vals;
    [x.current, y.current].forEach((el, i) => { if (el && document.activeElement !== el) el.value = vals[i]; });
  });
  useEffect(() => { onFocusCoords(() => requestAnimationFrame(() => { const el = x.current; if (el && !el.disabled) { el.focus(); el.select(); } })); }, []);
  const apply = () => {
    const problem = applyCoords(x.current!.value, y.current!.value, shown.current);
    setError(problem);
  };
  const field = (ref: React.RefObject<HTMLInputElement | null>, label: string) => (
    <label className="b-gcoord">
      <i>{label}</i>
      <Field
        ref={ref}
        mono
        inputMode="decimal"
        disabled={!editable}
        aria-describedby="geo-coords-error"
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); apply(); requestAnimationFrame(() => e.currentTarget?.select()); }
          // Back to the shown value first, so leaving the field doesn't apply what was typed.
          if (e.key === 'Escape') { setError(''); e.currentTarget.value = shown.current[label === 'x' ? 0 : 1]; e.currentTarget.blur(); }
        }}
        onBlur={e => { if (e.currentTarget.value.trim() !== shown.current[label === 'x' ? 0 : 1]) apply(); }}
      />
    </label>
  );
  if (!o || o.kind !== 'point') return null;
  return (
    <form className="b-gcoords" aria-label="Współrzędne punktu" onSubmit={e => e.preventDefault()}>
      <div className="b-gcoords-row">{field(x, 'x')}{field(y, 'y')}</div>
      {o.def === 'on' && <p className="b-gnote">Na {names.get(o.of[0])}: punkt trafi na najbliższe miejsce obiektu.</p>}
      {!editable && <p className="b-gnote">Zależny: {definition(o, id => names.get(id) ?? '?')}. Zmień definicję na liście.</p>}
      <ErrorText id="geo-coords-error">{error}</ErrorText>
    </form>
  );
}

function Look() {
  useGeo();
  const o = styled();
  if (!o) return null;
  const st: Style = o.style ?? {}, point = o.kind === 'point', measure = o.kind === 'measure';
  const width = point ? st.size ?? defaultSize(o) : st.width ?? DEFAULT_WIDTH;
  const fill = st.fill ?? (o.kind === 'circle' ? 0 : 0.16);
  return (
    <div className="b-glook">
      <div className="b-glook-row">
        <span>Kolor</span>
        <ColorPicker
          label="Kolor"
          auto="Automatyczny"
          value={st.color}
          swatches={PALETTE.map(([color, label]) => ({ color, label, css: color === 'ink' ? 'var(--b-ink)' : undefined }))}
          onPick={color => restyle({ color })}
          onDrag={color => restyle({ color }, true)}
          onDragEnd={endStyling}
        />
      </div>
      {!measure && (
        <label className="b-glook-row">
          <span>{point ? 'Rozmiar' : 'Grubość'}</span>
          <StyleSlider key={`${o.id}-${point}`} min={point ? 2 : 1} max={point ? 10 : 8} step={0.5} defaultValue={width} onInput={e => restyle(point ? { size: +e.currentTarget.value } : { width: +e.currentTarget.value }, true)} />
          <output>{decimal(width)}</output>
        </label>
      )}
      {!point && !measure && (
        <div className="b-glook-row">
          <span id="geo-dash-label">Linia</span>
          <SegmentedControl size="sm" variant="tray" aria-labelledby="geo-dash-label" value={st.dash ?? ''} onChange={v => restyle({ dash: (v || undefined) as Style['dash'] })} options={DASHES.map(([value, label, d]) => ({ value, icon: dashIcon(d), ariaLabel: label }))} />
        </div>
      )}
      {point && (
        <div className="b-glook-row">
          <span id="geo-shape-label">Kształt</span>
          <SegmentedControl size="sm" variant="tray" aria-labelledby="geo-shape-label" value={st.shape ?? ''} onChange={v => restyle({ shape: (v || undefined) as Style['shape'] })} options={SHAPES.map(([value, label]) => ({ value, icon: shapeIcon(value), ariaLabel: label }))} />
        </div>
      )}
      {FILLED.has(o.kind) && (
        <label className="b-glook-row">
          <span>Wypełnienie</span>
          <StyleSlider key={o.id} min={0} max={1} step={0.05} defaultValue={fill} onInput={e => restyle({ fill: +e.currentTarget.value }, true)} />
          <output>{Math.round(fill * 100)}%</output>
        </label>
      )}
      <div className="b-glook-row">
        <span id="geo-label-label">Etykieta</span>
        <Menu<NonNullable<Style['label']> | ''>
          aria-labelledby="geo-label-label"
          value={st.label ?? ''}
          onChange={v => restyle({ label: v || undefined })}
          options={[{ value: '', label: 'Automatycznie' }, { value: 'name', label: 'Nazwa' }, { value: 'value', label: 'Nazwa i wartość' }, { value: 'none', label: 'Brak' }]}
        />
      </div>
      <Button variant="ghost" className="b-glook-reset" disabled={!o.style} onClick={resetStyle}>Przywróć domyślny wygląd</Button>
    </div>
  );
}

/** A number for the graph panel's and the calculator's parsers: a dot, at most 4 decimals, no −0. */
const plainNum = (v: number) => String(Number(v.toFixed(4)) || 0);
/** (x − 2)^2, (y + 1)^2, x^2 */
const square = (v: string, c: number) => Math.abs(c) < 1e-9 ? `${v}^2` : `(${v} ${c > 0 ? '-' : '+'} ${plainNum(Math.abs(c))})^2`;

/**
 * The shape as a row of Wykresy: a line (or a segment, ray or vector: a line over their x range) as y = mx + b, a
 * vertical line as x = c, a circle as its equation. Null for what a row can't draw (a vertical segment or ray).
 */
function asRow(s: Shape | null | undefined): { expr: string; from: number; to: number; whole: boolean } | null {
  if (s?.kind === 'circle') return { expr: `${square('x', s.cx)} + ${square('y', s.cy)} = ${plainNum(s.r * s.r)}`, from: -Infinity, to: Infinity, whole: true };
  if (s?.kind !== 'line' && s?.kind !== 'segment' && s?.kind !== 'ray' && s?.kind !== 'vector') return null;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  if (Math.abs(dx) <= 1e-9 * Math.abs(dy)) return s.kind === 'line' ? { expr: `x = ${plainNum(s.x1)}`, from: -Infinity, to: Infinity, whole: true } : null;
  const m = dy / dx, b = s.y1 - m * s.x1;
  const mx = Math.abs(m) < 1e-9 ? '' : Math.abs(m - 1) < 1e-9 ? 'x' : Math.abs(m + 1) < 1e-9 ? '-x' : `${plainNum(m)}x`;
  const expr = !mx ? plainNum(b) : Math.abs(b) < 1e-9 ? mx : `${mx} ${b > 0 ? '+' : '-'} ${plainNum(Math.abs(b))}`;
  const [from, to] = s.kind === 'line' ? [-Infinity, Infinity] : s.kind === 'ray' ? (dx > 0 ? [s.x1, Infinity] : [-Infinity, s.x1]) : [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
  return { expr, from, to, whole: s.kind === 'line' };
}

/** Adds the row to Wykresy (in its graph mode) and goes there; the toast can take it back. */
function toGraphs(row: NonNullable<ReturnType<typeof asRow>>, name: string): void {
  const f = addFunction(row.expr, { from: row.from, to: row.to });
  if (!f) { toast(`Wykresy mają już ${MAX_FUNCTIONS} funkcji. Usuń którąś, aby dodać ${name}.`); return; }
  const before = state.activeId;
  state.activeId = f.id;
  commit('list', 'expr', 'active');
  openSection('graph');
  toast(`Dodano ${name} do Wykresów.`, {
    label: 'Cofnij',
    run: () => {
      state.functions.splice(state.functions.indexOf(f), 1);
      state.activeId = state.functions.some(g => g.id === before) ? before : state.functions[0]?.id ?? 0;
      commit('list', 'expr', 'active');
    },
  });
}

/** "Dalej z obiektem": a line, segment, ray or circle drawn in Wykresy, or its graph in the calculator. */
function Elsewhere({ o, s }: { o: GeoObject; s: Shape | null | undefined }) {
  const row = asRow(s);
  if (!row) return null;
  const kind = s!.kind === 'circle' ? 'okrąg' : s!.kind === 'line' ? 'prostą' : s!.kind === 'ray' ? 'półprostą' : s!.kind === 'vector' ? 'wektor' : 'odcinek';
  const shown = row.expr.includes('=') ? row.expr : `y = ${row.expr}`;
  const range = row.whole ? '' : Number.isFinite(row.from) && Number.isFinite(row.to) ? ` dla x od ${plainNum(row.from)} do ${plainNum(row.to)}`
    : Number.isFinite(row.from) ? ` dla x ≥ ${plainNum(row.from)}` : ` dla x ≤ ${plainNum(row.to)}`;
  const options: Recommendation[] = [
    { id: 'graphs', label: 'Narysuj w Wykresach', reason: `${o.name}: ${shown}${range} — nowy wiersz obok Twoich funkcji.`, signal: 3 },
    ...row.whole ? [{ id: 'calc', label: 'Wykres w kalkulatorze', reason: `Wykres ${shown} z punktami szczególnymi, w kalkulatorze.`, signal: 3 as const }] : [],
  ];
  return (
    <SmartRecommendation
      key={`${o.id} ${row.expr} ${row.from} ${row.to}`}
      className="b-ginspect-rec"
      title={`Dalej z: ${o.name}`}
      options={options}
      showSignal={false}
      defaultOpen={false}
      acceptLabel={op => op.id === 'graphs' ? 'Otwórz w Wykresach' : 'Otwórz w kalkulatorze'}
      onAccept={op => {
        if (op.id === 'graphs') toGraphs(row, `${kind} ${o.name}`);
        else location.hash = `#kalkulator?q=${encodeURIComponent(`wykres ${row.expr}`)}`;
      }}
    />
  );
}

export function Inspector() {
  const geo = useGeo();
  const target = styled();
  // a phone shows the coordinates; the look, which would cover half the board, waits for its button
  const phone = useMedia(PHONE), [look, setLook] = useState(false);
  if (!target) return null;
  return (
    <section id="geo-inspect" className="b-ginspect" aria-label="Zaznaczony obiekt">
      <header className="b-ginspect-head">
        <span className="b-ginspect-name">{target.name}</span>
        {phone && <Button variant="ghost" size="sm" className="b-tool-toggle" icon={<IconSliders />} aria-pressed={look} onClick={() => setLook(l => !l)}>Wygląd</Button>}
        <Button variant="ghost" icon={<IconClose />} aria-label="Zamknij" title="Zamknij  Esc" onClick={() => select(null)} />
      </header>
      <Coordinates />
      {(!phone || look) && <Look />}
      <Elsewhere o={target} s={geo.shapes.get(target.id)} />
    </section>
  );
}

/** Asks for a length, radius, angle, number of vertices or scale; π/3 and √2 work too. */
export function AskDialog() {
  const geo = useGeo(), asking = geo.asking;
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const answered = useRef(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const d = dialog.current!;
    if (asking && !d.open) {
      answered.current = false;
      setProblem('');
      input.current!.value = asking.ask.initial;
      d.showModal();
      input.current!.select();
    }
  }, [asking]);
  const close = (value: number | null) => { answered.current = true; dialog.current?.close(); asking?.answer(value); };
  // a click on the backdrop cancels, like Esc
  const closeRef = useRef(close);
  useLayoutEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const d = dialog.current!, onClick = (e: MouseEvent) => { if (e.target === d) closeRef.current(null); };
    d.addEventListener('click', onClick);
    return () => d.removeEventListener('click', onClick);
  }, []);
  return (
    <dialog
      ref={dialog}
      className="b-dialog"
      aria-labelledby="geo-ask-label"
      // Esc: cancelled
      onClose={() => { if (!answered.current) asking?.answer(null); }}
    >
      <form
        method="dialog"
        className="b-dialog-body"
        onSubmit={e => {
          e.preventDefault();
          if (!asking) return;
          const r = readAsk(asking.ask, input.current!.value);
          if ('problem' in r) { setProblem(r.problem); input.current!.focus(); return; }
          close(r.value);
        }}
      >
        <label id="geo-ask-label" htmlFor="geo-ask-input" className="b-dialog-title">{asking?.ask.label}</label>
        <Field ref={input} id="geo-ask-input" mono inputMode="decimal" aria-invalid={!!problem} aria-describedby="geo-ask-error" />
        <ErrorText id="geo-ask-error">{problem}</ErrorText>
        <div className="b-dialog-actions">
          <Button variant="secondary" type="button" onClick={() => close(null)}>Anuluj</Button>
          <Button type="submit">OK</Button>
        </div>
      </form>
    </dialog>
  );
}
