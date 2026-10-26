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
export const IconPlus = make('Plus', <path d="M12 5v14M5 12h14" />);
export const IconClose = make('Close', <path d="M6 6l12 12M18 6 6 18" />);
export const IconTrash = make('Trash', <>
  <path d="M4 7h16M9.5 7V5.2c0-.66.54-1.2 1.2-1.2h2.6c.66 0 1.2.54 1.2 1.2V7" />
  <path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5" />
</>);
export const IconSliders = make('Sliders', <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />);
export const IconCopy = make('Copy', <>
  <rect x="8" y="8" width="12" height="12" rx="2.5" />
  <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
</>);
export const IconSearch = make('Search', <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>);
export const IconZoomIn = make('ZoomIn', <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M11 8.5v5M8.5 11h5" /></>);
export const IconZoomOut = make('ZoomOut', <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M8.5 11h5" /></>);
/** Fit y: a frame with arrows along the vertical. */
export const IconFitY = make('FitY', <path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9M17 4v16M14.5 6.5 17 4l2.5 2.5M14.5 17.5 17 20l2.5-2.5" />);
/** Equal axes: "1:1" in a frame. */
export const IconRatio = make('Ratio', <>
  <rect x="3" y="5" width="18" height="14" rx="2.5" />
  <path d="M7.5 9.5 9 8.5v7M15.5 9.5l1.5-1M17 8.5v7M12 10.6h.01M12 13.4h.01" />
</>);
export const IconReset = make('Reset', <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>);
export const IconDownload = make('Download', <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />);
export const IconChevronDown = make('ChevronDown', <path d="m7 10 5 5 5-5" />);
export const IconAlert = make('Alert', <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4h.01" /></>);
export const IconEye = make('Eye', <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = make('EyeOff', <path d="M3 3l18 18M10.6 5.6A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />);
