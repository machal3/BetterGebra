# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bettergebra is a Polish-language graphing calculator, geometry board and CAS: Vite + TypeScript + React 19, deployed as a static site (Vercel). All user-facing strings, including parser error messages, are in Polish. Keep it that way.

## Commands

- `npm run dev` — Vite at http://localhost:5173
- `npm test` — Vitest, `tests/**/*.test.{js,ts}`; one test: `npx vitest run -t "<name regex>"`
- `npm run build` — `tsc --noEmit`, `oxlint --deny-warnings`, `vite build` into `dist/`

## Interface: Affect UI (clean), nothing else

- Components come from the Affect UI registry (`components.json`, `@affectui`), copied into `src/components/ui/`, clean variants only and free ones only (Pro components are neither used nor recreated). Changes to those files are content only (Polish strings, the "Inter Variable" font name), each marked `Bettergebra:`.
- What the registry has no free component for is built in `src/components/controls.tsx|.css` (Field, Switch, Slider, Disclosure, Menu, ColorPicker, Row, Chip, popover/sheet) from the anatomy of the free files. Reuse those; don't style raw `<button>`/`<input>` in a panel.
- Tokens are `--b-*` in `src/styles/tokens.css`, whose header states the contract: Inter Variable, weights 400 and 500 only, ink in alpha steps, the clean files' shadows/radii/motion, and **monochrome chrome** — a picked or switched-on control is the solid chip or the neutral fill; colour is for mathematics and state; blue only in the focus ring. No hex or rgba in panel CSS.
- Dark mode is `data-theme` on `<html>`, always resolved (the components read it, not `prefers-color-scheme`).

## Architecture

- `src/math/` — pure, DOM-free. `compile(input, params)` (`real.ts`) is a hand-written recursive-descent parser that returns a closure `x => y`; it never `eval`s user input (security property, keep it). Implicit multiplication (`2x`, `ax`), unicode normalization (`π`, `²`, `−`, …), single-letter parameters. `params` is held **by reference**: mutating it updates compiled functions without recompiling; unknown parameters default to `1`. `parameterNames()` extracts them; `roots()` samples + bisects (can miss tangent roots).
- `src/state.ts` — the one state object, `commit(topics)` to subscribers, saved in `localStorage['bettergebra.v2']` (with migrations; `recolor()` maps the former palette). React reads it through `useStore(topics)` (`hooks/use-store.ts`).
- Canvases live outside React: `app/graph-runtime.ts` (Wykresy, `render/scene.ts`), `geometry/controller.ts` (Geometria), `app/calculator/plot-engine.ts` (plots in results). `render/viewport.ts`: the view is `{min, max, cy, ratio}` and describes the part of the canvas **beside** the floating panel (`Inset`); `min`/`max`/`top`/`bottom` getters are the canvas edges, `visible` the uncovered part. Canvas colours and fonts come from CSS tokens via `readTheme()`.
- Layout: the canvas fills the page; the side panel is a floating card (`app/Dock.tsx`, a sheet on phones) whose cover is passed to the views as the inset. Panels render through portals into the static containers in `index.html`.
- `src/cas/` — the calculator panel's CAS (runs in `src/cas/worker.ts` via `client.ts`, UI in `src/app/calculator/CalculatorPanel.tsx`). Exact by design: numbers are BigInt rationals, decimals come from `numeric.ts` (BigFloat) and only digits stable across two precisions are printed; antiderivatives, definite integrals, limits and solutions are cross-checked numerically and dropped if the check fails — keep that property. `simplify()` likewise keeps a rewritten form only if `agrees()` finds it equal to the input at sample points, and `integrate()` has a work budget (`MAX_WORK` calls of `int()`), so a hopeless integrand gives up in time. `RULES` in `expr.ts` is filled by `functions.ts` (import it before use; `engine.ts` does). Variables are treated as real (ln(eᵘ) = u, |eᵘ| = eᵘ). Building an expression simplifies (x/x is 1, (√x)² is x), so `evaluate.ts` keeps what the input asks of its variables in `hidden` (each 1/u, √u, ln u … as written); the engine keeps solutions, intervals and domains within it (`within()`, `domain()` in `engine.ts`). A real solution must keep every root, logarithm and power on the way real (`staysReal`), a family of solutions holds for all k, all but one or two, or from some k on — else it is not given; a numeric root is refined with its multiplicity and given exactly only when f vanishes at a simple p/q or pπ/q. Tests: `tests/cas.test.ts`.
- Calculator plots: `src/cas/plot.ts` builds them in the worker (samples, notable points, and each curve as graph-panel text, kept only when `compile()` reads it back to the same values); `src/app/calculator/plot-engine.ts` (with `CalcPlot.tsx`) draws them with the graph panel's renderer (`render/plot2d.ts`, `render/viewport.ts`) and hands them to the graph panel in the mode they need (Wykresy or Zespolone; every row is checked against the page's parser in the worker). The way back is `calculatorQuery()` in `src/calculator-query.ts`. Tests: `tests/cas-plot.test.ts`, `tests/calculator-query.test.ts`.
- Graph panel modes: `graph` (Wykresy) and `complex` (Zespolone); the former Zbiory mode is part of Wykresy. In `model.ts`, `rowKind()` decides per row: a graph y = f(x), or a set — with z or i a set of complex numbers as Zbiory had it (|z − 1| ≤ 2, t + 2i), without them a condition in x and y (x² + y² ≤ 25, y > x², x = 2; `Compiled.xy`), translated to Re z, Im z. Sessions saved in the old `set` mode load with x rewritten to z (`state.ts`). Tests: `tests/model.test.ts`.
