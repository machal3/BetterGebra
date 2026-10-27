/**
 * Badanie: the active row's values, zeros and crossings in the visible range (or, for a set, what its points are),
 * with the calculator's exact study of it offered underneath. The worker's answer may be a little behind the view;
 * an answer about another row or mode is not shown. The card re-renders only when its text actually changes,
 * however often the canvas draws.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SmartRecommendation, type Recommendation } from '@/components/ui/smart-recommendation-clean';
import { IconClose } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import type { AnalysisResult } from '../../analysis/compute';
import { calculatorQuery } from '../../calculator-query';
import { approx, complexValue, domainText, list, stacked } from '../../format';
import { expressionMathML, relationMathML } from '../../math';
import { compiled, type Compiled } from '../../model';
import type { SetFound } from '../../render/sets';
import { activeFn, commit, state } from '../../state';
import { latestAnalysis, onDrawn, scene } from '../graph-runtime';
import { usePanel } from '../navigation';

interface View { color: string; math: string; set: boolean; v0: string; v1: string; roots: string; cross: string }

function setText(id: number, c: Compiled, result: AnalysisResult | null, found: SetFound | undefined): string {
  const f = activeFn()!;
  if (c.set?.kind === 'parametric') {
    const { unknowns } = c.set;
    if (!unknowns.length) return `z = ${complexValue(c.set.at())}`;
    const range = Number.isFinite(f.from) || Number.isFinite(f.to) ? domainText(f, '') : ' ∈ ℝ';
    return `${unknowns.length > 1 ? 'obszar' : 'krzywa'}: ${unknowns.join(', ')}${range}`;
  }
  if (!f.visible || !found) return '—';
  // the points of a condition in x and y are (x; y); of one on z, complex numbers
  const name = (z: [number, number], sure: boolean) => c.xy ? `(${sure ? z[0] : approx(z[0]).replace('≈ ', '')}; ${sure ? z[1] : approx(z[1]).replace('≈ ', '')})` : complexValue(z, sure);
  const marks = result?.setPoints[id]?.solutions.map(({ z, sure }) => name(z, sure)) ?? [];
  if (!marks.length && found.single) marks.push(name(found.single.z, found.single.sure && found.single.z.every(Number.isInteger)));
  if (marks.length) return c.xy ? `${marks.length > 1 ? 'punkty' : 'punkt'} ${list(marks)}` : `z = ${list(marks)}`;
  const ops = c.set?.kind === 'condition' ? c.set.ops : [], equation = ops.includes('=');
  const edge = ops.every(o => o === '≤' || o === '≥') ? ', brzeg należy' : ops.every(o => o === '<' || o === '>' || o === '≠') ? ', brzeg nie należy' : '';
  if (found.all || (!equation && found.inside === found.valid && !found.lines && found.valid > 0)) return 'cała widoczna płaszczyzna';
  if (equation) return found.lines ? 'krzywa' : 'brak punktów w widocznym zakresie';
  return found.inside ? `obszar${edge}` : 'brak punktów w widocznym zakresie';
}

/** What the card shows now, as one string: React compares it and skips frames that change nothing. */
function snapshot(): string {
  if (!state.analysisOpen) return '';
  const result = latestAnalysis(), found = scene.found;
  const f = activeFn(), c = f && compiled(f, state.mode, state.params), set = !!c?.set;
  let math = '';
  if (c?.ok) { try { math = set ? relationMathML(f!.expression) : expressionMathML(f!.expression); } catch { /* shown as text */ } }
  // only an answer about this row, as it is now and in this mode; until then the old one isn't shown
  const fresh = result && f && c?.ok && result.activeId === f.id && result.mode === state.mode ? result : null;
  const view: View = set
    ? { color: c?.ok ? f!.color : '', math, set, v0: '', v1: '', cross: '', roots: stacked(f && c?.ok ? setText(f.id, c, fresh, found.get(f.id)) : '—') }
    : {
      color: c?.ok ? f!.color : '', math, set,
      v0: stacked(fresh?.values?.[0] ?? '—'), v1: stacked(fresh?.values?.[1] ?? '—'),
      roots: stacked(c?.ok ? fresh?.roots ?? '…' : '—'), cross: stacked(fresh?.intersections ?? '—'),
    };
  return JSON.stringify(view);
}

/** What the calculator offers for the row: the exact study first, then other exact answers about it. */
function recommendations(): Recommendation[] {
  const f = activeFn();
  if (!f) return [];
  const c = compiled(f, state.mode, state.params);
  const q = c.ok ? calculatorQuery(f, state.mode, state.params) : null;
  if (!q) return [];
  const body = q.query.startsWith('badanie funkcji ') ? q.query.slice('badanie funkcji '.length) : null;
  const first: Recommendation = { id: 'study', label: body ? 'Badanie funkcji' : q.label.replace(/ w kalkulatorze$/, ''), reason: `${q.title}.`, signal: 3 };
  if (!body) return [{ ...first, id: q.query }];
  return [
    { ...first, id: q.query },
    { id: `${body} = 0`, label: 'Miejsca zerowe', reason: 'Rozwiązania f(x) = 0 w postaci dokładnej, także poza widocznym zakresem.', signal: 3 },
    { id: `pochodna ${body}`, label: 'Pochodna', reason: 'Pochodna f′(x) w postaci dokładnej, z wykresem.', signal: 3 },
    { id: `całka ${body} dx`, label: 'Całka nieoznaczona', reason: 'Funkcja pierwotna, sprawdzona różniczkowaniem.', signal: 3 },
  ];
}

/**
 * "Dokładnie w kalkulatorze": the active row's exact study and other exact answers, a click away. In the Badanie
 * card, and under the list of functions while that card is closed.
 */
export function ExactInCalculator({ className }: { className?: string }) {
  useStore(['active', 'expr', 'mode', 'list'], s => s.activeId);
  // after a trip to the calculator, the suggestion starts over instead of showing "przyjęto"
  const panel = usePanel();
  const options = recommendations(), f = activeFn();
  if (!options.length || !f) return null;
  return (
    <SmartRecommendation
      // a new row or expression starts from its first suggestion again
      key={`${f.id} ${f.expression} ${state.mode} ${panel}`}
      className={className}
      title="Dokładnie w kalkulatorze"
      options={options}
      showSignal={false}
      defaultOpen={false}
      acceptLabel={() => 'Otwórz w kalkulatorze'}
      onAccept={o => { location.hash = `#kalkulator?q=${encodeURIComponent(o.id)}`; }}
    />
  );
}

export function Analysis() {
  const open = useStore(['panel', 'active', 'expr', 'mode', 'list'], s => s.analysisOpen);
  const json = useSyncExternalStore(onDrawn, snapshot);
  if (!open || !json) return null;
  const view: View = JSON.parse(json);
  const close = () => { state.analysisOpen = false; commit('panel'); };
  return (
    <section id="analysis" className="b-analysis" aria-label="Badanie funkcji" aria-live="polite">
      <header className="b-analysis-head">
        <h2>Badanie</h2>
        <div className="b-analysis-target" style={{ '--c': view.color || 'transparent' } as React.CSSProperties}>
          {view.math ? <span dangerouslySetInnerHTML={{ __html: view.math }} /> : <span className="b-muted">brak funkcji</span>}
        </div>
        <Button variant="ghost" icon={<IconClose />} aria-label="Zamknij badanie" title="Zamknij  B" onClick={close} />
      </header>
      <dl className="b-ledger">
        {!view.set && <div><dt>f(0)</dt><dd dangerouslySetInnerHTML={{ __html: view.v0 }} /></div>}
        {!view.set && <div><dt>f(1)</dt><dd dangerouslySetInnerHTML={{ __html: view.v1 }} /></div>}
        <div><dt>{view.set ? 'Zbiór' : 'Miejsca zerowe'}</dt><dd dangerouslySetInnerHTML={{ __html: view.roots }} /></div>
        {!view.set && <div><dt>Przecięcia</dt><dd dangerouslySetInnerHTML={{ __html: view.cross }} /></div>}
      </dl>
      <p className="b-analysis-foot">{view.set ? 'w widocznej części płaszczyzny' : 'w widocznym zakresie'}</p>
      <ExactInCalculator className="b-analysis-rec" />
    </section>
  );
}
