/**
 * The React tree: the start screen, or the frame (top bar, bottom bar on phones) around the panels, which render
 * into the page's static containers next to their canvases; Pomoc and the messages on every screen.
 */
import './shell.css';
import './overlays.css';
import { Help } from './Help';
import { Home } from './Home';
import { usePanel } from './navigation';
import { Shell } from './Shell';
import { Toaster } from './toast';

export function App() {
  const panel = usePanel();
  return (
    <>
      {panel === 'home' ? <Home /> : <Shell panel={panel} />}
      <Help />
      <Toaster />
    </>
  );
}
