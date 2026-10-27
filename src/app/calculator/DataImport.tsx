/**
 * "Wklej dane": a table pasted from a spreadsheet or read from a CSV file becomes variables, a vector per column and
 * the matrix `dane`, after a preview of what will be made. The file is read here, in the page; nothing is sent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { Switch, placePopover } from '@/components/controls';
import { IconDownload } from '@/components/icons';
import { addVars } from './calc-store';
import { parseTable, tableVariables } from './csv';

export const DATA_POPOVER = 'calc-data';

export function DataImport() {
  const pop = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(''), [header, setHeader] = useState<boolean | null>(null), [read, setRead] = useState('');
  const table = useMemo(() => (text.trim() ? parseTable(text, header ?? undefined) : null), [text, header]);
  const made = useMemo(() => (table ? tableVariables(table) : null), [table]);
  const names = made ? Object.keys(made.vars) : [];
  useEffect(() => {
    const el = pop.current!;
    const toggled = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      const anchor = document.querySelector<HTMLElement>(`[popovertarget="${DATA_POPOVER}"]`);
      if (anchor) placePopover(el, anchor, 'right', anchor.closest('.sidebar')?.getBoundingClientRect().right);
    };
    el.addEventListener('toggle', toggled);
    return () => el.removeEventListener('toggle', toggled);
  }, []);
  const load = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { setRead('Plik jest większy niż 2 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { setText(String(r.result ?? '')); setRead(f.name); setHeader(null); };
    r.onerror = () => setRead('Nie udało się odczytać pliku.');
    r.readAsText(f);
  };
  const save = () => {
    if (!made || !names.length) return;
    addVars(made.vars);
    setText(''); setRead(''); setHeader(null);
    pop.current?.hidePopover();
  };
  return (
    <div ref={pop} id={DATA_POPOVER} className="b-popover b-data-pop" popover="auto" role="dialog" aria-labelledby="calc-data-title">
      <h3 id="calc-data-title" className="b-popover-title">Dane z tabeli</h3>
      <div className="b-data-body">
        <p className="b-data-hint">Wklej kolumny liczb z arkusza albo z pliku CSV. Każda kolumna stanie się wektorem, cała tabela macierzą <code>dane</code>.</p>
        <textarea
          className="b-field b-field--mono b-data-text"
          value={text}
          onChange={e => { setText(e.target.value); setRead(''); }}
          rows={7}
          spellCheck={false}
          aria-label="Dane do wklejenia"
          placeholder={'czas;temperatura\n0;12,5\n1;13,1\n2;14,0'}
        />
        <div className="b-data-actions">
          <Button variant="secondary" icon={<IconDownload />} onClick={() => file.current?.click()}>Wczytaj plik</Button>
          <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={e => { load(e.target.files?.[0]); e.target.value = ''; }} />
          {read && <span className="b-data-file">{read}</span>}
        </div>
        {table && <Switch checked={table.header} onChange={setHeader}>Pierwszy wiersz to nazwy kolumn</Switch>}
        {made && (
          <div className="b-data-preview" aria-live="polite">
            {names.length ? (
              <>
                <p className="b-data-summary">{table!.rows} {table!.rows === 1 ? 'wiersz' : 'wierszy'}, separator: {table!.separator}. Powstaną zmienne:</p>
                <ul className="b-data-vars">
                  {names.map(n => <li key={n}><code>{n}</code><span>{made.vars[n].label}</span></li>)}
                </ul>
              </>
            ) : <p className="b-data-summary">Nie znalazłem kolumn liczb.</p>}
            {[...table!.problems, ...made.problems].map(p => <p key={p} className="b-data-problem">{p}</p>)}
          </div>
        )}
        <Button className="b-data-save" disabled={!names.length} onClick={save}>Zapisz jako zmienne</Button>
      </div>
    </div>
  );
}
