/**
 * The tools: the whole catalogue in the side panel (search, favourites first, then by kind of object; a star pins a
 * tool, drag or Alt + arrows put the favourites in order), and the favourites again as a palette on the board.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { Field, Count, cx } from '@/components/controls';
import { IconStar, IconTools } from '@/components/icons';
import { GROUPS, ICON, TOOLS, setTool, type GroupEntry, type ToolId } from '../../geometry/controller';
import { plain, setFavs, useFavs, useGeo } from './use-geo';

const FAVOURITES = 'Ulubione';

/** The tool's own two-tone drawing (static markup from the board module). */
const ToolIcon = ({ id }: { id: ToolId }) => <span className="b-gtool-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[id] }} />;

export function ToolCatalogue({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const geo = useGeo(), favs = useFavs();
  const [query, setQuery] = useState('');
  const dragged = useRef<ToolId | null>(null);
  const [dropOn, setDropOn] = useState<ToolId | null>(null);
  const words = plain(query).split(/\s+/).filter(Boolean);
  const groups = [{ name: FAVOURITES, tools: favs as GroupEntry[] }, ...GROUPS];
  const moveFav = (id: ToolId, to: number) => {
    const next = favs.filter(f => f !== id);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
    setFavs(next);
  };
  const shownGroups = groups.map(g => {
    const cells = g.tools.map(entry => {
      const [id, label] = typeof entry === 'string' ? [entry, TOOLS[entry].label] : entry;
      return { id, label, search: plain(`${label} ${TOOLS[id].label} ${g.name}`) };
    }).filter(c => words.every(w => c.search.includes(w)));
    // while searching, the favourites step aside: every tool is in its own group too
    const hidden = words.length > 0 && (g.name === FAVOURITES || !cells.length);
    return { ...g, cells, hidden };
  });
  const nothing = words.length > 0 && shownGroups.every(g => g.hidden);

  return (
    <div className="b-gtools">
      <Field
        ref={searchRef}
        type="search"
        className="b-gtools-search"
        aria-label="Szukaj narzędzia"
        placeholder="Szukaj narzędzia…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        // Enter takes the first tool found.
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = shownGroups.find(g => !g.hidden && g.cells.length)?.cells[0];
          if (first) setTool(first.id);
        }}
      />
      {nothing && <p className="b-hint">Nie ma takiego narzędzia.</p>}
      {shownGroups.map(g => !g.hidden && (
        <section className="b-gtool-group" key={g.name} aria-label={g.name}>
          <h3><span>{g.name}</span><Count>{g.tools.length}</Count></h3>
          {g.name === FAVOURITES && !g.tools.length ? (
            <p className="b-hint">Kliknij gwiazdkę przy narzędziu, aby przypiąć je tutaj.</p>
          ) : (
            <div className="b-gtool-grid">
              {g.cells.map(({ id, label }) => {
                const fav = favs.includes(id), at = favs.indexOf(id), inFavs = g.name === FAVOURITES;
                const what = fav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych';
                const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
                  const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[e.key];
                  if (!inFavs || !e.altKey || !step) return;
                  e.preventDefault();
                  moveFav(id, at + step);
                  requestAnimationFrame(() => document.querySelector<HTMLElement>(`.b-gtool-group[aria-label="${FAVOURITES}"] [data-tool="${id}"]`)?.focus());
                };
                return (
                  <div
                    key={id}
                    className={cx('b-gtool-cell', inFavs && dropOn === id && 'is-drop')}
                    draggable={inFavs}
                    onDragStart={inFavs ? e => { dragged.current = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } : undefined}
                    onDragEnd={inFavs ? () => { dragged.current = null; setDropOn(null); } : undefined}
                    onDragOver={inFavs ? e => { if (dragged.current && dragged.current !== id) { e.preventDefault(); setDropOn(id); } } : undefined}
                    onDragLeave={inFavs ? () => setDropOn(null) : undefined}
                    onDrop={inFavs ? e => { e.preventDefault(); if (dragged.current && dragged.current !== id) moveFav(dragged.current, at); setDropOn(null); } : undefined}
                  >
                    <button
                      type="button"
                      className="b-gtool"
                      data-tool={id}
                      aria-pressed={geo.tool === id}
                      title={`${TOOLS[id].label}: ${TOOLS[id].hint}${inFavs ? ' Przeciągnij albo Alt + strzałki, aby zmienić kolejność.' : ''}`}
                      onClick={() => setTool(id)}
                      onKeyDown={onKeyDown}
                    >
                      <ToolIcon id={id} />
                      <span>{label}</span>
                    </button>
                    <button
                      type="button"
                      className="b-gtool-star"
                      aria-pressed={fav}
                      aria-label={`${what}: ${TOOLS[id].label}`}
                      title={what}
                      onClick={() => {
                        setFavs(fav ? favs.filter(f => f !== id) : [...favs, id]);
                        // Keep the keyboard on this tool's star: in its own group when it just left the favourites.
                        if (inFavs) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.b-gtool-group:not([aria-label="${FAVOURITES}"]) [data-tool="${id}"] + .b-gtool-star`)?.focus());
                      }}
                    >
                      <IconStar size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** The favourites on the board, and the way to every other tool. */
export function ToolPalette({ onMore }: { onMore: () => void }) {
  const geo = useGeo(), favs = useFavs();
  return (
    <div className="b-gpalette" role="toolbar" aria-label="Ulubione narzędzia">
      {favs.map(id => (
        <button key={id} type="button" className="b-gpalette-tool" aria-pressed={geo.tool === id} aria-label={TOOLS[id].label} title={`${TOOLS[id].label}: ${TOOLS[id].hint}`} onClick={() => setTool(id)}>
          <ToolIcon id={id} />
        </button>
      ))}
      <span className="b-gpalette-sep" aria-hidden="true" />
      <button type="button" className="b-gpalette-tool" aria-label="Wszystkie narzędzia" title="Wszystkie narzędzia" onClick={onMore}>
        <IconTools size={18} />
      </button>
    </div>
  );
}
