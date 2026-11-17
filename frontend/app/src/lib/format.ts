/** Status colours. Colour in Riona is reserved for status. */
export const SC = {
  green: '#557A3E',
  amber: '#A86F12',
  red: '#B4232F',
  blue: '#575B52',
  gray: '#8D9184',
  ink: '#3B3F37',
} as const;
export type StatusKey = keyof typeof SC;

const STATUS_MAP: Record<'green' | 'amber' | 'red' | 'blue', string> = {
  green: 'Active,On track,Paid,Approved,Present,Available,Hired,Published,Completed,Won,Resolved,Disbursed,In stock,Valid,Healthy,Done,On,On site,Day one,Met,Uploaded',
  amber: 'At risk,Pending,Partially paid,On leave,Under repair,In review,Late,Review inputs,Negotiation,Probation,Waiting on client,High,Half day,Reorder soon,Self review,Offer,Invited,Expected,Expiring',
  red: 'Overdue,Lapsed,Breached,Rejected,Absent,Below reorder,Off track,Lost,Expired,Urgent,Inactive,Missing',
  blue: 'In progress,Sent,Allocated,Interviewing,Open,Screening,Proposal sent,Qualified,Contacted,Manager review,Provisioning,Documentation,Submitted',
};
const STATUS_COLOUR: Record<string, string> = {};
for (const [k, v] of Object.entries(STATUS_MAP)) for (const l of v.split(',')) STATUS_COLOUR[l] = SC[k as StatusKey];
export const statusColour = (label: string) => STATUS_COLOUR[label] ?? SC.gray;

export const initials = (n?: string) =>
  !n || n === '—'
    ? '—'
    : n
        .replace(/[^A-Za-z ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

/** Deterministic PRNG seeded by a string (FNV-1a + xorshift), so generated figures are stable. */
export const seeded = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
};

export const hours = (h: number) => (Math.round(h * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' h';

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The fixed "today": Friday 6 November 2026. Matches the seed. */
export const TODAY = new Date(2026, 10, 6);

export const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** ₹ with Indian grouping. */
export const inr = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
/** ₹ in lakh / crore. */
export const lakh = (n: number) => {
  const a = Math.abs(n), g = n < 0 ? '−' : '';
  return a >= 1e7 ? g + '₹' + (a / 1e7).toFixed(2) + ' Cr' : g + '₹' + (a / 1e5).toFixed(1) + ' L';
};
export const pct = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '0.0') + '%';
export const num = (n: number) => Math.round(n).toLocaleString('en-IN');

const D = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** 6 Nov 2026 */
export const dmy = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = D(s);
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
};
/** 6 Nov */
export const dm = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = D(s);
  return d.getDate() + ' ' + MON[d.getMonth()];
};
/** Fri 6 Nov */
export const ddm = (s: string) => {
  const d = D(s);
  return DOW3[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
};
/** November 2026 from YYYY-MM */
export const monthLabel = (ym: string) => MONL[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
export const monthShort = (ym: string) => MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
/** 12 – 14 Nov, or 5 Nov */
export const range = (a: string, b: string) => {
  if (a === b) return dm(a);
  const x = D(a), y = D(b);
  return x.getMonth() === y.getMonth() ? x.getDate() + ' – ' + dm(b) : dm(a) + ' – ' + dm(b);
};
export const timeOf = (isoTs: string) => {
  const d = new Date(isoTs);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
/** Relative time against the fixed today/now. */
export const ago = (isoTs: string, now = '2026-11-06T11:00:00+05:30') => {
  const m = Math.round((Date.parse(now) - Date.parse(isoTs)) / 6e4);
  if (m < 60) return Math.max(1, m) + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : d + ' days ago';
};
