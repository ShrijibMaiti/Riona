/**
 * Joining and leaving checklists. Each item has an owner (HR, IT, Manager, Finance) and is ticked by them:
 * - HR and Admin (recruitment:edit) see every case and tick any item
 * - a manager sees the cases of their team (or, before the person has a record, of their department) and ticks
 *   the Manager items
 * - people whose role is named IT or Finance see every case and tick their own items
 */
import type { OnboardingCase } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { can } from '../../auth/rbac/authorize';
import { reportsOf } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { forbidden, notFound } from '../../lib/errors';
import { today } from '../../lib/dates';

type Q = Kysely<DB> | Transaction<DB>;
type Owner = OnboardingCase['items'][number]['owner'];

export const ChecklistItem = z.object({ done: z.boolean({ required_error: 'Say whether it’s done.' }) });

/** The checklist owners this actor ticks for. */
function ownersOf(actor: Actor): Owner[] {
  if (can(actor, 'recruitment', 'edit')) return ['HR', 'IT', 'Manager', 'Finance'];
  const out: Owner[] = [];
  if (actor.roleName === 'IT') out.push('IT');
  if (actor.roleName === 'Finance') out.push('Finance');
  if (actor.role === 'Manager') out.push('Manager');
  return out;
}

/** Which cases the actor sees: 'all', or a filter for a manager. */
async function caseScope(q: Q, actor: Actor): Promise<'all' | { team: string[]; dept: string | null } | null> {
  if (can(actor, 'recruitment', 'edit') || actor.roleName === 'IT' || actor.roleName === 'Finance') return 'all';
  if (actor.role === 'Manager' && actor.employeeId) {
    const me = await q.selectFrom('employees').select('dept').where('id', '=', actor.employeeId).executeTakeFirst();
    return { team: await reportsOf(q, actor.employeeId), dept: me?.dept ?? null };
  }
  return null;
}

async function load(q: Q, actor: Actor, ids?: string[]): Promise<OnboardingCase[]> {
  const scope = await caseScope(q, actor);
  if (!scope) return [];
  let cq = q.selectFrom('onboardingCases').selectAll();
  if (ids) cq = cq.where('id', 'in', ids.length ? ids : ['-']);
  if (scope !== 'all') {
    const team = scope.team.length ? scope.team : ['-'];
    cq = cq.where((eb) => eb.or([eb('employeeId', 'in', team), eb.and([eb('employeeId', 'is', null), eb('dept', '=', scope.dept ?? '-')])]));
  }
  const rows = await cq.orderBy('date').orderBy('id').execute();
  if (!rows.length) return [];
  const items = await q.selectFrom('onboardingItems').selectAll().where('caseId', 'in', rows.map((r) => r.id)).orderBy('position').execute();
  return rows.map((c) => ({
    id: c.id, kind: c.kind as OnboardingCase['kind'], employeeId: c.employeeId, personName: c.personName, title: c.title, dept: c.dept as OnboardingCase['dept'], date: c.date,
    items: items.filter((i) => i.caseId === c.id).map((i) => ({ id: i.id, owner: i.owner as Owner, label: i.label, done: i.done, doneOn: i.doneOn })),
  }));
}

/** GET /onboarding */
export const listOnboarding = (actor: Actor) => load(db, actor);

/** GET /onboarding/:id */
export async function getOnboardingCase(actor: Actor, id: string): Promise<OnboardingCase> {
  const [c] = await load(db, actor, [id]);
  if (!c) throw notFound('Not found');
  return c;
}

/** PATCH /onboarding/:id/items/:itemId { done } — by the item's owner. */
export async function setChecklistItem(actor: Actor, caseId: string, itemId: string, done: boolean): Promise<OnboardingCase> {
  return withTransaction(actor, async (tx) => {
    const [c] = await load(tx.db, actor, [caseId]);
    const item = c?.items.find((i) => i.id === itemId);
    if (!c || !item) throw notFound('Not found');
    if (!ownersOf(actor).includes(item.owner)) throw forbidden(`This item is for ${item.owner} to tick.`);
    if (item.done !== done) {
      await tx.db.updateTable('onboardingItems').set({ done, doneOn: done ? today() : null }).where('id', '=', itemId).where('caseId', '=', caseId).execute();
      await tx.audit('Updated', 'Checklist', caseId, [{ field: item.label, before: item.done ? 'Done' : 'Open', after: done ? 'Done' : 'Open' }]);
    }
    return (await load(tx.db, actor, [caseId]))[0];
  });
}
