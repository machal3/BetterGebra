/**
 * The React tree: the start screen, or the frame (top bar, bottom bar on phones) around the panels. The panels are
 * still the static index.html driven by src/ui until each one moves in here (docs/affectui-plan.md).
 */
import './shell.css';
import { Home } from './Home';
import { usePanel } from './navigation';
import { Shell } from './Shell';

export function App() {
  const panel = usePanel();
  return panel === 'home' ? <Home /> : <Shell panel={panel} />;
}
