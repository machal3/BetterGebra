/**
 * Small controls that Affect UI has no free component for — fields, switches, sliders, collapsible groups,
 * sections — built on the same tokens: hairline shadows, 6–10px radii, 13px type, short crisp motion.
 */
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { IconAlert, IconChevronDown } from './icons';
import './controls.css';

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={cx('b-section', className)} aria-labelledby={id}>
      <div className="b-section-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const Count = ({ children, label }: { children: ReactNode; label?: string }) => <span className="b-count" aria-label={label}>{children}</span>;

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="b-kbd">{children}</kbd>;

/** A field's message: read out when it appears, gone when empty. */
export function ErrorText({ children, id, className }: { children?: ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} className={cx('b-error', className)} role="alert">
      {children ? <><IconAlert size={14} /><span>{children}</span></> : null}
    </p>
  );
}

export function Field({ className, mono, ...rest }: ComponentProps<'input'> & { mono?: boolean }) {
  return <input className={cx('b-field', mono && 'b-field--mono', className)} autoComplete="off" spellCheck={false} {...rest} />;
}

/** A row that is one switch: the label names it, the whole row toggles. */
export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="b-switch" onClick={() => onChange(!checked)}>
      <span className="b-switch-label">{children}</span>
      <span className="b-switch-track" aria-hidden="true"><span className="b-switch-thumb" /></span>
    </button>
  );
}

/** Where the thumb (--p) and zero (--z) sit along a range input, for the filled part of the track. */
export function fillRange(el: HTMLInputElement): void {
  const min = Number(el.min), max = Number(el.max), at = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min) || 0));
  el.style.setProperty('--p', String(at(Number(el.value))));
  el.style.setProperty('--z', String(at(0)));
}

/**
 * A native range input (keyboard, screen readers and touch for free) with the track filled from zero to the thumb.
 * Uncontrolled on purpose: dragging must not wait for a React render.
 */
export function Slider({ className, onInput, ref, ...rest }: ComponentProps<'input'>) {
  const own = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => { if (own.current) fillRange(own.current); });
  return (
    <input
      type="range"
      className={cx('b-slider', className)}
      ref={el => { own.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }}
      onInput={e => { fillRange(e.currentTarget); onInput?.(e); }}
      {...rest}
    />
  );
}

/** A group that folds open and shut, like the groups of Affect UI's Filter Menu. */
export function Disclosure({ title, aside, defaultOpen = true, children }: { title: ReactNode; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="b-disclosure" data-open={open || undefined}>
      <button type="button" className="b-disclosure-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <IconChevronDown className="b-disclosure-chevron" size={16} />
        <span className="b-disclosure-title">{title}</span>
        {aside && <span className="b-disclosure-aside">{aside}</span>}
      </button>
      <div className="b-disclosure-panel" id={id} inert={!open}>
        <div className="b-disclosure-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * Places a popover next to its anchor: beside it when there is room (side "left" or "right"), otherwise below it,
 * always inside the window. Phones get a bottom sheet from CSS instead.
 */
export function placePopover(pop: HTMLElement, anchor: HTMLElement, side: 'left' | 'right', edge?: number): void {
  if (matchMedia('(max-width: 767px)').matches) { pop.style.left = pop.style.top = ''; return; }
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
  let left: number, top: number;
  if (side === 'right') {
    const x = (edge ?? r.right) + gap;
    if (x + w <= innerWidth - gap) { left = x; top = r.top - 8; } else { left = Math.max(gap, Math.min(r.left, innerWidth - w - gap)); top = r.bottom + 6; }
  } else {
    const x = r.left - gap - w;
    if (x >= gap) { left = x; top = r.top - 8; } else { left = Math.max(gap, Math.min(r.right - w, innerWidth - w - gap)); top = r.bottom + 6; }
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(gap, Math.min(top, innerHeight - h - gap))}px`;
}
