/**
 * The start screen's drifting grid (Affect UI's Grid Background) behind a page that has room for it: the
 * calculator, an empty geometry board. It drifts by a transform, which the compositor runs without the main thread;
 * it fades in and out by opacity instead of the component's circle reveal, which repaints its mask every frame;
 * and it stops drifting while it is faded out. The radial fade of the lines is placed by each page's CSS.
 */
import { GridBackground } from '@/components/ui/grid-background';
import { cx } from '@/components/controls';
import './backdrop.css';

export function Backdrop({ className, shown = true, speed = 6 }: { className?: string; shown?: boolean; speed?: number }) {
  return (
    <div className={cx('b-backdrop', className)} data-shown={shown || undefined} aria-hidden="true">
      <GridBackground size={48} speed={speed} reveal={false} />
    </div>
  );
}
