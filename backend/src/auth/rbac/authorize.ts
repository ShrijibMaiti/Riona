/**
 * The two checks every request passes, in order:
 *   1. role:  may this role do this kind of thing at all?          authorize(actor, 'leave', 'approve')
 *   2. scope: is this particular record within what they may see?  await authorizeRecord(trx, actor, 'leave', 'view', ownerId)
 * Run the record check inside the transaction that then writes, so the answer can't change in between.
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/schema';
import { forbidden, notFound, unauthenticated } from '../../lib/errors';
import type { Actor } from '../../http/plugins/session';
import { atLeast, levelOf, type Level, type Module } from './permissions';
import { visibleEmployeeIds } from './scope';

export const can = (actor: Actor, module: Module, level: Level) => atLeast(levelOf(actor.role, module, actor.roleName), level);

export function authorize(actor: Actor | null, module: Module, level: Level): asserts actor is Actor {
  if (!actor) throw unauthenticated();
  if (!can(actor, module, level)) throw forbidden();
}

/**
 * The record belongs to `ownerEmployeeId`. Outside the actor's scope it answers 404, so the API never
 * confirms that a record the actor can't see exists.
 */
export async function authorizeRecord(db: Kysely<DB> | Transaction<DB>, actor: Actor, module: Module, level: Level, ownerEmployeeId: string, what = 'that') {
  authorize(actor, module, level);
  const ids = await visibleEmployeeIds(db, actor, module);
  if (ids && !ids.includes(ownerEmployeeId)) throw notFound(`We couldn’t find ${what}.`);
}

/** The signed-in person's employee id; staff sessions always have one. */
export function selfId(actor: Actor): string {
  if (!actor.employeeId) throw forbidden('This account isn’t linked to an employee record.');
  return actor.employeeId;
}