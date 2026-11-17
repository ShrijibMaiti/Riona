/**
 * Reading employee rows and shaping them as the API's Employee. Wave 1 needs one record (GET /me); the list,
 * filters and per-role redaction arrive with the directory in Wave 3.
 */
import type { Employee } from '@riona/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB, Employees } from '../../db/schema';

export type EmployeeRow = Selectable<Employees>;

export function toEmployee(r: EmployeeRow): Employee {
  const emergency = (r.emergency ?? {}) as Partial<Employee['emergency']>;
  return {
    id: r.id, name: r.name, email: r.email, personalEmail: r.personalEmail, phone: r.phone, title: r.title,
    dept: r.dept as Employee['dept'], managerId: r.managerId, location: r.location, state: r.state,
    type: r.type as Employee['type'], status: r.status as Employee['status'], joined: r.joined, dob: r.dob ?? '',
    bloodGroup: r.bloodGroup, maritalStatus: r.maritalStatus as Employee['maritalStatus'], address: r.address,
    emergency: { name: emergency.name ?? '', relation: emergency.relation ?? '', phone: emergency.phone ?? '' },
    bank: { name: r.bankName, ifsc: r.bankIfsc, accountLast4: r.bankAccount.slice(-4) },
    pan: r.pan, uan: r.uan, billable: r.billable, billRate: r.billRatePaise / 100,
    noticeDays: r.noticeDays, confirmationDue: r.confirmationDue,
  };
}

export const findEmployeeRow = (db: Kysely<DB> | Transaction<DB>, id: string) =>
  db.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirst();
