/**
 * The answer's moment across the whole page, drawn under the cards on one canvas laid over the calculator's
 * drifting grid (Backdrop): in ink only, as the chrome is monochrome.
 *
 *  1. a drop of ink falls onto the lattice where the answer will be, stretching as it speeds up;
 *  2. it lands: it flattens into the hairline the card opens out of, which runs out to both edges of the screen
 *     and then withdraws to the card, and a few small ripples ring the point of impact;
 *  3. a wave runs from there across the page, lighting up the grid's lines as it passes and its crossings
 *     flaring like points of a lattice; an echo follows, fainter.
 *
 * About 1.5 s in all, one requestAnimationFrame loop, then the canvas is gone. `impact` is when the drop lands
 * (ms from now), the moment the card's own line starts; returns a cancel.
 */
/** The drop's fall, the line's run to the edges, the wave and its echo; the splash's ripples. */
export const FALL = 230;
const LINE = 260, WAVE = 1150, ECHO = 200, SPLASH = 460;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

/** The ink as r, g, b and its alpha, from the token (rgba(0, 0, 0, 0.88) or a hex). */
function inkOf(el: Element): [number, number, number, number] {
  const v = getComputedStyle(el).getPropertyValue('--b-ink').trim();
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) { const [r, g, b, a = '1'] = m[1].split(',').map(s => s.trim()); return [+r, +g, +b, +a]; }
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  return h ? [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16), 1] : [0, 0, 0, 0.88];
}

export function inkWave(backdrop: HTMLElement, card: HTMLElement, impact: number): () => void {
  const box = backdrop.getBoundingClientRect();
  if (!box.width || !box.height) return () => {};
  // At 1× even on a dense screen: a glow of faint lines and dust under the cards loses nothing to the eye, and a
  // quarter of the pixels is what keeps every frame of it on time (the canvas is filled and handed on each frame).
  const dpr = 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'b-inkwave';
  canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
  backdrop.append(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [r, g, b, alpha] = inkOf(backdrop), ink = (a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * alpha))})`;
  const c = card.getBoundingClientRect();
  const cx = c.left + c.width / 2 - box.left, cy = c.top + c.height / 2 - box.top;
  const left = c.left - box.left, right = c.right - box.left, W = box.width, H = box.height;
  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 60;
  // the backdrop's lines, to light up the very lines that are there: read once where they are, then follow their
  // drift by the clock (one cell per --ui-gb-speed, diagonally down to the left), so no frame asks for layout
  const lines = backdrop.querySelector('.ui-gb-lines'), gb = getComputedStyle(backdrop.querySelector('.ui-gb') ?? backdrop);
  const cell = parseFloat(gb.getPropertyValue('--ui-gb-size')) || 48, period = (parseFloat(gb.getPropertyValue('--ui-gb-speed')) || 0) * 1000;
  const at0 = lines?.getBoundingClientRect(), read = performance.now();
  const grid = (now: number): [number, number] => {
    const shift = period ? ((now - read) / period) * cell : 0, mod = (v: number) => ((v % cell) + cell) % cell;
    return at0 ? [mod(at0.left - box.left - shift), mod(at0.top - box.top + shift)] : [0, 0];
  };

  const t0 = performance.now() + impact, snap = t0 + LINE, wave0 = t0 + 40, end = wave0 + ECHO + WAVE;
  // from a little under the field, or as far up as there is room
  const height = Math.max(60, Math.min(260, cy - 24));
  let frame = 0;

  /** Paths by brightness: a few fills a frame instead of one per dot. */
  const LEVELS = 7;
  const buckets = Array.from({ length: LEVELS }, () => new Path2D());
  const flush = (paths: Path2D[], top: number) => {
    paths.forEach((path, i) => { ctx.fillStyle = ink(top * (i + 0.5) / LEVELS); ctx.fill(path); });
  };

  /** One ring: the grid's lines lit where the ring is (only there), their crossings flaring. */
  const ring = (radius: number, strength: number, now: number) => {
    if (strength <= 0.01) return;
    const band = 150, inner = Math.max(0, radius - band), outer = radius + band * 0.35;
    // how bright a line is at distance ρ from the centre: rising through the ring to its crest, falling past it
    const span = outer - inner, light = (rho: number) => {
      const u = (rho - inner) / span;
      return u <= 0 || u >= 1 ? 0 : u < 0.72 ? 0.4 * (u / 0.72) : u < 0.8 ? 0.4 + 0.22 * ((u - 0.72) / 0.08) : 0.62 * (1 - u) / 0.2;
    };
    const [ox, oy] = grid(now);
    const x0 = Math.max(0, cx - outer), x1 = Math.min(W, cx + outer), y0 = Math.max(0, cy - outer), y1 = Math.min(H, cy + outer);
    // each line only across the ring: one or two short pieces where it cuts the annulus
    const pieces = (d: number, along: number, lo: number, hi: number, put: (a: number, b: number) => void) => {
      const o = Math.sqrt(Math.max(0, outer * outer - d * d));
      if (!o) return;
      const i = Math.abs(d) < inner ? Math.sqrt(inner * inner - d * d) : 0;
      const seg = (a: number, b: number) => { a = Math.max(lo, a); b = Math.min(hi, b); if (b > a) put(a, b); };
      if (i) { seg(along - o, along - i); seg(along + i, along + o); } else seg(along - o, along + o);
    };
    // Each piece in short steps, each step stroked in one of a few solid shades by its brightness: a solid stroke
    // rasterises far cheaper than one with a gradient, and six strokes a frame are all it takes.
    const shades = Array.from({ length: LEVELS }, () => new Path2D()), STEP = 8;
    const steps = (vertical: boolean, at: number, a: number, b: number) => {
      for (let p = a; p < b; p += STEP) {
        const q = Math.min(b, p + STEP), m = (p + q) / 2;
        const k = light(vertical ? Math.hypot(at - cx, m - cy) : Math.hypot(m - cx, at - cy)) / 0.62;
        if (k < 0.04) continue;
        const path = shades[Math.min(LEVELS - 1, Math.floor(k * LEVELS))];
        if (vertical) { path.moveTo(at + 0.5, p); path.lineTo(at + 0.5, q); } else { path.moveTo(p, at + 0.5); path.lineTo(q, at + 0.5); }
      }
    };
    for (let x = ox + Math.ceil((x0 - ox) / cell) * cell; x <= x1; x += cell) pieces(x - cx, cy, 0, H, (a, b) => steps(true, x, a, b));
    for (let y = oy + Math.ceil((y0 - oy) / cell) * cell; y <= y1; y += cell) pieces(y - cy, cx, 0, W, (a, b) => steps(false, y, a, b));
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    shades.forEach((path, i) => { ctx.strokeStyle = ink(0.62 * strength * (i + 0.5) / LEVELS); ctx.stroke(path); });
    // the crossings in the brightest part of the ring flare as points (only those near it are looked at)
    const crest = radius - band * 0.12, reach = 46;
    buckets.forEach((_, i) => { buckets[i] = new Path2D(); });
    let any = false;
    for (let x = ox + Math.ceil((Math.max(0, cx - crest - reach) - ox) / cell) * cell; x <= Math.min(W, cx + crest + reach); x += cell) {
      const dx = x - cx, ro = crest + reach, ri = crest - reach;
      const yo = Math.sqrt(Math.max(0, ro * ro - dx * dx)), yi = Math.abs(dx) < ri ? Math.sqrt(ri * ri - dx * dx) : 0;
      for (const [lo, hi] of yi ? [[cy - yo, cy - yi], [cy + yi, cy + yo]] : [[cy - yo, cy + yo]]) {
        for (let y = oy + Math.ceil((Math.max(0, lo) - oy) / cell) * cell; y <= Math.min(H, hi); y += cell) {
          const d = Math.abs(Math.hypot(dx, y - cy) - crest);
          if (d > reach) continue;
          const k = 1 - d / reach, rr = 0.8 + 1.6 * k, level = Math.min(LEVELS - 1, Math.floor(k * LEVELS));
          buckets[level].moveTo(x + 0.5 + rr, y + 0.5);
          buckets[level].arc(x + 0.5, y + 0.5, rr, 0, Math.PI * 2);
          any = true;
        }
      }
    }
    if (any) flush(buckets, 0.75 * strength);
    // a hairline on the ring's front edge, the wave's crest
    ctx.strokeStyle = ink(0.2 * strength); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  };

  const step = (now: number) => {
    frame = 0;
    ctx.clearRect(0, 0, W, H);
    // 1. the drop, falling faster and faster (t²), drawn out along its fall with a short fading trail
    if (now >= t0 - FALL && now < t0) {
      const p = (now - (t0 - FALL)) / FALL, y = cy - height * (1 - p * p), stretch = 1 + 1.6 * p;
      const trail = ctx.createLinearGradient(0, y - 34 * p - 4, 0, y);
      trail.addColorStop(0, ink(0)); trail.addColorStop(1, ink(0.35));
      ctx.fillStyle = trail;
      ctx.fillRect(cx - 1, y - 34 * p - 4, 2, 34 * p + 4);
      ctx.fillStyle = ink(0.9);
      ctx.beginPath(); ctx.ellipse(cx, y, 3.4 / Math.sqrt(stretch), 3.4 * stretch, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (now < t0) { frame = requestAnimationFrame(step); return; }
    // 2. it lands: flattened into the line, which runs out to the edges and then withdraws to the card
    const since = now - t0;
    if (since < 90) {
      const k = since / 90;
      ctx.fillStyle = ink(0.9 * (1 - k));
      ctx.beginPath(); ctx.ellipse(cx, cy, 3.4 + 22 * easeOut(k), Math.max(0.5, 3.4 * (1 - k)), 0, 0, Math.PI * 2); ctx.fill();
    }
    if (now < snap + 200) {
      const p = Math.min(1, since / LINE), reach = easeOutQuint(p) * Math.max(cx, W - cx);
      const gone = now < snap ? 0 : easeOut((now - snap) / 200) * reach;
      const grad = ctx.createLinearGradient(cx - reach, 0, cx + reach, 0);
      grad.addColorStop(0, ink(0)); grad.addColorStop(0.15, ink(0.7)); grad.addColorStop(0.85, ink(0.7)); grad.addColorStop(1, ink(0));
      ctx.fillStyle = grad;
      const a = Math.max(cx - reach, left - gone), z = Math.min(cx + reach, right + gone);
      if (now < snap) ctx.fillRect(cx - reach, cy - 0.5, reach * 2, 1);
      else { ctx.fillRect(cx - reach, cy - 0.5, Math.max(0, a - (cx - reach)), 1); ctx.fillRect(z, cy - 0.5, Math.max(0, cx + reach - z), 1); }
    }
    // the splash: three small rings round the point of impact, one after another
    for (let i = 0; i < 3; i++) {
      const k = (since - i * 70) / SPLASH;
      if (k <= 0 || k >= 1) continue;
      ctx.strokeStyle = ink(0.55 * (1 - k) ** 1.5 * (1 - i * 0.25)); ctx.lineWidth = 1.4 - 0.8 * k;
      ctx.beginPath(); ctx.ellipse(cx, cy, (22 + i * 18) * easeOut(k), (22 + i * 18) * easeOut(k) * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // 3. the wave and its echo
    if (now >= wave0) {
      const p = (now - wave0) / WAVE, q = (now - wave0 - ECHO) / WAVE;
      if (p < 1) ring(easeOut(p) * far, (1 - p) ** 1.4, now);
      if (q > 0 && q < 1) ring(easeOut(q) * far * 0.92, 0.45 * (1 - q) ** 1.6, now);
    }
    if (now < end) frame = requestAnimationFrame(step);
    else canvas.remove();
  };
  frame = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(frame); canvas.remove(); };
}
