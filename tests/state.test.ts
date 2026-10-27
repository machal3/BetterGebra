import { expect, test } from 'vitest';
import { PALETTE, recolor } from '../src/state';

test('a saved colour of the former palette becomes the colour that took its place; others stay', () => {
  expect(recolor('#637cef')).toBe(PALETTE[0]);
  expect(recolor('#E3008C')).toBe(PALETTE[1]);
  expect(recolor('#57811b')).toBe(PALETTE[7]);
  expect(recolor('#123456')).toBe('#123456');
  for (const c of PALETTE) expect(recolor(c)).toBe(c);
});
