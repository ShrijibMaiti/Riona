import type { AttendanceDay, BillingModel, Client, Employee, Project, ProjectHealth, Task, TaskPriority, TaskStatus, TimesheetEntry, TimesheetWeek } from '@riona/shared';
import { HISTORY_FROM, TODAY } from './calendar';
import { addDays, daysBetween, mondayOf, streamFor, ts } from './rng';

export const CLIENT_SEED: [string, string, string, string, string, string, number][] = [
  // id, name, industry, city, state, owner, terms
  ['C-11', 'Northwind Logistics', 'Logistics', 'Mumbai', 'Maharashtra', 'E-0133', 30],
  ['C-14', 'Aster Health', 'Healthcare', 'Bengaluru', 'Karnataka', 'E-0133', 30],
  ['C-17', 'Bluefin Capital', 'Financial services', 'Mumbai', 'Maharashtra', 'E-0133', 30],
  ['C-19', 'Halcyon Retail', 'Retail', 'New Delhi', 'Delhi', 'E-0160', 30],
  ['C-22', 'Monsoon Foods', 'FMCG', 'Kochi', 'Kerala', 'E-0160', 45],
  ['C-25', 'Vertex Mobility', 'Mobility', 'Chennai', 'Tamil Nadu', 'E-0133', 30],
  ['C-28', 'Saffron Hotels', 'Hospitality', 'Jaipur', 'Rajasthan', 'E-0160', 30],
  ['C-31', 'Lumen Energy', 'Energy', 'Ahmedabad', 'Gujarat', 'E-0133', 45],
];
const GST_CODE: Record<string, string> = { Maharashtra: '27', Karnataka: '29', Delhi: '07', Kerala: '32', 'Tamil Nadu': '33', Rajasthan: '08', Gujarat: '24' };
const CONTACTS = ['Rajiv Bansal', 'Shalini Mathur', 'Farah Siddiqui', 'Deepak Menon', 'Ayesha Thakur', 'Vinod Krishnan', 'Neelam Arora', 'Sanjay Pillai', 'Ruchi Verma', 'Imran Khan', 'Kavita Joshi', 'Prakash Rao', 'Anjali Desai', 'Tarun Malik', 'Meghna Sood', 'Hari Prasad'];

export function seedClients(): Client[] {
  return CLIENT_SEED.map(([id, name, industry, city, state, ownerId, terms], i) => ({
    id, name, industry, city, state, ownerId, status: 'Active', since: ['2021-03-15', '2022-01-10', '2023-06-01', '2022-08-22', '2024-02-05', '2025-04-14', '2026-05-18', '2026-06-01'][i],
    paymentTermsDays: terms,
    gstin: (GST_CODE[state] ?? '29') + 'AAB' + 'CDEFGHJK'[i] + 'K' + (4400 + i * 37) + 'L1Z' + (i + 1),
    contacts: [0, 1].map((k) => {
      const nm = CONTACTS[i * 2 + k];
      return { id: id + '-K' + k, name: nm, title: k ? 'Product Owner' : 'Head of Technology', email: nm.split(' ')[0].toLowerCase() + '@' + name.split(' ')[0].toLowerCase() + '.in', phone: '+91 98' + (10000000 + i * 811 + k * 97), primary: k === 0 };
    }),
  }));
}

type PSeed = [id: string, name: string, code: string, client: string, mgr: string, start: string, end: string, model: BillingModel, fee: number | null, budget: number, health: ProjectHealth, team: [string, string, number][]];
const P: PSeed[] = [
  ['P-214', 'Fleet Ops Portal', 'FO', 'C-11', 'E-0104', '2026-08-01', '2026-12-18', 'T&M', null, 4800000, 'On track', [['E-0112', 'Lead engineer', 100], ['E-0121', 'Frontend', 80], ['E-0115', 'Design', 50], ['E-0139', 'Backend', 70], ['E-0130', 'QA', 40], ['E-0100', 'Engagement lead', 10]]],
  ['P-215', 'Warehouse Analytics', 'WA', 'C-11', 'E-0148', '2026-09-14', '2027-02-26', 'T&M', null, 3200000, 'On track', [['E-0142', 'Data', 100], ['E-0112', 'Advisor', 10], ['E-0139', 'Backend', 30]]],
  ['P-203', 'Route Optimiser', 'RO', 'C-11', 'E-0148', '2026-04-06', '2026-07-31', 'Fixed fee', 2400000, 2400000, 'Completed', [['E-0112', 'Lead engineer', 90], ['E-0139', 'Backend', 70], ['E-0130', 'QA', 50]]],
  ['P-208', 'Patient App v2', 'PA', 'C-14', 'E-0148', '2026-06-02', '2026-11-27', 'T&M', null, 3600000, 'At risk', [['E-0169', 'Mobile', 100], ['E-0127', 'Design lead', 30], ['E-0130', 'QA', 40], ['E-0154', 'DevOps', 20]]],
  ['P-211', 'Clinic Booking API', 'CB', 'C-14', 'E-0104', '2026-05-04', '2026-08-28', 'Fixed fee', 1800000, 1800000, 'Completed', [['E-0154', 'DevOps', 40], ['E-0121', 'Frontend', 60]]],
  ['P-219', 'Advisor Dashboard', 'AD', 'C-17', 'E-0104', '2026-09-07', '2027-01-29', 'T&M', null, 4200000, 'On track', [['E-0139', 'Backend', 40], ['E-0115', 'Design', 50], ['E-0136', 'Analyst', 80], ['E-0142', 'Data', 20]]],
  ['P-206', 'KYC Automation', 'KY', 'C-17', 'E-0148', '2026-05-04', '2026-09-30', 'T&M', null, 2600000, 'Completed', [['E-0136', 'Analyst', 60], ['E-0142', 'Data', 60], ['E-0154', 'DevOps', 30]]],
  ['P-201', 'Loyalty Revamp', 'LR', 'C-19', 'E-0148', '2026-03-03', '2026-10-30', 'Fixed fee', 1650000, 1650000, 'Off track', [['E-0115', 'Design', 60], ['E-0121', 'Frontend', 60], ['E-0136', 'Analyst', 40], ['E-0139', 'Backend', 30], ['E-0127', 'Design lead', 20]]],
  ['P-222', 'B2B Ordering', 'BO', 'C-22', 'E-0104', '2026-07-20', '2026-12-11', 'Fixed fee', 1500000, 1500000, 'At risk', [['E-0169', 'Mobile', 40], ['E-0154', 'DevOps', 30], ['E-0130', 'QA', 30], ['E-0136', 'Analyst', 20], ['E-0127', 'Design lead', 10]]],
  ['P-217', 'Supplier Portal', 'SP', 'C-22', 'E-0148', '2026-05-11', '2026-08-14', 'T&M', null, 1900000, 'Completed', [['E-0169', 'Mobile', 60], ['E-0118', 'Tech lead', 20]]],
  ['P-226', 'Driver Onboarding', 'DO', 'C-25', 'E-0148', '2026-10-05', '2027-03-19', 'T&M', null, 2900000, 'On track', [['E-0121', 'Frontend', 20], ['E-0169', 'Mobile', 30], ['E-0136', 'Analyst', 30]]],
  ['P-210', 'Telematics Pilot', 'TP', 'C-25', 'E-0104', '2026-05-18', '2026-09-11', 'Fixed fee', 2200000, 2200000, 'Completed', [['E-0142', 'Data', 30], ['E-0118', 'Tech lead', 20]]],
  ['P-224', 'Guest Experience App', 'GX', 'C-28', 'E-0104', '2026-08-17', '2027-01-15', 'T&M', null, 3400000, 'On track', [['E-0127', 'Design lead', 20]]],
  ['P-212', 'Revenue Dashboard', 'RD', 'C-28', 'E-0148', '2026-05-25', '2026-08-07', 'Fixed fee', 600000, 600000, 'Completed', [['E-0136', 'Analyst', 20]]],
  ['P-228', 'Grid Monitoring', 'GM', 'C-31', 'E-0104', '2026-06-15', '2026-12-31', 'T&M', null, 3800000, 'On track', [['E-0154', 'DevOps', 20]]],
];

export function seedProjects(emps: Employee[]): Project[] {
  // Fill teams with generated delivery staff so most billable people work on something.
  const named = new Set(P.flatMap((p) => p[11].map((t) => t[0])));
  const pool = emps.filter((e) => e.billable && !named.has(e.id) && e.id !== 'E-0100' && !['E-0104', 'E-0148', 'E-0118'].includes(e.id));
  const r = streamFor('projects');
  let k = 0;
  const extraTeam: Record<string, [string, string, number][]> = {};
  const targets: Record<string, number> = { 'P-224': 3, 'P-228': 3, 'P-212': 1, 'P-226': 2, 'P-219': 1, 'P-215': 1, 'P-210': 1, 'P-217': 1, 'P-206': 1, 'P-208': 1, 'P-211': 1, 'P-222': 1 };
  for (const [pid, n] of Object.entries(targets)) {
    extraTeam[pid] = [];
    for (let i = 0; i < n && pool.length; i++) {
      const e = pool[k++ % pool.length];
      extraTeam[pid].push([e.id, /Design|Research/.test(e.title) ? 'Design' : /Analyst|Scrum|Project/.test(e.title) ? 'Analyst' : 'Engineer', r.pick([50, 60, 80, 100])]);
    }
  }
  return P.map(([id, name, code, clientId, managerId, start, end, model, fee, budget, health, team]) => {
    const len = daysBetween(start, end);
    const phases = [['Discovery', 0, 0.15], ['Design', 0.1, 0.35], ['Build', 0.3, 0.85], ['Test and harden', 0.75, 0.95], ['Launch', 0.92, 1]] as const;
    const ph = phases.map(([n, a, b], i) => ({ id: id + '-PH' + i, name: n, start: addDays(start, Math.round(len * a)), end: addDays(start, Math.round(len * b)), dependsOn: i ? [id + '-PH' + (i - 1)] : [] }));
    const ms = [['Kick-off', 0], ['Design sign-off', 0.35], ['Beta', 0.8], ['Go-live', 1]] as const;
    return {
      id, name, code, clientId, managerId, start, end, model, fee, budget, health,
      status: health === 'Completed' ? 'Completed' : 'Active',
      team: [...team, ...(extraTeam[id] ?? [])].map(([employeeId, role, allocation]) => ({ employeeId, role, allocation })),
      phases: ph,
      milestones: ms.map(([n, f], i) => { const d = addDays(start, Math.round(len * f)); return { id: id + '-M' + i, name: n, date: d, done: d <= TODAY }; }),
    };
  });
}

// ---------------- tasks ----------------
const FO_TASKS: [string, string, TaskStatus, string, string, TaskPriority, [number, number], number][] = [
  ['FO-41', 'Route planner: drag stops between vehicles', 'progress', 'E-0112', '2026-11-10', 'High', [2, 5], 16],
  ['FO-36', 'Map clustering above 500 pins', 'progress', 'E-0121', '2026-11-04', 'High', [3, 4], 10],
  ['FO-38', 'Driver shift import from CSV', 'progress', 'E-0139', '2026-11-07', 'Medium', [3, 4], 8],
  ['FO-42', 'Accessibility pass on dispatch forms', 'progress', 'E-0130', '2026-11-12', 'Medium', [1, 3], 6],
  ['FO-44', 'Vehicle health widget', 'todo', 'E-0121', '2026-11-14', 'Medium', [0, 3], 6],
  ['FO-45', 'Empty states for depot view', 'todo', 'E-0115', '2026-11-13', 'Low', [0, 2], 4],
  ['FO-46', 'SLA breach alert emails', 'todo', 'E-0139', '2026-11-18', 'High', [0, 4], 10],
  ['FO-47', 'Audit trail on dispatch edits', 'todo', 'E-0112', '2026-11-20', 'Medium', [0, 3], 6],
  ['FO-33', 'Dispatch board keyboard shortcuts', 'review', 'E-0121', '2026-11-06', 'Low', [4, 4], 5],
  ['FO-35', 'Fuel log reconciliation report', 'review', 'E-0139', '2026-11-09', 'Medium', [3, 3], 8],
  ['FO-29', 'Depot switcher', 'done', 'E-0115', '2026-10-28', 'Medium', [3, 3], 6],
  ['FO-27', 'Single sign-on with Azure AD', 'done', 'E-0139', '2026-10-24', 'High', [5, 5], 12],
  ['FO-31', 'Regression suite for dispatch', 'done', 'E-0130', '2026-10-30', 'Medium', [4, 4], 10],
];
const SUBN = ['Write acceptance criteria', 'Build the interaction', 'Wire to the API', 'Handle error and empty states', 'Tests and review'];
const VERBS = ['Build', 'Design', 'Wire up', 'Refactor', 'Test', 'Document', 'Spike', 'Polish', 'Migrate', 'Instrument'];
const NOUNS = ['login flow', 'settings page', 'export to CSV', 'notification service', 'search index', 'role permissions', 'onboarding checklist', 'dashboard filters', 'audit log', 'payment webhook', 'offline mode', 'reports module', 'image uploads', 'rate limiting', 'billing page', 'release pipeline'];

export function seedTasks(projects: Project[]): Task[] {
  const out: Task[] = [];
  const mk = (t: Omit<Task, 'subtasks' | 'comments' | 'description' | 'created'> & { sub: [number, number] }) => {
    const { sub, ...rest } = t;
    out.push({
      ...rest, created: addDays(rest.due, -21),
      description: 'Acceptance: behaves as specified on desktop and mobile, with empty and error states covered.',
      subtasks: SUBN.slice(0, sub[1]).map((s, i) => ({ id: t.id + '-S' + i, title: s, done: i < sub[0] })),
      comments: t.id === 'FO-41'
        ? [{ id: 'CM-1', authorId: 'E-0127', at: '2026-11-06T09:40:00+05:30', text: 'Can we ship the drag handles this sprint? The Northwind demo is on the 12th.' },
           { id: 'CM-2', authorId: 'E-0112', at: '2026-11-06T10:35:00+05:30', text: 'Handles are in. Snapping between vehicles is the last piece — should land Monday.' }]
        : [],
    });
  };
  for (const [id, title, status, who, due, pri, sub, est] of FO_TASKS)
    mk({ id, projectId: 'P-214', title, status, priority: pri, assigneeId: who, due, estimateHours: est, phaseId: 'P-214-PH2', sub });
  // The engagement lead's own work on Fleet Ops, so My Space › My tasks has something due in every group.
  for (const [id, title, status, due, pri, sub, est] of [
    ['FO-60', 'Sign off the Q4 change request with Northwind', 'progress', '2026-11-04', 'Urgent', [1, 3], 2],
    ['FO-61', 'Review Fleet Ops sprint demo', 'todo', '2026-11-06', 'High', [0, 2], 1],
    ['FO-62', 'Agree depot rollout order with Northwind ops', 'todo', '2026-11-11', 'Medium', [0, 2], 2],
    ['FO-63', 'Quarterly business review deck', 'todo', '2026-11-18', 'Medium', [0, 4], 4],
    ['FO-64', 'Renewal terms for 2027', 'todo', '2026-12-02', 'Low', [0, 0], 2],
    ['FO-59', 'Kick-off notes for phase two', 'done', '2026-10-21', 'Medium', [2, 2], 2],
  ] as [string, string, TaskStatus, string, TaskPriority, [number, number], number][])
    mk({ id, projectId: 'P-214', title, status, priority: pri, assigneeId: 'E-0100', due, estimateHours: est, phaseId: 'P-214-PH2', sub });
  for (const p of projects) {
    if (p.id === 'P-214') continue;
    const r = streamFor('tasks:' + p.id);
    const n = r.int(8, 14);
    const len = daysBetween(p.start, p.end);
    for (let i = 0; i < n; i++) {
      const due = addDays(p.start, Math.round(((i + 1) / (n + 1)) * len));
      const done = due < addDays(TODAY, -5) || p.status === 'Completed';
      const status: TaskStatus = done ? 'done' : due < addDays(TODAY, 4) ? r.pick(['progress', 'review'] as const) : r.chance(0.3) ? 'progress' : 'todo';
      const subN = r.int(0, 5);
      const ph = p.phases.find((x) => due >= x.start && due <= x.end) ?? p.phases[2];
      mk({
        id: p.code + '-' + (10 + i * 3), projectId: p.id, title: r.pick(VERBS) + ' ' + r.pick(NOUNS), status, priority: r.pick(['High', 'Medium', 'Medium', 'Low'] as const),
        assigneeId: r.pick(p.team).employeeId, due, estimateHours: r.pick([4, 6, 8, 10, 12, 16]), phaseId: ph.id,
        sub: [status === 'done' ? subN : r.int(0, subN), subN],
      });
    }
  }
  // An overdue one on Patient App, from the design's dashboard list.
  const pa = out.find((t) => t.projectId === 'P-208' && t.status !== 'done');
  if (pa) Object.assign(pa, { id: 'PA-88', title: 'Push reminders double-send', assigneeId: 'E-0169', due: '2026-11-05', status: 'progress', priority: 'Urgent' });
  return out;
}

// ---------------- timesheet entries ----------------
/** People whose last full week is still awaiting approval (the timesheet queue). */
export const PENDING_WEEK_PEOPLE = ['E-0112', 'E-0139', 'E-0169', 'E-0130', 'E-0136', 'E-0154'];
export const PENDING_WEEK = '2026-10-26';
/** Weeks rejected once and resubmitted (dual-state history). Aarav's is the pending week, so the approver sees both versions. */
export const RESUBMITTED: [string, string][] = [['E-0121', '2026-09-14'], ['E-0142', '2026-08-24'], ['E-0112', '2026-10-26']];

export function seedEntries(emps: Employee[], projects: Project[], tasks: Task[], attendance: AttendanceDay[]): TimesheetEntry[] {
  const out: TimesheetEntry[] = [];
  const attIdx = new Map(attendance.map((a) => [a.employeeId + a.date, a]));
  const byEmp = new Map<string, Project[]>();
  for (const p of projects) for (const m of p.team) byEmp.set(m.employeeId, [...(byEmp.get(m.employeeId) ?? []), p]);
  let n = 1;
  for (const e of emps) {
    if (!e.billable) continue;
    const ps = byEmp.get(e.id) ?? [];
    if (!ps.length) continue;
    const r = streamFor('ts:' + e.id);
    const myTasks = tasks.filter((t) => t.assigneeId === e.id);
    for (let d = HISTORY_FROM; d <= TODAY; d = addDays(d, 1)) {
      const a = attIdx.get(e.id + d);
      if (!a || !['P', 'Late', 'WFH', 'Half day'].includes(a.mark)) continue;
      const active = ps.filter((p) => d >= p.start && d <= p.end);
      if (!active.length) continue;
      const total = a.mark === 'Half day' ? 4 : [7.5, 8, 8, 8.5, 9][r.int(0, 4)];
      const allocs = active.map((p) => p.team.find((m) => m.employeeId === e.id)!.allocation);
      const sum = allocs.reduce((x, y) => x + y, 0);
      // The day's hours split by allocation; a capped share for low-allocation people.
      const scale = Math.min(1, sum / 100);
      active.forEach((p, i) => {
        let h = Math.round(((total * scale * allocs[i]) / sum) * 2) / 2;
        if (h < 0.5) return;
        const pt = myTasks.filter((t) => t.projectId === p.id && t.due >= d && addDays(t.due, -25) <= d);
        const task = pt.length ? r.pick(pt) : null;
        // ~1 in 12 entries is non-billable rework or internal meetings.
        const nonBill = r.chance(0.05);
        if (nonBill && h >= 2) {
          out.push({ id: 'TE-' + String(n++).padStart(5, '0'), employeeId: e.id, projectId: p.id, clientId: p.clientId, taskId: null, date: d, hours: 1, billable: false, note: r.pick(['Internal stand-up', 'Rework after review', 'Estimation']), status: 'Approved' });
          h -= 1;
        }
        out.push({ id: 'TE-' + String(n++).padStart(5, '0'), employeeId: e.id, projectId: p.id, clientId: p.clientId, taskId: task?.id ?? null, date: d, hours: h, billable: true, note: task ? task.title : r.pick(['Sprint work', 'Code review', 'Design QA', 'Client call', 'Bug fixes', 'Spec writing', 'Pairing']), status: 'Approved' });
      });
    }
  }
  // Statuses by week.
  for (const t of out) {
    const wk = mondayOf(t.date);
    if (wk >= mondayOf(TODAY)) t.status = 'Draft';
    else if (wk === PENDING_WEEK && PENDING_WEEK_PEOPLE.includes(t.employeeId)) t.status = 'Submitted';
  }
  return out;
}

export function seedWeeks(entries: TimesheetEntry[]): TimesheetWeek[] {
  const map = new Map<string, TimesheetEntry[]>();
  for (const t of entries) {
    const k = t.employeeId + '|' + mondayOf(t.date);
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  const out: TimesheetWeek[] = [];
  for (const [k, list] of map) {
    const [employeeId, weekStart] = k.split('|');
    const total = list.reduce((a, t) => a + t.hours, 0);
    const bill = list.filter((t) => t.billable).reduce((a, t) => a + t.hours, 0);
    const status = list[0].status;
    const fri = addDays(weekStart, 4);
    const revisions: TimesheetWeek['revisions'] = [];
    const snap = (xs: TimesheetEntry[], st: TimesheetEntry['status']) => xs.map((x) => ({ ...x, status: st }));
    if (status !== 'Draft') revisions.push({ at: ts(fri, '18:30'), status: 'Submitted', totalHours: total, billableHours: bill, note: '', entries: snap(list, 'Submitted') });
    if (RESUBMITTED.some(([e, w]) => e === employeeId && w === weekStart)) {
      // As first submitted: the same week plus six billable hours on Wednesday against another of their projects.
      const wed = addDays(weekStart, 2);
      const own = new Set(list.map((x) => x.projectId));
      const other = entries.find((x) => x.employeeId === employeeId && !own.has(x.projectId)) ?? list[0];
      const wrong: TimesheetEntry = { ...list[0], id: 'TE-X' + employeeId.slice(2) + weekStart.replace(/-/g, ''), projectId: other.projectId, clientId: other.clientId, taskId: null, date: wed, hours: 6, billable: true, note: 'Logged to the wrong project' };
      revisions.unshift({ at: ts(fri, '18:10'), status: 'Rejected', totalHours: total + 6, billableHours: bill + 6, note: 'Six hours logged to the wrong project on Wednesday.', entries: snap([...list, wrong], 'Rejected') });
      revisions[1].at = ts(addDays(fri, 3), '11:20');
    }
    if (status === 'Approved') revisions.push({ at: ts(addDays(fri, 3), '15:00'), status: 'Approved', totalHours: total, billableHours: bill, note: '', entries: snap(list, 'Approved') });
    out.push({ id: 'TW-' + employeeId.slice(2) + '-' + weekStart.replace(/-/g, ''), employeeId, weekStart, status, approvalId: null, revisions });
  }
  return out;
}
