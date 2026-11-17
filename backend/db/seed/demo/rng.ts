/** Deterministic randomness and date helpers for seed generation. */

export type Rng = {
  (): number;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  chance: (p: number) => boolean;
  shuffle: <T>(xs: T[]) => T[];
};

/** mulberry32 — small, fast, good enough, and stable across runs. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const r = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.chance = (p) => r() < p;
  r.shuffle = (xs) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  return r;
}

/** Derive an independent stream from a label so adding one generator never shifts another's output. */
export function streamFor(label: string, base = 20261106): Rng {
  let h = 2166136261 ^ base;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return makeRng(h >>> 0);
}

// ---- dates (all local, midday-free ISO strings) ----
export const iso = (d: Date) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const dow = (s: string) => parse(s).getDay(); // 0 Sun … 6 Sat
export const isWeekend = (s: string) => {
  const d = dow(s);
  return d === 0 || d === 6;
};
export const monthOf = (s: string) => s.slice(0, 7);
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
export function* eachDay(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}
export const mondayOf = (s: string) => {
  const d = dow(s);
  return addDays(s, d === 0 ? -6 : 1 - d);
};
export const endOfMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return iso(new Date(y, m, 0));
};
export const ts = (date: string, hhmm = '10:00') => date + 'T' + hhmm + ':00+05:30';
