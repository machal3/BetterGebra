/**
 * One icon set for the whole app: 24-unit line icons with round caps, drawn at 16 or 20px like the icons inside the
 * Affect UI components. Most shapes follow Lucide (ISC, lucide.dev); the four mode glyphs are Bettergebra's own.
 * Every icon is its own component, so Button (Clean) sees a new icon as new content and crossfades it.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function make(name: string, paths: ReactNode) {
  const Icon = ({ size = 16, strokeWidth = 1.6, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths}
    </svg>
  );
  Icon.displayName = `Icon${name}`;
  return Icon;
}

/* Modes */
export const IconGraph = make('Graph', <path d="M4 4c1.6 10 4.2 15 8 15s6.4-5 8-15" />);
export const IconComplex = make('Complex', <>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 3.5v17M3.5 12h17" />
  <circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none" />
</>);
export const IconGeometry = make('Geometry', <>
  <path d="M12 4 20 19H4Z" />
  <circle cx="12" cy="13.5" r="3.5" />
</>);
export const IconCalculator = make('Calculator', <>
  <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
  <path d="M8 7.5h8M8.5 12h1.5M14 12h1.5M8.5 16h1.5M14 16h1.5" />
</>);

/* Chrome */
export const IconHelp = make('Help', <>
  <circle cx="12" cy="12" r="9" />
  <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 3.8" />
  <path d="M12 17.2h.01" />
</>);
export const IconSun = make('Sun', <>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
</>);
export const IconMoon = make('Moon', <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const IconArrowRight = make('ArrowRight', <path d="M5 12h14M13 6l6 6-6 6" />);
