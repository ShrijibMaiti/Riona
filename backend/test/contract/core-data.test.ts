/**
 * Wave 3: the core data the whole app reads, from Postgres.
 *  - parity: as Admin (who sees everything), every endpoint returns exactly what the frontend's in-memory fixture
 *    returns for the same request, so screens show the same numbers on either data source
 *  - scoping: personal records (attendance, leave) by own / team / all; personal details only for HR, Admin, self
 *  - writes: HR edits, the audited bank reveal, self-service profile, task changes, all audited
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fixture } from '../helpers/golden';
import { HISTORY_FROM, TODAY } from '../../db/seed/demo/calendar';
import { count, db, sql } from '../helpers/db';
import { anonymous, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
/** Only the records the seed created (other test files add a few, e.g. the setup wizard's owner). */
const seeded = async <T extends { id: string }>(xs: T[], ids: Promise<{ id: string }[]> | { id: string }[]) => {
  const keep = new Set((await ids).map((x) => x.id));
  return byId(xs.filter((x) => keep.has(x.id)));
};

describe('parity with the frontend fixture (as Admin)', () => {
  it('employees: list, filters, search, one record', async () => {
    const admin = await signIn('Admin');
    const all = (await fixture.getEmployees({})).items;
    const res = await admin.get('/employees?pageSize=1000');
    expect(res.status).toBe(200);
    expect(await seeded(res.body.items, all)).toEqual(byId(all));

    for (const f of [{ dept: 'Engineering' }, { location: 'Pune' }, { status: 'Probation' }, { managerId: 'E-0118' }, { type: 'Contract' }, { search: 'mehta' }] as Record<string, string>[]) {
      const want = (await fixture.getEmployees(f)).items.map((e) => e.id).sort();
      const got = (await admin.get('/employees?' + new URLSearchParams(f))).body.items.map((e: { id: string }) => e.id).sort();
      expect(got, JSON.stringify(f)).toEqual(want);
    }
    expect((await admin.get('/employees/E-0112')).body).toEqual(await fixture.getEmployee('E-0112'));
    expect((await admin.get('/employees/E-9999')).status).toBe(404);
  });

  it('employees: pagination and sorting', async () => {
    const admin = await signIn('Admin');
    const p1 = (await admin.get('/employees?page=1&pageSize=10&sort=joined&dir=desc')).body;
    const p2 = (await admin.get('/employees?page=2&pageSize=10&sort=joined&dir=desc')).body;
    expect([p1.items.length, p1.page, p1.pageSize, p1.total >= 60]).toEqual([10, 1, 10, true]);
    const joined = [...p1.items, ...p2.items].map((e: { joined: string }) => e.joined);
    expect(joined).toEqual([...joined].sort().reverse());
    expect(new Set([...p1.items, ...p2.items].map((e: { id: string }) => e.id)).size).toBe(20);
  });

  it('empty filters (?dept=&search=) mean no filter, as the frontend sends them', async () => {
    const admin = await signIn('Admin');
    const res = await admin.get('/employees?dept=&search=&status=&page=&pageSize=');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(60);
  });

  it('attendance, holidays, leave types, leave requests', async () => {
    const admin = await signIn('Admin');
    const att = await fixture.getAttendance({ from: HISTORY_FROM, to: TODAY });
    expect(byId((await admin.get(`/attendance?from=${HISTORY_FROM}&to=${TODAY}`)).body)).toEqual(byId(att));
    const one = await fixture.getAttendance({ employeeId: 'E-0121', from: '2026-11-01', to: TODAY });
    expect((await admin.get(`/attendance?employeeId=E-0121&from=2026-11-01&to=${TODAY}`)).body).toEqual(one);
    expect((await admin.get('/holidays')).body).toEqual(await fixture.getHolidays());
    expect(byId((await admin.get('/leave-types')).body.map((l: { code: string }) => ({ ...l, id: l.code })))).toEqual(byId((await fixture.getLeaveTypes()).map((l) => ({ ...l, id: l.code }))));
    const leave = await fixture.getLeaveRequests();
    expect(await seeded((await admin.get('/leave-requests')).body, leave)).toEqual(byId(leave));
    const pending = await fixture.getLeaveRequests({ status: 'Pending', from: '2026-11-01', to: '2026-11-30' });
    expect(await seeded((await admin.get('/leave-requests?status=Pending&from=2026-11-01&to=2026-11-30')).body, pending)).toEqual(byId(pending));
  });

  it('clients, projects, tasks', async () => {
    const admin = await signIn('Admin');
    expect(byId((await admin.get('/clients')).body)).toEqual(byId(await fixture.getClients()));
    expect((await admin.get('/clients/C-31')).body).toEqual(await fixture.getClient('C-31'));
    expect(byId((await admin.get('/projects')).body.items)).toEqual(byId((await fixture.getProjects()).items));
    for (const f of [{ clientId: 'C-11' }, { managerId: 'E-0104' }, { status: 'Active' }, { memberId: 'E-0112' }, { search: 'portal' }] as Record<string, string>[]) {
      const want = (await fixture.getProjects(f)).items.map((p) => p.id).sort();
      const got = (await admin.get('/projects?' + new URLSearchParams(f))).body.items.map((p: { id: string }) => p.id).sort();
      expect(got, JSON.stringify(f)).toEqual(want);
    }
    expect((await admin.get('/projects/P-214')).body).toEqual(await fixture.getProject('P-214'));
    expect(byId((await admin.get('/tasks')).body)).toEqual(byId(await fixture.getTasks()));
    expect(byId((await admin.get('/tasks?projectId=P-214&status=done')).body)).toEqual(byId(await fixture.getTasks({ projectId: 'P-214', status: 'done' })));
    const t = (await fixture.getTasks({ projectId: 'P-214' }))[0];
    expect((await admin.get('/tasks/' + t.id)).body).toEqual(t);
  });
});

describe('scoping', () => {
  it('needs a session', async () => {
    const anon = await anonymous();
    for (const path of ['/employees', '/attendance?from=2026-11-01&to=2026-11-06', '/leave-requests', '/clients', '/projects', '/tasks']) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });

  it('everyone sees the directory; personal details only for HR, Admin and the person', async () => {
    const emp = await signIn('Employee');
    const list = (await emp.get('/employees?pageSize=1000')).body.items as { id: string; pan: string; dob: string; bank: { accountLast4: string }; phone: string }[];
    expect(list.length).toBeGreaterThanOrEqual(60);
    const me = list.find((e) => e.id === 'E-0112')!, other = list.find((e) => e.id === 'E-0121')!;
    expect(me.pan).not.toBe('');
    expect(me.bank.accountLast4).toHaveLength(4);
    expect([other.pan, other.dob, other.bank.accountLast4]).toEqual(['', '', '']);
    expect(other.phone).not.toBe(''); // work contact stays visible
    const hr = await signIn('HR');
    expect((await hr.get('/employees/E-0121')).body.pan).not.toBe('');
    const mgr = await signIn('Manager');
    expect((await mgr.get('/employees/E-0127')).body.pan).toBe(''); // a manager's report: still HR's to see
  });

  it('attendance and leave: own for an employee, the team for a manager, everyone for HR', async () => {
    const range = `from=2026-11-02&to=${TODAY}`;
    const ids = async (c: Awaited<ReturnType<typeof signIn>>, path: string) => [...new Set(((await c.get(path)).body as { employeeId: string }[]).map((x) => x.employeeId))].sort();

    const emp = await signIn('Employee');
    expect(await ids(emp, '/attendance?' + range)).toEqual(['E-0112']);
    expect((await emp.get('/attendance?employeeId=E-0121&' + range)).body).toEqual([]);
    expect((await ids(emp, '/leave-requests')).every((x) => x === 'E-0112')).toBe(true);

    const team = (await sql<{ id: string }>`
      WITH RECURSIVE t AS (SELECT id FROM employees WHERE manager_id = 'E-0104' UNION SELECT e.id FROM employees e JOIN t ON e.manager_id = t.id)
      SELECT id FROM t`.execute(db)).rows.map((r) => r.id);
    const mgr = await signIn('Manager');
    expect(await ids(mgr, '/attendance?' + range)).toEqual(['E-0104', ...team].sort());
    expect((await mgr.get('/attendance?employeeId=E-0112&' + range)).body).toEqual([]);

    const hr = await signIn('HR');
    expect((await ids(hr, '/attendance?' + range)).length).toBeGreaterThanOrEqual(55);
  });

  it('refuses a backwards date range', async () => {
    const res = await (await signIn('HR')).get('/attendance?from=2026-11-06&to=2026-11-01');
    expect([res.status, res.body.error.message]).toEqual([422, 'The end date is before the start date.']);
  });
});

describe('employee writes', () => {
  it('HR edits a record; the change is audited field by field', async () => {
    const hr = await signIn('HR');
    const before = (await hr.get('/employees/E-0139')).body;
    const res = await hr.patch('/employees/E-0139', { title: 'Staff Engineer', location: 'Pune' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Staff Engineer', location: 'Pune' });
    const entry = await db.selectFrom('auditLog').selectAll().where('entityId', '=', 'E-0139').where('action', '=', 'Updated').orderBy('seq', 'desc').executeTakeFirstOrThrow();
    expect(entry).toMatchObject({ actorId: 'E-0107', entity: 'Employee' });
    expect(entry.changes).toEqual(expect.arrayContaining([
      { field: 'title', before: before.title, after: 'Staff Engineer' },
      { field: 'location', before: before.location, after: 'Pune' },
    ]));
    await hr.patch('/employees/E-0139', { title: before.title, location: before.location });
  });

  it('only HR and Admin edit records', async () => {
    for (const role of ['Employee', 'Manager'] as const) {
      expect((await (await signIn(role)).patch('/employees/E-0139', { title: 'Nope' })).status, role).toBe(403);
    }
  });

  it('keeps the reporting tree sound', async () => {
    const admin = await signIn('Admin');
    // Aarav reports (through Kabir) to Dipak, so Dipak can't report to Aarav.
    expect((await admin.patch('/employees/E-0100', { managerId: 'E-0112' })).body.error.message).toMatch(/reporting loop/);
    expect((await admin.patch('/employees/E-0112', { managerId: 'E-0112' })).status).toBe(422);
    expect((await admin.patch('/employees/E-0112', { managerId: 'E-9999' })).status).toBe(422);
    expect((await admin.patch('/employees/E-0112', { email: 'dipak.sharma@kestrel.digital' })).status).toBe(409);
    expect((await admin.patch('/employees/E-0112', { dept: 'Astronomy' })).status).toBe(422);
  });

  it('bank reveal: HR and the person, audited; nobody else', async () => {
    const hr = await signIn('HR');
    const reveals = await count('audit_log', `action = 'Revealed' AND entity_id = 'E-0112'`);
    const res = await hr.post('/employees/E-0112/bank/reveal');
    expect(res.body.account).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(await count('audit_log', `action = 'Revealed' AND entity_id = 'E-0112'`)).toBe(reveals + 1);
    const emp = await signIn('Employee');
    expect((await emp.post('/employees/E-0112/bank/reveal')).status).toBe(200);
    expect((await emp.post('/employees/E-0121/bank/reveal')).status).toBe(403);
  });

  it('self-service profile: validated, applied at once, audited', async () => {
    const emp = await signIn('Employee');
    const bad = await emp.patch('/me/profile', { phone: '12' });
    expect([bad.status, bad.body.error.message]).toEqual([422, 'Enter a phone number with at least eight digits.']);
    const before = (await emp.get('/me')).body.employee.phone;
    const ok = await emp.patch('/me/profile', { phone: '+91 98450 22222', bloodGroup: 'O+' });
    expect(ok.body).toMatchObject({ id: 'E-0112', phone: '+91 98450 22222', bloodGroup: 'O+' });
    expect(await count('audit_log', `entity_id = 'E-0112' AND changes @> '[{"field":"phone"}]'`)).toBeGreaterThan(0);
    await emp.patch('/me/profile', { phone: before });
  });
});

describe('task writes', () => {
  it('the team moves a task; someone off the project can’t', async () => {
    const t = (await db.selectFrom('tasks').select(['id', 'projectId', 'status']).where('projectId', '=', 'P-214').executeTakeFirstOrThrow());
    const mgr = await signIn('Manager'); // Vikram manages P-214
    const moved = await mgr.patch('/tasks/' + t.id, { status: 'review' });
    expect([moved.status, moved.body.status]).toEqual([200, 'review']);
    expect(await count('audit_log', `entity = 'Task' AND entity_id = '${t.id}'`)).toBeGreaterThan(0);

    const offProject = await db
      .selectFrom('tasks').select(['id']).where('assigneeId', '!=', 'E-0112')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('projectMembers').select('projectId').whereRef('projectMembers.projectId', '=', 'tasks.projectId').where('employeeId', '=', 'E-0112'))))
      .executeTakeFirstOrThrow();
    const emp = await signIn('Employee');
    expect((await emp.patch('/tasks/' + offProject.id, { status: 'done' })).status).toBe(403);
    await mgr.patch('/tasks/' + t.id, { status: t.status });
  });

  it('the assignee ticks their own task and its subtasks', async () => {
    const t = await db.selectFrom('tasks').select(['id', 'status', 'subtasks']).where('assigneeId', '=', 'E-0112').executeTakeFirstOrThrow();
    const emp = await signIn('Employee');
    const subtasks = (t.subtasks as { id: string; title: string; done: boolean }[]).map((s) => ({ ...s, done: true }));
    const res = await emp.patch('/tasks/' + t.id, { subtasks });
    expect(res.status).toBe(200);
    expect(res.body.subtasks.every((s: { done: boolean }) => s.done)).toBe(true);
  });

  it('creates a task with the next number, and tells the assignee', async () => {
    const mgr = await signIn('Manager');
    const outbox = await count('outbox', `topic = 'notify'`);
    const res = await mgr.post('/projects/P-214/tasks', { title: 'Write the runbook', assigneeId: 'E-0127', due: '2026-11-20', priority: 'High', estimateHours: 4 });
    expect(res.status).toBe(200);
    const nums = (await db.selectFrom('tasks').select('id').where('projectId', '=', 'P-214').execute()).map((x) => +x.id.split('-').pop()!);
    expect(+res.body.id.split('-').pop()).toBe(Math.max(...nums));
    expect(res.body).toMatchObject({ projectId: 'P-214', status: 'todo', assigneeId: 'E-0127', created: TODAY, comments: [], subtasks: [] });
    expect(await count('outbox', `topic = 'notify'`)).toBe(outbox + 1);
    expect((await mgr.post('/projects/P-214/tasks', { title: '', assigneeId: 'E-0127', due: '2026-11-20' })).status).toBe(422);
    expect((await mgr.post('/projects/P-999/tasks', { title: 'x', assigneeId: 'E-0127', due: '2026-11-20' })).status).toBe(404);
  });

  it('comments append with the author from the session', async () => {
    const emp = await signIn('Employee');
    const t = await db.selectFrom('tasks').select(['id']).where('assigneeId', '=', 'E-0112').executeTakeFirstOrThrow();
    const before = (await emp.get('/tasks/' + t.id)).body.comments.length;
    const res = await emp.post(`/tasks/${t.id}/comments`, { text: 'Picked this up.', authorId: 'E-0100' });
    expect(res.body.comments).toHaveLength(before + 1);
    expect(res.body.comments.at(-1)).toMatchObject({ authorId: 'E-0112', text: 'Picked this up.' });
    expect(res.body.comments.at(-1).at).toMatch(/^2026-11-06T11:00:00\+05:30$/);
  });
});
