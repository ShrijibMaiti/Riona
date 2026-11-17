/** Reading invoices in the API's shape: lines with the hours and claims they bill, payments, revisions. */
import type { Invoice, InvoiceLine } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../db/schema';
import { toRupees } from '../../lib/money';
import type { FrozenTotals } from './gst';

type Q = Kysely<DB> | Transaction<DB>;

export type InvoiceWhere = { ids?: string[]; clientId?: string; status?: string; search?: string };

export async function loadInvoices(q: Q, where: InvoiceWhere = {}): Promise<Invoice[]> {
  let iq = q.selectFrom('invoices as i').innerJoin('clients as c', 'c.id', 'i.clientId').selectAll('i');
  if (where.ids) {
    if (!where.ids.length) return [];
    iq = iq.where('i.id', 'in', where.ids);
  }
  if (where.clientId) iq = iq.where('i.clientId', '=', where.clientId);
  if (where.status) iq = iq.where('i.status', '=', where.status);
  if (where.search?.trim()) {
    const like = '%' + where.search.trim().toLowerCase().replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    iq = iq.where(sql<boolean>`lower(i.number || ' ' || c.name) LIKE ${like}`);
  }
  const rows = await iq.orderBy('i.issued', 'desc').orderBy('i.id', 'desc').execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lines, entries, claims, payments, revisions] = await Promise.all([
    q.selectFrom('invoiceLines').selectAll().where('invoiceId', 'in', ids).orderBy('position').execute(),
    q.selectFrom('invoiceLineEntries').select(['lineId', 'entryId']).where('invoiceId', 'in', ids).orderBy('entryId').execute(),
    q.selectFrom('invoiceLineExpenses').select(['lineId', 'expenseId']).where('invoiceId', 'in', ids).orderBy('expenseId').execute(),
    q.selectFrom('payments').selectAll().where('invoiceId', 'in', ids).orderBy('date').orderBy('id').execute(),
    q.selectFrom('invoiceRevisions').selectAll().where('invoiceId', 'in', ids).orderBy('id').execute(),
  ]);
  const entriesOf = groupBy(entries, (e) => e.lineId);
  const claimsOf = groupBy(claims, (e) => e.lineId);
  return rows.map((r) => ({
    id: r.id, number: r.number, clientId: r.clientId, issued: r.issued, due: r.due, status: r.status as Invoice['status'],
    lines: lines.filter((l) => l.invoiceId === r.id).map((l): InvoiceLine => ({
      id: l.id, kind: l.kind as InvoiceLine['kind'], projectId: l.projectId, description: l.description,
      entryIds: (entriesOf.get(l.id) ?? []).map((e) => e.entryId), expenseIds: (claimsOf.get(l.id) ?? []).map((e) => e.expenseId),
      quantity: l.quantity, unit: l.unit as InvoiceLine['unit'], rate: toRupees(l.ratePaise), amount: toRupees(l.amountPaise),
    })),
    discount: toRupees(r.discountPaise), notes: r.notes,
    payments: payments.filter((p) => p.invoiceId === r.id).map((p) => ({ id: p.id, date: p.date, amount: toRupees(p.amountPaise), method: p.method as Invoice['payments'][number]['method'], reference: p.reference })),
    revisions: revisions.filter((v) => v.invoiceId === r.id).map((v) => ({ at: v.at, reason: v.reason, lines: v.lines as unknown as InvoiceLine[], discount: toRupees(v.discountPaise) })),
    approvalId: r.approvalId,
  }));
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** The organisation's GST state (intra-state supplies split CGST/SGST). */
export const homeState = async (q: Q) => (await q.selectFrom('org').select('state').executeTakeFirst())?.state ?? 'Karnataka';

export const frozenOf = (r: { issuedTotals: unknown }) => r.issuedTotals as FrozenTotals | null;
