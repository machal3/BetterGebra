/**
 * What floats over the geometry board: the tool's hint, the inspector of the selected object (its coordinates and
 * its look), the toolbar, and the dialog that asks for a length, radius, angle or scale.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { ErrorText, Field, Slider, cx } from '@/components/controls';
import { IconAxes, IconClose, IconDownload, IconGrid, IconRedo, IconReset, IconTrash, IconUndo, IconZoomIn, IconZoomOut } from '@/components/icons';
import { definition } from '../../geometry/commands';
import { isPoint, type Style } from '../../geometry/construct';
import {
  DEFAULT_WIDTH, FILLED, PALETTE, TOOLS, applyCoords, clearAll, coordText, decimal, defaultSize, endStyling, exportPng, onFocusCoords, readAsk, redo,
  resetStyle, resetView, restyle, select, styled, toggleAxes, toggleGrid, undo, zoomIn, zoomOut,
} from '../../geometry/controller';
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
        <Button variant="ghost" icon={<IconReset />} aria-label="Przywróć widok" title="Przywróć widok" onClick={resetView} />
      </div>
      <div className="b-tool-group">
        <Button variant="ghost" className="b-tool-toggle" icon={<IconGrid />} aria-pressed={geo.grid} aria-label="Kratka" title="Kratka" onClick={toggleGrid} />
        <Button variant="ghost" className="b-tool-toggle" icon={<IconAxes />} aria-pressed={geo.axes} aria-label="Układ współrzędnych" title="Układ współrzędnych" onClick={toggleAxes} />
        <Button variant="ghost" icon={<IconDownload />} aria-label="Zapisz rysunek jako PNG" title="Zapisz PNG" onClick={exportPng} />
        <Button variant="ghost" className="b-gclear" icon={<IconTrash />} aria-label="Wyczyść rysunek" title="Wyczyść rysunek" disabled={!geo.objects.length} onClick={clearAll} />
      </div>
    </div>
  );
}

const DASHES: [string, string, string][] = [['', 'Ciągła', ''], ['dashed', 'Kreskowana', '5 3.5'], ['dotted', 'Kropkowana', '0.1 4.5']];
const SHAPES: [string, string][] = [['', 'Kropka'], ['ring', 'Pierścień'], ['cross', 'Krzyżyk']];
const shapeIcon = (s: string) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    {s === 'cross' ? <path d="M8 8l8 8M16 8l-8 8" /> : <circle cx="12" cy="12" r="5" fill={s ? 'none' : 'currentColor'} />}
  </svg>
);
const dashIcon = (d: string) => <svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true"><path d="M3 8h26" stroke="currentColor" strokeWidth={d === '0.1 4.5' ? 2.4 : 2} strokeLinecap="round" strokeDasharray={d || undefined} fill="none" /></svg>;

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
  const custom = !!st.color && !PALETTE.some(([c]) => c === st.color);
  const width = point ? st.size ?? defaultSize(o) : st.width ?? DEFAULT_WIDTH;
  const fill = st.fill ?? (o.kind === 'circle' ? 0 : 0.16);
  return (
    <div className="b-glook">
      <div className="b-glook-row">
        <span>Kolor</span>
        <div className="b-gswatches" role="group" aria-label="Kolor">
          {[['', 'Automatyczny'] as [string, string], ...PALETTE].map(([c, name]) => (
            <button
              key={c || 'auto'}
              type="button"
              className={cx('b-gswatch', !c && 'is-auto')}
              aria-pressed={(st.color ?? '') === c}
              aria-label={name}
              title={name}
              style={c ? ({ '--sw': c === 'ink' ? 'var(--b-ink)' : c } as React.CSSProperties) : undefined}
              onClick={() => restyle({ color: c || undefined })}
            />
          ))}
          <label className={cx('b-gswatch', 'is-custom', custom && 'is-chosen')} title="Własny kolor" style={custom ? ({ '--sw': st.color } as React.CSSProperties) : undefined}>
            <input
              type="color"
              aria-label="Własny kolor"
              key={o.id}
              defaultValue={custom && st.color!.startsWith('#') ? st.color : '#0060e2'}
              onInput={e => restyle({ color: e.currentTarget.value }, true)}
              onBlur={endStyling}
            />
          </label>
        </div>
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
      <label className="b-glook-row">
        <span>Etykieta</span>
        <select className="b-select" value={st.label ?? ''} onChange={e => restyle({ label: (e.target.value || undefined) as Style['label'] })}>
          <option value="">Automatycznie</option>
          <option value="name">Nazwa</option>
          <option value="value">Nazwa i wartość</option>
          <option value="none">Brak</option>
        </select>
      </label>
      <Button variant="ghost" className="b-glook-reset" disabled={!o.style} onClick={resetStyle}>Przywróć domyślny wygląd</Button>
    </div>
  );
}

export function Inspector() {
  useGeo();
  const target = styled();
  if (!target) return null;
  return (
    <section id="geo-inspect" className="b-ginspect" aria-label="Zaznaczony obiekt">
      <header className="b-ginspect-head">
        <span className="b-ginspect-name">{target.name}</span>
        <Button variant="ghost" icon={<IconClose />} aria-label="Zamknij" title="Zamknij  Esc" onClick={() => select(null)} />
      </header>
      <Coordinates />
      <Look />
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
