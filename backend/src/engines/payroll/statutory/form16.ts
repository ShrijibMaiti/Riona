/**
 * Form 16 Part B for a financial year: months already paid use the payslip as paid at the time; the rest are
 * projected at the current salary, so everything past today is an estimate until the year closes. Rupees.
 */
import type { Employee, SalaryEvent } from '@riona/shared';
import { monthsBetween } from '../lock';
import { payslip } from '../payslip';
import { rulesFor } from './rules';
import { annualTax } from './tds';

export function form16Projection(emp: Pick<Employee, 'state' | 'type'>, events: SalaryEvent[], today: string, fyStart: string, fyEnd: string) {
  const months = monthsBetween(fyStart, fyEnd);
  // The current month's run hasn't been paid yet; only earlier months count as paid.
  const paidMonths = months.filter((m) => m < today.slice(0, 7));
  const slips = months.map((m) => payslip(emp, events, m, paidMonths.includes(m) ? 'asPaid' : 'corrected'));
  const sum = (key: string, n = slips.length) => slips.slice(0, n).reduce((a, s) => a + (s.deductions.find((d) => d.key === key)?.amount ?? 0), 0);
  const gross = slips.reduce((a, s) => a + s.gross, 0);
  const rules = rulesFor(months.at(-1)!);
  return {
    months: months.length, actual: paidMonths.length, gross, standardDeduction: rules.tds.standardDeduction,
    taxable: Math.max(0, gross - rules.tds.standardDeduction), tax: Math.round(annualTax(gross, rules)), tdsSoFar: sum('tds', paidMonths.length), pf: sum('pf'),
    final: today > fyEnd,
  };
}
