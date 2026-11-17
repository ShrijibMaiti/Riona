/** Employee state insurance: 0.75% of gross while monthly gross is at or below ₹21,000. Rupees. */
import type { StatutoryRules } from './rules';

export const esiApplies = (gross: number, rules: StatutoryRules) => gross <= rules.esi.grossCeiling;
export const esiFor = (gross: number, rules: StatutoryRules) => (esiApplies(gross, rules) ? Math.round(gross * rules.esi.employeeRate) : 0);
export const esiNote = (gross: number, rules: StatutoryRules) =>
  esiApplies(gross, rules) ? 'ESI at 0.75% applies' : 'ESI not applicable — gross above ₹21,000';
