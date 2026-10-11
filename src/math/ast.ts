export type ConstName = 'pi' | 'e' | 'tau' | 'phi';

export type Node =
  | { t: 'num'; v: number; s: string }
  | { t: 'x' }
  | { t: 'const'; n: ConstName }
  | { t: 'param'; n: string }
  | { t: 'neg'; a: Node }
  | { t: '+' | '-' | '*' | '/'; a: Node; b: Node }
  /** fn: written as sin²x, so it is typeset as a power of the function name. */
  | { t: '^'; a: Node; b: Node; fn?: boolean }
  | { t: '!' | '°'; a: Node }
  | { t: 'call'; n: string; args: Node[] };

export type Params = Record<string, number>;
export type Complex = [number, number];
