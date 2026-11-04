import { expect, test } from 'vitest';
import { definition, equation, parseInput } from '../src/geometry/commands';
import { compute, type GeoObject, type Pt } from '../src/geometry/construct';

const P = (id: number, name: string, x: number, y: number): GeoObject => ({ id, name, kind: 'point', def: 'free', of: [], x, y });
// A right triangle: A(0; 0), B(4; 0), C(0; 3); f = AB, g = AC, c = circle(A, 2), d = circle(B, 2).
const base: GeoObject[] = [
  P(1, 'A', 0, 0), P(2, 'B', 4, 0), P(3, 'C', 0, 3),
  { id: 4, name: 'f', kind: 'segment', def: 'through', of: [1, 2] },
  { id: 5, name: 'g', kind: 'segment', def: 'through', of: [1, 3] },
  { id: 6, name: 'c', kind: 'circle', def: 'radius', of: [1], value: 2 },
  { id: 7, name: 'd', kind: 'circle', def: 'radius', of: [2], value: 2 },
];
const main = (text: string) => { const p = parseInput(text, base); return { ...p, d: p.drafts[p.main] }; };
/** Computes the parsed object on top of `base`, resolving −1, −2… the way the panel does. */
function shape(text: string) {
  const { drafts, main: m } = parseInput(text, base), ids: number[] = [];
  const extra = drafts.map((d, i) => { ids.push(100 + i); return { ...d, id: 100 + i, name: '', of: d.of.map(id => id < 0 ? ids[-id - 1] : id) }; });
  return compute([...base, ...extra]).get(100 + m);
}

test('one object, several ways to define it', () => {
  expect(main('Okrąg(A; B)').d).toMatchObject({ kind: 'circle', def: 'through', of: [1, 2] });
  expect(main('Okrąg(A; 3)').d).toMatchObject({ kind: 'circle', def: 'radius', of: [1], value: 3 });
  expect(main('Okrąg(A; f)').d).toMatchObject({ kind: 'circle', def: 'radiusSegment', of: [1, 4] });
  expect(main('okrag(A, B, C)').d).toMatchObject({ kind: 'circle', def: 'three', of: [1, 2, 3] }); // no diacritics, commas
  expect(main('Prosta(A; B)').d).toMatchObject({ kind: 'line', def: 'through' });
  expect(main('Prosta(C; f)').d).toMatchObject({ kind: 'line', def: 'parallel', of: [3, 4] });
  expect(main('Prosta(A; -1/2)').d).toMatchObject({ kind: 'line', def: 'slope', value: -0.5 });
  expect(main('Środek(f)').d).toMatchObject({ def: 'midpoint', of: [4] });
  expect(main('c = Okrąg(A; 2,5)')).toMatchObject({ name: 'c', d: { value: 2.5 } });
});

test('points: coordinates, shifts and literals inside commands', () => {
  expect(main('D = (1,5; −2)')).toMatchObject({ name: 'D', d: { def: 'free', x: 1.5, y: -2 } });
  expect(main('D = (sqrt(2), pi)').d).toMatchObject({ x: Math.SQRT2, y: Math.PI });
  expect(main('E = A + (3; 1)').d).toMatchObject({ def: 'offset', of: [1], coef: [3, 1] });
  const literal = parseInput('Okrąg((2; 2); 1)', base);
  expect(literal.drafts).toMatchObject([{ def: 'free', x: 2, y: 2 }, { def: 'radius', of: [-1], value: 1 }]);
  expect(shape('Odcinek(A; 5)')).toMatchObject({ x1: 0, x2: 5 });
});

test('angles: a bare number is degrees, π and ° are as written', () => {
  expect(main('Kąt(B; A; 40)').drafts[0].value).toBeCloseTo(40 * Math.PI / 180, 12);
  expect(main('Kąt(B; A; pi/4)').drafts[0].value).toBeCloseTo(Math.PI / 4, 12);
  expect(main('Obrót(B; 90°; A)').d).toMatchObject({ def: 'rotate', of: [2, 1] });
  expect((shape('Kąt(B; A; 40)') as { sweep: number }).sweep).toBeCloseTo(40 * Math.PI / 180, 12);
});

test('triangle centres of the 3-4-5 right triangle', () => {
  expect(shape('ŚrodekCiężkości(A; B; C)')).toMatchObject({ x: 4 / 3, y: 1 });
  expect(shape('Ortocentrum(A; B; C)')).toMatchObject({ x: 0, y: 0 }); // the right-angle vertex
  expect(shape('ŚrodekOpisanego(A; B; C)')).toMatchObject({ x: 2, y: 1.5 });
  expect(shape('OkrągWpisany(A; B; C)')).toMatchObject({ cx: 1, cy: 1, r: 1 });
  expect(shape('ŚrodekDziewięciuPunktów(A; B; C)')).toMatchObject({ x: 1, y: 0.75 });
  expect(shape('OkrągDziewięciuPunktów(A; B; C)')).toMatchObject({ cx: 1, cy: 0.75, r: 1.25 });
  // Excircle opposite A(0; 0): sides a = 5, b = 3, c = 4, denom = -5 + 3 + 4 = 2, area = 6 -> r_a = 12/2 = 6, cx = 3*4/2 = 6, cy = 4*3/2 = 6.
  expect(shape('ŚrodekDopisanego(A; B; C)')).toMatchObject({ x: 6, y: 6 });
  expect(shape('OkrągDopisany(A; B; C)')).toMatchObject({ cx: 6, cy: 6, r: 6 });
  expect(shape('Podział(A; B; 1/4)')).toMatchObject({ x: 1, y: 0 });
  expect(shape('Środkowa(A; B; C)')).toMatchObject({ x1: 0, y1: 0, x2: 2, y2: 1.5 });
  expect(shape('Wysokość(A; B; C)')).toMatchObject({ x1: 0, y1: 0, x2: 1.44, y2: 1.92 });
  expect(shape('Inwersja(B; c)')).toMatchObject({ x: 1, y: 0 }); // r^2 / d = 4 / 4 = 1
  expect(shape('Biegunowa(B; c)')).toMatchObject({ x1: 1, y1: 0, x2: 1, y2: 4 }); // x = 1
  expect(shape('OśPotęgowa(c; d)')).toMatchObject({ x1: 2, y1: 0, x2: 2, y2: 4 }); // x = 2
  expect((shape('Kąt(f; g)') as { sweep: number }).sweep).toBeCloseTo(Math.PI / 2, 12);
  expect((shape('Obwód(c)') as { value: number }).value).toBeCloseTo(4 * Math.PI, 12);
  expect((shape('Promień(c)') as { value: number }).value).toBe(2);
  expect((shape('Nachylenie(f)') as { value: number }).value).toBe(0);
  const arc3 = shape('ŁukPrzez3(B; C; A)') as { cx: number; cy: number; r: number };
  expect(arc3).toMatchObject({ cx: 2, cy: 1.5, r: 2.5 });
  const foot = shape('Rzut(C; f)') as Pt;
  expect([foot.x, foot.y]).toEqual([0, 0]);
});

test('equations become lines and circles', () => {
  expect(equation('y', '2x + 1')).toEqual({ kind: 'line', coef: [-2, 1, -1] }); // −2x + y − 1 = 0
  expect(equation('x', '4')).toEqual({ kind: 'line', coef: [1, 0, -4] });
  expect(equation('(x − 1)²+y²', '9')).toEqual({ kind: 'circle', coef: [1, 0, 3] });
  expect(equation('x^2 + y^2 - 4x', '5')).toEqual({ kind: 'circle', coef: [2, 0, 3] });
  const line = shape('g: 2x - 3y = 6') as { kind: string; x1: number; y1: number };
  expect(line.kind).toBe('line');
  expect(2 * line.x1 - 3 * line.y1).toBeCloseTo(6, 12);
  expect(main('g: 2x - 3y = 6')).toMatchObject({ name: 'g', d: { text: '2x - 3y = 6' } });
  expect(main('f(x) = 2x + 1')).toMatchObject({ name: 'f', d: { kind: 'line', def: 'equation', coef: [-2, 1, -1], text: 'y = 2x + 1' } });
});

test('mistakes get a readable message', () => {
  expect(() => parseInput('x^2 - y^2 = 1', base)).toThrow(/stożkowa/);
  expect(() => parseInput('y = sin(x)', base)).toThrow(/prostych i okręgów/);
  expect(() => parseInput('x^2 + y^2 = -1', base)).toThrow(/r²/);
  expect(() => parseInput('y = a x', base)).toThrow(/tylko x i y/);
  expect(() => parseInput('Okrąg(A)', base)).toThrow(/Okrąg\(A; B\), Okrąg\(A; 3\)/);
  expect(() => parseInput('Okrąg(A; Z)', base)).toThrow(/Nie ma obiektu „Z”/);
  expect(() => parseInput('Kółko(A; 3)', base)).toThrow(/Nie znam polecenia/);
  expect(() => parseInput('Okrąg = (1; 2)', base)).toThrow(/nazwa polecenia/);
  expect(() => parseInput('Wielokąt(A; B; 2)', base)).toThrow(/od 3 do 60/);
});

test('every written definition reads back as the same construction', () => {
  const samples = ['(1,5; −2)', 'Okrąg(A; B; C)', 'Okrąg(A; 2,5)', 'Okrąg(A; f)', 'Prosta(A; 0,5)', 'Równoległa(C; f)',
    'Przecięcie(f; f; 2)', 'Symetralna(f)', 'Wierzchołek(A; B; 6; 4)', 'Obrót(C; 30°; A)', 'Jednokładność(f; A; −2)', 'A + (1; 2)', 'Łuk(A; B; C)', 'Wycinek(A; B; C)',
    'ŚrodekDziewięciuPunktów(A; B; C)', 'OkrągDziewięciuPunktów(A; B; C)', 'ŚrodekDopisanego(A; B; C)', 'OkrągDopisany(A; B; C)',
    'Podział(A; B; 0,25)', 'Środkowa(A; B; C)', 'Wysokość(A; B; C)', 'Inwersja(B; c)', 'Biegunowa(B; c)', 'Biegun(f; c)',
    'OśPotęgowa(c; d)', 'ŁukPrzez3(A; B; C)', 'Kąt(f; g)', 'Obwód(c)', 'Nachylenie(f)', 'Promień(c)'];
  for (const text of samples) {
    const { d } = main(text), o = { ...d, id: 99, name: 'X', of: d.of.map(id => id < 0 ? 1 : id) } as GeoObject;
    const written = definition(o, id => base.find(b => b.id === id)?.name ?? '?');
    const again = parseInput(written, base);
    expect(again.drafts[again.main], `${text} → ${written}`).toMatchObject({ kind: d.kind, def: d.def, ...(d.value === undefined ? {} : { value: expect.closeTo(d.value, 5) }) });
  }
});
