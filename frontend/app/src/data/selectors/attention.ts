/**
 * "Needs your attention" for each hub: pending approvals of the hub's kinds first, then the hub's own exceptions
 * (overdue tasks and invoices, tickets past SLA, contracts expiring, stock below reorder, visitors due, failed jobs,
 * invites not accepted, announcements to acknowledge). From the same records as the figures; the server computes it
 * (GET /dashboard-facts) over what the signed-in person may see.
 */
import { addDays } from '../../lib/dates';
import { dm } from '../../lib/format';
import type { ApprovalType } from '../types';
import { describeApproval } from './approvals';
import type { FactsInput } from './facts';

export type Att = { who: string; what: string; when: string; href: string };

const APPROVAL_TYPES: Record<string, ApprovalType[]> = {
  people: ['Leave', 'Regularisation'],
  leave: ['Leave'],
  work: ['Timesheet'],
  finance: ['Expense', 'Invoice'],
  me: [],
};

/** The attention list for one hub. `now` is the server's clock (ISO). */
export function hubAttention(x: FactsInput, hubKey: string, now: string): Att[] {
  const att: Att[] = [];
  const nm = (id: string) => x.employees.find((e) => e.id === id)?.name ?? id;
  for (const a of x.approvals.filter((a) => a.status === 'Pending' && (APPROVAL_TYPES[hubKey] ?? []).includes(a.type))) {
    const v = describeApproval(a, x.employees, x.projects);
    att.push({ who: v.who, what: a.type + ' · ' + v.detail, when: dm(a.submitted), href: v.href });
  }
  if (hubKey === 'people') x.onboarding.filter((o) => o.kind === 'Joining' && o.date > x.today).forEach((o) => {
    const it = o.items.filter((i) => !i.done && i.owner === 'IT').length;
    if (it) att.push({ who: o.personName, what: 'Onboarding · ' + it + ' IT items open', when: dm(o.date), href: '/app/people/onboarding/' + o.id });
  });
  if (hubKey === 'work') x.tasks.filter((k) => k.status !== 'done' && k.due < x.today).slice(0, 3).forEach((k) => att.push({ who: nm(k.assigneeId), what: k.id + ' ' + k.title + ' · overdue', when: dm(k.due), href: '/app/work/projects/' + k.projectId }));
  if (hubKey === 'finance') x.invoices.filter((i) => i.status === 'Overdue').slice(0, 3).forEach((i) => att.push({ who: x.clients.find((c) => c.id === i.clientId)?.name ?? '', what: i.number + ' · overdue', when: dm(i.due), href: '/app/finance/invoices/' + i.id }));
  if (hubKey === 'clients') {
    x.tickets.filter((t) => t.status !== 'Resolved' && t.slaDue < now).forEach((t) => att.push({ who: x.clients.find((c) => c.id === t.clientId)?.name ?? '', what: t.id + ' past its SLA', when: 'Now', href: '/app/clients/tickets/' + t.id }));
    x.contracts.filter((c) => c.status === 'Active' && c.end <= addDays(x.today, 60) && c.end >= x.today).forEach((c) => att.push({ who: x.clients.find((y) => y.id === c.clientId)?.name ?? '', what: c.title + ' expires' + (c.autoRenew ? ' · auto-renew on' : ''), when: dm(c.end), href: '/app/clients/contracts' }));
  }
  if (hubKey === 'workplace') {
    x.inventory.filter((i) => i.stock < i.reorderLevel).forEach((i) => att.push({ who: i.name, what: i.stock + ' left · reorder at ' + i.reorderLevel, when: 'Today', href: '/app/workplace/inventory' }));
    x.visitors.filter((v) => v.date === x.today && !v.checkedIn).forEach((v) => att.push({ who: v.name, what: 'Arrives ' + v.expected + ' to see ' + nm(v.hostId), when: v.expected, href: '/app/workplace/visitors' }));
  }
  if (hubKey === 'admin') {
    x.systemJobs.filter((j) => j.status === 'Failed').forEach((j) => att.push({ who: j.name, what: 'Job failed · ' + j.detail, when: j.lastRun.slice(11, 16), href: '/app/admin/notifications' }));
    x.users.filter((u) => u.status === 'Invited').forEach((u) => att.push({ who: u.name, what: 'Invite not accepted', when: dm(u.invited), href: '/app/admin/users' }));
  }
  if (hubKey === 'me') {
    x.tasks.filter((k) => k.assigneeId === x.meId && k.status !== 'done' && k.due < x.today).forEach((k) => att.push({ who: k.title, what: 'Task · overdue', when: dm(k.due), href: '/app/me/tasks' }));
    x.announcements.filter((a) => a.requiresAck && !a.ackIds.includes(x.meId)).forEach((a) => att.push({ who: a.title, what: 'Announcement · acknowledge', when: dm(a.posted), href: '/app/workplace/announcements' }));
  }
  return att;
}
