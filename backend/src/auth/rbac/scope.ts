/**
 * Which records a role sees within a module it may use.
 *   own   only the actor's own records
 *   team  the actor's, plus everyone who reports to them, directly or indirectly
 *   all   everyone
 * Lists are filtered to the scope (never a 403 for a list); a single record outside it is a 404.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { AppRole, DB } from '../../db/schema';
import type { Module } from './permissions';

export type Scope = 'own' | 'team' | 'all';

const SCOPES: Record<Exclude<AppRole, 'Client'>, Partial<Record<Module, Scope>>> = {
  Admin: {},
  HR: { projects: 'all', timesheets: 'all' },
  Manager: { employees: 'team', attendance: 'team', leave: 'team', timesheets: 'team', salary: 'own', payroll: 'own', expenses: 'team', performance: 'team', training: 'team' },
  Employee: { employees: 'own', attendance: 'own', leave: 'own', timesheets: 'own', salary: 'own', payroll: 'own', approvals: 'own', expenses: 'own', performance: 'own', training: 'own' },
};

export function scopeOf(role: AppRole, module: Module): Scope {
  if (role === 'Client') return 'own';
  return SCOPES[role][module] ?? 'all';
}

/** Everyone below `managerId` in the reporting tree (not including them). */
export async function reportsOf(db: Kysely<DB> | Transaction<DB>, managerId: string): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    WITH RECURSIVE tree AS (
      SELECT id FROM employees WHERE manager_id = ${managerId}
      UNION
      SELECT e.id FROM employees e JOIN tree t ON e.manager_id = t.id
    )
    SELECT id FROM tree`.execute(db);
  return rows.rows.map((r) => r.id);
}

/**
 * The employee ids whose records the actor may see in a module, or null for "all".
 * Pass the result to a WHERE employee_id IN (...) — an empty list means only the actor's own.
 */
export async function visibleEmployeeIds(db: Kysely<DB> | Transaction<DB>, actor: { role: AppRole; employeeId: string | null }, module: Module): Promise<string[] | null> {
  const scope = scopeOf(actor.role, module);
  if (scope === 'all') return null;
  const self = actor.employeeId ? [actor.employeeId] : [];
  if (scope === 'own') return self;
  return [...self, ...(actor.employeeId ? await reportsOf(db, actor.employeeId) : [])];
}