import { useState } from 'react';
import { addDays, dayOfWeek, eachDay, mondayOf, monthEnd, parseDate } from '../lib/dates';
import { MON, ddm, monthLabel } from '../lib/format';

export type CalLayer = { key: string; label: string; colour: string };
export type CalEvent = { id: string; layer: string; title: string; date: string; end?: string; time?: string; href?: string; workdaysOnly?: boolean };
type Mode = 'month' | 'week' | 'day';

/** Month / week / day calendar with toggleable layers. */
export function CalendarView({ layers, events, today, initialMode = 'month', threshold }: {
  layers: CalLayer[]; events: CalEvent[]; today: string; initialMode?: Mode;
  /** Optional per-day warning (e.g. team away above a threshold). */
  threshold?: (date: string) => string | null;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [cursor, setCursor] = useState(today);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.map((l) => [l.key, true])));
  const visible = events.filter((e) => on[e.layer]);
  const onDay = (d: string) => visible.filter((e) => d >= e.date && d <= (e.end ?? e.date) && !(e.workdaysOnly && [0, 6].includes(dayOfWeek(d))));
  const colour = (k: string) => layers.find((l) => l.key === k)?.colour ?? 'var(--faint)';
  const step = (dir: number) => {
    if (mode === 'day') setCursor(addDays(cursor, dir));
    else if (mode === 'week') setCursor(addDays(cursor, dir * 7));
    else {
      const d = parseDate(cursor);
      const n = new Date(d.getFullYear(), d.getMonth() + dir, 1);
      setCursor(n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-01');
    }
  };
  const title = mode === 'month' ? monthLabel(cursor.slice(0, 7)) : mode === 'week' ? ddm(mondayOf(cursor)) + ' – ' + ddm(addDays(mondayOf(cursor), 6)) : ddm(cursor) + ' ' + cursor.slice(0, 4);
  const Ev = ({ e }: { e: CalEvent }) => {
    const body = <><i style={{ background: colour(e.layer) }} />{e.time && <b>{e.time}</b>}{e.title}</>;
    return e.href ? <a href={'#' + e.href} className="cal-ev" title={e.title}>{body}</a> : <span className="cal-ev" title={e.title}>{body}</span>;
  };
  return (
    <div>
      <div className="cal-bar">
        <div className="weekpick" style={{ height: 38 }}>
          <button aria-label="Previous" onClick={() => step(-1)}>‹</button>
          <div style={{ minWidth: 180 }}><b style={{ fontWeight: 500 }}>{title}</b></div>
          <button aria-label="Next" onClick={() => step(1)}>›</button>
        </div>
        <button className="btn-line" style={{ height: 38 }} onClick={() => setCursor(today)}>Today</button>
        <div className="viewseg" style={{ marginTop: 0 }} role="group" aria-label="View">
          {(['month', 'week', 'day'] as Mode[]).map((m) => <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <div className="cal-layers" role="group" aria-label="Layers">
          {layers.map((l) => (
            <button key={l.key} aria-pressed={on[l.key]} className={on[l.key] ? 'on' : ''} onClick={() => setOn({ ...on, [l.key]: !on[l.key] })}>
              <i style={{ background: on[l.key] ? l.colour : 'transparent', borderColor: l.colour }} />{l.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'month' && (() => {
        const first = cursor.slice(0, 8) + '01';
        const lead = (dayOfWeek(first) + 6) % 7;
        const days = eachDay(first, monthEnd(cursor));
        return (
          <div className="card cal-month">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={'b' + i} className="cal-cell blank" />)}
            {days.map((d) => {
              const evs = onDay(d);
              const warn = threshold?.(d);
              return (
                <div key={d} className={'cal-cell' + (d === today ? ' today' : '') + ([0, 6].includes(dayOfWeek(d)) ? ' wkend' : '') + (warn ? ' warn' : '')}>
                  <button className="cal-n" onClick={() => { setCursor(d); setMode('day'); }} aria-label={'Open ' + ddm(d)}>{parseDate(d).getDate()}</button>
                  {warn && <div className="cal-warn" title={warn}>{warn}</div>}
                  {evs.slice(0, 3).map((e) => <Ev key={e.id + d} e={e} />)}
                  {evs.length > 3 && <button className="cal-more" onClick={() => { setCursor(d); setMode('day'); }}>+{evs.length - 3} more</button>}
                </div>
              );
            })}
          </div>
        );
      })()}
      {mode === 'week' && (
        <div className="card cal-week">
          {Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cursor), i)).map((d) => {
            const warn = threshold?.(d);
            return (
              <div key={d} className={'cal-wday' + (d === today ? ' today' : '') + (warn ? ' warn' : '')}>
                <div className="cal-wh"><b>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i(d, cursor)]}</b> {parseDate(d).getDate()} {MON[parseDate(d).getMonth()]}</div>
                {warn && <div className="cal-warn">{warn}</div>}
                {onDay(d).map((e) => <Ev key={e.id + d} e={e} />)}
                {!onDay(d).length && <span className="cal-none">—</span>}
              </div>
            );
          })}
        </div>
      )}
      {mode === 'day' && (
        <div className="card" style={{ marginTop: 16, padding: '8px 20px' }}>
          {threshold?.(cursor) && <div className="cal-warn" style={{ margin: '12px 0' }}>{threshold(cursor)}</div>}
          {onDay(cursor).map((e) => (
            <div key={e.id} className="kv" style={{ gridTemplateColumns: '160px 1fr' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: colour(e.layer), display: 'block' }} />{layers.find((l) => l.key === e.layer)?.label}</span>
              <span>{e.time && <b style={{ fontWeight: 500 }}>{e.time} · </b>}{e.href ? <a href={'#' + e.href} className="ulink">{e.title}</a> : e.title}</span>
            </div>
          ))}
          {!onDay(cursor).length && <div className="empty-s" style={{ padding: 24 }}>Nothing on this day in the selected layers.</div>}
        </div>
      )}
    </div>
  );
}
const i = (d: string, cursor: string) => Math.round((Date.parse(d) - Date.parse(mondayOf(cursor))) / 864e5);
