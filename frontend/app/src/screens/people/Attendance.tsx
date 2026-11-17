import { useMemo, useState } from 'react';
import { DataTable, Mono, PersonCell, Status, downloadCsv, type Column } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import { ApprovalQueue } from '../../components/ApprovalQueue';
import { isPresent, isScheduled } from '../../data/selectors/people';
import type { AttendanceDay, Employee } from '../../data/types';
import { useAllAttendance, useEmployees, useMe } from '../../hooks/data';
import { addMonths, dayOfWeek, eachDay, monthEnd, parseDate } from '../../lib/dates';
import { SC, ddm, monthLabel } from '../../lib/format';
import { useApp } from '../../state/store';

const VIEWS = (role: string) => [
  { label: 'Daily log', href: '/app/people/attendance' },
  ...(role === 'Admin' || role === 'HR' ? [{ label: 'Monthly register', href: '/app/people/attendance/register' }] : []),
  { label: 'Regularisation', href: '/app/people/attendance/regularisation' },
];
const worked = (a: AttendanceDay) => {
  if (!a.in || !a.out) return '—';
  const [h1, m1] = a.in.split(':').map(Number), [h2, m2] = a.out.split(':').map(Number);
  const m = h2 * 60 + m2 - (h1 * 60 + m1);
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
};
const label = (a: AttendanceDay) => (a.mark === 'P' ? 'Present' : a.mark === 'WFH' ? 'Present' : a.mark === 'Leave' ? 'On leave' : a.mark);

export function DailyLog() {
  const { role } = useApp();
  const me = useMe();
  const emps = useEmployees();
  const att = useAllAttendance(me.data?.today);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const today = me.data?.today;
  type Row = { e: Employee; a: AttendanceDay };
  const rows = useMemo(() => {
    if (!att.data || !emps.data || !today) return undefined;
    const by = new Map(att.data.filter((a) => a.date === today).map((a) => [a.employeeId, a]));
    return emps.data.filter((e) => e.status !== 'Inactive' && by.has(e.id)).map((e) => ({ e, a: by.get(e.id)! }))
      .filter((r) => (!search || r.e.name.toLowerCase().includes(search.toLowerCase())) && (!status || label(r.a) === status));
  }, [att.data, emps.data, today, search, status]);
  const all = att.data?.filter((a) => a.date === today) ?? [];
  const cols: Column<Row>[] = [
    { key: 'e', header: 'Employee', render: (r) => <PersonCell name={r.e.name} sub={r.e.title} />, sort: (r) => r.e.name, mobile: true },
    { key: 'shift', header: 'Shift', render: () => 'General · 09:30' },
    { key: 'in', header: 'In', render: (r) => <Mono>{r.a.in ?? '—'}</Mono>, sort: (r) => r.a.in ?? '', mobile: true },
    { key: 'out', header: 'Out', render: (r) => <Mono>{r.a.out ?? (r.a.in ? 'on site' : '—')}</Mono> },
    { key: 'worked', header: 'Worked', align: 'right', render: (r) => <span className="num">{worked(r.a)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Status label={r.a.mark === 'WFH' ? 'Present · WFH' : label(r.a)} colour={r.a.mark === 'WFH' ? 'green' : undefined} />, sort: (r) => r.a.mark, mobile: true },
  ];
  if (att.error) return <div className="wrap page"><ErrorState error={att.error} retry={att.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Attendance" desc={today ? ddm(today) + ' · ' + all.filter(isPresent).length + ' of ' + all.filter(isScheduled).length + ' scheduled are in.' : ' '}
        primary={role === 'Admin' || role === 'HR' ? { label: 'Download register', onClick: () => rows && downloadCsv('attendance-' + today + '.csv', ['Employee', 'In', 'Out', 'Status'], rows.map((r) => [r.e.name, r.a.in ?? '', r.a.out ?? '', label(r.a)])) } : undefined}
        views={VIEWS(role)} current="/app/people/attendance" />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 's', label: 'Statuses', options: ['Present', 'Late', 'Half day', 'On leave', 'Absent'], value: status, onChange: setStatus }]} />
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.e.id} onOpen={(r) => (location.hash = '#/app/people/directory/' + r.e.id + '/attendance')} empty={{ title: 'No one matches.', onClear: () => { setSearch(''); setStatus(''); } }} />
    </div>
  );
}

const COLOUR: Record<string, string> = { P: SC.green, WFH: SC.green, Late: SC.amber, 'Half day': SC.amber, Leave: SC.amber, Absent: SC.red, Holiday: SC.blue, Weekend: '#D3D6CA' };
/** Employees as rows, days as columns. HR and Admin only — never a manager’s view of one person’s days. */
export function Register() {
  const { role } = useApp();
  const me = useMe();
  const emps = useEmployees();
  const att = useAllAttendance(me.data?.today);
  const [mo, setMo] = useState<string | null>(null);
  const [dept, setDept] = useState('');
  const [hover, setHover] = useState('');
  const month = mo ?? me.data?.today.slice(0, 7) ?? '';
  if (role !== 'Admin' && role !== 'HR') return <div className="wrap page"><h1 className="display">Monthly register</h1><p className="lede">The register is visible to HR and admins only. Managers see team attendance in aggregate on the dashboard.</p></div>;
  if (att.error) return <div className="wrap page"><ErrorState error={att.error} retry={att.refetch} /></div>;
  const days = month ? eachDay(month + '-01', monthEnd(month)) : [];
  const by = new Map(att.data?.map((a) => [a.employeeId + a.date, a]));
  const list = (emps.data ?? []).filter((e) => e.status !== 'Inactive' && (!dept || e.dept === dept)).sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));
  const tip = (a?: AttendanceDay) => !a ? 'No record' : a.mark === 'Weekend' || a.mark === 'Holiday' || a.mark === 'Leave' || a.mark === 'Absent' ? label(a) : (a.mark === 'WFH' ? 'WFH · ' : a.mark === 'Late' ? 'Late · ' : a.mark === 'Half day' ? 'Half day · ' : '') + 'in ' + a.in + ' · out ' + (a.out ?? '—');
  return (
    <div className="wrap page wide" style={{ paddingBottom: 140 }}>
      <PageHeader title="Monthly register" desc="Every mark for the month. Hover a cell for in and out times." views={VIEWS(role)} current="/app/people/attendance/register" />
      <div className="fbar">
        <div className="weekpick" style={{ height: 36 }}>
          <button aria-label="Previous month" onClick={() => setMo(addMonths(month, -1))} disabled={month <= '2026-05'}>‹</button>
          <div style={{ minWidth: 150 }}>{month && monthLabel(month)}</div>
          <button aria-label="Next month" onClick={() => setMo(addMonths(month, 1))} disabled={month >= (me.data?.today.slice(0, 7) ?? '')}>›</button>
        </div>
        <select className="fselect" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{[...new Set(emps.data?.map((e) => e.dept))].sort().map((d) => <option key={d}>{d}</option>)}</select>
        <div className="fspacer" />
        <span className="reg-readout" aria-live="polite">{hover || 'Hover a cell to read it.'}</span>
      </div>
      {!att.data || !emps.data ? <div className="card" style={{ marginTop: 16 }}><SkeletonRows /></div> : (
        <div className="card reg" style={{ marginTop: 16 }} onMouseLeave={() => setHover('')}>
          <table>
            <thead><tr><th className="reg-name">Employee</th>{days.map((d) => <th key={d} className={[0, 6].includes(dayOfWeek(d)) ? 'we' : ''}>{parseDate(d).getDate()}<i>{'SMTWTFS'[dayOfWeek(d)]}</i></th>)}<th>P</th><th>L</th><th>A</th></tr></thead>
            <tbody>
              {list.map((e) => {
                const ms = days.map((d) => by.get(e.id + d));
                const c = (m: string[]) => ms.filter((a) => a && m.includes(a.mark)).length;
                return (
                  <tr key={e.id}>
                    <td className="reg-name"><a href={'#/app/people/directory/' + e.id + '/attendance'}>{e.name}</a><span>{e.dept}</span></td>
                    {ms.map((a, i) => (
                      <td key={i} onMouseEnter={() => setHover(e.name + ' · ' + ddm(days[i]) + ' · ' + tip(a))} title={tip(a)}>
                        <span className="reg-cell" style={{ background: a ? COLOUR[a.mark] : 'transparent', opacity: a?.mark === 'Weekend' ? 0.6 : 1 }}>{a?.regularisedFrom ? '·' : ''}</span>
                      </td>
                    ))}
                    <td className="num">{c(['P', 'WFH', 'Late', 'Half day'])}</td><td className="num">{c(['Leave'])}</td><td className="num">{c(['Absent'])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="att-legend">
        {[['Present', SC.green], ['Late, half day or leave', SC.amber], ['Absent', SC.red], ['Holiday', SC.blue], ['Weekend', '#D3D6CA']].map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}
      </div>
    </div>
  );
}

export function RegularisationQueue() {
  const { role } = useApp();
  return <ApprovalQueue type="Regularisation" title="Regularisation requests" desc="Corrections to attendance marks, waiting on a decision. Approving rewrites the mark and keeps the original." views={VIEWS(role)} current="/app/people/attendance/regularisation" />;
}
