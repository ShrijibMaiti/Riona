/**
 * Delivers outbox rows after their transaction committed. Each row is claimed in its own transaction with
 * FOR UPDATE SKIP LOCKED, so several API instances can run this at once without delivering a row twice.
 *
 * - notify: writes the bell rows (in the same transaction that marks the row done, so never twice) and, if the
 *   payload asks, queues one email per recipient as new outbox rows.
 * - email:  sends through channels/email.ts. A crash between sending and marking can send again: at least once.
 *
 * A failed delivery is retried with exponential backoff (2 s, 4 s, 8 s … capped at an hour), up to 10 attempts;
 * after that the row stays with its last error for someone to look at.
 */
import { sql } from 'kysely';
import { config } from '../../config';
import { db } from '../../db/client';
import { deliverInApp } from './channels/in-app';
import { sendEmail } from './channels/email';
import type { EmailPayload, NotifyPayload } from './outbox';

export const MAX_ATTEMPTS = 10;

type Log = { warn: (o: object, msg: string) => void; error: (o: object, msg: string) => void };
let log: Log = { warn: (o, m) => console.warn(m, o), error: (o, m) => console.error(m, o) };
export const setDispatcherLogger = (l: Log) => (log = l);

/** Deliver up to `limit` pending rows. Returns how many were delivered. */
export async function dispatchOnce(limit = 100): Promise<number> {
  let delivered = 0;
  for (let i = 0; i < limit; i++) {
    let claimed: { id: number; attempts: number } | undefined;
    try {
      claimed = await db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('outbox')
          .select(['id', 'topic', 'payload', 'attempts'])
          .where('dispatchedAt', 'is', null)
          .where('availableAt', '<=', sql<string>`now()`)
          .where('attempts', '<', MAX_ATTEMPTS)
          .orderBy('id')
          .limit(1)
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!row) return undefined;
        claimed = { id: row.id, attempts: row.attempts };
        if (row.topic === 'notify') {
          const p = row.payload as unknown as NotifyPayload;
          await deliverInApp(trx, p);
          if (p.email) {
            const people = p.recipientIds.length
              ? await trx.selectFrom('employees').select(['email']).where('id', 'in', p.recipientIds).execute()
              : [];
            const text = `${p.text}\n\nOpen it in Riona: ${config.appOrigin}/#${p.href}`;
            for (const person of people) {
              const mail: EmailPayload = { to: person.email, subject: p.email.subject, text };
              await trx.insertInto('outbox').values({ topic: 'email', payload: JSON.stringify(mail) }).execute();
            }
          }
        } else {
          await sendEmail(row.payload as unknown as EmailPayload);
        }
        await trx.updateTable('outbox').set({ dispatchedAt: sql`now()`, attempts: row.attempts + 1, lastError: null }).where('id', '=', row.id).execute();
        return claimed;
      });
    } catch (err) {
      if (!claimed) throw err; // couldn't even read the outbox (database down): let the caller log it
      const attempts = claimed.attempts + 1;
      const backoffSeconds = Math.min(3600, 2 ** attempts);
      await db
        .updateTable('outbox')
        .set({ attempts, lastError: String((err as Error).message ?? err).slice(0, 1000), availableAt: sql`now() + make_interval(secs => ${backoffSeconds})` })
        .where('id', '=', claimed.id)
        .execute();
      (attempts >= MAX_ATTEMPTS ? log.error : log.warn)({ outboxId: claimed.id, attempts, err }, 'Outbox delivery failed');
      continue;
    }
    if (!claimed) break; // nothing left
    delivered++;
  }
  return delivered;
}

// ---- after-commit kick: deliver right away instead of waiting for the next scheduler poll ----
let auto = !config.isTest;
let running = false;
let again = false;

/** Tests turn automatic delivery off and call dispatchOnce themselves. */
export const setAutoDispatch = (on: boolean) => (auto = on);

export function kickDispatcher() {
  if (!auto) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setImmediate(async () => {
    try {
      do {
        again = false;
        await dispatchOnce();
      } while (again);
    } catch (err) {
      log.error({ err }, 'Outbox dispatch failed');
    } finally {
      running = false;
    }
  });
}
