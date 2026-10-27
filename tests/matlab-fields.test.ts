import { expect, test } from 'vitest';
import { run, type Result, type Saved } from '../src/cas/engine';

const first = (q: string | Result) => { const r = typeof q === 'string' ? run(q) : q; if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`); return r.pods[0]; };
function session() {
  const vars: Record<string, Saved> = {};
  return (q: string): Result => {
    const r = run(q, { vars: { ...vars } });
    for (const [k, v] of Object.entries(r.assigned ?? {})) { if (v) vars[k] = v; else delete vars[k]; }
    return r;
  };
}

test('meshgrid, as MATLAB lays it out', () => {
  expect(first('meshgrid(1:3, 1:2)').rows.map(r => r.text).join(' | ')).toBe('X = [[1, 2, 3], [1, 2, 3]] | Y = [[1, 1, 1], [2, 2, 2]]');
  const ask = session();
  ask('[X, Y] = meshgrid(-1:1)');
  ask('Z = X.^2 + Y.^2');
  const s = first(ask('surf(X, Y, Z)')).plot!.three!;
  expect(s.surfaces[0].z).toEqual([[2, 1, 2], [1, 0, 1], [2, 1, 2]]);
  expect(s.surfaces[0].xs).toEqual([-1, 0, 1]);
});

test('surf and mesh of an expression; a pole leaves a hole, not a wall', () => {
  const p = first('surf(x^2 - y^2)');
  const s = p.plot!.three!;
  expect(s.surfaces[0].xs.length).toBe(45);
  expect(s.box.slice(0, 4)).toEqual([-5, 5, -5, 5]);
  expect(s.box[4]).toBeLessThan(-20);
  expect(s.box[5]).toBeGreaterThan(20);
  expect(p.note).toMatch(/Przeciągnij, aby obrócić/);
  const m = first('mesh(sin(x)*cos(y), [-3 3 -3 3])').plot!.three!;
  expect(m.surfaces[0].wire).toBe(true);
  expect(m.box.slice(0, 4)).toEqual([-3, 3, -3, 3]);
  const pole = first('surf(1/(x^2 + y^2))');
  expect(pole.plot!.three!.surfaces[0].z.flat().some(v => Number.isNaN(v))).toBe(true);
  expect(pole.note).toMatch(/puste/);
  // the workspace's x is not the surface's x
  const ask = session();
  ask('x = 5');
  expect(first(ask('surf(x^2 - y^2)')).plot!.three!.box[4]).toBeLessThan(-20);
});

test('plot3: a helix and data', () => {
  const h = first('plot3([cos(t), sin(t), t/5], [0 10])').plot!.three!;
  expect(h.curves[0].pts.length).toBe(1800);
  expect(h.box[4]).toBeCloseTo(0, 6);
  expect(h.box[5]).toBeCloseTo(2, 6);
  expect(first('plot3([1 2 3], [4 5 6], [7 8 9])').plot!.three!.curves[0].pts).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
});

test('contour: level curves where the function takes the level', () => {
  const p = first('contour(x^2 + y^2, [1 4], [-3 3 -3 3])');
  expect(p.plot!.series.length).toBe(2);
  const pts = p.plot!.series[0].segs.flat(), r: number[] = [];
  for (let k = 0; k < pts.length; k += 2) r.push(Math.hypot(pts[k], pts[k + 1]));
  expect(Math.min(...r)).toBeGreaterThan(0.97);
  expect(Math.max(...r)).toBeLessThan(1.03);
  expect(p.note).toMatch(/poziomy: 1; 4/);
  expect(first('contour(sin(x)*cos(y))').plot!.series.length).toBeGreaterThan(5);
});

test('quiver: a field of arrows, scaled to the grid', () => {
  const q = first('quiver([-y, x])').plot!;
  expect(q.vectors.length).toBe(15 * 15 - 1); // the zero vector at the origin has no arrow
  expect(q.equal).toBe(true);
  const longest = Math.max(...q.vectors.map(v => Math.hypot(v.x2 - v.x1, v.y2 - v.y1)));
  expect(longest).toBeCloseTo(0.9 * 10 / 14, 6);
  expect(first('quiver([0 1], [0 0], [1 0], [0 1])').plot!.vectors.length).toBe(2);
});
