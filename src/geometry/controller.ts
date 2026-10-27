/**
 * The Geometry board: a drawing board in the spirit of GeoGebra Geometry. Pick a tool, click points (or the empty
 * plane, which makes them); drag with "Przesuń" and everything built on the dragged points follows.
 * This module owns the construction, the canvas, the pointer, undo and saving; the panel around it (tools, object
 * list, inspector, value dialog, toolbar) is React (app/geometry), which reads it through geoStore and acts through
 * the functions exported here.
 */
import { format } from '../format';
import { constant } from '../math';
import { LABEL, SERIF, drawAxes, drawGrid, readTheme } from '../render/plot2d';
import { Viewport, minorOf, panned, tick, zoomed } from '../render/viewport';
import type { View } from '../state';
import { toast } from '../app/toast';
import { angle as angleValue, parseInput, type Parsed } from './commands';
import {
  compute, dependents, describe, distanceTo, freeAncestors, intersections, isCurve, isLine, isPoint, isRegion, nextName, pointOn, primed, project, topoSort,
  type Def, type Draft, type GeoObject, type Kind, type Line, type Pt, type Shape, type Style,
} from './construct';

type Slot = 'point' | 'line' | 'curve' | 'circle' | 'vector' | 'region' | 'pointOrLine' | 'any';
const FITS: Record<Slot, (s: Shape) => boolean> = {
  point: isPoint, line: isLine, curve: isCurve, circle: s => s.kind === 'circle', vector: s => s.kind === 'vector',
  region: isRegion, pointOrLine: s => isPoint(s) || isLine(s), any: s => s.kind !== 'measure',
};

export interface Ask {
  label: string;
  initial: string;
  /** Read as an angle: 40 means 40°, π/4 means π/4; the value passed on is in radians. */
  angle?: boolean;
  /** Why the value won't do, or null. */
  check: (v: number) => string | null;
  /** Builds from the picked ids and the value; returns the id to select. */
  run: (ids: number[], v: number) => number | undefined;
}
export interface Tool {
  label: string;
  hint: string;
  /** What to pick, in any order a click allows; a click on empty plane fills the next point slot. */
  needs?: Slot[];
  /** The objects built from the picks, also previewed while the last point follows the cursor. */
  make?: (ids: number[]) => Draft[];
  /** Keep only the objects that exist right now (intersections, tangents); this text when there are none. */
  existing?: string;
  ask?: Ask;
}

const by = (kind: Kind, def: Def) => (of: number[]): Draft[] => [{ kind, def, of }];
const positive = (what: string) => (v: number) => Number.isFinite(v) && v > 0 ? null : `${what} musi być liczbą dodatnią.`;

/** The image of the picked object under a transformation about the picked point, line or vector. */
const image = (def: Def, value?: number) => ([obj, by]: number[]): Draft[] => {
  const src = objects.find(o => o.id === obj);
  return src ? [{ kind: src.kind, def, of: [obj, by], value, imageOf: src.name }] : [];
};
const imageOf = (def: Def) => (ids: number[], v: number) => add(image(def, v)(ids)).at(-1);

export const TOOLS = {
  move: { label: 'Przesuń', hint: 'Przeciągnij punkt lub figurę. Tło przesuwa widok.' },
  hide: { label: 'Pokaż / ukryj', hint: 'Kliknij obiekt, aby go ukryć lub pokazać. Ukryte widać tu półprzezroczyste.' },
  delete: { label: 'Usuń', hint: 'Kliknij obiekt, aby go usunąć z zależnymi.' },

  point: { label: 'Punkt', hint: 'Kliknij płaszczyznę, linię lub przecięcie.' },
  intersect: { label: 'Przecięcie', hint: 'Wybierz dwie linie, okręgi lub łuki.', needs: ['curve', 'curve'], existing: 'Te obiekty się nie przecinają.', make: ([a, b]) => [0, 1].map(index => ({ kind: 'point' as const, def: 'intersect' as const, of: [a, b], index })) },
  midpoint: { label: 'Środek', hint: 'Wybierz dwa punkty, odcinek albo okrąg.', needs: ['point', 'point'], make: by('point', 'midpoint') },
  foot: { label: 'Rzut', hint: 'Wybierz punkt i prostą: spodek prostopadłej.', needs: ['point', 'line'], make: by('point', 'foot') },
  centroid: { label: 'Środek ciężkości', hint: 'Wybierz trzy wierzchołki trójkąta: przecięcie środkowych.', needs: ['point', 'point', 'point'], make: by('point', 'centroid') },
  orthocenter: { label: 'Ortocentrum', hint: 'Wybierz trzy wierzchołki trójkąta: przecięcie wysokości.', needs: ['point', 'point', 'point'], make: by('point', 'orthocenter') },
  incenter: { label: 'Środek okręgu wpisanego', hint: 'Wybierz trzy wierzchołki trójkąta: przecięcie dwusiecznych.', needs: ['point', 'point', 'point'], make: by('point', 'incenter') },
  circumcenter: { label: 'Środek okręgu opisanego', hint: 'Wybierz trzy wierzchołki trójkąta: przecięcie symetralnych.', needs: ['point', 'point', 'point'], make: by('point', 'circumcenter') },

  segment: { label: 'Odcinek', hint: 'Wybierz dwa punkty.', needs: ['point', 'point'], make: by('segment', 'through') },
  segmentLength: {
    label: 'Odcinek o długości', hint: 'Wybierz początek i podaj długość.', needs: ['point'],
    ask: { label: 'Długość odcinka', initial: '5', check: positive('Długość'), run: ([a], v) => add([{ kind: 'segment', def: 'through', of: [a, add([{ kind: 'point', def: 'offset', of: [a], value: v }])[0]] }])[0] },
  },
  line: { label: 'Prosta', hint: 'Wybierz dwa punkty.', needs: ['point', 'point'], make: by('line', 'through') },
  ray: { label: 'Półprosta', hint: 'Wybierz początek, potem drugi punkt.', needs: ['point', 'point'], make: by('ray', 'through') },
  vector: { label: 'Wektor', hint: 'Wybierz początek, potem koniec.', needs: ['point', 'point'], make: by('vector', 'through') },

  lineSlope: {
    label: 'Prosta o nachyleniu', hint: 'Wybierz punkt i podaj współczynnik kierunkowy a.', needs: ['point'],
    ask: { label: 'Współczynnik kierunkowy a (y = ax + b)', initial: '1', check: v => Number.isFinite(v) ? null : 'Podaj liczbę.', run: ([p], m) => add([{ kind: 'line', def: 'slope', of: [p], value: m }])[0] },
  },
  perpendicular: { label: 'Prostopadła', hint: 'Wybierz punkt i prostą.', needs: ['point', 'line'], make: by('line', 'perpendicular') },
  parallel: { label: 'Równoległa', hint: 'Wybierz punkt i prostą.', needs: ['point', 'line'], make: by('line', 'parallel') },
  bisector: { label: 'Symetralna', hint: 'Wybierz dwa punkty.', needs: ['point', 'point'], make: by('line', 'bisector') },
  angleBisector: { label: 'Dwusieczna', hint: 'Wybierz punkt, wierzchołek, punkt.', needs: ['point', 'point', 'point'], make: by('line', 'angleBisector') },
  tangent: { label: 'Styczne', hint: 'Wybierz punkt i okrąg.', needs: ['point', 'circle'], existing: 'Z punktu wewnątrz okręgu nie ma stycznych.', make: ([p, c]) => [0, 1].map(index => ({ kind: 'line' as const, def: 'tangent' as const, of: [p, c], index })) },

  polygon: { label: 'Wielokąt', hint: 'Wybierz wierzchołki, na koniec znów pierwszy.' },
  regular: {
    label: 'Wielokąt foremny', hint: 'Wybierz dwa wierzchołki i podaj liczbę boków.', needs: ['point', 'point'],
    ask: {
      label: 'Liczba wierzchołków', initial: '6', check: v => Number.isInteger(v) && v >= 3 && v <= 60 ? null : 'Podaj liczbę całkowitą od 3 do 60.',
      run: ([a, b], n) => polygonFrom([a, b, ...add(Array.from({ length: n - 2 }, (_, i) => ({ kind: 'point' as const, def: 'regular' as const, of: [a, b], index: i + 2, value: n })))]),
    },
  },

  circle: { label: 'Okrąg', hint: 'Wybierz środek, potem punkt na okręgu.', needs: ['point', 'point'], make: by('circle', 'through') },
  circleRadius: {
    label: 'Okrąg o promieniu', hint: 'Wybierz środek i podaj promień.', needs: ['point'],
    ask: { label: 'Promień okręgu', initial: '3', check: positive('Promień'), run: ([c], r) => add([{ kind: 'circle', def: 'radius', of: [c], value: r }])[0] },
  },
  incircle: { label: 'Okrąg wpisany', hint: 'Wybierz trzy wierzchołki trójkąta.', needs: ['point', 'point', 'point'], make: by('circle', 'incircle') },
  compass: { label: 'Cyrkiel', hint: 'Wybierz dwa punkty (rozwarcie), potem środek.', needs: ['point', 'point', 'point'], make: by('circle', 'compass') },
  circle3: { label: 'Okrąg przez 3', hint: 'Wybierz trzy punkty okręgu.', needs: ['point', 'point', 'point'], make: by('circle', 'three') },
  semicircle: { label: 'Półokrąg', hint: 'Wybierz końce średnicy (łuk idzie w lewo od kierunku).', needs: ['point', 'point'], make: by('arc', 'semicircle') },
  arc: { label: 'Łuk', hint: 'Wybierz środek, początek łuku, koniec (przeciwnie do wskazówek zegara).', needs: ['point', 'point', 'point'], make: by('arc', 'arc') },
  sector: { label: 'Wycinek koła', hint: 'Wybierz środek, początek łuku, koniec (przeciwnie do wskazówek zegara).', needs: ['point', 'point', 'point'], make: by('sector', 'arc') },

  angle: { label: 'Kąt', hint: 'Wybierz punkt, wierzchołek, punkt.', needs: ['point', 'point', 'point'], make: by('angle', 'through') },
  angleSize: {
    label: 'Kąt o mierze', hint: 'Wybierz punkt i wierzchołek, podaj miarę.', needs: ['point', 'point'],
    ask: {
      label: 'Miara kąta, przeciwnie do wskazówek zegara (np. 40 albo π/4)', initial: '45', angle: true, check: v => v > 0 && v < 2 * Math.PI ? null : 'Podaj miarę od 0° do 360°.',
      run: ([a, v], t) => add([{ kind: 'angle', def: 'oriented', of: [a, v, ...image('rotate', t)([a, v]).map(d => add([d])[0])] }])[0],
    },
  },
  distance: { label: 'Odległość', hint: 'Wybierz dwa punkty, punkt i prostą albo odcinek.', needs: ['point', 'pointOrLine'], make: by('measure', 'distance') },
  area: { label: 'Pole', hint: 'Wybierz wielokąt, okrąg lub wycinek.', needs: ['region'], make: by('measure', 'area') },

  reflectLine: { label: 'Symetria osiowa', hint: 'Wybierz obiekt, potem oś symetrii.', needs: ['any', 'line'], make: image('reflect') },
  reflectPoint: { label: 'Symetria środkowa', hint: 'Wybierz obiekt, potem środek symetrii.', needs: ['any', 'point'], make: image('reflect') },
  rotate: {
    label: 'Obrót', hint: 'Wybierz obiekt i środek obrotu, podaj kąt.', needs: ['any', 'point'],
    ask: { label: 'Kąt obrotu, przeciwnie do wskazówek zegara (np. 90 albo π/2)', initial: '90', angle: true, check: v => Number.isFinite(v) ? null : 'Podaj liczbę.', run: imageOf('rotate') },
  },
  translate: { label: 'Przesunięcie', hint: 'Wybierz obiekt, potem wektor.', needs: ['any', 'vector'], make: image('translate') },
  dilate: {
    label: 'Jednokładność', hint: 'Wybierz obiekt i środek, podaj skalę.', needs: ['any', 'point'],
    ask: { label: 'Skala jednokładności k', initial: '2', check: v => Number.isFinite(v) && v !== 0 ? null : 'Skala musi być różna od zera.', run: imageOf('dilate') },
  },
} satisfies Record<string, Tool>;
export type ToolId = keyof typeof TOOLS;
export const toolOf = (id: ToolId): Tool => TOOLS[id];

/** Icons in two tones: what the tool starts from in grey, hollow points for the picks, what it makes in the accent. */
const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const pt = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.9" class="pt"/>`;
const made = (x: number, y: number, r = 2.2) => `<circle cx="${x}" cy="${y}" r="${r}" class="fill acc"/>`;
const acc = (paths: string) => `<g class="acc">${paths}</g>`;
const filled = (d: string) => `<path d="${d}" class="soft"/><path d="${d}"/>`;
const thin = 'stroke-width="0.9"', dash = 'stroke-dasharray="2 2.4"';
const TRIANGLE = '<path d="M12 4 3.5 19.5h17z"/>', WEDGE = 'M4 19h7A7 7 0 0 0 8.52 13.65z';
export const ICON: Record<ToolId, string> = {
  move: icon('<path d="M6 3.5v15.2l4.1-4.1 2.7 6 2.6-1.1-2.7-6h5.8z"/>'),
  hide: icon('<path d="M3 3l18 18M10.6 5.6A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  delete: icon('<path d="M4 7h16M9.5 7V5.2c0-.66.54-1.2 1.2-1.2h2.6c.66 0 1.2.54 1.2 1.2V7"/><path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5"/>'),

  point: icon(`<circle cx="12" cy="12" r="6.5" class="soft acc"/>${made(12, 12, 2.8)}`),
  intersect: icon(`<path d="M4 6.5 20 17.5M4 17.5 20 6.5"/>${made(12, 12, 2.6)}`),
  midpoint: icon(`<path d="M4 18 20 6"/>${pt(4, 18)}${pt(20, 6)}${made(12, 12)}`),
  foot: icon(`<path d="M3 18.5h18"/><path d="M12 5.5v13" ${thin} ${dash}/><path d="M12 15.5h3v3" ${thin}/>${pt(12, 5)}${made(12, 18.5)}`),
  centroid: icon(`${TRIANGLE}<path d="M12 4v15.5M3.5 19.5l12.75-7.75M20.5 19.5 7.75 11.75" ${thin} ${dash}/>${made(12, 14.33)}`),
  orthocenter: icon(`${TRIANGLE}<path d="M12 4v15.5M3.5 19.5l13.07-7.17M20.5 19.5 7.43 12.33" ${thin} ${dash}/>${made(12, 14.84)}`),
  incenter: icon(`${TRIANGLE}<circle cx="12" cy="14.47" r="5.03" ${thin} ${dash}/>${made(12, 14.47)}`),
  circumcenter: icon(`<circle cx="12" cy="12" r="8.5" ${thin} ${dash}/><path d="M12 3.5 4.64 16.25h14.72z"/>${made(12, 12)}`),

  segment: icon(`${acc('<path d="M5 19 19 5"/>')}${pt(5, 19)}${pt(19, 5)}`),
  segmentLength: icon(`<path d="M5 9.5h14M5 7.5v4M19 7.5v4" ${thin}/>${acc('<path d="M5 16h14"/>')}${pt(5, 16)}${pt(19, 16)}`),
  line: icon(`${acc('<path d="M2.5 21.5 21.5 2.5"/>')}${pt(8, 16)}${pt(16, 8)}`),
  ray: icon(`${acc('<path d="M5 19 21.5 2.5"/>')}${pt(5, 19)}${pt(12, 12)}`),
  vector: icon(`${acc('<path d="M5 19 18 6M11 5.5h7.5V13"/>')}${pt(5, 19)}`),

  lineSlope: icon(`<path d="M7.5 16h7.9V9" ${thin} ${dash}/>${acc('<path d="M3 20 21 4"/>')}${pt(7.5, 16)}`),
  perpendicular: icon(`<path d="M3 18.5h18"/><path d="M12 15h3.5v3.5" ${thin}/>${acc('<path d="M12 3v15.5"/>')}${pt(12, 7)}`),
  parallel: icon(`<path d="M3 16.5 16.5 3"/>${acc('<path d="M7.5 21 21 7.5"/>')}${pt(14.25, 14.25)}`),
  bisector: icon(`<path d="M4 15.5h16"/><path d="M8 14v3M16 14v3" ${thin}/>${acc('<path d="M12 3v18"/>')}${pt(4, 15.5)}${pt(20, 15.5)}`),
  angleBisector: icon(`<path d="M20.5 19H4l10-15"/>${acc('<path d="M4 19 20 10.4"/>')}`),
  tangent: icon(`<circle cx="14.5" cy="14" r="6"/>${acc('<path d="M3 4 20.5 9.6M3 4l7.8 16.2"/>')}${pt(3, 4)}`),

  polygon: icon(`${acc(filled('M5 18 8 5l11 4-1 9z'))}${pt(5, 18)}${pt(8, 5)}${pt(19, 9)}${pt(18, 18)}`),
  regular: icon(`${acc(filled('M3.5 12 7.75 4.64h8.5L20.5 12l-4.25 7.36h-8.5z'))}${pt(7.75, 19.36)}${pt(16.25, 19.36)}`),

  circle: icon(`${acc('<circle cx="12" cy="12" r="8.5"/>')}${pt(12, 12)}${pt(20.5, 12)}`),
  circleRadius: icon(`<path d="M12 12h8.5" ${thin} ${dash}/>${acc('<circle cx="12" cy="12" r="8.5"/>')}${pt(12, 12)}`),
  incircle: icon(`${TRIANGLE}${acc('<circle cx="12" cy="14.47" r="5.03"/>')}`),
  compass: icon(`<path d="M12 2.5v3"/><circle cx="12" cy="7" r="1.6"/><path d="M11.3 8.5 6.5 20.5M8.5 15.5h7"/>${acc('<path d="M12.7 8.5l4.8 12"/>')}`),
  circle3: icon(`${acc('<circle cx="12" cy="12" r="8"/>')}${pt(12, 4)}${pt(5.07, 16)}${pt(18.93, 16)}`),
  semicircle: icon(`<path d="M3.5 16h17" ${thin} ${dash}/>${acc('<path d="M3.5 16a8.5 8.5 0 0 1 17 0"/>')}${pt(3.5, 16)}${pt(20.5, 16)}`),
  arc: icon(`<path d="M6 18h13M6 18V5" ${thin} ${dash}/>${acc('<path d="M19 18A13 13 0 0 0 6 5"/>')}${pt(6, 18)}${pt(19, 18)}${pt(6, 5)}`),
  sector: icon(`${acc(filled('M6 18h13A13 13 0 0 0 6 5z'))}${pt(6, 18)}`),

  angle: icon(`<path d="M20.5 19H4l11-13"/>${acc(`<path d="${WEDGE}" class="soft"/><path d="M11 19A7 7 0 0 0 8.52 13.65"/>`)}`),
  angleSize: icon(`<path d="M20.5 19H4l11-13"/>${acc(`<path d="${WEDGE}" class="soft"/><path d="M11 19A7 7 0 0 0 8.52 13.65"/><circle cx="18.5" cy="6.5" r="2.2"/>`)}`),
  distance: icon(`<path d="M4 7v8M20 7v8" ${thin}/>${acc('<path d="M6 11h12M8.5 8.5 6 11l2.5 2.5M15.5 8.5 18 11l-2.5 2.5"/>')}${pt(4, 17)}${pt(20, 17)}`),
  area: icon(`${acc('<path d="M4 18 8 5l12 5-3 9z" class="soft"/>')}<path d="M4 18 8 5l12 5-3 9z"/>`),

  reflectLine: icon(`<path d="M12 2.5v19" ${thin} ${dash}/><path d="M9 7 4 17h5z"/>${acc('<path d="M15 7l5 10h-5z"/>')}`),
  reflectPoint: icon(`<path d="M3.5 5 10 6.5 7 10.5z"/>${acc('<path d="M20.5 19 14 17.5l3-4z"/>')}${pt(12, 12)}`),
  rotate: icon(`${acc('<path d="M20 12a8 8 0 1 1-3-6.2M17 2v4h-4"/>')}${pt(12, 12)}`),
  translate: icon(`<path d="M3 14l3.5-7 3.5 7z"/><path d="M5 19h13M15.5 16.5 18 19l-2.5 2.5" ${thin}/>${acc('<path d="M14 14l3.5-7 3.5 7z"/>')}`),
  dilate: icon(`<path d="M3 20 15 4M3 20l14-5" ${thin} ${dash}/><path d="M6 17 9 12l1 5.5z"/>${acc('<path d="M9 14 15 4l2 11z"/>')}${pt(3, 20)}`),
};

/**
 * By kind of object, each tool one way of defining it (a tool may sit in two groups); the favourites come first.
 * [tool, label] names the tool by that way: a circle from "Środek i punkt", "Przez 3 punkty"…
 */
export type GroupEntry = ToolId | [ToolId, string];
export const GROUPS: { name: string; tools: GroupEntry[] }[] = [
  { name: 'Edycja', tools: ['move', 'hide', 'delete'] },
  { name: 'Punkty', tools: [['point', 'Swobodny / na obiekcie'], 'intersect', ['midpoint', 'Środek odcinka lub okręgu'], ['foot', 'Rzut na prostą']] },
  { name: 'Punkty szczególne trójkąta', tools: ['centroid', 'orthocenter', 'incenter', 'circumcenter'] },
  { name: 'Odcinki i wektory', tools: [['segment', 'Dwa końce'], ['segmentLength', 'Początek i długość'], ['vector', 'Wektor']] },
  { name: 'Proste', tools: [['line', 'Dwa punkty'], ['lineSlope', 'Punkt i nachylenie'], ['parallel', 'Równoległa przez punkt'], ['perpendicular', 'Prostopadła przez punkt'], 'bisector', 'angleBisector', ['tangent', 'Styczne z punktu'], 'ray'] },
  { name: 'Wielokąty', tools: [['polygon', 'Wierzchołki'], ['regular', 'Foremny: bok i n']] },
  { name: 'Okręgi i łuki', tools: [['circle', 'Środek i punkt'], ['circleRadius', 'Środek i promień'], ['circle3', 'Przez 3 punkty'], ['compass', 'Cyrkiel: odcinek i środek'], ['incircle', 'Wpisany w trójkąt'], 'semicircle', 'arc', 'sector'] },
  { name: 'Pomiary', tools: ['angle', 'angleSize', 'distance', 'area'] },
  { name: 'Przekształcenia', tools: ['reflectLine', 'reflectPoint', 'rotate', 'translate', 'dilate'] },
];

// --- State ---
const STORE = 'bettergebra.geometry';
const HOME: View = { min: -10, max: 10, cy: 0, ratio: 1 };
let objects: GeoObject[] = [];
let shapes = new Map<number, Shape | null>();
let nextId = 1;
let view: View = { ...HOME };
let grid = false, axes = false;
let tool: ToolId = 'move';
/** Objects picked so far for the current tool, by slot (polygon: in click order). */
let picked: (number | undefined)[] = [];
let selected: number | null = null;
let pointer: { x: number; y: number } | null = null;
/** A button or finger is down on the canvas: no hover feedback meanwhile. */
let pressed = false;
let undoStack: string[] = [], redoStack: string[] = [];

let canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width = 0, height = 0, frame = 0, slop = 8;
const vp = () => new Viewport(view, width, height);

// --- What the panel around the board reads ---
/** A question for a value (length, radius, angle…) the panel shows as a dialog. */
export interface Asking { ask: Ask; answer: (value: number | null) => void }
let asking: Asking | null = null;
let version = 0;
const listeners = new Set<() => void>();
let notifying = 0;
/** Tells the panel something changed; many changes in one frame (a drag) reach it once. */
function notify(): void {
  version++;
  notifying ||= requestAnimationFrame(() => { notifying = 0; for (const l of listeners) l(); });
}
export const geoStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  version: () => version,
  get objects() { return objects; },
  get shapes() { return shapes; },
  get selected() { return selected; },
  get tool() { return tool; },
  get picking() { return picked.some(v => v !== undefined); },
  get grid() { return grid; },
  get axes() { return axes; },
  get canUndo() { return undoStack.length > 0; },
  get canRedo() { return redoStack.length > 0; },
  get asking() { return asking; },
};
/** Called when a double-click on a point asks for its coordinates to be typed. */
let focusCoords: () => void = () => {};
export const onFocusCoords = (fn: () => void) => { focusCoords = fn; };

/**
 * Adds the drafts (a draft may refer to an earlier one of the batch as −1, −2…). A draft listed in `replace` takes
 * the place of that object instead, keeping its id, so everything built on it follows the new definition.
 */
function add(drafts: Draft[], replace = new Map<number, GeoObject>()): number[] {
  const taken = new Set(objects.map(o => o.name)), ids: number[] = [];
  drafts.forEach(({ imageOf, name, ...d }, i) => {
    const old = replace.get(i);
    const fresh = name && (!taken.has(name) || name === old?.name) ? name : old ? old.name : imageOf ? primed(imageOf, taken) : nextName(d.kind, taken);
    const o: GeoObject = { ...d, of: d.of.map(id => id < 0 ? ids[-id - 1] : id), id: old?.id ?? nextId++, name: fresh };
    if (old?.hidden) o.hidden = true;
    if (old?.style) o.style = old.style;
    if (old) objects[objects.indexOf(old)] = o; else objects.push(o);
    taken.add(o.name);
    ids.push(o.id);
  });
  return ids;
}

/**
 * Adds an object from its written definition, or redefines one: the named one ("c = Okrąg(A; 3)" when c exists) or
 * `target`. Returns what is wrong, or null.
 */
export function define(text: string, target?: GeoObject): string | null {
  let parsed: Parsed;
  try { parsed = parseInput(text, objects); } catch (e) { return e instanceof Error ? e.message : String(e); }
  const { name, drafts, main } = parsed, victim = target ?? objects.find(o => o.name === name);
  if (name) drafts[main].name = name;
  const replace = new Map<number, GeoObject>();
  if (victim) {
    const loop = dependents(objects, victim.id);
    if (drafts.some(d => d.of.some(id => loop.has(id)))) return 'Obiekt nie może zależeć od siebie ani od obiektów zbudowanych na nim.';
    if (name && name !== victim.name && objects.some(o => o.name === name)) return `Nazwa „${name}” jest zajęta.`;
  }
  checkpoint();
  if (victim) {
    replace.set(main, victim);
    // A polygon's sides become the new sides, in order; sides left over go, with what was built on them.
    const oldSides = objects.filter(o => o.def === 'edge' && o.of[2] === victim.id), newSides = drafts.flatMap((d, i) => d.def === 'edge' ? [i] : []);
    newSides.forEach((d, k) => { if (oldSides[k]) replace.set(d, oldSides[k]); });
    for (const side of oldSides.slice(newSides.length)) { const gone = dependents(objects, side.id); objects = objects.filter(o => !gone.has(o.id)); }
  }
  const ids = add(drafts, replace);
  objects = topoSort(objects);
  // An image is of its original's kind: when c becomes a line, so does its reflection c′ (in order, so c″ too).
  const byId = new Map(objects.map(o => [o.id, o]));
  for (const o of objects) {
    if (o.def !== 'reflect' && o.def !== 'rotate' && o.def !== 'translate' && o.def !== 'dilate') continue;
    const source = byId.get(o.of[0]);
    if (source && source.kind !== o.kind) o.kind = source.kind;
  }
  selected = ids[main];
  update();
  return null;
}

/** A polygon on the given vertices, with its sides as segments (so they can be intersected, measured…). */
function polygonFrom(vertices: number[]): number {
  const [poly] = add([{ kind: 'polygon', def: 'through', of: vertices }]);
  add(vertices.map((p, i) => ({ kind: 'segment' as const, def: 'edge' as const, of: [p, vertices[(i + 1) % vertices.length], poly] })));
  return poly;
}

/** The drafts that exist now, without repeats (a tangent from a point on the circle comes twice). */
function existing(drafts: Draft[]): Draft[] {
  const trial = compute([...objects, ...drafts.map((d, i) => ({ ...d, id: -10 - i, name: '' }))]), seen = new Set<string>();
  return drafts.filter((_, i) => {
    const s = trial.get(-10 - i), key = JSON.stringify(s, (_, v) => typeof v === 'number' ? Math.round(v * 1e9) : v);
    if (!s || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Undo ---
const snapshot = () => JSON.stringify(objects);
function checkpoint(): void {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}
/** The checkpoint a drawing tool took on its first click, with the redo history it cleared. */
let toolStart: { depth: number; redo: string[] } | null = null;
function startTool(): void {
  const redo = redoStack;
  checkpoint();
  toolStart = { depth: undoStack.length, redo };
}
/** The tool was cancelled (its dialog closed): back to before its first click, points it placed and redo history included. */
function cancelTool(): void {
  if (toolStart && undoStack.length === toolStart.depth) { objects = JSON.parse(undoStack.pop()!); redoStack = toolStart.redo; }
  toolStart = null;
}
function travel(from: string[], to: string[]): void {
  const now = snapshot();
  let s: string | undefined;
  while ((s = from.pop()) === now); // skip checkpoints after which nothing changed
  if (s === undefined) return;
  to.push(now);
  objects = JSON.parse(s);
  picked = [];
  if (selected !== null && !objects.some(o => o.id === selected)) selected = null;
  update();
}

// --- Persistence ---
const KINDS = new Set<Kind>(['point', 'segment', 'line', 'ray', 'vector', 'circle', 'arc', 'sector', 'polygon', 'angle', 'measure']);
let saveTimer = 0;
function save(): void {
  try { localStorage.setItem(STORE, JSON.stringify({ objects, view, grid, axes })); } catch { /* private mode: don't remember */ }
}
function restore(): void {
  let data: { objects?: GeoObject[]; view?: View; grid?: boolean; axes?: boolean } | null = null;
  try { data = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { /* corrupt: start empty */ }
  if (!data) return;
  const seen = new Set<number>();
  // Keep only well-formed objects whose inputs came before them, so compute() never meets a forward reference.
  objects = (Array.isArray(data.objects) ? data.objects : []).filter(o => {
    const ok = o && Number.isInteger(o.id) && !seen.has(o.id) && typeof o.name === 'string' && KINDS.has(o.kind)
      && Array.isArray(o.of) && o.of.every(id => seen.has(id));
    if (ok) seen.add(o.id);
    return ok;
  });
  nextId = Math.max(0, ...seen) + 1;
  const v = data.view;
  if (v && [v.min, v.max, v.cy].every(Number.isFinite) && v.max > v.min) view = { min: v.min, max: v.max, cy: v.cy, ratio: 1 };
  grid = !!data.grid;
  // Saved before the axes had their own switch: they went with the grid.
  axes = !!(data.axes ?? grid);
}

function update(): void {
  shapes = compute(objects);
  renderList();
  request();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 400);
}

// --- Hit testing (px) ---
const ARC = 22;
function distancePx(s: Shape, x: number, y: number): number {
  const v = vp();
  if (s.kind === 'measure') return Math.hypot(v.px(s.x) - x, v.py(s.y) - y) < 24 ? 0 : Infinity;
  if (s.kind === 'angle') {
    const X = v.px(s.x), Y = v.py(s.y), a = Math.atan2(Y - y, x - X), off = ((a - s.from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.hypot(x - X, y - Y) < ARC + 4 && off <= s.sweep ? 0 : Infinity;
  }
  return distanceTo(s, v.fromX(x), v.fromY(y)) * v.scale;
}
/** The object under (x; y) px that `accept`s: points first, then lines, circles and angles, then region insides. */
function hit(x: number, y: number, accept: (s: Shape) => boolean = () => true): number | null {
  let best: number | null = null, bestScore = Infinity;
  for (const o of objects) {
    const s = shapes.get(o.id);
    if (!s || (o.hidden && tool !== 'hide') || !accept(s)) continue;
    const d = distancePx(s, x, y), reach = s.kind === 'point' ? slop + 4 : slop;
    if (d > reach) continue;
    const score = d + (s.kind === 'point' || s.kind === 'measure' ? 0 : (s.kind === 'polygon' || s.kind === 'sector') && d === 0 ? 200 : 100);
    if (score <= bestScore) { best = o.id; bestScore = score; } // later objects win ties: they are drawn on top
  }
  return best;
}

/** A point where the user clicked: an existing one, an intersection, a point on a line or circle, or a free point. */
function pointAt(x: number, y: number): number {
  const s = snap(x, y);
  return s.id ?? add([s.draft!])[0];
}

/** Where a point made at (x; y) px lands, and what it hangs on: an existing point (`id`) or a new one (`draft`). */
interface Snap { x: number; y: number; id?: number; draft?: Draft; on?: number[] }

/**
 * Snapping, nearest first within reach, in this order: an existing point; an intersection of two curves; a curve
 * (at a grid point on it, if the grid is shown and one is close); a grid point; else exactly where clicked.
 */
function snap(x: number, y: number): Snap {
  const v = vp(), here = { x: v.fromX(x), y: v.fromY(y) };
  const existing = hit(x, y, isPoint);
  if (existing !== null) { const p = shapes.get(existing) as Pt; return { x: p.x, y: p.y, id: existing }; }
  const curves = objects
    .filter(o => !o.hidden && isCurve(shapes.get(o.id)))
    .map(o => ({ id: o.id, s: shapes.get(o.id) as Parameters<typeof project>[0], d: distancePx(shapes.get(o.id)!, x, y) }))
    .filter(c => c.d <= slop)
    .sort((a, b) => a.d - b.d);
  let best: Snap | null = null, reach = slop + 4;
  for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
    intersections(curves[i].s, curves[j].s).forEach((p, index) => {
      const d = p ? Math.hypot(v.px(p.x) - x, v.py(p.y) - y) : Infinity;
      if (p && d <= reach) { reach = d; best = { x: p.x, y: p.y, on: [curves[i].id, curves[j].id], draft: { kind: 'point', def: 'intersect', of: [curves[i].id, curves[j].id], index } }; }
    });
  }
  if (best) return best;
  const lattice = gridPoint(x, y);
  if (curves.length) {
    const c = curves[0], onIt = lattice && distancePx(c.s, v.px(lattice.x), v.py(lattice.y)) < 1, t = project(c.s, ...(onIt ? [lattice.x, lattice.y] : [here.x, here.y]) as [number, number]);
    const p = pointOn(c.s, t)!;
    return { x: p.x, y: p.y, on: [c.id], draft: { kind: 'point', def: 'on', of: [c.id], t } };
  }
  const at = lattice ?? here;
  return { ...at, draft: { kind: 'point', def: 'free', of: [], x: at.x, y: at.y } };
}

/** The grid step to snap to: the finest drawn lines still at least 16 px apart. */
function gridStep(v: Viewport): number {
  const major = tick(v.scale), minor = minorOf(major);
  return minor * v.scale >= 16 ? minor : major;
}
/** The grid point near (x; y) px in world units, while the grid is shown; null when none is in reach. */
function gridPoint(x: number, y: number): { x: number; y: number } | null {
  if (!grid) return null;
  const v = vp(), step = gridStep(v), gx = Math.round(v.fromX(x) / step) * step, gy = Math.round(v.fromY(y) / step) * step;
  // The reach shrinks with the step, so dense grid lines leave room for points in between.
  return Math.hypot(v.px(gx) - x, v.py(gy) - y) <= Math.min(slop + 4, step * v.scale * 0.4) ? { x: gx + 0, y: gy + 0 } : null;
}

/**
 * What the current tool would take under the pointer: where a new point would snap, or the object it would pick.
 * Shown while hovering, so the user sees what a click attaches to.
 */
function hoverTarget(): { snap?: Snap; id?: number } | null {
  if (!pointer || pressed) return null;
  const { x, y } = pointer, spec = toolOf(tool);
  if (tool === 'move' || tool === 'delete' || tool === 'hide') { const id = hit(x, y); return id === null ? null : { id }; }
  if (tool === 'point' || tool === 'polygon') return { snap: snap(x, y) };
  const needs = spec.needs ?? [], open = needs.map((_, i) => i).filter(i => picked[i] === undefined);
  const id = hit(x, y, s => open.some(i => FITS[needs[i]](s)));
  if (id !== null) return { id };
  return open.some(i => needs[i] === 'point' || needs[i] === 'pointOrLine') ? { snap: snap(x, y) } : null;
}

// --- Tools ---
export function setTool(id: ToolId): void {
  tool = id;
  picked = [];
  selected = null;
  renderList();
  canvas.dataset.tool = id;
  request();
}

async function click(x: number, y: number): Promise<void> {
  const spec = toolOf(tool), fresh = !picked.some(v => v !== undefined);
  if (tool === 'move') { selected = hit(x, y); renderList(); request(); return; }
  if (tool === 'delete') { const id = hit(x, y); if (id !== null) remove(id); return; }
  if (tool === 'hide') {
    const o = objects.find(o => o.id === hit(x, y));
    if (o) { checkpoint(); o.hidden = !o.hidden; update(); }
    return;
  }
  // Drawing doesn't select: the inspector stays closed while building.
  selected = null;
  if (tool === 'point') { checkpoint(); pointAt(x, y); update(); return; }
  // Clicking a segment (or circle) itself: its midpoint (centre), its length.
  if ((tool === 'midpoint' || tool === 'distance') && fresh && hit(x, y, isPoint) === null) {
    const seg = objects.find(o => o.id === hit(x, y, s => s.kind === 'segment' || (tool === 'midpoint' && s.kind === 'circle')));
    if (seg) {
      checkpoint();
      add([tool === 'midpoint' ? { kind: 'point', def: 'midpoint', of: [seg.id] } : { kind: 'measure', def: 'distance', of: [seg.id] }]);
      update();
      return;
    }
  }
  if (tool === 'polygon') {
    if (fresh) checkpoint();
    const id = pointAt(x, y);
    if (id === picked[0] && picked.length >= 3) { polygonFrom(picked as number[]); picked = []; }
    else if (!picked.includes(id)) picked.push(id);
    update();
    return;
  }
  const needs = spec.needs!, open = needs.map((_, i) => i).filter(i => picked[i] === undefined);
  let id = hit(x, y, s => open.some(i => FITS[needs[i]](s)));
  let slot = id === null ? undefined : open.find(i => FITS[needs[i]](shapes.get(id!)!));
  if (slot === undefined) {
    slot = open.find(i => needs[i] === 'point' || needs[i] === 'pointOrLine');
    if (slot === undefined) return; // this tool needs a line, circle… here, and there is none
    if (fresh) startTool();
    id = pointAt(x, y);
  } else if (fresh) {
    startTool();
  }
  if (picked.includes(id!)) { update(); return; }
  picked[slot] = id!;
  if (open.length === 1) {
    const ids = picked as number[];
    picked = [];
    if (spec.ask) {
      update();
      const value = await ask(spec.ask);
      if (value === null) cancelTool(); else spec.ask.run(ids, value);
    } else {
      const drafts = spec.existing ? existing(spec.make!(ids)) : spec.make!(ids);
      if (!drafts.length && spec.existing) toast(spec.existing);
      add(drafts);
    }
  }
  update();
}

export function remove(id: number): void {
  checkpoint();
  const gone = dependents(objects, id);
  objects = objects.filter(o => !gone.has(o.id));
  if (selected !== null && gone.has(selected)) selected = null;
  picked = [];
  update();
}

/** Asks for a number (pi/3 and √2 work too) in the panel's dialog; null when cancelled. */
function ask(spec: Ask): Promise<number | null> {
  return new Promise(resolve => {
    asking = { ask: spec, answer: value => { asking = null; notify(); resolve(value); } };
    notify();
  });
}
/** Reads what was typed in the dialog: the value, or what is wrong with it. */
export function readAsk(spec: Ask, text: string): { value: number } | { problem: string } {
  let v = NaN;
  try { v = spec.angle ? angleValue(text) : constant(text); } catch { /* reported below */ }
  const problem = Number.isNaN(v) ? 'Wpisz liczbę, np. 3, 2,5 albo sqrt(2).' : spec.check(v);
  return problem ? { problem } : { value: v };
}

// --- Drawing ---
function request(): void { frame ||= requestAnimationFrame(() => { frame = 0; draw(); }); }

/** The construction being made, finished with a stand-in point under the cursor. */
function preview(): { objects: GeoObject[]; shapes: Map<number, Shape | null> } | null {
  if (!pointer || !picked.some(v => v !== undefined)) return null;
  const at = snap(pointer.x, pointer.y), cursor: GeoObject = { id: -1, name: '', kind: 'point', def: 'free', of: [], x: at.x, y: at.y };
  const spec = toolOf(tool), needs = spec.needs ?? [], open = needs.map((_, i) => i).filter(i => picked[i] === undefined);
  const slot = open.find(i => needs[i] === 'point' || needs[i] === 'pointOrLine'), fill = [...picked];
  if (slot !== undefined) fill[slot] = -1;
  let drafts: Draft[];
  if (tool === 'polygon') drafts = [{ kind: 'polygon', def: 'through', of: [...picked as number[], -1] }];
  else if (spec.make && open.length === 1 && slot !== undefined) drafts = spec.make(fill as number[]);
  else {
    // Still more to pick, or a value to ask for: a thin segment from the last picked point to the cursor.
    const last = [...picked].reverse().find(id => id !== undefined && isPoint(shapes.get(id)));
    if (last === undefined || slot === undefined) return null;
    drafts = [{ kind: 'segment', def: 'through', of: [last, -1] }];
  }
  const extra = drafts.map(({ imageOf: _, ...d }, i) => ({ ...d, id: -2 - i, name: '' }));
  return { objects: extra, shapes: compute([...objects, cursor, ...extra]) };
}

const LAYER: Record<Shape['kind'], number> = { polygon: 0, sector: 0, angle: 1, segment: 2, line: 2, ray: 2, vector: 2, circle: 2, arc: 2, point: 3, measure: 4 };

function draw(): void {
  if (!width || !height) return;
  const v = vp(), css = getComputedStyle(document.documentElement), c = (k: string) => css.getPropertyValue(`--${k}`).trim();
  const theme = readTheme(), ink = c('b-ink'), free = c('geo-free'), bound = c('b-text'), poly = c('geo-polygon'), arc = c('geo-angle');
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  const options = { grid, axes, xUnit: 'num' as const, yUnit: 'num' as const, plane: false, minorGrid: true, halo: false };
  drawGrid(ctx, v, theme, options);
  drawAxes(ctx, v, theme, options);
  ctx.lineJoin = ctx.lineCap = 'round';

  const ghost = preview(), names = new Map(objects.map(o => [o.id, o.name])), hover = hoverTarget();
  const marked = new Set([selected, ...picked, hover?.id, hover?.snap?.id, ...(hover?.snap?.on ?? [])].filter((id): id is number => id !== null && id !== undefined));
  const items = [...objects.map(o => ({ o, s: shapes.get(o.id), ghost: false })), ...(ghost?.objects ?? []).map(o => ({ o, s: ghost!.shapes.get(o.id), ghost: true }))]
    .filter((i): i is { o: GeoObject; s: Shape; ghost: boolean } => !!i.s && (!i.o.hidden || tool === 'hide'))
    .sort((a, b) => LAYER[a.s.kind] - LAYER[b.s.kind]);

  const byId = new Map(objects.map(o => [o.id, o]));
  for (const { o, s, ghost: isGhost } of items) {
    const st = (o.def === 'edge' ? byId.get(o.of[2])?.style : o.style) ?? {};
    const auto = o.def === 'edge' || s.kind === 'polygon' || s.kind === 'sector' ? poly : s.kind === 'angle' ? arc : s.kind === 'point' ? (o.def === 'free' || o.def === 'on' ? free : bound) : ink;
    const color = st.color === 'ink' ? ink : st.color ?? auto;
    const hot = marked.has(o.id), text = isGhost ? '' : caption(o, s, st.label, id => names.get(id) ?? '?'), font = text === o.name ? SERIF : LABEL;
    ctx.globalAlpha = isGhost ? 0.55 : o.hidden ? 0.3 : 1;
    ctx.setLineDash([]);
    if (s.kind === 'point') {
      const X = v.px(s.x), Y = v.py(s.y), r = st.size ?? defaultSize(o);
      ctx.beginPath();
      if (st.shape === 'cross') {
        const k = r * 0.85;
        ctx.moveTo(X - k, Y - k); ctx.lineTo(X + k, Y + k); ctx.moveTo(X + k, Y - k); ctx.lineTo(X - k, Y + k);
        ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      } else {
        ctx.arc(X, Y, r, 0, 2 * Math.PI);
        ctx.fillStyle = st.shape === 'ring' ? theme.bg : color; ctx.fill();
        ctx.lineWidth = st.shape === 'ring' ? 2 : 1.5; ctx.strokeStyle = st.shape === 'ring' ? color : theme.bg; ctx.stroke();
      }
      // Selection: a 2px ring set off by a gap, like a selected Fluent swatch, instead of a glow.
      if (hot) { ctx.beginPath(); ctx.arc(X, Y, r + 3.5, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); }
      if (text) label(text, X + r + 3, Y - r - 4, color, theme.bg, font);
      continue;
    }
    if (s.kind === 'measure') {
      if (text) label(text, v.px(s.x), v.py(s.y) - 10, hot ? free : color, theme.bg, LABEL, 'center');
      continue;
    }
    const w = st.width ?? DEFAULT_WIDTH;
    const dash = () => ctx.setLineDash(st.dash === 'dashed' ? [w * 3, w * 3] : st.dash === 'dotted' ? [0.01, w * 3] : []); // dash and gap scale with the stroke
    ctx.beginPath();
    if (s.kind === 'polygon') s.pts.forEach((p, i) => i ? ctx.lineTo(v.px(p.x), v.py(p.y)) : ctx.moveTo(v.px(p.x), v.py(p.y)));
    else if (s.kind === 'circle') ctx.arc(v.px(s.cx), v.py(s.cy), s.r * v.scale, 0, 2 * Math.PI);
    else if (s.kind === 'arc' || s.kind === 'sector') {
      if (s.kind === 'sector') ctx.moveTo(v.px(s.cx), v.py(s.cy));
      ctx.arc(v.px(s.cx), v.py(s.cy), s.r * v.scale, -s.from, -(s.from + s.sweep), true);
    } else if (s.kind === 'angle') {
      const X = v.px(s.x), Y = v.py(s.y);
      if (Math.abs(s.sweep - Math.PI / 2) < 1e-9) {
        // A right angle gets the square mark.
        const k = ARC * 0.6, a = -s.from, b = -(s.from + s.sweep);
        ctx.moveTo(X, Y); ctx.lineTo(X + k * Math.cos(a), Y + k * Math.sin(a));
        ctx.lineTo(X + k * (Math.cos(a) + Math.cos(b)), Y + k * (Math.sin(a) + Math.sin(b))); ctx.lineTo(X + k * Math.cos(b), Y + k * Math.sin(b));
      } else { ctx.moveTo(X, Y); ctx.arc(X, Y, ARC, -s.from, -(s.from + s.sweep), true); }
      ctx.closePath();
      const mid = -(s.from + s.sweep / 2);
      if (text) label(text, X + (ARC + 30) * Math.cos(mid), Y + (ARC + 30) * Math.sin(mid), color, theme.bg, font, 'center');
    } else lineThrough(v, s as Line);
    if (s.kind === 'polygon' || s.kind === 'sector' || s.kind === 'angle') {
      ctx.closePath();
      paint('fill', color, (st.fill ?? 0.16) + (hot ? 0.14 : 0));
      dash(); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
    } else {
      if (s.kind === 'circle' && st.fill) paint('fill', color, st.fill + (hot ? 0.14 : 0));
      if (hot) { ctx.lineWidth = w + 6; paint('stroke', color, 0.18); }
      dash(); ctx.lineWidth = w; ctx.strokeStyle = color;
      ctx.stroke();
      if (s.kind === 'vector') arrowhead(v.px(s.x1), v.py(s.y1), v.px(s.x2), v.py(s.y2), color, w);
    }
    if (text && s.kind !== 'angle') { const [X, Y] = anchor(v, s); label(text, X + 6, Y - 10, color, theme.bg, font); }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // Where a click would put the point: a ring, filled when it lands on something (grid, line, intersection).
  const at = hover?.snap;
  if (at && at.id === undefined) {
    const X = v.px(at.x), Y = v.py(at.y), attached = at.draft?.def !== 'free' || gridPoint(X, Y) !== null;
    ctx.beginPath(); ctx.arc(X, Y, 6, 0, 2 * Math.PI);
    if (attached) paint('fill', free, 0.35);
    ctx.lineWidth = 2; ctx.strokeStyle = free; ctx.stroke();
  }
}

/** A line-like clipped to the canvas (a long enough stretch past both edges). */
function lineThrough(v: Viewport, s: Line): void {
  const X1 = v.px(s.x1), Y1 = v.py(s.y1), X2 = v.px(s.x2), Y2 = v.py(s.y2), len = Math.hypot(X2 - X1, Y2 - Y1);
  const far = (Math.hypot(width, height) + Math.hypot(X1 - width / 2, Y1 - height / 2)) / len;
  const t0 = s.kind === 'line' ? -far : 0, t1 = s.kind === 'line' || s.kind === 'ray' ? far : 1;
  ctx.moveTo(X1 + t0 * (X2 - X1), Y1 + t0 * (Y2 - Y1));
  ctx.lineTo(X1 + t1 * (X2 - X1), Y1 + t1 * (Y2 - Y1));
}

/** What an object's label says on the board, '' for none. */
function caption(o: GeoObject, s: Shape, mode: Style['label'], nameOf: (id: number) => string): string {
  if (mode === 'none' || !o.name) return '';
  if (s.kind === 'measure') return describe(o, s, nameOf).text;
  if (s.kind === 'angle') return mode === 'name' ? o.name : `${o.name} = ${Math.round(s.sweep * 1800 / Math.PI) / 10}°`.replace('.', ',');
  if (mode === 'value') return describe(o, s, nameOf).text;
  return mode === 'name' || s.kind === 'point' ? o.name : '';
}

/** Where a label sits: a segment's middle, the place of a line nearest the middle of the board, a circle's upper right… */
function anchor(v: Viewport, s: Shape): [number, number] {
  switch (s.kind) {
    case 'segment': case 'vector': return [v.px((s.x1 + s.x2) / 2), v.py((s.y1 + s.y2) / 2)];
    case 'line': case 'ray': {
      const X = v.px(s.x1), Y = v.py(s.y1), dx = v.px(s.x2) - X, dy = v.py(s.y2) - Y;
      let t = ((width / 2 - X) * dx + (height / 2 - Y) * dy) / (dx * dx + dy * dy || 1);
      if (s.kind === 'ray') t = Math.max(t, 0);
      return [X + t * dx, Y + t * dy];
    }
    case 'circle': return [v.px(s.cx + s.r * Math.SQRT1_2), v.py(s.cy + s.r * Math.SQRT1_2)];
    case 'arc': case 'sector': { const m = s.from + s.sweep / 2; return [v.px(s.cx + s.r * Math.cos(m)), v.py(s.cy + s.r * Math.sin(m))]; }
    case 'polygon': return [v.px(s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length), v.py(s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length)];
    default: return [v.px(s.x), v.py(s.y)];
  }
}

function arrowhead(x1: number, y1: number, x2: number, y2: number, color: string, w = DEFAULT_WIDTH): void {
  const a = Math.atan2(y2 - y1, x2 - x1), k = 9 + 1.6 * w;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - k * Math.cos(a - 0.4), y2 - k * Math.sin(a - 0.4));
  ctx.lineTo(x2 - k * Math.cos(a + 0.4), y2 - k * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}

function label(text: string, x: number, y: number, color: string, halo: string, font: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}

/** Fills or strokes the current path in a translucent colour (canvas can't parse every CSS colour function). */
function paint(how: 'fill' | 'stroke', color: string, alpha: number): void {
  const g = ctx.globalAlpha;
  ctx.globalAlpha = g * alpha;
  if (how === 'fill') { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.stroke(); }
  ctx.globalAlpha = g;
}

// --- Panel ---
/** The panel shows the objects, the selection and the inspector from geoStore; this only tells it to look again. */
function renderList(): void { notify(); }

/** A coordinate as the inspector shows it. */
export const coordText = (v: number) => format(v, 8).replace(/^-/, '−');

/**
 * Moves the selected point to typed coordinates (a point on a curve: to the nearest place on it). A field that still
 * shows the displayed (rounded) value keeps the exact one, so √2 stays √2. Returns what is wrong, or ''.
 */
export function applyCoords(xText: string, yText: string, shown: [string, string]): string {
  const o = objects.find(o => o.id === selected);
  if (!o || (o.def !== 'free' && o.def !== 'on')) return '';
  const now = shapes.get(o.id);
  const read = (text: string, was: string, exact: number) => {
    if (text.trim() === was) return exact;
    try { return constant(text); } catch { return NaN; }
  };
  const x = read(xText, shown[0], isPoint(now) ? now.x : NaN), y = read(yText, shown[1], isPoint(now) ? now.y : NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Wpisz liczby, np. 2,5, −1 albo sqrt(2).';
  const c = shapes.get(o.of[0]), t = o.def === 'on' && isCurve(c) ? project(c, x, y) : undefined;
  // Unchanged (also: leaving a field right after Enter): no redraw, so a click elsewhere isn't lost, and no undo step.
  const same = o.def === 'free' ? o.x === x && o.y === y : t === undefined || t === o.t;
  if (!same) {
    checkpoint();
    if (o.def === 'free') { o.x = x; o.y = y; } else o.t = t;
    update();
  }
  return '';
}

export function select(id: number | null): void { selected = id; renderList(); request(); }
export function toggleHidden(id: number): void {
  const o = objects.find(o => o.id === id);
  if (o) { checkpoint(); o.hidden = !o.hidden; update(); }
}

// --- Style of the selected object ---
export const PALETTE: [string, string][] = [
  ['ink', 'Atramentowy'], ['#d13438', 'Czerwony'], ['#ca5010', 'Pomarańczowy'], ['#eaa300', 'Żółty'], ['#107c10', 'Zielony'],
  ['#038387', 'Morski'], ['#0f6cbd', 'Niebieski'], ['#8764b8', 'Fioletowy'], ['#c239b3', 'Różowy'], ['#7a7574', 'Szary'],
];
export const FILLED = new Set<Kind>(['polygon', 'sector', 'angle', 'circle']);
// Defaults on the Fluent stroke scale: lines take the thick (2px) stroke.
export const DEFAULT_WIDTH = 2;
export const defaultSize = (o: GeoObject) => o.def === 'free' || o.def === 'on' ? 5 : 4;
export const decimal = (v: number) => String(v).replace('.', ',');

/** The object the style card edits: the selected one, a polygon's side standing for its polygon. */
export function styled(): GeoObject | undefined {
  const o = objects.find(o => o.id === selected);
  return o?.def === 'edge' ? objects.find(p => p.id === o.of[2]) : o;
}

let styling = false;
/** Changes the selected object's look; a slider dragged (`live`) is one undo step until it is let go. */
export function restyle(change: Partial<Style>, live = false): void {
  const o = styled();
  if (!o) return;
  if (!styling) checkpoint();
  styling = live;
  const st: Style = { ...o.style, ...change };
  for (const k of Object.keys(st) as (keyof Style)[]) if (st[k] === undefined) delete st[k];
  if (Object.keys(st).length) o.style = st; else delete o.style;
  update();
}

/** A slider or colour picker was let go: the next change is a new undo step. */
export function endStyling(): void { styling = false; }
export function resetStyle(): void { const o = styled(); if (o?.style) { checkpoint(); delete o.style; update(); } }

// --- Input ---
export function initGeometry(): void {
  canvas = document.getElementById('geo-canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;
  restore();
  // The save is debounced; closing or reloading the page must not lose the last change.
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let down: { x: number; y: number; view: View; moved: boolean; drag: { id: number; grab: { x: number; y: number }; start: Map<number, [number, number]> } | null } | null = null;

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    slop = e.pointerType === 'mouse' ? 8 : 16;
    const p = local(e), v = vp();
    let drag = null;
    if (tool === 'move') {
      const id = hit(p.x, p.y), o = objects.find(o => o.id === id);
      // A point on a line slides along it; other dependent points stay put; a figure moves with its free points.
      const movable = !o ? [] : o.def === 'on' ? [o] : o.kind === 'point' && o.def !== 'free' ? [] : freeAncestors(objects, o.id);
      if (o && movable.length) drag = { id: o.id, grab: { x: v.fromX(p.x), y: v.fromY(p.y) }, start: new Map(movable.map(o => [o.id, [o.x ?? 0, o.y ?? 0] as [number, number]])) };
    }
    down = { ...p, view: { ...view }, moved: false, drag };
    pressed = true;
    canvas.classList.toggle('grabbing', !drag);
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    pointer = p;
    if (!down) { request(); return; }
    if (!down.moved && Math.hypot(p.x - down.x, p.y - down.y) < 4) return;
    if (!down.moved && down.drag) checkpoint();
    down.moved = true;
    if (!down.drag) { view = panned(down.view, width, down.x - p.x, p.y - down.y); request(); return; }
    const v = vp(), wx = v.fromX(p.x), wy = v.fromY(p.y);
    let dx = wx - down.drag.grab.x, dy = wy - down.drag.grab.y;
    // With the grid shown, the first point moved lands on a grid point when near one; the rest move with it.
    const [anchorId, [ax, ay]] = down.drag.start.entries().next().value!, anchor = objects.find(o => o.id === anchorId)!;
    if (anchor.def === 'free') {
      const g = gridPoint(v.px(ax + dx), v.py(ay + dy));
      if (g) { dx = g.x - ax; dy = g.y - ay; }
    }
    for (const o of objects) {
      const start = down.drag.start.get(o.id);
      if (!start) continue;
      if (o.def === 'on') {
        const s = shapes.get(o.of[0]), g = gridPoint(p.x, p.y);
        if (isCurve(s)) o.t = g && distancePx(s, v.px(g.x), v.py(g.y)) < 1 ? project(s, g.x, g.y) : project(s, wx, wy);
      } else { o.x = start[0] + dx; o.y = start[1] + dy; }
    }
    selected = down.drag.id;
    update();
  });
  const end = (e: PointerEvent) => {
    if (!down) return;
    const p = local(e), wasClick = !down.moved;
    down = null;
    pressed = false;
    canvas.classList.remove('grabbing');
    if (e.type === 'pointerup' && wasClick) void click(p.x, p.y);
    else save();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', () => { pointer = null; request(); });
  // Double-click a point: select it and type its coordinates.
  canvas.addEventListener('dblclick', e => {
    const r = canvas.getBoundingClientRect(), id = hit(e.clientX - r.left, e.clientY - r.top, isPoint);
    if (id === null) return;
    select(id);
    focusCoords();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e), delta = e.deltaY * [1, 16, height][e.deltaMode];
    zoom(Math.exp(Math.max(-300, Math.min(300, delta)) * (e.ctrlKey ? 0.01 : 0.0012)), p.x, p.y);
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (document.body.dataset.panel !== 'geometry' || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) travel(redoStack, undoStack); else travel(undoStack, redoStack); }
    else if (mod && key === 'y') { e.preventDefault(); travel(redoStack, undoStack); }
    else if (e.key === 'Escape') { if (picked.length) { picked = []; request(); } else setTool('move'); } // setTool also deselects
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) { e.preventDefault(); remove(selected); }
  });

  const stage = document.getElementById('geometry')!;
  new ResizeObserver(() => {
    const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    width = r.width; height = r.height;
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }).observe(stage);

  setTool('move');
  update();
}

// --- The toolbar ---
export const undo = () => travel(undoStack, redoStack);
export const redo = () => travel(redoStack, undoStack);
export const zoomIn = () => zoom(0.75);
export const zoomOut = () => zoom(4 / 3);
export function resetView(): void { view = { ...HOME }; request(); save(); }
export function toggleGrid(): void { grid = !grid; notify(); request(); save(); }
export function toggleAxes(): void { axes = !axes; notify(); request(); save(); }
export function clearAll(): void {
  if (!objects.length) return;
  checkpoint(); objects = []; selected = null; picked = []; update();
  toast('Rysunek wyczyszczony. Ctrl+Z przywraca.');
}
export function exportPng(): void {
  draw();
  canvas.toBlob(blob => {
    if (!blob) { toast('Nie udało się zapisać obrazu.'); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'bettergebra-geometria.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function zoom(f: number, x = width / 2, y = height / 2): void {
  const next = zoomed(view, width, height, f, f, x, y);
  if (next) { view = next; request(); clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 400); }
}

/** Colours come from CSS variables; call after the theme changes. */
export const redrawGeometry = () => request();
