/**
 * Small corrections to how Chromium lays out MathML roots, made once a formula is on the page (results, the
 * preview, the graph panel, anywhere): measured, not guessed, so they hold for any math font.
 *
 * - A root's box runs on past its radicand by up to 0.42em (with STIX Two Math, the amount depends on which size
 *   of √ was drawn), which leaves a hole before what follows: √72  + 1. The extra is measured and taken back.
 * - A coefficient right before a root with an index reads as a power (2³√2 looks like 2 cubed): it gets a thin space.
 * - A function's name after a factor gets a thin space too: 2 cos x, not 2cos x.
 * - The radical itself is drawn here. Chromium sets the √ from the font and its bar as a separate rectangle, which
 *   lands a little higher and heavier than the √'s end, with a step where they meet. The native one is made
 *   transparent and a √ with its bar as one stroke is painted behind the root, to the size the browser laid out.
 */

const GAP_KEPT = 0.06; // em, after the radicand: the vinculum ends just past it
const BEFORE_ROOT = 0.12; // em, between 2 and ³√2
const INVISIBLE_TIMES = String.fromCharCode(0x2062);

const fontSize = (e: Element) => parseFloat(getComputedStyle(e).fontSize) || 16;

const zoomOf = (el: Element) => (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;

function tidyRoot(e: HTMLElement | MathMLElement): void {
  const el = e as MathMLElement;
  el.style.marginInlineEnd = '';
  const box = el.getBoundingClientRect();
  if (!box.width) return;
  // mroot: the radicand is the first child, the index the second; msqrt: every child is radicand
  const parts = el.localName === 'mroot' ? [el.children[0]] : [...el.children];
  const right = Math.max(...parts.map(c => c?.getBoundingClientRect().right ?? -Infinity));
  if (!Number.isFinite(right)) return;
  // rectangles are in zoomed pixels (CSS zoom on an ancestor), the font size is not
  const zoom = zoomOf(el);
  const fs = fontSize(el), extra = (box.right - right) / zoom / fs - GAP_KEPT;
  if (extra > 0.02) el.style.marginInlineEnd = `${-extra.toFixed(3)}em`;
}

const r1 = (v: number) => Math.round(v * 100) / 100;

/** Takes back what drawRadical did, so the native layout can be measured again. */
function undrawRadical(el: MathMLElement): void {
  el.style.removeProperty('color');
  el.style.removeProperty('background');
  for (const c of el.children) (c as MathMLElement).style.removeProperty('color');
}

/**
 * Paints the root's √ and bar as one path, behind the root, where the browser put its own (made transparent).
 * Everything is measured from the laid-out boxes: the radicand, the index of an mroot, the root's own box.
 */
function drawRadical(el: MathMLElement): void {
  const box = el.getBoundingClientRect();
  const kids = [...el.children] as MathMLElement[];
  const radicand = el.localName === 'mroot' ? kids.slice(0, 1) : kids;
  if (!box.width || !radicand.length) return;
  const zoom = zoomOf(el), fs = fontSize(el), ink = getComputedStyle(el).color;
  const rects = radicand.map(c => c.getBoundingClientRect());
  const W = box.width / zoom, H = box.height / zoom;
  const left = (Math.min(...rects.map(r => r.left)) - box.left) / zoom;
  const right = (Math.max(...rects.map(r => r.right)) - box.left) / zoom;
  if (!(left > 0) || !(right > left)) return;
  const thin = 0.06 * fs, heavy = 0.12 * fs; // the weight of the font's strokes
  // the √'s left end: the root's own edge, or for ⁿ√ under its index, which overlaps the hook as in print
  let x0 = 0.04 * fs;
  if (el.localName === 'mroot' && kids[1]) {
    const index = kids[1].getBoundingClientRect();
    x0 = Math.max(x0, Math.min((index.right - box.left) / zoom - 0.4 * fs, left - 0.62 * fs));
  }
  const x3 = left - 0.04 * fs; // the top of the long stroke, where the bar begins
  const bar = 1.5 * thin, bottom = H - 0.04 * fs;
  const hook = bottom - Math.min(0.52 * fs, (bottom - bar) * 0.55);
  const span = x3 - x0;
  const p0 = [x0, hook + 0.09 * fs], p1 = [x0 + span * 0.2, hook], p2 = [x0 + span * 0.5, bottom];
  const end = Math.min(W - thin, right + 0.06 * fs);
  const pt = (p: number[]) => `${r1(p[0])} ${r1(p[1])}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(W)}" height="${r1(H)}" viewBox="0 0 ${r1(W)} ${r1(H)}">`
    + `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M${pt(p0)} L${pt(p1)} M${pt(p2)} L${r1(x3)} ${r1(bar)} H${r1(end)}" stroke-width="${r1(thin)}"/>`
    + `<path d="M${pt(p1)} L${pt(p2)}" stroke-width="${r1(heavy)}"/></g></svg>`;
  el.style.background = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / 100% 100% no-repeat`;
  // the native √ and bar are painted in the root's colour; its radicand and index keep the ink
  el.style.color = 'transparent';
  for (const c of kids) c.style.color = ink;
}

/** The token before a root, past an invisible times (U+2062). */
function before(e: Element): Element | null {
  // the first of a group: what stands before the group (2⁢(cos …) is written <mn>2</mn><mo>⁢</mo><mrow><mi>cos</mi>…)
  while (!e.previousElementSibling && e.parentElement?.localName === 'mrow') e = e.parentElement;
  let p = e.previousElementSibling;
  if (p?.localName === 'mo' && p.textContent === INVISIBLE_TIMES) p = p.previousElementSibling;
  return p;
}

const APPLY = String.fromCharCode(0x2061);
const FUNCTION_SPACE = 0.17; // em, a thin space: 2 cos x, as TeX sets an operator name after a factor

export function tidy(math: Element): void {
  // a function's name after a factor (2cos x, x sin x): kept apart, as an operator name is in print
  for (const name of math.querySelectorAll<MathMLElement>('mi')) {
    if ((name.textContent ?? '').length < 2 || name.nextElementSibling?.textContent !== APPLY) continue;
    const p = before(name);
    name.style.marginInlineStart = p && p.localName !== 'mo' ? `${FUNCTION_SPACE}em` : '';
  }
  const roots = [...math.querySelectorAll<MathMLElement>('msqrt, mroot')];
  for (const r of roots) undrawRadical(r);
  // inner roots first: taking back their extra makes the outer radicand narrower
  for (const r of [...roots].reverse()) tidyRoot(r);
  for (const r of math.querySelectorAll<MathMLElement>('mroot')) {
    const p = before(r);
    const coefficient = p && (p.localName === 'mn' || p.localName === 'mi' || p.localName === 'msup' || p.localName === 'msub');
    r.style.marginInlineStart = coefficient ? `${BEFORE_ROOT}em` : '';
  }
  // once every box is where it stays
  for (const r of roots) drawRadical(r);
}

/** Formulas are tidied when they are first seen: a hidden one (another tab, a closed panel) has no layout yet. */
const seen = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    seen.unobserve(target);
    tidy(target);
  }
});

const watched = new Set<Element>();
function watch(root: ParentNode): void {
  const all = root instanceof Element && root.localName === 'math' ? [root] : [...root.querySelectorAll('math')];
  for (const m of all) { watched.add(m); seen.observe(m); }
}

/** Starts watching the page; returns a function that stops. */
export function startMathTidy(): () => void {
  watch(document.body);
  const added = new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) watch(n);
  });
  added.observe(document.body, { childList: true, subtree: true });
  // a math font arriving later changes every width: measure again what is on the page
  const again = () => {
    for (const m of watched) {
      if (!m.isConnected) { watched.delete(m); continue; }
      seen.unobserve(m);
      seen.observe(m);
    }
  };
  document.fonts.addEventListener('loadingdone', again);
  // the drawn √ is in the ink of the theme it was drawn in
  const theme = new MutationObserver(again);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { added.disconnect(); seen.disconnect(); theme.disconnect(); document.fonts.removeEventListener('loadingdone', again); };
}
