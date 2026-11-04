/**
 * The answer's moment across the whole page, drawn under the cards on one canvas laid over the calculator's
 * drifting grid (Backdrop): in ink only, as the chrome is monochrome.
 *
 *  1. the hairline the card opens out of shoots from the card's middle to both edges of the screen;
 *  2. as the card opens it snaps: the stretch beyond the card falls apart into ink dust, a spray off its ends;
 *  3. a wave runs from the card across the page, lighting up the grid's lines as it passes and its crossings
 *     flaring like points of a lattice; an echo follows, fainter.
 *
 * About 1.3 s in all, one requestAnimationFrame loop, then the canvas is gone. Returns a cancel.
 */
const LINE = 260, WAVE = 1150, ECHO = 200, DUST = 1000;

interface Mote { x: number; y: number; vx: number; vy: number; r: number; born: number; life: number }

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

export function inkWave(backdrop: HTMLElement, card: HTMLElement, delay: number): () => void {
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

  const t0 = performance.now() + delay, snap = t0 + LINE;
  let motes: Mote[] | null = null, frame = 0;

  const burst = (now: number) => {
    const out: Mote[] = [];
    // the line beyond the card falls apart where it lies
    for (let x = 0; x < W; x += 3.5) {
      if (x > left - 2 && x < right + 2) continue;
      const side = x < left ? -1 : 1, near = 1 - Math.min(1, Math.abs(x - (side < 0 ? left : right)) / (W / 2));
      if (Math.random() > 0.45 + 0.5 * near) continue;
      // it crumbles from the card outwards: the farther, the later it lets go
      const lag = (1 - near) * 140;
      out.push({ x, y: cy + (Math.random() - 0.5), vx: side * (0.01 + Math.random() * 0.1), vy: (Math.random() - 0.5) * (0.2 + 0.5 * near), r: 0.7 + Math.random() * 1.2, born: now + lag, life: DUST * (0.55 + Math.random() * 0.45) });
    }
    // a spray off the card's two ends
    for (const [x, side] of [[left, -1], [right, 1]] as const) {
      for (let i = 0; i < 26; i++) {
        const a = (Math.random() - 0.5) * 1.5, v = 0.25 + Math.random() * 0.85;
        out.push({ x, y: cy, vx: side * Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.7 + Math.random() * 1.4, born: now, life: 500 + Math.random() * 450 });
      }
    }
    return out;
  };

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
    if (now < t0) { frame = requestAnimationFrame(step); return; }
    // 1. the line, out from the card's middle to both edges
    if (now < snap + 160) {
      const p = Math.min(1, (now - t0) / LINE), reach = easeOutQuint(p) * Math.max(cx, W - cx);
      // after the snap the line is gone from the card's ends outwards, where the dust takes over
      const gone = now < snap ? 0 : easeOut((now - snap) / 160) * reach;
      const grad = ctx.createLinearGradient(cx - reach, 0, cx + reach, 0);
      grad.addColorStop(0, ink(0)); grad.addColorStop(0.15, ink(0.75)); grad.addColorStop(0.85, ink(0.75)); grad.addColorStop(1, ink(0));
      ctx.fillStyle = grad;
      const a = Math.max(cx - reach, left - gone), z = Math.min(cx + reach, right + gone);
      if (now < snap) ctx.fillRect(cx - reach, cy - 0.5, reach * 2, 1);
      else { ctx.fillRect(cx - reach, cy - 0.5, Math.max(0, a - (cx - reach)), 1); ctx.fillRect(z, cy - 0.5, Math.max(0, cx + reach - z), 1); }
    }
    // 2–3. the snap: dust, and the waves
    if (now >= snap) {
      motes ??= burst(now);
      const p = (now - snap) / WAVE, q = (now - snap - ECHO) / WAVE;
      if (p < 1) ring(easeOut(p) * far, (1 - p) ** 1.4, now);
      if (q > 0 && q < 1) ring(easeOut(q) * far * 0.92, 0.45 * (1 - q) ** 1.6, now);
      // the dust, sorted into a few paths by how faded it is
      buckets.forEach((_, i) => { buckets[i] = new Path2D(); });
      let any = false;
      for (const m of motes) {
        const age = now - m.born;
        if (age < 0 || age > m.life) continue;
        const k = age / m.life, drag = Math.exp(-age / 380), size = 2 * m.r * (1 - 0.4 * k);
        const x = m.x + m.vx * 380 * (1 - drag), y = m.y + m.vy * 380 * (1 - drag) + 0.00002 * age * age;
        const dot = buckets[Math.min(LEVELS - 1, Math.floor((1 - k) ** 1.5 * LEVELS))];
        dot.moveTo(x + size / 2, y); dot.arc(x, y, size / 2, 0, Math.PI * 2);
        any = true;
      }
      if (any) flush(buckets, 0.8);
    }
    if (now < snap + ECHO + WAVE) frame = requestAnimationFrame(step);
    else canvas.remove();
  };
  frame = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(frame); canvas.remove(); };
}
