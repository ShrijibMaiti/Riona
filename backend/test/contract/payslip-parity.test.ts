/**
 * Wave 5 done-when, part one: a payslip computed on the server matches the frontend's "as corrected" and "as paid"
 * figures. The frontend renders payslips from the ledger it fetches (frontend/app/src/data/selectors/payroll.ts);
 * the server's engine must give the same answer from the same ledger, for every person and every month, and its
 * run lines, frozen payslips and Form 16 must match the frontend's too.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fe from '../../../frontend/app/src/data/selectors/payroll';
import { fixture } from '../helpers/golden';
import { db } from '../helpers/db';
import { signIn, testApp } from '../helpers/session';
import { loadEvents } from '../../src/engines/payroll/ledger';
import { payslip, runLine } from '../../src/engines/payroll/payslip';
import { form16Projection } from '../../src/engines/payroll/statutory/form16';
import { toEmployee } from '../../src/modules/people/employees.repo';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const TODAY = '2026-11-06';
/** JSON as the API sends it (drops undefined fields). */
const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('payslip parity', () => {
  it('the ledger in Postgres is the seed’s, event for event', async () => {
    const want = await fixture.getAllSalaryEvents();
    const got = await loadEvents(db, { ids: want.map((e) => e.id) });
    expect(json(got)).toEqual(json(want));
  });

  it('every person, every month since joining, both views: the engine equals the frontend', async () => {
    const emps = (await db.selectFrom('employees').selectAll().where('id', 'like', 'E-0%').execute()).map(toEmployee);
    const events = await loadEvents(db);
    let compared = 0;
    for (const e of emps) {
      const mine = events.filter((x) => x.employeeId === e.id);
      for (const month of fe.monthsBetween(e.joined, TODAY)) {
        for (const mode of ['corrected', 'asPaid'] as const) {
          for (const lop of [0, 1.5]) {
            expect(json(payslip(e, mine, month, mode, lop)), `${e.id} ${month} ${mode} lop ${lop}`).toEqual(json(fe.payslip(e, mine, month, mode, lop)));
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('the corrections the demo data was built around show the two views differing, as on the frontend', async () => {
    const aarav = toEmployee((await db.selectFrom('employees').selectAll().where('id', '=', 'E-0112').executeTakeFirstOrThrow()));
    const events = await loadEvents(db, { employeeIds: ['E-0112'] });
    const diffs = fe.correctionDiffs(aarav, events, aarav.joined, TODAY);
    expect(diffs.length).toBeGreaterThan(0);
    for (const { month, diff } of diffs) expect(payslip(aarav, events, month, 'corrected').net - payslip(aarav, events, month, 'asPaid').net).toBe(diff);
  });

  it('GET /me/payslips/:month gives the frontend’s figures, and the frozen slip for a paid month', async () => {
    const emp = await signIn('Employee');
    const e = (await emp.get('/me')).body.employee;
    const events = (await emp.get('/employees/E-0112/salary-events')).body;
    for (const month of ['2026-06', '2026-08', '2026-10', '2026-11']) {
      const att = (await emp.get(`/attendance?employeeId=E-0112&from=${month}-01&to=${month}-30`)).body;
      const lop = fe.lopDays(att, month);
      const res = (await emp.get('/me/payslips/' + month)).body;
      expect(res.corrected, month).toEqual(json(fe.payslip(e, events, month, 'corrected', lop)));
      expect(res.asPaid, month).toEqual(json(fe.payslip(e, events, month, 'asPaid', lop)));
      expect(res.frozen, month).toBe(month !== '2026-11'); // November is still running
    }
    expect((await emp.get('/me/payslips/2027-01')).status).toBe(404);
  });

  it('run lines: frozen for disbursed runs, live for the open one, all equal to the frontend’s', async () => {
    const hr = await signIn('HR');
    const runs = await fixture.getPayrollRuns();
    const emps = (await hr.get('/employees?pageSize=1000')).body.items;
    const events = (await hr.get('/salary-events')).body;
    for (const run of runs) {
      const att = (await hr.get(`/attendance?from=${run.attendanceFrom}&to=${run.attendanceTo}`)).body;
      const want = fe.runLines(run, emps, events, att);
      const got = (await hr.get(`/payroll-runs/${run.id}/lines`)).body;
      expect(got, run.id).toEqual(json(want));
      expect(fe.runTotals(got).net, run.id).toBe(fe.runTotals(want).net);
    }
    // The engine's own run line, too.
    const r = runs[1];
    const aarav = emps.find((x: { id: string }) => x.id === 'E-0112');
    expect(json(runLine(aarav, events.filter((x: { id: string; employeeId: string }) => x.employeeId === 'E-0112' && r.salaryEventIds.includes(x.id)), r.month, 0)))
      .toEqual(json(fe.runLines({ ...r, employeeIds: ['E-0112'], attendanceFrom: '1900-01-01', attendanceTo: '1900-01-01' }, emps, events, [])[0]));
  });

  it('Form 16: the server’s projection equals the frontend’s', async () => {
    const emp = await signIn('Employee');
    const e = (await emp.get('/me')).body.employee;
    const events = (await emp.get('/employees/E-0112/salary-events')).body;
    const res = (await emp.get('/me/form16?fy=2026')).body;
    expect(res).toEqual({ fy: '2026-27', ...json(fe.form16Projection(e, events, TODAY, '2026-04-01', '2027-03-31')) });
    expect(form16Projection(e, events, TODAY, '2026-04-01', '2027-03-31')).toEqual(fe.form16Projection(e, events, TODAY, '2026-04-01', '2027-03-31'));
  });
});
