/**
 * Statutory rules, dated. A change in the law (a new tax slab, a PF ceiling) is a new entry with the month it takes
 * effect from, never an edit to an old one, so a past month's payslip is always computed with the rules of its
 * month. Figures are in rupees.
 */
export type StatutoryRules = {
  /** First month (YYYY-MM) these rules apply to. */
  from: string;
  /** Employee PF: a share of basic, capped per month. */
  pf: { rate: number; monthlyCap: number };
  /** ESI applies while monthly gross is at or below the ceiling. */
  esi: { grossCeiling: number; employeeRate: number };
  /** Professional tax per month, by state of work. */
  pt: { byState: Record<string, number>; default: number };
  /** Income tax, new regime: slabs on income after the standard deduction; full rebate up to `rebateUpTo`. */
  tds: { standardDeduction: number; rebateUpTo: number; slabs: [number, number][]; cess: number; contractRate: number };
};

const RULES: StatutoryRules[] = [
  {
    // FY 2025–26 onwards (Union Budget 2025): new-regime slabs, ₹75,000 standard deduction, no tax up to ₹12 lakh.
    from: '2025-04',
    pf: { rate: 0.12, monthlyCap: 1800 },
    esi: { grossCeiling: 21000, employeeRate: 0.0075 },
    pt: { byState: { Karnataka: 200, Maharashtra: 200, 'West Bengal': 200, Kerala: 208, 'Tamil Nadu': 208 }, default: 200 },
    tds: {
      standardDeduction: 75000,
      rebateUpTo: 1200000,
      slabs: [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [1e12, 0.3]],
      cess: 0.04,
      // Contractors: TDS under Section 194J.
      contractRate: 0.1,
    },
  },
];

/** The rules in force for a month (YYYY-MM). Months before the first entry use the first entry. */
export function rulesFor(month: string): StatutoryRules {
  let r = RULES[0];
  for (const x of RULES) if (x.from <= month) r = x;
  return r;
}
