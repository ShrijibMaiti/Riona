/**
 * Settling a portal payment once the gateway confirms it. Used by the signed webhook (POST /webhooks/payments)
 * and, in development and tests, by the simulated gateway straight after the client pays.
 *
 * Idempotent: an intent is settled once; a repeated or late confirmation changes nothing. A confirmation for more
 * than the invoice still owes (Finance recorded a bank transfer meanwhile) is not booked: the intent is marked
 * failed and audited for a refund, so payments never exceed the frozen total.
 */
import { SYSTEM_ACTOR, withTransaction } from '../../db/tx';
import { sql } from 'kysely';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { toRupees } from '../../lib/money';

export type Confirmation = { status: 'captured' | 'failed'; reference: string; amountPaise?: number };
export type Settled = { intentId: string; status: 'Captured' | 'Failed'; changed: boolean };

const GATEWAY = { ...SYSTEM_ACTOR, name: 'Payment gateway' };

export async function settleIntent(intentId: string, c: Confirmation): Promise<Settled | null> {
  return withTransaction(GATEWAY, async (tx) => {
    const intent = await tx.db.selectFrom('paymentIntents').selectAll().where('id', '=', intentId).forUpdate().executeTakeFirst();
    if (!intent) return null;
    if (intent.status !== 'Created') return { intentId, status: intent.status as Settled['status'], changed: false };
    const fail = async (reason: string) => {
      await tx.db.updateTable('paymentIntents').set({ status: 'Failed', reference: c.reference, settledAt: new Date() }).where('id', '=', intentId).execute();
      await tx.audit('Updated', 'Payment', intentId, [{ field: 'status', before: 'Created', after: 'Failed' }, { field: 'reason', before: null, after: reason }]);
      return { intentId, status: 'Failed' as const, changed: true };
    };
    if (c.status === 'failed') return fail('Declined by the gateway');
    if (c.amountPaise !== undefined && c.amountPaise !== intent.amountPaise) return fail(`Gateway amount ${c.amountPaise} ≠ intent ${intent.amountPaise}`);

    const inv = await tx.db.selectFrom('invoices').select(['id', 'status', 'issuedTotals']).where('id', '=', intent.invoiceId).forUpdate().executeTakeFirstOrThrow();
    const total = (inv.issuedTotals as { total: number } | null)?.total ?? 0;
    const paid = Number((await tx.db.selectFrom('payments').select(sql<number>`coalesce(sum(amount_paise), 0)`.as('s')).where('invoiceId', '=', inv.id).executeTakeFirstOrThrow()).s);
    if (paid + intent.amountPaise > total + 100) return fail('Invoice already settled; refund this gateway payment');

    const paymentId = newId('PAY');
    await tx.db.insertInto('payments').values({ id: paymentId, invoiceId: inv.id, date: today(), amountPaise: intent.amountPaise, method: intent.method, reference: c.reference, actorId: null }).execute();
    const status = paid + intent.amountPaise >= total - 100 ? 'Paid' : 'Partially paid';
    await tx.db.updateTable('invoices').set({ status }).where('id', '=', inv.id).execute();
    await tx.db.updateTable('paymentIntents').set({ status: 'Captured', reference: c.reference, paymentId, settledAt: new Date() }).where('id', '=', intentId).execute();
    await tx.audit('Updated', 'Invoice', inv.id, [{ field: 'status', before: inv.status, after: status }, { field: 'payment', before: null, after: String(toRupees(intent.amountPaise)) }, { field: 'reference', before: null, after: c.reference }]);
    // Tell the account owner the client paid.
    const owner = await tx.db.selectFrom('clients').select('ownerId').where('id', '=', intent.clientId).executeTakeFirst();
    if (owner?.ownerId) await tx.notify({ recipientIds: [owner.ownerId], kind: 'System', text: `${inv.id} paid online · ₹${toRupees(intent.amountPaise).toLocaleString('en-IN')}`, href: '/app/finance/invoices/' + inv.id });
    return { intentId, status: 'Captured' as const, changed: true };
  });
}
