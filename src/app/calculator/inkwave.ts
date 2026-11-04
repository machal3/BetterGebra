/**
 * The answer's ripple. A drop of ink falls onto the calculator's lattice where the answer will be and one circular
 * wave runs out from where it lands: over the card first — the card is uncovered by it, a crest and a faint
 * swell crossing its surface — then on across the page, lighting up the grid's lines as it passes, their crossings
 * flaring like points of a lattice, and a fainter echo behind. The card's own reveal (reveal.ts) keeps to the same
 * radius at every moment (`radiusAt`), so it is one wave from the drop to the corners of the screen.
 *
 * Here: the drop and the wave on the grid, on one canvas over the lattice, under the cards (one requestAnimationFrame
 * loop, about 1.6 s, then it is gone). What crosses the card is reveal.ts's, moved by transforms alone. Ink only,
 * as the chrome is monochrome.
 */
export const FALL = 280, WAVE = 1250;
const ECHO = 220;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Where the wave starts (client px) and how far it has to run to clear the screen. */
export interface Ripple { x: number; y: number; far: number }

/** The drop lands on the answer itself: the middle of the card's first formula (else of the card). */
export function rippleOf(card: Element): Ripple {
  // (a <math> fills its row: the middle of what it draws is that of its children)
  const m = card.querySelector('.b-pod-row .b-pod-math math') ?? card.querySelector('.b-pod-row') ?? card;
  const boxes = (m.localName === 'math' ? Array.from(m.children) : [m]).map(e => e.getBoundingClientRect()).filter(b => b.width || b.height);
  const c = boxes.length
    ? { left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)), top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)) }
    : card.getBoundingClientRect();
  const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
  return { x, y, far: Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 80 };
}
/** The wave's radius `ms` after the drop lands: fast at first, slowing as it spreads, as a ripple does. */
export const radiusAt = (ms: number, far: number): number => (ms <= 0 ? 0 : far * easeOut(Math.min(1, ms / WAVE)));
/** When the wave reaches distance `r` (the inverse of radiusAt). */
export const reachAt = (r: number, far: number): number => (r >= far ? WAVE : WAVE * (1 - Math.cbrt(1 - r / far)));

/** The ink as r, g, b and its alpha, from the token (rgba(0, 0, 0, 0.88) or a hex). */
function inkOf(el: Element): [number, number, number, number] {
  const v = getComputedStyle(el).getPropertyValue('--b-ink').trim();
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) { const [r, g, b, a = '1'] = m[1].split(',').map(s => s.trim()); return [+r, +g, +b, +a]; }
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  return h ? [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16), 1] : [0, 0, 0, 0.88];
}

function layer(parent: Element, className: string, w: number, h: number, dpr: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
  parent.append(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Plays the ripple; the drop lands `impact` ms from now. Returns a cancel. */
export function inkWave(backdrop: HTMLElement, ripple: Ripple, impact: number): () => void {
  const [r, g, b, alpha] = inkOf(backdrop), ink = (a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * alpha))})`;
  const t0 = performance.now() + impact, end = t0 + ECHO + WAVE;

  // --- over the grid: the drop, then the wave on the lattice (1×: a glow of faint lines loses nothing, and it keeps
  // every frame on time) ---
  const box = backdrop?.getBoundingClientRect();
  const under = backdrop && box && box.width && box.height ? layer(backdrop, 'b-inkwave', box.width, box.height, 1) : null;
  const W = box?.width ?? 0, H = box?.height ?? 0, cx = ripple.x - (box?.left ?? 0), cy = ripple.y - (box?.top ?? 0);
  // the lattice: read once where its drifting lines are, then follow them by the clock (one cell per --ui-gb-speed,
  // diagonally down to the left), so no frame asks for layout
  const lines = backdrop?.querySelector('.ui-gb-lines'), gb = backdrop ? getComputedStyle(backdrop.querySelector('.ui-gb') ?? backdrop) : null;
  const cell = parseFloat(gb?.getPropertyValue('--ui-gb-size') ?? '') || 48, period = (parseFloat(gb?.getPropertyValue('--ui-gb-speed') ?? '') || 0) * 1000;
  const at0 = lines?.getBoundingClientRect(), read = performance.now();
  const grid = (now: number): [number, number] => {
    const shift = period ? ((now - read) / period) * cell : 0, mod = (v: number) => ((v % cell) + cell) % cell;
    return at0 && box ? [mod(at0.left - box.left - shift), mod(at0.top - box.top + shift)] : [0, 0];
  };
  const height = Math.max(70, Math.min(240, cy - 30));

  /** Paths by brightness: a few strokes and fills a frame instead of hundreds. */
  const LEVELS = 7;
  const paths = () => Array.from({ length: LEVELS }, () => new Path2D());

  /** One ring on the lattice: its lines lit where the ring is (only there), the crossings near its crest flaring. */
  const ring = (ctx: CanvasRenderingContext2D, radius: number, strength: number, now: number) => {
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

  let frame = 0;
  const step = (now: number) => {
    frame = 0;
    const since = now - t0;
    if (under) {
      under.clearRect(0, 0, W, H);
      // the drop, falling faster and faster (t²), drawn out along its fall, a short trail behind it
      if (since >= -FALL && since < 0) {
        const p = 1 + since / FALL, y = cy - height * (1 - p * p), stretch = 1 + 1.4 * p, len = 30 * p + 4;
        const trail = under.createLinearGradient(0, y - len, 0, y);
        trail.addColorStop(0, ink(0)); trail.addColorStop(1, ink(0.3));
        under.fillStyle = trail;
        under.fillRect(cx - 1, y - len, 2, len);
        under.fillStyle = ink(0.95);
        under.beginPath(); under.ellipse(cx, y, 3.6 / Math.sqrt(stretch), 3.6 * stretch, 0, 0, Math.PI * 2); under.fill();
      }
      if (since >= 0) {
        const q = since - ECHO;
        if (since < WAVE) ring(under, radiusAt(since, ripple.far), (1 - since / WAVE) ** 1.4, now);
        if (q > 0 && q < WAVE) ring(under, radiusAt(q, ripple.far) * 0.92, 0.42 * (1 - q / WAVE) ** 1.6, now);
      }
    }
    if (now < end) frame = requestAnimationFrame(step);
    else under?.canvas.remove();
  };
  frame = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(frame); under?.canvas.remove(); };
}
