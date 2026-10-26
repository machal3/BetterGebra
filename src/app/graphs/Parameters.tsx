/**
 * A slider and a number field for every letter some function uses as a parameter, in alphabetical order. The
 * slider spans at least −10…10 and grows to include a typed value; its step is fine enough not to round it (0,25
 * stays 0,25). Both fields are uncontrolled: dragging writes state.params and commits, the canvas redraws, and this
 * list only re-renders when the set of parameters may have changed — as before, not on every slider step.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { ErrorText, Field, Section, Slider, fillRange } from '@/components/controls';
import { useTopics } from '@/hooks/use-store';
import { compiled } from '../../model';
import { commit, state } from '../../state';
import { settle } from '../../ui/canvas-input';

function fitSlider(slider: HTMLInputElement, value: number): void {
  slider.min = String(Math.min(-10, Math.floor(value)));
  slider.max = String(Math.max(10, Math.ceil(value)));
  const decimals = Math.min(10, (String(value).split('.')[1] ?? '').length);
  slider.step = decimals > 1 && !/e/i.test(String(value)) ? String(10 ** -decimals) : '0.1';
  slider.value = String(value);
  fillRange(slider);
}

/** `sync` counts the list's changes: the row takes the value from state then, not on its own re-renders (a drag). */
function ParameterRow({ name, sync }: { name: string; sync: number }) {
  const slider = useRef<HTMLInputElement>(null), input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const id = `parameter-${name}`;
  // Set up, and follow state when the list changes, unless the field is being typed in.
  useLayoutEffect(() => {
    if (document.activeElement === input.current) return;
    input.current!.value = String(state.params[name]);
    setError('');
    fitSlider(slider.current!, state.params[name]);
  }, [name, sync]);
  const apply = (v: number) => { state.params[name] = v; settle(); commit('params'); };
  return (
    <div className="b-param">
      <label htmlFor={id} className="b-param-name"><i>{name}</i> =</label>
      <Slider
        ref={slider}
        step={0.1}
        aria-label={`Suwak parametru ${name}`}
        onInput={e => {
          input.current!.value = e.currentTarget.value;
          // only when there is a message to clear: a drag must not re-render the row on every step
          if (error) setError('');
          apply(e.currentTarget.valueAsNumber);
        }}
      />
      <Field
        ref={input}
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        mono
        aria-invalid={!!error}
        aria-describedby={`${id}-error`}
        onInput={e => {
          const v = e.currentTarget.valueAsNumber;
          if (!Number.isFinite(v)) { setError('Podaj liczbę. Wykres zachowuje ostatnią poprawną wartość.'); return; }
          setError('');
          fitSlider(slider.current!, v);
          apply(v);
        }}
      />
      <ErrorText id={`${id}-error`} className="b-param-error">{error}</ErrorText>
    </div>
  );
}

export function Parameters() {
  const sync = useTopics(['list', 'expr', 'mode']);
  const names = [...new Set(state.functions.flatMap(f => compiled(f, state.mode, state.params).parameters))].sort();
  return (
    <Section title="Parametry">
      {names.length ? (
        <div className="b-params">{names.map(name => <ParameterRow key={name} name={name} sync={sync} />)}</div>
      ) : (
        <p className="b-hint">
          Każda litera inna niż <i>x</i> staje się parametrem z suwakiem (w warunkach także inna niż <i>y</i>, <i>z</i>, <i>i</i>). Wpisz np. <code>a·sin(b·x)</code> albo <code>x^2 + y^2 &lt;= r^2</code>.
        </p>
      )}
    </Section>
  );
}
