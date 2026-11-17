import type { Client, ExpenseClaim, Invoice, InvoiceLine } from '../types';

/** Riona's own GST registration state — intra-state supply splits CGST/SGST. */
export const HOME_STATE = 'Karnataka';
export const GST_RATE = 0.18;

export type InvoiceTotals = {
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  intraState: boolean;
};

export function linesSubtotal(lines: Pick<InvoiceLine, 'amount'>[]) {
  return lines.reduce((a, l) => a + l.amount, 0);
}

export function invoiceTotals(inv: Pick<Invoice, 'lines' | 'discount' | 'payments'>, client: Pick<Client, 'state'> | undefined): InvoiceTotals {
  const subtotal = linesSubtotal(inv.lines);
  const discount = Math.min(subtotal, inv.discount || 0);
  const taxable = subtotal - discount;
  const intraState = client?.state === HOME_STATE;
  const cgst = intraState ? Math.round(taxable * 0.09) : 0;
  const sgst = intraState ? Math.round(taxable * 0.09) : 0;
  const igst = intraState ? 0 : Math.round(taxable * GST_RATE);
  const tax = cgst + sgst + igst;
  const total = taxable + tax;
  const paid = inv.payments.reduce((a, p) => a + p.amount, 0);
  return { subtotal, discount, taxable, cgst, sgst, igst, tax, total, paid, balance: Math.max(0, total - paid), intraState };
}

export type AgeingBucket = 'Current' | '1–30' | '31–60' | '61–90' | '90+';
export const AGEING: AgeingBucket[] = ['Current', '1–30', '31–60', '61–90', '90+'];
export function ageingOf(inv: Pick<Invoice, 'due' | 'status'>, today: string): AgeingBucket | null {
  if (inv.status === 'Paid' || inv.status === 'Void' || inv.status === 'Draft') return null;
  const days = Math.round((Date.parse(today) - Date.parse(inv.due)) / 864e5);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1–30';
  if (days <= 60) return '31–60';
  if (days <= 90) return '61–90';
  return '90+';
}
export const daysOverdue = (inv: Pick<Invoice, 'due'>, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(inv.due)) / 864e5));

/** Receivables summary across invoices. */
export function receivables(invoices: Invoice[], clients: Client[], today: string) {
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const buckets = Object.fromEntries(AGEING.map((b) => [b, { amount: 0, count: 0 }])) as Record<AgeingBucket, { amount: number; count: number }>;
  let outstanding = 0, over60 = 0;
  const debtors = new Set<string>();
  for (const inv of invoices) {
    const b = ageingOf(inv, today);
    if (!b) continue;
    const bal = invoiceTotals(inv, byClient.get(inv.clientId)).balance;
    if (bal <= 0) continue;
    buckets[b].amount += bal;
    buckets[b].count++;
    outstanding += bal;
    if (b === '61–90' || b === '90+') over60 += bal;
    debtors.add(inv.clientId);
  }
  return { outstanding, over60, buckets, clientsOwing: debtors.size };
}

/** Revenue recognised on invoices issued in a month (pre-tax line totals). */
/** Revenue issued in a month, optionally only up to a day of that month (for like-for-like month-to-date). */
export function revenueIssuedIn(invoices: Invoice[], ym: string, uptoDay?: number) {
  return invoices
    .filter((i) => i.status !== 'Void' && i.issued.startsWith(ym) && (uptoDay === undefined || +i.issued.slice(8, 10) <= uptoDay))
    .reduce((a, i) => a + linesSubtotal(i.lines), 0);
}

export const isSpent = (x: ExpenseClaim) => x.status === 'Approved' || x.status === 'Reimbursed';
