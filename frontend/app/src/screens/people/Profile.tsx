import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/Dialogs';
import { Menu } from '../../components/Menu';
import { Tabs } from '../../components/PageHeader';
import { ErrorState, Est, SkeletonRows, Shimmer, StatusLabel } from '../../components/ui';
import { DocumentTable } from '../../components/DocumentTable';
import * as api from '../../data/repositories';
import { correctionDiffs, ctcFor, monthsBetween, payslip, type PayslipMode } from '../../data/selectors/payroll';
import { attendanceSummary, leaveBalances } from '../../data/selectors/people';
import type { AttendanceDay, Employee, SalaryEvent } from '../../data/types';
import { useEmployees, useMe } from '../../hooks/data';
import { addMonths, dayOfWeek, eachDay, monthEnd, parseDate } from '../../lib/dates';
import { SC, dmy, inr, monthLabel, monthShort, range, statusColour } from '../../lib/format';
import { all, invalidate, useQuery } from '../../lib/query';
import { go, useApp } from '../../state/store';
import { SalaryEventForm } from './SalaryEventForm';

const TABS = ['overview', 'job', 'compensation', 'attendance', 'leave', 'documents', 'assets', 'performance'] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { overview: 'Overview', job: 'Job', compensation: 'Compensation', attendance: 'Attendance', leave: 'Leave', documents: 'Documents', assets: 'Assets', performance: 'Performance' };

export default function Profile({ id, tab: rawTab }: { id: string; tab?: string }) {
  const { role, say, settings } = useApp();
  const me = useMe();
  const emp = useQuery(['employees', id], () => api.getEmployee(id));
  const emps = useEmployees();
  const [ovf, setOvf] = useState(false);
  const isSelf = me.data?.employee.id === id;
  const sensitive = role === 'Admin' || role === 'HR' || isSelf;
  const tabs = TABS.filter((t) => t !== 'compensation' || sensitive);
  const tab: Tab = (tabs as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview';

  if (emp.error) return <div className="wrap page"><ErrorState error={emp.error} retry={emp.refetch} /></div>;
  const e = emp.data;
  const mgr = e && emps.data?.find((x) => x.id === e.managerId);
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <div className="pf-head">
        <div className="pf-av">{e ? e.name.split(' ').map((w) => w[0]).join('').slice(0, 2) : ''}</div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <h1 className="pf-name">{e?.name ?? <Shimmer w={260} h={40} r={8} />}</h1>
            {e && <StatusLabel label={e.status} />}
          </div>
          {e && (
            <div className="pf-meta">
              <span>{e.title}</span><span>{e.dept}</span><span className="mono" style={{ fontSize: 13 }}>{e.id}</span><span>{e.location}</span>{mgr && <span>Reports to {mgr.name}</span>}
            </div>
          )}
        </div>
        {(role === 'Admin' || role === 'HR') && e && (
          <div className="ph-actions">
            <Menu items={[{ label: 'Initiate offboarding', run: () => setOvf(true), danger: true, hidden: e.status === 'Inactive' }]} />
            <a className="btn-dark" href={'#/app/people/directory/' + e.id + '/edit'}>Edit profile</a>
          </div>
        )}
      </div>
      <Tabs tabs={tabs.map((t) => ({ key: t, label: LABEL[t], href: '/app/people/directory/' + id + (t === 'overview' ? '' : '/' + t) }))} current={tab} />
      {!e ? <div style={{ marginTop: 40 }}><SkeletonRows /></div> : (
        <>
          {tab === 'overview' && <Overview e={e} sensitive={sensitive} />}
          {tab === 'job' && <Job e={e} mgr={mgr?.name ?? '—'} />}
          {tab === 'compensation' && <Compensation e={e} />}
          {tab === 'attendance' && <AttendanceTab e={e} today={me.data?.today} />}
          {tab === 'leave' && <LeaveTab e={e} today={me.data?.today} accent={settings.blockColour} />}
          {tab === 'documents' && <div style={{ marginTop: 40 }}><DocumentTable ownerType="employee" ownerId={e.id} /></div>}
          {tab === 'assets' && <AssetsTab e={e} />}
          {tab === 'performance' && <PerformanceTab e={e} />}
        </>
      )}
      {ovf && e && (
        <ConfirmDialog title={'Offboard ' + e.name + '?'} danger confirm="Start offboarding"
          body="They will be marked inactive and an exit checklist opens for HR, IT, their manager and finance. Records, payslips and history are kept."
          onCancel={() => setOvf(false)}
          onConfirm={async () => { await api.updateEmployee(e.id, { status: 'Inactive' }); invalidate('employees', 'audit'); setOvf(false); say('Offboarding checklist created for ' + e.name); go('/app/people/directory'); }} />
      )}
    </div>
  );
}

const KV = ({ k, v, w = 140 }: { k: string; v: React.ReactNode; w?: number }) => <div className="kv" style={{ gridTemplateColumns: w + 'px minmax(0,1fr)' }}><span>{k}</span><span>{v}</span></div>;

function Overview({ e, sensitive }: { e: Employee; sensitive: boolean }) {
  const [acct, setAcct] = useState<string | null>(null);
  const sections: [string, [string, string][]][] = [
    ['Personal', [['Date of birth', sensitive ? dmy(e.dob) : '—'], ['Blood group', e.bloodGroup], ['Marital status', e.maritalStatus], ['Nationality', 'Indian']]],
    ['Contact', [['Work email', e.email], ['Personal email', sensitive ? e.personalEmail : '—'], ['Mobile', e.phone]]],
    ['Emergency contact', [['Name', e.emergency.name], ['Relationship', e.emergency.relation], ['Phone', e.emergency.phone]]],
    ['Address', [['Current', sensitive ? e.address : e.location], ['Permanent', 'Same as current']]],
  ];
  return (
    <div className="pf-grid">
      {sections.map(([t, rows]) => (
        <div key={t}><div className="section-title">{t}</div>{rows.map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
      ))}
      {sensitive && (
        <div>
          <div className="section-title">Bank details</div>
          <div className="kv" style={{ alignItems: 'center' }}>
            <span>Account</span>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className="mono" style={{ fontSize: 13 }}>{acct ?? 'XXXX XXXX XXXX ' + e.bank.accountLast4}</span>
              <button className="link-btn" onClick={async () => { if (acct) setAcct(null); else { const r = await api.revealBankAccount(e.id); invalidate('audit'); setAcct(r.account); } }}>{acct ? 'Hide' : 'Reveal'}</button>
            </span>
          </div>
          <KV k="Bank · IFSC" v={e.bank.name + ' · ' + e.bank.ifsc} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Reveals are written to the audit log.</div>
        </div>
      )}
    </div>
  );
}

function Job({ e, mgr }: { e: Employee; mgr: string }) {
  const ev = useQuery(['salary', e.id], () => api.getSalaryEvents(e.id));
  const hist = (ev.data ?? []).filter((x) => x.type === 'Hired' || x.type === 'Promotion').sort((a, b) => b.effective.localeCompare(a.effective));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 56, marginTop: 40 }}>
      <div style={{ flex: '1 1 360px' }}>
        {[['Designation', e.title], ['Department', e.dept], ['Reporting manager', mgr], ['Employment type', e.type], ['Location', e.location], ['Date of joining', dmy(e.joined)],
          ['Confirmation', e.confirmationDue ? 'Due ' + dmy(e.confirmationDue) : 'Confirmed'], ['Notice period', e.noticeDays + ' days']].map(([k, v]) => <KV key={k} k={k} v={v} w={170} />)}
      </div>
      <div style={{ flex: '1 1 320px' }}>
        <div className="section-title" style={{ marginBottom: 16 }}>Designation history</div>
        {!ev.data && <SkeletonRows n={2} />}
        {hist.map((h, i) => (
          <div key={h.id} className="tl-item">
            <div className="tl-rail"><span /><i /></div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{h.title ?? (h.type === 'Promotion' ? e.title : e.title)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{monthShort(h.effective.slice(0, 7))} – {i === 0 ? 'present' : monthShort(hist[i - 1].effective.slice(0, 7))}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{h.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- compensation ----------------
const eventValue = (x: SalaryEvent) =>
  x.ctc ? 'CTC ' + inr(x.ctc) : x.type === 'Deduction' ? '− ' + inr(x.amount ?? 0) : '+ ' + inr((x.amount ?? 0) * (x.appliesTo?.length ?? 1));

function Compensation({ e }: { e: Employee }) {
  const me = useMe();
  const emps = useEmployees();
  const ev = useQuery(['salary', e.id], () => api.getSalaryEvents(e.id));
  const today = me.data?.today;
  const nameOf = (id: string) => emps.data?.find((x) => x.id === id)?.name ?? id;
  const months = useMemo(() => (today ? monthsBetween(e.joined, today) : []), [e.joined, today]);
  const [idx, setIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<PayslipMode>('corrected');
  const [recording, setRecording] = useState(false);
  const { role } = useApp();
  if (ev.error) return <ErrorState error={ev.error} retry={ev.refetch} />;
  if (!ev.data || !today) return <div style={{ marginTop: 40 }}><SkeletonRows /></div>;
  const events = ev.data;
  const m = idx ?? months.length - 1;
  const month = months[m];
  const slip = payslip(e, events, month, mode);
  const other = payslip(e, events, month, mode === 'corrected' ? 'asPaid' : 'corrected');
  const corrected = mode === 'corrected' ? slip : other;
  const asPaid = mode === 'corrected' ? other : slip;
  const diff = corrected.net - asPaid.net;
  const diffs = correctionDiffs(e, events, e.joined, today);
  const since = ctcFor(events, month, mode).since;
  const pos = (date: string) => Math.max(0, months.indexOf(date.slice(0, 7)));
  const years = [...new Set(months.map((x) => x.slice(0, 4)))].slice(1);
  const ledger = [...events].sort((a, b) => b.effective.localeCompare(a.effective) || b.recorded.localeCompare(a.recorded));
  const visibleAt = (x: SalaryEvent) => x.effective.slice(0, 7) <= month && (mode === 'corrected' || x.recorded <= month + '-25');
  const tds = slip.deductions.find((d) => d.key === 'tds');
  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Payslip as it stood in {monthLabel(month)}</div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 6, maxWidth: 620 }}>Drag through time. The ledger below is append-only — nothing is overwritten, so any month’s payslip can be regenerated exactly.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Annual CTC {since ? 'since ' + dmy(since.effective) : ''}</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 4 }}>{inr(slip.ctc)}</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 28, padding: '24px 28px 20px' }}>
        <div style={{ position: 'relative', height: 22, margin: '0 8px' }}>
          {events.map((x) => {
            const on = visibleAt(x);
            const c = on ? '#D4421F' : '#D9E0CC';
            return <button key={x.id} title={x.type + ' · ' + dmy(x.effective)} aria-label={'Jump to ' + x.type + ', ' + monthLabel(x.effective.slice(0, 7))} onClick={() => setIdx(pos(x.effective))}
              style={{ position: 'absolute', left: (pos(x.effective) / Math.max(1, months.length - 1)) * 100 + '%', top: 4, width: 12, height: 12, marginLeft: -6, borderRadius: '50%', border: '2px solid #fff', background: c, boxShadow: '0 0 0 1px ' + c, padding: 0 }} />;
          })}
        </div>
        <input type="range" min={0} max={months.length - 1} step={1} value={m} onChange={(ev2) => setIdx(+ev2.target.value)} style={{ width: '100%', margin: '6px 0 0', cursor: 'grab' }} aria-label="Month" aria-valuetext={monthLabel(month)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginTop: 6, gap: 8 }}>
          <span>{monthShort(months[0])} · hired</span>{years.map((y) => <span key={y} className="hide-sm">{y}</span>)}<span>{monthShort(months[months.length - 1])} · today</span>
        </div>
      </div>

      <div className="dual">
        <div className="viewseg" style={{ marginTop: 0 }} role="tablist" aria-label="Which version of the payslip">
          <button role="tab" className={mode === 'corrected' ? 'active' : ''} aria-selected={mode === 'corrected'} onClick={() => setMode('corrected')}>As corrected</button>
          <button role="tab" className={mode === 'asPaid' ? 'active' : ''} aria-selected={mode === 'asPaid'} onClick={() => setMode('asPaid')}>As paid at the time</button>
        </div>
        <div className="dual-note">
          {diff !== 0
            ? <>This month differs: as corrected, net pay is <b>{inr(corrected.net)}</b>; as paid at the time it was <b>{inr(asPaid.net)}</b> — a difference of <b>{diff > 0 ? '+' : '−'}{inr(Math.abs(diff)).replace('₹', '₹')}</b>.</>
            : diffs.length
              ? <>Both views agree for {monthLabel(month)}. Corrections changed {diffs.map((d) => monthShort(d.month)).join(', ')} — <button className="link-btn" onClick={() => setIdx(months.indexOf(diffs[0].month))}>go to the first</button>.</>
              : <>No corrections have been recorded for {e.name.split(' ')[0]}; both views are identical.</>}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 24, alignItems: 'flex-start' }}>
        <div className="card slip" style={{ flex: '1 1 380px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="section-title" style={{ margin: 0 }}>Payslip · {monthLabel(month)}{mode === 'asPaid' ? ' · as paid' : ''}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{e.id}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 22 }}>Earnings</div>
          {slip.earnings.map((x) => <div key={x.key} className="slip-row"><span>{x.label}</span><span className="num">{inr(x.amount)}</span></div>)}
          <div className="slip-row total"><span>Gross</span><span className="num">{inr(slip.gross)}</span></div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 14 }}>Statutory deductions</div>
          {slip.deductions.map((x) => <div key={x.key} className="slip-row"><span>{x.label}{x.estimated && <Est basis={x.estimated.basis} />}</span><span className="num">− {inr(x.amount)}</span></div>)}
          <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '9px 0' }}>{slip.esiNote}</div>
          <div className="slip-net"><span>Net pay{tds && <Est basis="Net pay depends on the estimated TDS above." />}</span><span>{inr(slip.net)}</span></div>
        </div>
        <div style={{ flex: '1.2 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <div className="section-title" style={{ margin: 0 }}>Event ledger · append-only</div>
            {(role === 'Admin' || role === 'HR') && <button className="btn-line" style={{ height: 34, fontSize: 13 }} onClick={() => setRecording(true)}>Record a change</button>}
          </div>
          {recording && <SalaryEventForm e={e} today={today} onClose={() => setRecording(false)} />}
          {ledger.map((x) => {
            const fut = !visibleAt(x);
            const late = x.recorded.slice(0, 7) > x.effective.slice(0, 7) || (x.appliesTo && x.appliesTo.length > 0);
            return (
              <div key={x.id} className="ledger-row" style={{ opacity: fut ? 0.35 : 1 }} onClick={() => setIdx(pos(x.effective))}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', paddingTop: 2 }}>{dmy(x.recorded)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{x.type}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{x.note} · {nameOf(x.actorId)}</div>
                  {x.appliesTo && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>Applies to {x.appliesTo.map((a) => monthShort(a)).join(', ')} · {inr(x.amount ?? 0)} a month</div>}
                  {!x.appliesTo && late && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>Effective {dmy(x.effective)}</div>}
                  {fut && <div style={{ fontSize: 12, color: 'var(--label)', marginTop: 4 }}>{mode === 'asPaid' && x.effective.slice(0, 7) <= month ? 'Recorded after this month’s payroll locked' : 'Not yet effective at this date'}</div>}
                </div>
                <span className="num" style={{ fontSize: 14 }}>{eventValue(x)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- attendance ----------------
export function AttendanceTab({ e, today }: { e: Employee; today?: string }) {
  const months = today ? [addMonths(today.slice(0, 7), -1), today.slice(0, 7)] : [];
  const [mo, setMo] = useState<string | null>(null);
  const month = mo ?? months[0];
  const q = useQuery(['attendance', e.id, month], () => api.getAttendance({ employeeId: e.id, from: month + '-01', to: monthEnd(month) }), { enabled: !!month });
  if (!month) return null;
  const days = q.data ?? [];
  const by = new Map(days.map((d) => [d.date, d]));
  const all = eachDay(month + '-01', monthEnd(month));
  const lead = (dayOfWeek(all[0]) + 6) % 7;
  const colour = (a?: AttendanceDay) => !a ? 'transparent' : a.mark === 'P' || a.mark === 'WFH' ? SC.green : a.mark === 'Weekend' ? '#D3D6CA' : a.mark === 'Holiday' ? SC.blue : a.mark === 'Absent' ? SC.red : SC.amber;
  const title = (a?: AttendanceDay) => !a ? 'Upcoming' : a.mark === 'Weekend' ? 'Weekend' : a.mark === 'Holiday' ? 'Holiday' : a.mark === 'Leave' ? 'Leave' : a.mark === 'Absent' ? 'Absent' : (a.mark === 'Half day' ? 'Half day · ' : a.mark === 'WFH' ? 'Work from home · ' : a.mark === 'Late' ? 'Late · ' : '') + (a.in ?? '') + ' in · ' + (a.out ?? '—') + ' out' + (a.regularisedFrom ? ' · regularised' : '');
  const s = attendanceSummary(days);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 56, marginTop: 40, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 1 460px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{monthLabel(month)}</div>
          <div className="viewseg" style={{ marginTop: 0 }}>{months.map((x) => <button key={x} className={x === month ? 'active' : ''} onClick={() => setMo(x)}>{monthShort(x).split(' ')[0]}</button>)}</div>
        </div>
        {!q.data ? <SkeletonRows n={4} /> : (
          <div className="att-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="att-dow">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={'b' + i} />)}
            {all.map((d) => {
              const a = by.get(d);
              return <div key={d} className="att-cell" title={title(a)} aria-label={parseDate(d).getDate() + ': ' + title(a)}><span>{parseDate(d).getDate()}</span><i style={{ background: colour(a) }} /></div>;
            })}
          </div>
        )}
        <div className="att-legend">
          <span><i style={{ background: SC.green }} />Present</span><span><i style={{ background: SC.amber }} />Late, half day or leave</span><span><i style={{ background: SC.red }} />Absent</span><span><i style={{ background: SC.blue }} />Holiday</span><span><i style={{ background: '#D3D6CA' }} />Weekend</span>
        </div>
      </div>
      <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
        <div className="section-title">Summary</div>
        {[['Present', s.present], ['Late', s.late], ['Leave', s.leave], ['Half day', s.halfDay], ['Absent', s.absent], ['Holidays', s.holidays]].map(([k, v]) => (
          <div key={k} className="kv" style={{ gridTemplateColumns: '1fr auto' }}><span style={{ color: 'var(--ink-3)' }}>{k}</span><span className="num">{v}</span></div>
        ))}
      </div>
    </div>
  );
}

// ---------------- leave ----------------
function LeaveTab({ e, today, accent }: { e: Employee; today?: string; accent: string }) {
  const q = all({ types: useQuery(['leaveTypes'], api.getLeaveTypes), reqs: useQuery(['leave', e.id], () => api.getLeaveRequests({ employeeId: e.id })) });
  if (!q.data || !today) return <div style={{ marginTop: 40 }}><SkeletonRows /></div>;
  const bal = leaveBalances(e, q.data.types, q.data.reqs, today);
  const fill = accent === 'Ember' ? '#D9562B' : accent === 'Mono' ? '#4C4F46' : '#6A8150';
  const typeName = (c: string) => q.data!.types.find((t) => t.code === c)?.name ?? c;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 56, marginTop: 40, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 320px', maxWidth: 440 }}>
        <div className="section-title" style={{ marginBottom: 16 }}>Balances · FY 2026–27</div>
        {bal.map((b) => (
          <div key={b.code} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}><span>{b.name}</span><span className="num" style={{ color: 'var(--ink-3)' }}>{b.available} of {b.annual} days</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {Array.from({ length: b.annual }, (_, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: i < Math.floor(b.available) ? fill : i < b.available ? '#C6D0B7' : '#DFE1D7' }} />)}
            </div>
            {b.entitled < b.annual && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{b.entitled} accrued so far this year · {b.taken} taken{b.pending ? ' · ' + b.pending + ' pending' : ''}</div>}
          </div>
        ))}
      </div>
      <div style={{ flex: '1.4 1 420px', minWidth: 0 }}>
        <div className="section-title">Request history</div>
        {[...q.data.reqs].sort((a, b) => b.from.localeCompare(a.from)).map((h) => (
          <div key={h.id} className="lv-row">
            <span>{typeName(h.type)}</span><span style={{ color: 'var(--ink-3)' }}>{range(h.from, h.to)} {h.from.slice(0, 4)}</span><span style={{ color: 'var(--ink-3)' }}>{h.days} {h.days === 1 ? 'day' : 'days'}</span>
            <span className="status-label"><span className="dot" style={{ background: statusColour(h.status) }} />{h.status}</span>
          </div>
        ))}
        {!q.data.reqs.length && <div className="empty-s" style={{ paddingTop: 12 }}>No leave requested yet.</div>}
      </div>
    </div>
  );
}

function AssetsTab({ e }: { e: Employee }) {
  const q = useQuery(['assets'], api.getAssets);
  if (!q.data) return <div style={{ marginTop: 40 }}><SkeletonRows n={3} /></div>;
  const held = q.data.filter((a) => a.allocations.some((x) => x.employeeId === e.id && !x.to));
  return (
    <div style={{ marginTop: 40, maxWidth: 820 }}>
      {held.map((a) => {
        const al = a.allocations.find((x) => x.employeeId === e.id && !x.to)!;
        return (
          <a key={a.id} href={'#/app/workplace/assets/' + a.id} className="asset-row">
            <span className="mono">{a.tag}</span><span style={{ fontWeight: 500 }}>{a.name}</span><span style={{ color: 'var(--ink-3)' }}>{a.category}</span><span style={{ color: 'var(--ink-3)' }}>Issued {dmy(al.from)}</span>
          </a>
        );
      })}
      {!held.length && <div className="empty-s">No assets allocated.</div>}
    </div>
  );
}

function PerformanceTab({ e }: { e: Employee }) {
  const q = all({ goals: useQuery(['goals', e.id], () => api.getGoals(e.id)), reviews: useQuery(['reviews', e.id], () => api.getReviews({ employeeId: e.id })), cycles: useQuery(['cycles'], api.getReviewCycles), emps: useEmployees() });
  if (!q.data) return <div style={{ marginTop: 40 }}><SkeletonRows n={3} /></div>;
  const cyc = (id: string) => q.data!.cycles.find((c) => c.id === id);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 56, marginTop: 40, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.4 1 420px' }}>
        <div className="section-title" style={{ marginBottom: 16 }}>Current goals · H2 2026</div>
        {q.data.goals.map((g) => (
          <div key={g.id} style={{ padding: '18px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14 }}><span style={{ fontWeight: 500 }}>{g.title}</span><span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{g.measure}</span></div>
            <div className="bar"><div style={{ width: g.progress + '%' }} /></div>
          </div>
        ))}
        {!q.data.goals.length && <div className="empty-s">No goals set for this cycle.</div>}
      </div>
      <div style={{ flex: '1 1 280px' }}>
        <div className="section-title">Review history</div>
        {q.data.reviews.filter((r) => r.status === 'Completed').map((r) => (
          <div key={r.id} style={{ padding: '14px 0', borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 12 }}><span style={{ fontWeight: 500 }}>{cyc(r.cycleId)?.name}</span><span>{r.rating}</span></div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Reviewed by {q.data!.emps.find((x) => x.id === r.reviewerId)?.name}</div>
          </div>
        ))}
        {q.data.reviews.filter((r) => r.status !== 'Completed').map((r) => (
          <a key={r.id} href={'#/app/people/performance/reviews/' + r.id} style={{ display: 'block', padding: '14px 0', borderTop: '1px solid var(--line-soft)', fontSize: 14 }}>
            {cyc(r.cycleId)?.name} · <span style={{ color: 'var(--ink-3)' }}>{r.status}</span> →
          </a>
        ))}
      </div>
    </div>
  );
}
