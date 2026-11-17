/**
 * The transactional outbox. Producers insert a row inside their transaction (via tx.notify / tx.email);
 * the dispatcher delivers it after commit. Delivery is at-least-once: channels must tolerate a repeat.
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../db/schema';

export type NotificationKind = 'Approval' | 'Mention' | 'Payroll' | 'Contracts' | 'System';

export type NotifyPayload = {
  /** Employee ids. */
  recipientIds: string[];
  kind: NotificationKind;
  text: string;
  /** Route in the app, e.g. '/app/approvals'. */
  href: string;
  approvalId?: string | null;
  actorId?: string | null;
  /** Also email the recipients (subject; the body is `text` plus a link to `href`). */
  email?: { subject: string };
};

export type EmailPayload = { to: string; subject: string; text: string };

export type Topic = 'notify' | 'email';

export async function enqueue(trx: Transaction<DB>, topic: Topic, payload: NotifyPayload | EmailPayload) {
  await trx.insertInto('outbox').values({ topic, payload: JSON.stringify(payload) }).execute();
}
