/** Sets of complex numbers: conditions on z filled and outlined, numbers with unknowns traced as curves or regions. */
import type { Complex } from '../math';
import type { ConditionSet, ParametricSet } from '../model';
import type { FnState } from '../state';
import { dashPattern, dot, type Theme } from './plot2d';
import type { Viewport } from './viewport';

/** What a condition's drawing found, for the analysis text. */
export interface SetFound {
  all: boolean;
  inside: number;
  valid: number;
  lines: number;
  /** A condition that holds at a single point (|z − 1| ≤ 0): the point, snapped to a round value. */
  single: { z: Complex; sure: boolean } | null;
}

/** Points computed by the analysis worker: an equation's isolated solutions and the points ≠ excludes. */
export interface SetPoints { solutions: { z: Complex; sure: boolean }[]; excluded: Complex[] }

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const STRICT_DASH = (w: number) => [2.5 * w + 2, 2 * w + 2];

/**
 * Lines where a grid of values (nodes every s px, w × h) crosses 0, by marching squares, joined into polylines in px.
 * A sign change that isn't a zero (arg z jumping from π to −π) is dropped: the value at the crossing isn't near 0.
 */
function contour(v: Float64Array, w: number, h: number, s: number, value: (x: number, y: number) => number): [number, number][][] {
  const points = new Map<number, [number, number] | null>(), segments: [number, number][] = [];
  const cross = (id: number, k0: number, k1: number, x0: number, y0: number, x1: number, y1: number) => {
    if (points.has(id)) return points.get(id)!;
    const a = v[k0], b = v[k1];
    let p: [number, number] | null = null;
    if (Number.isFinite(a) && Number.isFinite(b) && (a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      p = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      if (!(Math.abs(value(...p)) <= 0.1 * Math.abs(a - b))) p = null;
    }
    points.set(id, p);
    return p;
  };
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const k = j * w + i, x = i * s, y = j * s, pos = v[k] >= 0;
    // Almost every cell has all four corners on one side (NaN counts as below): no edge crosses it.
    if ((v[k + 1] >= 0) === pos && (v[k + w] >= 0) === pos && (v[k + w + 1] >= 0) === pos) continue;
    const edges = ([
      [2 * k, k, k + 1, x, y, x + s, y],
      [2 * (k + 1) + 1, k + 1, k + w + 1, x + s, y, x + s, y + s],
      [2 * (k + w), k + w, k + w + 1, x, y + s, x + s, y + s],
      [2 * k + 1, k, k + w, x, y, x, y + s],
    ] as const).filter(e => cross(...e)).map(e => e[0]);
    if (edges.length === 2) segments.push([edges[0], edges[1]]);
    else if (edges.length === 4) { // saddle: the centre decides which corners are joined
      const centre = (v[k] + v[k + 1] + v[k + w] + v[k + w + 1]) / 4;
      if ((centre >= 0) === (v[k] >= 0)) segments.push([edges[0], edges[1]], [edges[2], edges[3]]);
      else segments.push([edges[0], edges[3]], [edges[1], edges[2]]);
    }
  }
  const ends = new Map<number, number[]>(), used = new Uint8Array(segments.length), lines: [number, number][][] = [];
  segments.forEach((seg, n) => { for (const e of seg) { if (!ends.has(e)) ends.set(e, []); ends.get(e)!.push(n); } });
  for (let n = 0; n < segments.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const halves = [[segments[n][1]], [segments[n][0]]];
    for (const half of halves) for (;;) {
      const tip = half[half.length - 1], next = ends.get(tip)!.find(m => !used[m]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segments[next];
      half.push(a === tip ? b : a);
    }
    lines.push([...halves[1].reverse(), ...halves[0]].map(e => points.get(e)!));
  }
  return lines;
}

/** Keeps the stretches of `lines` where `other` is 0 too (z² = |z|²: neither part is 0 everywhere). */
const bothZero = (lines: [number, number][][], other: (x: number, y: number) => number, tol: number) => lines.flatMap(line => {
  const runs: [number, number][][] = [[]];
  for (const p of line) {
    if (Math.abs(other(...p)) <= tol) runs[runs.length - 1].push(p);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter(r => r.length > 1);
});

/**
 * A condition on z, evaluated on a grid of nodes every s px. Each inequality gives a margin (> 0 where it holds):
 * inside = the smallest margin > 0, filled translucent. Its edge and an equation's curve are traced and stroked
 * like a graph: solid for ≤ ≥ =, dashed for < > ≠.
 */
export function paintCondition(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, f: FnState, set: ConditionSet, points: SetPoints | undefined, coarse: boolean): SetFound {
  const s = coarse ? 4 : 2, w = Math.ceil(vp.width / s) + 1, h = Math.ceil(vp.height / s) + 1, n = w * h, { sides, ops } = set;
  const real = ([a, b]: Complex) => Math.abs(b) <= 1e-9 * (1 + Math.abs(a)); // complex numbers aren't ordered: < needs real sides
  // m: smallest inequality margin (Infinity without inequalities); c: the same, but signed for ≠ between reals
  // (|z| ≠ 3 is 0 on the circle and > 0 on both sides, so its edge can only be traced from |z| − 3);
  // strict: whether that one is < > ≠; eq: left − right of the first equation; rest: how far the other equations
  // of a chain (x = y = 1) are from holding.
  const judgeZ = (z: Complex) => {
    const v = sides.map(g => g(z));
    let m = Infinity, c = Infinity, strict = false, eq = null as Complex | null, rest = 0;
    ops.forEach((op, o) => {
      const a = v[o], b = v[o + 1];
      if (op === '=') {
        if (eq) rest = Math.max(rest, Math.hypot(a[0] - b[0], a[1] - b[1]));
        else eq = [a[0] - b[0], a[1] - b[1]];
        return;
      }
      const d = op === '≠' ? Math.hypot(a[0] - b[0], a[1] - b[1]) : !real(a) || !real(b) ? NaN : op === '<' || op === '≤' ? b[0] - a[0] : a[0] - b[0];
      if (Number.isNaN(d) || Number.isNaN(m)) m = c = NaN;
      else if (d < m) { m = d; c = op === '≠' && real(a) && real(b) ? a[0] - b[0] : d; strict = op === '<' || op === '>' || op === '≠'; }
    });
    return { m, c, strict, eq, rest };
  };
  const judge = (x: number, y: number) => judgeZ([vp.fromX(x), vp.fromY(y)]);
  const margin = new Float64Array(n), edge = new Float64Array(n), eqRe = new Float64Array(n), eqIm = new Float64Array(n), rest = new Float64Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, r = judge(i * s, j * s);
    margin[k] = r.m; edge[k] = r.c; rest[k] = r.rest;
    if (r.eq) [eqRe[k], eqIm[k]] = r.eq; else eqRe[k] = eqIm[k] = NaN;
  }
  const top = (a: Float64Array) => { let m = 0; for (const v of a) if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v); return m; };
  const equation = ops.includes('='), re = top(eqRe), im = top(eqIm), all = equation && re === 0 && im === 0 && eqRe.some(Number.isFinite); // z = z
  // An equation chained with more (x = y = 1, 0 ≤ x = y): its curve only where the rest holds too.
  const chained = equation && ops.some((op, k) => op !== '=' || k !== ops.indexOf('=')), restTol = 1e-6 * top(rest);
  const holds = (r: ReturnType<typeof judgeZ>) => r.rest <= restTol && (r.m === Infinity || r.m >= -1e-9);

  // Fill, one pixel per node, centred on it.
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const c = off.getContext('2d')!, img = c.createImageData(w, h), d = img.data, [r, g, b] = rgb(f.color);
  let inside = 0, valid = 0;
  for (let k = 0; k < n; k++) {
    const yes = all ? Number.isFinite(eqRe[k]) && rest[k] <= restTol && margin[k] > 0 : !equation && margin[k] > 0;
    if (yes) { d[4 * k] = r; d[4 * k + 1] = g; d[4 * k + 2] = b; d[4 * k + 3] = 70; inside++; }
    if (all ? Number.isFinite(eqRe[k]) : Number.isFinite(margin[k])) valid++;
  }
  c.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, -s / 2, -s / 2, w * s, h * s);

  ctx.save();
  ctx.lineJoin = 'round';
  const stroke = (lines: [number, number][][], strict: (line: [number, number][]) => boolean) => {
    for (const line of lines) {
      const dashed = strict(line);
      ctx.lineWidth = f.width; ctx.strokeStyle = f.color;
      ctx.setLineDash(dashed ? STRICT_DASH(f.width) : dashPattern(f.dash, f.width));
      ctx.lineCap = dashed ? 'butt' : 'round';
      ctx.beginPath(); ctx.moveTo(...line[0]);
      for (const p of line.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  // A value that only touches 0 instead of crossing it (|z − 1| + |z + 1| − 2 on [−1; 1], |z − 6i|, Re(z)²): no line
  // to trace. Draw the nodes where |value| is within ¾ node of 0 by its steepest slope, as a thick line (translucent
  // if it doesn't belong to the set). A few nodes together are one point: a dot, snapped to a rounder z.
  let single: SetFound['single'] = null, thickCurve = false;
  const touching = (a: Float64Array, strict: boolean, value: (z: Complex) => Complex) => {
    const at = (i: number, j: number) => Math.abs(a[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]), hit: [number, number][] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = at(i, j);
      const slope = Math.max(0, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => Math.abs(at(i + di, j + dj) - v)).filter(Number.isFinite));
      if (Number.isFinite(v) && v < 0.75 * slope) hit.push([i * s, j * s]);
    }
    if (!hit.length) return null;
    if (hit.length > 12) {
      ctx.fillStyle = f.color; ctx.globalAlpha = strict ? 0.45 : 1;
      ctx.beginPath();
      for (const [x, y] of hit) { ctx.moveTo(x + f.width / 2, y); ctx.arc(x, y, f.width / 2, 0, 2 * Math.PI); }
      ctx.fill(); ctx.globalAlpha = 1;
      thickCurve = true;
      return null;
    }
    let z: Complex = [vp.fromX(hit.reduce((t, p) => t + p[0], 0) / hit.length), vp.fromY(hit.reduce((t, p) => t + p[1], 0) / hit.length)];
    const size = (q: Complex) => Math.hypot(...value(q)), cell = s / vp.scale;
    for (const k of [0, 1] as const) {
      const v = z[k], at2 = (c: number): Complex => k ? [z[0], c] : [c, z[1]];
      const c = [1, 2, 3, 4, 6, 8, 12, 100].map(d => Math.round(v * d) / d).find(c => Math.abs(c - v) <= cell && size(at2(c)) <= size(z));
      if (c !== undefined) z = at2(c);
    }
    dot(ctx, vp, z[0], z[1], 4.5, strict ? theme.bg : f.color, strict ? f.color : theme.bg);
    return { z, sure: size(z) === 0 };
  };

  let lines: [number, number][][] = [];
  if (equation && !all) {
    // left − right is a real curve when one of its parts is 0 everywhere (|z + i| − 3 is real, z̄ − z imaginary).
    const part = im <= 1e-9 * re ? 0 : re <= 1e-9 * im ? 1 : -1, at = (k: 0 | 1) => (x: number, y: number) => judge(x, y).eq![k];
    if (part >= 0) lines = contour(part ? eqIm : eqRe, w, h, s, at(part as 0 | 1));
    else lines = [...bothZero(contour(eqRe, w, h, s, at(0)), at(1), 1e-6 * im), ...bothZero(contour(eqIm, w, h, s, at(1)), at(0), 1e-6 * re)];
    if (chained) lines = bothZero(lines, (x, y) => holds(judge(x, y)) ? 0 : 1, 0.5);
    const solutions = (part < 0 ? points?.solutions ?? [] : []).filter(({ z }) => !chained || holds(judgeZ(z)));
    for (const { z } of solutions) dot(ctx, vp, z[0], z[1], 4.5, f.color, theme.bg);
    if (!lines.length && !solutions.length) {
      const size = Float64Array.from(eqRe, (v, k) => margin[k] === Infinity || margin[k] >= -1e-9 ? Math.hypot(v, eqIm[k], rest[k]) : NaN);
      single = touching(size, false, z => { const r = judgeZ(z); return [Math.hypot(...r.eq!), r.rest]; });
    }
    else stroke(lines, () => false);
  } else if (!equation) {
    lines = contour(edge, w, h, s, (x, y) => judge(x, y).c);
    if (lines.length) stroke(lines, line => judge(...line[line.length >> 1]).strict);
    else {
      // Only where it means something: a curve cut out of a region (Re(z)² > 0) or the whole set (|z − 1| ≤ 0),
      // not |z| ≥ 0 (the whole plane) or |z| < 0 (empty).
      const strict = ops.every(o => o === '<' || o === '>' || o === '≠');
      if (strict ? inside > 0 : inside === 0) { const p = touching(edge, strict, z => [judgeZ(z).c, 0]); if (!strict) single = p; }
    }
    // z ≠ 0, z ≠ 1 + i: the excluded single points, as hollow dots.
    for (const z of points?.excluded ?? []) dot(ctx, vp, z[0], z[1], 4.5, theme.bg, f.color);
  }
  ctx.restore();
  return { all, inside, valid, lines: lines.length + (thickCurve ? 1 : 0), single };
}

/** Values for the unknowns: the row's interval, or all reals (t = sinh s, dense near 0). */
function unknownValues(f: FnState, vp: Viewport, n: number): number[] {
  // ponytail: "all reals" stops at 100 × the visible range; enough for t + 2i to leave the view while
  // cos t + i sin t doesn't go round thousands of times. Set an interval if a curve needs larger t.
  const bounded = Number.isFinite(f.from) && Number.isFinite(f.to);
  const R = 100 * Math.max(1, ...[vp.min, vp.max, vp.top, vp.bottom].map(Math.abs));
  const lo = bounded ? f.from : Math.asinh(Math.max(-R, f.from)), hi = bounded ? f.to : Math.asinh(Math.min(R, f.to));
  return Array.from({ length: n + 1 }, (_, k) => bounded ? lo + (hi - lo) * k / n : Math.sinh(lo + (hi - lo) * k / n));
}

/** Where a number with unknowns can be: no unknown = a point, one = a curve, two = a filled region. */
export function drawParametric(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, f: FnState, set: ParametricSet): void {
  // Canvas drops a whole path with a point ~1e65 px away, so points beyond ~20 screens count as missing.
  const L = 20 * (vp.width + vp.height), { unknowns, at } = set;
  const P = (z: Complex): [number, number] => [vp.px(z[0]), vp.py(z[1])];
  const ok = (p: [number, number]) => Math.abs(p[0]) < L && Math.abs(p[1]) < L;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = f.color; ctx.lineWidth = f.width; ctx.lineJoin = ctx.lineCap = 'round';
  if (!unknowns.length) {
    const z = at();
    dot(ctx, vp, z[0], z[1], 5, f.color, theme.bg);
  } else if (unknowns.length === 1) {
    ctx.setLineDash(dashPattern(f.dash, f.width));
    ctx.beginPath();
    let pen = false;
    const point = (p: [number, number]) => { if (pen) ctx.lineTo(...p); else ctx.moveTo(...p); pen = true; };
    // Halve each step until it is under 4 px; one that stays long after 10 halvings is a jump (1/t at 0): lift the pen.
    const segment = (t0: number, p0: [number, number], t1: number, p1: [number, number], depth: number): void => {
      if (!ok(p0) || !ok(p1)) { pen = false; if (ok(p1)) point(p1); return; }
      const off = (p0[0] < 0 && p1[0] < 0) || (p0[0] > vp.width && p1[0] > vp.width) || (p0[1] < 0 && p1[1] < 0) || (p0[1] > vp.height && p1[1] > vp.height);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 4 && !off) {
        if (depth) {
          const tm = (t0 + t1) / 2, pm = P(at(tm));
          segment(t0, p0, tm, pm, depth - 1);
          segment(tm, pm, t1, p1, depth - 1);
          return;
        }
        pen = false;
      }
      point(p1);
    };
    const ts = unknownValues(f, vp, 4000);
    let p0 = P(at(ts[0]));
    if (ok(p0)) point(p0);
    for (let k = 1; k < ts.length; k++) { const p1 = P(at(ts[k])); segment(ts[k - 1], p0, ts[k], p1, 10); p0 = p1; }
    ctx.stroke();
    ctx.setLineDash([]);
    // Ends of a finite interval, like a graph's domain: filled when the end belongs, hollow when open.
    for (const [end, open] of [[f.from, f.fromOpen], [f.to, f.toOpen]] as const) {
      if (Number.isFinite(end)) { const z = at(end); dot(ctx, vp, z[0], z[1], 4, open ? theme.bg : f.color, f.color); }
    }
  } else {
    // Two unknowns: fill the image of every cell of a 160 × 160 grid, all with the same orientation, so where the
    // image folds over itself the overlaps don't cancel out.
    // ponytail: 160 steps per unknown; a strongly curved region shows facets when zoomed in.
    const ts = unknownValues(f, vp, 160), grid = ts.map(a => ts.map(b => P(at(a, b))));
    ctx.beginPath();
    for (let i = 0; i < 160; i++) for (let j = 0; j < 160; j++) {
      let q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      if (!q.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
      q = q.map(p => [Math.max(-L, Math.min(L, p[0])), Math.max(-L, Math.min(L, p[1]))]);
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      if (Math.max(...xs) < 0 || Math.min(...xs) > vp.width || Math.max(...ys) < 0 || Math.min(...ys) > vp.height) continue;
      if (q.reduce((sum, p, k) => sum + p[0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * p[1], 0) < 0) q.reverse();
      ctx.moveTo(...q[0]);
      for (const p of q.slice(1)) ctx.lineTo(...p);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;
    if (Number.isFinite(f.from) && Number.isFinite(f.to)) {
      // A bounded interval: outline the image of the parameter square's edges, dashed where the interval is open.
      const lo = f.from, hi = f.to, along = (k: number) => lo + (hi - lo) * k / 400;
      const edges: [(k: number) => Complex, boolean][] = [[k => at(along(k), lo), f.fromOpen], [k => at(hi, along(k)), f.toOpen], [k => at(along(k), hi), f.toOpen], [k => at(lo, along(k)), f.fromOpen]];
      for (const [edgeAt, open] of edges) {
        ctx.setLineDash(open ? STRICT_DASH(f.width) : []);
        ctx.beginPath();
        // lift the pen across points where it is undefined (1/a + bi at a = 0)
        let pen = false;
        for (let k = 0; k <= 400; k++) {
          const p = P(edgeAt(k));
          if (!ok(p)) { pen = false; continue; }
          if (pen) ctx.lineTo(...p); else ctx.moveTo(...p);
          pen = true;
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
