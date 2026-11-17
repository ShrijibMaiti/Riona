/**
 * Wave 8: the remaining modules behave and are scoped as they should.
 *   uploads and signed downloads · documents · leads · assets and stock · bookings · announcements · visitors ·
 *   recruitment · onboarding · reviews · users (invite → set password, deactivate, last-Admin guard) · roles ·
 *   masters · the audit log · demo requests
 */
import { afterAll, describe, expect, it } from 'vitest';
import { db, sqlError } from '../helpers/db';
import { anonymous, PREFIX, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const upload = async (cookie: string | null, name: string, bytes: Buffer, type = 'application/pdf') => {
  const app = await testApp();
  const res = await app.inject({ method: 'POST', url: PREFIX + '/uploads', payload: bytes, headers: { ...(cookie ? { cookie } : {}), 'x-requested-with': 'riona', 'content-type': type, 'x-filename': encodeURIComponent(name) } });
  return { status: res.statusCode, body: res.json() };
};

describe('uploads, documents and signed downloads', () => {
  it('a new version carries the uploaded file; its link downloads the same bytes, and only while signed', async () => {
    const admin = await signIn('Admin');
    const bytes = Buffer.from('%PDF-1.4 statement of work v3 ' + 'x'.repeat(4000));
    const up = await upload(admin.cookie, 'SOW v3.pdf', bytes);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body).toMatchObject({ filename: 'SOW v3.pdf', contentType: 'application/pdf', size: bytes.length });

    const v = await admin.post('/documents/DOC-241/versions', { note: 'Signed copy', fileId: up.body.id });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const last = v.body.versions.at(-1);
    expect(last).toMatchObject({ byId: 'E-0100', note: 'Signed copy', size: up.body.sizeLabel });

    const link = (await admin.get(`/documents/DOC-241/versions/${last.version}/download`)).body;
    expect(link.url).toMatch(/^\/api\/v1\/files\/F-[^?]+\?exp=\d+&name=.+&sig=/);
    expect(link.filename).toBe(`Statement-of-work-v${last.version}.pdf`);
    const app = await testApp();
    const got = await app.inject({ method: 'GET', url: link.url }); // no session needed: the link is the permission
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(bytes)).toBe(true);
    expect(got.headers['content-disposition']).toContain(link.filename);
    expect((await app.inject({ method: 'GET', url: link.url.replace(/sig=[^&]+/, 'sig=AAAA') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: link.url.replace(/exp=\d+/, 'exp=1000') })).statusCode).toBe(403);
    // The same file can't be attached twice.
    expect((await admin.post('/documents/DOC-241/versions', { note: 'again', fileId: up.body.id })).status).toBe(422);
    // The client portal downloads it through a signed link too (DOC-241 is shared with Northwind).
    const rajiv = await signIn('rajiv@northwind.in');
    const portal = (await rajiv.get('/portal/documents/DOC-241/download')).body;
    expect((await app.inject({ method: 'GET', url: portal.url })).rawPayload.equals(bytes)).toBe(true);
  });

  it('refuses dangerous or mismatched files, empty ones, and uploads from client accounts', async () => {
    const admin = await signIn('Admin');
    expect((await upload(admin.cookie, 'evil.html', Buffer.from('<script>'), 'text/html')).status).toBe(422);
    expect((await upload(admin.cookie, 'run.exe', Buffer.from('MZ'), 'application/octet-stream')).status).toBe(422);
    expect((await upload(admin.cookie, 'photo.pdf', Buffer.from('x'), 'image/png')).status).toBe(422);
    expect((await upload(admin.cookie, 'empty.pdf', Buffer.alloc(0))).status).toBe(422);
    expect((await upload(null, 'a.pdf', Buffer.from('x'))).status).toBe(401);
    expect((await upload((await signIn('Client')).cookie, 'a.pdf', Buffer.from('x'))).status).toBe(403);
  });

  it('employee documents: one’s own, or HR/Admin; someone else’s upload can’t be attached', async () => {
    const aarav = await signIn('Employee');
    const own = (await aarav.get('/documents?ownerType=employee')).body;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((d: { ownerId: string }) => d.ownerId === 'E-0112')).toBe(true);
    expect((await aarav.get('/documents?ownerType=employee&ownerId=E-0100')).body).toEqual([]);
    const other = await db.selectFrom('documents').select('id').where('ownerType', '=', 'employee').where('ownerId', '=', 'E-0100').executeTakeFirstOrThrow();
    expect((await aarav.get(`/documents/${other.id}/versions/latest/download`)).status).toBe(404);
    const hr = await signIn('HR');
    expect((await hr.get('/documents?ownerType=employee&ownerId=E-0100')).body.length).toBeGreaterThan(0);
    // An upload by HR can't be attached by Aarav.
    const up = await upload(hr.cookie, 'id.pdf', Buffer.from('%PDF id'));
    expect((await aarav.post(`/documents/${own[0].id}/versions`, { note: 'x', fileId: up.body.id })).status).toBe(422);
  });
});

describe('clients, workplace', () => {
  it('leads: a manager moves one and it is recorded; an employee can’t; activity is append-only', async () => {
    expect((await (await signIn('Employee')).patch('/leads/LD-40', { stage: 'Won' })).status).toBe(403);
    const res = await (await signIn('Manager')).patch('/leads/LD-40', { stage: 'Negotiation' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'Negotiation', stageSince: '2026-11-06' });
    expect(res.body.activity.at(-1)).toEqual({ at: '2026-11-06', text: 'Moved to Negotiation', byId: 'E-0104' });
    expect(await sqlError(`DELETE FROM lead_activity WHERE lead_id = 'LD-40'`)).not.toBeNull();
  });

  it('assets: employees see only theirs; allocating takes IT or Admin; only the holder reports a problem', async () => {
    const aarav = await signIn('Employee');
    const mine = (await aarav.get('/assets')).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a: { allocations: { employeeId: string }[] }) => a.allocations.some((x) => x.employeeId === 'E-0112'))).toBe(true);
    const held = (await aarav.get('/me/assets')).body[0];
    const free = await db.selectFrom('assets').select('id').where('status', '=', 'Available').executeTakeFirstOrThrow();
    expect((await aarav.get('/assets/' + free.id)).status).toBe(404);
    expect((await aarav.post(`/assets/${free.id}/allocate`, { employeeId: 'E-0112', note: '' })).status).toBe(403);
    expect((await aarav.post(`/assets/${free.id}/issues`, { text: 'Not mine, but broken' })).status).toBe(403);
    const issue = await aarav.post(`/assets/${held.id}/issues`, { text: 'The hinge is cracked' });
    expect(issue.status).toBe(200);
    expect(issue.body.issues.at(-1)).toMatchObject({ reportedById: 'E-0112', text: 'The hinge is cracked' });

    // IT (role name) allocates; the open allocation moves.
    const it = await db.selectFrom('users').select('email').where('roleName', '=', 'IT').executeTakeFirstOrThrow();
    const itc = await signIn(it.email);
    const a1 = await itc.post(`/assets/${free.id}/allocate`, { employeeId: 'E-0112', note: 'Spare' });
    expect(a1.status, JSON.stringify(a1.body)).toBe(200);
    expect(a1.body.status).toBe('Allocated');
    const a2 = await itc.post(`/assets/${free.id}/allocate`, { employeeId: 'E-0104', note: 'Moved' });
    const open = a2.body.allocations.filter((x: { to: string | null }) => !x.to);
    expect(open).toEqual([expect.objectContaining({ employeeId: 'E-0104' })]);
    expect(await sqlError(`INSERT INTO asset_allocations (asset_id, employee_id, "from") VALUES ('${free.id}', 'E-0100', '2026-11-06')`)).toMatch(/duplicate key/);
  });

  it('stock can’t go below zero and its movements are append-only', async () => {
    const admin = await signIn('Admin');
    const item = (await admin.get('/inventory')).body[0];
    expect((await admin.post(`/inventory/${item.id}/movements`, { kind: 'out', qty: item.stock + 1, note: '' })).status).toBe(422);
    expect((await (await signIn('Employee')).post(`/inventory/${item.id}/movements`, { kind: 'in', qty: 5, note: '' })).status).toBe(403);
    const r = await admin.post(`/inventory/${item.id}/movements`, { kind: 'in', qty: 12, note: 'Restock' });
    expect(r.body.stock).toBe(item.stock + 12);
    expect(r.body.movements.at(-1)).toMatchObject({ kind: 'in', qty: 12, byId: 'E-0100' });
    expect(await sqlError(`UPDATE stock_movements SET qty = 1 WHERE item_id = '${item.id}'`)).not.toBeNull();
  });

  it('bookings refuse an overlap; announcements acknowledge once; visitors check in with a free badge', async () => {
    const aarav = await signIn('Employee');
    const b = await aarav.post('/bookings', { roomId: 'RM-2', date: '2026-11-20', start: '10:00', end: '11:00', title: 'Planning' });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.bookedById).toBe('E-0112');
    expect((await aarav.post('/bookings', { roomId: 'RM-2', date: '2026-11-20', start: '10:30', end: '11:30', title: 'Clash' })).status).toBe(409);
    expect((await aarav.post('/bookings', { roomId: 'RM-2', date: '2026-11-20', start: '11:00', end: '12:00', title: 'Back to back' })).status).toBe(200);
    expect((await aarav.post('/bookings', { roomId: 'RM-2', date: '2026-11-20', start: '12:00', end: '11:00', title: 'x' })).status).toBe(422);

    const an = (await aarav.get('/announcements')).body.find((a: { requiresAck: boolean }) => a.requiresAck);
    const ack1 = await aarav.post(`/announcements/${an.id}/acknowledge`);
    const ack2 = await aarav.post(`/announcements/${an.id}/acknowledge`);
    expect(ack1.body.ackIds.filter((x: string) => x === 'E-0112')).toHaveLength(1);
    expect(ack2.body.ackIds).toEqual(ack1.body.ackIds);

    const v = await aarav.post('/visitors', { name: 'Asha Rao', company: 'Acme', hostId: 'E-0104', purpose: 'Interview', date: '2026-11-06', expected: '15:00', checkInNow: false });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const inn = await aarav.post(`/visitors/${v.body.id}/check-in`);
    expect(inn.body.badge).toMatch(/^V-\d+$/);
    const inUse = (await db.selectFrom('visitors').select('badge').where('date', '=', '2026-11-06').where('checkedOut', 'is', null).where('id', '!=', v.body.id).execute()).map((r) => r.badge);
    expect(inUse).not.toContain(inn.body.badge);
    expect((await aarav.post(`/visitors/${v.body.id}/check-in`)).status).toBe(409);
    expect((await aarav.post(`/visitors/${v.body.id}/check-out`)).body.checkedOut).toMatch(/^\d\d:\d\d$/);
  });
});

describe('people: recruitment, onboarding, reviews', () => {
  it('recruitment: HR sees all; a hiring manager sees and moves their own openings; employees see none', async () => {
    const all = (await (await signIn('HR')).get('/jobs')).body;
    const kabir = await signIn('kabir.malhotra@kestrel.digital');
    const his = (await kabir.get('/jobs')).body;
    expect(his.length).toBeGreaterThan(0);
    expect(his.length).toBeLessThan(all.length);
    expect(his.every((j: { hiringManagerId: string }) => j.hiringManagerId === 'E-0118')).toBe(true);
    const cand = (await kabir.get('/candidates?jobId=' + his[0].id)).body.find((c: { stage: string }) => c.stage === 'Screening' || c.stage === 'Applied');
    expect((await kabir.patch('/candidates/' + cand.id, { stage: 'Interviewing' })).body.stage).toBe('Interviewing');
    const other = all.find((j: { hiringManagerId: string }) => j.hiringManagerId !== 'E-0118');
    expect((await kabir.get('/jobs/' + other.id)).status).toBe(404);
    expect((await (await signIn('Employee')).get('/candidates')).body).toEqual([]);
  });

  it('onboarding: each item is ticked by its owner', async () => {
    const hr = await signIn('HR');
    const c = (await hr.get('/onboarding')).body.find((x: { items: { owner: string; done: boolean }[] }) => x.items.some((i) => i.owner === 'Manager' && !i.done) && x.items.some((i) => i.owner === 'HR' && !i.done));
    const dept = c.dept;
    const mgr = await db.selectFrom('users as u').innerJoin('employees as e', 'e.id', 'u.employeeId').select('u.email').where('u.role', '=', 'Manager').where('e.dept', '=', dept).where('u.roleName', '=', 'Manager').executeTakeFirst();
    const hrItem = c.items.find((i: { owner: string; done: boolean }) => i.owner === 'HR' && !i.done);
    if (mgr && !c.employeeId) {
      const m = await signIn(mgr.email);
      const mItem = c.items.find((i: { owner: string; done: boolean }) => i.owner === 'Manager' && !i.done);
      expect((await m.patch(`/onboarding/${c.id}/items/${mItem.id}`, { done: true })).body.items.find((i: { id: string }) => i.id === mItem.id).done).toBe(true);
      expect((await m.patch(`/onboarding/${c.id}/items/${hrItem.id}`, { done: true })).status).toBe(403);
    }
    const done = await hr.patch(`/onboarding/${c.id}/items/${hrItem.id}`, { done: true });
    expect(done.body.items.find((i: { id: string }) => i.id === hrItem.id)).toMatchObject({ done: true, doneOn: '2026-11-06' });
    expect((await (await signIn('Employee')).get('/onboarding')).body).toEqual([]);
  });

  it('reviews: the employee writes the self-review, the reviewer the rating; complete locks it', async () => {
    const r = await db.selectFrom('reviews').selectAll().where('employeeId', '=', 'E-0112').where('status', 'in', ['Not started', 'Self review']).executeTakeFirstOrThrow();
    const aarav = await signIn('Employee');
    expect((await aarav.put('/reviews/' + r.id, { managerAnswers: ['I rate myself'], rating: 'Exceeds expectations' })).status).toBe(403);
    const self = await aarav.put('/reviews/' + r.id, { selfAnswers: ['Shipped the route planner', 'Mentored two'], status: 'Manager review' });
    expect(self.status, JSON.stringify(self.body)).toBe(200);
    expect(self.body.status).toBe('Manager review');
    const reviewer = await db.selectFrom('users').select('email').where('employeeId', '=', r.reviewerId).executeTakeFirstOrThrow();
    const rv = await signIn(reviewer.email);
    expect((await rv.put('/reviews/' + r.id, { status: 'Completed' })).status).toBe(422); // a rating first
    const done = await rv.put('/reviews/' + r.id, { managerAnswers: ['Strong delivery'], rating: 'Exceeds expectations', status: 'Completed' });
    expect(done.body).toMatchObject({ status: 'Completed', rating: 'Exceeds expectations' });
    expect((await aarav.put('/reviews/' + r.id, { selfAnswers: ['changed my mind'] })).status).toBe(409);
    // Someone outside the line can't see it.
    const outsider = await signIn('Manager');
    const line = await db.selectFrom('employees').select('managerId').where('id', '=', 'E-0112').executeTakeFirstOrThrow();
    if (line.managerId !== 'E-0104' && r.reviewerId !== 'E-0104') expect((await outsider.get('/reviews/' + r.id)).status).toBe(404);
  });
});

describe('admin', () => {
  it('invite → set a password from the emailed link → signed in; the account works', async () => {
    const admin = await signIn('Admin');
    // No employee record yet: refused, with what to do.
    const early = await admin.post('/users/invite', { name: 'Isha Nair', email: 'isha.nair@kestrel.digital', role: 'Finance' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('user.no_employee');
    // HR adds her; then the invitation links the account to her record.
    const hire = await (await signIn('HR')).post('/employees', { name: 'Isha Nair', email: 'isha.nair@kestrel.digital', title: 'Finance Analyst', dept: 'Finance', managerId: 'E-0124', location: 'Bengaluru', type: 'Full-time', joined: '2026-11-16', phone: '+91 98450 11223', billable: false, billRate: 0, ctc: 1200000 });
    expect(hire.status, JSON.stringify(hire.body)).toBe(200);
    const inv = await admin.post('/users/invite', { name: 'Isha Nair', email: 'isha.nair@kestrel.digital', role: 'Finance' });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body).toMatchObject({ status: 'Invited', role: 'Finance', employeeId: hire.body.id });
    expect((await admin.post('/users/invite', { name: 'Again', email: 'ISHA.NAIR@kestrel.digital', role: 'Employee' })).status).toBe(409);
    expect((await admin.post('/users/invite', { name: 'X', email: 'x@kestrel.digital', role: 'Client' })).status).toBe(422);
    const mail = (await db.selectFrom('outbox').select('payload').where('topic', '=', 'email').execute())
      .map((m) => m.payload as { to: string; text: string }).find((m) => m.to === 'isha.nair@kestrel.digital')!;
    const token = mail.text.match(/#\/reset-password\/([A-Za-z0-9_-]+)/)![1];
    // Can't sign in yet.
    const anon = await anonymous();
    expect((await anon.post('/auth/login', { email: 'isha.nair@kestrel.digital', password: 'a long password 123' })).status).toBe(401);
    expect((await anon.get('/auth/reset/' + token)).body).toEqual({ email: 'isha.nair@kestrel.digital', name: 'Isha Nair', invite: true });
    expect((await anon.post('/auth/reset/' + token, { password: 'short' })).status).toBe(422);
    const set = await anon.post('/auth/reset/' + token, { password: 'a long password 123' });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ ok: true, role: 'Manager' });
    expect((await anon.get('/auth/reset/' + token)).status).toBe(410); // used
    const isha = await signIn('isha.nair@kestrel.digital', 'a long password 123');
    expect((await isha.get('/invoices')).status).toBe(200); // Finance → Manager access
    expect((await isha.get('/me')).body.employee.id).toBe(hire.body.id);
  });

  it('forgot password → the emailed link works and ends other sessions', async () => {
    const before = await signIn('Employee');
    const anon = await anonymous();
    await anon.post('/auth/forgot', { email: 'aarav.shah@kestrel.digital' });
    const mail = (await db.selectFrom('outbox').select('payload').where('topic', '=', 'email').execute())
      .map((m) => m.payload as { to: string; text: string }).filter((m) => m.to === 'aarav.shah@kestrel.digital').at(-1)!;
    const token = mail.text.match(/#\/reset-password\/([A-Za-z0-9_-]+)/)![1];
    expect((await anon.post('/auth/reset/' + token, { password: 'riona-demo-2026' })).status).toBe(200);
    expect((await before.get('/me')).status).toBe(401);
    expect((await (await signIn('Employee')).get('/me')).status).toBe(200);
  });

  it('deactivating ends sessions; nobody deactivates themselves; the last Admin stays', async () => {
    const admin = await signIn('Admin');
    const vikram = await signIn('Manager');
    const u = (await admin.get('/users')).body.find((x: { email: string }) => x.email === 'vikram.menon@kestrel.digital');
    expect((await admin.patch('/users/' + u.id, { status: 'Deactivated' })).body.status).toBe('Deactivated');
    expect((await vikram.get('/me')).status).toBe(401);
    expect((await admin.patch('/users/' + u.id, { status: 'Active' })).body.status).toBe('Active');
    const me = (await admin.get('/users')).body.find((x: { email: string }) => x.email === 'dipak.sharma@kestrel.digital');
    expect((await admin.patch('/users/' + me.id, { status: 'Deactivated' })).status).toBe(409);
    // Demote every other Admin, then the last one can't be demoted (by anyone).
    const admins = (await admin.get('/users')).body.filter((x: { role: string; status: string; id: string }) => x.role === 'Admin' && x.status === 'Active' && x.id !== me.id);
    for (const a of admins) await admin.patch('/users/' + a.id, { role: 'HR' });
    const hrAsAdmin = admins[0];
    if (hrAsAdmin) {
      await admin.patch('/users/' + hrAsAdmin.id, { role: 'Admin' });
      const other = await signIn(hrAsAdmin.email);
      await other.patch('/users/' + me.id, { role: 'HR' }); // Dipak demoted; the other is now the only Admin
      expect((await other.patch('/users/' + hrAsAdmin.id, { role: 'HR' })).status).toBe(409); // can't demote yourself
      await other.patch('/users/' + me.id, { role: 'Admin' }); // restore
      for (const a of admins.slice(1)) await other.patch('/users/' + a.id, { role: 'Admin' });
    }
    expect((await (await signIn('Employee')).get('/users')).status).toBe(403);
  });

  it('roles, notification rules and masters are kept and audited; the audit log is filterable and read-only', async () => {
    const admin = await signIn('Admin');
    const r = await admin.put('/roles/RL-7/permissions/' + encodeURIComponent('Workplace · Assets'), { permission: 'edit' });
    expect(r.body.permissions['Workplace · Assets']).toBe('edit');
    expect((await admin.put('/roles/RL-1/permissions/' + encodeURIComponent('Admin · Users'), { permission: 'view' })).status).toBe(409);
    expect((await admin.patch('/notification-rules/NR-0', { channel: 'digest', on: true })).body.channels.digest).toBe(true);
    const add = await admin.post('/masters/MS-1/rows', { values: ['Research', 'Rhea Kapoor', 'CC-190'], active: true });
    expect(add.body.rows.at(-1).values).toEqual(['Research', 'Rhea Kapoor', 'CC-190']);
    expect((await admin.post('/masters/MS-1/rows', { values: ['Only one'], active: true })).status).toBe(422);
    const audit = await admin.get('/audit?entity=Role&pageSize=5');
    expect(audit.body.items[0]).toMatchObject({ entity: 'Role', entityId: 'RL-7', actorId: 'E-0100' });
    expect((await (await signIn('HR')).get('/audit')).status).toBe(200);
    expect((await (await signIn('Employee')).get('/audit')).status).toBe(403);
  });

  it('demo requests: anonymous, validated, five an hour from one address', async () => {
    const anon = await anonymous();
    expect((await anon.post('/demo-requests', { name: '', email: 'nope' })).status).toBe(422);
    for (let i = 0; i < 5; i++) expect((await anon.post('/demo-requests', { name: 'Neha', email: `neha${i}@acme.in`, company: 'Acme', size: '51–200' })).status).toBe(200);
    expect((await anon.post('/demo-requests', { name: 'Neha', email: 'neha9@acme.in', company: 'Acme', size: '51–200' })).status).toBe(429);
  });
});
