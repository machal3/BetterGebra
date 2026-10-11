import { expect, test } from 'vitest';
import { compute, dependents, describe, distanceTo, freeAncestors, intersections, nextName, primed, type GeoObject, type Pt } from '../src/geometry/construct';

const P = (id: number, x: number, y: number): GeoObject => ({ id, name: String.fromCharCode(64 + id), kind: 'point', def: 'free', of: [], x, y });
const near = (s: unknown, x: number, y: number) => { const p = s as Pt; expect(p.x).toBeCloseTo(x, 9); expect(p.y).toBeCloseTo(y, 9); };

test('constructions follow their free points', () => {
  const objects: GeoObject[] = [
    P(1, 0, 0), P(2, 4, 0), P(3, 0, 4),
    { id: 4, name: 'D', kind: 'point', def: 'midpoint', of: [1, 2] },
    { id: 5, name: 'c', kind: 'circle', def: 'three', of: [1, 2, 3] },
    { id: 6, name: 'f', kind: 'line', def: 'bisector', of: [1, 2] },
    { id: 7, name: 'E', kind: 'point', def: 'intersect', of: [6, 5], index: 1 },
    { id: 8, name: 'α', kind: 'angle', def: 'through', of: [2, 1, 3] },
  ];
  let s = compute(objects);
  near(s.get(4), 2, 0);
  expect(s.get(5)).toMatchObject({ cx: 2, cy: 2 });
  near(s.get(7), 2, 2 + Math.sqrt(8));
  expect(describe(objects[7], s.get(8)!, String).text).toBe('α = 90°');

  objects[1].x = 6; // drag B
  s = compute(objects);
  near(s.get(4), 3, 0);
  expect(dependents(objects, 2)).toEqual(new Set([2, 4, 5, 6, 7, 8]));
  expect(freeAncestors(objects, 7).map(o => o.id).sort()).toEqual([1, 2, 3]);
});

test('intersections keep their index and vanish off a segment', () => {
  const seg = { kind: 'segment', x1: 0, y1: 0, x2: 1, y2: 0 } as const;
  const line = { kind: 'line', x1: 2, y1: -1, x2: 2, y2: 1 } as const;
  expect(intersections(seg, line)).toEqual([null]);
  expect(intersections({ ...seg, kind: 'line' }, line)[0]).toMatchObject({ x: 2, y: 0 });
  expect(intersections(seg, { ...seg, y1: 1, y2: 1 })).toEqual([]); // parallel
  const a = { kind: 'circle', cx: 0, cy: 0, r: 5 } as const, b = { kind: 'circle', cx: 8, cy: 0, r: 5 } as const;
  const [p, q] = intersections(a, b);
  near(p, 4, 3); near(q, 4, -3);
  expect(intersections(a, { ...b, cx: 20 })).toEqual([]);
});

test('degenerate input reads as "nie istnieje", not NaN', () => {
  const objects: GeoObject[] = [P(1, 1, 1), P(2, 1, 1), { id: 3, name: 'f', kind: 'line', def: 'through', of: [1, 2] }];
  const s = compute(objects);
  expect(s.get(3)).toBeNull();
  expect(describe(objects[2], null, String).text).toBe('f — nie istnieje');
});

test('descriptions, names and hit distances', () => {
  const name = (id: number) => 'ABC'[id - 1];
  const circle: GeoObject = { id: 9, name: 'c', kind: 'circle', def: 'through', of: [1, 2] };
  expect(describe(circle, { kind: 'circle', cx: 1, cy: -2, r: 2 }, name)).toEqual({ text: 'c: (x − 1)² + (y + 2)² = 4', detail: 'okrąg o środku A przez B' });
  const line: GeoObject = { id: 9, name: 'f', kind: 'line', def: 'through', of: [1, 2] };
  expect(describe(line, { kind: 'line', x1: 0, y1: 1, x2: 1, y2: 3 }, name).text).toBe('f: y = 2x + 1');
  expect(describe(line, { kind: 'line', x1: 3, y1: 0, x2: 3, y2: 1 }, name).text).toBe('f: x = 3');
  expect(nextName('point', new Set(['A', 'B']))).toBe('C');
  expect(nextName('polygon', new Set())).toBe('t₁');
  const square = { kind: 'polygon', pts: [[0, 0], [2, 0], [2, 2], [0, 2]].map(([x, y]) => ({ kind: 'point', x, y }) as Pt) } as const;
  expect(distanceTo(square, 1, 1)).toBe(0);
  expect(distanceTo(square, 3, 1)).toBe(1);
});

test('tangents, regular polygons, arcs and measures', () => {
  const objects: GeoObject[] = [
    P(1, 0, 0), P(2, 2, 0), P(3, 4, 0), P(4, 0, 2),
    { id: 5, name: 'c', kind: 'circle', def: 'through', of: [1, 2] },
    { id: 6, name: 'f', kind: 'line', def: 'tangent', of: [3, 5], index: 0 },
    { id: 7, name: 'g', kind: 'line', def: 'tangent', of: [3, 5], index: 1 },
    { id: 8, name: 'E', kind: 'point', def: 'regular', of: [1, 2], index: 2, value: 4 },  // square on AB: (2; 2)
    { id: 9, name: 'k', kind: 'arc', def: 'semicircle', of: [1, 2] },                     // over AB, upper half
    { id: 10, name: 'm₁', kind: 'measure', def: 'distance', of: [3, 6] },                  // C lies on its tangent
    { id: 11, name: 'q', kind: 'sector', def: 'arc', of: [1, 2, 4] },                      // quarter disc r = 2
    { id: 12, name: 'm₂', kind: 'measure', def: 'area', of: [11] },
  ];
  const s = compute(objects);
  near(s.get(8), 2, 2);
  // Tangents from (4; 0) to the circle r = 2 touch it at 60° and −60°.
  const f = s.get(6) as { x2: number; y2: number }, g = s.get(7) as { x2: number; y2: number };
  expect([f.x2, f.y2].map(v => +v.toFixed(9))).toEqual([1, +Math.sqrt(3).toFixed(9)]);
  expect([g.x2, g.y2].map(v => +v.toFixed(9))).toEqual([1, -Math.sqrt(3).toFixed(9)]);
  expect(describe(objects[9], s.get(10)!, id => objects.find(o => o.id === id)!.name).text).toBe('d(C, f) = 0');
  expect((s.get(12) as { value: number }).value).toBeCloseTo(Math.PI, 12);
  // The semicircle over AB is the upper half (centre (1; 0)): the line x = 1 meets it at (1; 1) only.
  const vertical = { kind: 'line', x1: 1, y1: -5, x2: 1, y2: 5 } as const;
  expect(intersections(vertical, s.get(9)!).filter(Boolean)).toEqual([{ kind: 'point', x: 1, y: 1 }]);
});

test('transformations map any shape and name the image with a prime', () => {
  const objects: GeoObject[] = [
    P(1, 1, 0), P(2, 3, 0), P(3, 0, 0), P(4, 0, 1),
    { id: 5, name: 'f', kind: 'segment', def: 'through', of: [1, 2] },
    { id: 6, name: 'h', kind: 'line', def: 'through', of: [3, 4] },                         // the y axis
    { id: 7, name: 'f′', kind: 'segment', def: 'reflect', of: [5, 6] },
    { id: 8, name: 'A′', kind: 'point', def: 'rotate', of: [1, 3], value: Math.PI / 2 },
    { id: 9, name: 'f″', kind: 'segment', def: 'dilate', of: [5, 3], value: -2 },
    { id: 10, name: 'α', kind: 'angle', def: 'oriented', of: [1, 3, 8] },
    { id: 11, name: 'α′', kind: 'angle', def: 'reflect', of: [10, 6] },
  ];
  const s = compute(objects);
  expect(s.get(7)).toMatchObject({ x1: -1, x2: -3 });
  near(s.get(8), 0, 1);
  expect(s.get(9)).toMatchObject({ x1: -2, x2: -6 });
  expect((s.get(10) as { sweep: number }).sweep).toBeCloseTo(Math.PI / 2, 12);
  // Mirrored, the right angle now opens from the y axis to the negative x axis.
  const mirrored = s.get(11) as { from: number; sweep: number };
  expect(mirrored.from).toBeCloseTo(Math.PI / 2, 12);
  expect(mirrored.sweep).toBeCloseTo(Math.PI / 2, 12);
  expect(primed('A', new Set(['A′']))).toBe('A″');
});
