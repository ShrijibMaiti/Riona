/**
 * Income tax deducted at source. Employees: new regime, projected on the month's salary × 12, with cess; one-off
 * pay (bonus, arrears) adds the extra tax it causes in the month it is paid. Contractors: a flat 194J rate.
 * Declarations aren't applied, so the figure is an estimate (shown with a marker). Rupees.
 */
import type { StatutoryRules } from './rules';

export function annualTax(income: number, rules: StatutoryRules): number {
  const t = rules.tds;
  const x = Math.max(0, income - t.standardDeduction);
  if (x <= t.rebateUpTo) return 0;
  let tax = 0, prev = 0;
  for (const [limit, rate] of t.slabs) {
    if (x > prev) tax += (Math.min(x, limit) - prev) * rate;
    prev = limit;
  }
  return tax * (1 + t.cess);
}

/** This month's TDS for recurring pay `recurring` (monthly) and one-off pay `extra`. */
export function monthlyTds(recurring: number, extra: number, contract: boolean, rules: StatutoryRules): number {
  if (contract) return Math.round((recurring + extra) * rules.tds.contractRate);
  const annual = recurring * 12;
  return Math.round(annualTax(annual, rules) / 12 + (extra ? annualTax(annual + extra, rules) - annualTax(annual, rules) : 0));
}
