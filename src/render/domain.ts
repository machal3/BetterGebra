/**
 * Domain colouring: every point z gets the colour of f(z). Hue = argument (red: positive real, cyan: negative real),
 * dark = |f| near 0, light = near a pole, a faint ring wherever |f| doubles. A zero is where all colours meet.
 * Drawn by WebGL from the expression translated to GLSL (parameters are uniforms, so sliders don't recompile);
 * on the CPU when WebGL2 is missing, the expression has no GLSL form, or float32 can't resolve the view.
 */
import type { ComplexFunction, Node, Params } from '../math';
import { parse } from '../math';
import type { Viewport } from './viewport';

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
const f = (v: number) => { const s = String(v); return /[.e]/.test(s) ? s : `${s}.0`; };

const LIBRARY = /* glsl */ `
const float PI = 3.141592653589793;
vec2 NAN2() { return vec2(intBitsToFloat(0x7fc00000)); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { float n = dot(b, b); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / n; }
vec2 cexp(vec2 z) { return z.y == 0.0 ? vec2(exp(z.x), 0.0) : exp(z.x) * vec2(cos(z.y), sin(z.y)); }
vec2 clog(vec2 z) { return vec2(log(length(z)), atan(z.y, z.x)); }
vec2 csqrt(vec2 z) { float r = length(z); return vec2(sqrt((r + z.x) / 2.0), (z.y < 0.0 ? -1.0 : 1.0) * sqrt(max(0.0, (r - z.x) / 2.0))); }
vec2 cpow(vec2 z, vec2 w) {
  if (w.y == 0.0 && w.x == floor(w.x) && abs(w.x) <= 64.0) {
    vec2 out_ = vec2(1.0, 0.0);
    for (int k = 0; k < int(abs(w.x)); k++) out_ = cmul(out_, z);
    return w.x < 0.0 ? cdiv(vec2(1.0, 0.0), out_) : out_;
  }
  if (z == vec2(0.0)) return w.x > 0.0 ? vec2(0.0) : NAN2();
  if (z.y == 0.0 && w.y == 0.0 && z.x > 0.0) return vec2(pow(z.x, w.x), 0.0);
  return cexp(cmul(w, clog(z)));
}
vec2 csin(vec2 z) { return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y)); }
vec2 ccos(vec2 z) { return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y)); }
vec2 csinh(vec2 z) { return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y)); }
vec2 ccosh(vec2 z) { return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y)); }
vec2 casin(vec2 z) { return cmul(vec2(0.0, -1.0), clog(cmul(vec2(0.0, 1.0), z) + csqrt(vec2(1.0, 0.0) - cmul(z, z)))); }
vec2 catan(vec2 z) { vec2 iz = cmul(vec2(0.0, 1.0), z); return cmul(vec2(0.0, 0.5), clog(vec2(1.0, 0.0) - iz) - clog(vec2(1.0, 0.0) + iz)); }
vec2 cgamma(vec2 z) {
  bool reflect_ = z.x < 0.5;
  vec2 w = (reflect_ ? vec2(1.0, 0.0) - z : z) - vec2(1.0, 0.0);
  vec2 a = vec2(${f(LANCZOS[0])}, 0.0);
  ${LANCZOS.slice(1).map((c, i) => `a += cdiv(vec2(${f(c)}, 0.0), w + vec2(${f(i + 1)}, 0.0));`).join('\n  ')}
  vec2 t = w + vec2(7.5, 0.0);
  vec2 g = cmul(cmul(vec2(sqrt(2.0 * PI), 0.0), cpow(t, w + vec2(0.5, 0.0))), cmul(cexp(-t), a));
  return reflect_ ? cdiv(vec2(PI, 0.0), cmul(csin(PI * z), g)) : g;
}
float rmod(float a, float b) { return mod(mod(a, b) + b, b); }
vec2 cmod(vec2 a, vec2 b) { return (a.y == 0.0 && b.y == 0.0) ? vec2(a.x - b.x * floor(a.x / b.x), 0.0) : a - cmul(b, floor(cdiv(a, b))); }
vec2 creal(bool ok, float v) { return ok ? vec2(v, 0.0) : NAN2(); }
`;

const one = 'vec2(1.0, 0.0)';
type Gen = (args: string[]) => string;
const CALLS: Record<string, Gen> = {
  sin: ([a]) => `csin(${a})`, cos: ([a]) => `ccos(${a})`,
  tan: ([a]) => `cdiv(csin(${a}), ccos(${a}))`, cot: ([a]) => `cdiv(ccos(${a}), csin(${a}))`,
  sec: ([a]) => `cdiv(${one}, ccos(${a}))`, csc: ([a]) => `cdiv(${one}, csin(${a}))`,
  asin: ([a]) => `casin(${a})`, acos: ([a]) => `(vec2(PI / 2.0, 0.0) - casin(${a}))`,
  atan: ([a]) => `catan(${a})`, acot: ([a]) => `catan(cdiv(${one}, ${a}))`,
  sinh: ([a]) => `csinh(${a})`, cosh: ([a]) => `ccosh(${a})`,
  tanh: ([a]) => `cdiv(csinh(${a}), ccosh(${a}))`, coth: ([a]) => `cdiv(ccosh(${a}), csinh(${a}))`,
  asinh: ([a]) => `clog(${a} + csqrt(cmul(${a}, ${a}) + ${one}))`,
  acosh: ([a]) => `clog(${a} + cmul(csqrt(${a} + ${one}), csqrt(${a} - ${one})))`,
  atanh: ([a]) => `cmul(vec2(0.5, 0.0), clog(${one} + ${a}) - clog(${one} - ${a}))`,
  sqrt: ([a]) => `csqrt(${a})`, cbrt: ([a]) => `cpow(${a}, vec2(1.0 / 3.0, 0.0))`,
  root: ([n, a]) => `cpow(${a}, cdiv(${one}, ${n}))`,
  abs: ([a]) => `vec2(length(${a}), 0.0)`,
  sign: ([a]) => `(length(${a}) > 0.0 ? ${a} / length(${a}) : vec2(0.0))`,
  ln: ([a]) => `clog(${a})`, exp: ([a]) => `cexp(${a})`,
  log: ([a, b]) => b === undefined ? `(clog(${a}) / log(10.0))` : `cdiv(clog(${b}), clog(${a}))`,
  log2: ([a]) => `(clog(${a}) / log(2.0))`,
  gamma: ([a]) => `cgamma(${a})`,
  floor: ([a]) => `floor(${a})`, ceil: ([a]) => `ceil(${a})`, round: ([a]) => `floor(${a} + 0.5)`,
  mod: ([a, b]) => `cmod(${a}, ${b})`,
  re: ([a]) => `vec2((${a}).x, 0.0)`, im: ([a]) => `vec2((${a}).y, 0.0)`,
  arg: ([a]) => `(length(${a}) > 0.0 ? vec2(atan((${a}).y, (${a}).x), 0.0) : NAN2())`,
  conj: ([a]) => `vec2((${a}).x, -(${a}).y)`,
};

const realOnly = (op: 'min' | 'max'): Gen => args => args.reduce((acc, b) => `creal((${acc}).y == 0.0 && (${b}).y == 0.0, ${op}((${acc}).x, (${b}).x))`);
CALLS.min = realOnly('min');
CALLS.max = realOnly('max');

function glsl(n: Node, uniforms: Set<string>): string {
  switch (n.t) {
    case 'num': return `vec2(${f(n.v)}, 0.0)`;
    case 'x': return 'z';
    case 'const': return `vec2(${f({ pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 }[n.n])}, 0.0)`;
    case 'param':
      if (n.n === 'i') return 'vec2(0.0, 1.0)';
      if (n.n === 'z') return 'z';
      uniforms.add(n.n);
      return `vec2(p_${n.n}, 0.0)`;
    case 'neg': return `(-${glsl(n.a, uniforms)})`;
    case '+': return `(${glsl(n.a, uniforms)} + ${glsl(n.b, uniforms)})`;
    case '-': return `(${glsl(n.a, uniforms)} - ${glsl(n.b, uniforms)})`;
    case '*': return `cmul(${glsl(n.a, uniforms)}, ${glsl(n.b, uniforms)})`;
    case '/': return `cdiv(${glsl(n.a, uniforms)}, ${glsl(n.b, uniforms)})`;
    case '^': return `cpow(${glsl(n.a, uniforms)}, ${glsl(n.b, uniforms)})`;
    case '!': return `cgamma(${glsl(n.a, uniforms)} + ${one})`;
    case '°': return `(${glsl(n.a, uniforms)} * (PI / 180.0))`;
    case 'call': {
      const gen = CALLS[n.n];
      if (!gen) throw new Error(`no GLSL for ${n.n}`);
      return gen(n.args.map(a => glsl(a, uniforms)));
    }
  }
}

const VERTEX = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

const fragment = (expr: string, uniforms: string[]) => `#version 300 es
precision highp float;
uniform vec4 u_view; // world x at the left edge, px per x unit, world y at the centre, px per y unit
uniform vec2 u_size; // canvas size in CSS px
uniform float u_dpr;
${uniforms.map(u => `uniform float p_${u};`).join('\n')}
out vec4 color;
${LIBRARY}
vec2 F(vec2 z) { return ${expr}; }
void main() {
  vec2 css = vec2(gl_FragCoord.x, u_size.y * u_dpr - gl_FragCoord.y) / u_dpr;
  vec2 w = F(vec2(u_view.x + css.x / u_view.y, u_view.z + (u_size.y / 2.0 - css.y) / u_view.w));
  float r = length(w);
  if (isnan(w.x) || isnan(w.y) || isinf(w.x) || isinf(w.y) || isnan(r) || r > 1e37) { color = vec4(0.0); return; }
  float t = log2(r);
  float frac_ = t - floor(t);
  // Ring edge spread over one pixel; rings closer than ~8 px would alias into stripes, so they fade out.
  float step_ = fwidth(t);
  float fade = isinf(t) ? 1.0 : max(0.0, 1.0 - 8.0 * step_);
  float e = clamp(step_, 0.001, 0.5);
  float ring = frac_ < 1.0 - e ? frac_ : (1.0 - frac_) * (1.0 - e) / e;
  if (isinf(t)) ring = 0.5;
  float l = (0.5 + 0.32 * tanh(clamp(log(r) / 3.0, -20.0, 20.0))) * (0.86 + 0.14 * (fade * ring + (1.0 - fade) * 0.5));
  float a = min(l, 1.0 - l);
  float hue = 6.0 * atan(w.y, w.x) / PI + 12.0;
  vec3 rgb;
  for (int k = 0; k < 3; k++) {
    float n = k == 0 ? 0.0 : k == 1 ? 8.0 : 4.0;
    float q = mod(n + hue, 12.0);
    rgb[k] = l - a * max(-1.0, min(min(q - 3.0, 9.0 - q), 1.0));
  }
  color = vec4(rgb, 1.0);
}`;

interface Program { program: WebGLProgram; uniforms: string[]; locations: Map<string, WebGLUniformLocation | null> }

class GLPainter {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null;
  private programs = new Map<string, Program | null>();

  constructor() {
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
    const gl = this.gl;
    if (!gl) return;
    this.initBuffer();
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.programs.clear(); });
    // A restored context has lost every buffer too, not only the programs.
    this.canvas.addEventListener('webglcontextrestored', () => this.initBuffer());
  }

  /** One triangle covering the canvas. */
  private initBuffer(): void {
    const gl = this.gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  get available() { return !!this.gl && !this.gl.isContextLost(); }

  private compile(expression: string): Program | null {
    if (this.programs.has(expression)) return this.programs.get(expression)!;
    let result: Program | null = null;
    try {
      const gl = this.gl!, uniforms = new Set<string>(), body = glsl(parse(expression), uniforms);
      const shader = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment(body, [...uniforms])));
      gl.bindAttribLocation(program, 0, 'pos');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
      const names = ['u_view', 'u_size', 'u_dpr', ...[...uniforms].map(u => `p_${u}`)];
      result = { program, uniforms: [...uniforms], locations: new Map(names.map(n => [n, gl.getUniformLocation(program, n)])) };
    } catch (e) {
      if (import.meta.env.DEV) console.warn('Domain colouring falls back to the CPU:', e);
    }
    this.programs.set(expression, result);
    return result;
  }

  /** Paints into this.canvas; false when this expression can't be drawn here. */
  paint(expression: string, params: Params, vp: Viewport, dpr: number): boolean {
    if (!this.available) return false;
    const p = this.compile(expression);
    if (!p) return false;
    const gl = this.gl!, w = Math.round(vp.width * dpr), h = Math.round(vp.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const loc = (n: string) => p.locations.get(n) ?? null;
    gl.uniform4f(loc('u_view'), vp.min, vp.scale, vp.fromY(vp.height / 2), vp.yscale);
    gl.uniform2f(loc('u_size'), vp.width, vp.height);
    gl.uniform1f(loc('u_dpr'), dpr);
    for (const u of p.uniforms) gl.uniform1f(loc(`p_${u}`), Object.hasOwn(params, u) ? params[u] : 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
}

let painter: GLPainter | null = null;
const offscreen = document.createElement('canvas');

/** float32 resolves about 7 digits: past that the GPU picture turns blocky, so the CPU takes over. */
function gpuResolves(vp: Viewport): boolean {
  const extent = Math.max(1, Math.abs(vp.min), Math.abs(vp.max), Math.abs(vp.top), Math.abs(vp.bottom));
  return (vp.max - vp.min) / extent > 2e-4 && (vp.top - vp.bottom) / extent > 2e-4;
}

export function paintDomain(ctx: CanvasRenderingContext2D, vp: Viewport, expression: string, cf: ComplexFunction, params: Params, coarse: boolean): void {
  painter ??= new GLPainter();
  const dpr = ctx.getTransform().a || 1;
  if (gpuResolves(vp) && painter.paint(expression, params, vp, dpr)) {
    ctx.drawImage(painter.canvas, 0, 0, vp.width, vp.height);
    return;
  }
  paintOnCPU(ctx, vp, cf, coarse ? 4 : 2);
}

function paintOnCPU(ctx: CanvasRenderingContext2D, vp: Viewport, cf: ComplexFunction, s: number): void {
  const w = Math.ceil(vp.width / s), h = Math.ceil(vp.height / s);
  offscreen.width = w; offscreen.height = h;
  const c = offscreen.getContext('2d')!, img = c.createImageData(w, h), d = img.data, above = new Float64Array(w).fill(NaN);
  for (let j = 0; j < h; j++) {
    const y = vp.fromY((j + 0.5) * s);
    let left = NaN;
    for (let i = 0; i < w; i++) {
      const [u, v] = cf([vp.fromX((i + 0.5) * s), y]), k = 4 * (j * w + i);
      if (!Number.isFinite(u) || !Number.isFinite(v)) { left = above[i] = NaN; continue; }
      const r = Math.hypot(u, v), t = Math.log2(r), frac = Number.isFinite(t) ? t - Math.floor(t) : 0;
      const step = Math.max(Math.abs(t - left) || 0, Math.abs(t - above[i]) || 0), fade = Number.isFinite(step) ? Math.max(0, 1 - 8 * step) : 1;
      const e = Math.min(0.5, Math.max(0.001, step)), ring = frac < 1 - e ? frac : (1 - frac) * (1 - e) / e;
      left = above[i] = t;
      const l = (0.5 + 0.32 * Math.tanh(Math.log(r) / 3)) * (0.86 + 0.14 * (fade * ring + (1 - fade) * 0.5)), a = Math.min(l, 1 - l);
      const hue = 6 * Math.atan2(v, u) / Math.PI + 12;
      for (const [n, o] of [[0, 0], [8, 1], [4, 2]]) {
        const q = (n + hue) % 12;
        d[k + o] = 255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)));
      }
      d[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, 0, 0, vp.width, vp.height);
}
