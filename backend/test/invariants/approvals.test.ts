/**
 * Wave 4: the approval engine and its first consumers.
 *  - done when: a leave request goes Employee → Manager → approved; only the current approver can decide (403
 *    otherwise); a rejection without a reason fails (422); each step is audited
 *  - workflows are versioned: a request keeps the chain it was given when the workflow later changes
 *  - timesheets (save, submit, recall, approve with dual-state revisions), regularisations, profile changes
 *  - parity: the seeded approvals, timesheets and workflows read exactly as the frontend's fixture has them
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fixture } from '../helpers/golden';
import { count, db, sqlError } from '../helpers/db';
import { reportsOf } from '../../src/auth/rbac/scope';
import { anonymous, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const AARAV = 'E-0112', KABIR = 'E-0118', ANANYA = 'E-0101';
const kabir = () => signIn('kabir.malhotra@kestrel.digital'); // Aarav's reporting manager
const ananya = () => signIn('ananya.rao@kestrel.digital'); // first HR approver
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
/** Times as instants, so '2026-11-04' and '2026-11-04T05:30:00+05:30' compare equal. */
const instants = <T,>(x: T): T => JSON.parse(JSON.stringify(x), (k, v) => (k === 'at' && typeof v === 'string' ? Date.parse(v) : v));
let nextDay = 0;
/** A fresh pair of working days in 2027 for each leave request, so tests never overlap each other. */
const freshDates = (days = 2) => {
  const start = new Date(Date.UTC(2027, 1, 1 + nextDay * 7));
  nextDay++;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(new Date(start.getTime() + (days - 1) * 864e5)) };
};
const apply = async (days = 2) => {
  const emp = await signIn('Employee');
  const res = await emp.post('/leave-requests', { type: 'CL', ...freshDates(days), reason: 'Family visit', days });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; approvalId: string; status: string };
};
const approvalOf = async (c: Awaited<ReturnType<typeof signIn>>, id: string) =>
  ((await c.get('/approvals')).body as { id: string; status: string; chain: { approverId: string; role: string; decision: string | null }[] }[]).find((a) => a.id === id);

describe('parity with the frontend fixture (as Admin)', () => {
  it('approvals of the types the backend owns, with their sources and decisions', async () => {
    const admin = await signIn('Admin');
    for (const type of ['Leave', 'Timesheet', 'Regularisation', 'Profile change'] as const) {
      const want = await fixture.getApprovals({ type });
      const got = (await admin.get('/approvals?type=' + encodeURIComponent(type))).body;
      expect(instants(byId(got.filter((a: { id: string }) => want.some((w) => w.id === a.id)))), type).toEqual(instants(byId(want)));
      expect(got.length, type).toBeGreaterThanOrEqual(want.length);
    }
  });

  it('timesheet entries and weeks, regularisations, profile changes, workflows, notifications', async () => {
    const admin = await signIn('Admin');
    const entries = await fixture.getTimesheetEntries({ from: '2026-10-01', to: '2026-10-31' });
    expect(byId((await admin.get('/timesheet-entries?from=2026-10-01&to=2026-10-31')).body)).toEqual(byId(entries));
    const weeks = await fixture.getTimesheetWeeks({ employeeId: 'E-0112' });
    expect(instants(byId((await admin.get('/timesheet-weeks?employeeId=E-0112')).body).filter((w: { id: string }) => weeks.some((x) => x.id === w.id)))).toEqual(instants(byId(weeks)));
    expect(byId((await admin.get('/regularisations')).body).slice(0, 2)).toEqual(byId(await fixture.getRegularisations()));
    const mine = await fixture.getMyProfileChanges(); // the fixture's person is Dipak, the Admin
    expect((await admin.get('/me/profile-changes')).body).toEqual(mine);
    expect(byId((await admin.get('/workflows')).body)).toEqual(byId(await fixture.getWorkflows()));
    expect(instants(byId((await admin.get('/notifications')).body))).toEqual(instants(byId(await fixture.getNotifications())));
  });
});

describe('a leave request: Employee → Manager → approved', () => {
  it('goes to the reporting manager, is decided only by them, needs a reason to reject, and is audited at each step', async () => {
    const leave = await apply(2);
    expect(leave.status).toBe('Pending');
    const mgr = await kabir();
    const ap = await approvalOf(mgr, leave.approvalId);
    expect(ap?.chain.map((s) => [s.approverId, s.role, s.decision])).toEqual([[AARAV, 'Requester', 'Approved'], [KABIR, 'Reporting manager', null]]);
    expect(await count('outbox', `topic = 'notify' AND payload->>'approvalId' = '${leave.approvalId}' AND payload->'recipientIds' ? '${KABIR}'`)).toBe(1);

    // Only the current approver.
    const hr = await signIn('HR');
    const notYours = await hr.post(`/approvals/${leave.approvalId}/decision`, { approve: true });
    expect([notYours.status, notYours.body.error.message]).toEqual([403, 'This request is waiting on someone else.']);
    const self = await (await signIn('Employee')).post(`/approvals/${leave.approvalId}/decision`, { approve: true });
    expect(self.status).toBe(403);

    // A rejection needs a reason.
    const noReason = await mgr.post(`/approvals/${leave.approvalId}/decision`, { approve: false });
    expect([noReason.status, noReason.body.error.message]).toEqual([422, 'Give a reason for rejecting.']);
    expect((await mgr.post(`/approvals/${leave.approvalId}/decision`, { approve: false, comment: 'no' })).status).toBe(422);

    const ok = await mgr.post(`/approvals/${leave.approvalId}/decision`, { approve: true, comment: 'Enjoy.' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'Approved', source: { kind: 'Leave', leave: { id: leave.id, status: 'Approved' } } });
    expect(ok.body.chain[1]).toMatchObject({ approverId: KABIR, decision: 'Approved', comment: 'Enjoy.' });

    // Audited: created, then approved; the decision is a step row; the requester (and HR, per the workflow) told.
    expect(await count('audit_log', `entity = 'Leave request' AND entity_id = '${leave.id}' AND action IN ('Created', 'Approved')`)).toBe(2);
    expect(await count('approval_steps', `approval_id = '${leave.approvalId}'`)).toBe(1);
    expect(await count('outbox', `topic = 'notify' AND payload->>'approvalId' = '${leave.approvalId}' AND payload->'recipientIds' ? '${AARAV}' AND payload->'recipientIds' ? '${ANANYA}'`)).toBe(1);
    const mine = (await (await signIn('Employee')).get('/leave-requests')).body.find((l: { id: string }) => l.id === leave.id);
    expect(mine.status).toBe('Approved');

    const again = await mgr.post(`/approvals/${leave.approvalId}/decision`, { approve: true });
    expect([again.status, again.body.error.message]).toEqual([409, 'Already decided.']);
  });

  it('a rejection with a reason marks the leave rejected and keeps the reason', async () => {
    const leave = await apply(1);
    const res = await (await kabir()).post(`/approvals/${leave.approvalId}/decision`, { approve: false, comment: 'Release week, sorry.' });
    expect(res.body).toMatchObject({ status: 'Rejected', source: { leave: { status: 'Rejected' } } });
    expect(res.body.chain[1]).toMatchObject({ decision: 'Rejected', comment: 'Release week, sorry.' });
  });

  it('decisions are history: approval_steps refuses UPDATE and DELETE', async () => {
    expect(await sqlError(`UPDATE approval_steps SET decision = 'Rejected'`)).toMatch(/append-only/);
    expect(await sqlError(`DELETE FROM approval_steps`)).toMatch(/append-only/);
  });

  it('refuses overlapping leave and a backwards range; cancelling a pending request withdraws it', async () => {
    const emp = await signIn('Employee');
    const dates = freshDates(2);
    const first = (await emp.post('/leave-requests', { type: 'CL', ...dates, reason: '', days: 2 })).body;
    const overlap = await emp.post('/leave-requests', { type: 'SL', from: dates.to, to: dates.to, reason: '', days: 1 });
    expect([overlap.status, overlap.body.error.message]).toEqual([409, 'You already have leave on some of these days.']);
    expect((await emp.post('/leave-requests', { type: 'CL', from: dates.to, to: dates.from, reason: '', days: 1 })).status).toBe(422);

    const cancelled = await emp.post(`/leave-requests/${first.id}/cancel`);
    expect(cancelled.body.status).toBe('Cancelled');
    expect(await approvalOf(await kabir(), first.approvalId)).toBeUndefined(); // withdrawn: gone from the queue
    expect((await (await kabir()).post(`/approvals/${first.approvalId}/decision`, { approve: true })).status).toBe(404);
    expect((await emp.post(`/leave-requests/${first.id}/cancel`)).status).toBe(409);
    expect((await (await signIn('HR')).post(`/leave-requests/${first.id}/cancel`)).status).toBe(404); // not theirs
  });

  it('bulk approve takes what is the approver’s and skips the rest', async () => {
    const a = await apply(1), b = await apply(1);
    const someoneElses = await db.selectFrom('approvals').select('id').where('status', '=', 'Pending').where('type', '=', 'Leave')
      .where('id', 'not in', [a.approvalId, b.approvalId]).executeTakeFirstOrThrow();
    const res = await (await kabir()).post('/approvals/bulk-decision', { ids: [a.approvalId, b.approvalId, someoneElses.id], approve: true });
    expect(res.body).toBe(2);
    expect((await (await kabir()).post('/approvals/bulk-decision', { ids: [a.approvalId], approve: false })).status).toBe(422);
  });
});

describe('workflows', () => {
  it('a saved workflow is a new version; a request in flight keeps its chain', async () => {
    const admin = await signIn('Admin');
    const wf = (await admin.get('/workflows/WF-1')).body;
    const inFlight = await apply(1);

    // Add an HR step after the reporting manager.
    const hrStep = { id: 'WF-1-HR', kind: 'Approver', label: 'HR', x: 300, y: 300, config: { approver: 'HR' } };
    const edges = wf.edges.map((e: { from: string; to: string }) => (e.from === 'WF-1-N1' ? { ...e, to: 'WF-1-HR' } : e));
    const saved = await admin.put('/workflows/WF-1', { ...wf, nodes: [...wf.nodes, hrStep], edges: [...edges, { id: 'WF-1-EHR', from: 'WF-1-HR', to: 'WF-1-N2' }] });
    expect(saved.status).toBe(200);
    expect(await count('workflow_versions', `workflow_id = 'WF-1'`)).toBeGreaterThanOrEqual(2);

    const after = await apply(1);
    const mgr = await kabir();
    expect((await approvalOf(mgr, after.approvalId))?.chain.map((s) => s.role)).toEqual(['Requester', 'Reporting manager', 'HR']);
    expect((await approvalOf(mgr, inFlight.approvalId))?.chain.map((s) => s.role)).toEqual(['Requester', 'Reporting manager']);

    // Two steps: the manager approves, then it waits on HR.
    const step1 = await mgr.post(`/approvals/${after.approvalId}/decision`, { approve: true });
    expect([step1.body.status, step1.body.current]).toEqual(['Pending', 2]);
    const step2 = await (await ananya()).post(`/approvals/${after.approvalId}/decision`, { approve: true });
    expect(step2.body.status).toBe('Approved');

    await admin.put('/workflows/WF-1', wf); // back to the original (as a further version)
  });

  it('only Admin edits; a broken graph or a second active workflow is refused', async () => {
    const admin = await signIn('Admin');
    const wf = (await admin.get('/workflows/WF-1')).body;
    expect((await (await signIn('Employee')).get('/workflows')).status).toBe(200);
    expect((await (await signIn('Manager')).put('/workflows/WF-1', wf)).status).toBe(403);
    expect((await admin.put('/workflows/WF-1', { ...wf, nodes: wf.nodes.filter((n: { kind: string }) => n.kind !== 'Trigger') })).body.error.message).toBe('A workflow needs exactly one Trigger.');
    const other = (await admin.get('/workflows/WF-4')).body; // Regularisation
    const res = await admin.put('/workflows/WF-7', { ...(await admin.get('/workflows/WF-7')).body, status: 'Active' });
    expect(res.status).toBe(200); // Onboarding workflows may run side by side
    await admin.put('/workflows/WF-7', { ...res.body, status: 'Paused' });
    expect((await admin.put('/workflows/WF-4', { ...other, id: 'WF-4', module: 'Leave' })).status).toBe(422);
  });
});

describe('timesheets', () => {
  const WEEK = '2026-11-16';
  it('save, submit, recall, resubmit, approve: each step kept with its entries', async () => {
    const emp = await signIn('Employee');
    const project = await db.selectFrom('projectMembers as m').innerJoin('projects as p', 'p.id', 'm.projectId').select(['p.id', 'p.managerId'])
      .where('m.employeeId', '=', AARAV).where('p.status', '=', 'Active').executeTakeFirstOrThrow();
    const rows = [{ projectId: project.id, taskId: null, note: 'Build', billable: true, hours: [8, 8, 7.5, 8, 6, 0, 0] }];

    expect((await emp.put(`/timesheet-weeks/${AARAV}/2026-11-17`, { rows })).body.error.message).toBe('A timesheet week starts on a Monday.');
    expect((await emp.put(`/timesheet-weeks/E-0121/${WEEK}`, { rows })).status).toBe(403);
    expect((await emp.put(`/timesheet-weeks/${AARAV}/${WEEK}`, { rows: [{ ...rows[0], hours: [25, 0, 0, 0, 0, 0, 0] }] })).status).toBe(422);

    const saved = await emp.put(`/timesheet-weeks/${AARAV}/${WEEK}`, { rows });
    expect(saved.status).toBe(200);
    expect(saved.body.map((e: { hours: number }) => e.hours)).toEqual([8, 8, 7.5, 8, 6]);

    const submitted = await emp.post(`/timesheet-weeks/${AARAV}/${WEEK}/submit`);
    expect(submitted.body).toMatchObject({ status: 'Submitted' });
    expect(submitted.body.revisions.at(-1)).toMatchObject({ status: 'Submitted', totalHours: 37.5, billableHours: 37.5 });
    expect((await emp.put(`/timesheet-weeks/${AARAV}/${WEEK}`, { rows })).body.error.message).toBe('This week is submitted. Recall it to edit.');

    const recalled = await emp.post(`/timesheet-weeks/${AARAV}/${WEEK}/recall`);
    expect([recalled.body.status, recalled.body.approvalId]).toEqual(['Draft', null]);
    await emp.put(`/timesheet-weeks/${AARAV}/${WEEK}`, { rows: [{ ...rows[0], hours: [8, 8, 8, 8, 8, 0, 0] }] });
    const again = (await emp.post(`/timesheet-weeks/${AARAV}/${WEEK}/submit`)).body;

    // The project's manager approves.
    const pm = await db.selectFrom('users').select('email').where('employeeId', '=', project.managerId!).executeTakeFirstOrThrow();
    const approved = await (await signIn(pm.email)).post(`/approvals/${again.approvalId}/decision`, { approve: true });
    expect(approved.body).toMatchObject({ status: 'Approved', source: { kind: 'Timesheet', week: { status: 'Approved' } } });
    const week = approved.body.source.week;
    expect(week.revisions.map((r: { status: string; totalHours: number }) => [r.status, r.totalHours])).toEqual([['Submitted', 37.5], ['Submitted', 40], ['Approved', 40]]);
    expect(week.revisions[0].entries.map((e: { hours: number }) => e.hours)).toEqual([8, 8, 7.5, 8, 6]); // "as first submitted"
    expect(approved.body.source.entries.every((e: { status: string }) => e.status === 'Approved')).toBe(true);
    expect((await emp.post(`/timesheet-weeks/${AARAV}/${WEEK}/recall`)).status).toBe(409);
  });

  it('an employee sees only their own hours; a manager their team’s and their projects’', async () => {
    const emp = await signIn('Employee');
    const own = (await emp.get('/timesheet-entries?from=2026-10-01&to=2026-10-31')).body as { employeeId: string }[];
    expect(new Set(own.map((e) => e.employeeId))).toEqual(new Set([AARAV]));
    const mgr = await signIn('Manager'); // Vikram
    const seen = (await mgr.get('/timesheet-entries?from=2026-10-01&to=2026-10-31')).body as { employeeId: string; projectId: string }[];
    const managed = new Set((await db.selectFrom('projects').select('id').where('managerId', '=', 'E-0104').execute()).map((p) => p.id));
    const team = new Set(['E-0104', ...(await reportsOf(db, 'E-0104'))]); // everyone below Vikram, at any depth
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((e) => managed.has(e.projectId) || team.has(e.employeeId))).toBe(true);
    await expect((await anonymous()).get('/timesheet-entries')).resolves.toMatchObject({ status: 401 });
  });
});

describe('regularisations and profile changes', () => {
  it('a corrected day is approved by the manager; the original mark is kept', async () => {
    const emp = await signIn('Employee');
    const day = '2026-10-29';
    const before = await db.selectFrom('attendance').selectAll().where('employeeId', '=', AARAV).where('date', '=', day).executeTakeFirstOrThrow();
    expect((await emp.post('/regularisations', { date: '2026-12-01', requestedMark: 'P', reason: 'Forgot to punch' })).status).toBe(422);
    const res = await emp.post('/regularisations', { date: day, requestedMark: 'WFH', requestedIn: '09:30', requestedOut: '18:30', reason: 'Worked from home, VPN logs attached' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recorded: expect.stringContaining(before.mark), requested: 'WFH · 09:30–18:30' });
    expect((await emp.post('/regularisations', { date: day, requestedMark: 'P', reason: 'Again' })).status).toBe(409);
    const ok = await (await kabir()).post(`/approvals/${res.body.approvalId}/decision`, { approve: true });
    expect(ok.body.status).toBe('Approved');
    const after = await db.selectFrom('attendance').selectAll().where('id', '=', before.id).executeTakeFirstOrThrow();
    expect([after.mark, after.inTime, after.regularisedFrom]).toEqual(['WFH', '09:30', before.mark]);
    await db.updateTable('attendance').set({ mark: before.mark, inTime: before.inTime, outTime: before.outTime, regularisedFrom: before.regularisedFrom }).where('id', '=', before.id).execute();
  });

  it('a legal-field change waits on HR and only then changes the record', async () => {
    const emp = await signIn('Employee');
    expect((await emp.post('/me/profile-changes', { field: 'PAN', after: 'nope', reason: '' })).body.error.message).toBe('A PAN has ten characters, like ABCDE1234F.');
    const original = (await emp.get('/me')).body.employee.address;
    const res = await emp.post('/me/profile-changes', { field: 'Address', after: '7 Lake View Road, Pune', reason: 'Moved' });
    expect(res.body).toMatchObject({ field: 'Address', before: original, after: '7 Lake View Road, Pune', status: 'Pending' });
    expect((await emp.post('/me/profile-changes', { field: 'Address', after: 'Somewhere else', reason: '' })).status).toBe(409);
    expect((await emp.get('/me')).body.employee.address).toBe(original); // not yet
    const ok = await (await ananya()).post(`/approvals/${res.body.approvalId}/decision`, { approve: true });
    expect(ok.body).toMatchObject({ status: 'Approved', source: { change: { status: 'Approved' } } });
    expect((await emp.get('/me')).body.employee.address).toBe('7 Lake View Road, Pune');
    expect((await emp.get('/me/profile-changes')).body[0]).toMatchObject({ id: res.body.id, status: 'Approved' });
    await db.updateTable('employees').set({ address: original }).where('id', '=', AARAV).execute();
  });
});

describe('who sees which approvals; notifications', () => {
  it('an employee sees their own and those they decide; HR sees all', async () => {
    const emp = await signIn('Employee');
    const list = (await emp.get('/approvals')).body as { requesterId: string; chain: { approverId: string }[] }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.requesterId === AARAV || a.chain.some((s, i) => i > 0 && s.approverId === AARAV))).toBe(true);
    const hr = (await (await signIn('HR')).get('/approvals')).body;
    expect(hr.length).toBeGreaterThan(list.length);
  });

  it('the bell: one’s own notifications, and mark all read', async () => {
    const mgr = await kabir();
    const mine = (await mgr.get('/notifications')).body as { recipientId: string; read: boolean }[];
    expect(mine.every((n) => n.recipientId === KABIR)).toBe(true);
    expect((await mgr.post('/notifications/read-all')).status).toBe(204);
    expect(((await mgr.get('/notifications')).body as { read: boolean }[]).every((n) => n.read)).toBe(true);
  });
});
