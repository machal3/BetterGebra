/**
 * Definitions as text, in the style of GeoGebra: "Okrąg(A; B; C)", "c = Okrąg(A; 3)", "y = 2x + 1", "B = A + (3; 0)".
 * `parseInput` reads one into drafts; `definition` writes any object's definition back, in a form `parseInput` reads.
 */
import { format } from '../format';
import { MathError, buildReal, constant, parameterNames, parse } from '../math';
import type { Draft, GeoObject, Kind } from './construct';

/** P point, L line-like, S segment, C circle, R curve, G region, V vector, O any object, N number, A angle. */
type Arg = 'P' | 'L' | 'S' | 'C' | 'R' | 'G' | 'V' | 'O' | 'N' | 'A';
const ROLES: Record<Kind, string> = {
  point: 'PO', segment: 'SLRO', line: 'LRO', ray: 'LRO', vector: 'VLRO', circle: 'CRGO', arc: 'RO', sector: 'RGO', polygon: 'GO', angle: 'O', measure: '',
};

interface Build {
  /** Adds a draft to the batch; returns the id later drafts use to refer to it. */
  push: (d: Draft) => number;
  kindOf: (id: number) => Kind;
  nameOf: (id: number) => string;
}
interface Form {
  args: Arg[] | 'points';
  usage: string;
  what: string;
  /** Pushes the drafts; returns the id of the object the definition names. */
  make: (a: number[], b: Build) => number;
}

const one = (kind: Kind, def: Draft['def'], extra: Partial<Draft> = {}) => (of: number[], b: Build) => b.push({ kind, def, of, ...extra });
const withValue = (kind: Kind, def: Draft['def'], at: number) => (a: number[], b: Build) => b.push({ kind, def, of: a.filter((_, i) => i !== at), value: a[at] });
const image = (def: Draft['def']) => ([obj, by, value]: number[], b: Build) => b.push({ kind: b.kindOf(obj), def, of: [obj, by], value, imageOf: b.nameOf(obj) });
function polygon(vertices: number[], b: Build): number {
  const poly = b.push({ kind: 'polygon', def: 'through', of: vertices });
  vertices.forEach((p, i) => b.push({ kind: 'segment', def: 'edge', of: [p, vertices[(i + 1) % vertices.length], poly] }));
  return poly;
}
const count = (what: string, min: number, max: number) => (v: number) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new MathError(`${what}: liczba całkowita od ${min} do ${max}.`);
  return v;
};

const COMMANDS: { name: string; forms: Form[] }[] = [
  { name: 'Punkt', forms: [{ args: ['R'], usage: 'Punkt(f)', what: 'punkt na linii lub okręgu', make: one('point', 'on', { t: 0 }) }] },
  { name: 'Środek', forms: [
    { args: ['P', 'P'], usage: 'Środek(A; B)', what: 'środek odcinka o końcach A, B', make: one('point', 'midpoint') },
    { args: ['S'], usage: 'Środek(f)', what: 'środek odcinka', make: one('point', 'midpoint') },
    { args: ['C'], usage: 'Środek(c)', what: 'środek okręgu', make: one('point', 'midpoint') },
  ] },
  { name: 'Przecięcie', forms: [
    { args: ['R', 'R'], usage: 'Przecięcie(f; g)', what: 'punkt przecięcia', make: one('point', 'intersect', { index: 0 }) },
    { args: ['R', 'R', 'N'], usage: 'Przecięcie(c; d; 2)', what: 'drugi punkt przecięcia', make: ([p, q, n], b) => b.push({ kind: 'point', def: 'intersect', of: [p, q], index: count('Numer punktu', 1, 2)(n) - 1 }) },
  ] },
  { name: 'Rzut', forms: [{ args: ['P', 'L'], usage: 'Rzut(A; f)', what: 'rzut prostokątny punktu na prostą', make: one('point', 'foot') }] },
  { name: 'ŚrodekCiężkości', forms: [{ args: ['P', 'P', 'P'], usage: 'ŚrodekCiężkości(A; B; C)', what: 'punkt przecięcia środkowych', make: one('point', 'centroid') }] },
  { name: 'Ortocentrum', forms: [{ args: ['P', 'P', 'P'], usage: 'Ortocentrum(A; B; C)', what: 'punkt przecięcia wysokości', make: one('point', 'orthocenter') }] },
  { name: 'ŚrodekWpisanego', forms: [{ args: ['P', 'P', 'P'], usage: 'ŚrodekWpisanego(A; B; C)', what: 'środek okręgu wpisanego (przecięcie dwusiecznych)', make: one('point', 'incenter') }] },
  { name: 'ŚrodekOpisanego', forms: [{ args: ['P', 'P', 'P'], usage: 'ŚrodekOpisanego(A; B; C)', what: 'środek okręgu opisanego (przecięcie symetralnych)', make: one('point', 'circumcenter') }] },
  { name: 'Wierzchołek', forms: [{ args: ['P', 'P', 'N', 'N'], usage: 'Wierzchołek(A; B; 6; 3)', what: 'k-ty wierzchołek n-kąta foremnego o boku AB', make: ([p, q, n, k], b) => {
    const sides = count('Liczba boków', 3, 60)(n);
    return b.push({ kind: 'point', def: 'regular', of: [p, q], value: sides, index: count('Numer wierzchołka', 3, sides)(k) - 1 });
  } }] },

  { name: 'Odcinek', forms: [
    { args: ['P', 'P'], usage: 'Odcinek(A; B)', what: 'odcinek o końcach A, B', make: one('segment', 'through') },
    { args: ['P', 'N'], usage: 'Odcinek(A; 5)', what: 'odcinek z A o danej długości', make: ([p, l], b) => b.push({ kind: 'segment', def: 'through', of: [p, b.push({ kind: 'point', def: 'offset', of: [p], coef: [l, 0] })] }) },
  ] },
  { name: 'Wektor', forms: [{ args: ['P', 'P'], usage: 'Wektor(A; B)', what: 'wektor od A do B', make: one('vector', 'through') }] },
  { name: 'Prosta', forms: [
    { args: ['P', 'P'], usage: 'Prosta(A; B)', what: 'prosta przez dwa punkty', make: one('line', 'through') },
    { args: ['P', 'L'], usage: 'Prosta(A; f)', what: 'prosta przez A równoległa do f', make: one('line', 'parallel') },
    { args: ['P', 'N'], usage: 'Prosta(A; 2)', what: 'prosta przez A o współczynniku kierunkowym 2', make: withValue('line', 'slope', 1) },
  ] },
  { name: 'Półprosta', forms: [{ args: ['P', 'P'], usage: 'Półprosta(A; B)', what: 'półprosta z A przez B', make: one('ray', 'through') }] },
  { name: 'Prostopadła', forms: [{ args: ['P', 'L'], usage: 'Prostopadła(A; f)', what: 'prosta przez A prostopadła do f', make: one('line', 'perpendicular') }] },
  { name: 'Równoległa', forms: [{ args: ['P', 'L'], usage: 'Równoległa(A; f)', what: 'prosta przez A równoległa do f', make: one('line', 'parallel') }] },
  { name: 'Symetralna', forms: [
    { args: ['P', 'P'], usage: 'Symetralna(A; B)', what: 'symetralna odcinka AB', make: one('line', 'bisector') },
    { args: ['S'], usage: 'Symetralna(f)', what: 'symetralna odcinka', make: one('line', 'bisector') },
  ] },
  { name: 'Dwusieczna', forms: [{ args: ['P', 'P', 'P'], usage: 'Dwusieczna(A; B; C)', what: 'dwusieczna kąta ABC', make: one('line', 'angleBisector') }] },
  { name: 'Styczna', forms: [
    { args: ['P', 'C'], usage: 'Styczna(A; c)', what: 'styczna z A do okręgu', make: one('line', 'tangent', { index: 0 }) },
    { args: ['P', 'C', 'N'], usage: 'Styczna(A; c; 2)', what: 'druga styczna z A', make: ([p, c, n], b) => b.push({ kind: 'line', def: 'tangent', of: [p, c], index: count('Numer stycznej', 1, 2)(n) - 1 }) },
  ] },

  { name: 'Okrąg', forms: [
    { args: ['P', 'P'], usage: 'Okrąg(A; B)', what: 'okrąg o środku A przez B', make: one('circle', 'through') },
    { args: ['P', 'N'], usage: 'Okrąg(A; 3)', what: 'okrąg o środku A i promieniu 3', make: withValue('circle', 'radius', 1) },
    { args: ['P', 'S'], usage: 'Okrąg(A; f)', what: 'okrąg o środku A, promień = długość f', make: one('circle', 'radiusSegment') },
    { args: ['P', 'P', 'P'], usage: 'Okrąg(A; B; C)', what: 'okrąg przez trzy punkty', make: one('circle', 'three') },
  ] },
  { name: 'OkrągOpisany', forms: [{ args: ['P', 'P', 'P'], usage: 'OkrągOpisany(A; B; C)', what: 'okrąg opisany na trójkącie', make: one('circle', 'three') }] },
  { name: 'OkrągWpisany', forms: [{ args: ['P', 'P', 'P'], usage: 'OkrągWpisany(A; B; C)', what: 'okrąg wpisany w trójkąt', make: one('circle', 'incircle') }] },
  { name: 'Cyrkiel', forms: [{ args: ['P', 'P', 'P'], usage: 'Cyrkiel(A; B; C)', what: 'okrąg o środku C i promieniu |AB|', make: one('circle', 'compass') }] },
  { name: 'Półokrąg', forms: [{ args: ['P', 'P'], usage: 'Półokrąg(A; B)', what: 'półokrąg nad AB', make: one('arc', 'semicircle') }] },
  { name: 'Łuk', forms: [{ args: ['P', 'P', 'P'], usage: 'Łuk(O; A; B)', what: 'łuk o środku O od A do półprostej OB', make: one('arc', 'arc') }] },
  { name: 'Wycinek', forms: [{ args: ['P', 'P', 'P'], usage: 'Wycinek(O; A; B)', what: 'wycinek koła o środku O', make: one('sector', 'arc') }] },

  { name: 'Wielokąt', forms: [
    { args: ['P', 'P', 'N'], usage: 'Wielokąt(A; B; 6)', what: 'wielokąt foremny o boku AB', make: ([p, q, n], b) => {
      const sides = count('Liczba boków', 3, 60)(n);
      return polygon([p, q, ...Array.from({ length: sides - 2 }, (_, i) => b.push({ kind: 'point', def: 'regular', of: [p, q], value: sides, index: i + 2 }))], b);
    } },
    { args: 'points', usage: 'Wielokąt(A; B; C; …)', what: 'wielokąt o danych wierzchołkach', make: polygon },
  ] },
  { name: 'Kąt', forms: [
    { args: ['P', 'P', 'P'], usage: 'Kąt(A; B; C)', what: 'kąt ABC (do 180°)', make: one('angle', 'through') },
    { args: ['P', 'P', 'A'], usage: 'Kąt(A; B; 40°)', what: 'kąt o wierzchołku B i danej mierze', make: ([p, v, t], b) => b.push({ kind: 'angle', def: 'oriented', of: [p, v, b.push({ kind: 'point', def: 'rotate', of: [p, v], value: t, imageOf: b.nameOf(p) })] }) },
  ] },
  { name: 'KątSkierowany', forms: [{ args: ['P', 'P', 'P'], usage: 'KątSkierowany(A; B; C)', what: 'kąt od BA do BC przeciwnie do wskazówek zegara', make: one('angle', 'oriented') }] },
  { name: 'Odległość', forms: [
    { args: ['P', 'P'], usage: 'Odległość(A; B)', what: 'odległość punktów', make: one('measure', 'distance') },
    { args: ['P', 'L'], usage: 'Odległość(A; f)', what: 'odległość punktu od prostej', make: one('measure', 'distance') },
  ] },
  { name: 'Długość', forms: [{ args: ['S'], usage: 'Długość(f)', what: 'długość odcinka', make: one('measure', 'distance') }] },
  { name: 'Pole', forms: [{ args: ['G'], usage: 'Pole(t₁)', what: 'pole wielokąta, koła lub wycinka', make: one('measure', 'area') }] },

  { name: 'Odbicie', forms: [
    { args: ['O', 'L'], usage: 'Odbicie(A; f)', what: 'symetria osiowa względem f', make: image('reflect') },
    { args: ['O', 'P'], usage: 'Odbicie(A; O)', what: 'symetria środkowa względem O', make: image('reflect') },
  ] },
  { name: 'Obrót', forms: [{ args: ['O', 'A', 'P'], usage: 'Obrót(A; 90°; O)', what: 'obrót wokół O (przeciwnie do wskazówek zegara)', make: ([o, t, c], b) => image('rotate')([o, c, t], b) }] },
  { name: 'Przesunięcie', forms: [{ args: ['O', 'V'], usage: 'Przesunięcie(A; u)', what: 'przesunięcie o wektor', make: image('translate') }] },
  { name: 'Jednokładność', forms: [{ args: ['O', 'P', 'N'], usage: 'Jednokładność(A; O; 2)', what: 'jednokładność o środku O i skali k', make: image('dilate') }] },
];

/** For the reference list in the panel. */
export const REFERENCE = [
  { usage: 'A = (1; 2)', what: 'punkt o współrzędnych' },
  { usage: 'B = A + (3; 0)', what: 'punkt przesunięty o wektor' },
  { usage: 'y = 2x + 1', what: 'prosta z równania (też 2x − 3y = 6, x = 4)' },
  { usage: '(x − 1)² + y² = 9', what: 'okrąg z równania (też x² + y² − 4x = 5)' },
  ...COMMANDS.flatMap(c => c.forms.map(({ usage, what }) => ({ usage, what }))),
];

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const BY_NAME = new Map(COMMANDS.map(c => [fold(c.name), c]));
const NAME = /^\p{L}[\p{L}\p{N}_′″‴'₀-₉]*$/u;

export interface Parsed {
  /** A name given as "c = …" or "f: …". */
  name?: string;
  /** Later drafts refer to earlier ones by −1, −2… (the first, the second…). */
  drafts: Draft[];
  /** Which draft the definition is about (the polygon, not its sides). */
  main: number;
}

const fail = (message: string): never => { throw new MathError(message); };

/** Top-level arguments: split at ";" if there is one (decimal commas!), else at ",". */
export function splitArgs(s: string): string[] {
  const parts: string[] = [], semi: number[] = [], comma: number[] = [];
  let depth = 0;
  [...s].forEach((c, i) => {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (!depth && c === ';') semi.push(i);
    else if (!depth && c === ',') comma.push(i);
  });
  if (depth) fail('Nawiasy się nie zamykają.');
  let start = 0;
  for (const i of semi.length ? semi : comma) { parts.push(s.slice(start, i)); start = i + 1; }
  parts.push(s.slice(start));
  return parts.map(p => p.trim());
}

const number = (s: string) => {
  let v: number;
  try { v = constant(s); } catch { return fail(`„${s}” nie jest nazwą obiektu ani liczbą.`); }
  return Number.isFinite(v) ? v : fail(`„${s}” nie jest skończoną liczbą.`);
};
/** 40° and π/4 as written; a bare number counts in degrees, as at school. */
export const angle = (s: string) => /°|pi|π|tau|τ/i.test(s) ? number(s) : number(s) * Math.PI / 180;
const coordinates = (inner: string) => {
  const parts = splitArgs(inner);
  return parts.length === 2 ? parts.map(number) : fail('Punkt ma dwie współrzędne, np. (1; 2).');
};

export function parseInput(input: string, objects: GeoObject[]): Parsed {
  let text = input.trim().replace(/'/g, '′');
  if (!text) fail('Wpisz definicję, np. A = (1; 2) albo Okrąg(A; 3).');
  let name: string | undefined;
  const named = text.match(/^([^\s=:()]+)\s*([:=])\s*([^]+)$/);
  if (named && NAME.test(named[1]) && named[1] !== 'x' && named[1] !== 'y') {
    if (BY_NAME.has(fold(named[1]))) fail(`„${named[1]}” to nazwa polecenia. Wybierz inną nazwę.`);
    name = named[1];
    text = named[3].trim();
  }
  const byName = new Map(objects.map(o => [o.name, o]));
  const drafts: Draft[] = [];
  const b: Build = {
    push: d => drafts.push(d) * -1,
    kindOf: id => id < 0 ? drafts[-id - 1].kind : objects.find(o => o.id === id)!.kind,
    nameOf: id => id < 0 ? '' : objects.find(o => o.id === id)!.name,
  };
  const done = (main: number): Parsed => ({ name, drafts, main: -main - 1 });

  const literal = text.match(/^\(([^]*)\)$/);
  if (literal) { const [x, y] = coordinates(literal[1]); return done(b.push({ kind: 'point', def: 'free', of: [], x, y })); }

  const shifted = text.match(/^(\S+)\s*\+\s*\(([^]*)\)$/);
  if (shifted && byName.get(shifted[1])?.kind === 'point') {
    return done(b.push({ kind: 'point', def: 'offset', of: [byName.get(shifted[1])!.id], coef: coordinates(shifted[2]) }));
  }

  const call = text.match(/^(\p{L}+)\s*\(([^]*)\)$/u);
  const command = call && BY_NAME.get(fold(call[1]));
  if (call && command) {
    const raw = splitArgs(call[2]);
    // Each argument: an object (with what it can stand for), a point literal, or a number.
    const args = raw.map(s => {
      const o = byName.get(s);
      if (o) return { roles: ROLES[o.kind], s, id: o.id };
      if (/^\(.*\)$/.test(s)) return { roles: 'PO', s };
      if (!s) return fail(`${command.name}: brakuje argumentu.`);
      if (NAME.test(s) && !/^(pi|e|tau|phi)$/i.test(s)) return fail(`Nie ma obiektu „${s}”.`);
      return { roles: 'NA', s };
    });
    const fits = (f: Form) => f.args === 'points' ? args.length >= 3 && args.every(a => a.roles.includes('P')) : f.args.length === args.length && f.args.every((t, i) => args[i].roles.includes(t));
    const form = command.forms.find(fits)
      ?? fail(`${command.name}: nie pasują argumenty. Możliwe: ${command.forms.map(f => f.usage).join(', ')}.`);
    const values = args.map((a, i) => {
      const type = form.args === 'points' ? 'P' : form.args[i];
      if (a.id !== undefined) return a.id;
      if (type === 'N') return number(a.s);
      if (type === 'A') return angle(a.s);
      const [x, y] = coordinates(a.s.slice(1, -1));
      return b.push({ kind: 'point', def: 'free', of: [], x, y });
    });
    return done(form.make(values, b));
  }
  if (call) fail(`Nie znam polecenia „${call[1]}”. Zajrzyj do listy poleceń.`);

  if (text.includes('=')) {
    const sides = text.split('=');
    if (sides.length !== 2) fail('Równanie ma jeden znak =.');
    const { kind, coef } = equation(sides[0], sides[1]);
    return done(b.push({ kind, def: 'equation', of: [], coef, text: text.replace(/\s+/g, ' ') }));
  }
  if (byName.has(text)) fail(`„${text}” już istnieje. Aby zmienić definicję, wpisz np. ${text} = …`);
  return fail('Nie rozumiem. Wpisz np. A = (1; 2), Okrąg(A; 3) albo y = 2x + 1.');
}

/**
 * The line or circle F(x, y) = 0. F is read off exactly as a polynomial of degree ≤ 2 (from values at a few points),
 * then checked elsewhere, so sin(x) or x³ are refused rather than misread.
 */
export function equation(lhs: string, rhs: string): { kind: 'line' | 'circle'; coef: number[] } {
  if (!lhs.trim() || !rhs.trim()) fail('Po obu stronach znaku = musi coś być.');
  const text = `(${lhs})-(${rhs})`, extra = parameterNames(text).filter(n => n !== 'y');
  if (extra.length) fail(`W równaniu mogą być tylko x i y, a jest „${extra[0]}”.`);
  const params: Record<string, number> = { y: 0 }, f = buildReal(parse(text), params);
  const F = (x: number, y: number) => { params.y = y; return f(x); };
  const g = F(0, 0), A = (F(1, 0) + F(-1, 0)) / 2 - g, D = (F(1, 0) - F(-1, 0)) / 2, B = (F(0, 1) + F(0, -1)) / 2 - g, E = (F(0, 1) - F(0, -1)) / 2;
  const C = F(1, 1) - A - B - D - E - g, scale = Math.max(...[A, B, C, D, E, g].map(Math.abs));
  const exact = [[0.37, -1.3], [2.1, 0.6], [-1.7, -2.2], [3.3, 2.9]].every(([x, y]) =>
    Math.abs(F(x, y) - (A * x * x + B * y * y + C * x * y + D * x + E * y + g)) <= 1e-9 * (1 + scale * (1 + x * x + y * y)));
  if (!exact || !Number.isFinite(scale)) fail('Obsługiwane są równania prostych i okręgów (stopnia co najwyżej 2).');
  const tiny = 1e-12 * scale;
  if (Math.abs(A) <= tiny && Math.abs(B) <= tiny && Math.abs(C) <= tiny) {
    if (Math.abs(D) <= tiny && Math.abs(E) <= tiny) fail('To równanie nie opisuje prostej.');
    return { kind: 'line', coef: [D, E, g].map(v => v + 0) }; // + 0 turns −0 into 0
  }
  if (Math.abs(C) > tiny || Math.abs(A - B) > tiny) fail('To krzywa stożkowa, ale nie okrąg: obsługiwane są proste i okręgi.');
  const cx = -D / (2 * A), cy = -E / (2 * A), r2 = cx * cx + cy * cy - g / A;
  if (!(r2 > tiny / Math.abs(A))) fail('To równanie nie opisuje okręgu (r² ≤ 0).');
  return { kind: 'circle', coef: [cx, cy, Math.sqrt(r2)].map(v => v + 0) };
}

// --- Writing definitions back ---

const n = (v: number | undefined) => v === undefined || !Number.isFinite(v) ? '?' : format(v, 6).replace(/^-/, '−');
const deg = (rad: number | undefined) => rad === undefined ? '?' : `${n(rad * 180 / Math.PI)}°`;
const THROUGH: Partial<Record<Kind, string>> = { segment: 'Odcinek', line: 'Prosta', ray: 'Półprosta', vector: 'Wektor', circle: 'Okrąg', polygon: 'Wielokąt', angle: 'Kąt' };
const SIMPLE: Partial<Record<Draft['def'], string>> = {
  on: 'Punkt', midpoint: 'Środek', foot: 'Rzut', centroid: 'ŚrodekCiężkości', orthocenter: 'Ortocentrum', incenter: 'ŚrodekWpisanego',
  circumcenter: 'ŚrodekOpisanego', perpendicular: 'Prostopadła', parallel: 'Równoległa', bisector: 'Symetralna', angleBisector: 'Dwusieczna',
  three: 'Okrąg', radiusSegment: 'Okrąg', incircle: 'OkrągWpisany', compass: 'Cyrkiel', semicircle: 'Półokrąg', oriented: 'KątSkierowany',
  area: 'Pole', translate: 'Przesunięcie', reflect: 'Odbicie',
};

/** "Okrąg(A; B; C)", "(1; 2)", "y = 2x + 1": how the object is defined, readable back by parseInput. */
export function definition(o: GeoObject, nameOf: (id: number) => string): string {
  const a = o.of.map(nameOf), call = (name: string, args = a) => `${name}(${args.join('; ')})`;
  switch (o.def) {
    case 'free': return `(${n(o.x)}; ${n(o.y)})`;
    case 'through': return call(THROUGH[o.kind] ?? 'Odcinek');
    case 'edge': return call('Odcinek', a.slice(0, 2));
    case 'intersect': return call('Przecięcie', o.index ? [...a, String(o.index + 1)] : a);
    case 'tangent': return call('Styczna', o.index ? [...a, String(o.index + 1)] : a);
    case 'offset': { const [dx, dy] = o.coef ?? [o.value, 0]; return `${a[0]} + (${n(dx)}; ${n(dy)})`; }
    case 'regular': return call('Wierzchołek', [...a, n(o.value), String((o.index ?? 2) + 1)]);
    case 'slope': return call('Prosta', [a[0], n(o.value)]);
    case 'radius': return call('Okrąg', [a[0], n(o.value)]);
    case 'arc': return call(o.kind === 'sector' ? 'Wycinek' : 'Łuk');
    case 'distance': return call(a.length === 1 ? 'Długość' : 'Odległość');
    case 'rotate': return call('Obrót', [a[0], deg(o.value), a[1]]);
    case 'dilate': return call('Jednokładność', [...a, n(o.value)]);
    case 'equation': {
      if (o.text) return o.text;
      const [k, l, m] = o.coef ?? [];
      return o.kind === 'circle' ? `(x − ${n(k)})² + (y − ${n(l)})² = ${n(m * m)}` : `${n(k)}x + ${n(l)}y + ${n(m)} = 0`;
    }
  }
  return call(SIMPLE[o.def] ?? o.def);
}
