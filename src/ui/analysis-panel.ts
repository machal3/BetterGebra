import type { AnalysisResult } from '../analysis/compute';
import { complexValue, domainText, list, stacked } from '../format';
import { expressionMathML, relationMathML } from '../math';
import { compiled } from '../model';
import type { SetFound } from '../render/sets';
import { activeFn, commit, state } from '../state';
import { $, setHTML } from './dom';

export function initAnalysisPanel(): void {
  $('analysis-button').addEventListener('click', () => { state.analysisOpen = !state.analysisOpen; commit('panel'); });
  $('analysis-close').addEventListener('click', () => { state.analysisOpen = false; commit('panel'); });
}

export function syncPanelVisibility(): void {
  $('analysis').hidden = !state.analysisOpen;
  $('analysis-button').setAttribute('aria-pressed', String(state.analysisOpen));
}

const row = (name: string) => document.querySelector<HTMLElement>(`#analysis [data-row="${name}"]`)!;

/**
 * Fills the panel for the active function. `result` may be a little behind the view while the worker catches up;
 * results for another function are ignored until the right one arrives.
 */
export function renderAnalysis(result: AnalysisResult | null, found: ReadonlyMap<number, SetFound>): void {
  if (!state.analysisOpen) return;
  const f = activeFn(), c = f && compiled(f, state.mode, state.params), set = state.mode === 'set';
  const target = $('analysis-target');
  target.style.setProperty('--c', c?.ok ? f!.color : 'transparent');
  let math = '';
  if (c?.ok) { try { math = set ? relationMathML(f!.expression) : expressionMathML(f!.expression); } catch { /* shown as text */ } }
  setHTML(target, math || '<span class="muted">brak funkcji</span>');
  row('v0').hidden = row('v1').hidden = row('cross').hidden = set;
  $('roots-label').textContent = set ? 'Zbiór' : 'Miejsca zerowe';
  document.querySelector('#analysis .analysis-foot')!.textContent = set ? 'w widocznej części płaszczyzny' : 'w widocznym zakresie';

  const fresh = result && f && result.activeId === f.id ? result : null;
  if (set) { setHTML($('roots'), stacked(f && c?.ok ? setText(f.id, c, fresh, found.get(f.id)) : '—')); return; }
  const values = fresh?.values;
  setHTML($('value-zero'), stacked(values?.[0] ?? '—'));
  setHTML($('value-one'), stacked(values?.[1] ?? '—'));
  setHTML($('roots'), stacked(c?.ok ? fresh?.roots ?? '…' : '—'));
  setHTML($('intersections'), stacked(fresh?.intersections ?? '—'));
}

function setText(id: number, c: NonNullable<ReturnType<typeof compiled>>, result: AnalysisResult | null, found: SetFound | undefined): string {
  const f = activeFn()!;
  if (c.set?.kind === 'parametric') {
    const { unknowns } = c.set;
    if (!unknowns.length) return `z = ${complexValue(c.set.at())}`;
    const range = Number.isFinite(f.from) || Number.isFinite(f.to) ? domainText(f, '') : ' ∈ ℝ';
    return `${unknowns.length > 1 ? 'obszar' : 'krzywa'}: ${unknowns.join(', ')}${range}`;
  }
  if (!f.visible || !found) return '—';
  const marks = result?.setPoints[id]?.solutions.map(({ z, sure }) => complexValue(z, sure)) ?? [];
  if (!marks.length && found.single) marks.push(complexValue(found.single.z, found.single.sure && found.single.z.every(Number.isInteger)));
  if (marks.length) return `z = ${list(marks)}`;
  const ops = c.set?.kind === 'condition' ? c.set.ops : [], equation = ops.includes('=');
  const edge = ops.every(o => o === '≤' || o === '≥') ? ', brzeg należy' : ops.every(o => o === '<' || o === '>' || o === '≠') ? ', brzeg nie należy' : '';
  if (found.all || (!equation && found.inside === found.valid && !found.lines && found.valid > 0)) return 'cała widoczna płaszczyzna';
  if (equation) return found.lines ? 'krzywa' : 'brak punktów w widocznym zakresie';
  return found.inside ? `obszar${edge}` : 'brak punktów w widocznym zakresie';
}
