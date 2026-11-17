/**
 * Copy for the public site. Every claim here is about what Riona does today; planned work is marked `coming`
 * (PRODUCT.md, "Claims match the product"). Figures come from the Kestrel Digital demo organisation.
 */
import type { Role } from '../data/types';
import { loadFresh } from '../state/store';

/** A module line: name, what it does, and whether it is still to come. */
export type Pillar = { k: string; name: string; s: string; src: string; link: string; all: [string, string, ('coming' | undefined)?][] };
export const PILLARS: Pillar[] = [
  { k: 'people', name: 'People', s: 'Directory, attendance, leave, payroll and reviews, with Indian statutory compliance built in.', src: '?role=HR#/app/people', link: 'Payroll cost comes from the same timesheet entry that bills the client.', all: [['Directory & org chart', 'Profiles, reporting lines and documents for every employee.'], ['Attendance', 'Daily marks, a monthly register and regularisation requests.'], ['Leave', 'Requests, balances, policies and a team calendar with thresholds.'], ['Payroll', 'Monthly runs with PF, ESI, Professional Tax and TDS, plus an append-only ledger for every salary.'], ['Onboarding & offboarding', 'Checklists for HR, IT, managers and finance.'], ['Performance', 'Cycles, goals with key results, calibration.'], ['Recruitment', 'Jobs, a candidate pipeline and interview loops.'], ['Training', 'Programmes and certifications that warn before they lapse.']] },
  { k: 'work', name: 'Work', s: 'Projects, Kanban boards, timelines and the weekly timesheet that feeds everything else.', src: '?role=Manager#/app/work/projects/P-214', link: 'Every hour logged here is costed, billed and counted toward margin.', all: [['Projects & Kanban', 'Boards with WIP limits, a Gantt timeline, files and team allocation.'], ['Timesheets', 'A weekly grid with a live timer and a deliberate billable switch.'], ['Calendar', 'Holidays, leave, deadlines, interviews and room bookings, layered.']] },
  { k: 'clients', name: 'Clients', s: 'Accounts, a lead pipeline, contracts with SLAs, and support tickets on the clock.', src: '?role=Admin#/app/clients', link: 'Contracts carry the SLA terms that tickets are measured against.', all: [['Accounts', 'Contacts, activity, projects, documents and invoices for each client.'], ['Leads', 'A pipeline by stage with days-in-stage and a funnel.'], ['Contracts & SLA', 'Renewals sorted by expiry; SLA terms feed ticket timers.'], ['Support tickets', 'Threads with internal notes and an SLA countdown.']] },
  { k: 'finance', name: 'Finance', s: 'Invoices built from approved hours, expenses, budgets and profitability you can trace.', src: '?role=Admin#/app/finance/profitability', link: 'Click any cost on the profitability page to see the timesheet entries behind it.', all: [['Invoices', 'Built from approved, unbilled timesheet entries, with GST split by client state.'], ['Expenses', 'Claims with receipts and approval trails; billable claims reach invoices.'], ['Budget', 'Department budgets with committed and actual spend.'], ['Profitability', 'Margin by client, project and person, every figure traceable.']] },
  { k: 'workplace', name: 'Workplace', s: 'Assets and licences, consumables, rooms, announcements, a knowledge base and visitors.', src: '?role=Admin#/app/workplace', link: 'Assets follow people through onboarding and offboarding.', all: [['Assets & licences', 'Every tracked item, who holds it and its history.'], ['Inventory', 'Consumables with reorder levels.'], ['Rooms', 'A day view of every room, bookable by the span, without clashes.'], ['Announcements', 'Posts with audiences, pins and acknowledgement receipts.'], ['Knowledge base', 'Policies, SOPs and how-tos written to be read.'], ['Visitors', 'Pre-registration and a tablet kiosk for the front desk.']] },
  { k: 'admin', name: 'Admin', s: 'Users and roles, approval workflows, master data and an audit log that cannot be edited.', src: '?role=Admin#/app/admin', link: 'Every approval in every hub runs on the same workflow engine.', all: [['Users & roles', 'Five built-in roles, each scoped to own, team or all records, enforced by the server.'], ['Custom role matrix', 'Edit a permission matrix for new roles. It is recorded today; enforcing it is coming.', 'coming'], ['Approval workflows', 'A visual builder with conditions, parallel approvers, SLAs and dry runs.'], ['Notification rules', 'Rules by event and channel. In-app notices work today; rule-driven email and digests are coming.', 'coming'], ['Audit log', 'Read-only, with before-and-after values, written in the same transaction as the change.'], ['Client portal', 'A separate app for clients: status, invoices, tickets and shared documents.']] },
];

type Ev = { m: number; d: string; type: string; ctc?: number; amt?: number };
/**
 * Aarav Shah's salary ledger (E-0112) in the demo organisation, months counted from April 2023. The payslip drawn
 * from it on the site is a simplified illustration of the calculation, not the app's payslip engine.
 */
export const EVENTS: Ev[] = [{ m: 0, d: 'Apr 2023', type: 'Hired', ctc: 1440000 }, { m: 12, d: 'Apr 2024', type: 'Revised', ctc: 1598400 }, { m: 18, d: 'Oct 2024', type: 'Bonus', amt: 60000 }, { m: 24, d: 'Apr 2025', type: 'Revised', ctc: 1822000 }, { m: 27, d: 'Jul 2025', type: 'Correction', amt: 1400 }, { m: 31, d: 'Nov 2025', type: 'Deduction', amt: -12000 }, { m: 36, d: 'Apr 2026', type: 'Revised', ctc: 1986000 }, { m: 41, d: 'Sep 2026', type: 'Correction', amt: 2100 }, { m: 42, d: 'Oct 2026', type: 'Bonus', amt: 75000 }];
export const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const tax = (x: number) => {
  x = Math.max(0, x - 75000);
  if (x <= 1200000) return 0;
  const sl: [number, number][] = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [1e12, 0.3]];
  let t = 0, p = 0;
  for (const [l, r] of sl) { if (x > p) t += (Math.min(x, l) - p) * r; p = l; }
  return t * 1.04;
};
/** The design's payslip arithmetic for the illustration, unchanged. */
export const slip = (m: number) => {
  let ctc = 0, extra = 0, kind = '';
  EVENTS.forEach((e) => { if (e.m <= m && e.ctc) ctc = e.ctc; if (e.m === m && e.amt) { extra = e.amt; kind = e.type; } });
  const mo = ctc / 12, basic = Math.round(mo * 0.4), hra = Math.round(basic * 0.5), pf = Math.min(1800, Math.round(basic * 0.12)), sp = Math.round(mo - basic - hra - pf), ann = (basic + hra + sp) * 12;
  const tds = Math.round(tax(ann) / 12 + (extra > 0 ? tax(ann + extra) - tax(ann) : 0));
  // A deduction event (a recovery) comes off net pay; a bonus or correction is paid on top of gross.
  const gross = basic + hra + sp + Math.max(0, extra), recovery = Math.max(0, -extra), ded = pf + 200 + tds + recovery;
  return { ctc, basic, hra, sp, pf, tds, gross, ded, recovery, net: gross - ded, extra, kind };
};

export const FAQ: [string, string][] = [
  ['Is Riona a product I can buy?', 'Not yet. Riona is a B.Tech project today, built to be launched to services firms afterwards. Kestrel Digital, the organisation you see in it, and its clients are demo data.'],
  ['Does Riona handle Indian payroll?', 'Yes. PF and ESI are calculated against the current wage ceilings, Professional Tax by the state each person works in, and TDS under both the new and old regimes. Form 16 Part B is projected from the same salary ledger. Filing returns (the EPFO ECR file, ESIC returns, PT challans, Form 24Q) is on the roadmap; today you take the figures from Riona.'],
  ['How does a timesheet entry reach an invoice?', 'When a manager approves a week, its billable entries become available in the invoice builder for that client, grouped by project and then by person. You choose what to bill, and each invoice line keeps a link back to the entries behind it.'],
  ['Can we bring in our current HR and accounting data?', 'Not yet. CSV import and a guided migration are on the roadmap. Today a new organisation is set up through the first-run wizard, and records are created in Riona.'],
  ['What does “event-sourced payroll” mean in practice?', 'Salary records are never overwritten. Every hire, revision, bonus, deduction and correction is appended as an event with a date and an actor, so any payslip can be regenerated as it stood on any past date. Corrections and arrears are new events, not edits.'],
  ['What can clients see?', 'Only their own records. The client portal is a separate app, and the database itself (row-level security and column grants) limits each client to their projects, invoices, tickets and the documents you share. Invoices list the people and hours billed, as invoices do. Costs, internal tasks and other clients never reach the portal.'],
  ['How do people sign in?', 'With a work email and password, or Google or Microsoft single sign-on once your organisation has set it up. Admins, HR and managers land on their dashboard, employees in My Space, and clients in the portal. Multi-factor sign-in is coming.'],
];

export const LOGIN: Record<Role, { email: string; path: string; land: string; d: string }> = {
  Admin: { email: 'dipak.sharma@kestrel.digital', path: '/app', land: 'the admin dashboard', d: 'Revenue, margin, users, workflows and the audit log' },
  HR: { email: 'meera.iyer@kestrel.digital', path: '/app', land: 'the HR dashboard', d: 'Attendance, leave, payroll and hiring' },
  Manager: { email: 'vikram.menon@kestrel.digital', path: '/app', land: 'the manager dashboard', d: 'Your team, projects, timesheets and approvals' },
  Employee: { email: 'aarav.shah@kestrel.digital', path: '/app/me', land: 'My Space', d: 'Your payslips, leave, claims, tasks and assets' },
};

/**
 * Open the app after sign-in, with a full load. The session cookie carries the role; only the landing path depends
 * on it. Client users land in their portal.
 */
export const enterApp = (role: Role | 'Client') => {
  if (role === 'Client') loadFresh(location.pathname + '#/portal');
  else loadFresh(location.pathname + '#' + LOGIN[role].path);
};
/**
 * The screenshot of the app shown for a preview (`?role=X#/path`). The site used to embed the app itself, running on
 * in-browser demo data; that data is gone (Wave 9), so the previews are pictures of the demo organisation, captured
 * into public/previews.
 */
const PREVIEW_SHOTS: Record<string, string> = {
  '?role=Admin#/app': 'role-admin', '?role=HR#/app/people': 'role-hr', '?role=Manager#/app/work/projects/P-214': 'role-manager',
  '?role=Employee#/app/me': 'role-employee', '#/portal': 'role-client',
  '?role=Admin#/app/admin': 'pillar-admin', '?role=Admin#/app/clients': 'pillar-clients', '?role=Admin#/app/finance/profitability': 'pillar-profitability',
  '?role=Admin#/app/workplace': 'pillar-workplace',
};
export const previewShot = (q: string) => import.meta.env.BASE_URL + 'previews/' + (PREVIEW_SHOTS[q] ?? 'role-admin') + '.jpg';

export const STATUTORY: [string, string][] = [
  ['PF', 'Employee and employer share at 12% of basic, with the wage ceiling applied.'],
  ['ESI', 'Applied below ₹21,000 gross a month, at the employee and employer rates.'],
  ['Professional Tax', 'A monthly amount set by the state the person works in.'],
  ['TDS', 'New and old regime, spread across the year and recomputed when pay changes.'],
  ['Form 16', 'Part B projected from the salary ledger, firm once the year closes.'],
];
/** Built today. Each line is something a reviewer can check in the code or the app. */
export const SECURITY: [string, string][] = [
  ['Role-based access', 'Five roles, each scoped to its own, its team’s or all records. The server checks every request; the screen only hides what a role can’t use.'],
  ['Client isolation in the database', 'The portal reads through a restricted database role with row-level security and column grants, so a client can’t reach another client’s rows even through a bug in the app.'],
  ['An audit log that can’t be edited', 'Every change is written with its before and after values, in the same transaction as the change itself.'],
  ['Signed, short-lived file links', 'Payslips, invoices and documents are served through links that expire after five minutes.'],
];
export const SECURITY_MORE: [string, string, ('coming' | undefined)?][] = [
  ['Single sign-on', 'Google and Microsoft, with PKCE and verified ID tokens.'],
  ['Sessions', 'Signed, HTTP-only session cookies. Changing a password signs you out everywhere else.'],
  ['Multi-factor sign-in', 'A second factor for every role.', 'coming'],
  ['Field-level encryption', 'Salary and bank details encrypted column by column.', 'coming'],
  ['SAML and SCIM', 'For organisations that manage people in an identity provider.', 'coming'],
];
export const ROLE_PREVIEW: Record<string, [string, string]> = {
  Admin: ['?role=Admin#/app', 'The admin sees revenue, receivables, margin and system alerts.'],
  HR: ['?role=HR#/app/people', 'HR works from the People hub: attendance, leave, payroll and hiring.'],
  Manager: ['?role=Manager#/app/work/projects/P-214', 'Managers run boards and approve their team’s time. No finance tab unless granted.'],
  Employee: ['?role=Employee#/app/me', 'Employees get My Space: payslips, leave, claims, tasks — their own and nobody else’s.'],
  // The design showed a hand-built mock here only because the portal wasn't built yet; it is now, so this is live too.
  Client: ['#/portal', 'Clients get a separate portal: project status, invoices with a Pay button, tickets and shared documents.'],
};
export const FOOTER: [string, string][] = [['Product', '#/features'], ['Security', '#/security'], ['Docs', '#/docs'], ['Contact', '#/contact']];
