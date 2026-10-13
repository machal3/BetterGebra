# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bettergebra is a Polish-language function graphing calculator: vanilla JS + HTML + CSS, no framework, no dependencies (Node.js 20+). All user-facing strings, including parser error messages, are in Polish. Keep it that way.

## Commands

- `npm run dev` — serve at http://localhost:5173 (`--port N` or `PORT` to override; auto-increments if the port is taken)
- `npm test` — `node --test`, runs `math.test.js`
- Single test: `node --test --test-name-pattern="<name regex>"`
- `npm run build` — copies the static files into `dist/`

## Architecture

- `math.js` — pure, DOM-free module. `compile(input, parameters)` is a hand-written recursive-descent parser that returns a closure `x => y`; it never `eval`s user input (security property, keep it). Supports implicit multiplication (`2x`, `ax`), unicode normalization (`π`, `²`, `−`, …), and single-letter parameters. `parameters` is held **by reference**: mutating the object updates already-compiled functions without recompiling. Unknown parameters default to `1`. `parameterNames()` extracts them; `roots()` finds zeros by sampling 2000 points + bisection (can miss tangent roots).
- `app.js` — all UI state and canvas rendering in one module. Up to 8 functions (`MAX`) share one global `parameters` object. View is `{min, max, cy}` (x-range plus y-center, equal scale on both axes); `px/py/fromX/fromY` convert between math and canvas coordinates. Plot colors come from CSS custom properties read by `readTheme()`, so theming lives in `style.css`.
- `server.js` / `build.js` — both hardcode the served file list (`index.html`, `style.css`, `app.js`, `math.js`). **Adding a new static file requires updating both.**
- `src/cas/` — the calculator panel's CAS (Vite + TS, runs in `src/cas/worker.ts` via `client.ts`, UI in `src/ui/calculator.ts`). Exact by design: numbers are BigInt rationals, decimals come from `numeric.ts` (BigFloat) and only digits stable across two precisions are printed; antiderivatives, definite integrals, limits and solutions are cross-checked numerically and dropped if the check fails — keep that property. `RULES` in `expr.ts` is filled by `functions.ts` (import it before use; `engine.ts` does). Variables are treated as real (ln(eᵘ) = u, |eᵘ| = eᵘ). Tests: `tests/cas.test.ts`.
- Calculator plots: `src/cas/plot.ts` builds them in the worker (samples, notable points, and each curve as graph-panel text, kept only when `compile()` reads it back to the same values); `src/ui/calc-plot.ts` draws them with the graph panel's renderer (`render/plot2d.ts`, `render/viewport.ts`) and hands them to the graph panel in the mode they need (`Plot.open`: Wykresy or Zespolone; every row is checked against the page's parser in the worker). The way back is `calculatorQuery()` in `ui/function-list.ts`. Tests: `tests/cas-plot.test.ts`, `tests/calculator-query.test.ts`.
- Graph panel modes: `graph` (Wykresy) and `complex` (Zespolone); the former Zbiory mode is part of Wykresy. In `model.ts`, `rowKind()` decides per row: a graph y = f(x), or a set — with z or i a set of complex numbers as Zbiory had it (|z − 1| ≤ 2, t + 2i), without them a condition in x and y (x² + y² ≤ 25, y > x², x = 2; `Compiled.xy`), translated to Re z, Im z. Sessions saved in the old `set` mode load with x rewritten to z (`state.ts`). Tests: `tests/model.test.ts`.
