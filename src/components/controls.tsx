/**
 * Small controls that Affect UI has no free component for — fields, switches, sliders, collapsible groups, a menu,
 * a colour picker, sections — built from the anatomy of its free components (the input and tooltip of Message
 * Actions, the option menu and groups of Smart Recommendation) on the same tokens.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconChevronDown, IconPlus } from './icons';
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

/** Places a popover under its anchor (above it when there is no room below), inside the window; phones: a sheet. */
export function placeBelow(pop: HTMLElement, anchor: HTMLElement): void {
  if (matchMedia('(max-width: 767px)').matches) { pop.style.left = pop.style.top = ''; return; }
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
  const top = r.bottom + 4 + h <= innerHeight - gap ? r.bottom + 4 : Math.max(gap, r.top - 4 - h);
  pop.style.left = `${Math.max(gap, Math.min(r.left, innerWidth - w - gap))}px`;
  pop.style.top = `${top}px`;
}

/** Moves the focus among a list's items with the arrows, Home and End. */
function roving(e: KeyboardEvent<HTMLElement>, selector: string): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)], i = items.indexOf(document.activeElement as HTMLElement);
  const next = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
  if (next === undefined) return;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
}

export type MenuOption<T extends string> = { value: T; label: string };

/**
 * One choice from a short list: a field-like button that opens a list in a popover, like the option menu of
 * Affect UI's Smart Recommendation (the picked option has the fill and a check). Arrows, Home, End, Enter, Esc.
 */
export function Menu<T extends string>({ value, options, onChange, className, ...aria }: {
  value: T; options: MenuOption<T>[]; onChange: (value: T) => void; className?: string; 'aria-label'?: string; 'aria-labelledby'?: string;
}) {
  const id = useId(), pop = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value) ?? options[0];
  useEffect(() => {
    const el = pop.current!;
    const toggled = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) { placeBelow(el, trigger.current!); el.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); }
    };
    el.addEventListener('toggle', toggled);
    return () => el.removeEventListener('toggle', toggled);
  }, []);
  const pick = (v: T) => { onChange(v); pop.current?.hidePopover(); trigger.current?.focus(); };
  return (
    <>
      <button ref={trigger} type="button" className={cx('b-menu-trigger', className)} popoverTarget={id} aria-haspopup="listbox" aria-expanded={open} {...aria}>
        <span className="b-menu-value">{current?.label}</span>
        <IconChevronDown className="b-menu-chevron" size={16} />
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        className="b-popover b-menu"
        role="listbox"
        tabIndex={-1}
        {...aria}
        onKeyDown={e => { if (e.key === 'Tab') pop.current?.hidePopover(); else roving(e, '[role="option"]'); }}
      >
        {options.map(o => (
          <button key={o.value} type="button" role="option" aria-selected={o.value === value} tabIndex={-1} className="b-menu-option" onClick={() => pick(o.value)}>
            <span>{o.label}</span>
            {o.value === value && <IconCheck size={16} />}
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- Colour ---------- */
type Hsv = [number, number, number];
const HEX = /^#?([0-9a-f]{6})$/i;
function toHsv(hex: string): Hsv {
  const m = HEX.exec(hex.trim());
  if (!m) return [214, 1, 0.89];
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}
function toHex([h, s, v]: Hsv): string {
  const f = (k: number) => { const t = (k + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(t, 4 - t, 1)))); };
  return `#${[f(5), f(3), f(1)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

export type Swatch = { color: string; label: string; css?: string };

/**
 * Swatches to pick from, an optional automatic one, and "Własny": a popover with a saturation–brightness field,
 * a hue slider and the hex code. onDrag reports each step of a drag and onDragEnd its end, so that a drag can be
 * one undo step; onPick reports a finished choice.
 */
export function ColorPicker({ value, swatches, auto, label, onPick, onDrag = onPick, onDragEnd }: {
  value: string | undefined; swatches: Swatch[]; auto?: string; label: string;
  onPick: (color: string | undefined) => void; onDrag?: (color: string) => void; onDragEnd?: () => void;
}) {
  const id = useId(), pop = useRef<HTMLDivElement>(null), anchor = useRef<HTMLButtonElement>(null);
  const custom = !!value && !swatches.some(s => s.color === value);
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(custom && value ? value : '#0060e2'));
  const hex = toHex(hsv);
  const [text, setText] = useState(hex);
  // the latest props for the toggle listener, which is added once
  const latest = useRef({ value, custom, onDragEnd });
  useLayoutEffect(() => { latest.current = { value, custom, onDragEnd }; });
  useEffect(() => {
    const el = pop.current!;
    const toggled = (e: Event) => {
      const { value: v, custom: c, onDragEnd: end } = latest.current;
      if ((e as ToggleEvent).newState !== 'open') { end?.(); return; }
      const start = toHsv(c && v ? v : '#0060e2');
      setHsv(start); setText(toHex(start)); placeBelow(el, anchor.current!);
    };
    el.addEventListener('toggle', toggled);
    return () => el.removeEventListener('toggle', toggled);
  }, []);
  const drag = (next: Hsv) => { setHsv(next); setText(toHex(next)); onDrag(toHex(next)); };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const area = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    drag([hsv[0], clamp((e.clientX - r.left) / r.width), 1 - clamp((e.clientY - r.top) / r.height)]);
  };
  const areaKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02, [h, s, v] = hsv;
    const next: Hsv | null = e.key === 'ArrowRight' ? [h, clamp(s + step), v] : e.key === 'ArrowLeft' ? [h, clamp(s - step), v]
      : e.key === 'ArrowUp' ? [h, s, clamp(v + step)] : e.key === 'ArrowDown' ? [h, s, clamp(v - step)] : null;
    if (next) { e.preventDefault(); drag(next); }
  };
  const typed = () => { const m = HEX.exec(text); if (m) { const next = toHsv(m[1]); setHsv(next); setText(toHex(next)); onPick(toHex(next)); } else setText(hex); };
  return (
    <div className="b-swatches" role="group" aria-label={label}>
      {auto && <button type="button" className="b-swatch is-auto" aria-pressed={!value} aria-label={auto} title={auto} onClick={() => onPick(undefined)} />}
      {swatches.map(s => (
        <button key={s.color} type="button" className="b-swatch" aria-pressed={value === s.color} aria-label={s.label} title={s.label} style={{ '--sw': s.css ?? s.color } as React.CSSProperties} onClick={() => onPick(s.color)} />
      ))}
      <button
        ref={anchor}
        type="button"
        className="b-swatch is-custom"
        aria-pressed={custom}
        aria-label="Własny kolor"
        title="Własny kolor"
        popoverTarget={id}
        style={custom ? ({ '--sw': value } as React.CSSProperties) : undefined}
      >
        {!custom && <IconPlus size={14} />}
      </button>
      <div ref={pop} id={id} popover="auto" className="b-popover b-colorpop" role="dialog" aria-label="Własny kolor">
        <div
          className="b-colorpop-area"
          role="slider"
          tabIndex={0}
          aria-label="Nasycenie i jasność"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv[1] * 100)}
          aria-valuetext={`nasycenie ${Math.round(hsv[1] * 100)}%, jasność ${Math.round(hsv[2] * 100)}%`}
          style={{ '--hue': `hsl(${Math.round(hsv[0])} 100% 50%)` } as React.CSSProperties}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); area(e); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) area(e); }}
          onPointerUp={() => onDragEnd?.()}
          onKeyDown={areaKeys}
          onKeyUp={() => onDragEnd?.()}
        >
          <span className="b-colorpop-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
        </div>
        <input
          type="range"
          className="b-hue"
          min={0}
          max={359}
          value={Math.round(hsv[0])}
          aria-label="Odcień"
          onChange={e => drag([e.currentTarget.valueAsNumber, hsv[1], hsv[2]])}
          onPointerUp={() => onDragEnd?.()}
          onKeyUp={() => onDragEnd?.()}
        />
        <div className="b-colorpop-row">
          <span className="b-colorpop-preview" style={{ background: hex }} />
          <Field
            mono
            aria-label="Kod koloru"
            value={text}
            onChange={e => setText(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); typed(); } }}
            onBlur={typed}
          />
        </div>
      </div>
    </div>
  );
}
