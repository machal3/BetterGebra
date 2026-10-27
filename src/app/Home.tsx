/** The start screen: what the three parts do, one action each, over a slowly drifting grid. */
import { GridBackground } from '@/components/ui/grid-background';
import { TextReveal } from '@/components/ui/text-reveal';
import { TipsPanel, type Tip } from '@/components/ui/tips-panel-clean';
import { openSection } from './navigation';
import { HelpButton, Logo, ThemeButton } from './Shell';

const TIPS: Tip[] = [
  {
    id: 'graphs',
    title: 'Wykresy',
    description: 'Funkcje y = f(x), krzywe i obszary w x i y, liczby zespolone i zbiory. Parametry z suwakami, badanie funkcji.',
    action: 'Otwórz Wykresy',
    doneLabel: 'Otwieranie…',
    primary: true,
    onAction: () => openSection('graph'),
  },
  {
    id: 'geometry',
    title: 'Geometria',
    description: 'Punkty, proste, okręgi i konstrukcje, które podążają za przeciąganym punktem.',
    action: 'Otwórz Geometrię',
    doneLabel: 'Otwieranie…',
    onAction: () => openSection('geometry'),
  },
  {
    id: 'calculator',
    title: 'Kalkulator',
    description: 'Wyniki dokładne, równania, pochodne, całki, granice i macierze. Po polsku albo po angielsku.',
    action: 'Otwórz Kalkulator',
    doneLabel: 'Otwieranie…',
    onAction: () => openSection('calculator'),
  },
];

export function Home() {
  return (
    <GridBackground className="b-home" size={48} speed={4}>
      <div className="b-home-corner">
        <HelpButton />
        <ThemeButton />
      </div>
      <main className="b-home-main" aria-labelledby="home-title">
        <h1 id="home-title" className="b-home-brand">
          <Logo size={44} />
          <span>Bettergebra</span>
        </h1>
        <TextReveal as="p" className="b-home-lead" text="Co chcesz dziś robić?" stagger={60} />
        <TipsPanel className="b-home-tips" title="Wybierz część" tips={TIPS} showCount={false} />
      </main>
    </GridBackground>
  );
}
