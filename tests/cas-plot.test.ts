import { expect, test } from 'vitest';
import { run, type Plot } from '../src/cas/engine';
import { compile } from '../src/math';

/** The plot of the card with this title. */
function plot(q: string, title = 'Wykres'): Plot {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  const p = r.pods.find(p => p.title === title && p.plot);
  if (!p) throw new Error(`${q}: no plot „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.plot!;
}
const at = (p: Plot, kind: string) => p.marks.filter(m => m.kind === kind).map(m => Math.round(m.x * 1000) / 1000).sort((a, b) => a - b);

test('a function: zeros, extrema and a curve the graph panel reads back', () => {
  const p = plot('x^3 - 3x');
  expect(at(p, 'zero')).toEqual([-1.732, 0, 1.732]);
  expect(at(p, 'max')).toEqual([-1]);
  expect(at(p, 'min')).toEqual([1]);
  expect(compile(p.series[0].expr!)(2)).toBe(2);
  // the view shows the extrema, not just the steep ends
  expect(p.y[1] - p.y[0]).toBeLessThan(25);
});

test('function study: exact points with the right kind, asymptotes, a derivative plot', () => {
  const p = plot('badanie funkcji x^3 - 3x');
  expect(at(p, 'max')).toEqual([-1]);
  expect(at(p, 'min')).toEqual([1]);
  expect(p.marks.find(m => m.x === 0)?.label).toBe('miejsce zerowe, punkt przegięcia (0; 0)');
  const q = plot('badanie funkcji (x^2 + 1)/(x - 1)');
  expect(q.vlines).toEqual([1]);
  expect(q.series[1].expr).toBe('x + 1'); // the oblique asymptote, dashed
  expect(q.series[1].dash).toBe(true);
  expect(plot('badanie funkcji x^3 - 3x', 'Wykres pochodnych').series).toHaveLength(2);
});

test('equations, inequalities, integrals and limits', () => {
  expect(at(plot('x^3 = x'), 'cross')).toEqual([-1, 0, 1]);
  expect(plot('(x - 1)/(x + 2) >= 0').bands).toHaveLength(2);
  const area = plot('całka sin x od 0 do 2pi', 'Pole pod wykresem');
  expect(area.fills[0]).toMatchObject({ a: 0, label: 'całka = 0' });
  expect(area.fills[0].b).toBeCloseTo(2 * Math.PI);
  const lim = plot('granica sin(x)/x przy x->0');
  expect(lim.marks.find(m => m.kind === 'hole')).toMatchObject({ x: 0, y: 1 });
  expect(plot('granica 1/x przy x->0').vlines).toEqual([0]);
  expect(plot('granica (1 + 1/n)^n przy n->inf').refs[0].y).toBeCloseTo(Math.E);
});

test('complex numbers and roots on the plane', () => {
  const z = plot('(1+2i)/(3-i)', 'Płaszczyzna zespolona');
  expect(z.equal && z.plane).toBe(true);
  expect(z.marks[0]).toMatchObject({ x: expect.closeTo(0.1), y: expect.closeTo(0.7) });
  const r = plot('x^5 = 1', 'Rozwiązania na płaszczyźnie zespolonej');
  expect(r.marks).toHaveLength(5);
  expect(r.shapes[0].pts).toHaveLength(10); // the regular pentagon
});

test('matrices, statistics and sums', () => {
  const m = plot('[[2, 1], [1, 2]]', 'Przekształcenie płaszczyzny');
  expect(m.series.map(s => s.expr).sort()).toEqual(['-x', 'x']); // eigenvector lines for λ = 1 and 3
  expect(m.vectors.map(v => [v.x2, v.y2])).toEqual([[2, 1], [1, 2]]);
  const h = plot('{2, 4, 4, 4, 5, 5, 7, 9}', 'Histogram');
  expect(h.bars.reduce((s, b) => s + b.h, 0)).toBe(8);
  expect(h.refs.map(r => r.label)).toEqual(['średnia 5', 'mediana 4,5']);
  const s = plot('sum(1/k^2, k, 1, inf)', 'Wyrazy i sumy częściowe');
  expect(s.refs[0].y).toBeCloseTo(Math.PI ** 2 / 6);
  expect(s.series[1].segs[0]).toHaveLength(120);
});

test('curves: implicit, systems, parametric and several in one plot', () => {
  const c = plot('x^2 + y^2 = 25', 'Krzywa');
  expect(c.series[0].segs).toHaveLength(1); // one closed polyline
  const pts = c.series[0].segs[0];
  for (let i = 0; i < pts.length; i += 2) expect(Math.hypot(pts[i], pts[i + 1])).toBeCloseTo(5, 1);
  const sys = plot('x + y = 5, x y = 6');
  expect(sys.marks.map(m => [m.x, m.y])).toEqual([[3, 2], [2, 3]]);
  const mix = plot('wykres x^2 + y^2 = 25, y = x - 1');
  expect(at(mix, 'cross')).toEqual([-3, 4]);
  const two = plot('wykres sin x, cos x');
  expect(two.series.map(s => s.expr)).toEqual(['sin(x)', 'cos(x)']);
  expect(at(two, 'cross')[0]).toBeCloseTo(-7 * Math.PI / 4, 2); // trigonometric: [−2π; 2π] with π on the axis
  expect(two.xUnit).toBe('pi');
  expect(plot('wykres [cos t, sin(2t)]').equal).toBe(true);
});

test('hand-off to the graph panel: the right mode, rows the panel reads', async () => {
  const { compileRow } = await import('../src/model');
  const rowsOf = (q: string, title = 'Wykres') => plot(q, title).open!;
  const cases: [string, string, string, string[]][] = [
    ['(1+2i)/(3-i)', 'Płaszczyzna zespolona', 'graph', ['(1 + 7i)/10', '(1 − 7i)/10', '|z| = √2/2']],
    ['x^5 = 1', 'Rozwiązania na płaszczyźnie zespolonej', 'graph', ['z^5 = 1', '|z| = 1']],
    ['z^2 + 1', 'Wykres dla rzeczywistych z', 'complex', ['z^2 + 1']],
    ['x^2 + y^2 = 25', 'Krzywa', 'graph', ['x^2 + y^2 = 25']],
    ['x + y = 5, x y = 6', 'Wykres', 'graph', ['x + y − 5 = 0', 'x·y − 6 = 0', '3 + 2i', '2 + 3i']],
    ['x^2 + y^2 <= 25', 'Wykres', 'graph', ['x^2 + y^2 <= 25']],
    ['wykres x^2 + y^2 = 25, y = x - 1', 'Wykres', 'graph', ['x^2 + y^2 = 25', 'x − 1']],
    ['wykres [cos t, sin(2t)]', 'Wykres', 'graph', ['cos(t) + (sin(2t))*i']],
  ];
  for (const [q, title, mode, exprs] of cases) {
    const open = rowsOf(q, title);
    expect(open.mode, q).toBe(mode);
    expect(open.rows.map(r => r.expr), q).toEqual(expect.arrayContaining(exprs));
    for (const r of open.rows) {
      const f = { id: -1, expression: r.expr, color: '#000000', visible: true, from: r.from ?? -Infinity, to: r.to ?? Infinity, fromOpen: false, toOpen: false, width: 2, dash: '' as const };
      expect(compileRow(f, open.mode, {}).ok, `${q}: ${r.expr}`).toBe(true);
    }
  }
  expect(rowsOf('wykres [cos t, sin(2t)]').rows[0]).toMatchObject({ from: 0, to: 2 * Math.PI });
  expect(plot('x^2 + y^2 <= 25').regions).toEqual([{ expr: 'x^2 + y^2 <= 25', color: 0 }]);
  // graphs keep going to Wykresy, trigonometric ones with π on the x axis
  expect(plot('sin(x) = 1/2').open).toBeUndefined();
  expect(plot('sin(x) = 1/2').xUnit).toBe('pi');
  expect(plot('x^3 - 3x').xUnit).toBeUndefined();
});

test('float underflow is not a zero: x^200 has one, at 0', () => {
  const plot = run('x^200').pods.find(p => p.plot)!.plot as Plot;
  expect(plot.marks.filter(m => m.kind === 'zero').map(m => m.x)).toEqual([0]);
  const pods = run('analyze(x^200)').pods;
  expect(pods.find(p => p.title === 'Ekstrema lokalne')!.rows[0].text).toBe('minimum lokalne: x = 0, f = 0');
  expect(run('solve(x^200 - x^199 = 0)').pods[0].rows.map(r => r.text)).toEqual(['x = 0', 'x = 1']);
});
