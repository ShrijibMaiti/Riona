import { useState, type ReactNode } from 'react';

export type KanbanColumn = { key: string; label: string; wip?: number };

/**
 * Columns of cards with drag-and-drop, WIP limits and optional swimlanes.
 * Keyboard: focus a card and press ← / → to move it between columns.
 */
export function KanbanBoard<T>({ columns, items, colOf, idOf, render, onMove, onOpen, lanes, laneOf, minColWidth = 260, hint }: {
  columns: KanbanColumn[];
  items: T[];
  colOf: (t: T) => string;
  idOf: (t: T) => string;
  render: (t: T) => ReactNode;
  onMove?: (id: string, col: string) => void;
  onOpen?: (t: T) => void;
  lanes?: { key: string; label: string }[];
  laneOf?: (t: T) => string;
  minColWidth?: number;
  hint?: string;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const laneList = lanes && laneOf ? lanes : [{ key: '_', label: '' }];
  const move = (id: string, dir: number) => {
    const t = items.find((x) => idOf(x) === id);
    if (!t || !onMove) return;
    const i = columns.findIndex((c) => c.key === colOf(t));
    const j = Math.max(0, Math.min(columns.length - 1, i + dir));
    if (j !== i) onMove(id, columns[j].key);
  };
  return (
    <div>
      {laneList.map((lane) => {
        const inLane = items.filter((t) => !laneOf || lane.key === '_' || laneOf(t) === lane.key);
        return (
          <div key={lane.key}>
            {lane.label && <div className="kb-lane">{lane.label}<span>{inLane.length}</span></div>}
            <div className="kb" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${minColWidth}px, 1fr))` }}>
              {columns.map((col) => {
                const cards = inLane.filter((t) => colOf(t) === col.key);
                const total = items.filter((t) => colOf(t) === col.key).length;
                const overWip = col.wip !== undefined && total > col.wip;
                const k = lane.key + '|' + col.key;
                return (
                  <div key={col.key} className={'kb-col' + (over === k ? ' over' : '')} role="list" aria-label={col.label}
                    onDragOver={(e) => { if (onMove) { e.preventDefault(); setOver(k); } }}
                    onDragLeave={() => setOver((o) => (o === k ? null : o))}
                    onDrop={(e) => { e.preventDefault(); if (drag && onMove) onMove(drag, col.key); setDrag(null); setOver(null); }}>
                    <div className="kb-head">
                      <div><b>{col.label}</b><span>{cards.length}{col.wip !== undefined ? ' / ' + col.wip : ''}</span></div>
                      {overWip && <span className="kb-wip"><i />Over WIP limit · {total} of {col.wip}</span>}
                    </div>
                    <div className="kb-cards">
                      {cards.map((t) => {
                        const id = idOf(t);
                        return (
                          <div key={id} role="listitem" tabIndex={0} className="kb-card" draggable={!!onMove} style={{ opacity: drag === id ? 0.4 : 1 }}
                            onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
                            onDragEnd={() => { setDrag(null); setOver(null); }}
                            onClick={() => onOpen?.(t)}
                            onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(t); if (e.key === 'ArrowRight') move(id, 1); if (e.key === 'ArrowLeft') move(id, -1); }}>
                            {render(t)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {hint && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>{hint}</div>}
    </div>
  );
}
