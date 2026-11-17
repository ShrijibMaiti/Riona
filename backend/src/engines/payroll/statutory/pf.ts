/** Employee provident fund: 12% of basic, capped (₹1,800 a month on the ₹15,000 wage ceiling). Rupees. */
import type { StatutoryRules } from './rules';

export const pfFor = (basic: number, rules: StatutoryRules) => Math.min(rules.pf.monthlyCap, Math.round(basic * rules.pf.rate));
