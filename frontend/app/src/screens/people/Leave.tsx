import { useMemo, useState } from 'react';
import { ApprovalQueue } from '../../components/ApprovalQueue';
import { CalendarView, type CalEvent } from '../../components/CalendarView';
import { DataTable, PersonCell, downloadCsv, type Column } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SkeletonRows } from '../../components/ui';
import * as api from '../../data/repositories';
import { leaveBalances } from '../../data/selectors/people';
import type { Employee, LeaveType } from '../../data/types';
import { useEmployees, useLeave, useLeaveTypes, useMe } from '../../hooks/data';
import { addDays, eachDay, isWeekend } from '../../lib/dates';
import { SC, ddm } from '../../lib/format';
import { all, useQuery } from '../../lib/query';
import { useApp } from '../../state/store';

const VIEWS = [
  { label: 'Requests', href: '/app/people/leave/requests' },
  { label: 'Calendar', href: '/app/people/leave/calendar' },
  { label: 'Balances', href: '/app/people/leave/balances' },
  { label: 'Policies', href: '/app/people/leave/policies' },
];
const DELIVERY = ['Engineering', 'Delivery', 'Design'];
export const THRESHOLD = 40;

export function LeaveRequests() {
  return <ApprovalQueue type="Leave" title="Leave requests" desc="Approve on hover. Rejecting asks for a reason; approving doesn’t." views={VIEWS} current="/app/people/leave/requests" />;
}

export function LeaveCalendar() {
  const q = all({ me: useMe(), emps: useEmployees(), leave: useLeave(), holidays: useQuery(['holidays'], api.getHolidays) });
  const model = useMemo(() => {
    if (!q.data) return null;
    const { emps, leave, holidays, me } = q.data;
    const name = (id: string) => emps.find((e) => e.id === id)?.name ?? id;
    const live = leave.filter((l) => l.status === 'Approved' || l.status === 'Pending');
    const events: CalEvent[] = [
      ...live.map((l) => ({ id: l.id, layer: l.status === 'Approved' ? 'approved' : 'pending', title: name(l.employeeId) + ' · ' + l.type, date: l.from, end: l.to, workdaysOnly: true, href: '/app/people/directory/' + l.employeeId + '/leave' })),
      ...holidays.map((h) => ({ id: 'h' + h.date, layer: 'holiday', title: h.name, date: h.date })),
    ];
    const team = emps.filter((e) => DELIVERY.includes(e.dept) && e.status !== 'Inactive');
    const awayPct = (d: string) => {
      if (isWeekend(d)) return 0;
      const away = new Set(live.filter((l) => d >= l.from && d <= l.to && team.some((e) => e.id === l.employeeId)).map((l) => l.employeeId)).size;
      return Math.round((away / team.length) * 100);
    };
    const over = eachDay(me.today, addDays(me.today, 90)).map((d) => ({ d, p: awayPct(d) })).filter((x) => x.p >= THRESHOLD);
    // Show a warning on any day near the threshold, so approvers see it coming.
    const near = (d: string) => { const p = awayPct(d); return p >= THRESHOLD * 0.25 ? 'Delivery ' + p + '% away' : null; };
    return { events, over, near, today: me.today, teamSize: team.length };
  }, [q.data]);
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 120 }}>
      <PageHeader title="Leave calendar" desc={'Who is away when. Days where more than ' + THRESHOLD + '% of the delivery team is away are flagged to approvers.'} views={VIEWS} current="/app/people/leave/calendar" />
      {!model ? <div className="card" style={{ marginTop: 24 }}><SkeletonRows /></div> : (
        <>
          <div className={'threshold-band' + (model.over.length ? ' over' : '')} role="status">
            {model.over.length
              ? <><b>Over the {THRESHOLD}% threshold on {model.over.length} {model.over.length === 1 ? 'day' : 'days'}:</b> {model.over.slice(0, 4).map((x) => ddm(x.d) + ' (' + x.p + '%)').join(', ')}{model.over.length > 4 ? '…' : ''}. Approving more leave on these days needs a department head.</>
              : <>No day in the next 90 is over the {THRESHOLD}% threshold for the {model.teamSize}-person delivery team. Amber days are approaching it.</>}
          </div>
          <CalendarView today={model.today} events={model.events} threshold={model.near}
            layers={[{ key: 'approved', label: 'Approved', colour: SC.green }, { key: 'pending', label: 'Pending', colour: SC.amber }, { key: 'holiday', label: 'Holidays', colour: SC.blue }]} />
        </>
      )}
    </div>
  );
}

export function LeaveBalances() {
  const { role, say } = useApp();
  const q = all({ me: useMe(), emps: useEmployees(), leave: useLeave(), types: useLeaveTypes() });
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  type Row = { e: Employee; b: Record<string, number>; total: number };
  const rows = useMemo(() => q.data?.emps.filter((e) => e.status !== 'Inactive' && (!search || e.name.toLowerCase().includes(search.toLowerCase())) && (!dept || e.dept === dept)).map((e) => {
    const bal = leaveBalances(e, q.data!.types, q.data!.leave.filter((l) => l.employeeId === e.id), q.data!.me.today);
    const b = Object.fromEntries(bal.map((x) => [x.code, x.available]));
    return { e, b, total: bal.reduce((a, x) => a + x.available, 0) };
  }), [q.data, search, dept]);
  const n = (k: string) => (r: Row) => r.b[k] ?? 0;
  const cols: Column<Row>[] = [
    { key: 'e', header: 'Employee', render: (r) => <PersonCell name={r.e.name} sub={r.e.dept} />, sort: (r) => r.e.name, mobile: true },
    ...(['CL', 'SL', 'EL', 'CO'] as const).map((k) => ({ key: k, header: { CL: 'Casual', SL: 'Sick', EL: 'Earned', CO: 'Comp-off' }[k], align: 'right' as const, render: (r: Row) => <span className="num">{n(k)(r)}</span>, sort: n(k), mobile: k === 'EL' })),
    { key: 't', header: 'Total', align: 'right', render: (r) => <span className="num" style={{ fontWeight: 500 }}>{r.total}</span>, sort: (r) => r.total, mobile: true },
  ];
  if (q.error) return <div className="wrap page"><ErrorState error={q.error} retry={q.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Leave balances" desc="Closing balances for FY 2026–27, as of today. Accrual is computed from joining date, type and approved leave."
        primary={role === 'Admin' || role === 'HR' ? { label: 'Export balances', onClick: () => { rows && downloadCsv('leave-balances.csv', ['Employee', 'Casual', 'Sick', 'Earned', 'Comp-off', 'Total'], rows.map((r) => [r.e.name, n('CL')(r), n('SL')(r), n('EL')(r), n('CO')(r), r.total])); say('Balances exported'); } } : undefined}
        views={VIEWS} current="/app/people/leave/balances" />
      <FilterBar search={search} onSearch={setSearch} filters={[{ key: 'd', label: 'Departments', options: [...new Set(q.data?.emps.map((e) => e.dept))].sort(), value: dept, onChange: setDept }]} />
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.e.id} onOpen={(r) => (location.hash = '#/app/people/directory/' + r.e.id + '/leave')} empty={{ title: 'No one matches.', onClear: () => { setSearch(''); setDept(''); } }} />
    </div>
  );
}

export function LeavePolicies() {
  const types = useLeaveTypes();
  const cols: Column<LeaveType>[] = [
    { key: 'n', header: 'Leave type', render: (t) => <span style={{ fontWeight: 500 }}>{t.name}</span>, mobile: true },
    { key: 'a', header: 'Accrual', render: (t) => t.accrual, mobile: true },
    { key: 'c', header: 'Carry-forward cap', render: (t) => (t.carryForwardCap === null ? '—' : t.carryForwardCap === 0 ? 'None — lapses 31 Mar' : t.carryForwardCap + ' days') },
    { key: 'e', header: 'Encashment', render: (t) => t.encashment },
    { key: 'p', header: 'Applies to', render: (t) => t.appliesTo, mobile: true },
  ];
  if (types.error) return <div className="wrap page"><ErrorState error={types.error} retry={types.refetch} /></div>;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <PageHeader title="Leave policies" desc={(types.data?.length ?? 'Six') + ' leave types. Accruals run on the 1st of each month.'} views={VIEWS} current="/app/people/leave/policies" />
      <DataTable rows={types.data} columns={cols} rowKey={(t) => t.code} />
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20 }}>Leave types and their rules are edited under <a className="ulink" href="#/app/admin/masters">Admin · Masters</a>, so payroll and balances read the same definitions.</p>
    </div>
  );
}
