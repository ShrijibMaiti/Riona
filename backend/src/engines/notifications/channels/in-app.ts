/**
 * In-app notifications (the bell): one row per recipient. Called by the dispatcher inside the transaction that
 * marks the outbox row done, so a retried delivery never writes the bell twice.
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../../db/schema';
import { newId } from '../../../lib/ids';
import type { NotifyPayload } from '../outbox';

export async function deliverInApp(trx: Transaction<DB>, p: NotifyPayload): Promise<void> {
  const recipients = [...new Set(p.recipientIds)].filter(Boolean);
  if (!recipients.length) return;
  await trx
    .insertInto('notifications')
    .values(recipients.map((recipientId) => ({
      id: newId('NT'), kind: p.kind, text: p.text, href: p.href, approvalId: p.approvalId ?? null, actorId: p.actorId ?? null, recipientId,
    })))
    .execute();
}
