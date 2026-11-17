import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { awaitingMe } from '../../data/selectors/approvals';
import type { TimesheetEntry } from '../../data/types';
import { useApprovals, useClients, useEmployees, useMe, useProjects } from '../../hooks/data';
import { APPROVAL_DOMAINS } from '../../hooks/actions';
import { addDays, mondayOf } from '../../lib/dates';
import { MON, dmy, hours, ago } from '../../lib/format';
import { invalidate, useQuery } from '../../lib/query';
import { useApp } from '../../state/store';
import { timer, useTimer } from './timer';

const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Row = { key: string; projectId: string; taskId: string | null; note: string; billable: boolean; h: string[] };

const toRows = (entries: TimesheetEntry[], weekStart: string): Row[] => {
  const m = new Map<string, Row>();
  for (const e of entries) {
    const k = e.projectId + '|' + (e.taskId ?? e.note) + '|' + e.billable;
    let r = m.get(k);
    if (!r) { r = { key: k, projectId: e.projectId, taskId: e.taskId, note: e.note, billable: e.billable, h: ['', '', '', '', '', '', ''] }; m.set(k, r); }
    const i = Math.round((Date.parse(e.date) - Date.parse(weekStart)) / 864e5);
    r.h[i] = String((+r.h[i] || 0) + e.hours);
  }
  return [...m.values()];
};
const n = (v: string) => +v || 0;
const fmtDay = (d: string) => +d.slice(8) + ' ' + MON[+d.slice(5, 7) - 1];

export default function Timesheets({ startTimer }: { startTimer?: boolean }) {
  const { say, role } = useApp();
  const me = useMe();
  const projects = useProjects(), clients = useClients(), emps = useEmployees(), aps = useApprovals();
  const today = me.data?.today;
  const meId = me.data?.employee.id;
  const [wk, setWk] = useState<string | null>(null);
  const weekStart = wk ?? (today ? mondayOf(today) : '');
  const [who, setWho] = useState('');
  const subject = who || meId || '';
  const entriesQ = useQuery(['entries', subject, weekStart], () => api.getTimesheetEntries({ employeeId: subject, from: weekStart, to: addDays(weekStart, 6) }), { enabled: !!subject && !!weekStart });
  const weekQ = useQuery(['weeks', subject, weekStart], () => api.getTimesheetWeeks({ employeeId: subject, weekStart }), { enabled: !!subject && !!weekStart });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sel, setSel] = useState({ r: 0, d: 0 });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'current' | 'first'>('current');
  const t = useTimer();
  const dirty = useRef(false);

  // Load rows when the week or person changes.
  useEffect(() => { setRows(null); setView('current'); }, [weekStart, subject]);
  useEffect(() => {
    if (rows === null && entriesQ.data && !entriesQ.refreshing) setRows(toRows(entriesQ.data, weekStart));
  }, [entriesQ.data, entriesQ.refreshing, rows, weekStart]);
  useEffect(() => {
    if (today && rows && !who && weekStart === mondayOf(today)) {
      const di = (Math.round((Date.parse(today) - Date.parse(weekStart)) / 864e5));
      setSel((s) => (s.d === 0 && s.r === 0 ? { r: 0, d: Math.min(6, di) } : s));
    }
  }, [today, rows, who, weekStart]);
  useEffect(() => { if (startTimer && today) timer.start(); }, [startTimer, today]);

  const week = weekQ.data?.[0];
  const status = week?.status ?? 'Draft';
  const locked = status === 'Submitted' || status === 'Approved' || !!who || view === 'first';
  const myProjects = useMemo(() => projects.data?.filter((p) => p.status === 'Active' && p.team.some((m) => m.employeeId === subject)) ?? [], [projects.data, subject]);
  const pName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id;
  const cName = (pid: string) => clients.data?.find((c) => c.id === projects.data?.find((p) => p.id === pid)?.clientId)?.name ?? '';

  // Autosave drafts so the server always has the latest grid.
  const save = async (next: Row[]) => {
    if (!meId) return;
    await api.saveTimesheetWeek(meId, weekStart, next.map((r) => ({ projectId: r.projectId, taskId: r.taskId, note: r.note, billable: r.billable, hours: r.h.map(n) })));
    invalidate('entries', 'weeks');
  };
  const saveTimer = useRef<number>();
  const update = (next: Row[]) => {
    setRows(next);
    dirty.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { save(next); dirty.current = false; }, 500);
  };
  const setH = (ri: number, di: number, v: string) => {
    if (!/^\d{0,2}(\.\d{0,2})?$/.test(v) || !rows) return;
    if (+v > 24) return;
    update(rows.map((r, i) => (i === ri ? { ...r, h: r.h.map((y, j) => (j === di ? v : y)) } : r)));
  };
  const toggleB = (ri: number) => {
    if (locked || !rows) return;
    const r = rows[ri];
    update(rows.map((x, i) => (i === ri ? { ...x, billable: !x.billable } : x)));
    say((r.note || pName(r.projectId)) + (r.billable ? ' marked internal — it won’t reach ' + cName(r.projectId) + '’s invoice' : ' marked billable — it will flow to ' + cName(r.projectId) + '’s next invoice'));
  };
  const addRow = () => {
    if (!rows || !myProjects.length) return;
    update([...rows, { key: 'new' + Date.now(), projectId: myProjects[0].id, taskId: null, note: '', billable: true, h: ['', '', '', '', '', '', ''] }]);
  };
  // Timer stop writes into the selected cell.
  useEffect(() => timer.onStop((add) => {
    setRows((cur) => {
      if (!cur || !cur.length || locked) { say('Pick a cell in an editable week first'); return cur; }
      const next = cur.map((r, i) => (i === sel.r ? { ...r, h: r.h.map((y, j) => (j === sel.d ? String(n(y) + add) : y)) } : r));
      window.setTimeout(() => save(next), 0);
      say('Added ' + hours(add) + ' to ' + (cur[sel.r].note || pName(cur[sel.r].projectId)) + ' · ' + DN[sel.d]);
      return next;
    });
  }));

  const submit = async () => {
    if (!meId || !rows) return;
    setBusy(true);
    try {
      window.clearTimeout(saveTimer.current);
      await save(rows);
      await api.submitTimesheetWeek(meId, weekStart);
      invalidate('weeks', 'entries', ...APPROVAL_DOMAINS);
      say('Week of ' + fmtDay(weekStart) + ' submitted · ' + hours(rows.reduce((a, r) => a + r.h.reduce((x, y) => x + n(y), 0), 0)));
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const recall = async () => {
    if (!meId || status !== 'Submitted' || who) return;
    try {
      await api.recallTimesheetWeek(meId, weekStart);
      invalidate('weeks', 'entries', ...APPROVAL_DOMAINS);
      setRows(null);
      say('Submission recalled — the grid is editable again');
    } catch (e) { say((e as Error).message); }
  };

  const [pickedDay, setPickedDay] = useState<number | null>(null);
  if (entriesQ.error) return <div className="wrap page"><ErrorState error={entriesQ.error} retry={entriesQ.refetch} /></div>;
  const days = DN.map((d, i) => ({ n: d, date: weekStart ? fmtDay(addDays(weekStart, i)) : '', iso: weekStart ? addDays(weekStart, i) : '', today: weekStart && addDays(weekStart, i) === today }));
  // On phones the grid shows one day at a time (picked above it); on wider screens every day is visible.
  const mday = pickedDay ?? Math.max(0, days.findIndex((d) => d.today));
  const off = (i: number) => (i === mday ? '' : ' ts-off');
  const firstRev = week?.revisions.find((r) => r.status === 'Rejected');
  // "As first submitted" renders the entries stored with the rejected submission, read-only.
  const firstRows = firstRev?.entries ? toRows(firstRev.entries, weekStart) : null;
  const R = view === 'first' && firstRows ? firstRows : rows ?? [];
  const tot = DN.map((_, i) => R.reduce((a, r) => a + n(r.h[i]), 0));
  const all = tot.reduce((a, b) => a + b, 0);
  const bill = R.filter((r) => r.billable).reduce((a, r) => a + r.h.reduce((x, y) => x + n(y), 0), 0);
  const billClients = [...new Set(R.filter((r) => r.billable && r.h.some(n)).map((r) => cName(r.projectId)))];
  const thisWeek = today ? mondayOf(today) : '';
  const weekName = weekStart === thisWeek ? 'This week' : weekStart === addDays(thisWeek, -7) ? 'Last week' : weekStart === addDays(thisWeek, 7) ? 'Next week' : '';
  // Managers may open a week only when it is waiting on their approval.
  const waiting = (aps.data ?? []).filter((a) => a.type === 'Timesheet' && meId && awaitingMe(a, meId) && a.source.kind === 'Timesheet' && a.source.week.weekStart === weekStart);
  const resub = week && week.revisions.some((r) => r.status === 'Rejected');
  const first = week?.revisions.find((r) => r.status === 'Rejected');
  const tr = R[sel.r];
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <div className="ph">
        <div>
          <h1 className="display">Timesheets</h1>
          <p className="ph-desc">One entry here becomes payroll cost, an invoice line and project margin. The billable switch decides whether it reaches the client.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="timer">
            {t.running && <span className="dot" style={{ background: 'var(--red)', width: 7, height: 7 }} />}
            <div><div className="timer-t">{t.label}</div><div className="timer-s">On {tr ? (tr.note || pName(tr.projectId)) + ' · ' + DN[sel.d] : '—'}</div></div>
            {!t.running && <button onClick={() => { if (weekStart !== thisWeek) setWk(thisWeek); timer.start(); }}>Start</button>}
            {t.running && <button onClick={() => timer.pause()}>Pause</button>}
            {t.ms > 0 && <button onClick={() => timer.stop()}>Stop</button>}
          </div>
          {!locked && <button className="btn-dark ts-big" disabled={busy || !R.some((r) => r.h.some(n))} onClick={submit}>{busy ? 'Submitting…' : 'Submit week'}</button>}
          {locked && <button className="btn-line ts-big" onClick={recall} disabled={status !== 'Submitted' || !!who}>{who ? 'Read-only' : status === 'Approved' ? 'Approved' : 'Recall submission'}</button>}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 36 }}>
        <div className="weekpick">
          <button aria-label="Previous week" onClick={() => setWk(addDays(weekStart, -7))} disabled={weekStart <= '2026-05-04'}>‹</button>
          <div><span style={{ fontWeight: 500 }}>{weekName}</span> <span style={{ color: 'var(--muted)' }}>{weekName ? '· ' : ''}{weekStart && fmtDay(weekStart) + ' – ' + fmtDay(addDays(weekStart, 6)) + ' ' + weekStart.slice(0, 4)}</span></div>
          <button aria-label="Next week" onClick={() => setWk(addDays(weekStart, 7))} disabled={weekStart >= addDays(thisWeek, 7)}>›</button>
        </div>
        {role !== 'Employee' && (waiting.length > 0 || who) && (
          <select className="fselect" style={{ height: 38, maxWidth: 260 }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose week">
            <option value="">{me.data?.employee.name} (you)</option>
            {waiting.map((a) => <option key={a.id} value={a.requesterId}>{emps.data?.find((e) => e.id === a.requesterId)?.name} · awaiting you</option>)}
          </select>
        )}
        <StatusLabel label={status} colour={status === 'Draft' ? 'gray' : undefined} />
        <div style={{ flex: 1 }} />
        {role !== 'Employee' && <a href="#/app/work/timesheets/approvals" className="ulink">Team approvals</a>}
      </div>
      {resub && first && (
        <div className="dual" style={{ marginTop: 16 }}>
          <div className="viewseg" style={{ marginTop: 0 }}>
            <button className={view === 'current' ? 'active' : ''} onClick={() => setView('current')}>As resubmitted</button>
            <button className={view === 'first' ? 'active' : ''} onClick={() => setView('first')}>As first submitted</button>
          </div>
          <div className="dual-note">
            {view === 'current'
              ? <>Rejected {ago(first.at)}: “{first.note}” Resubmitted with <b>{hours(week!.revisions[week!.revisions.length - 1].totalHours)}</b>, {hours(week!.revisions[week!.revisions.length - 1].billableHours)} billable.</>
              : <>First submitted with <b>{hours(first.totalHours)}</b>, {hours(first.billableHours)} billable — <b>{hours(Math.abs(first.totalHours - week!.revisions[week!.revisions.length - 1].totalHours))}</b> {(week!.revisions[week!.revisions.length - 1].totalHours - first.totalHours) > 0 ? 'fewer' : 'more'} than the version {status === 'Approved' ? 'that was approved' : 'now waiting on approval'}. The grid below shows the week as first submitted, read-only.</>}
          </div>
        </div>
      )}
      <div className="ts-daypick" role="tablist" aria-label="Day">
        {days.map((d, i) => <button key={d.n} role="tab" aria-selected={i === mday} onClick={() => setPickedDay(i)}><b>{d.n}</b><span>{tot[i] ? hours(tot[i]) : '—'}</span></button>)}
      </div>
      <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
        <div className="ts-grid">
          <div className="ts-row ts-head">
            <span className="th">Project · task</span><span className="th">Billable</span>
            {days.map((d, i) => <span key={d.n} className={'ts-day' + (d.today ? ' today' : '') + off(i)}><b>{d.n}</b><i>{d.date}</i></span>)}
            <span className="th" style={{ textAlign: 'right' }}>Total</span>
          </div>
          {!rows && <SkeletonRows n={4} />}
          {rows && R.map((r, ri) => (
            <div key={r.key} className="ts-row">
              <div style={{ minWidth: 0 }}>
                {r.key.startsWith('new') && !locked ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <select className="ts-in" value={r.projectId} onChange={(e) => update(R.map((x, i) => (i === ri ? { ...x, projectId: e.target.value } : x)))} aria-label="Project">{myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <input className="ts-in" placeholder="What did you work on?" value={r.note} onChange={(e) => update(R.map((x, i) => (i === ri ? { ...x, note: e.target.value } : x)))} aria-label="Task" />
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{r.note || pName(r.projectId)}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{pName(r.projectId)} · {cName(r.projectId)}</div>
                  </>
                )}
              </div>
              <button className="bswitch" onClick={() => toggleB(ri)} aria-pressed={r.billable} disabled={locked}>
                <span className={'sw' + (r.billable ? ' on' : '')}><i /></span><span>{r.billable ? 'Billable' : 'Internal'}</span>
              </button>
              {r.h.map((v, di) => {
                const isSel = !locked && sel.r === ri && sel.d === di;
                return <input key={di} className={'ts-cell' + (isSel ? ' sel' : '') + off(di)} value={v === '0' ? '' : v} disabled={locked} inputMode="decimal" placeholder="0" aria-label={(r.note || pName(r.projectId)) + ', ' + DN[di]}
                  onChange={(e) => setH(ri, di, e.target.value)} onFocus={() => setSel({ r: ri, d: di })} />;
              })}
              <span className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 500 }}>{hours(r.h.reduce((a, y) => a + n(y), 0))}</span>
            </div>
          ))}
          {rows && !R.length && (
            <div style={{ padding: '56px 20px', textAlign: 'center', borderTop: '1px solid var(--line-soft)' }}>
              <div style={{ fontSize: 14.5, fontWeight: 500 }}>No time logged for this week yet.</div>
              {!locked && <button className="btn-dark" style={{ marginTop: 16, height: 38 }} onClick={addRow} disabled={!myProjects.length}>Add a row</button>}
            </div>
          )}
          {rows && R.length > 0 && !locked && <div className="ts-add"><button className="link-btn" onClick={addRow} disabled={!myProjects.length}>+ Add a row</button></div>}
          <div className="ts-row ts-foot">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Daily total</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>Expected 8 h</span>
            {tot.map((v, i) => {
              const past = days[i].iso && today ? days[i].iso < today : false;
              const under = i < 5 && past && v < 8;
              return <span key={i} className={'ts-tot' + (under ? ' under' : '') + off(i)}>{v ? hours(v) : '—'}</span>;
            })}
            <span className="num" style={{ textAlign: 'right', fontSize: 15, fontWeight: 600 }}>{hours(all)}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', marginTop: 24 }}>
        <div style={{ flex: '0 1 360px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="bar" style={{ flex: 1, marginTop: 0, background: 'var(--line-input)' }}><div style={{ width: all ? (bill / all) * 100 + '%' : 0, background: 'var(--green, #557A3E)' }} /></div>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{all ? Math.round((bill / all) * 100) : 0}% billable</span>
        </div>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{hours(bill)} billable flows to {billClients.length ? billClients.join(' and ') + '’s next invoice' : 'no client yet'} · {hours(all - bill)} internal</span>
      </div>
      {week && week.revisions.length > 0 && (
        <div style={{ marginTop: 40, maxWidth: 640 }}>
          <div className="section-title">Week history</div>
          {week.revisions.map((r, i) => (
            <div key={i} className="kv" style={{ gridTemplateColumns: '150px 1fr auto' }}>
              <span>{dmy(r.at)}</span><span><StatusLabel label={r.status} />{r.note && <span style={{ color: 'var(--muted)' }}> · {r.note}</span>}</span><span className="num">{hours(r.totalHours)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
