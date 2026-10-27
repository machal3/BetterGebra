/**
 * The Geometria panel's React parts, rendered into the page's static containers: Tworzenie / Obiekty in the side
 * panel, and over the board (which stays outside React) the favourite tools, the hint, the inspector and the
 * toolbar; the value dialog in the top layer.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SegmentedControl } from '@/components/ui/segmented-control-clean';
import { AskDialog, Hint, Inspector, Toolbar } from './Board';
import { Objects } from './Objects';
import { ToolCatalogue, ToolPalette } from './Tools';
import { useGeo } from './use-geo';
import { Backdrop } from '../Backdrop';
import './geometry.css';

type Tab = 'geo-tab-create' | 'geo-tab-objects';
const TAB_STORE = 'bettergebra.geometry.tab';
function savedTab(): Tab {
  try { return localStorage.getItem(TAB_STORE) === 'geo-tab-objects' ? 'geo-tab-objects' : 'geo-tab-create'; } catch { return 'geo-tab-create'; }
}

export function GeometryPanel() {
  const side = document.getElementById('geo-side'), stage = document.getElementById('geometry');
  const geo = useGeo();
  const [tab, setTab] = useState<Tab>(savedTab);
  const search = useRef<HTMLInputElement>(null), input = useRef<HTMLInputElement>(null);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_STORE, t); } catch { /* just don't remember */ } };
  const count = geo.objects.filter(o => o.def !== 'edge').length;
  return (
    <>
      {side && createPortal(
        <>
          <div className="b-gtabs">
            <SegmentedControl<Tab>
              kind="tabs"
              variant="tray"
              fullWidth
              aria-label="Panel geometrii"
              value={tab}
              onChange={choose}
              options={[
                { value: 'geo-tab-create', label: 'Tworzenie', controls: 'geo-create' },
                { value: 'geo-tab-objects', label: 'Obiekty', count: count || undefined, controls: 'geo-objects' },
              ]}
            />
          </div>
          <div id="geo-create" role="tabpanel" aria-label="Tworzenie" hidden={tab !== 'geo-tab-create'} className="b-gpanel">
            <ToolCatalogue searchRef={search} />
          </div>
          <div id="geo-objects" role="tabpanel" aria-label="Obiekty" hidden={tab !== 'geo-tab-objects'} className="b-gpanel">
            <Objects inputRef={input} />
          </div>
        </>,
        side,
      )}
      {stage && createPortal(
        <>
          {/* an empty board shows the start screen's grid until the first object, or its own grid, is there */}
          <Backdrop className="b-geo-backdrop" shown={!geo.objects.length && !geo.grid} speed={8} />
          <div className="b-gtop">
            <ToolPalette onMore={() => { choose('geo-tab-create'); requestAnimationFrame(() => { search.current?.focus(); search.current?.scrollIntoView({ block: 'nearest' }); }); }} />
            <Hint />
          </div>
          <Inspector />
          <Toolbar />
        </>,
        stage,
      )}
      <AskDialog />
    </>
  );
}
