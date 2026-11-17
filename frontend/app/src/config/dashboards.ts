/** Role dashboards. Copy and links live here; every number comes from Facts. */
import { hours, lakh, monthLabel, range } from '../lib/format';
import type { Facts, FactsInput } from '../data/selectors/facts';
import { awaitingMe } from '../data/selectors/approvals';
import type { Role } from '../data/types';
import type { StatusKey } from '../lib/format';
import { HUBS, type MetricDef } from './hubs';

export type DashItem = { colour: StatusKey; title: string; sub: string; when: string; href: string };
export type DashboardDef = {
  line: (f: Facts) => string;
  summary: (f: Facts) => string;
  primary: [string, string];
  metrics: MetricDef[];
  listTitle: string;
  list: (f: Facts, x: FactsInput) => DashItem[];
};

const pick = (hub: string, label: string) => HUBS[hub].metrics.find((m) => m.label === label)!;
const nm = (x: FactsInput, id: string) => x.employees.find((e) => e.id === id)?.name ?? id;
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

export const DASHBOARDS: Record<Role, DashboardDef> = {
  Admin: {
    line: () => 'Admin',
    summary: (f) =>
      'Invoicing is ' + (f.finance.revDelta >= 0 ? 'up ' : 'down ') + Math.abs(f.finance.revDelta).toFixed(1) + '% on the same days of ' + f.finance.revenuePrevLabel + '. ' +
      (f.admin.failed.length ? plural(f.admin.failed.length, 'system job') + ' need' + (f.admin.failed.length === 1 ? 's' : '') + ' a look before payroll locks on the 25th.' : 'All system jobs are healthy.'),
    primary: ['Review approvals', '/app/approvals'],
    metrics: [pick('people', 'Headcount'), pick('finance', 'Invoiced this month'), pick('finance', 'Outstanding receivables'), pick('finance', 'Blended margin')],
    listTitle: 'System alerts and requests',
    list: (f, x) => [
      ...x.payrollRuns.flatMap((r) => (r.bankFileIssues.length ? [{ colour: 'red' as const, title: 'Bank file for the ' + monthLabel(r.month).split(' ')[0] + ' run rejected ' + plural(r.bankFileIssues.length, 'account'), sub: r.bankFileIssues[0].issue + ' · ' + r.bankFileIssues.map((b) => nm(x, b.employeeId)).join(', '), when: '', href: '/app/people/payroll/runs/' + r.id }] : [])),
      ...f.admin.failed.map((j) => ({ colour: 'red' as const, title: j.name + ' job failed', sub: j.detail, when: '', href: '/app/admin/notifications' })),
      ...(f.admin.invited ? [{ colour: 'amber' as const, title: plural(f.admin.invited, 'user invite') + ' pending', sub: 'Not yet accepted', when: '', href: '/app/admin/users' }] : []),
      ...(f.pendingMine ? [{ colour: 'amber' as const, title: plural(f.pendingMine, 'request') + ' waiting on you', sub: 'Across leave, expenses, timesheets and invoices', when: '', href: '/app/approvals' }] : []),
    ],
  },
  HR: {
    line: () => 'HR',
    summary: (f) => plural(f.people.onLeave, 'person') .replace('persons', 'people') + ' out today. ' + f.people.payrollMonth + '’s payroll inputs are open until ' + f.people.payrollLock + '.',
    primary: ['Review leave requests', '/app/people/leave/requests'],
    metrics: [pick('people', 'Present today'), { ...pick('people', 'On leave today'), label: 'On leave' }, pick('people', 'Open positions'),
      { label: 'Payroll status', value: (f) => f.people.payrollStage, delta: (f) => 'Locks ' + f.people.payrollLock, trend: 'flat', href: '/app/people/payroll' }],
    listTitle: 'Waiting on you',
    list: (_f, x) => [
      ...x.approvals.filter((a) => a.type === 'Leave' && a.status === 'Pending').slice(0, 3).map((a) => {
        const l = x.leave.find((y) => y.id === a.sourceId)!;
        return { colour: 'amber' as const, title: nm(x, a.requesterId) + ' · ' + plural(l.days, 'day'), sub: range(l.from, l.to), when: a.submitted.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+a.submitted.slice(5, 7) - 1], href: '/app/people/leave/requests' };
      }),
      ...x.onboarding.filter((o) => o.kind === 'Joining' && o.date > x.today).slice(0, 1).map((o) => ({ colour: 'blue' as const, title: o.personName + ' joins on ' + o.date.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+o.date.slice(5, 7) - 1], sub: o.items.filter((i) => !i.done && i.owner === 'IT').length + ' IT items still open', when: '', href: '/app/people/onboarding/' + o.id })),
      ...x.certifications.filter((c) => c.status === 'Expired').slice(0, 1).map((c) => ({ colour: 'red' as const, title: 'Certification lapsed', sub: nm(x, c.employeeId), when: '', href: '/app/people/training' })),
    ],
  },
  Manager: {
    line: () => 'Manager · Delivery',
    summary: (f) => 'Your team logged ' + hours(f.mine.teamHours) + ' this week. ' + (f.work.atRiskNames[0] ? f.work.atRiskNames[0] + ' is the one to watch.' : 'Every project is on track.'),
    primary: ['Review approvals', '/app/approvals'],
    metrics: [
      { label: 'Team present', value: (f) => f.mine.teamPresent + ' / ' + f.mine.teamScheduled, delta: (f) => f.mine.teamSize + ' in your reporting line', trend: 'flat', href: '/app/people/attendance' },
      { label: 'Team hours this week', value: (f) => hours(f.mine.teamHours), delta: (f) => f.mine.teamBillablePct + '% billable', trend: 'up', href: '/app/work/timesheets/approvals' },
      { label: 'Project health', value: (f) => f.work.activeProjects - f.work.atRisk + ' on track', delta: (f) => f.work.atRisk + ' at risk' + (f.work.atRiskNames[0] ? ' · ' + f.work.atRiskNames[0] : ''), trend: (f) => (f.work.atRisk ? 'warn' : 'flat'), href: '/app/work/projects' },
      { label: 'Pending approvals', value: (f) => String(f.pendingMine), delta: () => 'Waiting on you', trend: 'flat', href: '/app/approvals' },
    ],
    listTitle: 'Waiting on you',
    list: (f, x) => [
      ...x.approvals.filter((a) => awaitingMe(a, x.meId)).slice(0, 3).map((a) => ({ colour: 'amber' as const, title: nm(x, a.requesterId) + ' · ' + a.type, sub: 'Submitted ' + a.submitted.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+a.submitted.slice(5, 7) - 1], when: '', href: '/app/approvals' })),
      ...x.tasks.filter((k) => k.status !== 'done' && k.due < f.today).slice(0, 2).map((k) => ({ colour: 'red' as const, title: k.id + ' ' + k.title + ' is overdue', sub: x.projects.find((p) => p.id === k.projectId)?.name ?? '', when: '', href: '/app/work/projects/' + k.projectId })),
    ],
  },
  Employee: {
    line: (f) => f.me.title + ' · ' + f.me.dept,
    summary: (f) => 'You have ' + f.mine.balance + ' days of leave left and ' + plural(f.mine.tasksThisWeek, 'task') + ' due this week.',
    primary: ['Log time', '/app/work/timesheets'],
    metrics: [
      pick('me', 'Leave balance'),
      { ...pick('me', 'Hours this week'), delta: () => 'Expected 40 h by Sunday' },
      { label: 'Next holiday', value: (f) => (f.work.nextHoliday ? f.work.nextHoliday.date.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+f.work.nextHoliday.date.slice(5, 7) - 1] : '—'), delta: (f) => f.work.nextHoliday?.name ?? '', trend: 'flat', href: '/app/work/calendar' },
      pick('me', 'Pending claims'),
    ],
    listTitle: 'Due soon and unread',
    list: (f, x) => [
      ...x.tasks.filter((k) => k.assigneeId === x.meId && k.status !== 'done').sort((a, b) => a.due.localeCompare(b.due)).slice(0, 2).map((k) => ({ colour: (k.due < f.today ? 'red' : 'amber') as StatusKey, title: k.title, sub: (x.projects.find((p) => p.id === k.projectId)?.name ?? '') + ' · due ' + k.due.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+k.due.slice(5, 7) - 1], when: '', href: '/app/me/tasks' })),
      ...x.announcements.filter((a) => a.requiresAck && !a.ackIds.includes(x.meId)).map((a) => ({ colour: 'gray' as const, title: a.title, sub: 'Announcement · acknowledgement required', when: '', href: '/app/workplace/announcements' })),
    ],
  },
};

export { lakh };
