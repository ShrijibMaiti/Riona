/** Professional tax: a fixed monthly amount by the state the person works in. Rupees. */
import type { StatutoryRules } from './rules';

export const ptFor = (state: string, rules: StatutoryRules) => rules.pt.byState[state] ?? rules.pt.default;
