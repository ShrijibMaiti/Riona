/** Local-calendar date helpers on ISO `YYYY-MM-DD` strings (no timezone drift). */
export const parseDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const isoDate = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const addDays = (s: string, n: number) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
/** 0 Sun … 6 Sat */
export const dayOfWeek = (s: string) => parseDate(s).getDay();
export const isWeekend = (s: string) => [0, 6].includes(dayOfWeek(s));
export const mondayOf = (s: string) => {
  const d = dayOfWeek(s);
  return addDays(s, d === 0 ? -6 : 1 - d);
};
export const daysBetween = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 864e5);
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const monthStart = (s: string) => s.slice(0, 8) + '01';
export const monthEnd = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  return isoDate(new Date(y, m, 0));
};
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
/** The app's fixed clock: 11:00 on Friday 6 November 2026. */
export const NOW = '2026-11-06T11:00:00+05:30';
export const TODAY_ISO = '2026-11-06';
