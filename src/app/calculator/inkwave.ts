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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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
  // the backdrop's lines, to light up the very lines that are there (they drift: read where they are each frame)
  const lines = backdrop.querySelector('.ui-gb-lines');
  const cell = parseFloat(getComputedStyle(backdrop.querySelector('.ui-gb') ?? backdrop).getPropertyValue('--ui-gb-size')) || 48;

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

  /** One ring: the grid's lines lit where the ring is, their crossings flaring. */
  const ring = (radius: number, strength: number) => {
    if (strength <= 0.01) return;
    const band = 150, inner = Math.max(0, radius - band), outer = radius + band * 0.35;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, ink(0));
    grad.addColorStop(0.72, ink(0.4 * strength));
    grad.addColorStop(0.8, ink(0.62 * strength));
    grad.addColorStop(1, ink(0));
    const at = lines?.getBoundingClientRect();
    const ox = at ? ((at.left - box.left) % cell + cell) % cell : 0, oy = at ? ((at.top - box.top) % cell + cell) % cell : 0;
    const x0 = Math.max(0, cx - outer), x1 = Math.min(W, cx + outer), y0 = Math.max(0, cy - outer), y1 = Math.min(H, cy + outer);
    ctx.strokeStyle = grad; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox + Math.ceil((x0 - ox) / cell) * cell; x <= x1; x += cell) { ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); }
    for (let y = oy + Math.ceil((y0 - oy) / cell) * cell; y <= y1; y += cell) { ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); }
    ctx.stroke();
    // the crossings in the brightest part of the ring flare as points
    for (let x = ox + Math.ceil((x0 - ox) / cell) * cell; x <= x1; x += cell) {
      for (let y = oy + Math.ceil((y0 - oy) / cell) * cell; y <= y1; y += cell) {
        const d = Math.hypot(x - cx, y - cy) - (radius - band * 0.12);
        if (Math.abs(d) > 46) continue;
        const k = 1 - Math.abs(d) / 46;
        ctx.fillStyle = ink(0.75 * k * strength);
        ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.8 + 1.6 * k, 0, Math.PI * 2); ctx.fill();
      }
    }
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
      if (p < 1) ring(easeOut(p) * far, (1 - p) ** 1.4);
      if (q > 0 && q < 1) ring(easeOut(q) * far * 0.92, 0.45 * (1 - q) ** 1.6);
      for (const m of motes) {
        const age = now - m.born;
        if (age < 0 || age > m.life) continue;
        const k = age / m.life, drag = Math.exp(-age / 380);
        const x = m.x + m.vx * 380 * (1 - drag), y = m.y + m.vy * 380 * (1 - drag) + 0.00002 * age * age;
        ctx.fillStyle = ink(0.8 * (1 - k) ** 1.5);
        ctx.beginPath(); ctx.arc(x, y, m.r * (1 - 0.4 * k), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (now < snap + ECHO + WAVE) frame = requestAnimationFrame(step);
    else canvas.remove();
  };
  frame = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(frame); canvas.remove(); };
}
