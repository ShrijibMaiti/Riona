/**
 * Wave 5 done-when, part two: a closed run never changes.
 *  - the database refuses edits to a disbursed run, to frozen payslips and to the salary ledger
 *  - a correction or bonus recorded later for a closed month changes that month "as corrected" only; what was
 *    paid stays, and the money arrives in the open run
 *  - a run's inputs fix when it leaves Inputs; disbursing freezes every payslip and closes the run
 * Plus who may read and write salary, and hiring with its salary event.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { count, db, sql, sqlError } from '../helpers/db';
import { signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const CLOSED = 'PR-202610', OPEN = 'PR-202611';

describe('the database guards', () => {
  it('a disbursed run refuses UPDATE and DELETE', async () => {
    expect(await sqlError(`UPDATE payroll_runs SET disbursed_on = '2026-11-01' WHERE id = '${CLOSED}'`)).toMatch(/disbursed and closed/);
    expect(await sqlError(`DELETE FROM payroll_runs WHERE id = '${CLOSED}'`)).toMatch(/disbursed and closed/);
  });

  it('frozen payslips and the salary ledger are append-only', async () => {
    expect(await sqlError(`UPDATE payslips SET net_paise = 1 WHERE run_id = '${CLOSED}'`)).toMatch(/append-only/);
    expect(await sqlError(`DELETE FROM payslips`)).toMatch(/append-only/);
    expect(await sqlError(`UPDATE salary_events SET ctc_paise = 1`)).toMatch(/append-only/);
    expect(await sqlError(`DELETE FROM salary_events`)).toMatch(/append-only/);
  });

  it('advancing a disbursed run is refused', async () => {
    const res = await (await signIn('HR')).post(`/payroll-runs/${CLOSED}/advance`);
    expect([res.status, res.body.error.message]).toEqual([409, 'This run is already disbursed.']);
  });
});

describe('a later correction never changes what was paid', () => {
  it('a retro correction for October changes October as corrected, not as paid; it is paid as arrears in November', async () => {
    const hr = await signIn('HR');
    const emp = await signIn('Employee');
    const linesBefore = (await hr.get(`/payroll-runs/${CLOSED}/lines`)).body;
    const octBefore = (await emp.get('/me/payslips/2026-10')).body;
    const novBefore = (await emp.get('/me/payslips/2026-11')).body;

    const res = await hr.post('/employees/E-0112/salary-events', { employeeId: 'E-0112', type: 'Correction', effective: '2026-11-01', amount: 2500, appliesTo: ['2026-09', '2026-10'], component: 'HRA', note: 'HRA under-applied' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ type: 'Correction', recorded: '2026-11-06', amount: 2500, appliesTo: ['2026-09', '2026-10'], actorId: 'E-0107' });

    // October as paid: unchanged (and still the frozen slip). October as corrected: +2,500 HRA.
    const oct = (await emp.get('/me/payslips/2026-10')).body;
    expect(oct.asPaid).toEqual(octBefore.asPaid);
    expect(oct.frozen).toBe(true);
    expect(oct.corrected.gross).toBe(octBefore.corrected.gross + 2500);
    // The closed run is exactly as it was.
    expect((await hr.get(`/payroll-runs/${CLOSED}/lines`)).body).toEqual(linesBefore);
    // November, as paid, carries the arrears for both months (recorded before the 25th lock).
    const nov = (await emp.get('/me/payslips/2026-11')).body;
    expect(nov.asPaid.earnings.find((x: { key: string }) => x.key === 'arrear')).toMatchObject({ amount: 5000, label: 'HRA arrears' });
    expect(nov.asPaid.gross).toBe(novBefore.asPaid.gross + 5000);
    expect(await count('audit_log', `entity = 'Salary event' AND entity_id = '${res.body.id}'`)).toBe(1);
  });
});

describe('a run from Inputs to Disbursed', () => {
  it('fixes its inputs on leaving Inputs, freezes every payslip on disbursement, and is closed after', async () => {
    // A fresh run for December, so the seeded runs stay as they are for other tests.
    const month = '2026-12';
    await sql`INSERT INTO payroll_runs (id, month, stage, lock_date, attendance_from, attendance_to) VALUES ('PR-202612', ${month}, 'Inputs', '2026-12-25', '2026-12-01', '2026-12-01')`.execute(db);
    const hr = await signIn('HR');
    const review = (await hr.post('/payroll-runs/PR-202612/advance')).body;
    expect(review.stage).toBe('Review');
    expect(review.employeeIds.length).toBeGreaterThanOrEqual(60);
    expect(review.salaryEventIds.length).toBeGreaterThan(60);

    // Recorded after the inputs locked: not part of this run.
    const late = (await hr.post('/employees/E-0112/salary-events', { type: 'Bonus', effective: '2026-12-01', amount: 10000, note: 'Year-end' })).body;
    expect((await hr.get('/payroll-runs/PR-202612')).body.salaryEventIds).not.toContain(late.id);

    expect((await hr.post('/payroll-runs/PR-202612/advance')).body.stage).toBe('Approved');
    const live = (await hr.get('/payroll-runs/PR-202612/lines')).body;
    const notifies = await count('outbox', `topic = 'notify' AND payload->>'kind' = 'Payroll'`);
    const done = (await hr.post('/payroll-runs/PR-202612/advance')).body;
    expect([done.stage, done.disbursedOn]).toEqual(['Disbursed', '2026-11-06']);
    expect(await count('payslips', `run_id = 'PR-202612'`)).toBe(live.length);
    expect((await hr.get('/payroll-runs/PR-202612/lines')).body).toEqual(live);
    expect(await count('outbox', `topic = 'notify' AND payload->>'kind' = 'Payroll'`)).toBe(notifies + 1);
    expect(await sqlError(`UPDATE payroll_runs SET stage = 'Review' WHERE id = 'PR-202612'`)).toMatch(/disbursed and closed/);
    expect((await hr.post('/payroll-runs/PR-202612/advance')).status).toBe(409);
  });

  it('only HR and Admin move a run', async () => {
    for (const role of ['Manager', 'Employee'] as const) expect((await (await signIn(role)).post(`/payroll-runs/${OPEN}/advance`)).status, role).toBe(403);
  });
});

describe('who reads and writes salary', () => {
  it('everyone their own ledger; HR and Admin everyone’s; nobody else', async () => {
    const emp = await signIn('Employee');
    expect((await emp.get('/employees/E-0112/salary-events')).status).toBe(200);
    // Someone else's: the designation history only (Profile › Job), with no money and no notes.
    const other = (await emp.get('/employees/E-0121/salary-events')).body as Record<string, unknown>[];
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((e) => (e.type === 'Hired' || e.type === 'Promotion') && !('ctc' in e) && !('amount' in e) && e.note === '')).toBe(true);
    expect(new Set((await emp.get('/salary-events')).body.map((e: { employeeId: string }) => e.employeeId))).toEqual(new Set(['E-0112']));
    const mgr = await signIn('Manager');
    expect((await mgr.get('/employees/E-0127/salary-events')).body.some((e: Record<string, unknown>) => 'ctc' in e)).toBe(false); // a report's salary is HR's
    expect((await (await signIn('HR')).get('/employees/E-0127/salary-events')).status).toBe(200);
  });

  it('only HR and Admin record salary events, and the rules hold', async () => {
    const ev = { type: 'Bonus', effective: '2026-11-01', amount: 5000, note: '' };
    expect((await (await signIn('Manager')).post('/employees/E-0127/salary-events', ev)).status).toBe(403);
    expect((await (await signIn('Employee')).post('/employees/E-0112/salary-events', ev)).status).toBe(403);
    const hr = await signIn('HR');
    expect((await hr.post('/employees/E-0112/salary-events', { ...ev, effective: '2026-11-15' })).body.error.message).toBe('A salary change takes effect from the 1st of a month.');
    expect((await hr.post('/employees/E-0112/salary-events', { type: 'Hired', effective: '2026-11-01', ctc: 1000000, note: '' })).status).toBe(409);
    expect((await hr.post('/employees/E-0112/salary-events', { type: 'Correction', effective: '2026-11-01', amount: 100, appliesTo: ['2027-02'], component: 'HRA', note: '' })).status).toBe(422);
    expect((await hr.post('/employees/E-0112/salary-events', { type: 'Revised', effective: '2026-11-01', note: '' })).body.error.message).toBe('Enter the new annual CTC.');
  });

  it('without payroll access, the run calendar comes without who was paid', async () => {
    const runs = (await (await signIn('Employee')).get('/payroll-runs')).body;
    expect(runs.length).toBeGreaterThanOrEqual(6);
    expect(runs.every((r: { employeeIds: string[]; salaryEventIds: string[] }) => !r.employeeIds.length && !r.salaryEventIds.length)).toBe(true);
    expect((await (await signIn('Employee')).get(`/payroll-runs/${CLOSED}/lines`)).status).toBe(403);
    expect((await (await signIn('Employee')).get('/statutory-filings')).body).toEqual([]);
  });
});

describe('hiring', () => {
  it('creates the record and its hiring salary event together', async () => {
    const hr = await signIn('HR');
    const input = { name: 'Riya Kapoor', email: 'riya.kapoor@kestrel.digital', title: 'Product Designer', dept: 'Design', managerId: 'E-0104', location: 'Pune', type: 'Full-time', joined: '2026-12-01', phone: '+91 90000 11111', billable: true, billRate: 3200, ctc: 1800000 };
    const res = await hr.post('/employees', input);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ name: 'Riya Kapoor', status: 'Probation', state: 'Maharashtra', billRate: 3200 });
    const events = (await hr.get(`/employees/${res.body.id}/salary-events`)).body;
    expect(events).toEqual([expect.objectContaining({ type: 'Hired', effective: '2026-12-01', ctc: 1800000, note: 'Offer accepted · Product Designer' })]);
    expect((await hr.post('/employees', input)).status).toBe(409);
    expect((await (await signIn('Manager')).post('/employees', { ...input, email: 'x@kestrel.digital' })).status).toBe(403);
  });
});
