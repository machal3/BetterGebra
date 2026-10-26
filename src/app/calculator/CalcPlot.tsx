/**
 * A plot in a result card: the canvas, drawn and handled by plot-engine, and around it the view toolbar, the
 * legend (click to hide a curve), the list of notable points (point at one to find it, click to centre on it) and
 * "Otwórz w Wykresach / Zespolonych".
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button-clean';
import { IconDownload, IconOpen, IconReset, IconSnap, IconZoomIn, IconZoomOut } from '@/components/icons';
import type { Plot } from '../../cas/engine';
import { PANEL, color, handoff, mountPlot, snapping, toggleSnap, type PlotHandle } from './plot-engine';

const WHAT = { graph: 'wykresy, krzywe, obszary i punkty, z analizą i parametrami', complex: 'funkcję zespoloną, z kolorowaniem płaszczyzny' };

export function CalcPlot({ plot }: { plot: Plot }) {
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const handle = useRef<PlotHandle | null>(null);
  const [shown, setShown] = useState<boolean[]>(() => plot.series.map(() => true));
  const snap = useSyncExternalStore(snapping.subscribe, snapping.get);
  useEffect(() => {
    handle.current = mountPlot(plot, canvas.current!, stage.current!, tip.current!);
    return () => { handle.current?.destroy(); handle.current = null; };
  }, [plot]);

  const out = handoff(plot);
  const listed = plot.marks.filter(m => Number.isFinite(m.y) && m.label).slice(0, 24);
  const label = `Wykres: ${plot.series.map(s => s.label).join('; ') || 'dane'}. Przeciągnij, aby przesunąć; Ctrl + kółko lub plus i minus przybliżają, 0 przywraca widok.`;
  return (
    <div className="b-cplot">
      <div ref={stage} className="b-cplot-stage">
        <canvas ref={canvas} className="b-cplot-canvas" tabIndex={0} role="img" aria-label={label} />
        <div ref={tip} className="b-cplot-tip" hidden />
        <div className="b-cplot-tools" role="toolbar" aria-label="Widok wykresu">
          <Button variant="ghost" icon={<IconZoomIn />} aria-label="Przybliż" title="Przybliż  Ctrl + kółko" onClick={() => handle.current?.zoom(0.7)} />
          <Button variant="ghost" icon={<IconZoomOut />} aria-label="Oddal" title="Oddal" onClick={() => handle.current?.zoom(1 / 0.7)} />
          <Button variant="ghost" icon={<IconReset />} aria-label="Przywróć widok" title="Przywróć widok" onClick={() => handle.current?.reset()} />
          <span className="b-cplot-sep" aria-hidden="true" />
          <Button
            variant="ghost"
            className="b-tool-toggle"
            icon={<IconSnap />}
            aria-pressed={snap}
            aria-label="Przyciąganie do siatki"
            title="Przyciąganie do siatki: odczyt trzyma się linii siatki i miejsc, gdzie krzywa je przecina"
            onClick={toggleSnap}
          />
          <Button variant="ghost" icon={<IconDownload />} aria-label="Zapisz wykres jako PNG" title="Zapisz wykres jako PNG" onClick={() => handle.current?.png()} />
        </div>
      </div>
      <div className="b-cplot-foot">
        <div className="b-cplot-legend">
          {plot.series.map((s, i) => s.label && (
            <button
              key={i}
              type="button"
              className="b-cplot-key"
              aria-pressed={shown[i]}
              title="Pokaż lub ukryj"
              style={{ '--c': color(s.color ?? i) } as React.CSSProperties}
              onClick={() => { const on = handle.current?.toggle(i) ?? true; setShown(v => v.map((x, k) => (k === i ? on : x))); }}
            >
              <span className={`b-sw${s.dash ? ' is-dash' : ''}${s.style && s.style !== 'line' ? ' is-dot' : ''}`} aria-hidden="true" />
              {s.label}
            </button>
          ))}
          {plot.fills.map((f, i) => (
            <span key={`f${i}`} className="b-cplot-key" style={{ '--c': color(0), '--c2': color(1) } as React.CSSProperties}><span className="b-sw is-area" aria-hidden="true" />{f.label}</span>
          ))}
          {plot.shapes.filter(s => !s.open).map((s, i) => (
            <span key={`s${i}`} className="b-cplot-key" style={{ '--c': color(s.color ?? 0) } as React.CSSProperties}><span className={`b-sw ${s.fill ? 'is-area' : 'is-dash'}`} aria-hidden="true" />{s.label}</span>
          ))}
          {plot.bars.length > 0 && <span className="b-cplot-key" style={{ '--c': color(0) } as React.CSSProperties}><span className="b-sw is-area" aria-hidden="true" />liczba wartości w przedziale</span>}
        </div>
        {out.rows.length > 0 && (
          <Button variant="secondary" icon={<IconOpen />} title={`Przenieś ${WHAT[out.mode]} do panelu ${PANEL[out.mode].name}`} onClick={() => handle.current?.open()}>
            {`Otwórz w ${PANEL[out.mode].to}`}
          </Button>
        )}
      </div>
      {listed.length > 0 && (
        <ul className="b-cplot-points" aria-label="Punkty na wykresie">
          {listed.map((m, i) => (
            <li key={i}>
              <button
                type="button"
                title="Pokaż na wykresie"
                style={{ '--c': color(m.color ?? 0) } as React.CSSProperties}
                onPointerEnter={() => handle.current?.focus(m)}
                onPointerLeave={() => handle.current?.focus(null)}
                onFocus={() => handle.current?.focus(m)}
                onBlur={() => handle.current?.focus(null)}
                onClick={() => handle.current?.center(m)}
              >
                <span className="b-pt" aria-hidden="true" />{m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
