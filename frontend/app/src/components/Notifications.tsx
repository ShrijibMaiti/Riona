import { useState } from 'react';
import { markAllNotificationsRead } from '../data/repositories';
import { awaitingMe, describeApproval } from '../data/selectors/approvals';
import type { ApprovalWithSource, Employee, Notification, Project } from '../data/types';
import { useDecide } from '../hooks/actions';
import { useApprovals, useEmployees, useMe, useNotifications, useProjects } from '../hooks/data';
import { ago, initials, statusColour } from '../lib/format';
import { invalidate } from '../lib/query';
import { useApp } from '../state/store';
import { SkeletonRows } from './ui';

export type NotifRow = {
  id: string; ini: string; text: string; at: string; kind: string; href: string;
  canAct: boolean; resolved: string; approval?: ApprovalWithSource; who: string; unread: boolean; isMention: boolean; isApproval: boolean;
};

function rowsOf(ns: Notification[], aps: ApprovalWithSource[], emps: Employee[], projects: Project[], meId: string): NotifRow[] {
  const name = (id: string | null) => emps.find((e) => e.id === id)?.name ?? 'System';
  return ns.map((n) => {
    const a = n.approvalId ? aps.find((x) => x.id === n.approvalId) : undefined;
    if (a) {
      const v = describeApproval(a, emps, projects);
      return { id: n.id, ini: initials(v.who), text: v.who + ' — ' + v.detail + ' · ' + v.figure, at: ago(n.at), kind: a.type + ' approval', href: v.href, canAct: awaitingMe(a, meId), resolved: a.status !== 'Pending' ? a.status : '', approval: a, who: v.who, unread: !n.read && a.status === 'Pending', isMention: false, isApproval: true };
    }
    return { id: n.id, ini: initials(name(n.actorId)), text: n.text, at: ago(n.at), kind: n.kind, href: n.href, canAct: false, resolved: '', who: name(n.actorId), unread: !n.read, isMention: n.kind === 'Mention', isApproval: false };
  });
}

/** Notification rows derived from live approval state. */
export function useNotifRows() {
  const n = useNotifications(), a = useApprovals(), e = useEmployees(), p = useProjects(), me = useMe();
  if (!n.data || !a.data || !e.data || !p.data || !me.data) return undefined;
  return rowsOf(n.data, a.data, e.data, p.data, me.data.employee.id);
}

const TABS = ['All', 'Mentions', 'Approvals'] as const;

export function Notifications({ rows }: { rows: NotifRow[] | undefined }) {
  const { askReject } = useApp();
  const { decide } = useDecide();
  const [tab, setTab] = useState<(typeof TABS)[number]>('All');
  const shown = !rows ? [] : tab === 'All' ? rows : tab === 'Mentions' ? rows.filter((r) => r.isMention) : rows.filter((r) => r.isApproval);
  const markRead = async () => {
    await markAllNotificationsRead();
    invalidate('notifications');
  };

  return (
    <div className="popover notif" role="dialog" aria-label="Notifications">
      <div className="notif-head">
        <b>Notifications</b>
        <button className="text-btn" onClick={markRead}>Mark all read</button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="notif-list">
        {!rows && <SkeletonRows n={4} />}
        {shown.map((r) => (
          <div key={r.id} className="notif-row">
            <span className="avatar-chip">{r.ini}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={'#' + r.href} className="text">{r.text}</a>
              <div className="meta"><span>{r.at}</span>{r.kind && <span>· {r.kind}</span>}</div>
              {r.canAct && r.approval && (
                <div className="notif-actions">
                  <button className="btn-sm dark" onClick={() => decide(r.approval!.id, true, r.who, r.approval!.type)}>Approve</button>
                  <button className="btn-sm line" onClick={() => askReject(r.approval!.id)}>Reject</button>
                </div>
              )}
              {r.resolved && <div className="resolved"><span className="dot" style={{ background: statusColour(r.resolved) }} />{r.resolved}</div>}
            </div>
            {r.unread && <span className="dot" style={{ background: 'var(--unread)', marginTop: 6 }} />}
          </div>
        ))}
        {rows && !shown.length && <div className="empty-s" style={{ padding: 40, textAlign: 'center' }}>Nothing here.</div>}
      </div>
      <a href="#/app/approvals" className="notif-foot">Open all approvals and notifications</a>
    </div>
  );
}
