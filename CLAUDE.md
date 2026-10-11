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
