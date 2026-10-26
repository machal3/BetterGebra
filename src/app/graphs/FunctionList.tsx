/**
 * The list of functions. Each row's field is uncontrolled: typing writes state.expression and commits, and the
 * field is only overwritten from state when it is not being edited, so the caret never jumps. Keys: Enter adds a
 * row under the last one or moves to the next, ↑ ↓ move, Backspace in an empty field removes the row, Esc ends
 * editing. A finished, valid row shows the typeset formula over the (transparent) field.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button-clean';
import { Count, ErrorText, Kbd, Section, cx } from '@/components/controls';
import { IconPlus, IconSliders, IconTrash } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import { domainText } from '../../format';
import { expressionMathML, relationMathML } from '../../math';
import { compiled } from '../../model';
import { MAX_FUNCTIONS, addFunction, patchFunction, removeFunction, setActive, state, type FnState, type Mode } from '../../state';
import { toast } from '../toast';
import { RowSettings } from './RowSettings';

const PREFIX: Record<Mode, string> = { graph: 'y =', complex: 'f(z) =' };
/** The second row on suggests what else Wykresy draws: sets in x and y, and on the complex plane. */
const PLACEHOLDER: Record<Mode, [string, string]> = {
  graph: ['np. x^2 − 2', 'np. sin(x), y > x^2, |z − 1| <= 2'],
  complex: ['np. z^2 + 1', 'np. exp(z)'],
};

/** The rows' fields by function id, for moving the focus between them. */
const inputs = new Map<number, HTMLInputElement>();
/** A row added from the keyboard takes the focus once it is on screen. */
let focusOnMount: number | null = null;

function focusRow(index: number): void {
  const f = state.functions[index], input = f && inputs.get(f.id);
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

export function addAndFocus(after?: FnState): void {
  const f = addFunction('', {}, after);
  if (!f) { toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`); return; }
  focusOnMount = f.id;
}

export function removeRow(f: FnState): void {
  const index = state.functions.indexOf(f), wasFocused = inputs.get(f.id) === document.activeElement || !!document.activeElement?.closest(`[data-fn="${f.id}"]`);
  removeFunction(f.id);
  if (!wasFocused) return;
  const next = state.functions[Math.max(0, index - 1)];
  // the row that stays is already on screen; a replacement for the last one comes with the next render
  if (inputs.has(next.id)) focusRow(state.functions.indexOf(next)); else focusOnMount = next.id;
}

function FunctionRow({ f, index, mode, active }: { f: FnState; index: number; mode: Mode; active: boolean }) {
  const card = useRef<HTMLLIElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const c = compiled(f, mode, state.params);
  const n = index + 1;

  // Typeset when finished; the raw text while editing, empty or invalid.
  let math = '';
  if (c.ok && !editing) {
    try { math = c.set ? relationMathML(f.expression) : expressionMathML(f.expression); } catch { math = ''; }
  }
  // "y =" only in front of a graph: a set (y > x², |z| ≤ 1) is written in full
  const prefix = c.set ? '' : PREFIX[mode];
  const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
  const bounded = Number.isFinite(f.from) || Number.isFinite(f.to);
  const domain = !bounded || mode === 'complex' || (!!c.set && !unknowns?.length) ? '' : domainText(f, unknowns?.join(', ') ?? 'x');

  useLayoutEffect(() => {
    const el = input.current!;
    inputs.set(f.id, el);
    if (focusOnMount === f.id) { focusOnMount = null; el.focus(); }
    return () => { if (inputs.get(f.id) === el) inputs.delete(f.id); };
  }, [f.id]);
  // Clicking anywhere on the card makes it the analysed one (the keyboard does it by focusing the field).
  useEffect(() => {
    const el = card.current!, pick = () => setActive(f.id);
    el.addEventListener('pointerdown', pick);
    return () => el.removeEventListener('pointerdown', pick);
  }, [f.id]);
  // Don't overwrite what is being typed; take changes from elsewhere (restore, duplicate, the calculator).
  useLayoutEffect(() => {
    const el = input.current!;
    if (el.value !== f.expression && document.activeElement !== el) el.value = f.expression;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const at = state.functions.indexOf(f), last = state.functions.length - 1, el = e.currentTarget;
    if (e.key === 'Escape') el.blur();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (at === last && el.value.trim() && state.functions.length < MAX_FUNCTIONS) addAndFocus();
      else if (at < last) focusRow(at + 1);
      else el.blur();
    } else if (e.key === 'ArrowDown' && at < last) { e.preventDefault(); focusRow(at + 1); }
    else if (e.key === 'ArrowUp' && at > 0) { e.preventDefault(); focusRow(at - 1); }
    else if (e.key === 'Backspace' && !el.value && state.functions.length > 1) { e.preventDefault(); removeRow(f); }
  };

  return (
    <li
      className={cx('b-fn', active && 'is-active', !!c.error && 'is-invalid', !f.visible && 'is-hidden', !!math && 'is-typeset')}
      style={{ '--c': f.color } as React.CSSProperties}
      data-fn={f.id}
      ref={card}
    >
      <div className="b-fn-main">
        <button
          type="button"
          className="b-fn-swatch"
          aria-pressed={f.visible}
          aria-label={f.visible ? `Ukryj wykres ${n}` : `Pokaż wykres ${n}`}
          title={f.visible ? 'Ukryj wykres' : 'Pokaż wykres'}
          onClick={() => patchFunction(f.id, { visible: !f.visible })}
        />
        <label className="b-fn-field">
          {prefix && <span className="b-fn-prefix" aria-hidden="true">{prefix}</span>}
          <input
            ref={input}
            className="b-fn-input"
            defaultValue={f.expression}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={PLACEHOLDER[mode][index === 0 ? 0 : 1]}
            aria-label={`Funkcja ${n}`}
            aria-invalid={!!c.error}
            aria-describedby={`fn-error-${f.id}`}
            onInput={e => patchFunction(f.id, { expression: e.currentTarget.value }, 'expr')}
            onFocus={() => { setEditing(true); setActive(f.id); }}
            onBlur={() => setEditing(false)}
            onKeyDown={onKeyDown}
            // The field lies over the typeset formula: a click opens the raw text with the caret at the end,
            // not wherever the hidden text was hit.
            onMouseDown={e => {
              if (!math) return;
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length);
            }}
          />
          {math && <span className="b-fn-math" aria-hidden="true" dangerouslySetInnerHTML={{ __html: math }} />}
        </label>
        <Button
          variant="ghost"
          className={cx('b-fn-action', settingsOpen && 'is-open')}
          icon={<IconSliders />}
          aria-label={`Ustawienia funkcji ${n}`}
          aria-expanded={settingsOpen}
          title="Dziedzina, kolor, linia"
          popoverTarget={`fn-settings-${f.id}`}
        />
        <Button variant="ghost" className="b-fn-action b-fn-remove" icon={<IconTrash />} aria-label={`Usuń funkcję ${n}`} title="Usuń" onClick={() => removeRow(f)} />
      </div>
      <ErrorText id={`fn-error-${f.id}`} className="b-fn-note">{c.error}</ErrorText>
      {domain && <p className="b-fn-note b-fn-domain">{domain}</p>}
      {createPortal(<RowSettings f={f} n={n} mode={mode} onOpenChange={setSettingsOpen} />, document.body)}
    </li>
  );
}

export function FunctionList() {
  // the same topics the old list listened to: not params, so a slider never re-renders the list
  const { functions, mode, activeId } = useStore(['list', 'expr', 'active', 'mode', 'style'], s => ({ functions: s.functions, mode: s.mode, activeId: s.activeId }));
  const full = functions.length >= MAX_FUNCTIONS;
  return (
    <Section title="Funkcje" aside={<Count label={`${functions.length} z ${MAX_FUNCTIONS} funkcji`}>{functions.length} / {MAX_FUNCTIONS}</Count>}>
      <ol className="b-fn-list">
        {functions.map((f, i) => <FunctionRow key={f.id} f={f} index={i} mode={mode} active={f.id === activeId} />)}
      </ol>
      <Button
        variant="ghost"
        className="b-fn-add"
        icon={<IconPlus />}
        iconRight={<Kbd>Enter</Kbd>}
        disabled={full}
        title={full ? `Najwyżej ${MAX_FUNCTIONS} funkcji` : undefined}
        onClick={() => addAndFocus()}
      >
        Dodaj funkcję
      </Button>
    </Section>
  );
}
