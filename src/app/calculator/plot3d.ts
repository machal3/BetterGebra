/**
 * The calculator's plots in space (surf, mesh, plot3): an orthographic view of the box, as MATLAB draws it, on a 2D
 * canvas. Quads are sorted back to front (painter's algorithm) and shaded by the angle to the light; their colour
 * goes with the height, through the math palette. Drag to turn, the wheel or a pinch to zoom; the theme's colours
 * come from the CSS tokens like every canvas of the page.
 */
import type { Scene3 } from '../../cas/engine';
import { LABEL, readTheme } from '../../render/plot2d';
import { PALETTE } from '../../state';
import { format } from '../../format';

export interface Plot3Handle { reset(): void; png(): void; destroy(): void }
/** Every 3D plot redraws when the theme changes. */
const live = new Set<() => void>();
export function redraw3dPlots(): void { for (const d of live) d(); }

const START = { az: -37.5, el: 30, zoom: 1 };
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** Height to colour: blue, cyan, teal, green, orange of the palette. */
const RAMP = [0, 5, 2, 4, 6].map(i => rgb(PALETTE[i]));
function ramp(t: number, light: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(x)), f = x - k;
  const c = RAMP[k].map((v, i) => (v + (RAMP[k + 1][i] - v) * f) * light);
  return `rgb(${c.map(v => Math.round(Math.min(255, v))).join(' ')})`;
}

export function mount3d(scene: Scene3, canvas: HTMLCanvasElement, stage: HTMLElement): Plot3Handle {
  const ctx = canvas.getContext('2d')!;
  let view = { ...START }, W = 0, H = 0, theme = readTheme();
  const [x0, x1, y0, y1, z0, z1] = scene.box;
  // the box as a cube [−1, 1]² × [−0.7, 0.7], as MATLAB's default aspect
  const nx = (x: number) => (2 * (x - x0)) / (x1 - x0 || 1) - 1, ny = (y: number) => (2 * (y - y0)) / (y1 - y0 || 1) - 1, nz = (z: number) => 1.4 * (z - z0) / (z1 - z0 || 1) - 0.7;

  /** Screen point and depth (larger: farther) of a point of the cube. */
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const a = view.az * Math.PI / 180, e = view.el * Math.PI / 180;
    const sx = x * Math.cos(a) + y * Math.sin(a), t = -x * Math.sin(a) + y * Math.cos(a);
    const sy = z * Math.cos(e) + t * Math.sin(e), depth = t * Math.cos(e) - z * Math.sin(e);
    const s = Math.min(W, H) * 0.31 * view.zoom;
    return [W / 2 + s * sx, H / 2 + 0.03 * H - s * sy, depth];
  };

  function draw() {
    ctx.save();
    ctx.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    drawBox();
    // surfaces: every cell a quad, the farthest first
    const quads: { pts: [number, number][]; depth: number; fill: string; edge: string }[] = [];
    for (const s of scene.surfaces) {
      for (let i = 0; i < s.ys.length - 1; i++) for (let j = 0; j < s.xs.length - 1; j++) {
        const c = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
        const zs = c.map(([a, b]) => s.z[a][b]);
        if (zs.some(v => !Number.isFinite(v))) continue;
        const P = c.map(([a, b]) => [nx(s.xs[b]), ny(s.ys[a]), nz(s.z[a][b])]);
        const scr = P.map(p => project(p[0], p[1], p[2]));
        // the normal's angle to a light from the viewer's upper left
        const u = P[2].map((v, k) => v - P[0][k]), w = P[3].map((v, k) => v - P[1][k]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], ln = Math.hypot(...n) || 1;
        const light = 0.62 + 0.38 * Math.abs((n[0] * -0.4 + n[1] * -0.3 + n[2] * 0.87) / ln);
        const t = (zs.reduce((a, b) => a + b, 0) / 4 - z0) / (z1 - z0 || 1);
        quads.push({
          pts: scr.map(p => [p[0], p[1]] as [number, number]), depth: scr.reduce((a, p) => a + p[2], 0) / 4,
          fill: s.wire ? theme.bg : ramp(t, light), edge: s.wire ? ramp(t, 1) : theme.gridMajor,
        });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);
    ctx.lineWidth = 0.6;
    for (const q of quads) {
      ctx.beginPath();
      q.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = q.fill;
      ctx.fill();
      ctx.strokeStyle = q.edge;
      ctx.stroke();
    }
    // curves over everything
    ctx.lineWidth = 2;
    scene.curves.forEach((c, k) => {
      ctx.strokeStyle = PALETTE[(c.color ?? k) % PALETTE.length];
      ctx.beginPath();
      let on = false;
      for (let i = 0; i < c.pts.length; i += 3) {
        const [x, y, z] = [c.pts[i], c.pts[i + 1], c.pts[i + 2]];
        if (![x, y, z].every(Number.isFinite) || z < z0 || z > z1) { on = false; continue; }
        const [sx, sy] = project(nx(x), ny(y), nz(z));
        if (on) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        on = true;
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  /** The three back faces' edges, ticks and the names of the axes. */
  function drawBox() {
    const corners: [number, number, number][] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-0.7, 0.7]) corners.push([x, y, z]);
    const far = corners.reduce((b, c) => (project(...c)[2] > project(...b)[2] ? c : b));
    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 1;
    // the edges through the farthest corner
    for (const k of [0, 1, 2]) {
      const to = far.slice() as [number, number, number];
      to[k] = k === 2 ? -far[2] : -far[k];
      const [ax, ay] = project(...far), [bx, by] = project(...to);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    // the floor's square, and ticks along its front edges
    const floor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => project(x, y, -0.7));
    ctx.beginPath(); floor.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = theme.label;
    ctx.font = LABEL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (x: number, y: number, z: number, text: string) => { const [sx, sy] = project(x, y, z); ctx.fillText(text, sx, sy); };
    const yEdge = far[1] > 0 ? -1.18 : 1.18, xEdge = far[0] > 0 ? -1.18 : 1.18;
    for (const t of [0, 0.5, 1]) {
      label(-1 + 2 * t, yEdge, -0.7, format(x0 + (x1 - x0) * t, 3));
      label(xEdge, -1 + 2 * t, -0.7, format(y0 + (y1 - y0) * t, 3));
    }
    // the z axis on the vertical edge farthest left on the screen, as MATLAB draws it
    const [lx, ly] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].reduce((b, c) => (project(c[0], c[1], -0.7)[0] < project(b[0], b[1], -0.7)[0] ? c : b));
    const [ax, ay] = project(lx, ly, -0.7), [bx, by] = project(lx, ly, 0.7);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.textAlign = 'right';
    for (const t of [0, 0.5, 1]) {
      const [sx, sy] = project(lx, ly, -0.7 + 1.4 * t);
      // the lowest a little above the corner, where the floor's own ticks are
      ctx.fillText(format(z0 + (z1 - z0) * t, 3), sx - 8, t ? sy : sy - 9);
    }
    ctx.textAlign = 'center';
    ctx.font = LABEL.replace('500', '500 italic');
    label(0, yEdge * 1.3, -0.7, 'x');
    label(xEdge * 1.3, 0, -0.7, 'y');
    ctx.fillText('z', bx, by - 12);
  }

  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  });
  ro.observe(stage);
  // turning by dragging, zooming by the wheel or two fingers
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.classList.add('grabbing'); };
  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, d] = [...pointers.values()], d1 = Math.hypot(c.x - d.x, c.y - d.y);
      if (pinch && d0) view.zoom = Math.max(0.3, Math.min(5, view.zoom * d1 / d0));
      pinch = 1;
    } else {
      view.az -= (e.clientX - p.x) * 0.5;
      view.el = Math.max(-90, Math.min(90, view.el + (e.clientY - p.y) * 0.5));
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    draw();
  };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (!pointers.size) canvas.classList.remove('grabbing'); };
  const wheel = (e: WheelEvent) => { e.preventDefault(); view.zoom = Math.max(0.3, Math.min(5, view.zoom * Math.exp(-e.deltaY * 0.0015))); draw(); };
  const key = (e: KeyboardEvent) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [5, 0], ArrowRight: [-5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
    if (step[e.key]) { e.preventDefault(); view.az += step[e.key][0]; view.el = Math.max(-90, Math.min(90, view.el + step[e.key][1])); draw(); }
    else if (e.key === '+' || e.key === '=') { view.zoom = Math.min(5, view.zoom * 1.2); draw(); }
    else if (e.key === '-') { view.zoom = Math.max(0.3, view.zoom / 1.2); draw(); }
    else if (e.key === '0') { view = { ...START }; draw(); }
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  const redraw = () => { theme = readTheme(); draw(); };
  live.add(redraw);
  return {
    reset() { view = { ...START }; draw(); },
    png() {
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'bettergebra-3d.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    },
    destroy() {
      ro.disconnect();
      live.delete(redraw);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', key);
    },
  };
}
