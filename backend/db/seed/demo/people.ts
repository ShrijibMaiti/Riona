import type {
  AttendanceDay, AttendanceMark, Department, Employee, EmploymentType, EmployeeStatus, LeaveRequest, LeaveType, LeaveTypeCode,
  PayrollRun, SalaryEvent, SalaryStructure, StatutoryFiling,
} from '@riona/shared';
import { HISTORY_FROM, TODAY, holidayOn } from './calendar';
import { addDays, eachDay, endOfMonth, isWeekend, iso, parse, streamFor } from './rng';

export const ME_ID = 'E-0100';
export const MD_ID = 'E-0090';

type Row = [id: string, name: string, title: string, dept: Department, mgr: string | null, loc: string, type: EmploymentType, status: EmployeeStatus, joined: string];

/** Named people from the design, plus leadership. */
const NAMED: Row[] = [
  ['E-0090', 'Rhea Kapoor', 'Managing Director', 'Leadership', null, 'Bengaluru', 'Full-time', 'Active', '2018-04-02'],
  ['E-0100', 'Dipak Sharma', 'Chief Operating Officer', 'Leadership', 'E-0090', 'Bengaluru', 'Full-time', 'Active', '2018-09-03'],
  ['E-0101', 'Ananya Rao', 'Head of People', 'People', 'E-0100', 'Bengaluru', 'Full-time', 'Active', '2019-06-03'],
  ['E-0104', 'Vikram Menon', 'Delivery Lead', 'Delivery', 'E-0100', 'Bengaluru', 'Full-time', 'Active', '2020-01-13'],
  ['E-0107', 'Meera Iyer', 'HR Business Partner', 'People', 'E-0101', 'Bengaluru', 'Full-time', 'Active', '2020-08-17'],
  ['E-0112', 'Aarav Shah', 'Senior Engineer', 'Engineering', 'E-0118', 'Bengaluru', 'Full-time', 'Active', '2023-04-03'],
  ['E-0115', 'Priya Nair', 'Product Designer', 'Design', 'E-0127', 'Kochi', 'Full-time', 'Active', '2022-02-07'],
  ['E-0118', 'Kabir Malhotra', 'Engineering Manager', 'Engineering', 'E-0100', 'Bengaluru', 'Full-time', 'Active', '2019-11-04'],
  ['E-0121', 'Rohan Kapoor', 'Frontend Engineer', 'Engineering', 'E-0118', 'Pune', 'Full-time', 'Active', '2023-09-11'],
  ['E-0124', 'Sana Qureshi', 'Finance Manager', 'Finance', 'E-0100', 'Mumbai', 'Full-time', 'Active', '2021-03-01'],
  ['E-0127', 'Tara Fernandes', 'Design Lead', 'Design', 'E-0104', 'Bengaluru', 'Full-time', 'Active', '2020-05-18'],
  ['E-0130', 'Isha Desai', 'QA Engineer', 'Engineering', 'E-0118', 'Pune', 'Full-time', 'Active', '2024-01-08'],
  ['E-0133', 'Arjun Varma', 'Account Director', 'Sales', 'E-0100', 'Mumbai', 'Full-time', 'Active', '2021-07-12'],
  ['E-0136', 'Neha Joshi', 'Business Analyst', 'Delivery', 'E-0104', 'Bengaluru', 'Full-time', 'Active', '2022-10-03'],
  ['E-0139', 'Dev Patel', 'Backend Engineer', 'Engineering', 'E-0118', 'Remote', 'Full-time', 'Active', '2023-02-20'],
  ['E-0142', 'Nikhil Bose', 'Data Engineer', 'Engineering', 'E-0118', 'Kolkata', 'Contract', 'Active', '2025-06-02'],
  ['E-0145', 'Zoya Khan', 'Recruiter', 'People', 'E-0101', 'Bengaluru', 'Full-time', 'Active', '2024-07-15'],
  ['E-0148', 'Aditya Kulkarni', 'Project Manager', 'Delivery', 'E-0104', 'Pune', 'Full-time', 'Active', '2021-12-06'],
  ['E-0151', 'Riya Sen', 'UX Researcher', 'Design', 'E-0127', 'Kolkata', 'Full-time', 'Probation', '2026-08-03'],
  ['E-0154', 'Farhan Ali', 'DevOps Engineer', 'Engineering', 'E-0118', 'Bengaluru', 'Full-time', 'Active', '2022-05-23'],
  ['E-0157', 'Kavya Pillai', 'Accounts Executive', 'Finance', 'E-0124', 'Kochi', 'Full-time', 'Active', '2023-11-13'],
  ['E-0160', 'Siddharth Rao', 'Sales Executive', 'Sales', 'E-0133', 'Mumbai', 'Full-time', 'Active', '2025-01-20'],
  ['E-0163', 'Leela Thomas', 'Office Manager', 'Operations', 'E-0101', 'Bengaluru', 'Full-time', 'Active', '2020-09-28'],
  ['E-0166', 'Omar Sheikh', 'IT Administrator', 'Operations', 'E-0163', 'Bengaluru', 'Full-time', 'Active', '2022-03-14'],
  ['E-0169', 'Pooja Shetty', 'Mobile Engineer', 'Engineering', 'E-0118', 'Remote', 'Full-time', 'Active', '2024-04-01'],
  ['E-0172', 'Harsh Vardhan', 'Intern, Engineering', 'Engineering', 'E-0139', 'Bengaluru', 'Intern', 'Active', '2026-07-01'],
];

const FIRST = ['Aditi', 'Kunal', 'Sneha', 'Rahul', 'Ishaan', 'Maya', 'Vivek', 'Anika', 'Karan', 'Divya', 'Manish', 'Tanvi', 'Arnav', 'Shreya', 'Yash', 'Nisha', 'Rohit', 'Pallavi', 'Gaurav', 'Swati', 'Aman', 'Ritika', 'Varun', 'Megha', 'Sahil', 'Kriti', 'Abhishek', 'Lavanya', 'Nitin', 'Bhavna', 'Pranav', 'Ira', 'Hemant', 'Juhi', 'Sameer', 'Trisha'];
const LAST = ['Iyengar', 'Grover', 'Bhat', 'Mehta', 'Chopra', 'Reddy', 'Banerjee', 'Gupta', 'Saxena', 'Naidu', 'Kulkarni', 'Mishra', 'Agarwal', 'Pillai', 'Sinha', 'Hegde', 'Kaur', 'Dutta', 'Chatterjee', 'Menon', 'Rastogi', 'Shenoy', 'Jain', 'Bhattacharya'];

const GEN: [Department, number, string[], string][] = [
  ['Engineering', 15, ['Software Engineer', 'Senior Engineer', 'Frontend Engineer', 'Backend Engineer', 'QA Engineer', 'Mobile Engineer', 'Data Engineer', 'DevOps Engineer'], 'E-0118'],
  ['Delivery', 5, ['Project Manager', 'Business Analyst', 'Scrum Master'], 'E-0104'],
  ['Design', 4, ['Product Designer', 'Visual Designer', 'UX Researcher'], 'E-0127'],
  ['Sales', 3, ['Sales Executive', 'Account Manager'], 'E-0133'],
  ['Operations', 3, ['Facilities Executive', 'IT Support Engineer', 'Admin Executive'], 'E-0163'],
  ['People', 2, ['HR Executive', 'Talent Partner'], 'E-0101'],
  ['Finance', 2, ['Accountant', 'Payroll Specialist'], 'E-0124'],
];

const STATE: Record<string, string> = { Bengaluru: 'Karnataka', Pune: 'Maharashtra', Mumbai: 'Maharashtra', Kochi: 'Kerala', Kolkata: 'West Bengal', Remote: 'Karnataka', Chennai: 'Tamil Nadu' };
const BILLABLE: Department[] = ['Engineering', 'Delivery', 'Design'];

/** Starting annual CTC band by title. */
function ctcBand(title: string): [number, number] {
  if (/Managing Director/.test(title)) return [9000000, 9000000];
  if (/Chief/.test(title)) return [6800000, 6800000];
  if (/Head|Director/.test(title)) return [3800000, 4800000];
  if (/Manager|Lead/.test(title)) return [2600000, 3600000];
  if (/Senior|Partner/.test(title)) return [1500000, 2200000];
  if (/Intern/.test(title)) return [300000, 300000];
  if (/Executive|Accountant|Support|Recruiter|Specialist|Admin/.test(title)) return [600000, 950000];
  return [900000, 1500000];
}
function billRateFor(title: string): number {
  if (/Lead|Manager|Head|Chief/.test(title)) return 3400;
  if (/Senior/.test(title)) return 2600;
  if (/Designer|Researcher|Analyst|Scrum/.test(title)) return 2300;
  if (/Intern/.test(title)) return 900;
  return 2100;
}

export function seedEmployees(): Employee[] {
  const r = streamFor('employees');
  const rows: Row[] = [...NAMED];
  const used = new Set(rows.map((x) => x[1]));
  let n = 175;
  for (const [dept, count, titles, mgr] of GEN) {
    for (let i = 0; i < count; i++) {
      let name = '';
      do name = r.pick(FIRST) + ' ' + r.pick(LAST);
      while (used.has(name));
      used.add(name);
      const joined = iso(new Date(2019 + r.int(0, 7), r.int(0, 11), r.int(1, 27)));
      const status: EmployeeStatus = joined > '2026-06-01' ? 'Probation' : 'Active';
      rows.push(['E-0' + n, name, r.pick(titles), dept, mgr, r.pick(['Bengaluru', 'Bengaluru', 'Pune', 'Mumbai', 'Kochi', 'Remote']), dept === 'Engineering' && r.chance(0.12) ? 'Contract' : 'Full-time', status, joined > TODAY ? '2026-09-14' : joined]);
      n += 3;
    }
  }
  return rows.map(([id, name, title, dept, mgr, loc, type, status, joined]) => {
    const pr = streamFor('emp:' + id);
    const [fn, ln] = name.split(' ');
    const phone = () => '+91 9' + String(pr.int(100000000, 999999999)).replace(/(\d{4})(\d{5})/, '$1 $2');
    const billable = BILLABLE.includes(dept) && !/Intern/.test(title) || id === ME_ID;
    return {
      id, name, title, dept, managerId: mgr, location: loc, state: STATE[loc] ?? 'Karnataka', type, status, joined,
      email: fn.toLowerCase() + '.' + ln.toLowerCase() + '@kestrel.digital',
      personalEmail: fn.toLowerCase() + '.' + ln.toLowerCase() + '@gmail.com',
      phone: phone(),
      dob: iso(new Date(1980 + pr.int(0, 22), pr.int(0, 11), pr.int(1, 27))),
      bloodGroup: pr.pick(['O+', 'B+', 'A+', 'AB+', 'O−']),
      maritalStatus: pr.chance(0.5) ? 'Married' : 'Single',
      address: pr.pick(['14, 3rd Cross, Indiranagar', 'B-702, Lodha Amara', '22 Park Street', 'Flat 4C, Kalyani Nagar', '9 Marine Drive', '41 HSR Layout, Sector 2']) + ', ' + (loc === 'Remote' ? 'Mysuru' : loc),
      emergency: { name: pr.pick(['Sunita', 'Rajesh', 'Lakshmi', 'Anil']) + ' ' + ln, relation: pr.pick(['Mother', 'Father', 'Spouse', 'Sibling']), phone: phone() },
      bank: { name: pr.pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank']), ifsc: pr.pick(['HDFC0001234', 'ICIC0000456', 'SBIN0007788', 'UTIB0000123']), accountLast4: String(pr.int(1000, 9999)) },
      pan: 'XXXXX' + pr.int(1000, 9999) + 'X',
      uan: '1008' + pr.int(10000000, 99999999),
      billable,
      billRate: id === ME_ID ? 4200 : billRateFor(title),
      noticeDays: /Intern/.test(title) ? 15 : status === 'Probation' ? 30 : 60,
      confirmationDue: status === 'Probation' ? addDays(joined, 182) : null,
    };
  });
}

// ---------------- salary ledger ----------------
/** Aarav Shah's ledger is the design's worked example, kept verbatim. */
const AARAV: Omit<SalaryEvent, 'id' | 'employeeId'>[] = [
  { type: 'Hired', effective: '2023-04-01', recorded: '2023-04-03', ctc: 1440000, actorId: 'E-0107', note: 'Offer accepted · Senior Engineer', title: 'Senior Engineer' },
  { type: 'Revised', effective: '2024-04-01', recorded: '2024-04-01', ctc: 1598400, actorId: 'E-0118', note: 'Annual revision · +11.0%' },
  { type: 'Bonus', effective: '2024-10-01', recorded: '2024-10-21', amount: 60000, actorId: 'E-0124', note: 'Festival bonus, one-time' },
  { type: 'Revised', effective: '2025-04-01', recorded: '2025-04-01', ctc: 1822000, actorId: 'E-0118', note: 'Annual revision · +14.0%' },
  { type: 'Correction', effective: '2025-07-01', recorded: '2025-07-15', amount: 1400, appliesTo: ['2025-04', '2025-05', '2025-06'], component: 'HRA', actorId: 'E-0124', note: 'HRA arrears for Apr – Jun; rent receipts filed late' },
  { type: 'Deduction', effective: '2025-11-01', recorded: '2025-11-30', amount: 12000, actorId: 'E-0124', note: 'Laptop damage recovery' },
  { type: 'Revised', effective: '2026-04-01', recorded: '2026-04-01', ctc: 1986000, actorId: 'E-0118', note: 'Annual revision · +9.0%' },
  { type: 'Correction', effective: '2026-09-01', recorded: '2026-09-12', amount: 2100, appliesTo: ['2026-06', '2026-07', '2026-08'], component: 'Special allowance', actorId: 'E-0124', note: 'April revision applied late to special allowance' },
  { type: 'Bonus', effective: '2026-10-01', recorded: '2026-10-20', amount: 75000, actorId: 'E-0124', note: 'Festival bonus, one-time' },
];

export function seedSalaryEvents(emps: Employee[]): SalaryEvent[] {
  const out: SalaryEvent[] = [];
  let n = 1;
  const push = (e: Omit<SalaryEvent, 'id'>) => out.push({ id: 'SE-' + String(n++).padStart(5, '0'), ...e });
  for (const e of emps) {
    if (e.id === 'E-0112') {
      AARAV.forEach((x) => push({ employeeId: e.id, ...x }));
      continue;
    }
    const r = streamFor('salary:' + e.id);
    const [lo, hi] = ctcBand(e.title);
    let ctc = Math.round((lo + r() * (hi - lo)) / 12000) * 12000;
    // Work backwards so the current CTC sits in band: start lower for long tenure.
    const joinYear = +e.joined.slice(0, 4);
    const revisions: number[] = [];
    for (let y = joinYear + 1; y <= 2026; y++) if (`${y}-04-01` > e.joined) revisions.push(y);
    let start = ctc;
    const pcts = revisions.map(() => 0.07 + r() * 0.08);
    for (const p of pcts) start = start / (1 + p);
    start = Math.round(start / 12000) * 12000;
    const hiredBy = e.dept === 'People' ? 'E-0101' : 'E-0107';
    push({ employeeId: e.id, type: 'Hired', effective: e.joined.slice(0, 8) + '01', recorded: e.joined, ctc: start, actorId: hiredBy, note: 'Offer accepted · ' + e.title, title: e.title });
    ctc = start;
    revisions.forEach((y, i) => {
      const prev = ctc;
      ctc = Math.round((ctc * (1 + pcts[i])) / 12000) * 12000;
      const promo = i === revisions.length - 2 && r.chance(0.25);
      push({
        employeeId: e.id, type: promo ? 'Promotion' : 'Revised', effective: `${y}-04-01`, recorded: `${y}-04-01`, ctc,
        actorId: e.managerId ?? MD_ID, note: (promo ? 'Promotion with revision · +' : 'Annual revision · +') + (((ctc - prev) / prev) * 100).toFixed(1) + '%',
      });
    });
    if (e.joined < '2026-09-01' && r.chance(0.6)) {
      push({ employeeId: e.id, type: 'Bonus', effective: '2026-10-01', recorded: '2026-10-20', amount: Math.round((ctc * 0.03) / 1000) * 1000, actorId: 'E-0124', note: 'Festival bonus, one-time' });
    }
    // A retroactive correction recorded after the months it applies to.
    if (e.joined < '2026-05-01' && r.chance(0.18)) {
      const months = r.chance(0.5) ? ['2026-06', '2026-07'] : ['2026-07', '2026-08', '2026-09'];
      const rec = r.chance(0.5) ? '2026-08-11' : '2026-10-09';
      const eff = rec.slice(0, 8) + '01';
      if (months.every((m) => m < eff.slice(0, 7))) {
        push({
          employeeId: e.id, type: 'Correction', effective: eff, recorded: rec, amount: Math.round((ctc / 12) * 0.02 / 100) * 100,
          appliesTo: months, component: r.chance(0.5) ? 'HRA' : 'Special allowance', actorId: 'E-0124',
          note: 'Arrears for ' + months.length + ' months; declaration received late',
        });
      }
    }
    if (r.chance(0.05)) push({ employeeId: e.id, type: 'Deduction', effective: '2026-08-01', recorded: '2026-08-20', amount: 8000, actorId: 'E-0124', note: 'Notice-period shortfall recovery' });
  }
  return out;
}

// ---------------- leave ----------------
export const LEAVE_TYPES: LeaveType[] = [
  { code: 'CL', name: 'Casual leave', accrual: '1 day a month', entitlement: 12, carryForwardCap: 0, encashment: 'Not encashable', appliesTo: 'All employees' },
  { code: 'SL', name: 'Sick leave', accrual: '10 days a year, credited in April', entitlement: 10, carryForwardCap: 5, encashment: 'Not encashable', appliesTo: 'All employees' },
  { code: 'EL', name: 'Earned leave', accrual: '1.5 days a month after probation', entitlement: 18, carryForwardCap: 30, encashment: 'Up to 15 days at exit', appliesTo: 'Full-time' },
  { code: 'CO', name: 'Comp-off', accrual: 'Credited per weekend day worked', entitlement: 2, carryForwardCap: 0, encashment: 'Lapses in 60 days', appliesTo: 'All employees' },
  { code: 'ML', name: 'Maternity leave', accrual: '26 weeks, Maternity Benefit Act', entitlement: 182, carryForwardCap: null, encashment: '—', appliesTo: 'Eligible employees' },
  { code: 'PL', name: 'Paternity leave', accrual: '10 working days per child', entitlement: 10, carryForwardCap: null, encashment: '—', appliesTo: 'Eligible employees' },
];

const workdaysIn = (from: string, to: string) => [...eachDay(from, to)].filter((d) => !isWeekend(d) && !holidayOn(d)).length;

/** Pending requests from the design, mapped onto the seed. */
const PENDING_LEAVE: [string, LeaveTypeCode, string, string, string, string][] = [
  ['E-0121', 'CL', '2026-11-12', '2026-11-14', 'Cousin’s wedding in Jaipur. Handover notes are with Aarav.', '2026-11-04'],
  ['E-0130', 'SL', '2026-11-05', '2026-11-05', 'Fever. Doctor’s note attached.', '2026-11-05'],
  ['E-0136', 'EL', '2026-12-22', '2026-12-26', 'Year-end travel with family.', '2026-11-03'],
  ['E-0115', 'CL', '2026-11-19', '2026-11-20', 'Moving apartments.', '2026-11-05'],
];

export function seedLeave(emps: Employee[]): LeaveRequest[] {
  const out: LeaveRequest[] = [];
  let n = 1;
  const add = (employeeId: string, type: LeaveTypeCode, from: string, to: string, reason: string, submitted: string, status: LeaveRequest['status']) =>
    out.push({ id: 'LV-' + String(n++).padStart(4, '0'), employeeId, type, from, to, days: Math.max(1, workdaysIn(from, to)), reason, submitted, status, approvalId: null });
  for (const e of emps) {
    const r = streamFor('leave:' + e.id);
    const k = r.int(2, 4);
    for (let i = 0; i < k; i++) {
      const start = addDays('2026-04-06', r.int(0, 200));
      if (start < e.joined || start > '2026-11-30') continue;
      let from = start;
      while (isWeekend(from) || holidayOn(from)) from = addDays(from, 1);
      const len = r.pick([0, 0, 0, 1, 1, 2, 4]);
      let to = addDays(from, len);
      while (isWeekend(to)) to = addDays(to, -1);
      if (to < from) to = from;
      const type: LeaveTypeCode = len === 0 ? r.pick(['CL', 'SL', 'CL']) : len >= 4 ? 'EL' : r.pick(['CL', 'EL']);
      if (out.some((x) => x.employeeId === e.id && !(to < x.from || from > x.to))) continue;
      const submitted = addDays(from, -r.int(2, 14));
      const status = from > TODAY ? (r.chance(0.6) ? 'Approved' : 'Pending') : r.chance(0.06) ? 'Rejected' : 'Approved';
      if (status === 'Pending' && from > TODAY) continue; // only the design's pending set stays pending
      add(e.id, type, from, to, r.pick(['Family function', 'Personal work', 'Travel', 'Unwell', 'Festival at home', 'Child’s school event']), submitted > TODAY ? TODAY : submitted, status);
    }
  }
  // Year-end: the delivery team clusters around Christmas (the leave calendar's threshold case).
  const delivery = emps.filter((e) => ['Engineering', 'Delivery', 'Design'].includes(e.dept) && e.id !== 'E-0136').slice(0, 18);
  delivery.forEach((e, i) => {
    if (out.some((x) => x.employeeId === e.id && x.to >= '2026-12-18')) return;
    const from = i % 3 === 0 ? '2026-12-21' : '2026-12-22';
    add(e.id, 'EL', from, i % 2 ? '2026-12-24' : '2026-12-23', 'Year-end break.', addDays('2026-10-20', i), 'Approved');
  });
  // Long leave for one person so "on leave today" has substance.
  add('E-0187', 'EL', '2026-11-02', '2026-11-13', 'Wedding.', '2026-10-12', 'Approved');
  for (const [id, t, f, to, why, sub] of PENDING_LEAVE) add(id, t, f, to, why, sub, 'Pending');
  add('E-0157', 'CL', '2026-11-09', '2026-11-12', 'Personal.', '2026-10-28', 'Rejected');
  return out;
}

// ---------------- attendance ----------------
export function seedAttendance(emps: Employee[], leave: LeaveRequest[]): AttendanceDay[] {
  const out: AttendanceDay[] = [];
  const approved = leave.filter((l) => l.status === 'Approved');
  for (const e of emps) {
    const r = streamFor('att:' + e.id);
    const from = e.joined > HISTORY_FROM ? e.joined : HISTORY_FROM;
    for (const d of eachDay(from, TODAY)) {
      let mark: AttendanceMark;
      let inT: string | null = null, outT: string | null = null;
      const hol = holidayOn(d);
      const onLeave = approved.find((l) => l.employeeId === e.id && d >= l.from && d <= l.to);
      if (isWeekend(d)) mark = 'Weekend';
      else if (hol) mark = 'Holiday';
      else if (onLeave) mark = 'Leave';
      else {
        const x = r();
        mark = x > 0.985 ? 'Absent' : x > 0.965 ? 'Half day' : x > 0.9 ? 'Late' : x > 0.8 ? 'WFH' : 'P';
        if (mark !== 'Absent') {
          const late = mark === 'Late';
          inT = (late ? '10:' : '09:') + String(late ? r.int(5, 40) : r.int(2, 29)).padStart(2, '0');
          outT = mark === 'Half day' ? '13:' + String(r.int(30, 59)).padStart(2, '0') : String(r.int(18, 19)) + ':' + String(r.int(0, 59)).padStart(2, '0');
          if (d === TODAY) outT = null;
        }
      }
      out.push({ id: 'AT-' + e.id.slice(2) + '-' + d.replace(/-/g, ''), employeeId: e.id, date: d, mark, in: inT, out: outT });
    }
  }
  // Design: missed punch-out (Rohan, 3 Nov) and unmarked WFH (Nikhil, 2 Nov) awaiting regularisation.
  const fix = (emp: string, date: string, patch: Partial<AttendanceDay>) => {
    const a = out.find((x) => x.employeeId === emp && x.date === date);
    if (a) Object.assign(a, patch);
  };
  fix('E-0121', '2026-11-03', { mark: 'P', in: '09:12', out: null });
  fix('E-0142', '2026-11-02', { mark: 'Absent', in: null, out: null });
  return out;
}

// ---------------- payroll ----------------
export const PAYROLL_MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

export function seedPayrollRuns(emps: Employee[], events: SalaryEvent[]): PayrollRun[] {
  return PAYROLL_MONTHS.map((m) => {
    const lockDate = m + '-25';
    const end = endOfMonth(m);
    const current = m === TODAY.slice(0, 7);
    const ids = emps.filter((e) => e.joined <= end).map((e) => e.id);
    return {
      id: 'PR-' + m.replace('-', ''),
      month: m,
      stage: current ? 'Inputs' : 'Disbursed',
      lockDate,
      disbursedOn: current ? null : end,
      employeeIds: ids,
      salaryEventIds: events.filter((x) => ids.includes(x.employeeId) && x.effective <= end && x.recorded <= (current ? TODAY : lockDate)).map((x) => x.id),
      attendanceFrom: m + '-01',
      attendanceTo: current ? TODAY : end,
      bankFileIssues: m === '2026-10' ? [{ employeeId: 'E-0157', issue: 'IFSC mismatch' }, { employeeId: 'E-0166', issue: 'IFSC mismatch' }] : [],
    };
  });
}

export const STRUCTURES: SalaryStructure[] = [
  {
    id: 'SS-1', name: 'Standard · new regime', appliesTo: 'Full-time employees',
    components: [
      { id: 'C1', name: 'Basic', kind: 'Earning', formula: 'MONTHLY * 0.40', taxable: true },
      { id: 'C2', name: 'House rent allowance', kind: 'Earning', formula: 'BASIC * 0.50', taxable: true },
      { id: 'C3', name: 'Employer PF', kind: 'Employer contribution', formula: 'MIN(1800, BASIC * 0.12)', taxable: false },
      { id: 'C4', name: 'Special allowance', kind: 'Earning', formula: 'MONTHLY - BASIC - HRA - EMPLOYER_PF', taxable: true },
      { id: 'C5', name: 'Provident fund', kind: 'Deduction', formula: 'MIN(1800, BASIC * 0.12)', taxable: false },
      { id: 'C6', name: 'Professional tax', kind: 'Deduction', formula: 'STATE_PT', taxable: false },
    ],
  },
  {
    id: 'SS-2', name: 'Contract · flat', appliesTo: 'Contract staff',
    components: [
      { id: 'C7', name: 'Consulting fee', kind: 'Earning', formula: 'MONTHLY', taxable: true },
      { id: 'C8', name: 'TDS · 194J', kind: 'Deduction', formula: 'MONTHLY * 0.10', taxable: false },
    ],
  },
  {
    id: 'SS-3', name: 'Intern stipend', appliesTo: 'Interns',
    components: [{ id: 'C9', name: 'Stipend', kind: 'Earning', formula: 'MONTHLY', taxable: true }],
  },
];

export function seedFilings(): StatutoryFiling[] {
  const out: StatutoryFiling[] = [];
  let n = 1;
  for (const m of PAYROLL_MONTHS) {
    const [y, mo] = m.split('-').map(Number);
    const next = iso(new Date(y, mo, 15));
    const filed = next <= TODAY;
    for (const kind of ['PF', 'ESI', 'PT'] as const)
      out.push({ id: 'SF-' + n++, kind, period: m, due: kind === 'PT' ? iso(new Date(y, mo, 20)) : next, filedOn: filed ? addDays(next, -2) : null, reference: filed ? kind + '/' + m.replace('-', '') + '/' + (4400 + n) : null });
  }
  for (const [q, due] of [['Q1 FY27', '2026-07-31'], ['Q2 FY27', '2026-10-31'], ['Q3 FY27', '2027-01-31']] as const)
    out.push({ id: 'SF-' + n++, kind: 'TDS', period: q, due, filedOn: due <= TODAY ? addDays(due, -3) : null, reference: due <= TODAY ? '24Q-' + q.replace(/\s/g, '') : null });
  return out;
}

export { parse };
