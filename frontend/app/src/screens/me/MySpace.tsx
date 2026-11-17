/**
 * My Space: the signed-in person's own leave, attendance, expenses, tasks, assets and profile.
 * Every query is scoped to the signed-in employee by the repository; nothing here lists anyone else.
 */
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../../components/Dialogs';
import { DataTable, Mono } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, SkeletonRows, StatusLabel } from '../../components/ui';
import * as api from '../../data/repositories';
import { APPROVAL_DOMAINS } from '../../hooks/actions';
import { leaveBalances, workingDays } from '../../data/selectors/people';
import type { AttendanceDay, AttendanceMark, Employee, LeaveTypeCode, ProfileChangeField, Task } from '../../data/types';
import { useEmployees, useMe, useProjects } from '../../hooks/data';
import { addDays, addMonths, mondayOf } from '../../lib/dates';
import { ago, dm, dmy, inr, range } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';
import { AttendanceTab } from '../people/Profile';

const Page = ({ children }: { children: ReactNode }) => <div className="wrap page" style={{ paddingBottom: 140 }}>{children}</div>;
const Loading = () => <Page><SkeletonRows /></Page>;
const Failed = ({ error, retry }: { error: Error; retry: () => void }) => <Page><ErrorState error={error} retry={retry} /></Page>;

// ---------------------------------------------------------------- leave

export function MyLeave() {
  const { say } = useApp();
  const me = useMe();
  const id = me.data?.employee.id;
  const q = all({ me, types: useQuery(['leaveTypes'], api.getLeaveTypes), reqs: useQuery(['leave', id], () => api.getLeaveRequests({ employeeId: id }), { enabled: !!id }) });
  const [cancel, setCancel] = useState<string | null>(null);
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const { employee: e, today } = q.data.me;
  const bal = leaveBalances(e, q.data.types, q.data.reqs, today);
  const typeName = (c: string) => q.data!.types.find((t) => t.code === c)?.name ?? c;
  const reqs = [...q.data.reqs].sort((a, b) => b.from.localeCompare(a.from));
  const target = reqs.find((r) => r.id === cancel);
  return (
    <Page>
      <PageHeader title="My leave" desc="Your balances for FY 2026–27 and every request you’ve made." primary={{ label: 'Apply for leave', href: '#/app/me/leave/apply' }} />
      <div className="me-bal">
        {bal.map((b) => (
          <div key={b.code} className="card me-bal-c">
            <div className="section-title" style={{ margin: 0 }}>{b.name}</div>
            <div className="me-bal-n num">{b.available}<span> of {b.annual} days</span></div>
            <div className="me-bal-s">{b.entitled < b.annual ? b.entitled + ' accrued · ' : ''}{b.taken} taken{b.pending ? ' · ' + b.pending + ' pending' : ''}</div>
          </div>
        ))}
      </div>
      <h2 className="section-title" style={{ marginTop: 44 }}>Requests</h2>
      <div className="card" style={{ marginTop: 12 }}>
        {reqs.map((r) => (
          <div key={r.id} className="me-lv">
            <span style={{ fontWeight: 500 }}>{typeName(r.type)}<span className="cell-sub">{r.reason}</span></span>
            <span className="muted">{range(r.from, r.to)} {r.from.slice(0, 4)}</span>
            <span className="muted num">{r.days} {r.days === 1 ? 'day' : 'days'}</span>
            <StatusLabel label={r.status} />
            <span className="r">{(r.status === 'Pending' || (r.status === 'Approved' && r.from > today)) && <button className="link-btn" onClick={() => setCancel(r.id)}>Cancel</button>}</span>
          </div>
        ))}
        {!reqs.length && <EmptyState title="No leave requested yet" />}
      </div>
      {target && (
        <ConfirmDialog title="Cancel this leave?" confirm="Cancel leave" danger
          body={<>{typeName(target.type)}, {range(target.from, target.to)} — {target.days} {target.days === 1 ? 'day' : 'days'} go back to your balance{target.status === 'Approved' ? ' and your manager is told' : ''}.</>}
          onCancel={() => setCancel(null)}
          onConfirm={async () => { await api.cancelLeave(target.id); invalidate('leave', 'facts', ...APPROVAL_DOMAINS); setCancel(null); say('Leave cancelled'); }} />
      )}
    </Page>
  );
}

export function ApplyLeave() {
  const { say } = useApp();
  const me = useMe();
  const id = me.data?.employee.id;
  const q = all({ me, types: useQuery(['leaveTypes'], api.getLeaveTypes), reqs: useQuery(['leave', id], () => api.getLeaveRequests({ employeeId: id }), { enabled: !!id }), hol: useQuery(['holidays'], api.getHolidays) });
  const [f, setF] = useState({ type: 'CL' as LeaveTypeCode, from: '', to: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const { employee: e, today } = q.data.me;
  const bal = leaveBalances(e, q.data.types, q.data.reqs, today);
  const from = f.from || today, to = f.to || from;
  const days = workingDays(from, to, q.data.hol);
  const b = bal.find((x) => x.code === f.type);
  const over = b ? days > b.available - b.pending : false;
  const submit = async () => {
    if (!f.reason.trim()) return setErr('Add a short reason for your manager.');
    if (!days) return setErr('Those dates are all weekends or holidays.');
    if (over) return setErr('That’s more than your available balance.');
    setBusy(true);
    try {
      await api.applyLeave({ type: f.type, from, to, reason: f.reason.trim(), days });
      invalidate('leave', 'facts', ...APPROVAL_DOMAINS);
      say('Leave requested · ' + days + (days === 1 ? ' day' : ' days'));
      go('/app/me/leave');
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="wrap page" style={{ maxWidth: 760, paddingBottom: 140 }}>
      <a className="back-link" href="#/app/me/leave">← My leave</a>
      <PageHeader title="Apply for leave" desc="Your reporting manager approves. Weekends and public holidays inside the dates aren’t counted." />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 28 }}>
        <label className="field"><span>Type</span><select value={f.type} onChange={(x) => setF({ ...f, type: x.target.value as LeaveTypeCode })}>{q.data.types.map((t) => { const bb = bal.find((y) => y.code === t.code); return <option key={t.code} value={t.code}>{t.name}{bb ? ' · ' + bb.available + ' left' : ''}</option>; })}</select></label>
        <div />
        <label className="field"><span>From</span><input type="date" value={from} min={today} onChange={(x) => setF({ ...f, from: x.target.value, to: f.to && f.to < x.target.value ? x.target.value : f.to })} /></label>
        <label className="field"><span>To</span><input type="date" value={to} min={from} onChange={(x) => setF({ ...f, to: x.target.value })} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Reason</span><textarea rows={3} value={f.reason} onChange={(x) => setF({ ...f, reason: x.target.value })} /></label>
      </div>
      <div className="threshold-band" style={{ marginTop: 20 }}>
        <b className="num">{days} working {days === 1 ? 'day' : 'days'}</b> · {range(from, to)}{b ? ' · ' + b.name + ' balance after approval: ' + Math.max(0, b.available - b.pending - days) + ' days' : ''}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        <button className="btn-dark" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send for approval'}</button>
        <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href="#/app/me/leave">Cancel</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- attendance

const IRREGULAR: AttendanceMark[] = ['Late', 'Absent', 'Half day'];

export function MyAttendance() {
  const me = useMe();
  const id = me.data?.employee.id;
  const today = me.data?.today;
  const from = today ? addMonths(today.slice(0, 7), -1) + '-01' : '';
  const q = all({ me, att: useQuery(['attendance', id, 'mine', from], () => api.getAttendance({ employeeId: id!, from, to: today! }), { enabled: !!id }), regs: useQuery(['regularisations', id], () => api.getRegularisations({ employeeId: id }), { enabled: !!id }) });
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const pendingDates = new Set(q.data.regs.map((r) => r.date));
  const irregular = q.data.att.filter((a) => IRREGULAR.includes(a.mark) && !a.regularisedFrom).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Page>
      <PageHeader title="My attendance" desc="Your marks for this month and last. Anything irregular can be corrected — your manager approves it." />
      <AttendanceTab e={q.data.me.employee} today={today} />
      <h2 className="section-title" style={{ marginTop: 48 }}>Irregular days</h2>
      <div className="card" style={{ marginTop: 12 }}>
        {irregular.map((a: AttendanceDay) => {
          const reg = q.data!.regs.find((r) => r.date === a.date);
          return (
            <div key={a.date} className="me-att">
              <span style={{ fontWeight: 500 }}>{dmy(a.date)}</span>
              <span className="muted">{a.mark}{a.in ? ' · in ' + a.in : ''}{a.out ? ' · out ' + a.out : ''}</span>
              <span className="r">{pendingDates.has(a.date) ? <span className="muted">Correction requested · {reg?.requested}</span> : <a className="link-btn" href={'#/app/me/attendance/regularise/' + a.date}>Request correction</a>}</span>
            </div>
          );
        })}
        {!irregular.length && <EmptyState title="Nothing irregular" sub="Every working day in these two months is marked present, on leave or a holiday." />}
      </div>
    </Page>
  );
}

export function Regularise({ date }: { date: string }) {
  const { say } = useApp();
  const me = useMe();
  const id = me.data?.employee.id;
  const q = useQuery(['attendance', id, date], () => api.getAttendance({ employeeId: id!, from: date, to: date }), { enabled: !!id });
  const [f, setF] = useState({ mark: 'P' as AttendanceMark, inT: '09:30', outT: '18:30', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const rec = q.data[0];
  const submit = async () => {
    if (f.reason.trim().length < 5) return setErr('Tell your manager what happened in a few words.');
    if (f.mark !== 'WFH' && f.mark !== 'P' && f.mark !== 'Half day') return setErr('Choose present, work from home or half day.');
    setBusy(true);
    try {
      await api.requestRegularisation({ date, requestedMark: f.mark, requestedIn: f.inT, requestedOut: f.outT, reason: f.reason.trim() });
      invalidate('regularisations', 'attendance', ...APPROVAL_DOMAINS);
      say('Correction for ' + dm(date) + ' sent to your manager');
      go('/app/me/attendance');
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="wrap page" style={{ maxWidth: 760, paddingBottom: 140 }}>
      <a className="back-link" href="#/app/me/attendance">← My attendance</a>
      <PageHeader title={'Correct ' + dmy(date)} desc={'Recorded: ' + (rec ? rec.mark + (rec.in ? ' · ' + rec.in + '–' + (rec.out ?? '') : '') : 'no record') + '. The original mark is kept alongside the correction.'} />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="form-grid" style={{ marginTop: 28 }}>
        <label className="field"><span>Should be</span><select value={f.mark} onChange={(x) => setF({ ...f, mark: x.target.value as AttendanceMark })}><option value="P">Present</option><option value="WFH">Work from home</option><option value="Half day">Half day</option></select></label>
        <div />
        <label className="field"><span>In</span><input type="time" value={f.inT} onChange={(x) => setF({ ...f, inT: x.target.value })} /></label>
        <label className="field"><span>Out</span><input type="time" value={f.outT} onChange={(x) => setF({ ...f, outT: x.target.value })} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Reason</span><textarea rows={3} value={f.reason} onChange={(x) => setF({ ...f, reason: x.target.value })} placeholder="e.g. Badge reader at the Koramangala door was down" /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        <button className="btn-dark" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send for approval'}</button>
        <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href="#/app/me/attendance">Cancel</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- expenses

export function MyExpenses() {
  const me = useMe();
  const id = me.data?.employee.id;
  const projects = useProjects();
  const q = useQuery(['expenses', 'mine', id], () => api.getExpenses({ employeeId: id, pageSize: 500 }).then((p) => p.items), { enabled: !!id });
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  const rows = q.data ? [...q.data].sort((a, b) => b.date.localeCompare(a.date)) : undefined;
  const unpaid = rows?.filter((x) => x.status === 'Pending' || x.status === 'Approved') ?? [];
  const pname = (pid: string | null) => (pid ? projects.data?.find((p) => p.id === pid)?.name ?? '' : 'Internal');
  return (
    <Page>
      <PageHeader title="My expenses" desc={rows ? (unpaid.length ? inr(unpaid.reduce((a, x) => a + x.amount, 0)) + ' across ' + unpaid.length + (unpaid.length === 1 ? ' claim' : ' claims') + ' not yet paid.' : 'Everything you’ve claimed has been paid.') : ' '} primary={{ label: 'New claim', href: '#/app/me/expenses/new' }} />
      <div style={{ marginTop: 28 }}>
        <DataTable rows={rows} rowKey={(x) => x.id} onOpen={(x) => go('/app/me/expenses/' + x.id)} initialSort={{ key: 'date', dir: 'desc' }} empty={{ title: 'No claims yet', sub: 'Claims you submit appear here with their approval status.' }}
          columns={[
            { key: 'id', header: 'Claim', render: (x) => <Mono>{x.id}</Mono> },
            { key: 'desc', header: 'Description', render: (x) => <span style={{ fontWeight: 500 }}>{x.description}<span className="cell-sub">{pname(x.projectId)}{x.billable ? ' · billable' : ''}</span></span>, mobile: true },
            { key: 'date', header: 'Date', render: (x) => dmy(x.date), sort: (x) => x.date },
            { key: 'amount', header: 'Amount', align: 'right', render: (x) => <span className="num">{inr(x.amount)}</span>, sort: (x) => x.amount, mobile: true },
            { key: 'status', header: 'Status', render: (x) => <StatusLabel label={x.revisions.length && x.status === 'Pending' ? 'Reopened' : x.status} colour={x.revisions.length && x.status === 'Pending' ? 'amber' : undefined} />, mobile: true },
            { key: 'paid', header: 'Paid', render: (x) => (x.reimbursedOn ? dmy(x.reimbursedOn) : '—') },
          ]} />
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- tasks

type Group = { key: string; label: string; tasks: Task[] };

export function MyTasks() {
  const { say } = useApp();
  const me = useMe();
  const id = me.data?.employee.id;
  const projects = useProjects();
  const q = all({ me, tasks: useQuery(['tasks', 'mine', id], () => api.getTasks({ assigneeId: id }), { enabled: !!id }) });
  const [showDone, setShowDone] = useState(false);
  // The box ticks at once; the list regroups when the server confirms.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const today = q.data.me.today;
  const sun = addDays(mondayOf(today), 6), nextSun = addDays(sun, 7);
  const open = q.data.tasks.filter((t) => t.status !== 'done').sort((a, b) => a.due.localeCompare(b.due));
  const done = q.data.tasks.filter((t) => t.status === 'done').sort((a, b) => b.due.localeCompare(a.due));
  const groups: Group[] = [
    { key: 'overdue', label: 'Overdue', tasks: open.filter((t) => t.due < today) },
    { key: 'today', label: 'Today', tasks: open.filter((t) => t.due === today) },
    { key: 'week', label: 'Later this week', tasks: open.filter((t) => t.due > today && t.due <= sun) },
    { key: 'next', label: 'Next week', tasks: open.filter((t) => t.due > sun && t.due <= nextSun) },
    { key: 'later', label: 'Later', tasks: open.filter((t) => t.due > nextSun) },
  ].filter((g) => g.tasks.length);
  const pname = (pid: string) => projects.data?.find((p) => p.id === pid)?.name ?? pid;
  const toggle = async (t: Task) => {
    setTicked((m) => ({ ...m, [t.id]: t.status !== 'done' }));
    try {
      await api.updateTask(t.id, { status: t.status === 'done' ? 'progress' : 'done' });
      invalidate('tasks', 'facts');
      say(t.status === 'done' ? t.title + ' reopened' : t.title + ' done');
    } catch (x) { say((x as Error).message); }
    setTicked((m) => { const n = { ...m }; delete n[t.id]; return n; });
  };
  const Row = ({ t }: { t: Task }) => (
    <div className="me-task">
      <input type="checkbox" checked={ticked[t.id] ?? t.status === 'done'} onChange={() => toggle(t)} aria-label={(t.status === 'done' ? 'Reopen ' : 'Complete ') + t.title} />
      <a href={'#/app/work/projects/' + t.projectId + '/task/' + t.id} className="me-task-t">{t.title}<span className="cell-sub">{pname(t.projectId)} · <span className="mono">{t.id}</span></span></a>
      <StatusLabel label={t.priority} colour={t.priority === 'Urgent' ? 'red' : t.priority === 'High' ? 'amber' : 'gray'} />
      <span className={'num ' + (t.status !== 'done' && t.due < today ? 'me-late' : 'muted')}>{dm(t.due)}</span>
    </div>
  );
  return (
    <Page>
      <PageHeader title="My tasks" desc={(() => { const n = new Set(open.map((t) => t.projectId)).size; return open.length + ' open across ' + n + (n === 1 ? ' project' : ' projects') + ', by when they’re due.'; })()} />
      {groups.map((g) => (
        <section key={g.key} style={{ marginTop: 36 }}>
          <h2 className="section-title">{g.label} · {g.tasks.length}</h2>
          <div className="card">{g.tasks.map((t) => <Row key={t.id} t={t} />)}</div>
        </section>
      ))}
      {!open.length && <EmptyState title="Nothing open" sub="Tasks assigned to you on any project appear here." />}
      {done.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <button className="link-btn" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} done</button>
          {showDone && <div className="card" style={{ marginTop: 12 }}>{done.map((t) => <Row key={t.id} t={t} />)}</div>}
        </section>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- assets

export function MyAssets() {
  const { say } = useApp();
  const me = useMe();
  const q = all({ me, assets: useQuery(['assets', 'mine'], api.getMyAssets) });
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const meId = q.data.me.employee.id;
  const send = async (assetId: string) => {
    try { await api.reportAssetIssue(assetId, text); invalidate('assets'); setOpen(null); setText(''); setErr(''); say('Reported to IT'); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <Page>
      <PageHeader title="My assets" desc="Everything allocated to you. Report a problem and IT sees it on the item." />
      <div style={{ marginTop: 28, display: 'grid', gap: 12 }}>
        {q.data.assets.map((a) => {
          const al = a.allocations.find((x) => x.employeeId === meId && !x.to)!;
          const issues = a.issues ?? [];
          return (
            <div key={a.id} className="card me-asset">
              <div className="me-asset-h">
                <div><div style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</div><div className="cell-sub"><span className="mono">{a.tag}</span> · {a.category} · serial <span className="mono">{a.serial}</span></div></div>
                <div className="muted" style={{ fontSize: 13.5 }}>With you since {dmy(al.from)}</div>
                {open !== a.id && <button className="btn-line" onClick={() => { setOpen(a.id); setText(''); setErr(''); }}>Report a problem</button>}
              </div>
              {issues.length > 0 && <div className="me-issues">{issues.map((i) => <div key={i.id}><b>Reported {ago(i.at)}</b> · {i.text}</div>)}</div>}
              {open === a.id && (
                <div style={{ marginTop: 14 }}>
                  <label className="field"><span>What’s wrong?</span><textarea rows={3} value={text} onChange={(x) => setText(x.target.value)} /></label>
                  {err && <div className="field"><span className="err" role="alert">{err}</span></div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}><button className="btn-dark" onClick={() => send(a.id)}>Send to IT</button><button className="btn-line" onClick={() => setOpen(null)}>Cancel</button></div>
                </div>
              )}
            </div>
          );
        })}
        {!q.data.assets.length && <EmptyState title="Nothing allocated to you" />}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- profile

const HR_FIELDS: ProfileChangeField[] = ['Legal name', 'Address', 'Marital status', 'Bank account', 'PAN'];
const valueOf = (e: Employee, f: ProfileChangeField) => (f === 'Legal name' ? e.name : f === 'Address' ? e.address : f === 'Marital status' ? e.maritalStatus : f === 'PAN' ? 'XXXXX' + e.pan.slice(5) : e.bank.name + ' · ••••' + e.bank.accountLast4);
const slug = (f: string) => f.toLowerCase().replace(/ /g, '-');

export function MyProfile() {
  const { say } = useApp();
  const me = useMe();
  const q = all({ me, changes: useQuery(['profile-changes'], api.getMyProfileChanges), emps: useEmployees() });
  const [f, setF] = useState<{ phone: string; personalEmail: string; bloodGroup: string; eName: string; eRel: string; ePhone: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.error) return <Failed error={q.error} retry={q.refetch} />;
  if (!q.data) return <Loading />;
  const e = q.data.me.employee;
  const v = f ?? { phone: e.phone, personalEmail: e.personalEmail, bloodGroup: e.bloodGroup, eName: e.emergency.name, eRel: e.emergency.relation, ePhone: e.emergency.phone };
  const dirty = !!f && (v.phone !== e.phone || v.personalEmail !== e.personalEmail || v.bloodGroup !== e.bloodGroup || v.eName !== e.emergency.name || v.eRel !== e.emergency.relation || v.ePhone !== e.emergency.phone);
  const pending = (fld: ProfileChangeField) => q.data!.changes.find((c) => c.field === fld && c.status === 'Pending');
  const mgr = q.data.emps.find((x) => x.id === e.managerId)?.name ?? '—';
  const save = async () => {
    setBusy(true);
    try {
      await api.updateMyProfile({ phone: v.phone, personalEmail: v.personalEmail, bloodGroup: v.bloodGroup, emergency: { name: v.eName, relation: v.eRel, phone: v.ePhone } });
      invalidate('session', 'employees');
      setF(null); setErr(''); say('Profile saved');
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof v) => (x: React.ChangeEvent<HTMLInputElement>) => setF({ ...v, [k]: x.target.value });
  return (
    <Page>
      <PageHeader title="Profile" desc="Contact details are yours to keep current. Fields marked HR approval go to HR before they change on your record." />
      <div className="me-prof">
        <section className="card me-prof-c">
          <h2 className="section-title">Contact · you can edit</h2>
          {err && <div className="err-banner" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-grid">
            <label className="field"><span>Phone</span><input value={v.phone} onChange={set('phone')} inputMode="tel" /></label>
            <label className="field"><span>Personal email</span><input value={v.personalEmail} onChange={set('personalEmail')} type="email" /></label>
            <label className="field"><span>Blood group</span><input value={v.bloodGroup} onChange={set('bloodGroup')} /></label>
            <div />
            <label className="field"><span>Emergency contact</span><input value={v.eName} onChange={set('eName')} /></label>
            <label className="field"><span>Relation</span><input value={v.eRel} onChange={set('eRel')} /></label>
            <label className="field"><span>Emergency phone</span><input value={v.ePhone} onChange={set('ePhone')} inputMode="tel" /></label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-dark" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            {dirty && <button className="btn-line" onClick={() => setF(null)}>Discard</button>}
          </div>
        </section>

        <section className="card me-prof-c">
          <h2 className="section-title">Personal · HR approval</h2>
          {HR_FIELDS.map((fld) => {
            const p = pending(fld);
            return (
              <div key={fld} className="me-hr">
                <span className="me-hr-k">{fld}<span className="me-hr-tag">HR approval</span></span>
                <span className="me-hr-v">{valueOf(e, fld)}{p && <span className="cell-sub">Requested: {p.after} · waiting on HR since {dm(p.submitted)}</span>}</span>
                <span className="r">{p ? <StatusLabel label="Pending" /> : <a className="link-btn" href={'#/app/me/profile/change/' + slug(fld)}>Request change</a>}</span>
              </div>
            );
          })}
        </section>

        <section className="card me-prof-c">
          <h2 className="section-title">Employment · maintained by HR</h2>
          {[['Employee ID', e.id], ['Designation', e.title], ['Department', e.dept], ['Reports to', mgr], ['Location', e.location], ['Joined', dmy(e.joined)], ['Work email', e.email], ['UAN', e.uan]].map(([k, val]) => (
            <div key={k} className="kv"><span>{k}</span><span>{val}</span></div>
          ))}
        </section>

        {q.data.changes.some((c) => c.status !== 'Pending') && (
          <section className="card me-prof-c">
            <h2 className="section-title">Past requests</h2>
            {q.data.changes.filter((c) => c.status !== 'Pending').map((c) => <div key={c.id} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span>{c.field} → {c.after}<span className="cell-sub">{dmy(c.submitted)}</span></span><StatusLabel label={c.status} /></div>)}
          </section>
        )}
      </div>
    </Page>
  );
}

export function RequestProfileChange({ field: raw }: { field: string }) {
  const { say } = useApp();
  const me = useMe();
  const field = HR_FIELDS.find((x) => slug(x) === raw);
  const [val, setVal] = useState('');
  const [bank, setBank] = useState({ name: '', ifsc: '', acct: '' });
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!field) return <Page><EmptyState title="That field can’t be changed here" action={<a className="btn-line" href="#/app/me/profile">Back to profile</a>} /></Page>;
  if (me.error) return <Failed error={me.error} retry={me.refetch} />;
  if (!me.data) return <Loading />;
  const e = me.data.employee;
  const submit = async () => {
    const after = field === 'Bank account' ? [bank.name.trim(), bank.ifsc.trim().toUpperCase(), bank.acct.trim()].join(' · ') : val;
    if (field === 'Bank account' && (!bank.name.trim() || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.trim().toUpperCase()) || !/^\d{9,18}$/.test(bank.acct.trim()))) return setErr('Enter the bank, an 11-character IFSC and the account number.');
    setBusy(true);
    try {
      await api.requestProfileChange(field, after, reason.trim());
      invalidate('profile-changes', ...APPROVAL_DOMAINS);
      say(field + ' change sent to HR');
      go('/app/me/profile');
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const proof = { 'Legal name': 'a gazette notification or updated Aadhaar', Address: 'a utility bill or rental agreement', 'Marital status': 'a marriage certificate', 'Bank account': 'a cancelled cheque', PAN: 'the PAN card' }[field];
  return (
    <div className="wrap page" style={{ maxWidth: 760, paddingBottom: 140 }}>
      <a className="back-link" href="#/app/me/profile">← Profile</a>
      <PageHeader title={'Change ' + field.toLowerCase()} desc={'HR checks this against ' + proof + ' before it changes on your record' + (field === 'Bank account' ? ' — salary keeps going to the current account until then.' : '.')} />
      {err && <div className="err-banner" role="alert" style={{ marginTop: 20 }}>{err}</div>}
      <div className="kv" style={{ marginTop: 28 }}><span>Current</span><span>{valueOf(e, field)}</span></div>
      <div className="form-grid" style={{ marginTop: 16 }}>
        {field === 'Bank account' ? (
          <>
            <label className="field"><span>Bank</span><input value={bank.name} onChange={(x) => setBank({ ...bank, name: x.target.value })} /></label>
            <label className="field"><span>IFSC</span><input value={bank.ifsc} onChange={(x) => setBank({ ...bank, ifsc: x.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Account number</span><input value={bank.acct} inputMode="numeric" onChange={(x) => setBank({ ...bank, acct: x.target.value.replace(/\D/g, '') })} /></label>
          </>
        ) : field === 'Marital status' ? (
          <label className="field"><span>New status</span><select value={val} onChange={(x) => setVal(x.target.value)}><option value="">Choose…</option><option>Married</option><option>Single</option></select></label>
        ) : (
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>New {field.toLowerCase()}</span>{field === 'Address' ? <textarea rows={3} value={val} onChange={(x) => setVal(x.target.value)} /> : <input value={val} onChange={(x) => setVal(x.target.value)} />}</label>
        )}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Reason (optional)</span><input value={reason} onChange={(x) => setReason(x.target.value)} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Proof</span><input type="file" accept="image/*,application/pdf" style={{ padding: '8px 12px' }} /><span className="hint">Upload {proof}.</span></label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        <button className="btn-dark" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send to HR'}</button>
        <a className="btn-line" style={{ display: 'inline-flex', alignItems: 'center' }} href="#/app/me/profile">Cancel</a>
      </div>
    </div>
  );
}

