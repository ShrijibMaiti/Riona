/**
 * Loads the deterministic demo dataset (db/seed/demo, which until Wave 9 lived in the frontend) into Postgres, so the app shows
 * the same people against the real API as it does on the fixture. Each wave adds the tables it builds:
 *   Wave 1–2  the organisation, roles, the 60 employees, their user accounts, and the setup links.
 *   Wave 3    holidays, attendance, leave types and requests, clients, projects with teams, tasks and comments.
 *   Wave 4    timesheets, workflows, approvals with their decisions, regularisations, profile changes, notifications.
 *   Wave 5    the salary ledger, payroll runs and their frozen payslips, salary structures, statutory filings.
 *   Wave 6    expense claims, invoices with their lines, links, payments and revisions, budgets.
 *   Wave 7    tickets and their threads, documents and versions, a client-portal account per client.
 *   Wave 8    leads, contracts, assets, stock, rooms and bookings, announcements, the knowledge base, visitors, jobs and
 *             candidates, onboarding, reviews and goals, training, notification rules, master lists, system jobs.
 *
 *   npm run db:seed        reset the database, migrate, import (development only)
 *
 * Append-only tables can't be emptied, so this always starts from a reset. Every active user gets the demo
 * password below; the four demo accounts are printed at the end.
 */
import { sql, type Kysely } from 'kysely';
import { createSeed } from './demo';
import { HISTORY_FROM, TODAY } from './demo/calendar';
import { config } from '../../src/config';
import type { DB } from '../../src/db/schema';
import { hashPassword } from '../../src/auth/password';
import { hashToken } from '../../src/http/plugins/session';
import { toPaise } from '../../src/lib/money';
import { migrate } from '../migrate';
import { computeLines } from '../../src/engines/payroll/run';
import { freeze, invoiceTotals } from '../../src/modules/finance/gst';

export const DEMO_PASSWORD = 'riona-demo-2026';
export const ORG_NAME = 'Kestrel Digital';

/** The demo sign-ins: the people the sign-in card's role tabs prefill (frontend/app/src/public/content.ts). */
export const DEMO_ACCOUNTS = {
  Admin: 'dipak.sharma@kestrel.digital',
  HR: 'meera.iyer@kestrel.digital',
  Manager: 'vikram.menon@kestrel.digital',
  Employee: 'aarav.shah@kestrel.digital',
  // The client portal, as Lumen Energy (C-31).
  Client: 'meghna@lumen.in',
} as const;

/** Roles the API authorises against. Display names like "Finance" or "IT" keep their name in role_name. */
const appRole = (r: string) => (r === 'Admin' || r === 'HR' || r === 'Manager' || r === 'Employee' ? r : r === 'Finance' ? 'Manager' : 'Employee');

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function importFixture(db: Kysely<DB>, opts: { fastPasswords?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const d = createSeed();
  // Tests hash once and reuse it (scrypt is deliberately slow); development hashes per user, as production would.
  const shared = opts.fastPasswords ? await hashPassword(DEMO_PASSWORD) : null;

  await db.transaction().execute(async (t) => {
    await t.insertInto('org').values({ name: ORG_NAME, legalName: ORG_NAME + ' Pvt Ltd', state: 'Karnataka', timeZone: 'Asia/Kolkata', historyFrom: HISTORY_FROM }).execute();
    await t.insertInto('roles').values(d.roles.map((r) => ({ id: r.id, name: r.name, seeded: r.seeded, description: r.description, permissions: JSON.stringify(r.permissions) }))).execute();

    // Managers before their reports: insert without a manager, then set it.
    await chunked(d.employees, 500, (part) =>
      t.insertInto('employees').values(part.map((e) => ({
        id: e.id, name: e.name, email: e.email, personalEmail: e.personalEmail, phone: e.phone, title: e.title, dept: e.dept, managerId: null,
        location: e.location, state: e.state, type: e.type, status: e.status, joined: e.joined, dob: e.dob || null, bloodGroup: e.bloodGroup,
        maritalStatus: e.maritalStatus, address: e.address, emergency: JSON.stringify(e.emergency), bankName: e.bank.name, bankIfsc: e.bank.ifsc,
        // The fixture keeps only the last four digits; pad to a plausible full account number.
        bankAccount: '50218834' + '1097' + e.bank.accountLast4, pan: e.pan, uan: e.uan, billable: e.billable, billRatePaise: toPaise(e.billRate),
        noticeDays: e.noticeDays, confirmationDue: e.confirmationDue,
      }))).execute(),
    );
    for (const e of d.employees) if (e.managerId) await t.updateTable('employees').set({ managerId: e.managerId }).where('id', '=', e.id).execute();

    for (const u of d.users) {
      await t.insertInto('users').values({
        id: u.id, employeeId: u.employeeId, email: u.email, name: u.name, role: appRole(u.role), roleName: u.role, status: u.status,
        lastActive: u.lastActive, invited: u.invited, passwordHash: u.status === 'Active' ? shared ?? (await hashPassword(DEMO_PASSWORD)) : null,
      }).execute();
    }

    // Wave 3: attendance and leave.
    await t.insertInto('holidays').values(d.holidays).execute();
    await chunked(d.attendance, 2000, (part) =>
      t.insertInto('attendance').values(part.map((a) => ({ id: a.id, employeeId: a.employeeId, date: a.date, mark: a.mark, inTime: a.in, outTime: a.out, regularisedFrom: a.regularisedFrom ?? null }))).execute(),
    );
    await t.insertInto('leaveTypes').values(d.leaveTypes.map((l) => ({ code: l.code, name: l.name, accrual: l.accrual, entitlement: l.entitlement, carryForwardCap: l.carryForwardCap, encashment: l.encashment, appliesTo: l.appliesTo }))).execute();
    await chunked(d.leave, 1000, (part) =>
      t.insertInto('leaveRequests').values(part.map((l) => ({ id: l.id, employeeId: l.employeeId, type: l.type, from: l.from, to: l.to, days: l.days, reason: l.reason, submitted: l.submitted, status: l.status, approvalId: l.approvalId }))).execute(),
    );

    // Wave 3: clients, projects and their teams, tasks and their comments.
    await t.insertInto('clients').values(d.clients.map((c) => ({
      id: c.id, name: c.name, industry: c.industry, city: c.city, state: c.state, gstin: c.gstin, ownerId: c.ownerId || null, status: c.status,
      since: c.since, paymentTermsDays: c.paymentTermsDays, contacts: JSON.stringify(c.contacts),
    }))).execute();
    for (const p of d.projects) {
      await t.insertInto('projects').values({
        id: p.id, name: p.name, code: p.code, clientId: p.clientId, managerId: p.managerId || null, start: p.start, end: p.end, model: p.model,
        feePaise: p.fee === null ? null : toPaise(p.fee), budgetPaise: toPaise(p.budget), health: p.health, status: p.status,
        milestones: JSON.stringify(p.milestones), phases: JSON.stringify(p.phases),
      }).execute();
      if (p.team.length) await t.insertInto('projectMembers').values(p.team.map((m, position) => ({ projectId: p.id, employeeId: m.employeeId, role: m.role, allocation: m.allocation, position }))).execute();
    }
    await chunked(d.tasks, 500, (part) =>
      t.insertInto('tasks').values(part.map((k) => ({
        id: k.id, projectId: k.projectId, title: k.title, status: k.status, priority: k.priority, assigneeId: k.assigneeId || null, due: k.due,
        estimateHours: k.estimateHours, phaseId: k.phaseId, created: k.created, subtasks: JSON.stringify(k.subtasks), description: k.description,
      }))).execute(),
    );
    const comments = d.tasks.flatMap((k) => k.comments.map((c) => ({ id: c.id, taskId: k.id, authorId: c.authorId || null, at: c.at, text: c.text })));
    if (comments.length) await chunked(comments, 1000, (part) => t.insertInto('taskComments').values(part).execute());

    // Wave 5: the salary ledger, payroll runs with their frozen payslips, salary structures, statutory filings.
    await chunked(d.salaryEvents, 500, (part) =>
      t.insertInto('salaryEvents').values(part.map((e) => ({
        id: e.id, employeeId: e.employeeId, type: e.type, effective: e.effective, recorded: e.recorded, ctcPaise: e.ctc ? toPaise(e.ctc) : null,
        amountPaise: e.amount ? toPaise(e.amount) : null, appliesTo: e.appliesTo ?? null, component: e.component ?? null, actorId: e.actorId || null, note: e.note, title: e.title ?? null,
      }))).execute(),
    );
    for (const r of d.payrollRuns) {
      await t.insertInto('payrollRuns').values({ ...r, employeeIds: JSON.stringify(r.employeeIds), salaryEventIds: JSON.stringify(r.salaryEventIds), bankFileIssues: JSON.stringify(r.bankFileIssues) }).execute();
      if (r.stage !== 'Disbursed') continue;
      // What each person was paid, frozen as at disbursement: computed from the run's own inputs by the engine.
      const lines = await computeLines(t, r);
      if (lines.length) await t.insertInto('payslips').values(lines.map((l) => ({ runId: r.id, employeeId: l.employeeId, month: r.month, slip: JSON.stringify(l), netPaise: toPaise(l.net), frozenAt: r.disbursedOn! }))).execute();
    }
    await t.insertInto('salaryStructures').values(d.structures.map((x) => ({ id: x.id, name: x.name, appliesTo: x.appliesTo, components: JSON.stringify(x.components) }))).execute();
    await t.insertInto('statutoryFilings').values(d.filings).execute();

    // Wave 4: timesheets, workflows, approvals with their decisions, and the records decided through them.
    await chunked(d.entries, 2000, (part) =>
      t.insertInto('timesheetEntries').values(part.map((e) => ({ id: e.id, employeeId: e.employeeId, projectId: e.projectId, clientId: e.clientId, taskId: e.taskId, date: e.date, hours: e.hours, billable: e.billable, note: e.note, status: e.status }))).execute(),
    );
    await chunked(d.weeks, 500, (part) =>
      t.insertInto('timesheetWeeks').values(part.map((w) => ({ id: w.id, employeeId: w.employeeId, weekStart: w.weekStart, status: w.status, approvalId: w.approvalId, revisions: JSON.stringify(w.revisions) }))).execute(),
    );
    for (const w of d.workflows) {
      await t.insertInto('workflows').values({ id: w.id, name: w.name, module: w.module, status: w.status, currentVersion: 1, updated: w.updated }).execute();
      await t.insertInto('workflowVersions').values({ workflowId: w.id, version: 1, definition: JSON.stringify({ nodes: w.nodes, edges: w.edges }), createdAt: w.updated }).execute();
    }
    const activeWf = new Map(d.workflows.filter((w) => w.status === 'Active').map((w) => [w.module, w.id]));
    for (const a of d.approvals) {
      const decided = a.chain.slice(1).filter((s) => s.decision);
      await t.insertInto('approvals').values({
        id: a.id, type: a.type, sourceId: a.sourceId, requesterId: a.requesterId, submitted: a.submitted, status: a.status, current: a.current,
        plan: JSON.stringify(a.chain.slice(1).map((s) => ({ approverId: s.approverId, role: s.role }))),
        workflowId: activeWf.get(a.type) ?? null, workflowVersion: activeWf.has(a.type) ? 1 : null,
        createdAt: a.chain[0].at ?? a.submitted, decidedAt: a.status === 'Pending' ? null : decided.at(-1)?.at ?? a.submitted,
      }).execute();
      const steps = a.chain.flatMap((s, i) => (i > 0 && s.decision ? [{ approvalId: a.id, step: i, approverId: s.approverId, role: s.role, decision: s.decision, comment: s.comment, at: s.at ?? a.submitted }] : []));
      if (steps.length) await t.insertInto('approvalSteps').values(steps).execute();
    }
    const statusOf = (approvalId: string) => d.approvals.find((x) => x.id === approvalId)?.status ?? 'Pending';
    if (d.regularisations.length) await t.insertInto('regularisations').values(d.regularisations.map((r) => ({ ...r, status: statusOf(r.approvalId) }))).execute();
    if (d.profileChanges.length) await t.insertInto('profileChanges').values(d.profileChanges).execute();
    await t.insertInto('notifications').values(d.notifications).execute();

    // Wave 6: expense claims and their revisions, invoices with their lines and the hours and claims each bills
    // (frozen totals for every issued invoice), payments, revisions, budgets.
    await chunked(d.expenses, 500, (part) =>
      t.insertInto('expenses').values(part.map((x) => ({
        id: x.id, employeeId: x.employeeId, category: x.category, description: x.description, amountPaise: toPaise(x.amount), date: x.date, projectId: x.projectId,
        clientId: x.clientId, billable: x.billable, receipt: x.receipt, status: x.status, submitted: x.submitted, reimbursedOn: x.reimbursedOn, approvalId: x.approvalId,
      }))).execute(),
    );
    const xrevs = d.expenses.flatMap((x) => x.revisions.map((r) => ({ expenseId: x.id, at: r.at, amountPaise: toPaise(r.amount), description: r.description, status: r.status, reason: r.reason })));
    if (xrevs.length) await t.insertInto('expenseRevisions').values(xrevs).execute();
    const stateOf = new Map(d.clients.map((c) => [c.id, c.state]));
    for (const inv of d.invoices) {
      const totals = invoiceTotals(inv.lines, inv.discount, [], stateOf.get(inv.clientId) ?? '', 'Karnataka');
      await t.insertInto('invoices').values({
        id: inv.id, number: inv.number, clientId: inv.clientId, issued: inv.issued, due: inv.due, status: inv.status, discountPaise: toPaise(inv.discount),
        notes: inv.notes, approvalId: inv.approvalId, issuedTotals: inv.status === 'Draft' ? null : JSON.stringify(freeze(totals)),
      }).execute();
      const live = inv.status !== 'Void';
      for (const [i, l] of inv.lines.entries()) {
        await t.insertInto('invoiceLines').values({ id: l.id, invoiceId: inv.id, position: i + 1, kind: l.kind, projectId: l.projectId, description: l.description, quantity: l.quantity, unit: l.unit, ratePaise: toPaise(l.rate), amountPaise: toPaise(l.amount) }).execute();
        if (l.entryIds.length) await chunked(l.entryIds, 1000, (part) => t.insertInto('invoiceLineEntries').values(part.map((entryId) => ({ lineId: l.id, entryId, invoiceId: inv.id, live }))).execute());
        if (l.expenseIds.length) await t.insertInto('invoiceLineExpenses').values(l.expenseIds.map((expenseId) => ({ lineId: l.id, expenseId, invoiceId: inv.id, live }))).execute();
      }
      if (inv.payments.length) await t.insertInto('payments').values(inv.payments.map((pm) => ({ id: pm.id, invoiceId: inv.id, date: pm.date, amountPaise: toPaise(pm.amount), method: pm.method, reference: pm.reference }))).execute();
      if (inv.revisions.length) await t.insertInto('invoiceRevisions').values(inv.revisions.map((r) => ({ invoiceId: inv.id, at: r.at, reason: r.reason, lines: JSON.stringify(r.lines), discountPaise: toPaise(r.discount), totalPaise: toPaise(invoiceTotals(r.lines, r.discount, [], stateOf.get(inv.clientId) ?? '', 'Karnataka').total) }))).execute();
    }
    await t.insertInto('budgets').values(d.budgets.map((b) => ({ id: b.id, dept: b.dept, fy: b.fy, plannedPaise: toPaise(b.planned), committedPaise: toPaise(b.committed), lines: JSON.stringify(b.lines) }))).execute();

    // Wave 7: support tickets with their threads, documents with their versions, and a client-portal account for
    // each client's primary contact (same demo password). Lumen Energy's is the demo: meghna@lumen.in.
    for (const tk of d.tickets) {
      await t.insertInto('tickets').values({
        id: tk.id, clientId: tk.clientId, projectId: tk.projectId, subject: tk.subject, priority: tk.priority, assigneeId: tk.assigneeId, status: tk.status,
        opened: tk.opened, resolved: tk.resolved, slaDue: tk.slaDue,
      }).execute();
      if (tk.messages.length) await t.insertInto('ticketMessages').values(tk.messages.map((m) => ({ id: m.id, ticketId: tk.id, at: m.at, author: m.author, authorId: m.authorId, internal: m.internal, text: m.text }))).execute();
    }
    await chunked(d.documents, 500, (part) =>
      t.insertInto('documents').values(part.map((x) => ({ id: x.id, ownerType: x.ownerType, ownerId: x.ownerId, name: x.name, type: x.type, expires: x.expires, visibleToClient: x.visibleToClient }))).execute(),
    );
    const versions = d.documents.flatMap((x) => x.versions.map((v) => ({ documentId: x.id, version: v.version, uploaded: v.uploaded, byId: v.byId, size: v.size, note: v.note })));
    await chunked(versions, 1000, (part) => t.insertInto('documentVersions').values(part).execute());
    for (const c of d.clients) {
      const contact = c.contacts.find((x) => x.primary) ?? c.contacts[0];
      if (!contact) continue;
      await t.insertInto('users').values({
        id: 'U-' + c.id, clientId: c.id, email: contact.email, name: contact.name, role: 'Client', roleName: 'Client', status: 'Active',
        invited: c.since, passwordHash: shared ?? (await hashPassword(DEMO_PASSWORD)),
      }).execute();
    }

    // Wave 8: the remaining modules.
    // Clients: leads (with their activity) and contracts.
    for (const l of d.leads) {
      await t.insertInto('leads').values({ id: l.id, company: l.company, contact: l.contact, valuePaise: toPaise(l.value), stage: l.stage, ownerId: l.ownerId, source: l.source, stageSince: l.stageSince, created: l.created, probability: l.probability, notes: l.notes }).execute();
      if (l.activity.length) await t.insertInto('leadActivity').values(l.activity.map((a) => ({ leadId: l.id, at: a.at, text: a.text, byId: a.byId }))).execute();
    }
    await t.insertInto('contracts').values(d.contracts.map((c) => ({ id: c.id, clientId: c.clientId, title: c.title, kind: c.kind, start: c.start, end: c.end, valuePaise: toPaise(c.value), autoRenew: c.autoRenew, slaResponseHours: c.slaResponseHours, slaResolutionHours: c.slaResolutionHours, status: c.status }))).execute();
    // Workplace.
    await chunked(d.assets, 500, (part) => t.insertInto('assets').values(part.map((a) => ({ id: a.id, tag: a.tag, name: a.name, category: a.category, serial: a.serial, purchased: a.purchased, costPaise: toPaise(a.cost), status: a.status }))).execute());
    const allocs = d.assets.flatMap((a) => a.allocations.map((x) => ({ assetId: a.id, employeeId: x.employeeId, from: x.from, to: x.to, note: x.note })));
    await chunked(allocs, 500, (part) => t.insertInto('assetAllocations').values(part).execute());
    const issues = d.assets.flatMap((a) => (a.issues ?? []).map((x) => ({ id: x.id, assetId: a.id, at: x.at, reportedById: x.reportedById, text: x.text })));
    if (issues.length) await t.insertInto('assetIssues').values(issues).execute();
    for (const it of d.inventory) {
      await t.insertInto('inventoryItems').values({ id: it.id, name: it.name, unit: it.unit, stock: it.stock, reorderLevel: it.reorderLevel, location: it.location }).execute();
      if (it.movements.length) await t.insertInto('stockMovements').values(it.movements.map((m) => ({ id: m.id, itemId: it.id, date: m.date, kind: m.kind, qty: m.qty, note: m.note, byId: m.byId }))).execute();
    }
    await t.insertInto('rooms').values(d.rooms.map((r) => ({ id: r.id, name: r.name, floor: r.floor, capacity: r.capacity, equipment: r.equipment }))).execute();
    await chunked(d.bookings, 500, (part) => t.insertInto('bookings').values(part.map((b) => ({ id: b.id, roomId: b.roomId, date: b.date, start: b.start, end: b.end, title: b.title, bookedById: b.bookedById }))).execute());
    for (const a of d.announcements) {
      await t.insertInto('announcements').values({ id: a.id, title: a.title, body: a.body, authorId: a.authorId, posted: a.posted, pinned: a.pinned, audience: a.audience, requiresAck: a.requiresAck, audienceIds: a.audienceIds }).execute();
      if (a.ackIds.length) await t.insertInto('announcementAcks').values(a.ackIds.map((employeeId) => ({ announcementId: a.id, employeeId, at: a.posted + 'T12:00:00+05:30' }))).execute();
    }
    await t.insertInto('kbArticles').values(d.kb.map((k) => ({ id: k.id, slug: k.slug, title: k.title, category: k.category, updated: k.updated, authorId: k.authorId, sections: JSON.stringify(k.sections) }))).execute();
    await t.insertInto('visitors').values(d.visitors.map((v) => ({ id: v.id, name: v.name, company: v.company, hostId: v.hostId, date: v.date, expected: v.expected, checkedIn: v.checkedIn, checkedOut: v.checkedOut, purpose: v.purpose, badge: v.badge }))).execute();
    // Talent.
    await t.insertInto('jobs').values(d.jobs.map((j) => ({ id: j.id, title: j.title, dept: j.dept, location: j.location, openings: j.openings, status: j.status, posted: j.posted, hiringManagerId: j.hiringManagerId }))).execute();
    await t.insertInto('candidates').values(d.candidates.map((c) => ({ id: c.id, jobId: c.jobId, name: c.name, email: c.email, source: c.source, stage: c.stage, applied: c.applied, experienceYears: c.experienceYears, currentCompany: c.currentCompany, notes: c.notes, interviews: JSON.stringify(c.interviews) }))).execute();
    for (const c of d.onboarding) {
      await t.insertInto('onboardingCases').values({ id: c.id, kind: c.kind, employeeId: c.employeeId, personName: c.personName, title: c.title, dept: c.dept, date: c.date }).execute();
      await t.insertInto('onboardingItems').values(c.items.map((it, i) => ({ id: it.id, caseId: c.id, position: i + 1, owner: it.owner, label: it.label, done: it.done, doneOn: it.doneOn }))).execute();
    }
    await t.insertInto('reviewCycles').values(d.cycles.map((c) => ({ id: c.id, name: c.name, period: c.period, stage: c.stage, selfDue: c.selfDue, managerDue: c.managerDue }))).execute();
    await t.insertInto('reviews').values(d.reviews.map((r) => ({ id: r.id, cycleId: r.cycleId, employeeId: r.employeeId, reviewerId: r.reviewerId, status: r.status, rating: r.rating, selfAnswers: JSON.stringify(r.selfAnswers), managerAnswers: JSON.stringify(r.managerAnswers) }))).execute();
    await t.insertInto('goals').values(d.goals.map((g) => ({ id: g.id, employeeId: g.employeeId, cycleId: g.cycleId, title: g.title, progress: g.progress, measure: g.measure }))).execute();
    await t.insertInto('trainingProgrammes').values(d.programmes.map((p) => ({ id: p.id, name: p.name, kind: p.kind, mandatory: p.mandatory, validityMonths: p.validityMonths }))).execute();
    await t.insertInto('certifications').values(d.certifications.map((c) => ({ id: c.id, programmeId: c.programmeId, employeeId: c.employeeId, completed: c.completed, expires: c.expires, status: c.status }))).execute();
    // Admin.
    await t.insertInto('notificationRules').values(d.notificationRules.map((r, i) => ({ id: r.id, event: r.event, module: r.module, position: i + 1, inApp: r.channels.inApp, email: r.channels.email, digest: r.channels.digest }))).execute();
    for (const [i, m] of d.masters.entries()) {
      await t.insertInto('masterLists').values({ id: m.id, name: m.name, position: i + 1, columns: m.columns }).execute();
      if (m.rows.length) await t.insertInto('masterRows').values(m.rows.map((r) => ({ id: r.id, listId: m.id, values: r.values, active: r.active }))).execute();
    }
    await t.insertInto('systemJobs').values(d.systemJobs.map((j) => ({ id: j.id, name: j.name, lastRun: j.lastRun, status: j.status, detail: j.detail }))).execute();

    // The setup-wizard routes the frontend demonstrates: #/setup/demo-token and #/setup/expired-link.
    await t.insertInto('setupTokens').values([
      { tokenHash: hashToken('demo-token'), orgName: ORG_NAME, email: 'owner@kestrel.digital', expiresAt: new Date(Date.now() + 365 * 864e5) },
      { tokenHash: hashToken('expired-link'), orgName: ORG_NAME, email: 'owner@kestrel.digital', expiresAt: new Date(Date.now() - 864e5) },
    ]).execute();
  });

  const accounts = await db.selectFrom('users').select(['email', 'name', 'role']).where('email', 'in', Object.values(DEMO_ACCOUNTS)).execute();
  const users = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM users`.execute(db)).rows[0].n);
  log(`Imported ${ORG_NAME}: ${d.employees.length} employees, ${users} user accounts, ${d.attendance.length} attendance marks, ${d.leave.length} leave requests, ${d.clients.length} clients, ${d.projects.length} projects, ${d.tasks.length} tasks (demo data dated ${TODAY}).`);
  log(`Demo sign-ins (password "${DEMO_PASSWORD}"):`);
  for (const [role, email] of Object.entries(DEMO_ACCOUNTS)) {
    const a = accounts.find((x) => x.email === email);
    log(`  ${role.padEnd(9)} ${email}  ${a ? `(${a.name}, ${a.role})` : '(missing!)'}`);
  }
}

if (process.argv[1] && /import-fixture\.ts$/.test(process.argv[1])) {
  if (config.isProd) {
    console.error('Refusing to load demo data into production.');
    process.exit(1);
  }
  const { db, closeDb } = await import('../../src/db/client');
  await migrate(config.db.url, { reset: true });
  await importFixture(db).finally(() => closeDb());
}
