/**
 * Geometric constructions: free points, and objects defined over earlier ones (midpoint, intersection, perpendicular…).
 * Nothing stores a computed position: `compute` rebuilds every shape from the definitions, so dragging a free point
 * moves everything built on it. An object only refers to objects before it in the list.
 */
import { format } from '../format';

export type Kind = 'point' | 'segment' | 'line' | 'ray' | 'vector' | 'circle' | 'arc' | 'sector' | 'polygon' | 'angle' | 'measure';
export type Def =
  | 'free'          // point at x, y
  | 'on'            // point on [line-like, circle or arc], at parameter t
  | 'midpoint'      // point between [A, B]; middle of [segment]; centre of [circle or arc]
  | 'foot'          // point: orthogonal projection of [P] on the line through [line]
  | 'centroid'      // point: centroid of the triangle [A, B, C]
  | 'orthocenter'   // point: where the altitudes of [A, B, C] meet
  | 'incenter'      // point: centre of the circle inscribed in [A, B, C]
  | 'circumcenter'  // point: centre of the circle through [A, B, C]
  | 'intersect'     // point: intersection `index` of [curve, curve]
  | 'offset'        // point [A] moved by the vector `coef` = [dx, dy] (older drawings: by `value` to the right)
  | 'regular'       // point: vertex `index` of the regular `value`-gon on side [A, B]
  | 'through'       // segment/line/ray/vector [A, B]; circle [centre, P]; polygon [A, B, C…]; angle [A, vertex, C]
  | 'edge'          // segment [A, B, polygon]: a polygon side, removed with the polygon
  | 'perpendicular' // line through [P] perpendicular to [line]
  | 'parallel'      // line through [P] parallel to [line]
  | 'bisector'      // line: perpendicular bisector of [A, B]
  | 'angleBisector' // line bisecting the angle [A, vertex, C]
  | 'tangent'       // line: tangent `index` from [P] to [circle]
  | 'slope'         // line through [P] with slope `value`
  | 'equation'      // line a·x + b·y + c = 0 with `coef` = [a, b, c]; circle with `coef` = [cx, cy, r]
  | 'three'         // circle through [A, B, C]
  | 'radius'        // circle around [centre] with radius `value`
  | 'radiusSegment' // circle around [centre] with radius the length of [segment]
  | 'incircle'      // circle inscribed in the triangle [A, B, C]
  | 'compass'       // circle around [C] with radius |AB|: [A, B, C]
  | 'semicircle'    // arc over [A, B], counter-clockwise from B to A
  | 'arc'           // arc or sector around [centre], counter-clockwise from [A] to the ray towards [B]
  | 'oriented'      // angle [A, vertex, C] counter-clockwise, may exceed 180°
  | 'distance'      // measure: length of [segment], |PQ| of [P, Q], or distance of [P, line]
  | 'area'          // measure: area of [polygon, circle or sector]
  | 'reflect'       // image of [object] in [line or point]
  | 'rotate'        // image of [object] rotated around [point] by `value` radians
  | 'translate'     // image of [object] moved by [vector]
  | 'dilate';       // image of [object] scaled by `value` from [point]

export interface GeoObject {
  id: number;
  name: string;
  kind: Kind;
  def: Def;
  of: number[];
  x?: number;
  y?: number;
  t?: number;
  index?: number;
  value?: number;
  coef?: number[];
  /** An equation as the user typed it, shown as the definition. */
  text?: string;
  hidden?: boolean;
  style?: Style;
}
/** How an object looks; whatever is left out is the default for its kind. A polygon's sides look like the polygon. */
export interface Style {
  /** A CSS colour, or 'ink' for the text colour of the theme. */
  color?: string;
  /** Line width in pixels. */
  width?: number;
  dash?: 'dashed' | 'dotted';
  /** Fill opacity, 0 to 1. */
  fill?: number;
  /** Point radius in pixels. */
  size?: number;
  shape?: 'ring' | 'cross';
  /** Left out: as usual for the kind (points their name, angles and measures their value, the rest nothing). */
  label?: 'none' | 'name' | 'value';
}
/** An object yet to be added: named `name`, or after its original if it is an image (A → A′), or the next free letter. */
export type Draft = Omit<GeoObject, 'id' | 'name'> & { name?: string; imageOf?: string };

export interface Pt { kind: 'point'; x: number; y: number }
/** Through (x1; y1) towards (x2; y2): a segment or vector between them, a ray from the first, or the whole line. */
export interface Line { kind: 'segment' | 'line' | 'ray' | 'vector'; x1: number; y1: number; x2: number; y2: number }
export interface Circle { kind: 'circle'; cx: number; cy: number; r: number }
/** Counter-clockwise from angle `from` by `sweep` radians; a sector also has the two radii. */
export interface Arc { kind: 'arc' | 'sector'; cx: number; cy: number; r: number; from: number; sweep: number }
export interface Polygon { kind: 'polygon'; pts: Pt[] }
/** Vertex (x; y), counter-clockwise from `from` by `sweep` radians. */
export interface Angle { kind: 'angle'; x: number; y: number; from: number; sweep: number }
/** A number shown at (x; y). */
export interface Measure { kind: 'measure'; x: number; y: number; value: number }
export type Shape = Pt | Line | Circle | Arc | Polygon | Angle | Measure;

export const isPoint = (s: Shape | null | undefined): s is Pt => s?.kind === 'point';
export const isLine = (s: Shape | null | undefined): s is Line => s?.kind === 'segment' || s?.kind === 'line' || s?.kind === 'ray' || s?.kind === 'vector';
export const isRound = (s: Shape | null | undefined): s is Circle | Arc => s?.kind === 'circle' || s?.kind === 'arc' || s?.kind === 'sector';
export const isCurve = (s: Shape | null | undefined): s is Line | Circle | Arc => isLine(s) || isRound(s);
export const isRegion = (s: Shape | null | undefined): s is Polygon | Circle | Arc => s?.kind === 'polygon' || s?.kind === 'circle' || s?.kind === 'sector';

const TAU = 2 * Math.PI;
const mod = (a: number) => (a % TAU + TAU) % TAU;
const pt = (x: number, y: number): Pt | null => Number.isFinite(x) && Number.isFinite(y) ? { kind: 'point', x, y } : null;

export function compute(objects: GeoObject[]): Map<number, Shape | null> {
  const out = new Map<number, Shape | null>();
  for (const o of objects) out.set(o.id, build(o, o.of.map(id => out.get(id) ?? null)));
  return out;
}

function build(o: GeoObject, a: (Shape | null)[]): Shape | null {
  if (a.some(s => !s)) return null;
  const [p, q, r] = a, value = o.value ?? NaN;
  switch (o.def) {
    case 'free': return pt(o.x ?? NaN, o.y ?? NaN);
    case 'on': return pointOn(p!, o.t ?? 0);
    case 'midpoint':
      if (isPoint(p) && isPoint(q)) return pt((p.x + q.x) / 2, (p.y + q.y) / 2);
      if (a.length === 1 && isLine(p)) return pt((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2);
      return a.length === 1 && isRound(p) ? pt(p.cx, p.cy) : null;
    case 'foot': {
      if (!isPoint(p) || !isLine(q)) return null;
      const dx = q.x2 - q.x1, dy = q.y2 - q.y1, t = ((p.x - q.x1) * dx + (p.y - q.y1) * dy) / (dx * dx + dy * dy);
      return pt(q.x1 + t * dx, q.y1 + t * dy);
    }
    case 'centroid': return isPoint(p) && isPoint(q) && isPoint(r) ? pt((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3) : null;
    case 'circumcenter': case 'orthocenter': {
      const c = isPoint(p) && isPoint(q) && isPoint(r) ? circumcircle(p, q, r) : null;
      if (!c) return null;
      const [A, B, C] = a as Pt[];
      // Euler: the orthocentre is A + B + C − 2·O.
      return o.def === 'circumcenter' ? pt(c.cx, c.cy) : pt(A.x + B.x + C.x - 2 * c.cx, A.y + B.y + C.y - 2 * c.cy);
    }
    case 'incenter': case 'incircle': {
      const t = isPoint(p) && isPoint(q) && isPoint(r) ? incircle(p, q, r) : null;
      return !t ? null : o.def === 'incenter' ? pt(t.cx, t.cy) : t;
    }
    case 'intersect': return intersections(p!, q!)[o.index ?? 0] ?? null;
    case 'offset': { const [dx, dy] = o.coef ?? [value, 0]; return isPoint(p) ? pt(p.x + dx, p.y + dy) : null; }
    case 'regular': {
      if (!isPoint(p) || !isPoint(q) || !(value >= 3)) return null;
      const sx = q.x - p.x, sy = q.y - p.y;
      let x = q.x, y = q.y;
      for (let i = 1; i < (o.index ?? 2); i++) { const t = i * TAU / value; x += sx * Math.cos(t) - sy * Math.sin(t); y += sx * Math.sin(t) + sy * Math.cos(t); }
      return pt(x, y);
    }
    case 'through':
    case 'edge':
      if (o.kind === 'polygon') return a.length >= 3 && a.every(isPoint) ? { kind: 'polygon', pts: a as Pt[] } : null;
      if (!isPoint(p) || !isPoint(q)) return null;
      if (o.kind === 'circle') return { kind: 'circle', cx: p.x, cy: p.y, r: Math.hypot(q.x - p.x, q.y - p.y) };
      if (o.kind === 'angle') return isPoint(r) ? angle(p, q, r, false) : null;
      if (!isLine({ kind: o.kind } as Shape)) return null;
      return p.x === q.x && p.y === q.y ? null : { kind: o.kind as Line['kind'], x1: p.x, y1: p.y, x2: q.x, y2: q.y };
    case 'perpendicular':
    case 'parallel': {
      if (!isPoint(p) || !isLine(q)) return null;
      const dx = q.x2 - q.x1, dy = q.y2 - q.y1, [ux, uy] = o.def === 'parallel' ? [dx, dy] : [-dy, dx];
      return { kind: 'line', x1: p.x, y1: p.y, x2: p.x + ux, y2: p.y + uy };
    }
    case 'bisector': {
      // Of two points, or of a segment's ends.
      const [u, w] = isPoint(p) && isPoint(q) ? [p, q] : a.length === 1 && isLine(p) ? [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }] : [];
      if (!u || !w || (u.x === w.x && u.y === w.y)) return null;
      const mx = (u.x + w.x) / 2, my = (u.y + w.y) / 2;
      return { kind: 'line', x1: mx, y1: my, x2: mx - (w.y - u.y), y2: my + (w.x - u.x) };
    }
    case 'angleBisector': {
      if (!isPoint(p) || !isPoint(q) || !isPoint(r)) return null;
      const u = unit(p.x - q.x, p.y - q.y), v = unit(r.x - q.x, r.y - q.y);
      if (!u || !v) return null;
      let dx = u[0] + v[0], dy = u[1] + v[1];
      if (Math.hypot(dx, dy) < 1e-12) [dx, dy] = [-u[1], u[0]]; // a straight angle: the perpendicular
      return { kind: 'line', x1: q.x, y1: q.y, x2: q.x + dx, y2: q.y + dy };
    }
    case 'tangent': {
      if (!isPoint(p) || q?.kind !== 'circle') return null;
      const dx = p.x - q.cx, dy = p.y - q.cy, d = Math.hypot(dx, dy);
      if (!q.r || d < q.r * (1 - 1e-12)) return null; // inside: no tangent
      const t = Math.atan2(dy, dx) + (o.index ? -1 : 1) * Math.acos(Math.min(1, q.r / d));
      const tx = q.cx + q.r * Math.cos(t), ty = q.cy + q.r * Math.sin(t);
      // P on the circle touches it itself: the tangent is perpendicular to the radius there.
      if (Math.hypot(tx - p.x, ty - p.y) <= 1e-9 * q.r) return { kind: 'line', x1: p.x, y1: p.y, x2: p.x - dy, y2: p.y + dx };
      return { kind: 'line', x1: p.x, y1: p.y, x2: tx, y2: ty };
    }
    case 'slope': return isPoint(p) && Number.isFinite(value) ? { kind: 'line', x1: p.x, y1: p.y, x2: p.x + 1, y2: p.y + value } : null;
    case 'equation': {
      const [k, l, m] = o.coef ?? [];
      if (![k, l, m].every(Number.isFinite)) return null;
      if (o.kind === 'circle') return m >= 0 ? { kind: 'circle', cx: k, cy: l, r: m } : null;
      const n = k * k + l * l;
      // The point nearest the origin, then along the line.
      return n ? { kind: 'line', x1: -k * m / n, y1: -l * m / n, x2: -k * m / n - l, y2: -l * m / n + k } : null;
    }
    case 'three': return isPoint(p) && isPoint(q) && isPoint(r) ? circumcircle(p, q, r) : null;
    case 'radiusSegment': return isPoint(p) && isLine(q) ? { kind: 'circle', cx: p.x, cy: p.y, r: Math.hypot(q.x2 - q.x1, q.y2 - q.y1) } : null;
    case 'radius': return isPoint(p) && value >= 0 ? { kind: 'circle', cx: p.x, cy: p.y, r: value } : null;
    case 'compass': return isPoint(p) && isPoint(q) && isPoint(r) ? { kind: 'circle', cx: r.x, cy: r.y, r: Math.hypot(q.x - p.x, q.y - p.y) } : null;
    case 'semicircle': {
      if (!isPoint(p) || !isPoint(q) || (p.x === q.x && p.y === q.y)) return null;
      const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
      return { kind: 'arc', cx, cy, r: Math.hypot(q.x - cx, q.y - cy), from: Math.atan2(q.y - cy, q.x - cx), sweep: Math.PI };
    }
    case 'arc': {
      if (!isPoint(p) || !isPoint(q) || !isPoint(r) || (q.x === p.x && q.y === p.y) || (r.x === p.x && r.y === p.y)) return null;
      const from = Math.atan2(q.y - p.y, q.x - p.x);
      return { kind: o.kind === 'sector' ? 'sector' : 'arc', cx: p.x, cy: p.y, r: Math.hypot(q.x - p.x, q.y - p.y), from, sweep: mod(Math.atan2(r.y - p.y, r.x - p.x) - from) || TAU };
    }
    case 'oriented': return isPoint(p) && isPoint(q) && isPoint(r) ? angle(p, q, r, true) : null;
    case 'distance': {
      if (a.length === 1) return isLine(p) ? measure((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2, Math.hypot(p.x2 - p.x1, p.y2 - p.y1)) : null;
      if (!isPoint(p)) return null;
      const near = isPoint(q) ? q : isLine(q) ? pointOn(q, project(q, p.x, p.y)) : null;
      return near && measure((p.x + near.x) / 2, (p.y + near.y) / 2, Math.hypot(p.x - near.x, p.y - near.y));
    }
    case 'area': {
      if (p?.kind === 'polygon') return measure(p.pts.reduce((s, v) => s + v.x, 0) / p.pts.length, p.pts.reduce((s, v) => s + v.y, 0) / p.pts.length, Math.abs(area(p.pts)));
      if (p?.kind === 'circle') return measure(p.cx, p.cy, Math.PI * p.r * p.r);
      if (p?.kind === 'sector') { const m = p.from + p.sweep / 2; return measure(p.cx + p.r / 2 * Math.cos(m), p.cy + p.r / 2 * Math.sin(m), p.r * p.r * p.sweep / 2); }
      return null;
    }
    case 'reflect':
      if (isPoint(q)) return transform(p!, [-1, 0, 0, -1, 2 * q.x, 2 * q.y]);
      if (isLine(q)) {
        const u = unit(q.x2 - q.x1, q.y2 - q.y1)!, c = u[0] * u[0] - u[1] * u[1], s = 2 * u[0] * u[1];
        return transform(p!, around([c, s, s, -c], q.x1, q.y1));
      }
      return null;
    case 'rotate': return isPoint(q) && Number.isFinite(value) ? transform(p!, around([Math.cos(value), -Math.sin(value), Math.sin(value), Math.cos(value)], q.x, q.y)) : null;
    case 'dilate': return isPoint(q) && Number.isFinite(value) && value !== 0 ? transform(p!, around([value, 0, 0, value], q.x, q.y)) : null;
    case 'translate': return q?.kind === 'vector' ? transform(p!, [1, 0, 0, 1, q.x2 - q.x1, q.y2 - q.y1]) : null;
  }
  return null;
}

const unit = (x: number, y: number): [number, number] | null => { const d = Math.hypot(x, y); return d ? [x / d, y / d] : null; };
const measure = (x: number, y: number, value: number): Measure | null => pt(x, y) && Number.isFinite(value) ? { kind: 'measure', x, y, value } : null;

function angle(a: Pt, v: Pt, c: Pt, oriented: boolean): Angle | null {
  if ((a.x === v.x && a.y === v.y) || (c.x === v.x && c.y === v.y)) return null;
  const t1 = Math.atan2(a.y - v.y, a.x - v.x), t2 = Math.atan2(c.y - v.y, c.x - v.x), sweep = mod(t2 - t1);
  // Unless oriented, the angle up to 180°, whichever side the points were picked from.
  return oriented || sweep <= Math.PI ? { kind: 'angle', x: v.x, y: v.y, from: t1, sweep } : { kind: 'angle', x: v.x, y: v.y, from: t2, sweep: TAU - sweep };
}

/** Centre weighted by the opposite sides; radius = 2·area / perimeter. */
function incircle(a: Pt, b: Pt, c: Pt): Circle | null {
  const la = Math.hypot(b.x - c.x, b.y - c.y), lb = Math.hypot(a.x - c.x, a.y - c.y), lc = Math.hypot(a.x - b.x, a.y - b.y), sum = la + lb + lc;
  const r = Math.abs(area([a, b, c])) * 2 / sum;
  if (!(r > 1e-12 * sum)) return null; // collinear
  return { kind: 'circle', cx: (la * a.x + lb * b.x + lc * c.x) / sum, cy: (la * a.y + lb * b.y + lc * c.y) / sum, r };
}

function circumcircle(a: Pt, b: Pt, c: Pt): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y), Math.abs(b.x - c.x), Math.abs(b.y - c.y)) ** 2;
  if (Math.abs(d) <= 1e-12 * scale) return null; // collinear
  const sa = a.x ** 2 + a.y ** 2, sb = b.x ** 2 + b.y ** 2, sc = c.x ** 2 + c.y ** 2;
  const cx = (sa * (b.y - c.y) + sb * (c.y - a.y) + sc * (a.y - b.y)) / d;
  const cy = (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d;
  return { kind: 'circle', cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

// --- Transformations: similarities (x; y) → (a·x + b·y + e; c·x + d·y + f) ---

type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];
/** The linear map [a b; c d] about the fixed point (x; y). */
const around = ([a, b, c, d]: number[], x: number, y: number): Affine => [a, b, c, d, x - a * x - b * y, y - c * x - d * y];

export function transform(s: Shape, [a, b, c, d, e, f]: Affine): Shape | null {
  const map = (x: number, y: number) => [a * x + b * y + e, c * x + d * y + f], det = a * d - b * c, k = Math.sqrt(Math.abs(det));
  /** A ray from (x; y) at angle t, mapped: its new start and angle. Mirroring reverses the sense of turning. */
  const turned = (x: number, y: number, from: number, sweep: number) => {
    const [X, Y] = map(x, y), end = (t: number) => { const [u, v] = map(x + Math.cos(t), y + Math.sin(t)); return Math.atan2(v - Y, u - X); };
    return { X, Y, from: end(det < 0 ? from + sweep : from) };
  };
  switch (s.kind) {
    case 'point': { const [x, y] = map(s.x, s.y); return pt(x, y); }
    case 'segment': case 'line': case 'ray': case 'vector': {
      const [x1, y1] = map(s.x1, s.y1), [x2, y2] = map(s.x2, s.y2);
      return { kind: s.kind, x1, y1, x2, y2 };
    }
    case 'circle': { const [cx, cy] = map(s.cx, s.cy); return { kind: 'circle', cx, cy, r: s.r * k }; }
    case 'arc': case 'sector': { const t = turned(s.cx, s.cy, s.from, s.sweep); return { ...s, cx: t.X, cy: t.Y, r: s.r * k, from: t.from }; }
    case 'angle': { const t = turned(s.x, s.y, s.from, s.sweep); return { ...s, x: t.X, y: t.Y, from: t.from }; }
    case 'polygon': return { kind: 'polygon', pts: s.pts.map(p => { const [x, y] = map(p.x, p.y); return { kind: 'point', x, y } as Pt; }) };
    case 'measure': return null;
  }
}

/** Whether parameter t (0 at the first point, 1 at the second) lies on the line-like. */
const within = (l: Line, t: number) => l.kind === 'line' || (t >= -1e-9 && (l.kind === 'ray' || t <= 1 + 1e-9));
const clampT = (l: Line, t: number) => l.kind === 'line' ? t : l.kind === 'ray' ? Math.max(0, t) : Math.min(1, Math.max(0, t));
/** The angle on the arc nearest angle t. */
function clampArc(s: Circle | Arc, t: number): number {
  if (s.kind === 'circle') return t;
  const off = mod(t - s.from);
  return off <= s.sweep ? s.from + off : off - s.sweep < TAU - off ? s.from + s.sweep : s.from;
}
const onArc = (s: Circle | Arc, p: Pt | null) => !!p && (s.kind === 'circle' || mod(Math.atan2(p.y - s.cy, p.x - s.cx) - s.from) <= s.sweep + 1e-9);

/** The point at parameter t: along a line-like (0 → first point, 1 → second), or the angle on a circle or arc. */
export function pointOn(s: Shape, t: number): Pt | null {
  if (isLine(s)) { const u = clampT(s, t); return pt(s.x1 + u * (s.x2 - s.x1), s.y1 + u * (s.y2 - s.y1)); }
  if (isRound(s)) { const u = clampArc(s, t); return pt(s.cx + s.r * Math.cos(u), s.cy + s.r * Math.sin(u)); }
  return null;
}

/** Parameter of the point on the line-like, circle or arc nearest (x; y). */
export function project(s: Line | Circle | Arc, x: number, y: number): number {
  if (isRound(s)) return clampArc(s, Math.atan2(y - s.cy, x - s.cx));
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  return clampT(s, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy));
}

/**
 * All intersections of two curves, by a stable index: an index keeps following the same point while the
 * construction moves, and is null while that point doesn't exist (off a segment or arc, circles apart).
 */
export function intersections(a: Shape, b: Shape): (Pt | null)[] {
  if (isRound(a) && isLine(b)) return intersections(b, a);
  if (isRound(a) && a.kind !== 'circle') return intersections({ ...a, kind: 'circle' }, b).map(p => onArc(a, p) ? p : null);
  if (isRound(b) && b.kind !== 'circle') return intersections(a, { ...b, kind: 'circle' }).map(p => onArc(b, p) ? p : null);
  if (isLine(a) && isLine(b)) {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, ex = b.x2 - b.x1, ey = b.y2 - b.y1, cross = dx * ey - dy * ex;
    if (Math.abs(cross) <= 1e-12 * Math.hypot(dx, dy) * Math.hypot(ex, ey)) return [];
    const wx = b.x1 - a.x1, wy = b.y1 - a.y1, t = (wx * ey - wy * ex) / cross, u = (wx * dy - wy * dx) / cross;
    return [within(a, t) && within(b, u) ? pt(a.x1 + t * dx, a.y1 + t * dy) : null];
  }
  if (isLine(a) && b.kind === 'circle') {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, fx = a.x1 - b.cx, fy = a.y1 - b.cy;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - b.r * b.r, disc = B * B - 4 * A * C;
    if (disc < -1e-12 * B * B) return [];
    const s = Math.sqrt(Math.max(0, disc));
    return [(-B - s) / (2 * A), (-B + s) / (2 * A)].map(t => within(a, t) ? pt(a.x1 + t * dx, a.y1 + t * dy) : null);
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy), tol = 1e-12 * (a.r + b.r);
    if (!d || d > a.r + b.r + tol || d < Math.abs(a.r - b.r) - tol) return [];
    const m = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - m * m));
    const mx = a.cx + m * dx / d, my = a.cy + m * dy / d;
    return [pt(mx - h * dy / d, my + h * dx / d), pt(mx + h * dy / d, my - h * dx / d)];
  }
  return [];
}

const segmentDistance = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) =>
  x1 === x2 && y1 === y2 ? Math.hypot(x - x1, y - y1) : distanceTo({ kind: 'segment', x1, y1, x2, y2 }, x, y);

/** Distance from (x; y) to the shape; 0 inside a polygon or sector. Angles and measures have a size in px: not here. */
export function distanceTo(s: Shape, x: number, y: number): number {
  if (s.kind === 'point') return Math.hypot(x - s.x, y - s.y);
  if (isLine(s)) { const p = pointOn(s, project(s, x, y))!; return Math.hypot(x - p.x, y - p.y); }
  if (s.kind === 'circle') return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r);
  if (s.kind === 'arc' || s.kind === 'sector') {
    const p = pointOn(s, project(s, x, y))!, rim = Math.hypot(x - p.x, y - p.y);
    if (s.kind === 'arc') return rim;
    if (Math.hypot(x - s.cx, y - s.cy) <= s.r && onArc(s, { kind: 'point', x, y })) return 0;
    const end = (t: number) => segmentDistance(s.cx, s.cy, s.cx + s.r * Math.cos(t), s.cy + s.r * Math.sin(t), x, y);
    return Math.min(rim, end(s.from), end(s.from + s.sweep));
  }
  if (s.kind === 'polygon') {
    let inside = false, best = Infinity;
    s.pts.forEach((p, i) => {
      const q = s.pts[(i + 1) % s.pts.length];
      if ((p.y > y) !== (q.y > y) && x < p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y)) inside = !inside;
      best = Math.min(best, segmentDistance(p.x, p.y, q.x, q.y, x, y));
    });
    return inside ? 0 : best;
  }
  return Infinity;
}

/** The object, everything built on it, and so on: what goes when it is deleted. */
export function dependents(objects: GeoObject[], id: number): Set<number> {
  const gone = new Set([id]);
  for (const o of objects) if (o.of.some(d => gone.has(d))) gone.add(o.id);
  return gone;
}

/** Every object after the objects it is built from, otherwise in the given order (after a redefinition). */
export function topoSort(objects: GeoObject[]): GeoObject[] {
  const byId = new Map(objects.map(o => [o.id, o])), done = new Set<number>(), out: GeoObject[] = [];
  const visit = (o: GeoObject) => {
    if (done.has(o.id)) return;
    done.add(o.id);
    for (const id of o.of) { const d = byId.get(id); if (d) visit(d); }
    out.push(o);
  };
  objects.forEach(visit);
  return out;
}

/** Free points the object is built from (itself, if it is one): what moves when it is dragged. */
export function freeAncestors(objects: GeoObject[], id: number): GeoObject[] {
  const byId = new Map(objects.map(o => [o.id, o])), seen = new Set<number>(), out: GeoObject[] = [];
  const walk = (i: number) => {
    const o = byId.get(i);
    if (!o || seen.has(i)) return;
    seen.add(i);
    if (o.def === 'free') out.push(o); else o.of.forEach(walk);
  };
  walk(id);
  return out;
}

// --- Names, as in school: points A, B, C…; lines f, g, h…; circles c, d, e…; vectors u, v…; angles α, β… ---

const LINES = [...'fghijmnprs'], ROUND = [...'cdekq'];
const LETTERS: Record<Kind, string[]> = {
  point: [...'ABCDEFGHIJKLMNOPQRSTUVWZ'],
  segment: LINES, line: LINES, ray: LINES, vector: [...'uvwabz'],
  circle: ROUND, arc: ROUND, sector: ROUND,
  polygon: ['t'],
  angle: [...'αβγδεζηθκλμ'],
  measure: ['m'],
};
const sub = (n: number) => String(n).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[+d]);

export function nextName(kind: Kind, taken: Set<string>): string {
  for (let n = kind === 'polygon' || kind === 'measure' ? 1 : 0; ; n++) {
    for (const l of LETTERS[kind]) { const name = n ? l + sub(n) : l; if (!taken.has(name)) return name; }
  }
}

/** The image of A is A′, then A″, A‴… */
export function primed(name: string, taken: Set<string>): string {
  let n = name;
  do n += '′'; while (taken.has(n));
  return n.replace(/′′′$/, '‴').replace(/′′$/, '″');
}

// --- Descriptions for the object list ---

const minus = (s: string) => s.replace(/^-/, '−');
const num = (v: number) => minus(format(v, 4));
const deg = (rad: number) => `${num(rad * 180 / Math.PI)}°`;
/** (x − 2)², (x + 1)², x² */
const shifted = (v: string, c: number) => Math.abs(c) < 1e-9 ? `${v}²` : `(${v} ${c > 0 ? '−' : '+'} ${format(Math.abs(c), 4)})²`;
/** Point names run together (ABC); anything else is listed (E, g). */
const names = (a: string[]) => a.every(n => /^[A-Z]/.test(n)) ? a.join('') : a.join(', ');

function lineEquation(l: Line): string {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  if (Math.abs(dx) <= 1e-12 * Math.abs(dy)) return `x = ${num(l.x1)}`;
  const m = dy / dx, b = l.y1 - m * l.x1, flat = Math.abs(m) < 1e-9;
  const mx = flat ? '' : Math.abs(m - 1) < 1e-9 ? 'x' : Math.abs(m + 1) < 1e-9 ? '−x' : `${num(m)}x`;
  if (!mx) return `y = ${num(b)}`;
  return Math.abs(b) < 1e-9 ? `y = ${mx}` : `y = ${mx} ${b > 0 ? '+' : '−'} ${format(Math.abs(b), 4)}`;
}

const KIND: Record<Kind, string> = {
  point: 'punkt', segment: 'odcinek', line: 'prosta', ray: 'półprosta', vector: 'wektor', circle: 'okrąg', arc: 'łuk', sector: 'wycinek',
  polygon: 'wielokąt', angle: 'kąt', measure: 'pomiar',
};
const DETAIL: Record<Def, (a: string[], o: GeoObject) => string> = {
  free: () => 'punkt swobodny',
  on: a => `punkt na ${a[0]}`,
  midpoint: a => a.length === 1 ? `środek ${a[0]}` : `środek ${names(a)}`,
  foot: a => `rzut ${a[0]} na ${a[1]}`,
  centroid: a => `środek ciężkości trójkąta ${names(a)}`,
  orthocenter: a => `ortocentrum trójkąta ${names(a)}`,
  incenter: a => `środek okręgu wpisanego w ${names(a)}`,
  circumcenter: a => `środek okręgu opisanego na ${names(a)}`,
  slope: (a, o) => `prosta przez ${a[0]} o nachyleniu ${num(o.value ?? NaN)}`,
  equation: (_, o) => `${KIND[o.kind]} z równania`,
  radiusSegment: a => `okrąg o środku ${a[0]}, r = |${a[1]}|`,
  incircle: a => `okrąg wpisany w trójkąt ${names(a)}`,
  intersect: a => `przecięcie ${a.join(', ')}`,
  offset: (a, o) => { const [dx, dy] = o.coef ?? [o.value ?? NaN, 0]; return `${a[0]} przesunięty o [${num(dx)}; ${num(dy)}]`; },
  regular: (a, o) => `wierzchołek ${o.value}-kąta foremnego ${names(a)}`,
  through: (a, o) => o.kind === 'circle' ? `okrąg o środku ${a[0]} przez ${a[1]}` : `${KIND[o.kind]} ${names(a)}`,
  edge: a => `bok ${names(a.slice(0, 2))}`,
  perpendicular: a => `prostopadła do ${a[1]} przez ${a[0]}`,
  parallel: a => `równoległa do ${a[1]} przez ${a[0]}`,
  bisector: a => a.length === 1 ? `symetralna ${a[0]}` : `symetralna ${names(a)}`,
  angleBisector: a => `dwusieczna kąta ${names(a)}`,
  tangent: a => `styczna z ${a[0]} do ${a[1]}`,
  three: a => `okrąg przez ${names(a)}`,
  radius: (a, o) => `okrąg o środku ${a[0]}, r = ${num(o.value ?? NaN)}`,
  compass: a => `okrąg o środku ${a[2]}, r = |${names(a.slice(0, 2))}|`,
  semicircle: a => `półokrąg ${names(a)}`,
  arc: (a, o) => `${KIND[o.kind]} o środku ${a[0]} od ${a[1]} do ${a[2]}`,
  oriented: a => `kąt ${names(a)}`,
  distance: a => a.length === 1 ? `długość ${a[0]}` : `odległość ${a.join(', ')}`,
  area: a => `pole ${a[0]}`,
  reflect: a => `odbicie ${a[0]} względem ${a[1]}`,
  rotate: (a, o) => `obrót ${a[0]} wokół ${a[1]} o ${deg(o.value ?? NaN)}`,
  translate: a => `przesunięcie ${a[0]} o ${a[1]}`,
  dilate: (a, o) => `jednokładność ${a[0]}, środek ${a[1]}, k = ${num(o.value ?? NaN)}`,
};

/** Main line ("A = (1; 2)", "f: y = 2x + 1", "α = 45°") and what it is built from ("odcinek AB"). */
export function describe(o: GeoObject, s: Shape | null, nameOf: (id: number) => string): { text: string; detail: string } {
  const args = o.of.map(nameOf), detail = DETAIL[o.def]?.(args, o) ?? KIND[o.kind];
  if (!s) return { text: `${o.name} — nie istnieje`, detail };
  switch (s.kind) {
    case 'point': return { text: `${o.name} = (${num(s.x)}; ${num(s.y)})`, detail };
    case 'segment': return { text: `${o.name} = ${num(Math.hypot(s.x2 - s.x1, s.y2 - s.y1))}`, detail };
    case 'vector': return { text: `${o.name} = [${num(s.x2 - s.x1)}; ${num(s.y2 - s.y1)}]`, detail };
    case 'line': case 'ray': return { text: `${o.name}: ${lineEquation(s)}`, detail };
    case 'circle': return { text: `${o.name}: ${shifted('x', s.cx)} + ${shifted('y', s.cy)} = ${num(s.r * s.r)}`, detail };
    case 'arc': return { text: `${o.name} = ${num(s.r * s.sweep)}`, detail: `${detail}, długość` };
    case 'sector': return { text: `${o.name} = ${num(s.r * s.r * s.sweep / 2)}`, detail: `${detail}, pole` };
    case 'polygon': return { text: `${o.name} = ${num(Math.abs(area(s.pts)))}`, detail: `${detail}, pole` };
    case 'angle': return { text: `${o.name} = ${deg(s.sweep)}`, detail };
    case 'measure': {
      const label = o.def === 'area' ? `P(${args[0]})` : args.length === 1 ? `|${args[0]}|` : args.every(n => /^[A-Z]/.test(n)) ? `|${names(args)}|` : `d(${args.join(', ')})`;
      return { text: `${label} = ${num(s.value)}`, detail };
    }
  }
}

export const area = (pts: Pt[]) => pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
