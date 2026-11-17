import { hours, inr, range } from '../../lib/format';
import type { ApprovalWithSource, Employee, Project } from '../types';
import { addDays, dayOfWeek } from '../../lib/dates';
import { invoiceTotals } from './finance';

export type ApprovalView = {
  id: string;
  type: ApprovalWithSource['type'];
  status: ApprovalWithSource['status'];
  who: string;
  requesterId: string;
  figure: string;
  detail: string;
  reason: string;
  submitted: string;
  lines: [string, string][];
  comment: string | null;
  awaitingId: string | null;
  href: string;
};

/** Plain-language description of an approval, from its embedded source record. */
export function describeApproval(a: ApprovalWithSource, emps: Employee[], projects: Project[] = [], clientState?: (clientId: string) => string | undefined): ApprovalView {
  const name = (id: string) => emps.find((e) => e.id === id)?.name ?? id;
  const s = a.source;
  let figure = '', detail = '', reason = '', href = '/app/approvals';
  const lines: [string, string][] = [];
  if (s.kind === 'Leave') {
    const l = s.leave;
    const typeName = ({ CL: 'Casual leave', SL: 'Sick leave', EL: 'Earned leave', CO: 'Comp-off', ML: 'Maternity leave', PL: 'Paternity leave' } as const)[l.type];
    figure = l.days + (l.days === 1 ? ' day' : ' days');
    detail = typeName + ' · ' + range(l.from, l.to);
    reason = l.reason;
    href = '/app/people/leave/requests';
  } else if (s.kind === 'Expense') {
    const x = s.expense;
    figure = inr(x.amount);
    detail = x.description;
    reason = (x.billable ? 'Billable' : 'Internal') + ' · ' + x.category + (x.receipt ? ' · receipt attached' : ' · no receipt');
    lines.push(['Billable to', x.billable && x.projectId ? projects.find((p) => p.id === x.projectId)?.name ?? '—' : 'Internal'], ['Receipt', x.receipt ? 'Attached' : 'Missing']);
    href = '/app/finance/expenses/' + x.id;
  } else if (s.kind === 'Timesheet') {
    const total = s.entries.reduce((t, e) => t + e.hours, 0);
    const bill = s.entries.filter((e) => e.billable).reduce((t, e) => t + e.hours, 0);
    figure = hours(total);
    detail = 'Week ' + range(s.week.weekStart, addDays(s.week.weekStart, 6)) + ' · ' + hours(bill) + ' billable';
    const byProj = new Map<string, number>();
    for (const e of s.entries) byProj.set(e.projectId, (byProj.get(e.projectId) ?? 0) + e.hours);
    reason = [...byProj].map(([p, h]) => (projects.find((x) => x.id === p)?.name ?? p) + ' ' + hours(h)).join(' · ');
    const days = [0, 1, 2, 3, 4].map((i) => s.entries.filter((e) => dayOfWeek(e.date) === i + 1).reduce((t, e) => t + e.hours, 0));
    lines.push(['Mon – Fri', days.map((d) => String(d)).join(' · ')], ['Weekend', String(s.entries.filter((e) => [0, 6].includes(dayOfWeek(e.date))).reduce((t, e) => t + e.hours, 0))]);
    if (s.week.revisions.some((r) => r.status === 'Rejected')) lines.push(['History', 'Resubmitted after a rejection']);
    href = '/app/work/timesheets/approvals';
  } else if (s.kind === 'Regularisation') {
    figure = s.reg.requested;
    detail = 'Correction · ' + range(s.reg.date, s.reg.date);
    reason = s.reg.reason;
    lines.push(['Recorded', s.reg.recorded], ['Requested', s.reg.requested]);
    href = '/app/people/attendance/regularisation';
  } else if (s.kind === 'Invoice') {
    const t = invoiceTotals(s.invoice, { state: clientState?.(s.invoice.clientId) ?? '' });
    figure = inr(t.total);
    detail = s.invoice.number;
    reason = s.invoice.lines.length + (s.invoice.lines.length === 1 ? ' line · ' : ' lines · ') + inr(t.subtotal) + ' before tax';
    lines.push(['Terms', 'Net ' + Math.round((Date.parse(s.invoice.due) - Date.parse(s.invoice.issued)) / 864e5)]);
    href = '/app/finance/invoices/' + s.invoice.id;
  } else if (s.kind === 'Profile change') {
    figure = s.change.field;
    detail = 'Profile change · ' + s.change.field;
    reason = s.change.reason;
    lines.push(['Current', s.change.before], ['Requested', s.change.after]);
    href = '/app/people/directory/' + s.change.employeeId;
  }
  const rejected = a.chain.find((c) => c.decision === 'Rejected');
  return {
    id: a.id, type: a.type, status: a.status, who: name(a.requesterId), requesterId: a.requesterId, figure, detail, reason, submitted: a.submitted, lines,
    comment: rejected?.comment ?? null, awaitingId: a.status === 'Pending' ? a.chain[a.current].approverId : null, href,
  };
}

export const awaitingMe = (a: { status: string; chain: { approverId: string }[]; current: number }, meId: string) => a.status === 'Pending' && a.chain[a.current].approverId === meId;
