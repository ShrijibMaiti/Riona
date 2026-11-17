import type {
  AppUser, Asset, AuditEvent, Booking, Candidate, CandidateStage, Certification, Client, Contract, Document, Employee, Goal, InventoryItem,
  Job, KbArticle, Lead, LeadStage, MasterList, NotificationRule, OnboardingCase, Project, Review, ReviewCycle, RoleDef, Room, SystemJob,
  Ticket, TrainingProgramme, Announcement, Visitor, Workflow,
} from '@riona/shared';
import { HISTORY_FROM, TODAY } from './calendar';
import { addDays, streamFor, ts } from './rng';

// ---------------- recruitment ----------------
export function seedJobs(): Job[] {
  return [
    ['J-31', 'Senior Backend Engineer', 'Engineering', 'Bengaluru', 2, 'E-0118', '2026-09-02'],
    ['J-32', 'Mobile Engineer (Flutter)', 'Engineering', 'Remote', 1, 'E-0118', '2026-09-20'],
    ['J-33', 'Product Designer', 'Design', 'Bengaluru', 1, 'E-0127', '2026-10-01'],
    ['J-34', 'QA Automation Engineer', 'Engineering', 'Pune', 2, 'E-0118', '2026-10-06'],
    ['J-35', 'Account Manager', 'Sales', 'Mumbai', 1, 'E-0133', '2026-08-18'],
    ['J-36', 'Payroll Specialist', 'Finance', 'Mumbai', 1, 'E-0124', '2026-10-14'],
    ['J-37', 'Data Engineer', 'Engineering', 'Kolkata', 1, 'E-0118', '2026-10-21'],
    ['J-28', 'Engineering Manager', 'Engineering', 'Bengaluru', 1, 'E-0100', '2026-06-10'],
  ].map(([id, title, dept, location, openings, hm, posted]) => ({
    id: id as string, title: title as string, dept: dept as Job['dept'], location: location as string, openings: openings as number,
    hiringManagerId: hm as string, posted: posted as string, status: id === 'J-28' ? 'On hold' : 'Open',
  }));
}

const CAND_FIRST = ['Anirudh', 'Bhavya', 'Chetan', 'Disha', 'Eshan', 'Fatima', 'Girish', 'Harini', 'Irfan', 'Jaya', 'Kiran', 'Lata', 'Mohit', 'Nandini', 'Ojas', 'Parul', 'Qadir', 'Rashmi', 'Suresh', 'Tanya', 'Uday', 'Vaishali', 'Waseem', 'Yamini'];
const CAND_LAST = ['Rao', 'Sharma', 'Nair', 'Gill', 'Bose', 'Mehra', 'Kamath', 'Shah', 'Das', 'Pandey', 'Iyer', 'Kohli'];

export function seedCandidates(jobs: Job[], emps: Employee[]): Candidate[] {
  const out: Candidate[] = [];
  const interviewers = emps.filter((e) => ['Engineering', 'Design', 'Sales', 'Finance'].includes(e.dept) && /Senior|Lead|Manager|Director/.test(e.title));
  for (const j of jobs) {
    const r = streamFor('cand:' + j.id);
    const n = r.int(4, 9);
    for (let i = 0; i < n; i++) {
      const stage: CandidateStage = r.pick(['Applied', 'Applied', 'Screening', 'Screening', 'Interviewing', 'Interviewing', 'Offer', 'Rejected']);
      const nm = r.pick(CAND_FIRST) + ' ' + r.pick(CAND_LAST);
      const applied = addDays(j.posted, r.int(1, 40) > 0 ? r.int(1, Math.max(2, Math.min(60, (Date.parse(TODAY) - Date.parse(j.posted)) / 864e5))) : 1);
      const rounds = stage === 'Interviewing' || stage === 'Offer' || (stage === 'Rejected' && r.chance(0.5)) ? r.int(1, 3) : 0;
      out.push({
        id: 'CA-' + (500 + out.length), jobId: j.id, name: nm, email: nm.toLowerCase().replace(' ', '.') + '@mail.com', source: r.pick(['LinkedIn', 'Referral', 'Careers page', 'Naukri', 'Agency']),
        stage, applied: applied > TODAY ? TODAY : applied, experienceYears: r.int(2, 12), currentCompany: r.pick(['Infosys', 'Swiggy', 'Freshworks', 'Zoho', 'Razorpay', 'TCS', 'Thoughtworks', 'Flipkart']),
        notes: r.pick(['Strong systems design.', 'Good portfolio; asks sharp questions.', 'Notice period 90 days.', 'Relocating from Hyderabad.', 'Referred by a former colleague.']),
        interviews: Array.from({ length: rounds }, (_, k) => ({
          id: 'IV-' + out.length + '-' + k, round: ['Technical screen', 'Deep dive', 'Culture and values'][k], interviewerId: r.pick(interviewers).id,
          date: addDays(applied, 5 + k * 6) > TODAY ? addDays(TODAY, k + 1) : addDays(applied, 5 + k * 6),
          outcome: addDays(applied, 5 + k * 6) > TODAY ? 'Pending' : stage === 'Rejected' && k === rounds - 1 ? 'No' : r.pick(['Yes', 'Strong yes'] as const),
        })),
      });
    }
  }
  return out;
}

// ---------------- onboarding ----------------
const ITEMS: [OnboardingCase['items'][number]['owner'], string][] = [
  ['HR', 'Offer letter signed'], ['HR', 'Documents collected (ID, PAN, bank)'], ['HR', 'Policies acknowledged'], ['HR', 'PF nomination filed'], ['HR', 'Payroll profile created'],
  ['IT', 'Laptop provisioned'], ['IT', 'Email and SSO account'], ['IT', 'Slack and Jira access'], ['IT', 'Security training assigned'], ['IT', 'Building access card'],
  ['Manager', 'Buddy assigned'], ['Manager', 'First-week plan shared'], ['Manager', '30-day goals set'], ['Manager', 'Team introduction'], ['Manager', 'Project allocation'],
  ['Finance', 'Bank account verified'], ['Finance', 'Expense card issued'], ['Finance', 'Cost centre mapped'], ['Finance', 'Tax declaration collected'], ['Finance', 'Reimbursement policy shared'],
];
const LEAVING: [OnboardingCase['items'][number]['owner'], string][] = [
  ['HR', 'Resignation accepted'], ['HR', 'Exit interview'], ['IT', 'Laptop returned'], ['IT', 'Accounts deactivated'], ['Manager', 'Handover complete'],
  ['Finance', 'Full and final settlement'], ['Finance', 'Expense advances cleared'], ['HR', 'Relieving letter issued'], ['HR', 'Experience letter issued'], ['Manager', 'Knowledge-base notes'],
];
export function seedOnboarding(): OnboardingCase[] {
  const rows: [string, OnboardingCase['kind'], string | null, string, string, OnboardingCase['dept'], string, number][] = [
    ['OB-21', 'Joining', null, 'Kunal Grover', 'Backend Engineer', 'Engineering', '2026-11-23', 2],
    ['OB-22', 'Joining', null, 'Anika Bhat', 'Product Designer', 'Design', '2026-11-30', 6],
    ['OB-23', 'Joining', null, 'Ishaan Mehta', 'Frontend Engineer', 'Engineering', '2026-11-16', 11],
    ['OB-24', 'Joining', null, 'Maya Iyengar', 'Account Manager', 'Sales', '2026-11-09', 17],
    ['OB-19', 'Joining', 'E-0151', 'Riya Sen', 'UX Researcher', 'Design', '2026-08-03', 18],
    ['OB-20', 'Joining', 'E-0172', 'Harsh Vardhan', 'Intern, Engineering', 'Engineering', '2026-07-01', 19],
    ['OB-25', 'Leaving', null, 'Arvind Saxena', 'Senior Engineer', 'Engineering', '2026-11-28', 4],
  ];
  return rows.map(([id, kind, employeeId, personName, title, dept, date, done]) => {
    const list = kind === 'Joining' ? ITEMS : LEAVING;
    const order = [...list.keys()].sort((a, b) => (a % 5) - (b % 5) || a - b);
    const doneSet = new Set(order.slice(0, done));
    return { id, kind, employeeId, personName, title, dept, date, items: list.map(([owner, label], i) => ({ id: id + '-I' + i, owner, label, done: doneSet.has(i), doneOn: doneSet.has(i) ? addDays(TODAY, -((i % 9) + 1)) : null })) };
  });
}

// ---------------- performance ----------------
export const CYCLES: ReviewCycle[] = [
  { id: 'RC-H2-26', name: 'H2 2026', period: 'Apr – Sep 2026', stage: 'Self review', selfDue: '2026-11-15', managerDue: '2026-11-30' },
  { id: 'RC-H1-26', name: 'H1 2026', period: 'Oct 2025 – Mar 2026', stage: 'Closed', selfDue: '2026-04-15', managerDue: '2026-04-30' },
  { id: 'RC-H2-25', name: 'H2 2025', period: 'Apr – Sep 2025', stage: 'Closed', selfDue: '2025-10-15', managerDue: '2025-10-31' },
];
export const REVIEW_QUESTIONS = ['What did you deliver this cycle that you are proudest of?', 'Where did you fall short, and what got in the way?', 'What will you focus on next cycle?'];
export function seedReviews(emps: Employee[]): { reviews: Review[]; goals: Goal[] } {
  const reviews: Review[] = [];
  const goals: Goal[] = [];
  for (const e of emps) {
    if (!e.managerId) continue;
    const r = streamFor('rev:' + e.id);
    for (const c of CYCLES) {
      if (c.id !== 'RC-H2-26' && e.joined > '2026-03-31') continue;
      if (c.id === 'RC-H2-25' && e.joined > '2025-09-30') continue;
      const closed = c.stage === 'Closed';
      const status = closed ? 'Completed' : r.chance(0.64) ? 'Self review' : 'Not started';
      reviews.push({
        id: 'RV-' + e.id.slice(2) + '-' + c.id.slice(3), cycleId: c.id, employeeId: e.id, reviewerId: e.managerId, status,
        rating: closed ? r.pick(['Exceeds expectations', 'Meets expectations', 'Meets expectations', 'Meets expectations', 'Below expectations'] as const) : null,
        selfAnswers: status === 'Not started' ? [] : ['Shipped the work I committed to, on time.', 'Underestimated integration effort twice.', 'Grow into owning a module end to end.'],
        managerAnswers: closed ? ['Reliable and thoughtful.', 'Should raise risks earlier.', 'Ready for more scope.'] : [],
      });
    }
    const n = e.id === 'E-0112' ? 0 : r.int(2, 3);
    for (let i = 0; i < n; i++) goals.push({ id: 'GL-' + e.id.slice(2) + '-' + i, employeeId: e.id, cycleId: 'RC-H2-26', title: r.pick(['Reduce bug escape rate', 'Ship the client’s next release', 'Mentor a new joiner', 'Improve estimate accuracy', 'Complete a certification', 'Document the module']), progress: r.int(10, 95), measure: r.pick(['3 of 5 key results', '1 of 2 complete', 'On track', '60% of target']) });
  }
  goals.push(
    { id: 'GL-0112-0', employeeId: 'E-0112', cycleId: 'RC-H2-26', title: 'Ship the route planner to Northwind', progress: 70, measure: '7 of 10 key results' },
    { id: 'GL-0112-1', employeeId: 'E-0112', cycleId: 'RC-H2-26', title: 'Mentor two engineers through their first release', progress: 50, measure: '1 of 2 complete' },
    { id: 'GL-0112-2', employeeId: 'E-0112', cycleId: 'RC-H2-26', title: 'Bring dispatch p95 latency under 300 ms', progress: 85, measure: '340 → 310 ms' },
  );
  return { reviews, goals };
}

// ---------------- training ----------------
export const PROGRAMMES: TrainingProgramme[] = [
  { id: 'TR-1', name: 'POSH awareness', kind: 'Compliance', mandatory: true, validityMonths: 12 },
  { id: 'TR-2', name: 'Information security basics', kind: 'Compliance', mandatory: true, validityMonths: 12 },
  { id: 'TR-3', name: 'First aid', kind: 'Certification', mandatory: false, validityMonths: 24 },
  { id: 'TR-4', name: 'AWS Solutions Architect', kind: 'Certification', mandatory: false, validityMonths: 36 },
  { id: 'TR-5', name: 'Accessibility for product teams', kind: 'Course', mandatory: false, validityMonths: null },
  { id: 'TR-6', name: 'Fire warden', kind: 'Certification', mandatory: false, validityMonths: 12 },
];
export function seedCertifications(emps: Employee[]): Certification[] {
  const out: Certification[] = [];
  for (const e of emps) {
    const r = streamFor('cert:' + e.id);
    for (const p of PROGRAMMES) {
      if (!p.mandatory && !r.chance(p.id === 'TR-4' ? (e.dept === 'Engineering' ? 0.3 : 0) : p.id === 'TR-3' || p.id === 'TR-6' ? (e.dept === 'Operations' ? 0.8 : 0.05) : 0.2)) continue;
      const done = r.chance(p.mandatory ? 0.88 : 0.95);
      const completed = done ? addDays(TODAY, -r.int(20, 700)) : null;
      const expires = completed && p.validityMonths ? addDays(completed, Math.round(p.validityMonths * 30.4)) : null;
      const status = !completed ? 'Assigned' : expires && expires < TODAY ? 'Expired' : expires && expires < addDays(TODAY, 45) ? 'Expiring' : 'Valid';
      out.push({ id: 'CT-' + out.length, programmeId: p.id, employeeId: e.id, completed, expires, status });
    }
  }
  const leela = out.find((c) => c.employeeId === 'E-0163' && c.programmeId === 'TR-3');
  if (leela) Object.assign(leela, { completed: '2024-10-28', expires: '2026-10-28', status: 'Expired' });
  else out.push({ id: 'CT-L', programmeId: 'TR-3', employeeId: 'E-0163', completed: '2024-10-28', expires: '2026-10-28', status: 'Expired' });
  return out;
}

// ---------------- clients extra ----------------
export function seedLeads(): Lead[] {
  const rows: [string, string, number, LeadStage, string, string, string, number][] = [
    ['Coral Insurance', 'Pooja Bhalla', 4200000, 'Proposal sent', 'E-0133', '2026-10-12', 'Referral', 50],
    ['Trident Pharma', 'Alok Verma', 6800000, 'Negotiation', 'E-0133', '2026-10-28', 'Outbound', 70],
    ['Kaveri Textiles', 'Meenakshi S', 1800000, 'Qualified', 'E-0160', '2026-10-30', 'Inbound', 30],
    ['Orbit Telecom', 'Sudhir Nayak', 5400000, 'Qualified', 'E-0133', '2026-10-19', 'Event', 30],
    ['Pinecrest Schools', 'Ritu Anand', 1200000, 'New', 'E-0160', '2026-11-03', 'Inbound', 10],
    ['Harbour Freight', 'Vikas Jain', 2300000, 'New', 'E-0160', '2026-11-05', 'Outbound', 10],
    ['Aurora Labs', 'Nikita Paul', 3100000, 'Proposal sent', 'E-0133', '2026-10-24', 'Referral', 50],
    ['Sunbeam Solar', 'Raghav Iyer', 2700000, 'Won', 'E-0133', '2026-09-30', 'Inbound', 100],
    ['Meridian Bank', 'Shweta Rao', 9000000, 'Lost', 'E-0133', '2026-09-12', 'Outbound', 0],
  ];
  return rows.map(([company, contact, value, stage, ownerId, stageSince, source, probability], i) => ({
    id: 'LD-' + (40 + i), company, contact, value, stage, ownerId, stageSince, source, probability, created: addDays(stageSince, -20 - i * 3),
    notes: stage === 'Lost' ? 'Went with an incumbent vendor on price.' : 'Decision maker engaged; budget confirmed for next quarter.',
    activity: [
      { at: addDays(stageSince, -20 - i * 3), text: 'Lead created from ' + source.toLowerCase(), byId: ownerId },
      { at: addDays(stageSince, -6), text: 'Discovery call · 45 min', byId: ownerId },
      { at: stageSince, text: 'Moved to ' + stage, byId: ownerId },
    ],
  }));
}

export function seedContracts(clients: Client[]): Contract[] {
  const out: Contract[] = [];
  const ends: Record<string, string> = { 'C-11': '2027-03-31', 'C-14': '2027-05-31', 'C-17': '2026-11-30', 'C-19': '2026-12-28', 'C-22': '2027-06-30', 'C-25': '2027-09-30', 'C-28': '2027-05-17', 'C-31': '2027-06-14' };
  clients.forEach((c, i) => {
    out.push({ id: 'CT-' + (100 + i * 2), clientId: c.id, title: 'Master services agreement', kind: 'MSA', start: c.since, end: ends[c.id], value: 0, autoRenew: c.id === 'C-17', slaResponseHours: 4, slaResolutionHours: [24, 48][i % 2], status: 'Active' });
    out.push({ id: 'CT-' + (101 + i * 2), clientId: c.id, title: 'Support and maintenance', kind: 'AMC', start: '2026-04-01', end: i === 3 ? '2026-10-31' : '2027-03-31', value: 600000 + i * 120000, autoRenew: false, slaResponseHours: 2, slaResolutionHours: 24, status: i === 3 ? 'Expired' : 'Active' });
  });
  return out;
}

export function seedTickets(clients: Client[], projects: Project[]): Ticket[] {
  const rows: [string, string, string, Ticket['priority'], string, Ticket['status'], string, number][] = [
    ['TK-1182', 'Route export times out over 5k rows', 'C-11', 'Urgent', 'E-0139', 'Open', '2026-11-05T09:12:00+05:30', 24],
    ['TK-1179', 'Appointment reminders sent twice', 'C-14', 'High', 'E-0169', 'In progress', '2026-11-05T14:40:00+05:30', 24],
    ['TK-1176', 'Advisor login loops on Safari', 'C-17', 'High', 'E-0154', 'In progress', '2026-11-05T19:30:00+05:30', 24],
    ['TK-1171', 'Bulk order CSV rejects valid GSTIN', 'C-22', 'Medium', 'E-0130', 'Waiting on client', '2026-11-04T11:00:00+05:30', 48],
    ['TK-1168', 'Add depot code to invoice PDF', 'C-11', 'Low', 'E-0121', 'Open', '2026-11-03T16:20:00+05:30', 96],
    ['TK-1164', 'Points not credited on returns', 'C-19', 'Medium', 'E-0136', 'Resolved', '2026-10-28T10:05:00+05:30', 48],
    ['TK-1161', 'Driver app crashes on Android 11', 'C-25', 'High', 'E-0169', 'Open', '2026-11-06T08:30:00+05:30', 24],
    ['TK-1158', 'Room-service menu images missing', 'C-28', 'Low', 'E-0115', 'Open', '2026-11-02T12:00:00+05:30', 120],
    ['TK-1155', 'Grid alerts delayed by 10 minutes', 'C-31', 'Urgent', 'E-0154', 'In progress', '2026-11-06T07:50:00+05:30', 8],
  ];
  return rows.map(([id, subject, clientId, priority, assigneeId, status, opened, sla]) => {
    const client = clients.find((c) => c.id === clientId)!;
    const proj = projects.find((p) => p.clientId === clientId && p.status === 'Active') ?? null;
    const due = new Date(Date.parse(opened) + sla * 36e5).toISOString();
    const contact = client.contacts[0].name;
    return {
      id, subject, clientId, projectId: proj?.id ?? null, priority, assigneeId, status, opened, slaDue: due,
      resolved: status === 'Resolved' ? '2026-10-29T15:00:00+05:30' : null,
      messages: [
        { id: id + '-M1', at: opened, author: contact, authorId: null, internal: false, text: subject + '. Can you take a look today?' },
        { id: id + '-M2', at: new Date(Date.parse(opened) + 35 * 6e4).toISOString(), author: 'Riona', authorId: assigneeId, internal: true, text: 'Reproduced on staging. Looks like it started with the last release.' },
        { id: id + '-M3', at: new Date(Date.parse(opened) + 50 * 6e4).toISOString(), author: 'Support', authorId: assigneeId, internal: false, text: 'Thanks — we have reproduced it and are working on a fix. Next update within two hours.' },
      ],
    };
  });
}

// ---------------- workplace ----------------
export function seedAssets(emps: Employee[]): Asset[] {
  const out: Asset[] = [];
  const models: [Asset['category'], string, number, string][] = [
    ['Laptop', 'MacBook Pro 14″ M3', 198000, 'LT'], ['Laptop', 'MacBook Air 13″ M2', 112000, 'LT'], ['Laptop', 'ThinkPad T14', 96000, 'LT'],
    ['Monitor', 'Dell U2723QE', 52000, 'MN'], ['Accessory', 'Logitech MX Keys', 11000, 'AC'], ['Phone', 'Pixel 8 (test device)', 58000, 'PH'],
  ];
  let n = 100;
  for (const e of emps) {
    const r = streamFor('asset:' + e.id);
    const lap = r.pick(models.slice(0, 3));
    const items: (typeof models)[number][] = [lap, models[3]];
    if (r.chance(0.5)) items.push(models[4]);
    if (e.dept === 'Engineering' && r.chance(0.3)) items.push(models[5]);
    for (const [cat, name, cost, code] of items) {
      const from = e.joined > '2024-01-01' ? e.joined : addDays('2024-01-02', r.int(0, 600));
      out.push({ id: 'AS-' + n, tag: 'KD-' + code + '-' + String(n).padStart(4, '0'), name, category: cat, serial: 'SN' + r.int(100000, 999999), purchased: addDays(from, -r.int(3, 40)), cost, status: 'Allocated', allocations: [{ employeeId: e.id, from, to: null, note: 'Issued at joining' }] });
      n++;
    }
  }
  for (let i = 0; i < 36; i++) {
    const [cat, name, cost, code] = models[i % models.length];
    const prior = i % 4 === 0 ? [{ employeeId: emps[(i * 7) % emps.length].id, from: '2024-02-01', to: '2026-06-30', note: 'Returned on upgrade' }] : [];
    out.push({ id: 'AS-' + n, tag: 'KD-' + code + '-' + String(n).padStart(4, '0'), name, category: cat, serial: 'SN' + (300000 + i * 17), purchased: '2025-11-1' + (i % 9), cost, status: i === 5 ? 'Under repair' : 'Available', allocations: prior });
    n++;
  }
  return out;
}

export function seedInventory(): InventoryItem[] {
  const rows: [string, string, number, number, string][] = [
    ['A4 paper (ream)', 'ream', 4, 20, 'Bengaluru · Store'], ['Printer toner', 'cartridge', 1, 3, 'Bengaluru · Store'], ['Coffee beans', 'kg', 2, 5, 'Bengaluru · Pantry'],
    ['Whiteboard markers', 'box', 9, 4, 'Bengaluru · Store'], ['HDMI cables', 'piece', 14, 6, 'Bengaluru · IT room'], ['Visitor badges', 'piece', 60, 30, 'Bengaluru · Reception'],
    ['Notebooks', 'piece', 48, 20, 'Pune · Store'], ['First-aid kits', 'kit', 3, 2, 'Bengaluru · Reception'], ['Tea (assorted)', 'box', 11, 6, 'Pune · Pantry'],
  ];
  return rows.map(([name, unit, stock, reorderLevel, location], i) => ({
    id: 'IN-' + (10 + i), name, unit, stock, reorderLevel, location,
    movements: [
      { id: 'MV-' + i + '-1', date: '2026-10-01', kind: 'in', qty: stock + reorderLevel + 4, note: 'Monthly restock', byId: 'E-0163' },
      { id: 'MV-' + i + '-2', date: '2026-10-22', kind: 'out', qty: reorderLevel + 4, note: 'Issued to floors', byId: 'E-0166' },
    ],
  }));
}

export const ROOMS: Room[] = [
  { id: 'RM-1', name: 'Nilgiri', floor: '3', capacity: 12, equipment: ['Display', 'VC'] },
  { id: 'RM-2', name: 'Western Ghats', floor: '3', capacity: 8, equipment: ['Display', 'Whiteboard'] },
  { id: 'RM-3', name: 'Kaveri', floor: '3', capacity: 4, equipment: ['Display'] },
  { id: 'RM-4', name: 'Sahyadri', floor: '4', capacity: 6, equipment: ['VC'] },
  { id: 'RM-5', name: 'Thar', floor: '4', capacity: 2, equipment: [] },
  { id: 'RM-6', name: 'Sundarbans', floor: '4', capacity: 16, equipment: ['Display', 'VC', 'Whiteboard'] },
  { id: 'RM-7', name: 'Konkan', floor: '2', capacity: 4, equipment: ['Whiteboard'] },
  { id: 'RM-8', name: 'Deccan', floor: '2', capacity: 10, equipment: ['Display', 'VC'] },
];
export function seedBookings(emps: Employee[]): Booking[] {
  const out: Booking[] = [];
  const titles = ['Sprint planning', 'Client call · Northwind', 'Design review', '1:1', 'Interview loop', 'All-hands prep', 'Retro', 'Finance close', 'Hiring sync'];
  for (let day = -2; day <= 7; day++) {
    const date = addDays(TODAY, day);
    const r = streamFor('book:' + date);
    for (const room of ROOMS) {
      let t = 9 * 60 + r.int(0, 3) * 30;
      while (t < 18 * 60) {
        if (r.chance(0.45)) {
          const len = r.pick([30, 60, 60, 90]);
          const hh = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
          out.push({ id: 'BK-' + out.length, roomId: room.id, date, start: hh(t), end: hh(Math.min(t + len, 19 * 60)), title: r.pick(titles), bookedById: r.pick(emps).id });
          t += len;
        }
        t += r.pick([30, 60]);
      }
    }
  }
  return out;
}

export function seedAnnouncements(emps: Employee[]): Announcement[] {
  const all = emps.map((e) => e.id);
  const ack = (seed: string, p: number) => { const r = streamFor(seed); return all.filter(() => r.chance(p)); };
  return [
    { id: 'AN-31', title: 'Holiday list 2027', body: 'The 2027 holiday calendar is published under Masters. Twelve fixed holidays and two floating days. Please acknowledge so payroll can plan comp-offs.', authorId: 'E-0101', posted: '2026-11-06', pinned: true, audience: 'Everyone', requiresAck: true, audienceIds: all, ackIds: ack('an31', 0.61) },
    { id: 'AN-30', title: 'New travel policy, effective 1 December', body: 'Economy for flights under four hours, pre-approval for anything over ₹25,000, and per-diems revised for metro cities.', authorId: 'E-0124', posted: '2026-11-05', pinned: false, audience: 'Everyone', requiresAck: true, audienceIds: all, ackIds: ack('an30', 0.34) },
    { id: 'AN-29', title: 'Diwali celebrations on 6 November', body: 'Lunch at 1 pm on the terrace in Bengaluru and Pune. Remote colleagues: snacks are on their way.', authorId: 'E-0163', posted: '2026-11-02', pinned: false, audience: 'Everyone', requiresAck: false, audienceIds: all, ackIds: [] },
    { id: 'AN-28', title: 'H2 self-reviews open', body: 'Self-reviews for H2 2026 are open until 15 November. Managers will complete theirs by the 30th.', authorId: 'E-0101', posted: '2026-10-30', pinned: false, audience: 'Everyone', requiresAck: false, audienceIds: all, ackIds: [] },
    { id: 'AN-27', title: 'Office Wi-Fi maintenance', body: 'The Bengaluru network will be down between 8 and 10 pm on Saturday.', authorId: 'E-0166', posted: '2026-10-24', pinned: false, audience: 'Bengaluru', requiresAck: false, audienceIds: emps.filter((e) => e.location === 'Bengaluru').map((e) => e.id), ackIds: [] },
  ];
}

export function seedKb(): KbArticle[] {
  const art = (id: string, title: string, category: string, updated: string, authorId: string, sections: [string, string[]][]): KbArticle => ({
    id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), title, category, updated, authorId,
    sections: sections.map(([h, b], i) => ({ id: 's' + i, heading: h, body: b })),
  });
  return [
    art('KB-1', 'Leave policy 2026', 'Policies', '2026-11-03', 'E-0101', [
      ['Who this applies to', ['All employees on the Kestrel Digital payroll, including those on probation. Contract staff follow the terms in their agreement.']],
      ['Leave types', ['Casual leave accrues at one day a month and lapses on 31 March.', 'Sick leave is credited as ten days each April; up to five carry forward.', 'Earned leave accrues at one and a half days a month after probation and can be carried forward up to thirty days.']],
      ['Applying', ['Apply from My Space at least three working days ahead for planned leave. Sick leave can be applied for on the day.', 'Your reporting manager approves; leave longer than five days also goes to your department head.']],
      ['Team thresholds', ['No more than forty percent of a delivery team may be away on the same day. Requests that cross the threshold are flagged to the approver.']],
      ['Encashment', ['Earned leave of up to fifteen days is encashed at exit at the basic rate.']],
    ]),
    art('KB-2', 'Expense reimbursement guide', 'Finance', '2026-11-02', 'E-0124', [
      ['What can be claimed', ['Travel, meals with clients, software and hardware approved by your manager, and training approved in your goals.']],
      ['Receipts', ['Every claim needs a receipt. GST invoices are required above ₹2,000.']],
      ['Billable claims', ['Tag the project when an expense is rebillable. It will appear on the client’s next invoice.']],
      ['When you are paid', ['Approved claims are reimbursed with the next weekly payout on Thursday.']],
    ]),
    art('KB-3', 'Setting up your laptop', 'IT', '2026-11-04', 'E-0166', [
      ['Before day one', ['IT ships your laptop to your address on file. It arrives enrolled in device management.']],
      ['First login', ['Sign in with your work email. You will be prompted to set up two-factor authentication.']],
      ['Software', ['Install tools from the self-service portal. Anything not listed needs a ticket.']],
    ]),
    art('KB-4', 'Travel policy', 'Policies', '2026-11-05', 'E-0124', [
      ['Booking', ['Book through the travel desk. Economy for flights under four hours.']],
      ['Approvals', ['Trips over ₹25,000 need pre-approval from your department head.']],
      ['Per-diems', ['Metro cities ₹2,500 a day; other cities ₹1,800.']],
    ]),
    art('KB-5', 'Prevention of sexual harassment (POSH)', 'Policies', '2026-06-12', 'E-0101', [
      ['Our commitment', ['Every employee has the right to a workplace free of harassment.']],
      ['Internal Committee', ['The Internal Committee is chaired by Ananya Rao and includes an external member.']],
      ['Raising a complaint', ['Complaints can be raised in writing within three months of an incident, by email or in person.']],
    ]),
    art('KB-6', 'Payroll calendar', 'Finance', '2026-10-28', 'E-0124', [
      ['Inputs', ['Attendance, leave and reimbursements lock on the 25th.']],
      ['Payment', ['Salaries are credited on the last working day of the month.']],
    ]),
  ];
}

export function seedVisitors(emps: Employee[]): Visitor[] {
  const rows: [string, string, string, string, string, string | null, string | null, string][] = [
    ['Rajiv Bansal', 'Northwind Logistics', 'E-0104', '2026-11-06', '10:00', '09:52', null, 'Sprint demo'],
    ['Farah Siddiqui', 'Bluefin Capital', 'E-0133', '2026-11-06', '11:30', '11:41', '13:05', 'Contract renewal'],
    ['Courier · BlueDart', 'BlueDart', 'E-0163', '2026-11-06', '12:00', '12:04', '12:10', 'Delivery'],
    ['Pooja Bhalla', 'Coral Insurance', 'E-0133', '2026-11-06', '14:00', '13:58', null, 'Proposal walkthrough'],
    ['Aditi Rao', 'Candidate', 'E-0104', '2026-11-06', '16:30', null, null, 'Interview'],
    ['Imran Khan', 'Saffron Hotels', 'E-0127', '2026-11-06', '15:00', '14:55', null, 'Design workshop'],
    ['Sanjay Pillai', 'Monsoon Foods', 'E-0148', '2026-11-05', '10:30', '10:31', '12:40', 'Steering committee'],
    ['Neelam Arora', 'Halcyon Retail', 'E-0148', '2026-11-04', '15:00', '15:12', '16:30', 'Milestone review'],
    ['Kunal Grover', 'Joiner', 'E-0145', '2026-11-09', '09:30', null, null, 'Pre-joining paperwork'],
  ];
  void emps;
  return rows.map(([name, company, hostId, date, expected, checkedIn, checkedOut, purpose], i) => ({ id: 'VS-' + (200 + i), name, company, hostId, date, expected, checkedIn, checkedOut, purpose, badge: checkedIn ? 'V-' + (14 + i) : null }));
}

// ---------------- admin ----------------
export const PERMISSION_MODULES = ['People · Directory', 'People · Payroll', 'People · Leave', 'Work · Projects', 'Work · Timesheets', 'Clients · Accounts', 'Clients · Tickets', 'Finance · Invoices', 'Finance · Expenses', 'Finance · Profitability', 'Workplace · Assets', 'Admin · Users', 'Admin · Audit log'];
export function seedRoles(): RoleDef[] {
  const P = (vals: string) => Object.fromEntries(PERMISSION_MODULES.map((m, i) => [m, ({ n: 'none', v: 'view', e: 'edit', a: 'approve' } as const)[vals[i] as 'n']]));
  return [
    { id: 'RL-1', name: 'Admin', seeded: true, description: 'Everything, including access control.', permissions: P('aaaaaeeaaaeev') },
    { id: 'RL-2', name: 'HR', seeded: true, description: 'People data, payroll and leave.', permissions: P('eaavvvnnnnvnn') },
    { id: 'RL-3', name: 'Manager', seeded: true, description: 'Their team, projects and approvals.', permissions: P('vnaeavvnavvnn') },
    { id: 'RL-4', name: 'Employee', seeded: true, description: 'Their own records.', permissions: P('vnevevnnevnnn') },
    { id: 'RL-5', name: 'Client', seeded: true, description: 'Portal only: their projects, invoices and tickets.', permissions: P('nnnvnnevvnnnn') },
    { id: 'RL-6', name: 'Finance', seeded: false, description: 'Invoices, expenses and margin.', permissions: P('vvnvvvnaaannv') },
    { id: 'RL-7', name: 'IT', seeded: false, description: 'Assets and user provisioning.', permissions: P('vnnnnnnnnnaev') },
  ];
}
export function seedUsers(emps: Employee[]): AppUser[] {
  const roleOf = (e: Employee) => e.id === 'E-0100' || e.id === 'E-0090' ? 'Admin' : e.dept === 'People' ? 'HR' : e.dept === 'Finance' ? 'Finance' : e.id === 'E-0166' ? 'IT' : emps.some((x) => x.managerId === e.id) ? 'Manager' : 'Employee';
  const users: AppUser[] = emps.map((e) => {
    const r = streamFor('user:' + e.id);
    return { id: 'U-' + e.id.slice(2), employeeId: e.id, email: e.email, name: e.name, role: roleOf(e), status: 'Active', lastActive: ts(addDays(TODAY, -r.int(0, 4)), String(9 + r.int(0, 9)).padStart(2, '0') + ':' + String(r.int(10, 59))), invited: e.joined };
  });
  for (const [n, email, role, inv] of [['Kunal Grover', 'kunal.grover@kestrel.digital', 'Employee', '2026-10-31'], ['Anika Bhat', 'anika.bhat@kestrel.digital', 'Employee', '2026-11-02'], ['Ishaan Mehta', 'ishaan.mehta@kestrel.digital', 'Employee', '2026-10-31'], ['Maya Iyengar', 'maya.iyengar@kestrel.digital', 'Employee', '2026-11-03']])
    users.push({ id: 'U-I' + users.length, employeeId: null, email, name: n, role, status: 'Invited', lastActive: null, invited: inv });
  return users;
}

export function seedWorkflows(): Workflow[] {
  const linear = (id: string, name: string, module: Workflow['module'], status: Workflow['status'], updated: string, steps: [Workflow['nodes'][number]['kind'], string, Record<string, string>][], branch?: boolean): Workflow => {
    const nodes = steps.map(([kind, label, config], i) => { const rej = kind === 'Outcome' && label.startsWith('Reject'); return { id: id + '-N' + i, kind, label, x: rej ? 40 + 2 * 220 : 40 + i * 220, y: rej ? 260 : 120, config }; });
    const edges: Workflow['edges'] = [];
    for (let i = 0; i < nodes.length - 1; i++) if (!(branch && nodes[i + 1].label.startsWith('Reject'))) edges.push({ id: id + '-E' + i, from: nodes[i].id, to: nodes[i + 1].id });
    if (branch) {
      const cond = nodes.find((n) => n.kind === 'Condition');
      const rej = nodes.find((n) => n.label.startsWith('Reject'));
      if (cond && rej) edges.push({ id: id + '-EX', from: cond.id, to: rej.id, label: 'No' });
      const yes = edges.find((e) => e.from === cond?.id && e.to !== rej?.id);
      if (yes) yes.label = 'Yes';
    }
    return { id, name, module, status, updated, nodes, edges };
  };
  return [
    linear('WF-1', 'Leave approval', 'Leave', 'Active', '2026-09-14', [
      ['Trigger', 'Leave requested', { event: 'leave.requested' }], ['Approver', 'Reporting manager', { approver: 'Reporting manager', sla: '48h' }],
      ['Condition', 'More than 5 days?', { field: 'days', op: '>', value: '5' }], ['Approver', 'Department head', { approver: 'Department head', sla: '48h' }],
      ['Notification', 'Notify HR', { channel: 'email', to: 'HR' }], ['Outcome', 'Approved', { result: 'approve' }]]),
    linear('WF-2', 'Expense approval', 'Expense', 'Active', '2026-10-02', [
      ['Trigger', 'Claim submitted', { event: 'expense.submitted' }], ['Condition', 'Under ₹25,000?', { field: 'amount', op: '<', value: '25000' }],
      ['Approver', 'Reporting manager', { approver: 'Reporting manager', sla: '72h' }], ['Approver', 'Finance', { approver: 'Finance', sla: '72h' }],
      ['Outcome', 'Approved', { result: 'approve' }], ['Outcome', 'Rejected · needs department head', { result: 'reject' }]], true),
    linear('WF-3', 'Timesheet approval', 'Timesheet', 'Active', '2026-08-20', [
      ['Trigger', 'Week submitted', { event: 'timesheet.submitted' }], ['Approver', 'Project manager', { approver: 'Project manager', sla: '72h' }],
      ['Notification', 'Notify employee', { channel: 'in-app', to: 'Requester' }], ['Outcome', 'Approved', { result: 'approve' }]]),
    linear('WF-4', 'Regularisation', 'Regularisation', 'Active', '2026-07-11', [
      ['Trigger', 'Correction requested', { event: 'attendance.regularise' }], ['Approver', 'Reporting manager', { approver: 'Reporting manager', sla: '48h' }], ['Outcome', 'Approved', { result: 'approve' }]]),
    linear('WF-5', 'Invoice sign-off', 'Invoice', 'Active', '2026-06-30', [
      ['Trigger', 'Invoice drafted', { event: 'invoice.drafted' }], ['Condition', 'Over ₹10 lakh?', { field: 'total', op: '>', value: '1000000' }],
      ['Approver', 'Finance head', { approver: 'Finance head', sla: '24h' }], ['Notification', 'Notify account owner', { channel: 'email', to: 'Account owner' }], ['Outcome', 'Approved', { result: 'approve' }]]),
    linear('WF-6', 'Joiner provisioning', 'Onboarding', 'Active', '2026-05-02', [
      ['Trigger', 'Offer accepted', { event: 'candidate.hired' }], ['Notification', 'Notify IT', { channel: 'email', to: 'IT' }], ['Notification', 'Notify manager', { channel: 'in-app', to: 'Manager' }], ['Outcome', 'Checklist created', { result: 'approve' }]]),
    linear('WF-7', 'Asset return', 'Onboarding', 'Paused', '2026-03-19', [
      ['Trigger', 'Exit initiated', { event: 'employee.exit' }], ['Approver', 'IT', { approver: 'IT', sla: '120h' }], ['Outcome', 'Closed', { result: 'approve' }]]),
  ];
}

export function seedNotificationRules(): NotificationRule[] {
  const ev: [string, string, boolean, boolean, boolean][] = [
    ['Leave requested', 'Leave', true, true, false], ['Leave decided', 'Leave', true, true, false], ['Expense submitted', 'Expenses', true, false, true], ['Expense decided', 'Expenses', true, true, false],
    ['Timesheet submitted', 'Timesheets', true, false, true], ['Timesheet rejected', 'Timesheets', true, true, false], ['Invoice overdue', 'Invoices', true, true, true], ['Payment recorded', 'Invoices', true, false, true],
    ['Ticket breaches SLA', 'Tickets', true, true, false], ['Mentioned in a comment', 'Projects', true, true, false], ['Contract expiring', 'Contracts', true, true, true], ['Payroll locked', 'Payroll', true, true, false],
    ['Certification expiring', 'Training', true, false, true], ['Asset allocated', 'Assets', true, true, false], ['Visitor arrived', 'Visitors', true, false, false], ['Announcement posted', 'Announcements', true, false, true],
  ];
  return ev.map(([event, module, inApp, email, digest], i) => ({ id: 'NR-' + i, event, module, channels: { inApp, email, digest } }));
}

export function seedAudit(emps: Employee[]): AuditEvent[] {
  const out: AuditEvent[] = [];
  const kinds: [string, string, (r: ReturnType<typeof streamFor>) => AuditEvent['changes']][] = [
    ['Updated', 'Employee', (r) => [{ field: 'location', before: 'Pune', after: r.pick(['Bengaluru', 'Mumbai']) }]],
    ['Approved', 'Leave request', () => [{ field: 'status', before: 'Pending', after: 'Approved' }]],
    ['Revealed', 'Bank account', () => []],
    ['Updated', 'Invoice', (r) => [{ field: 'status', before: 'Draft', after: 'Sent' }, { field: 'due', before: '2026-11-30', after: '2026-12-' + r.int(10, 28) }]],
    ['Created', 'Expense claim', (r) => [{ field: 'amount', before: null, after: '₹' + r.int(900, 18000).toLocaleString('en-IN') }]],
    ['Updated', 'Role', () => [{ field: 'Finance · Invoices', before: 'view', after: 'edit' }]],
    ['Signed in', 'Session', () => []],
    ['Updated', 'Salary', (r) => [{ field: 'ctc', before: '₹' + r.int(12, 20) + ',00,000', after: '₹' + r.int(21, 26) + ',00,000' }]],
    ['Submitted', 'Timesheet week', () => [{ field: 'status', before: 'Draft', after: 'Submitted' }]],
  ];
  const r = streamFor('audit');
  let at = Date.parse(TODAY + 'T18:00:00+05:30');
  const floor = Date.parse(HISTORY_FROM);
  while (out.length < 420 && at > floor) {
    at -= r.int(4, 90) * 6e4 * (out.length > 60 ? 6 : 1);
    const e = r.pick(emps);
    const [action, entity, ch] = r.pick(kinds);
    out.push({ id: 'AU-' + (90000 - out.length), at: new Date(at).toISOString(), actorId: e.id, actor: e.name, action, entity, entityId: entity === 'Employee' ? r.pick(emps).id : entity.slice(0, 2).toUpperCase() + '-' + r.int(100, 999), changes: ch(r), ip: '10.0.' + r.int(1, 9) + '.' + r.int(2, 250) });
  }
  return out;
}

export function seedMasters(): MasterList[] {
  const list = (id: string, name: string, columns: string[], rows: string[][]): MasterList => ({ id, name, columns, rows: rows.map((v, i) => ({ id: id + '-' + i, values: v, active: true })) });
  return [
    list('MS-1', 'Departments', ['Name', 'Head', 'Cost centre'], [['Engineering', 'Kabir Malhotra', 'CC-110'], ['Delivery', 'Vikram Menon', 'CC-120'], ['Design', 'Tara Fernandes', 'CC-130'], ['Sales', 'Arjun Varma', 'CC-140'], ['Operations', 'Leela Thomas', 'CC-150'], ['People', 'Ananya Rao', 'CC-160'], ['Finance', 'Sana Qureshi', 'CC-170'], ['Leadership', 'Rhea Kapoor', 'CC-100']]),
    list('MS-2', 'Locations', ['Name', 'State', 'Address'], [['Bengaluru', 'Karnataka', '4th floor, Prestige Tech Park'], ['Pune', 'Maharashtra', 'Level 2, Panchshil Business Park'], ['Mumbai', 'Maharashtra', 'BKC, Platina'], ['Kochi', 'Kerala', 'Infopark Phase 2'], ['Kolkata', 'West Bengal', 'Salt Lake Sector V'], ['Remote', '—', '—']]),
    list('MS-3', 'Leave types', ['Code', 'Name', 'Days a year'], [['CL', 'Casual leave', '12'], ['SL', 'Sick leave', '10'], ['EL', 'Earned leave', '18'], ['CO', 'Comp-off', 'As earned'], ['ML', 'Maternity leave', '182'], ['PL', 'Paternity leave', '10']]),
    list('MS-4', 'Holiday calendar 2027', ['Date', 'Holiday', 'Type'], [['26 Jan 2027', 'Republic Day', 'Fixed'], ['22 Mar 2027', 'Holi', 'Fixed'], ['1 May 2027', 'Labour Day', 'Fixed'], ['15 Aug 2027', 'Independence Day', 'Fixed'], ['2 Oct 2027', 'Gandhi Jayanti', 'Fixed'], ['29 Oct 2027', 'Diwali', 'Fixed']]),
    list('MS-5', 'Tax slabs · new regime', ['From', 'To', 'Rate'], [['₹0', '₹4,00,000', '0%'], ['₹4,00,001', '₹8,00,000', '5%'], ['₹8,00,001', '₹12,00,000', '10%'], ['₹12,00,001', '₹16,00,000', '15%'], ['₹16,00,001', '₹20,00,000', '20%'], ['₹20,00,001', '₹24,00,000', '25%'], ['Above ₹24,00,000', '—', '30%']]),
    list('MS-6', 'Expense categories', ['Name', 'Receipt above', 'Approver'], [['Travel', '₹0', 'Manager'], ['Meals', '₹500', 'Manager'], ['Software', '₹0', 'Finance'], ['Hardware', '₹0', 'Finance'], ['Training', '₹0', 'Manager'], ['Client entertainment', '₹0', 'Department head'], ['Office', '₹200', 'Manager']]),
    list('MS-7', 'Professional tax', ['State', 'Monthly', 'Notes'], [['Karnataka', '₹200', 'Gross ≥ ₹25,000'], ['Maharashtra', '₹200', '₹300 in February'], ['West Bengal', '₹200', 'Gross > ₹40,000'], ['Kerala', '₹208', 'Half-yearly ₹1,250'], ['Tamil Nadu', '₹208', 'Half-yearly ₹1,250']]),
    list('MS-8', 'Designations', ['Title', 'Band'], [['Software Engineer', 'B2'], ['Senior Engineer', 'B3'], ['Engineering Manager', 'B5'], ['Product Designer', 'B3'], ['Project Manager', 'B4']]),
    list('MS-9', 'Shifts', ['Name', 'Start', 'End'], [['General', '09:30', '18:30'], ['Early', '08:00', '17:00']]),
  ];
}

export function seedSystemJobs(): SystemJob[] {
  return [
    { id: 'JB-1', name: 'Nightly digest', lastRun: '2026-11-06T02:00:00+05:30', status: 'Failed', detail: 'SMTP timeout at 02:00 after 3 retries' },
    { id: 'JB-2', name: 'Leave accrual', lastRun: '2026-11-01T00:30:00+05:30', status: 'Succeeded', detail: '60 balances updated' },
    { id: 'JB-3', name: 'Bank file export · October', lastRun: '2026-10-30T17:00:00+05:30', status: 'Succeeded', detail: '2 accounts rejected by bank (IFSC mismatch)' },
    { id: 'JB-4', name: 'Certification expiry check', lastRun: '2026-11-06T06:00:00+05:30', status: 'Succeeded', detail: 'Reminders sent' },
  ];
}

export function seedDocuments(emps: Employee[], projects: Project[], clients: Client[]): Document[] {
  const out: Document[] = [];
  let n = 1;
  const add = (d: Omit<Document, 'id'>) => out.push({ id: 'DOC-' + n++, ...d });
  for (const e of emps) {
    const j = e.joined;
    add({ ownerType: 'employee', ownerId: e.id, name: 'Offer letter', type: 'Offer', versions: [{ version: 1, uploaded: j, byId: 'E-0107', size: '184 KB', note: '' }], expires: null, visibleToClient: false });
    add({ ownerType: 'employee', ownerId: e.id, name: 'Aadhaar card', type: 'Identity', versions: [{ version: 1, uploaded: j, byId: e.id, size: '420 KB', note: '' }], expires: null, visibleToClient: false });
    add({ ownerType: 'employee', ownerId: e.id, name: 'PAN card', type: 'Tax', versions: [{ version: 1, uploaded: j, byId: e.id, size: '210 KB', note: '' }], expires: null, visibleToClient: false });
    add({ ownerType: 'employee', ownerId: e.id, name: 'Form 12BB · FY 2026–27', type: 'Tax declaration', versions: [{ version: 1, uploaded: '2026-05-12', byId: e.id, size: '96 KB', note: '' }, { version: 2, uploaded: '2026-06-12', byId: e.id, size: '102 KB', note: 'Added rent receipts' }], expires: '2027-03-31', visibleToClient: false });
  }
  for (const p of projects) {
    add({ ownerType: 'project', ownerId: p.id, name: 'Statement of work', type: 'Contract', versions: [{ version: 1, uploaded: addDays(p.start, -10), byId: p.managerId, size: '1.2 MB', note: '' }, { version: 2, uploaded: addDays(p.start, -3), byId: p.managerId, size: '1.3 MB', note: 'Client redlines accepted' }], expires: null, visibleToClient: true });
    add({ ownerType: 'project', ownerId: p.id, name: 'Architecture overview', type: 'Design', versions: [{ version: 1, uploaded: addDays(p.start, 14), byId: p.team[0].employeeId, size: '3.4 MB', note: '' }], expires: null, visibleToClient: true });
    add({ ownerType: 'project', ownerId: p.id, name: 'Sprint review notes', type: 'Notes', versions: [{ version: 1, uploaded: addDays(p.start, 30), byId: p.managerId, size: '88 KB', note: '' }], expires: null, visibleToClient: false });
  }
  for (const c of clients) {
    add({ ownerType: 'client', ownerId: c.id, name: 'Master services agreement', type: 'Contract', versions: [{ version: 1, uploaded: c.since, byId: c.ownerId, size: '2.1 MB', note: '' }], expires: null, visibleToClient: true });
    add({ ownerType: 'client', ownerId: c.id, name: 'GST certificate', type: 'Tax', versions: [{ version: 1, uploaded: c.since, byId: 'E-0157', size: '310 KB', note: '' }], expires: null, visibleToClient: false });
  }
  return out;
}
