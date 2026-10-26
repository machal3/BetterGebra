/**
 * Pomoc: how to write expressions, what the parts do, and the keyboard shortcuts, as three tabs in a dialog.
 * Opened from the help buttons and with ? on the Wykresy panel; Esc, the close button or a click beside it closes it,
 * and the focus goes back where it was.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { Kbd } from '@/components/controls';
import { IconClose } from '@/components/icons';

/** Opens Pomoc (the dialog below, rendered once for the whole app). */
export const openHelp = () => (document.getElementById('help') as HTMLDialogElement | null)?.showModal();

type Tab = 'zapis' | 'tryby' | 'skroty';
const TABS: { value: Tab; label: string }[] = [{ value: 'zapis', label: 'Zapis' }, { value: 'tryby', label: 'Tryby' }, { value: 'skroty', label: 'Skróty' }];

const C = ({ children }: { children: React.ReactNode }) => <code className="b-code">{children}</code>;

function Syntax() {
  const rows: [React.ReactNode, string][] = [
    [<Fragment key="1"><C>x^2</C>, <C>x²</C>, <C>2x</C>, <C>3(x+1)</C></Fragment>, 'potęgi, mnożenie bez znaku'],
    [<Fragment key="2"><C>sqrt(x)</C>, <C>√x</C>, <C>root(3; x)</C>, <C>|x|</C></Fragment>, 'pierwiastki, wartość bezwzględna'],
    [<Fragment key="3"><C>sin x</C>, <C>tg x</C>, <C>arcsin x</C>, <C>sin^-1 x</C></Fragment>, 'trygonometria (radiany, 30° w stopniach)'],
    [<Fragment key="4"><C>ln x</C>, <C>log x</C>, <C>log_2(x)</C>, <C>e^x</C></Fragment>, 'logarytmy i wykładnicza'],
    [<Fragment key="5"><C>max(x; 1)</C>, <C>mod(x; 3)</C>, <C>x!</C>, <C>floor x</C></Fragment>, 'argumenty oddziel średnikiem'],
    [<Fragment key="6"><C>pi</C>, <C>π</C>, <C>e</C>, <C>tau</C>, <C>phi</C></Fragment>, 'stałe'],
    [<C key="p">a·sin(b·x)</C>, 'inne litery to parametry z suwakiem'],
  ];
  return <table className="b-help-table"><tbody>{rows.map(([a, b], i) => <tr key={i}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>;
}

function Modes() {
  return (
    <div className="b-help-modes">
      <section>
        <h3>Wykresy</h3>
        <p>Obok funkcji <C>y = f(x)</C> każdy wiersz może być zbiorem. Warunki i równania w <i>x</i> i <i>y</i> to krzywe i obszary: <C>x^2 + y^2 = 25</C>, <C>y &gt; x^2</C>, <C>x = 2</C>. Z <C>z</C> albo <C>i</C> — zbiory liczb zespolonych: <C>|z - 1| &lt;= 2</C>, <C>1 &lt; Re z &lt; 3</C>, <C>z^2 = -1</C>, krzywe i obszary <C>t + 2i</C>, <C>a + bi</C> (zakres niewiadomych w ustawieniach wiersza).</p>
      </section>
      <section>
        <h3>Zespolone</h3>
        <p><C>z^2 + 1</C>. Kolor to argument f(z), ciemny punkt to zero, jasny to biegun.</p>
      </section>
      <section>
        <h3>Geometria</h3>
        <p>Wybierz narzędzie i klikaj — puste miejsce tworzy punkt, kliknięcie linii kładzie punkt na niej. Narzędziem <b>Przesuń</b> przeciągasz punkty, a zależne obiekty podążają za nimi. Współrzędne zaznaczonego punktu (lub dwukrotnie klikniętego) wpiszesz w okienku x, y. Każdy obiekt ma definicję, np. <C>Okrąg(A; B; C)</C> — kliknij ją na liście, aby ją zmienić, albo wpisz nową w polu nad listą (<C>c = Okrąg(A; 3)</C>, <C>y = 2x + 1</C>).</p>
      </section>
      <section>
        <h3>Kalkulator</h3>
        <p>Wpisz wyrażenie, równanie albo polecenie (np. <C>całka x^2 sin x dx</C>, <C>granica sin(x)/x przy x-&gt;0</C>, <C>rozłóż x^4 − 1</C>). Wyniki są dokładne; postać dziesiętną liczy się w arytmetyce dowolnej precyzji i pokazuje tylko pewne cyfry. Zmienne traktowane są jako rzeczywiste. Obliczenia trwające dłużej niż 20 s są przerywane.</p>
      </section>
    </div>
  );
}

function Keys() {
  const groups: [string, [React.ReactNode, string][]][] = [
    ['Wykresy', [
      [<Kbd key="e">Enter</Kbd>, 'nowa funkcja pod ostatnią'],
      [<><Kbd>↑</Kbd> <Kbd>↓</Kbd></>, 'poprzednia / następna funkcja'],
      [<Kbd key="b">Backspace</Kbd>, 'w pustym polu usuwa funkcję'],
      [<Kbd key="esc">Esc</Kbd>, 'koniec edycji'],
      [<><Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd></>, 'przesuwanie wykresu (gdy aktywny)'],
      [<><Kbd>+</Kbd> <Kbd>−</Kbd> <Kbd>0</Kbd></>, 'przybliż, oddal, przywróć widok'],
      [<><Kbd>Shift</Kbd> + kółko</>, 'skaluje tylko oś y (Alt: tylko x)'],
      [<><Kbd>F</Kbd> <Kbd>B</Kbd> <Kbd>?</Kbd></>, 'dopasuj y, badanie funkcji, ta pomoc'],
    ]],
    ['Kalkulator', [
      [<Kbd key="e">Enter</Kbd>, 'oblicz'],
      [<><Kbd>↑</Kbd> <Kbd>↓</Kbd></>, 'poprzednie obliczenia w polu wpisywania'],
    ]],
    ['Geometria', [
      [<><Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd></>, 'cofnij (Ctrl + Y lub Ctrl + Shift + Z: ponów)'],
      [<Kbd key="d">Delete</Kbd>, 'usuń zaznaczony obiekt'],
      [<Kbd key="esc">Esc</Kbd>, 'przerwij rysowanie, wróć do narzędzia Przesuń'],
    ]],
  ];
  return (
    <div className="b-help-keys">
      {groups.map(([name, rows]) => (
        <section key={name}>
          <h3>{name}</h3>
          <table className="b-help-table"><tbody>{rows.map(([k, what], i) => <tr key={i}><td>{k}</td><td>{what}</td></tr>)}</tbody></table>
        </section>
      ))}
    </div>
  );
}

export function Help() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('zapis');
  // a click on the backdrop closes it, like Esc
  useEffect(() => {
    const d = dialog.current!, onClick = (e: MouseEvent) => { if (e.target === d) d.close(); };
    d.addEventListener('click', onClick);
    return () => d.removeEventListener('click', onClick);
  }, []);
  return (
    <dialog ref={dialog} id="help" className="b-dialog b-help" aria-labelledby="help-title">
      <header className="b-help-head">
        <h2 id="help-title">Pomoc</h2>
        <Button variant="ghost" icon={<IconClose />} aria-label="Zamknij" title="Zamknij  Esc" onClick={() => dialog.current?.close()} />
      </header>
      <div className="b-help-tabs">
        <SegmentedControl<Tab> kind="tabs" variant="tray" fullWidth aria-label="Część pomocy" value={tab} onChange={setTab} options={TABS.map(t => ({ ...t, controls: 'help-panel' }))} />
      </div>
      <div id="help-panel" role="tabpanel" aria-label={TABS.find(t => t.value === tab)!.label} className="b-help-body">
        {tab === 'zapis' ? <Syntax /> : tab === 'tryby' ? <Modes /> : <Keys />}
      </div>
      <p className="b-help-foot">Miejsca zerowe i przecięcia są szukane numerycznie w widocznym zakresie. Wartość bez znaku ≈ jest udowodniona w arytmetyce dokładnej. Stan zapisuje się w przeglądarce.</p>
    </dialog>
  );
}
