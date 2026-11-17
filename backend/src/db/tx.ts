/**
 * The one write wrapper. Every change to the database goes through withTransaction, which gives the code:
 *
 *   tx.db      the transaction
 *   tx.audit   record who changed what (engines/audit) — in the same transaction
 *   tx.notify  queue an in-app notification (and optional email) — delivered after commit
 *   tx.email   queue an email — delivered after commit
 *
 * The domain rows, their audit entries and their outbox rows commit together or not at all. Side effects run
 * only after commit, from the outbox (engines/notifications/dispatcher.job.ts), so a rolled-back write never
 * sends anything.
 *
 *   return withTransaction(req.actor!, async (tx) => {
 *     await tx.db.updateTable('employees').set({ phone }).where('id', '=', id).execute();
 *     await tx.audit('Updated', 'Employee', id, [{ field: 'phone', before, after: phone }]);
 *   });
 */
import type { Transaction } from 'kysely';
import { db } from './client';
import type { DB } from './schema';
import type { Actor } from '../http/plugins/session';
import { writeAudit, type Change } from '../engines/audit/audit';
import { enqueue, type EmailPayload, type NotifyPayload } from '../engines/notifications/outbox';
import { kickDispatcher } from '../engines/notifications/dispatcher.job';

/** Who a write is attributed to. Requests pass req.actor; jobs and setup pass a system actor. */
export type TxActor = Pick<Actor, 'userId' | 'employeeId' | 'name' | 'ip' | 'requestId'>;

export const SYSTEM_ACTOR: TxActor = { userId: 'system', employeeId: null, name: 'Riona', ip: '', requestId: '' };

export type Tx = {
  db: Transaction<DB>;
  actor: TxActor;
  audit: (action: string, entity: string, entityId: string, changes?: Change[]) => Promise<void>;
  /** An in-app notification (and email, if the payload asks), delivered after commit. */
  notify: (payload: NotifyPayload) => Promise<void>;
  /** An email only (password reset, invitations), delivered after commit. */
  email: (payload: EmailPayload) => Promise<void>;
};

export async function withTransaction<T>(actor: TxActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let queued = false;
  const result = await db.transaction().execute(async (trx) => {
    const tx: Tx = {
      db: trx,
      actor,
      audit: async (action, entity, entityId, changes = []) => {
        await writeAudit(trx, actor, { action, entity, entityId, changes });
      },
      notify: async (payload) => {
        queued = true;
        await enqueue(trx, 'notify', payload);
      },
      email: async (payload) => {
        queued = true;
        await enqueue(trx, 'email', payload);
      },
    };
    return fn(tx);
  });
  // Committed. Wake the dispatcher rather than waiting for its next poll; never await delivery.
  if (queued) kickDispatcher();
  return result;
}
