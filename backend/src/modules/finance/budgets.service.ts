/** Department budgets by financial year (finance view: Admin and managers). */
import type { Budget } from '@riona/shared';
import { db } from '../../db/client';
import { can } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { toRupees } from '../../lib/money';

export async function listBudgets(actor: Actor, fy?: string): Promise<Budget[]> {
  if (!can(actor, 'finance', 'view')) return [];
  let q = db.selectFrom('budgets').selectAll();
  if (fy) q = q.where('fy', '=', fy);
  const rows = await q.orderBy('fy', 'desc').orderBy('dept').execute();
  return rows.map((b) => ({ id: b.id, dept: b.dept as Budget['dept'], fy: b.fy, planned: toRupees(b.plannedPaise), committed: toRupees(b.committedPaise), lines: b.lines as Budget['lines'] }));
}
