/**
 * Money is stored as integer paise (BIGINT) so sums never drift; the API speaks rupees, as the frontend does.
 * Convert at the edge: toPaise on the way in, toRupees on the way out. Never add rupee floats in SQL or code.
 */

/** ₹1,234.56 → 123456. Rounds half away from zero to the nearest paisa. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RangeError(`Not an amount: ${rupees}`);
  return Math.sign(rupees) * Math.round(Math.abs(rupees) * 100);
}

/** 123456 → 1234.56 */
export const toRupees = (paise: number): number => paise / 100;

/** Sum of paise amounts (integers, so exact). */
export const sumPaise = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** A share of an amount in paise, rounded to the paisa: percentOf(150000, 12) → 18000 (12% of ₹1,500). */
export const percentOf = (paise: number, percent: number): number => Math.round((paise * percent) / 100);
