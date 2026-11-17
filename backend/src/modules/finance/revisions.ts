/**
 * Revising an issued invoice (POST /invoices/:id/revise). The invoice as first issued is kept (the first revision
 * row is that state, labelled "Issued"), each revision appends its lines and reason (the client sees it), and the
 * totals are frozen again. Rules:
 *  - only Sent, Overdue or Partially paid invoices; a reason of at least five characters
 *  - existing lines keep the hours and claims they bill (whatever the client sends); a line can't be pointed at new
 *    hours here, and new lines are manual only. Removing a time line frees its hours to be billed again.
 *  - amounts are recomputed as quantity × rate; the total can't fall below what has been paid
 */
import type { Invoice, InvoiceLine } from '@riona/shared';
import { z } from 'zod';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { nowIso } from '../../lib/dates';
import { toPaise } from '../../lib/money';
import { F } from '../../lib/validate';
import { freeze, invoiceTotals } from './gst';
import { homeState, loadInvoices } from './invoices.repo';
import { writeLines } from './invoices.service';

export const ReviseInput = z.object({
  reason: F.text(500),
  discount: z.number().min(0, 'The discount must be between zero and the subtotal.').default(0),
  lines: z.array(z.object({
    id: z.string().max(60).optional(),
    kind: z.enum(['time', 'expense', 'milestone', 'manual']).optional(),
    projectId: z.string().max(40).nullable().optional(),
    description: z.string().max(300),
    quantity: z.number(),
    unit: z.enum(['h', 'item']).optional(),
    rate: z.number(),
  }).passthrough()).max(200),
});

export async function reviseInvoice(actor: Actor, id: string, input: z.infer<typeof ReviseInput>): Promise<Invoice> {
  authorize(actor, 'finance', 'edit');
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('invoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Invoice not found');
    if (!['Sent', 'Overdue', 'Partially paid'].includes(row.status)) throw conflict('Only an issued invoice with a balance can be revised.');
    if (input.reason.trim().length < 5) throw unprocessable('Say why the invoice is being revised — the client sees this.', { reason: 'Too short' });

    const inv = (await loadInvoices(tx.db, { ids: [id] }))[0];
    const existing = new Map(inv.lines.map((l) => [l.id, l]));
    const kept = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
    if (!kept.length) throw unprocessable('Keep at least one line. To cancel the invoice, void it instead.');
    if (kept.some((l) => !l.description.trim())) throw unprocessable('Every line needs a description.');
    let n = Math.max(0, ...inv.lines.map((l) => +(l.id.match(/-L(\d+)$/)?.[1] ?? 0))) + 1;
    const clean = kept.map((l) => {
      const was = l.id ? existing.get(l.id) : undefined;
      const base = was
        ? { id: was.id, kind: was.kind, projectId: was.projectId, unit: was.unit, links: was.entryIds, claimLinks: was.expenseIds }
        : { id: `${id}-L${n++}`, kind: 'manual' as const, projectId: null, unit: 'item' as const, links: [] as string[], claimLinks: [] as string[] };
      const quantity = Math.round(l.quantity * 100) / 100;
      return { ...base, description: l.description.trim(), quantity, rate: l.rate, amount: Math.round(quantity * l.rate) };
    });
    const asLines = (xs: typeof clean): InvoiceLine[] => xs.map(({ links, claimLinks, ...l }) => ({ ...l, entryIds: links, expenseIds: claimLinks }));

    const client = await tx.db.selectFrom('clients').select('state').where('id', '=', inv.clientId).executeTakeFirstOrThrow();
    const home = await homeState(tx.db);
    const before = invoiceTotals(inv.lines, inv.discount, inv.payments, client.state, home);
    const after = invoiceTotals(clean, input.discount, inv.payments, client.state, home);
    if (input.discount > after.subtotal) throw unprocessable('The discount must be between zero and the subtotal.', { discount: 'Too large' });
    if (after.paid > after.total) throw unprocessable('The client has already paid ' + after.paid.toLocaleString('en-IN') + ' — the revised total can’t be lower than that.');

    // The first revision is the invoice as first issued, so "as first issued" can always be shown.
    if (!inv.revisions.length) {
      await tx.db.insertInto('invoiceRevisions').values({ invoiceId: id, at: inv.issued + 'T10:00:00+05:30', reason: 'Issued', lines: JSON.stringify(inv.lines), discountPaise: toPaise(inv.discount), totalPaise: toPaise(before.total), actorId: null }).execute();
    }
    // Replace the lines: removed lines (and their links) go, so their hours can be billed again.
    await tx.db.deleteFrom('invoiceLines').where('invoiceId', '=', id).execute();
    await writeLines(tx, id, clean);
    const status = after.balance <= 0 ? 'Paid' : row.status;
    await tx.db.updateTable('invoices').set({ discountPaise: toPaise(input.discount), issuedTotals: JSON.stringify(freeze(after)), status }).where('id', '=', id).execute();
    await tx.db.insertInto('invoiceRevisions').values({ invoiceId: id, at: nowIso(), reason: 'Revised: ' + input.reason.trim(), lines: JSON.stringify(asLines(clean)), discountPaise: toPaise(input.discount), totalPaise: toPaise(after.total), actorId: actor.employeeId }).execute();
    await tx.audit('Revised', 'Invoice', id, [
      { field: 'total', before: String(before.total), after: String(after.total) },
      ...(status !== row.status ? [{ field: 'status', before: row.status, after: status }] : []),
      { field: 'reason', before: null, after: input.reason.trim() },
    ]);
    return (await loadInvoices(tx.db, { ids: [id] }))[0];
  });
}
