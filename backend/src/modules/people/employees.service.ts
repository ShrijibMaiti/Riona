/**
 * Employees: the directory (everyone), the full HR record (HR, Admin, and each person for themselves), HR edits,
 * the audited bank-account reveal, and the self-service profile fields.
 *
 * Personal details (date of birth, personal email, address, bank, PAN, UAN) leave the API only for HR, Admin and
 * the person themselves — the same rule the Profile screen uses to show them. Everyone else gets them blank.
 */
import type { Employee, Paginated } from '@riona/shared';
import { sql } from 'kysely';
import type { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize, can, selfId } from '../../auth/rbac/authorize';
import { reportsOf } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { diff } from '../../engines/audit/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { toPaise } from '../../lib/money';
import { findEmployeeRow, toEmployee } from './employees.repo';
import type { EmployeeFilter, EmployeePatch, SelfServicePatch } from './employees.schema';

/** May this actor see this person's personal details? */
export const seesPersonal = (actor: Actor, employeeId: string) => can(actor, 'employees', 'edit') || actor.employeeId === employeeId;

export function present(actor: Actor, e: Employee): Employee {
  if (seesPersonal(actor, e.id)) return e;
  return { ...e, dob: '', personalEmail: '', address: '', pan: '', uan: '', bank: { name: '', ifsc: '', accountLast4: '' } };
}

export async function listEmployees(actor: Actor, f: z.infer<typeof EmployeeFilter>): Promise<Paginated<Employee>> {
  authorize(actor, 'directory', 'view');
  const page = f.page ?? 1, pageSize = f.pageSize ?? 1000;
  let q = db.selectFrom('employees');
  if (f.search?.trim()) {
    const like = '%' + f.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    q = q.where(sql<boolean>`lower(name || ' ' || id || ' ' || title || ' ' || dept || ' ' || email) LIKE ${like}`);
  }
  if (f.dept) q = q.where('dept', '=', f.dept);
  if (f.location) q = q.where('location', '=', f.location);
  if (f.status) q = q.where('status', '=', f.status);
  if (f.managerId) q = q.where('managerId', '=', f.managerId);
  if (f.type) q = q.where('type', '=', f.type);
  const total = (await q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst())?.n ?? 0;
  const rows = await q.selectAll().orderBy(f.sort ?? 'name', f.dir ?? 'asc').orderBy('id').limit(pageSize).offset((page - 1) * pageSize).execute();
  return { items: rows.map((r) => present(actor, toEmployee(r))), total, page, pageSize };
}

export async function getEmployee(actor: Actor, id: string): Promise<Employee> {
  authorize(actor, 'directory', 'view');
  const row = await findEmployeeRow(db, id);
  if (!row) throw notFound('Employee not found');
  return present(actor, toEmployee(row));
}

const AUDITED = ['name', 'email', 'personalEmail', 'phone', 'title', 'dept', 'managerId', 'location', 'state', 'type', 'status', 'joined', 'dob',
  'bloodGroup', 'maritalStatus', 'address', 'emergency', 'pan', 'uan', 'billable', 'billRate', 'noticeDays', 'confirmationDue'] as const;

/** PATCH /employees/:id — HR and Admin. */
export async function updateEmployee(actor: Actor, id: string, patch: z.infer<typeof EmployeePatch>): Promise<Employee> {
  authorize(actor, 'employees', 'edit');
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('employees').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Employee not found');
    const before = toEmployee(row);

    if (patch.managerId !== undefined && patch.managerId !== null) {
      if (patch.managerId === id) throw unprocessable('Someone can’t report to themselves.', { managerId: 'Not allowed' });
      if (!(await findEmployeeRow(tx.db, patch.managerId))) throw unprocessable('Choose a manager from the directory.', { managerId: 'Unknown' });
      if ((await reportsOf(tx.db, id)).includes(patch.managerId)) throw unprocessable('That would make a reporting loop: they already report to this person.', { managerId: 'Loop' });
    }
    if (patch.email !== undefined && patch.email.toLowerCase() !== row.email.toLowerCase()) {
      const taken = await tx.db.selectFrom('employees').select('id').where(sql`lower(email)`, '=', patch.email.toLowerCase()).where('id', '!=', id).executeTakeFirst();
      if (taken) throw conflict('Someone already uses that email.');
    }

    const { billRate, dob, emergency, ...rest } = patch;
    const set = {
      ...rest,
      ...(billRate !== undefined ? { billRatePaise: toPaise(billRate) } : {}),
      ...(dob !== undefined ? { dob: dob || null } : {}),
      ...(emergency !== undefined ? { emergency: JSON.stringify(emergency) } : {}),
    };
    if (Object.keys(set).length) await tx.db.updateTable('employees').set(set).where('id', '=', id).execute();
    const after = toEmployee((await findEmployeeRow(tx.db, id))!);
    const changes = diff(before, after, [...AUDITED]);
    if (changes.length) await tx.audit('Updated', 'Employee', id, changes);
    return present(actor, after);
  });
}

/** POST /employees/:id/bank/reveal — the full account number, for HR, Admin and the person. Every reveal is audited. */
export async function revealBankAccount(actor: Actor, id: string): Promise<{ account: string }> {
  authorize(actor, 'directory', 'view');
  if (!seesPersonal(actor, id)) throw forbidden();
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('employees').select(['bankAccount']).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Employee not found');
    await tx.audit('Revealed', 'Bank account', id);
    return { account: row.bankAccount.replace(/(.{4})(?=.)/g, '$1 ') };
  });
}

/** PATCH /me/profile — phone, personal email, blood group and emergency contact apply at once and are audited. */
export async function updateMyProfile(actor: Actor, patch: z.infer<typeof SelfServicePatch>): Promise<Employee> {
  const id = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('employees').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
    const before = toEmployee(row);
    const { emergency, ...rest } = patch;
    const set = { ...rest, ...(emergency ? { emergency: JSON.stringify(emergency) } : {}) };
    if (Object.keys(set).length) await tx.db.updateTable('employees').set(set).where('id', '=', id).execute();
    const after = toEmployee((await findEmployeeRow(tx.db, id))!);
    const changes = diff(before, after, ['phone', 'personalEmail', 'bloodGroup', 'emergency']);
    if (changes.length) await tx.audit('Updated', 'Employee', id, changes);
    return after;
  });
}
