import { exact } from './math';
import type { Complex } from './math';
import type { AxisUnit, FnState } from './state';

/** Polish number formatting: 2,5 not 2.5; tiny values read as 0. */
export const format = (n: number, digits = 5) =>
  Math.abs(n) < 1e-8 ? '0' : Number(n.toPrecision(digits)).toLocaleString('pl-PL', { maximumFractionDigits: digits, useGrouping: Math.abs(n) >= 1e4 });

/** Values without ≈ are proven in exact arithmetic. Otherwise: ≈ a recognisable form or 8 digits. */
export const approx = (n: number) => `≈ ${exact(n) ?? format(n, 8)}`;

/** a + bi; parts as recognisable forms (√2, π/4) when exact() finds one. */
export function complexText([a, b]: Complex, part = (v: number) => exact(v) ?? format(v, 8)): string | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const tiny = 1e-12 * Math.max(Math.abs(a), Math.abs(b));
  if (Math.abs(a) <= tiny) a = 0;
  if (Math.abs(b) <= tiny) b = 0;
  const im = Math.abs(b) === 1 ? 'i' : `${part(Math.abs(b))}i`;
  return !b ? part(a) : !a ? `${b < 0 ? '−' : ''}${im}` : `${part(a)} ${b < 0 ? '−' : '+'} ${im}`;
}

/** Without ≈ only when both parts are integers, i.e. float arithmetic had nothing to round. */
export function complexValue(z: Complex, sure = z.every(Number.isInteger)): string {
  const t = complexText(z);
  return t === null ? 'nie istnieje' : sure ? t : `≈ ${t}`;
}

const escapeHTML = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
/** HTML of a value text, fractions like 5/13 or (1 + √5)/2 stacked as MathML. */
export const stacked = (s: string) => escapeHTML(s).replace(/\(([^()]+)\)\/(\d+)|([\dπ√]+)\/(\d+)/g,
  (_, a, b, c, d) => `<math><mfrac><mn>${a ?? c}</mn><mn>${b ?? d}</mn></mfrac></math>`);

export const list = (items: string[], max = 6) => items.slice(0, max).join(';  ') + (items.length > max ? ';  …' : '');

/** π/2, −√2… for values that are simple multiples of π or a root; null for plain decimals, which read better as such. */
export const symbolic = (v: number) => { const e = exact(v); return e && /[π√]/.test(e) ? e : null; };

/** x ∈ ⟨a; b), ends set as constants shown as such: ⟨0; π), not ⟨0; 3,1416). */
export function domainText(f: Pick<FnState, 'from' | 'to' | 'fromOpen' | 'toOpen'>, variable = 'x'): string {
  const end = (v: number) => symbolic(v) ?? format(v);
  const left = Number.isFinite(f.from) ? `${f.fromOpen ? '(' : '⟨'}${end(f.from)}` : '(−∞';
  const right = Number.isFinite(f.to) ? `${end(f.to)}${f.toOpen ? ')' : '⟩'}` : '+∞)';
  return `${variable} ∈ ${left}; ${right}`;
}

/** 1.5707… → π/2, 6.2831… → 2π; denominators up to 12. */
export function piLabel(x: number): string {
  const k = x / Math.PI, d = [1, 2, 3, 4, 6, 12].find(d => Math.abs(k * d - Math.round(k * d)) < 1e-6);
  if (!d) return `${format(k)}π`;
  const n = Math.round(k * d), a = Math.abs(n);
  return `${n < 0 ? '−' : ''}${a === 1 ? '' : a}π${d > 1 ? `/${d}` : ''}`;
}

/** An axis value in the chosen unit: 1,5 · π/2 · 90°. */
export const unitLabel = (unit: AxisUnit, v: number, digits?: number) =>
  unit === 'pi' ? piLabel(v) : unit === 'deg' ? `${format(v * 180 / Math.PI, digits)}°` : format(v, digits);
