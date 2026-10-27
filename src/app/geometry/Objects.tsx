/**
 * The objects: a field for writing a definition (A = (1; 2), Okrąg(A; 3), y = 2x + 1), the list of what can be
 * written, and every object with its value and its definition — click the definition to change it (Enter applies,
 * Esc or leaving keeps it as it was).
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { Disclosure, ErrorText, Field, cx } from '@/components/controls';
import { IconEye, IconEyeOff, IconSliders, IconTrash } from '@/components/icons';
import { REFERENCE, definition } from '../../geometry/commands';
import { describe, type GeoObject } from '../../geometry/construct';
import { define, remove, select, toggleHidden } from '../../geometry/controller';
import { useGeo } from './use-geo';

function DefinitionEditor({ o, text, done }: { o: GeoObject; text: string; done: () => void }) {
  const [problem, setProblem] = useState('');
  const finished = useRef(false), field = useRef<HTMLInputElement>(null);
  // the definition turned into a field because it was clicked: the field takes the focus, its text selected
  useEffect(() => { field.current?.focus(); }, []);
  return (
    <span className="b-gobj-edit">
      <Field
        ref={field}
        mono
        defaultValue={text}
        aria-label={`Definicja ${o.name}`}
        onFocus={e => e.currentTarget.select()}
        onKeyDown={e => {
          if (e.key === 'Escape') { finished.current = true; done(); return; }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (e.currentTarget.value.trim() === text) { finished.current = true; done(); return; }
          const p = define(e.currentTarget.value, o);
          if (p) setProblem(p); else { finished.current = true; done(); }
        }}
        onBlur={() => { if (!finished.current) done(); }}
      />
      <ErrorText>{problem}</ErrorText>
    </span>
  );
}

export function Objects({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const geo = useGeo();
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const names = new Map(geo.objects.map(o => [o.id, o.name]));
  const nameOf = (id: number) => names.get(id) ?? '?';
  // Polygon sides stay off the list: the polygon stands for them.
  const shown = geo.objects.filter(o => o.def !== 'edge');
  return (
    <div className="b-gobjs">
      <form
        className="b-gobjs-form"
        onSubmit={e => {
          e.preventDefault();
          const p = define(inputRef.current!.value);
          setProblem(p ?? '');
          if (!p) inputRef.current!.value = '';
        }}
      >
        <Field ref={inputRef} id="geo-input" mono aria-label="Definicja obiektu" placeholder="np. A = (1; 2), Okrąg(A; 3), y = 2x + 1" onInput={() => setProblem('')} aria-invalid={!!problem} />
        <Button type="submit" variant="primary">Dodaj</Button>
      </form>
      <ErrorText>{problem}</ErrorText>
      <Disclosure title="Polecenia i sposoby definiowania" defaultOpen={false}>
        <ul className="b-gref">
          {REFERENCE.map(({ usage, what }) => (
            <li key={usage}>
              <button type="button" className="b-row" title="Wstaw do pola" onClick={() => { inputRef.current!.value = usage.replace('; …', ''); setProblem(''); inputRef.current!.focus(); }}>
                <code>{usage}</code><span>{what}</span>
              </button>
            </li>
          ))}
        </ul>
      </Disclosure>
      {shown.length ? (
        <ol className="b-gobj-list">
          {shown.map(o => {
            const { text, detail } = describe(o, geo.shapes.get(o.id) ?? null, nameOf), def = definition(o, nameOf);
            const c = o.style?.color, tint = c ? (c === 'ink' ? 'var(--b-ink)' : c) : undefined;
            return (
              <li
                key={o.id}
                className={cx('b-gobj', o.id === geo.selected && 'is-selected', o.hidden && 'is-hidden')}
                data-kind={o.kind}
                data-free={o.def === 'free' || o.def === 'on'}
                style={tint ? ({ '--c': tint } as React.CSSProperties) : undefined}
              >
                <button
                  type="button"
                  className="b-gobj-eye"
                  aria-pressed={!o.hidden}
                  aria-label={`${o.hidden ? 'Pokaż' : 'Ukryj'} ${o.name}`}
                  title={o.hidden ? 'Pokaż' : 'Ukryj'}
                  onClick={() => toggleHidden(o.id)}
                >
                  {o.hidden ? <IconEyeOff /> : <IconEye />}
                </button>
                <div className="b-gobj-body">
                  <button type="button" className="b-gobj-value" title={detail} onClick={() => select(geo.selected === o.id ? null : o.id)}>{text}</button>
                  {editing === o.id ? (
                    <DefinitionEditor o={o} text={def} done={() => setEditing(null)} />
                  ) : (
                    <button type="button" className="b-gobj-def" title={`${detail}. Kliknij, aby zmienić definicję.`} onClick={() => setEditing(o.id)}>{def}</button>
                  )}
                </div>
                <Button variant="ghost" className="b-gobj-action" icon={<IconSliders />} aria-label={`Wygląd ${o.name}`} title="Wygląd" onClick={() => select(o.id)} />
                <Button variant="ghost" className="b-gobj-action b-gobj-remove" icon={<IconTrash />} aria-label={`Usuń ${o.name}`} title="Usuń" onClick={() => remove(o.id)} />
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="b-empty">
          <svg className="b-empty-art" viewBox="0 0 96 64" aria-hidden="true">
            <path className="b-empty-soft" d="M52 14 82 58H22Z" />
            <path d="M46 8 76 52H16Z" />
            <circle cx="46" cy="36" r="11" />
            <circle cx="46" cy="8" r="2.5" />
            <circle cx="16" cy="52" r="2.5" />
            <circle cx="76" cy="52" r="2.5" />
          </svg>
          <p>Brak obiektów. Wpisz definicję powyżej albo narysuj coś narzędziami z panelu <b>Tworzenie</b>.</p>
        </div>
      )}
    </div>
  );
}
