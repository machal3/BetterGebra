/**
 * The frame around every panel: a top bar with the logo, the mode switch and the help and theme buttons; on phones
 * the mode switch moves to a bar at the bottom, within reach of the thumb.
 */
import { Button } from '@/components/ui/button-clean';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control-clean';
import { IconCalculator, IconComplex, IconGeometry, IconGraph, IconHelp, IconMoon, IconSun } from '@/components/icons';
import { PHONE, useMedia } from '@/hooks/use-media';
import { useStore } from '@/hooks/use-store';
import { CalculatorPanel } from './calculator/CalculatorPanel';
import { Dock } from './Dock';
import { GeometryPanel } from './geometry/GeometryPanel';
import { GraphsPanel } from './graphs/GraphsPanel';
import { openHelp } from './Help';
import { TITLES, openSection, type Panel, type Section } from './navigation';
import { toggleTheme, useDark } from './theme';

/** The rounded square with a curve, also the favicon. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="b-logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" />
      <path d="M6 23c4.5 0 5.5-14 10-14s5.5 14 10 14" />
    </svg>
  );
}

export function ThemeButton() {
  const dark = useDark();
  const label = dark ? 'Jasny motyw' : 'Ciemny motyw';
  return (
    <Button variant="ghost" icon={dark ? <IconSun /> : <IconMoon />} aria-label={label} title={dark ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw'} onClick={toggleTheme} />
  );
}

export function HelpButton() {
  return <Button variant="ghost" icon={<IconHelp />} aria-label="Pomoc i skróty" title="Pomoc i skróty  ?" onClick={openHelp} />;
}

const OPTIONS: SegmentOption<Section>[] = [
  { value: 'graph', label: TITLES.graph, icon: <IconGraph />, controls: 'stage' },
  { value: 'complex', label: TITLES.complex, icon: <IconComplex />, controls: 'stage' },
  { value: 'geometry', label: TITLES.geometry, icon: <IconGeometry />, controls: 'geometry' },
  { value: 'calculator', label: TITLES.calculator, icon: <IconCalculator />, controls: 'calc' },
];

function ModeSwitch({ section, bottom }: { section: Section; bottom?: boolean }) {
  return (
    <SegmentedControl<Section>
      aria-label="Tryb"
      kind="tabs"
      variant="tray"
      size={bottom ? 'lg' : 'md'}
      fullWidth={bottom}
      className={bottom ? 'b-modes b-modes--bottom' : 'b-modes'}
      value={section}
      onChange={openSection}
      options={OPTIONS}
    />
  );
}

export function Shell({ panel }: { panel: Exclude<Panel, 'home'> }) {
  const mode = useStore(['mode'], s => s.mode);
  const phone = useMedia(PHONE);
  const section: Section = panel === 'graphs' ? mode : panel;
  return (
    <>
      <header className="b-topbar">
        <a className="b-brand" href="#start" aria-label="Bettergebra — strona główna" title="Strona główna">
          <Logo size={26} />
          <span className="b-brand-name" aria-hidden="true">Bettergebra</span>
        </a>
        <h1 className="b-topbar-title">{TITLES[section]}</h1>
        {!phone && <nav className="b-topbar-nav" aria-label="Części aplikacji"><ModeSwitch section={section} /></nav>}
        <div className="b-topbar-actions">
          <HelpButton />
          <ThemeButton />
        </div>
      </header>
      {phone && <nav className="b-bottombar" aria-label="Części aplikacji"><ModeSwitch section={section} bottom /></nav>}
      <Dock title={TITLES[section]} />
      <GraphsPanel />
      <CalculatorPanel />
      <GeometryPanel />
    </>
  );
}
