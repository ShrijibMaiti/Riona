/**
 * The server's clock, in the organisation's time zone. Every "today" the API returns or acts on comes from here,
 * never from the request. In development CLOCK_FIXED_NOW pins it to the demo data's date.
 */
import { config } from '../config';

/** The current instant. */
export const now = (): Date => (config.fixedNow ? new Date(config.fixedNow) : new Date());

/** ISO timestamp of now, UTC. */
export const nowIso = () => now().toISOString();

function zonedParts(at: Date, timeZone = config.timeZone) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return p;
}

/** Today as YYYY-MM-DD in the organisation's zone. */
export function today(timeZone = config.timeZone): string {
  const p = zonedParts(now(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Now as an ISO timestamp with the organisation's offset ("2026-11-06T11:00:00+05:30"). */
export function nowZoned(timeZone = config.timeZone): string {
  return toZonedIso(now(), timeZone);
}

/**
 * An instant as an ISO timestamp in the organisation's zone, to the second ("2026-11-06T09:48:00+05:30"): the
 * shape the frontend uses, so slicing the first 10 characters gives the local date, not the UTC one.
 */
export function toZonedIso(at: Date, timeZone = config.timeZone): string {
  const p = zonedParts(at, timeZone);
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offMin = Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offMin) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offMin) % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};
/** 1 Monday … 7 Sunday */
export const isoDow = (s: string) => ((parse(s).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (s: string) => addDays(s, 1 - isoDow(s));
export const monthOf = (s: string) => s.slice(0, 7);
export const firstOfMonth = (s: string) => s.slice(0, 7) + '-01';
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return fmt(new Date(Date.UTC(y, m, 0)));
};
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;

/** The Indian financial year (1 April – 31 March) containing a date. */
export function fiscalYear(date: string) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const startYear = m >= 4 ? y : y - 1;
  return { startYear, start: `${startYear}-04-01`, end: `${startYear + 1}-03-31`, label: `FY ${startYear}–${String(startYear + 1).slice(2)}` };
}