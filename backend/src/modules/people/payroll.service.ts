/**
 * Salary and payroll, as the API serves them.
 *  - The salary ledger of other people is for HR and Admin; everyone sees their own (My Space › Payslips).
 *  - Payroll runs, structures and filings are HR's and Admin's. Other roles see the run calendar (month, stage,
 *    dates) without who was paid, for their dashboard.
 *  - Payslips: /me/payslips/:month gives one's own, both views; a disbursed month's "as paid" is the frozen one.
 */
import type { Employee, PayrollRun, SalaryEvent, SalaryStructure, StatutoryFiling } from '@riona/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize, authorizeRecord, can, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { fiscalYear, firstOfMonth, today } from '../../lib/dates';
import { toPaise } from '../../lib/money';
import { F } from '../../lib/validate';
import { appendSalaryEvent, loadEvents, type NewSalaryEventInput } from '../../engines/payroll/ledger';
import { advanceRun, getRunRow, linesOf, toRun } from '../../engines/payroll/run';
import { lopDays, payslip, runLine } from '../../engines/payroll/payslip';
import { form16Projection } from '../../engines/payroll/statutory/form16';
import { nextYm } from '../../engines/payroll/lock';
import { findEmployeeRow, toEmployee } from './employees.repo';
import { present } from './employees.service';

// ---------------- the salary ledger ----------------

/**
 * GET /employees/:id/salary-events — one's own ledger, or anyone's for HR and Admin. Anyone else gets the
 * designation history only (the Profile › Job tab): hires and promotions with their titles and dates, and no
 * money or notes.
 */
export async function getSalaryEvents(actor: Actor, employeeId: string): Promise<SalaryEvent[]> {
  if (employeeId === actor.employeeId || can(actor, 'salary', 'view')) {
    if (employeeId !== actor.employeeId) await authorizeRecord(db, actor, 'salary', 'view', employeeId, 'that person’s salary');
    return loadEvents(db, { employeeIds: [employeeId] });
  }
  authorize(actor, 'directory', 'view');
  return (await loadEvents(db, { employeeIds: [employeeId] }))
    .filter((e) => e.type === 'Hired' || e.type === 'Promotion')
    .map((e) => ({ id: e.id, employeeId: e.employeeId, type: e.type, effective: e.effective, recorded: e.recorded, actorId: '', note: '', ...(e.title ? { title: e.title } : {}) }));
}

/** GET /salary-events — every ledger for HR and Admin; one's own for anyone else. */
export async function getAllSalaryEvents(actor: Actor): Promise<SalaryEvent[]> {
  if (can(actor, 'salary', 'edit')) return loadEvents(db);
  return actor.employeeId ? loadEvents(db, { employeeIds: [actor.employeeId] }) : [];
}

/** POST /employees/:id/salary-events — HR and Admin. */
export async function addSalaryEvent(actor: Actor, employeeId: string, input: NewSalaryEventInput): Promise<SalaryEvent> {
  authorize(actor, 'salary', 'edit');
  return withTransaction(actor, (tx) => appendSalaryEvent(tx, employeeId, input));
}

// ---------------- payroll runs ----------------

/** GET /payroll-runs — newest first. Without payroll access: the calendar only, not who was paid. */
export async function listRuns(actor: Actor): Promise<PayrollRun[]> {
  const runs = (await db.selectFrom('payrollRuns').selectAll().orderBy('month', 'desc').execute()).map(toRun);
  if (can(actor, 'payroll', 'view')) return runs;
  return runs.map((r) => ({ ...r, employeeIds: [], salaryEventIds: [], bankFileIssues: [] }));
}

export async function getRun(actor: Actor, id: string): Promise<PayrollRun> {
  authorize(actor, 'payroll', 'view');
  return getRunRow(db, id);
}

/** GET /payroll-runs/:id/lines — every person's line: frozen once disbursed, computed before that. */
export async function getRunLines(actor: Actor, id: string) {
  authorize(actor, 'payroll', 'view');
  return linesOf(db, await getRunRow(db, id));
}

/** POST /payroll-runs/:id/advance — HR and Admin. */
export async function advance(actor: Actor, id: string): Promise<PayrollRun> {
  authorize(actor, 'payroll', 'approve');
  return withTransaction(actor, (tx) => advanceRun(tx, id));
}

// ---------------- structures and filings ----------------

export const StructureInput = z.object({
  id: z.string().min(1).max(40),
  name: F.text(120).min(1, 'Give the structure a name.'),
  appliesTo: F.text(200),
  components: z.array(z.object({
    id: z.string().min(1).max(40), name: F.text(120).min(1, 'Name every component.'),
    kind: z.enum(['Earning', 'Deduction', 'Employer contribution']), formula: F.text(200).min(1, 'Every component needs a formula.'), taxable: z.boolean(),
  })).min(1).max(40),
}).strip();

/** GET /salary-structures — the component formulas (no one's pay), readable by all staff; HR and Admin edit them. */
export async function getStructures(actor: Actor): Promise<SalaryStructure[]> {
  authorize(actor, 'directory', 'view');
  const rows = await db.selectFrom('salaryStructures').selectAll().orderBy('id').execute();
  return rows.map((s) => ({ id: s.id, name: s.name, appliesTo: s.appliesTo, components: s.components as SalaryStructure['components'] }));
}

export async function saveStructure(actor: Actor, id: string, s: z.infer<typeof StructureInput>): Promise<SalaryStructure> {
  authorize(actor, 'salary', 'edit');
  if (s.id !== id) throw unprocessable('The structure id doesn’t match the address.');
  return withTransaction(actor, async (tx) => {
    const cur = await tx.db.selectFrom('salaryStructures').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Structure not found');
    await tx.db.updateTable('salaryStructures').set({ name: s.name, appliesTo: s.appliesTo, components: JSON.stringify(s.components) }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Salary structure', id, [{ field: 'components', before: String((cur.components as unknown[]).length), after: String(s.components.length) }]);
    return s;
  });
}

export async function getFilings(actor: Actor): Promise<StatutoryFiling[]> {
  if (!can(actor, 'payroll', 'view')) return [];
  const rows = await db.selectFrom('statutoryFilings').selectAll().orderBy('due').orderBy('id').execute();
  return rows.map((f) => ({ id: f.id, kind: f.kind as StatutoryFiling['kind'], period: f.period, due: f.due, filedOn: f.filedOn, reference: f.reference }));
}

// ---------------- one's own payslips ----------------

const Month = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-10.');

/** GET /me/payslips/:month — both views of one's own payslip. A disbursed month's "as paid" is the frozen slip. */
export async function myPayslip(actor: Actor, monthRaw: string) {
  const me = selfId(actor);
  const month = Month.parse(monthRaw);
  const e = toEmployee((await findEmployeeRow(db, me))!);
  if (month < e.joined.slice(0, 7) || month > today().slice(0, 7)) throw notFound('There’s no payslip for that month.');
  const events = await loadEvents(db, { employeeIds: [me] });
  const att = await db.selectFrom('attendance').select(['date', 'mark']).where('employeeId', '=', me).where('date', '>=', month + '-01').where('date', '<', nextYm(month) + '-01').execute();
  const lop = lopDays(att as never, month);
  const frozen = await db.selectFrom('payslips').select('slip').where('employeeId', '=', me).where('month', '=', month).executeTakeFirst();
  const asPaid = frozen ? (frozen.slip as unknown as ReturnType<typeof runLine>).slip : payslip(e, events, month, 'asPaid', lop);
  return { month, lop, frozen: !!frozen, corrected: payslip(e, events, month, 'corrected', lop), asPaid };
}

/** GET /me/form16?fy=2026 — Form 16 Part B for a financial year (the current one by default). */
export async function myForm16(actor: Actor, fyStartYear?: string) {
  const me = selfId(actor);
  const start = fyStartYear && /^\d{4}$/.test(fyStartYear) ? +fyStartYear : fiscalYear(today()).startYear;
  const e = toEmployee((await findEmployeeRow(db, me))!);
  return { fy: `${start}-${String(start + 1).slice(2)}`, ...form16Projection(e, await loadEvents(db, { employeeIds: [me] }), today(), `${start}-04-01`, `${start + 1}-03-31`) };
}

// ---------------- hiring ----------------

const STATE_OF: Record<string, string> = { Bengaluru: 'Karnataka', Pune: 'Maharashtra', Mumbai: 'Maharashtra', Kochi: 'Kerala', Kolkata: 'West Bengal', Chennai: 'Tamil Nadu', Remote: 'Karnataka' };

/** POST /employees — the record and its hiring salary event, together. */
export const NewEmployee = z.object({
  name: F.text(120).min(1, 'Enter a name.'),
  email: z.string().trim().email('Enter a valid work email.'),
  title: F.text(120).min(1, 'Enter a job title.'),
  dept: z.enum(['Leadership', 'Engineering', 'Delivery', 'Design', 'Sales', 'Operations', 'People', 'Finance'], { errorMap: () => ({ message: 'Choose a department.' }) }),
  managerId: z.string().max(40).nullable(),
  location: F.text(60).min(1, 'Choose a location.'),
  type: z.enum(['Full-time', 'Contract', 'Intern']),
  joined: F.date,
  phone: F.text(30).default(''),
  billable: z.boolean().default(false),
  billRate: z.number().min(0).max(1_000_000).default(0),
  ctc: z.number({ required_error: 'Enter the annual CTC.', invalid_type_error: 'Enter the annual CTC.' }).positive('Enter the annual CTC.').max(1e9),
});

export async function createEmployee(actor: Actor, input: z.infer<typeof NewEmployee>): Promise<Employee> {
  authorize(actor, 'employees', 'edit');
  authorize(actor, 'salary', 'edit');
  return withTransaction(actor, async (tx) => {
    if (await tx.db.selectFrom('employees').select('id').where(sql`lower(email)`, '=', input.email.toLowerCase()).executeTakeFirst()) throw conflict('Someone already uses that email.');
    if (input.managerId && !(await findEmployeeRow(tx.db, input.managerId))) throw unprocessable('Choose a manager from the directory.', { managerId: 'Unknown' });
    // Readable, sequential staff numbers like the seed's E-0166 (taken under a lock, so two hires can't collide).
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.employee-ids'))`.execute(tx.db);
    const last = await tx.db.selectFrom('employees').select(sql<number>`max(substring(id from 3)::int)`.as('n')).where('id', '~', '^E-\\d+$').executeTakeFirst();
    const id = 'E-' + String((last?.n ?? 100) + 1).padStart(4, '0');
    await tx.db.insertInto('employees').values({
      id, name: input.name, email: input.email, title: input.title, dept: input.dept, managerId: input.managerId, location: input.location,
      state: STATE_OF[input.location] ?? 'Karnataka', type: input.type, status: 'Probation', joined: input.joined, phone: input.phone,
      billable: input.billable, billRatePaise: toPaise(input.billRate), confirmationDue: input.joined,
    }).execute();
    await tx.audit('Created', 'Employee', id, [{ field: 'name', before: null, after: input.name }]);
    await appendSalaryEvent(tx, id, { type: 'Hired', effective: firstOfMonth(input.joined), ctc: input.ctc, note: 'Offer accepted · ' + input.title, title: input.title });
    return present(actor, toEmployee((await findEmployeeRow(tx.db, id))!));
  });
}
