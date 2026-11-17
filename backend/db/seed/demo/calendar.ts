import type { Holiday } from '@riona/shared';

/** The fixed "today" for the whole dataset: Friday 6 November 2026. */
export const TODAY = '2026-11-06';
/** First day of seeded history. */
export const HISTORY_FROM = '2026-05-01';

export const HOLIDAYS: Holiday[] = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-08-27', name: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-09', name: 'Diwali' },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-26', name: 'Republic Day' },
];
export const holidayOn = (d: string) => HOLIDAYS.find((h) => h.date === d)?.name ?? null;
