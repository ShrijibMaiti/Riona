/**
 * GET /me: the session as the frontend needs it. The person, their role, the organisation, and the server's
 * clock (today, now, time zone) plus the start of recorded history. Screens read all of these from here.
 */
import type { Employee } from '@riona/shared';
import { config } from '../../config';
import { db } from '../../db/client';
import { forbidden } from '../../lib/errors';
import { nowZoned, today } from '../../lib/dates';
import type { Actor } from '../../http/plugins/session';
import { findEmployeeRow, toEmployee } from '../people/employees.repo';

export type Me = {
  employee: Employee;
  role: 'Admin' | 'HR' | 'Manager' | 'Employee';
  orgName: string;
  today: string;
  now: string;
  timeZone: string;
  historyFrom: string;
};

export async function getOrg() {
  return db.selectFrom('org').selectAll().executeTakeFirst();
}

export async function getMe(actor: Actor): Promise<Me> {
  if (actor.role === 'Client' || !actor.employeeId) throw forbidden('Use the client portal to sign in.');
  const [row, org] = await Promise.all([findEmployeeRow(db, actor.employeeId), getOrg()]);
  if (!row) throw forbidden('This account isn’t linked to an employee record.');
  const tz = org?.timeZone ?? config.timeZone;
  return {
    employee: toEmployee(row),
    role: actor.role,
    orgName: org?.name ?? 'Riona',
    today: today(tz),
    now: nowZoned(tz),
    timeZone: tz,
    historyFrom: org?.historyFrom ?? today(tz),
  };
}