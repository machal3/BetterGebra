/**
 * The start screen's drifting grid (Affect UI's Grid Background) behind a page that has room for it: the
 * calculator, an empty geometry board. It drifts by a transform, which the compositor runs without the main thread;
 * it fades in and out by opacity instead of the component's circle reveal, which repaints its mask every frame;
 * and it stops drifting while it is faded out. The radial fade of the lines is placed by each page's CSS.
 */
import { useEffect, useRef } from 'react';
import { GridBackground } from '@/components/ui/grid-background';
import { cx } from '@/components/controls';
import { reduced } from './motion';
import './backdrop.css';

export function Backdrop({ className, shown = true, speed = 6 }: { className?: string; shown?: boolean; speed?: number }) {
  return (
    <div className={cx('b-backdrop', className)} data-shown={shown || undefined} aria-hidden="true">
      <GridBackground size={48} speed={speed} reveal={false}><Spotlight /></GridBackground>
    </div>
  );
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The grid's lines brighter around the pointer, a child of a Grid Background. A disc follows the pointer by a
 * transform and holds a copy of the lines, drifting with the grid's own (both start in the same frame) and shifted
 * back by the disc's offset, so they lie on the grid's. Nothing is painted per move. Only with a mouse, never with
 * reduced motion.
 */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const spot = ref.current, grid = spot?.closest<HTMLElement>('.ui-gb'), lines = spot?.firstElementChild as HTMLElement | null;
    if (!spot || !grid || !lines || reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const cell = parseFloat(getComputedStyle(grid).getPropertyValue('--ui-gb-size')) || 48;
    let frame = 0, x = 0, y = 0;
    const place = () => {
      frame = 0;
      const b = grid.getBoundingClientRect(), r = spot.offsetWidth / 2;
      const left = Math.round(x - b.left - r), top = Math.round(y - b.top - r);
      spot.style.translate = `${left}px ${top}px`;
      lines.style.translate = `${-mod(left, cell)}px ${-mod(top, cell)}px`;
      spot.dataset.on = '';
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY;
      frame ||= requestAnimationFrame(place);
    };
    const out = (e: PointerEvent) => { if (!e.relatedTarget) delete spot.dataset.on; };
    addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', out);
    return () => {
      removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={ref} className="b-spot" aria-hidden="true"><div className="b-spot-lines" /></div>;
}
