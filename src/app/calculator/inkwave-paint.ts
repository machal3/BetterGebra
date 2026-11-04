/**
 * Painting the drop and its wave on the lattice (inkwave.ts): DOM-free, so the same code runs in a worker on an
 * OffscreenCanvas — off the main thread, which then has nothing of it to do — or, where that is missing, in the page.
 * Times are absolute (performance.timeOrigin + performance.now()), so the page and a worker agree on them.
 */
export const FALL = 280, WAVE = 1250, ECHO = 220;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** The wave's radius `ms` after the drop lands: fast at first, slowing as it spreads, as a ripple does. */
export const radiusAt = (ms: number, far: number): number => (ms <= 0 ? 0 : far * easeOut(Math.min(1, ms / WAVE)));

/** Everything the painter needs, measured once in the page. */
export interface WaveSpec {
  W: number; H: number;
  /** where the drop lands and how far the wave runs */
  cx: number; cy: number; far: number;
  /** the ink: r, g, b and its alpha */
  ink: [number, number, number, number];
  /** the lattice: cell, ms per cell of drift (0: still), where its lines were at `read` */
  cell: number; period: number; ox: number; oy: number; read: number;
  /** when the drop lands */
  t0: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Returns the frame painter: paints the moment `now` and says whether there is more to come. */
export function painter(ctx: Ctx, spec: WaveSpec): (now: number) => boolean {
  const { W, H, cx, cy, far, cell, period, t0 } = spec, [r, g, b, alpha] = spec.ink;
  const ink = (a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * alpha))})`;
  const end = t0 + ECHO + WAVE, height = Math.max(70, Math.min(240, cy - 30));
  const mod = (v: number) => ((v % cell) + cell) % cell;
  // the lattice drifts one cell per period, diagonally down to the left
  const grid = (now: number): [number, number] => {
    const shift = period ? ((now - spec.read) / period) * cell : 0;
    return [mod(spec.ox - shift), mod(spec.oy + shift)];
  };

  /** Paths by brightness: a few strokes and fills a frame instead of hundreds. */
  const LEVELS = 7;
  const paths = () => Array.from({ length: LEVELS }, () => new Path2D());

  /** One ring on the lattice: its lines lit where the ring is (only there), the crossings near its crest flaring. */
  const ring = (ctx: Ctx, radius: number, strength: number, now: number) => {
    if (strength <= 0.01) return;
    const band = 150, inner = Math.max(0, radius - band), outer = radius + band * 0.35, span = outer - inner;
    // a line's brightness at distance ρ: rising through the ring to just past its crest, falling off ahead of it
    const light = (rho: number) => {
      const u = (rho - inner) / span;
      return u <= 0 || u >= 1 ? 0 : u < 0.72 ? 0.65 * (u / 0.72) : u < 0.8 ? 0.65 + 0.35 * ((u - 0.72) / 0.08) : (1 - u) / 0.2;
    };
    const [ox, oy] = grid(now);
    const x0 = Math.max(0, cx - outer), x1 = Math.min(W, cx + outer), y0 = Math.max(0, cy - outer), y1 = Math.min(H, cy + outer);
    const shades = paths(), STEP = 8;
    const steps = (vertical: boolean, at: number, a: number, z: number) => {
      for (let p = a; p < z; p += STEP) {
        const q = Math.min(z, p + STEP), m = (p + q) / 2;
        const k = light(vertical ? Math.hypot(at - cx, m - cy) : Math.hypot(m - cx, at - cy));
        if (k < 0.05) continue;
        const path = shades[Math.min(LEVELS - 1, Math.floor(k * LEVELS))];
        if (vertical) { path.moveTo(at + 0.5, p); path.lineTo(at + 0.5, q); } else { path.moveTo(p, at + 0.5); path.lineTo(q, at + 0.5); }
      }
    };
    // each line only where it cuts the annulus
    const pieces = (d: number, along: number, lo: number, hi: number, put: (a: number, z: number) => void) => {
      const o = Math.sqrt(Math.max(0, outer * outer - d * d));
      if (!o) return;
      const i = Math.abs(d) < inner ? Math.sqrt(inner * inner - d * d) : 0;
      const seg = (a: number, z: number) => { a = Math.max(lo, a); z = Math.min(hi, z); if (z > a) put(a, z); };
      if (i) { seg(along - o, along - i); seg(along + i, along + o); } else seg(along - o, along + o);
    };
    for (let x = ox + Math.ceil((x0 - ox) / cell) * cell; x <= x1; x += cell) pieces(x - cx, cy, 0, H, (a, z) => steps(true, x, a, z));
    for (let y = oy + Math.ceil((y0 - oy) / cell) * cell; y <= y1; y += cell) pieces(y - cy, cx, 0, W, (a, z) => steps(false, y, a, z));
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    shades.forEach((path, i) => { ctx.strokeStyle = ink(0.6 * strength * (i + 0.5) / LEVELS); ctx.stroke(path); });
    // the crossings near the crest flare as points
    const crest = radius - band * 0.12, reach = 46, dots = paths();
    let any = false;
    for (let x = ox + Math.ceil((Math.max(0, cx - crest - reach) - ox) / cell) * cell; x <= Math.min(W, cx + crest + reach); x += cell) {
      const dx = x - cx, ro = crest + reach, ri = crest - reach;
      const yo = Math.sqrt(Math.max(0, ro * ro - dx * dx)), yi = Math.abs(dx) < ri ? Math.sqrt(ri * ri - dx * dx) : 0;
      for (const [lo, hi] of yi ? [[cy - yo, cy - yi], [cy + yi, cy + yo]] : [[cy - yo, cy + yo]]) {
        for (let y = oy + Math.ceil((Math.max(0, lo) - oy) / cell) * cell; y <= Math.min(H, hi); y += cell) {
          const d = Math.abs(Math.hypot(dx, y - cy) - crest);
          if (d > reach) continue;
          const k = 1 - d / reach, rr = 0.8 + 1.6 * k, path = dots[Math.min(LEVELS - 1, Math.floor(k * LEVELS))];
          path.moveTo(x + 0.5 + rr, y + 0.5); path.arc(x + 0.5, y + 0.5, rr, 0, Math.PI * 2);
          any = true;
        }
      }
    }
    if (any) dots.forEach((path, i) => { ctx.fillStyle = ink(0.75 * strength * (i + 0.5) / LEVELS); ctx.fill(path); });
    // the crest itself, a hairline circle
    ctx.strokeStyle = ink(0.2 * strength);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  };

  return (now: number) => {
    const since = now - t0;
    ctx.clearRect(0, 0, W, H);
    // the drop, falling faster and faster (t²), drawn out along its fall, a short trail behind it
    if (since >= -FALL && since < 0) {
      const p = 1 + since / FALL, y = cy - height * (1 - p * p), stretch = 1 + 1.4 * p, len = 30 * p + 4;
      const trail = ctx.createLinearGradient(0, y - len, 0, y);
      trail.addColorStop(0, ink(0)); trail.addColorStop(1, ink(0.3));
      ctx.fillStyle = trail;
      ctx.fillRect(cx - 1, y - len, 2, len);
      ctx.fillStyle = ink(0.95);
      ctx.beginPath(); ctx.ellipse(cx, y, 3.6 / Math.sqrt(stretch), 3.6 * stretch, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (since >= 0) {
      const q = since - ECHO;
      if (since < WAVE) ring(ctx, radiusAt(since, far), (1 - since / WAVE) ** 1.4, now);
      if (q > 0 && q < WAVE) ring(ctx, radiusAt(q, far) * 0.92, 0.42 * (1 - q / WAVE) ** 1.6, now);
    }
    return now < end;
  };
}
