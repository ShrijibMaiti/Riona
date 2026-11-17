import { useState } from 'react';
import { addDays, daysBetween, parseDate } from '../lib/dates';
import { MON, dm } from '../lib/format';

export type GanttBar = { start: string; end: string; done?: boolean; colour?: string; label?: string };
export type GanttRow = { key: string; label: string; sub?: string; bars: GanttBar[]; href?: string };
export type GanttDep = { from: string; to: string };
export type Zoom = 'week' | 'month' | 'quarter';
const PX: Record<Zoom, number> = { week: 28, month: 9, quarter: 3.2 };

/** Bars on a date axis, with dependencies, milestones, today line and zoom. */
export function TimelineGantt({ rows, deps = [], milestones = [], today, from, to, labelWidth = 240, note }: {
  rows: GanttRow[]; deps?: GanttDep[]; milestones?: { date: string; label: string }[]; today: string; from: string; to: string; labelWidth?: number; note?: string;
}) {
  const [zoom, setZoom] = useState<Zoom>('month');
  const start = addDays(from, -7), end = addDays(to, 14);
  const days = daysBetween(start, end);
  const px = PX[zoom];
  const width = Math.max(600, days * px);
  const x = (d: string) => daysBetween(start, d) * px;
  // Axis ticks: weeks at week zoom, months otherwise.
  const ticks: { left: number; label: string }[] = [];
  if (zoom === 'week') for (let d = start; d <= end; d = addDays(d, 7)) ticks.push({ left: x(d), label: dm(d) });
  else {
    const s = parseDate(start);
    for (let m = new Date(s.getFullYear(), s.getMonth() + 1, 1); m <= parseDate(end); m.setMonth(m.getMonth() + (zoom === 'quarter' ? 3 : 1))) {
      const iso = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-01';
      ticks.push({ left: x(iso), label: MON[m.getMonth()] + (m.getMonth() === 0 || zoom === 'quarter' ? ' ' + m.getFullYear() : '') });
    }
  }
  const ROW = 56;
  const rowIndex = new Map(rows.map((r, i) => [r.key, i]));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <div className="viewseg" style={{ marginTop: 0 }} role="group" aria-label="Zoom">
          {(['week', 'month', 'quarter'] as Zoom[]).map((z) => <button key={z} className={zoom === z ? 'active' : ''} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z[0].toUpperCase() + z.slice(1)}</button>)}
        </div>
      </div>
      <div className="card gantt" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: labelWidth + 'px 1fr' }}>
          <div className="gantt-labels">
            <div className="gantt-h" />
            {rows.map((r) => (
              <div key={r.key} className="gantt-l">{r.href ? <a href={'#' + r.href}>{r.label}</a> : r.label}{r.sub && <span>{r.sub}</span>}</div>
            ))}
            {milestones.length > 0 && <div className="gantt-l" style={{ color: 'var(--ink-3)' }}>Milestones</div>}
          </div>
          <div className="gantt-scroll">
            <div style={{ position: 'relative', width }}>
              <div className="gantt-h" style={{ position: 'relative' }}>
                {ticks.map((t) => <span key={t.left} className="gantt-tick" style={{ left: t.left }}>{t.label}</span>)}
              </div>
              {rows.map((r) => (
                <div key={r.key} className="gantt-r">
                  {ticks.map((t) => <span key={t.left} className="gantt-grid" style={{ left: t.left }} />)}
                  {r.bars.map((b, i) => (
                    <div key={i} className="gantt-bar" title={(b.label ?? r.label) + ' · ' + dm(b.start) + ' – ' + dm(b.end)}
                      style={{ left: x(b.start), width: Math.max(px, x(b.end) - x(b.start) + px), background: b.colour ?? (b.done ? '#D6D9CD' : 'var(--violet)') }} />
                  ))}
                  <span className="gantt-today" style={{ left: x(today) }} />
                </div>
              ))}
              {milestones.length > 0 && (
                <div className="gantt-r" style={{ borderBottom: 'none' }}>
                  {milestones.map((m) => <span key={m.date + m.label} className="gantt-ms" title={m.label + ' · ' + dm(m.date)} style={{ left: x(m.date) - 6 }} />)}
                  <span className="gantt-today" style={{ left: x(today) }} />
                  <span className="gantt-today-l" style={{ left: x(today) + 6 }}>Today · {dm(today)}</span>
                </div>
              )}
              {/* Dependencies: elbow lines from the end of one bar to the start of the next. */}
              <svg className="gantt-deps" width={width} height={56 + rows.length * ROW} aria-hidden>
                {deps.map((d) => {
                  const a = rowIndex.get(d.from), b = rowIndex.get(d.to);
                  if (a === undefined || b === undefined) return null;
                  const ra = rows[a].bars[rows[a].bars.length - 1], rb = rows[b].bars[0];
                  if (!ra || !rb) return null;
                  const x1 = x(ra.end) + px, y1 = 44 + a * ROW + ROW / 2, x2 = x(rb.start), y2 = 44 + b * ROW + ROW / 2;
                  const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
                  return <path key={d.from + d.to} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke="#8D9184" strokeWidth="1.2" markerEnd="url(#arr)" />;
                })}
                <defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#8D9184" /></marker></defs>
              </svg>
            </div>
          </div>
        </div>
      </div>
      {note && <div style={{ display: 'flex', gap: 20, fontSize: 12.5, color: 'var(--muted)', marginTop: 12, flexWrap: 'wrap' }}>{note}</div>}
    </div>
  );
}
