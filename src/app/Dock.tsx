/**
 * The side panel as a floating card over the canvas: its header (the part's name and a button that folds the card
 * up to that header, remembered; motion.ts moves it). On phones the card is away until a button of the pane bar
 * (over the bottom of the canvas) opens one part of it as a sheet — Funkcje, Obiekty, Historia… — with a grip, a
 * half or full height and a close button, so the canvas is free the rest of the time. The sheet's header has tabs
 * for the panel's other parts, and the sheet stays above the on-screen keyboard (--b-kb). Whatever part of the
 * canvas the card covers becomes the inset of the Wykresy and Geometria views, measured with a ResizeObserver and
 * passed on outside React, so dragging the sheet never re-renders anything.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { Count } from '@/components/controls';
import { IconChevronDown, IconClose, IconPanel } from '@/components/icons';
import { PHONE, useMedia } from '@/hooks/use-media';
import { setGeometryInset } from '../geometry/controller';
import { NO_INSET, type Inset } from '../render/viewport';
import { setInset } from './graph-runtime';
import { fold } from './motion';
import { usePanel, type Panel } from './navigation';

const STORE = 'bettergebra.dock';
type Sheet = 'half' | 'full';

function savedOpen(): boolean {
  try {
    const v = localStorage.getItem(STORE);
    if (v) return v !== 'closed';
  } catch { /* the default then */ }
  // a tablet held upright starts with the canvas uncovered
  return !matchMedia('(max-width: 1023px) and (orientation: portrait)').matches;
}

const sheetHeight = (s: Sheet, app: number) => s === 'half' ? app * 0.5 : app - 8;

/* ---------- Which part the phone's sheet shows, by its name (null: none, the canvas is free) ---------- */
let pane: string | null = null;
/** The part last opened: a sheet that slides away keeps showing it. */
let lastPane: string | null = null;
/** How high the sheet rests; a closed sheet opens at half height next time. */
let sheet: Sheet = 'half';
/** The parts the shown panel's pane bar opens as the sheet: the sheet's tabs. */
let tabs: { label: string; count?: number }[] = [];
const paneListeners = new Set<() => void>();
export function setPane(next: string | null): void {
  if (next === pane) return;
  pane = next;
  if (next) lastPane = next; else sheet = 'half';
  paneListeners.forEach(f => f());
}
function setSheet(next: Sheet): void {
  sheet = next;
  paneListeners.forEach(f => f());
}
const subscribePane = (notify: () => void) => { paneListeners.add(notify); return () => { paneListeners.delete(notify); }; };
export const usePane = () => useSyncExternalStore(subscribePane, () => pane);
/** Whether a part of the side panel is shown: always on wider screens; on phones while the sheet shows it, or leaves with it. */
export function useShown(name: string): boolean {
  const phone = useMedia(PHONE);
  usePane();
  return !phone || lastPane === name;
}

/**
 * One button of the pane bar. Without onClick or popover it opens the sheet with the part of that name (and closes
 * it again); with onClick it is a toggle (pressed), with popover it opens that popover (expanded).
 */
export type PaneButton = { label: string; icon?: ReactNode; count?: number; onClick?: () => void; pressed?: boolean; popover?: string; expanded?: boolean };

/** The phone's buttons over the bottom of the canvas, for the panel that is shown; nothing on wider screens. */
export function PaneBar({ panel, items }: { panel: Panel; items: PaneButton[] }) {
  const phone = useMedia(PHONE), open = usePane(), shown = usePanel() === panel;
  const host = document.getElementById('panebar');
  // the sheet's tabs are this bar's sheet buttons
  const key = JSON.stringify(items.filter(b => !b.onClick && !b.popover).map(({ label, count }) => ({ label, count })));
  useLayoutEffect(() => {
    if (!phone || !shown) return;
    tabs = JSON.parse(key);
    paneListeners.forEach(f => f());
    return () => { tabs = []; };
  }, [phone, shown, key]);
  if (!phone || !shown || !host) return null;
  return createPortal(
    <nav className="b-panebar" aria-label="Części panelu">
      {items.map(b => {
        const sheet = !b.onClick && !b.popover, on = sheet ? open === b.label : b.popover ? b.expanded : b.pressed;
        return (
          <Button
            key={b.label}
            variant="ghost"
            className="b-tool-toggle"
            icon={b.icon}
            aria-pressed={b.popover ? undefined : !!on}
            aria-expanded={b.popover ? !!on : undefined}
            popoverTarget={b.popover}
            onClick={sheet ? () => setPane(open === b.label ? null : b.label) : b.onClick}
          >
            {b.label}{b.count ? <Count>{b.count}</Count> : null}
          </Button>
        );
      })}
    </nav>,
    host,
  );
}

export function Dock({ title }: { title: string }) {
  const head = document.getElementById('dock-head');
  const phone = useMedia(PHONE);
  const open = usePane();
  const [card, setCard] = useState(savedOpen);
  const height = useSyncExternalStore(subscribePane, () => sheet);
  const parts = useSyncExternalStore(subscribePane, () => tabs);
  /** The canvas size at the last measure: the views keep what they show still only when the card alone moved. */
  const last = useRef<{ w: number; h: number; phone: boolean } | null>(null);

  useLayoutEffect(() => { document.body.dataset.dock = card ? 'open' : 'closed'; }, [card]);
  useLayoutEffect(() => { document.body.dataset.sheet = open ? 'open' : 'closed'; }, [open]);
  useEffect(() => () => { delete document.body.dataset.dock; delete document.body.dataset.sheet; }, []);
  // another part of the app starts with the canvas free
  useEffect(() => { setPane(null); lastPane = null; }, [title]);
  const toggle = () => {
    const next = !card, apply = () => flushSync(() => setCard(next));
    try { localStorage.setItem(STORE, next ? 'open' : 'closed'); } catch { /* just don't remember */ }
    const dock = document.querySelector<HTMLElement>('.b-dock');
    if (dock) fold(dock, apply, next); else apply();
  };

  // The sheet's height follows its resting place and the page's height (a closed one keeps its height as it leaves)
  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock'), app = document.querySelector<HTMLElement>('.app');
    if (!dock || !app) return;
    if (!phone) { dock.style.removeProperty('--b-sheet-h'); return; }
    if (!open) return;
    const place = () => dock.style.setProperty('--b-sheet-h', `${sheetHeight(height, app.clientHeight)}px`);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(app);
    return () => ro.disconnect();
  }, [phone, height, open]);

  // The inset: what the card covers, for the views and for what else floats over the canvas
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock'), app = document.querySelector<HTMLElement>('.app');
    if (!dock || !app) return;
    const update = () => {
      const a = app.getBoundingClientRect(), d = dock.getBoundingClientRect();
      let inset: Inset = NO_INSET;
      if (a.width && d.width) {
        // Layout sizes, not the box on screen: the card may still be sliding in (its entrance, a sheet opening).
        // A phone: the open sheet's height, never more than half the canvas; with the sheet away, the pane bar.
        // Elsewhere the open card's right edge
        if (matchMedia(PHONE).matches) {
          const bar = parseFloat(getComputedStyle(app).getPropertyValue('--b-panebar-h')) || 0;
          inset = { left: 0, bottom: Math.round(open ? Math.min(dock.offsetHeight, a.height / 2) : bar) };
        } else if (card) inset = { left: dock.offsetLeft + dock.offsetWidth, bottom: 0 };
      }
      app.style.setProperty('--b-inset-left', `${inset.left}px`);
      app.style.setProperty('--b-inset-bottom', `${inset.bottom}px`);
      // a resized window keeps the view's ranges, as before there was a card; a folded or dragged card keeps the picture
      const was = last.current, now = { w: Math.round(a.width), h: Math.round(a.height), phone: matchMedia(PHONE).matches };
      const keep = !!was && was.w === now.w && was.h === now.h && was.phone === now.phone;
      last.current = now;
      setInset(inset, keep);
      setGeometryInset(inset, keep);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(dock);
    ro.observe(app);
    return () => ro.disconnect();
  }, [card, phone, open]);

  // The on-screen keyboard: what it covers of the page while a field is typed in, for the sheets to stay above it
  useEffect(() => {
    const vv = window.visualViewport, root = document.documentElement;
    if (!vv || !phone) return;
    const sync = () => {
      const typing = document.activeElement?.matches('input:not([type="range"], [type="checkbox"]), textarea');
      const kb = typing && vv.scale < 1.01 ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
      root.style.setProperty('--b-kb', `${kb}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      root.style.removeProperty('--b-kb');
    };
  }, [phone]);

  // Esc in the sheet puts it away
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock');
    if (!dock || !phone) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setPane(null); };
    dock.addEventListener('keydown', key);
    return () => dock.removeEventListener('keydown', key);
  }, [phone]);

  // Dragging the sheet by its header: to the nearest height, or away when let go low; a flick goes one step its way
  // (full, half, away); a short move is a tap
  const drag = useRef<{ y: number; h: number; moved: boolean; t: number; v: number; last: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!phone || (e.target as Element).closest('button')) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: dock.offsetHeight, moved: false, t: e.timeStamp, v: 0, last: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!, app = dock.parentElement!;
    if (!d.moved && Math.abs(e.clientY - d.y) < 4) return;
    d.moved = true;
    // px per ms, downwards positive, mostly from the latest moves
    d.v = 0.6 * d.v + 0.4 * (e.clientY - d.last) / Math.max(1, e.timeStamp - d.t);
    d.last = e.clientY;
    d.t = e.timeStamp;
    dock.classList.add('is-dragging');
    dock.style.setProperty('--b-sheet-h', `${Math.max(64, Math.min(app.clientHeight - 8, d.h + d.y - e.clientY))}px`);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!, app = dock.parentElement!.clientHeight, h = dock.offsetHeight;
    dock.classList.remove('is-dragging');
    const flick = Math.abs(d.v) > 0.5 && e.timeStamp - d.t < 120 ? Math.sign(d.v) : 0;
    if ((flick > 0 && sheet === 'half') || (!flick && h < sheetHeight('half', app) * 0.6)) { setPane(null); return; }
    const next: Sheet = flick ? (flick < 0 ? 'full' : 'half')
      : Math.abs(sheetHeight('full', app) - h) < Math.abs(sheetHeight('half', app) - h) ? 'full' : 'half';
    dock.style.setProperty('--b-sheet-h', `${sheetHeight(next, app)}px`);
    setSheet(next);
  };

  if (!head) return null;
  if (phone) {
    const full = height === 'full';
    return createPortal(
      <div className="b-dock-bar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <span className="b-dock-grip" aria-hidden="true" />
        <h2 className={parts.length > 1 ? 'b-visually-hidden' : 'b-dock-title'}>{open ?? lastPane ?? title}</h2>
        {parts.length > 1 && (
          // the panel's other parts, one tap away
          <SegmentedControl<string>
            kind="tabs"
            variant="tray"
            size="sm"
            fullWidth
            className="b-dock-tabs"
            aria-label="Części panelu"
            value={open ?? lastPane ?? parts[0].label}
            onChange={setPane}
            options={parts.map(p => ({ value: p.label, label: p.label, count: p.count || undefined }))}
          />
        )}
        <Button
          variant="ghost"
          icon={<IconChevronDown className={full ? undefined : 'b-flip'} />}
          aria-label={full ? 'Zmniejsz panel' : 'Powiększ panel'}
          title={full ? 'Zmniejsz panel' : 'Powiększ panel'}
          onClick={() => setSheet(full ? 'half' : 'full')}
        />
        <Button variant="ghost" icon={<IconClose />} aria-label="Zamknij panel" title="Zamknij panel" onClick={() => setPane(null)} />
      </div>,
      head,
    );
  }
  return createPortal(
    <div className="b-dock-bar">
      <h2 className="b-dock-title">{title}</h2>
      <Button
        variant="ghost"
        icon={<IconPanel />}
        aria-expanded={card}
        aria-label={card ? 'Zwiń panel' : 'Rozwiń panel'}
        title={card ? 'Zwiń panel' : 'Rozwiń panel'}
        onClick={toggle}
      />
    </div>,
    head,
  );
}
