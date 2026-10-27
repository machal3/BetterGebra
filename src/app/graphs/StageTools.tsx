/**
 * What floats over the Wykresy canvas: the toolbar (zoom, fit, equal axes, reset · Badanie, Widok, PNG), the Widok
 * popover (grid, axes, snapping, axis labels, typed range) and the range caption. The caption and the range fields
 * follow every pan and zoom by writing their text directly, so a drag never renders React. On phones the toolbar
 * keeps zoom and reset; Funkcje, Parametry, Badanie and Widok are buttons of the pane bar, and fitting, equal axes
 * and PNG move into Widok.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { Disclosure, ErrorText, Field, Switch, placePopover } from '@/components/controls';
import { IconDownload, IconFitY, IconRatio, IconReset, IconSliders, IconZoomIn, IconZoomOut } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import { format } from '../../format';
import { labelDigits } from '../../render/plot2d';
import { commit, state, type AxisUnit } from '../../state';
import { equalAxes, fitY, resetView, zoomIn, zoomOut } from '../../ui/canvas-input';
import { toast } from '../toast';
import { applyRange, exportPng, rangeSubscribe, scene } from '../graph-runtime';
import { PaneBar } from '../Dock';
import { parameterNames } from './Parameters';

const IconStudy = () => <span className="b-tool-text" aria-hidden="true">f′</span>;
const toggleAnalysis = () => { state.analysisOpen = !state.analysisOpen; commit('panel'); };
const savePng = async () => toast(await exportPng() ? 'Wykres zapisany jako PNG.' : 'Nie udało się zapisać obrazu.');

/** Everything over the canvas. */
export function StageTools() {
  const [viewOpen, setViewOpen] = useState(false);
  return (
    <>
      <Toolbar viewOpen={viewOpen} />
      <ViewPanel onOpenChange={setViewOpen} />
      <RangeCaption />
      <Panes viewOpen={viewOpen} />
    </>
  );
}

/** The phone's pane bar: the list, the parameters when there are any, Badanie and Widok. */
function Panes({ viewOpen }: { viewOpen: boolean }) {
  const { count, params, analysisOpen } = useStore(['list', 'expr', 'mode', 'panel'], s => ({ count: s.functions.length, params: parameterNames().length, analysisOpen: s.analysisOpen }));
  return (
    <PaneBar
      panel="graphs"
      items={[
        { label: 'Funkcje', count },
        ...params ? [{ label: 'Parametry', count: params }] : [],
        { label: 'Badanie', icon: <IconStudy />, pressed: analysisOpen, onClick: toggleAnalysis },
        { label: 'Widok', icon: <IconSliders />, popover: 'view-panel', expanded: viewOpen },
      ]}
    />
  );
}

export function Toolbar({ viewOpen }: { viewOpen: boolean }) {
  const analysisOpen = useStore(['panel'], s => s.analysisOpen);
  return (
    <div className="b-toolbar" role="toolbar" aria-label="Narzędzia wykresu" aria-orientation="vertical">
      <div className="b-tool-group">
        <Button variant="ghost" icon={<IconZoomIn />} aria-label="Przybliż" title="Przybliż  +" onClick={zoomIn} />
        <Button variant="ghost" icon={<IconZoomOut />} aria-label="Oddal" title="Oddal  −" onClick={zoomOut} />
      </div>
      <div className="b-tool-group">
        <Button variant="ghost" className="b-tool-wide" icon={<IconFitY />} aria-label="Dopasuj oś y do wykresów" title="Dopasuj oś y  F" onClick={fitY} />
        <Button variant="ghost" className="b-tool-wide" icon={<IconRatio />} aria-label="Równe osie 1:1" title="Równe osie 1:1" onClick={equalAxes} />
        <Button variant="ghost" icon={<IconReset />} aria-label="Przywróć widok" title="Przywróć widok  0" onClick={resetView} />
      </div>
      <div className="b-tool-group b-tool-wide">
        <Button
          variant="ghost"
          className="b-tool-toggle"
          icon={<IconStudy />}
          aria-pressed={analysisOpen}
          aria-controls="analysis"
          aria-label="Badanie funkcji"
          title="Badanie funkcji  B"
          onClick={toggleAnalysis}
        />
        <Button variant="ghost" className="b-tool-toggle" icon={<IconSliders />} aria-label="Ustawienia widoku" aria-expanded={viewOpen} title="Siatka, osie, zakres" popoverTarget="view-panel" />
        <Button
          variant="ghost"
          icon={<IconDownload />}
          aria-label="Zapisz wykres jako PNG"
          title="Zapisz PNG"
          onClick={savePng}
        />
      </div>
    </div>
  );
}

const UNITS = [
  { value: 'num' as AxisUnit, label: 'Liczby' },
  { value: 'pi' as AxisUnit, label: 'π', ariaLabel: 'Wielokrotności π' },
  { value: 'deg' as AxisUnit, label: 'Stopnie' },
];
const short = (v: number) => String(Number(v.toPrecision(7)));

export function ViewPanel({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const [error, setError] = useState('');
  const toggles = useStore(['toggles'], s => ({ grid: s.grid, axes: s.axes, snap: s.snap, xUnit: s.xUnit, yUnit: s.yUnit }));

  useEffect(() => {
    const el = pop.current!;
    const toggled = (e: Event) => {
      const open = (e as ToggleEvent).newState === 'open';
      onOpenChange(open);
      const anchor = document.querySelector<HTMLElement>('[popovertarget="view-panel"]');
      if (open && anchor) placePopover(el, anchor, 'left');
    };
    el.addEventListener('toggle', toggled);
    // The typed range follows the view, except in the field being typed in.
    const sync = () => {
      if (!scene.width) return;
      const vp = scene.vp.visible;
      [vp.min, vp.max, vp.bottom, vp.top].forEach((v, i) => { const f = fields.current[i]; if (f && document.activeElement !== f) f.value = short(v); });
    };
    sync();
    const off = rangeSubscribe(sync);
    return () => { el.removeEventListener('toggle', toggled); off(); };
  }, [onOpenChange]);

  // like a change event: only a field that was typed in sets the view (tabbing through must not round it)
  const dirty = useRef(false);
  const apply = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const [x0, x1, y0, y1] = fields.current.map(f => (!f || f.value === '' ? NaN : Number(f.value)));
    setError(applyRange(x0, x1, y0, y1));
  };
  const set = (key: 'grid' | 'axes' | 'snap') => (on: boolean) => { state[key] = on; commit('toggles'); };
  const range = (i: number, label: string) => (
    <Field
      ref={el => { fields.current[i] = el; }}
      type="number"
      step="any"
      inputMode="decimal"
      mono
      aria-label={label}
      aria-invalid={!!error}
      onInput={() => { dirty.current = true; }}
      onBlur={apply}
      onKeyDown={e => { if (e.key === 'Enter') apply(); }}
    />
  );

  return (
    <div ref={pop} id="view-panel" className="b-popover b-settings b-view" popover="auto" role="dialog" aria-labelledby="view-title">
      <h3 id="view-title" className="b-popover-title">Widok</h3>
      {/* phones: what the short toolbar leaves out */}
      <div className="b-view-actions">
        <Button variant="secondary" size="sm" icon={<IconFitY />} onClick={fitY}>Dopasuj y</Button>
        <Button variant="secondary" size="sm" icon={<IconRatio />} onClick={equalAxes}>Osie 1:1</Button>
        <Button variant="secondary" size="sm" icon={<IconDownload />} onClick={savePng}>PNG</Button>
      </div>
      <div className="b-view-body">
        <Disclosure title="Wyświetlanie">
          <Switch checked={toggles.grid} onChange={set('grid')}>Siatka</Switch>
          <Switch checked={toggles.axes} onChange={set('axes')}>Osie</Switch>
          <Switch checked={toggles.snap} onChange={set('snap')}>Przyciąganie kursora</Switch>
        </Disclosure>
        <Disclosure title="Etykiety osi">
          {(['xUnit', 'yUnit'] as const).map(key => (
            <div className="b-view-row" key={key}>
              <span id={`view-${key}`}>{key === 'xUnit' ? 'Oś x' : 'Oś y'}</span>
              <SegmentedControl<AxisUnit>
                size="sm"
                variant="tray"
                aria-labelledby={`view-${key}`}
                value={toggles[key]}
                onChange={u => { state[key] = u; commit('toggles'); }}
                options={UNITS}
              />
            </div>
          ))}
        </Disclosure>
        <Disclosure title="Zakres">
          <div className="b-view-range">
            <span>x</span>{range(0, 'x od')}<span aria-hidden="true">–</span>{range(1, 'x do')}
            <span>y</span>{range(2, 'y od')}<span aria-hidden="true">–</span>{range(3, 'y do')}
          </div>
          <ErrorText className="b-view-error">{error}</ErrorText>
        </Disclosure>
      </div>
    </div>
  );
}

/** x ∈ […]   y ∈ […] in the corner, with as many digits as the grid labels. */
export function RangeCaption() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const sync = () => {
      if (!scene.width || !ref.current) return;
      const vp = scene.vp.visible;
      const xd = labelDigits(Math.max(Math.abs(vp.min), Math.abs(vp.max)), (vp.max - vp.min) / 10), yd = labelDigits(Math.max(Math.abs(vp.bottom), Math.abs(vp.top)), (vp.top - vp.bottom) / 10);
      ref.current.textContent = `x ∈ [${format(vp.min, xd)}; ${format(vp.max, xd)}]   y ∈ [${format(vp.bottom, yd)}; ${format(vp.top, yd)}]`;
    };
    sync();
    return rangeSubscribe(sync);
  }, []);
  return <p ref={ref} id="range-caption" className="b-caption" aria-hidden="true" />;
}
