import { describe, expect, it } from 'vitest';
import { fillTemplate, nextSlot, oneLine, prettify, prettyText, withSlots } from '../src/app/calculator/composer-text';
import { PALETTE } from '../src/app/calculator/content';
import { parse } from '../src/cas/parse';
import { sugar } from '../src/cas/sugar';

/** Types `text` one character at a time, as the field does. */
function type(text: string): string {
  let v = '';
  for (const c of text) {
    v += c;
    const r = prettify(v, v.length);
    if (r) v = r.text;
  }
  return v;
}

describe('oneLine', () => {
  it('joins the equations of a system and the rows of a matrix', () => {
    expect(oneLine('x + y = 5\nx - y = 1')).toBe('x + y = 5; x - y = 1');
    expect(oneLine('[1 2\n3 4]')).toBe('[1 2; 3 4]');
    expect(oneLine('sum(1/k^2,\nk, 1, 10)')).toBe('sum(1/k^2, k, 1, 10)');
    expect(oneLine('max(1\n2)')).toBe('max(1, 2)');
    expect(oneLine('  2 + 2  \n\n')).toBe('2 + 2');
  });
});

describe('prettify', () => {
  it('writes the long spellings as symbols', () => {
    expect(type('x <= 2')).toBe('x ≤ 2');
    expect(type('x >= 2 != 3')).toBe('x ≥ 2 ≠ 3');
    expect(type('granica sin x/x przy x->0')).toBe('granica sin x/x przy x→0');
    expect(type('2*x')).toBe('2·x');
    expect(type('sqrt(2) + pi + inf ')).toBe('√(2) + π + ∞ ');
    expect(type('2pi ')).toBe('2π ');
  });
  it('leaves words, element-wise operators, LaTeX and strings alone', () => {
    expect(type('czy 7 pierwsza')).toBe('czy 7 pierwsza');
    expect(type('pierwiastki x^2 = 2')).toBe('pierwiastki x^2 = 2');
    expect(type('[1 2] .* [3 4]')).toBe('[1 2] .* [3 4]');
    expect(type(String.raw`\frac{\pi}{2} <= 2`)).toBe(String.raw`\frac{\pi}{2} <= 2`);
    expect(type('"pi "')).toBe('"pi "');
    expect(type('api ')).toBe('api ');
  });
  it('keeps what the parser reads', () => {
    for (const s of ['x <= 2*pi', 'sqrt(x) >= 1', 'granica (1 + 1/n)^n przy n->inf']) {
      expect(JSON.stringify(parse(sugar(type(s))))).toBe(JSON.stringify(parse(sugar(s))));
    }
  });
});

describe('prettyText', () => {
  it('writes text formulas as they are read', () => {
    expect(prettyText('y = x^3 - 3x + 1')).toBe('y = x³ − 3x + 1');
    expect(prettyText('solve(x^2 - 2 = 0)')).toBe('solve(x² − 2 = 0)');
    expect(prettyText('x^(-1) + 2*x <= sqrt(pi)')).toBe('x⁻¹ + 2·x ≤ √(π)');
    expect(prettyText('limit(sin x/x, x->inf)')).toBe('limit(sin x/x, x→∞)');
  });
  it('leaves what a superscript cannot say', () => {
    expect(prettyText('x^(1/2)')).toBe('x^(1/2)');
    expect(prettyText('x^2.5')).toBe('x^2.5');
    expect(prettyText('A .* B')).toBe('A .* B');
    expect(prettyText('pierwiastki')).toBe('pierwiastki');
  });
});

describe('templates', () => {
  it('select the first empty place, or put the selection in it', () => {
    expect(fillTemplate('(□)/(□)', '')).toEqual({ text: '(□)/(□)', select: [1, 2] });
    expect(fillTemplate('(□)/(□)', 'x + 1')).toEqual({ text: '(x + 1)/(□)', select: [9, 10] });
    expect(fillTemplate('√(□)', 'x')).toEqual({ text: '√(x)', select: [4, 4] });
    expect(fillTemplate('□^2', 'x + 1').text).toBe('(x + 1)^2');
    expect(fillTemplate('π', 'x')).toEqual({ text: 'π', select: [1, 1] });
  });
  it('take what stands before the caret when they start with a place', () => {
    expect(fillTemplate('□^2', '', '3x').text).toBe('^2');
    expect(fillTemplate('□^2', '', '3 + ').text).toBe('□^2');
    expect(fillTemplate('sin(□)', '', '2x').text).toBe(' sin(□)');
  });
  it('walk from place to place, round the end', () => {
    const t = '[□ □; □ □]';
    expect(nextSlot(t, 1, 2)).toBe(3);
    expect(nextSlot(t, 8, 9)).toBe(1);
    expect(nextSlot(t, 3, 4, true)).toBe(1);
    expect(nextSlot('x', 0, 0)).toBeNull();
  });
  it('are all read by the parser once filled, and in the preview while empty', () => {
    for (const { keys } of PALETTE) {
      for (const k of keys) {
        const filled = k.text.includes('□') ? oneLine(k.text.replaceAll('□', '2')) : `2${k.text}2`;
        expect(() => parse(sugar(filled)), k.name).not.toThrow();
        const empty = k.text.includes('□') ? k.text : `□${k.text}□`;
        expect(() => parse(sugar(oneLine(withSlots(empty))), { names: { slotbox: 'scalar' }, assign: false }), k.name).not.toThrow();
      }
    }
  });
});
