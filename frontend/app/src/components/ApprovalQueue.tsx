import { useState } from 'react';
import { awaitingMe, describeApproval } from '../data/selectors/approvals';
import type { ApprovalType, ApprovalWithSource, Employee } from '../data/types';
import { useDecide } from '../hooks/actions';
import { useApprovals, useClients, useEmployees, useMe, useProjects } from '../hooks/data';
import { SC, dm, initials, statusColour, timeOf } from '../lib/format';
import { useApp } from '../state/store';
import { ConfirmDialog } from './Dialogs';
import { Tabs } from './PageHeader';
import { ErrorState, SkeletonRows } from './ui';

/** The approval chain, left to right: who decided, who is deciding, who is next. */
export function ApprovalTrail({ a, emps, meId }: { a: ApprovalWithSource; emps: Employee[]; meId: string }) {
  return (
    <div className="trail">
      {a.chain.map((s, i) => {
        const st = a.status === 'Approved' || (s.decision === 'Approved' && i > 0) ? 'done' : i === 0 ? 'done' : s.decision === 'Rejected' ? 'rejected' : i === a.current && a.status === 'Pending' ? 'current' : 'future';
        const colour = st === 'done' ? SC.green : st === 'current' ? SC.amber : st === 'rejected' ? SC.red : '#D6D9CD';
        const name = s.approverId === meId ? 'You' : emps.find((e) => e.id === s.approverId)?.name ?? s.approverId;
        const label = i === 0 ? 'Submitted · ' + dm(a.submitted) : st === 'done' ? 'Approved' + (s.at ? ' · ' + dm(s.at) : '') : st === 'current' ? (s.approverId === meId ? 'Waiting on you' : 'Deciding now') : st === 'rejected' ? 'Rejected' + (s.at ? ' · ' + dm(s.at) + ' ' + timeOf(s.at) : '') : 'Next';
        return (
          <div key={i} className="trail-step">
            <div className="trail-node" style={{ opacity: st === 'future' ? 0.45 : 1 }}>
              <span className="avatar-chip" style={{ boxShadow: '0 0 0 2px #fff, 0 0 0 3.5px ' + colour }}>{initials(name === 'You' ? emps.find((e) => e.id === meId)?.name : name)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.role}</div>
                <div className="trail-st"><span className="dot" style={{ background: colour, width: 5, height: 5 }} />{label}</div>
              </div>
            </div>
            {i < a.chain.length - 1 && <div className="trail-line" />}
          </div>
        );
      })}
    </div>
  );
}

const TYPES: ('All' | ApprovalType)[] = ['All', 'Leave', 'Expense', 'Timesheet', 'Regularisation', 'Invoice', 'Profile change'];

/** One queue for every approval type: pending/approved/rejected tabs, hover to decide, expand for the trail. */
export function ApprovalQueue({ type, title, desc, views, current }: { type: 'All' | ApprovalType; title: string; desc: string; views?: { label: string; href: string }[]; current?: string }) {
  const { askReject } = useApp();
  const { decide, approveAll } = useDecide();
  const me = useMe(), aps = useApprovals(), emps = useEmployees(), projects = useProjects(), clients = useClients();
  const [tab, setTab] = useState<'Pending' | 'Approved' | 'Rejected'>('Pending');
  const touch = typeof window !== 'undefined' && (window.matchMedia('(hover: none)').matches || window.innerWidth < 720);
  const [chip, setChip] = useState<'All' | ApprovalType>('All');
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const meId = me.data?.employee.id ?? '';
  if (aps.error) return <ErrorState error={aps.error} retry={aps.refetch} />;
  const ready = aps.data && emps.data && projects.data && clients.data && me.data;
  // A queue shows requests the viewer is part of (as an approver) or raised.
  const base = (aps.data ?? []).filter((a) => (type === 'All' || a.type === type) && (a.chain.some((s, i) => i > 0 && s.approverId === meId) || a.requesterId === meId));
  const items = base.filter((a) => a.status === tab && (type !== 'All' || chip === 'All' || a.type === chip));
  const mine = base.filter((a) => awaitingMe(a, meId));
  const cState = (id: string) => clients.data?.find((c) => c.id === id)?.state;
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <div className="ph">
        <div><h1 className="display">{title}</h1><p className="ph-desc">{desc}</p></div>
        {tab === 'Pending' && mine.length > 1 && <button className="btn-dark approve-all" onClick={() => setConfirmAll(true)}>Approve all {mine.length}</button>}
      </div>
      {views && <div className="viewseg" role="tablist">{views.map((v) => <a key={v.href} href={'#' + v.href} role="tab" aria-selected={v.href === current} className={v.href === current ? 'active' : ''}>{v.label}</a>)}</div>}
      <Tabs current={tab} tabs={(['Pending', 'Approved', 'Rejected'] as const).map((t) => ({ key: t, label: t, count: base.filter((a) => a.status === t).length, onClick: () => { setTab(t); setOpen(null); } }))} />
      {type === 'All' && (
        <div className="chips">
          {TYPES.map((t) => <button key={t} className={chip === t ? 'on' : ''} aria-pressed={chip === t} onClick={() => setChip(t)}>{t}</button>)}
        </div>
      )}
      <div className="card q-card" onMouseLeave={() => setHover(null)}>
        {!ready && <SkeletonRows />}
        {ready && items.length > 0 && (
          <div className="q-inner">
            {items.map((a) => {
              const v = describeApproval(a, emps.data!, projects.data!, cState);
              const isOpen = open === a.id;
              const pm = awaitingMe(a, meId);
              // On touch screens there is no hover, so the actions are always there.
              const show = pm && (touch || hover === a.id || isOpen);
              const curName = a.status === 'Pending' ? emps.data!.find((e) => e.id === a.chain[a.current].approverId)?.name : '';
              return (
                <div key={a.id} className="q-item" onMouseEnter={() => setHover(a.id)}>
                  <div className="q-row" onClick={() => setOpen(isOpen ? null : a.id)} role="button" aria-expanded={isOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(isOpen ? null : a.id)} onFocus={() => setHover(a.id)}>
                    <div className="pcell"><span className="pcell-av" style={{ width: 34, height: 34 }}>{initials(v.who)}</span><div style={{ minWidth: 0 }}><div className="pcell-n">{v.who}</div><div className="cell-sub">{a.type}</div></div></div>
                    <div className="num" style={{ fontSize: 15, fontWeight: 500 }}>{v.figure}</div>
                    <div style={{ minWidth: 0 }}><div className={'ell' + (/^[A-Z]{1,4}-[0-9]{3,}/.test(v.detail) ? ' mono-detail' : '')}>{v.detail}</div><div className="ell cell-sub" style={{ marginTop: 2 }}>{v.reason}</div></div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>{dm(a.submitted)}</div>
                    <div className="q-acts">
                      {show && (
                        <>
                          <button className="q-btn" onClick={(e) => { e.stopPropagation(); askReject(a.id); }}>Reject</button>
                          <button className="q-btn dark" onClick={(e) => { e.stopPropagation(); decide(a.id, true, v.who, a.type); }}>Approve</button>
                        </>
                      )}
                      {a.status === 'Pending' && !show && <span className="status-label" style={{ fontSize: 13 }}><span className="dot" style={{ background: pm ? SC.amber : SC.gray }} />{pm ? 'Waiting on you · ' + a.chain[a.current].role : 'Waiting on ' + curName}</span>}
                      {a.status !== 'Pending' && <span className="status-label" style={{ fontSize: 13 }}><span className="dot" style={{ background: statusColour(a.status) }} />{a.status}</span>}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="q-open">
                      <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
                        <div className="section-title" style={{ marginBottom: 10 }}>Request</div>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: '#3B3F37' }}>{v.reason}</div>
                        <div style={{ marginTop: 14 }}>{v.lines.map(([k, val]) => <div key={k} className="q-line"><span>{k}</span><span>{val}</span></div>)}</div>
                        {v.comment && <div className="q-comment">“{v.comment}”</div>}
                        <a className="ulink" style={{ display: 'inline-block', marginTop: 14, fontSize: 13 }} href={'#' + v.href}>Open the record →</a>
                      </div>
                      <div style={{ flex: '2 1 420px', minWidth: 0 }}>
                        <div className="section-title" style={{ marginBottom: 14 }}>Approval trail</div>
                        <ApprovalTrail a={a} emps={emps.data!} meId={meId} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {ready && !items.length && <div className="empty" style={{ padding: '88px 24px', color: 'var(--muted)', fontSize: 14 }}>{tab === 'Pending' ? 'Nothing is waiting on you. New requests land here the moment they’re submitted.' : 'No ' + tab.toLowerCase() + ' requests yet.'}</div>}
      </div>
      {confirmAll && (
        <ConfirmDialog title={'Approve all ' + mine.length + ' requests?'} confirm={'Approve ' + mine.length}
          body="Each request moves to its next approver, or is approved outright if you are the last step. Approved hours become billable."
          onCancel={() => setConfirmAll(false)} onConfirm={async () => { await approveAll(mine.map((a) => a.id)); setConfirmAll(false); }} />
      )}
    </div>
  );
}
