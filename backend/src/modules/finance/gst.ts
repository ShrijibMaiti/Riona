/**
 * Invoice totals with GST at 18%: CGST + SGST (9% each) when the client is in the organisation's own state,
 * IGST otherwise. The same rules as the frontend (selectors/finance.ts invoiceTotals), so a screen and the server
 * always agree. Rupees in, rupees out; `freeze` turns totals into the paise stored at issue.
 */
import type { InvoiceLine } from '@riona/shared';
import { toPaise } from '../../lib/money';

export const GST_RATE = 0.18;

export type InvoiceTotals = {
  subtotal: number; discount: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number;
  total: number; paid: number; balance: number; intraState: boolean;
};

export function invoiceTotals(lines: Pick<InvoiceLine, 'amount'>[], discountIn: number, payments: { amount: number }[], clientState: string, homeState: string): InvoiceTotals {
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const discount = Math.min(subtotal, discountIn || 0);
  const taxable = subtotal - discount;
  const intraState = clientState === homeState;
  const cgst = intraState ? Math.round(taxable * 0.09) : 0;
  const sgst = intraState ? Math.round(taxable * 0.09) : 0;
  const igst = intraState ? 0 : Math.round(taxable * GST_RATE);
  const tax = cgst + sgst + igst;
  const total = taxable + tax;
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  return { subtotal, discount, taxable, cgst, sgst, igst, tax, total, paid, balance: Math.max(0, total - paid), intraState };
}

/** What is stored when an invoice is issued (and re-stored on each revision), in paise. */
export type FrozenTotals = { subtotal: number; discount: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number };

export const freeze = (t: InvoiceTotals): FrozenTotals => ({
  subtotal: toPaise(t.subtotal), discount: toPaise(t.discount), taxable: toPaise(t.taxable), cgst: toPaise(t.cgst), sgst: toPaise(t.sgst),
  igst: toPaise(t.igst), tax: toPaise(t.tax), total: toPaise(t.total),
});
