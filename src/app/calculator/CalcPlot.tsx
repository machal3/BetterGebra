/**
 * A plot in a result card: above it the legend (click a curve to hide it) and the view toolbar (zoom, snapping,
 * full screen, PNG); the canvas, drawn and handled by plot-engine; under it the notable points as a list (point at
 * one to light it up, click to centre on it), a hint on the gestures and "Otwórz w Wykresach / Zespolonych".
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button-clean';
import { IconDownload, IconExpand, IconOpen, IconReset, IconShrink, IconSnap, IconZoomIn, IconZoomOut } from '@/components/icons';
import type { Plot, Scene3 } from '../../cas/engine';
import { mount3d, type Plot3Handle } from './plot3d';
import { prettyText } from './composer-text';
import { PANEL, color, handoff, mountPlot, snapping, splitLabel, toggleSnap, type PlotHandle } from './plot-engine';

const WHAT = { graph: 'wykresy, krzywe, obszary i punkty, z analizą i parametrami', complex: 'funkcję zespoloną, z kolorowaniem płaszczyzny' };

/** A plot in space: the canvas of plot3d, turned by dragging, and its toolbar. */
function CalcPlot3D({ scene }: { scene: Scene3 }) {
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null), handle = useRef<Plot3Handle | null>(null);
  useEffect(() => {
    handle.current = mount3d(scene, canvas.current!, stage.current!);
    return () => { handle.current?.destroy(); handle.current = null; };
  }, [scene]);
  const what = [...scene.surfaces.map(s => (s.label ? `z = ${s.label}` : 'powierzchnia')), ...scene.curves.map(c => c.label)].join('; ');
  return (
    <div className="b-cplot">
      <div ref={stage} className="b-cplot-stage b-cplot-stage--3d">
        <canvas ref={canvas} className="b-cplot-canvas" tabIndex={0} role="img" aria-label={`Wykres przestrzenny: ${what}. Przeciągnij albo strzałki obracają, kółko, plus i minus przybliżają, 0 przywraca widok.`} />
        <div className="b-cplot-tools" role="toolbar" aria-label="Widok wykresu">
          <Button variant="ghost" icon={<IconReset />} aria-label="Widok domyślny" title="Widok domyślny  0" onClick={() => handle.current?.reset()} />
          <Button variant="ghost" icon={<IconDownload />} aria-label="Zapisz wykres jako PNG" title="Zapisz wykres jako PNG" onClick={() => handle.current?.png()} />
        </div>
      </div>
    </div>
  );
}

export function CalcPlot({ plot }: { plot: Plot }) {
  return plot.three ? <CalcPlot3D scene={plot.three} /> : <CalcPlot2D plot={plot} />;
}

/** The card itself in full screen (where the browser allows it); Esc leaves. */
function useFullscreen(card: React.RefObject<HTMLDivElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === card.current && !!card.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [card]);
  const can = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void card.current?.requestFullscreen().catch(() => { /* refused: stay in the page */ });
  };
  return { on, can, toggle };
}

function CalcPlot2D({ plot }: { plot: Plot }) {
  const card = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const handle = useRef<PlotHandle | null>(null);
  const [shown, setShown] = useState<boolean[]>(() => plot.series.map(() => true));
  const snap = useSyncExternalStore(snapping.subscribe, snapping.get);
  const full = useFullscreen(card);
  useEffect(() => {
    handle.current = mountPlot(plot, canvas.current!, stage.current!, tip.current!);
    return () => { handle.current?.destroy(); handle.current = null; };
  }, [plot]);

  const out = handoff(plot);
  const listed = plot.marks.filter(m => Number.isFinite(m.y) && m.label).slice(0, 24);
  const label = `Wykres: ${plot.series.map(s => s.label).join('; ') || 'dane'}. Przeciągnij, aby przesunąć; kółko myszy lub plus i minus przybliżają, 0 przywraca widok.`;
  const keys = [
    ...plot.series.map((s, i) => s.label && (
      <button
        key={i}
        type="button"
        className="b-cplot-key is-toggle"
        aria-pressed={shown[i]}
        title={shown[i] ? 'Ukryj na wykresie' : 'Pokaż na wykresie'}
        style={{ '--c': color(s.color ?? i) } as React.CSSProperties}
        onClick={() => { const on = handle.current?.toggle(i) ?? true; setShown(v => v.map((x, k) => (k === i ? on : x))); }}
      >
        <span className={`b-sw${s.dash ? ' is-dash' : ''}${s.style && s.style !== 'line' ? ' is-dot' : ''}${s.faint ? ' is-faint' : ''}`} aria-hidden="true" />
        <span className="b-cplot-key-text">{prettyText(s.label)}</span>
      </button>
    )),
    ...plot.fills.map((f, i) => (
      <span key={`f${i}`} className="b-cplot-key" style={{ '--c': color(0), '--c2': color(1) } as React.CSSProperties}><span className="b-sw is-area" aria-hidden="true" /><span className="b-cplot-key-text">{prettyText(f.label)}</span></span>
    )),
    ...plot.shapes.filter(s => !s.open).map((s, i) => (
      <span key={`s${i}`} className="b-cplot-key" style={{ '--c': color(s.color ?? 0) } as React.CSSProperties}><span className={`b-sw ${s.fill ? 'is-area' : 'is-dash'}`} aria-hidden="true" /><span className="b-cplot-key-text">{prettyText(s.label)}</span></span>
    )),
    ...(plot.bars.length > 0 ? [<span key="bars" className="b-cplot-key" style={{ '--c': color(0) } as React.CSSProperties}><span className="b-sw is-area" aria-hidden="true" /><span className="b-cplot-key-text">liczba wartości w przedziale</span></span>] : []),
  ].filter(Boolean);

  return (
    <div ref={card} className={`b-cplot${full.on ? ' is-full' : ''}`}>
      <div className="b-cplot-head">
        <div className="b-cplot-legend">{keys}</div>
        <div className="b-cplot-tools" role="toolbar" aria-label="Widok wykresu">
          <Button variant="ghost" size="sm" icon={<IconZoomOut />} aria-label="Oddal" title="Oddal  −" onClick={() => handle.current?.zoom(1 / 0.7)} />
          <Button variant="ghost" size="sm" icon={<IconZoomIn />} aria-label="Przybliż" title="Przybliż  +  (lub kółko myszy)" onClick={() => handle.current?.zoom(0.7)} />
          <Button variant="ghost" size="sm" icon={<IconReset />} aria-label="Przywróć widok" title="Przywróć widok  0" onClick={() => handle.current?.reset()} />
          <span className="b-cplot-sep" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            className="b-tool-toggle"
            icon={<IconSnap />}
            aria-pressed={snap}
            aria-label="Przyciąganie do siatki"
            title="Przyciąganie do siatki: odczyt trzyma się linii siatki i miejsc, gdzie krzywa je przecina"
            onClick={toggleSnap}
          />
          {full.can && <Button variant="ghost" size="sm" icon={full.on ? <IconShrink /> : <IconExpand />} aria-label={full.on ? 'Zamknij pełny ekran' : 'Pełny ekran'} title={full.on ? 'Zamknij pełny ekran  Esc' : 'Pełny ekran'} onClick={full.toggle} />}
          <Button variant="ghost" size="sm" icon={<IconDownload />} aria-label="Zapisz wykres jako PNG" title="Zapisz wykres jako PNG" onClick={() => handle.current?.png()} />
        </div>
      </div>
      <div ref={stage} className="b-cplot-stage">
        <canvas ref={canvas} className="b-cplot-canvas" tabIndex={0} role="img" aria-label={label} />
        <div ref={tip} className="b-cplot-tip" hidden />
      </div>
      {listed.length > 0 && (
        <ul className="b-cplot-points" aria-label="Punkty na wykresie">
          {listed.map((m, i) => {
            const [name, at] = splitLabel(m.label);
            return (
              <li key={i}>
                <button
                  type="button"
                  className="b-cplot-point"
                  title="Pokaż na wykresie"
                  style={{ '--c': color(m.color ?? 0) } as React.CSSProperties}
                  onPointerEnter={() => handle.current?.focus(m)}
                  onPointerLeave={() => handle.current?.focus(null)}
                  onFocus={() => handle.current?.focus(m)}
                  onBlur={() => handle.current?.focus(null)}
                  onClick={() => handle.current?.center(m)}
                >
                  <span className={`b-pt${m.kind === 'hole' ? ' is-hole' : ''}`} aria-hidden="true" />
                  <span className="b-cplot-point-name">{prettyText(name)}</span>
                  {at && <span className="b-cplot-point-at">{at}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="b-cplot-foot">
        <span className="b-cplot-hint">Przeciągnij, by przesunąć · kółko przybliża i oddala · dwuklik powiększa</span>
        {out.rows.length > 0 && (
          <Button variant="secondary" size="sm" icon={<IconOpen />} title={`Przenieś ${WHAT[out.mode]} do panelu ${PANEL[out.mode].name}`} onClick={() => handle.current?.open()}>
            {`Otwórz w ${PANEL[out.mode].to}`}
          </Button>
        )}
      </div>
    </div>
  );
}
