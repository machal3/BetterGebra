/**
 * The side panel as a floating card over the canvas: its header (the part's name and a button that folds the card
 * up to that header, remembered), and on phones a sheet with a grip that rests at a peek, half or full height.
 * Whatever part of the canvas the card covers becomes the inset of the Wykresy and Geometria views, measured with a
 * ResizeObserver and passed on outside React, so dragging the sheet never re-renders anything.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button-clean';
import { IconChevronDown, IconPanel } from '@/components/icons';
import { PHONE, useMedia } from '@/hooks/use-media';
import { setGeometryInset } from '../geometry/controller';
import { NO_INSET, type Inset } from '../render/viewport';
import { setInset } from './graph-runtime';

const STORE = 'bettergebra.dock';
type Sheet = 'peek' | 'half' | 'full';
const PEEK = 156;

function savedOpen(): boolean {
  try {
    const v = localStorage.getItem(STORE);
    if (v) return v !== 'closed';
  } catch { /* the default then */ }
  // a tablet held upright starts with the canvas uncovered
  return !matchMedia('(max-width: 1023px) and (orientation: portrait)').matches;
}

const sheetHeight = (s: Sheet, app: number) => s === 'peek' ? Math.min(PEEK, app * 0.4) : s === 'half' ? app * 0.5 : app - 8;

export function Dock({ title }: { title: string }) {
  const head = document.getElementById('dock-head');
  const phone = useMedia(PHONE);
  const [open, setOpen] = useState(savedOpen);
  const [sheet, setSheet] = useState<Sheet>('peek');
  /** The canvas size at the last measure: the views keep what they show still only when the card alone moved. */
  const last = useRef<{ w: number; h: number; phone: boolean } | null>(null);

  useLayoutEffect(() => { document.body.dataset.dock = open ? 'open' : 'closed'; }, [open]);
  useEffect(() => () => { delete document.body.dataset.dock; }, []);
  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem(STORE, o ? 'closed' : 'open'); } catch { /* just don't remember */ }
      return !o;
    });
  };

  // The sheet's height follows its resting place and the page's height
  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock'), app = document.querySelector<HTMLElement>('.app');
    if (!dock || !app) return;
    const place = () => { if (phone) dock.style.setProperty('--b-sheet-h', `${sheetHeight(sheet, app.clientHeight)}px`); else dock.style.removeProperty('--b-sheet-h'); };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(app);
    return () => ro.disconnect();
  }, [phone, sheet]);

  // The inset: what the card covers, for the views and for what else floats over the canvas
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock'), app = document.querySelector<HTMLElement>('.app');
    if (!dock || !app) return;
    const update = () => {
      const a = app.getBoundingClientRect(), d = dock.getBoundingClientRect();
      let inset: Inset = NO_INSET;
      if (a.width && d.width) {
        // a phone's sheet: its height, but never more than half the canvas; elsewhere the open card's right edge
        if (matchMedia(PHONE).matches) inset = { left: 0, bottom: Math.round(Math.min(a.bottom - d.top, a.height / 2)) };
        else if (open) inset = { left: Math.round(d.right - a.left), bottom: 0 };
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
  }, [open, phone]);

  // Dragging the sheet by its header; a short move is a tap and leaves it to the button
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!phone || (e.target as Element).closest('button')) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: dock.offsetHeight, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!, app = dock.parentElement!;
    if (!d.moved && Math.abs(e.clientY - d.y) < 4) return;
    d.moved = true;
    dock.classList.add('is-dragging');
    dock.style.setProperty('--b-sheet-h', `${Math.max(64, Math.min(app.clientHeight - 8, d.h + d.y - e.clientY))}px`);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const dock = e.currentTarget.closest<HTMLElement>('.b-dock')!, app = dock.parentElement!.clientHeight, h = dock.offsetHeight;
    dock.classList.remove('is-dragging');
    // the nearest resting place
    const next = (['peek', 'half', 'full'] as Sheet[]).reduce((a, b) => Math.abs(sheetHeight(b, app) - h) < Math.abs(sheetHeight(a, app) - h) ? b : a);
    dock.style.setProperty('--b-sheet-h', `${sheetHeight(next, app)}px`);
    setSheet(next);
  };

  // On a phone, a field focused in a peeking sheet lifts it to half, so the field isn't under the keyboard's edge
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.b-dock');
    if (!dock || !phone) return;
    const lift = () => setSheet(s => s === 'peek' ? 'half' : s);
    dock.addEventListener('focusin', lift);
    return () => dock.removeEventListener('focusin', lift);
  }, [phone]);

  if (!head) return null;
  const expanded = phone ? sheet !== 'peek' : open;
  return createPortal(
    <div className="b-dock-bar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <span className="b-dock-grip" aria-hidden="true" />
      <h2 className="b-dock-title">{title}</h2>
      <Button
        variant="ghost"
        icon={phone ? <IconChevronDown className={expanded ? undefined : 'b-flip'} /> : <IconPanel />}
        aria-expanded={expanded}
        aria-label={expanded ? 'Zwiń panel' : 'Rozwiń panel'}
        title={expanded ? 'Zwiń panel' : 'Rozwiń panel'}
        onClick={phone ? () => setSheet(s => s === 'peek' ? 'half' : 'peek') : toggle}
      />
    </div>,
    head,
  );
}
