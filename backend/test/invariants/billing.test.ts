/**
 * Wave 6: billing invariants, on Postgres.
 *  - invoices are built server-side from entry ids: quantities are the hours, rates the person's bill rate
 *  - an hour is billed once: the API refuses (409) and so does the database
 *  - totals are frozen at issue; sign-off over ₹10 lakh goes through the "Invoice" workflow
 *  - a revision keeps the invoice as first issued, can't add hours, and can't fall below what has been paid
 *  - payments can't exceed the balance (API) or the frozen total (database)
 *  - expense claims are scoped, go through their workflow, and reopen with their history kept
 */
import { afterAll, describe, expect, it } from 'vitest';
import { invoiceTotals } from '../../src/modules/finance/gst';
import { db, sql, sqlError } from '../helpers/db';
import { signIn, testApp, type Client } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const unbilled = async (clientId: string) =>
  (await sql<{ id: string; hours: number; employeeId: string }>`
    SELECT e.id, e.hours, e.employee_id FROM timesheet_entries e
    WHERE e.client_id = ${clientId} AND e.status = 'Approved' AND e.billable
      AND NOT EXISTS (SELECT 1 FROM invoice_line_entries l WHERE l.entry_id = e.id AND l.live)
    ORDER BY e.date, e.id`.execute(db)).rows;
const frozen = async (id: string) => (await db.selectFrom('invoices').select('issuedTotals').where('id', '=', id).executeTakeFirstOrThrow()).issuedTotals as Record<string, number> | null;
const draft = (clientId: string, entryIds: string[], extra: object = {}) => ({ clientId, issued: '2026-11-06', termsDays: 30, notes: '', discount: 0, entryIds, expenseIds: [], manual: [], ...extra });

/** Signs in as whoever the approval waits on now. */
async function currentApprover(admin: Client, approvalId: string) {
  const a = (await admin.get('/approvals')).body.find((x: { id: string }) => x.id === approvalId);
  const emp = a.chain[a.current].approverId as string;
  const u = await db.selectFrom('users').select('email').where('employeeId', '=', emp).executeTakeFirstOrThrow();
  return signIn(u.email);
}

describe('invoices are built server-side from entry ids', () => {
  let id = '';
  it('one time line per project and person, quantity = Σ hours, rate = bill rate, amount = qty × rate', async () => {
    const admin = await signIn('Admin');
    const hours = await unbilled('C-25');
    expect(hours.length).toBeGreaterThan(0);
    // Anything the client says about lines or amounts is ignored: only ids count.
    const res = await admin.post('/invoices', { ...draft('C-25', hours.map((h) => h.id)), lines: [{ amount: 1, quantity: 999 }], subtotal: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    id = res.body.id;
    expect(id).toMatch(/^INV-2026-\d{4}$/);
    expect(res.body.status).toBe('Draft');
    const time = res.body.lines.filter((l: { kind: string }) => l.kind === 'time');
    expect(time.flatMap((l: { entryIds: string[] }) => l.entryIds).sort()).toEqual(hours.map((h) => h.id).sort());
    for (const l of time) {
      const mine = hours.filter((h) => l.entryIds.includes(h.id));
      expect(l.quantity).toBeCloseTo(mine.reduce((a, h) => a + h.hours, 0), 6);
      const rate = (await db.selectFrom('employees').select('billRatePaise').where('id', '=', mine[0].employeeId).executeTakeFirstOrThrow()).billRatePaise / 100;
      expect(l.rate).toBe(rate);
      expect(l.amount).toBe(Math.round(l.quantity * l.rate));
    }
    expect(await frozen(id)).toBeNull(); // a draft has no frozen totals
  });

  it('an hour is billed once: the API answers 409, and the database refuses a second live link', async () => {
    const admin = await signIn('Admin');
    const inv = (await admin.get('/invoices/' + id)).body;
    const again = await admin.post('/invoices', draft('C-25', [inv.lines[0].entryIds[0]]));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invoice.already_billed');
    const err = await sqlError(`INSERT INTO invoice_line_entries (line_id, entry_id, invoice_id) VALUES ('${inv.lines[0].id}', '${inv.lines[0].entryIds[0]}', '${id}')`);
    expect(err).toMatch(/duplicate key|invoice_line_entries/);
  });

  it('only approved billable hours of the same client; billed hours can no longer change', async () => {
    const admin = await signIn('Admin');
    const other = (await unbilled('C-22'))[0];
    expect((await admin.post('/invoices', draft('C-25', [other.id]))).status).toBe(422);
    const pending = await db.selectFrom('timesheetEntries').select('id').where('status', '!=', 'Approved').executeTakeFirstOrThrow();
    expect((await admin.post('/invoices', draft('C-25', [pending.id]))).status).toBe(422);
    const inv = (await admin.get('/invoices/' + id)).body;
    expect(await sqlError(`UPDATE timesheet_entries SET hours = hours + 1 WHERE id = '${inv.lines[0].entryIds[0]}'`)).toMatch(/billed|invoice/i);
    expect(await sqlError(`DELETE FROM timesheet_entries WHERE id = '${inv.lines[0].entryIds[0]}'`)).not.toBeNull();
  });

  it('Managers can read invoices but not create them; Employees and HR see none', async () => {
    const mgr = await signIn('Manager');
    expect((await mgr.get('/invoices')).body.items.length).toBeGreaterThan(0);
    expect((await mgr.post('/invoices', draft('C-25', []))).status).toBe(403);
    for (const role of ['Employee', 'HR'] as const) {
      const c = await signIn(role);
      expect((await c.get('/invoices')).body.items, role).toEqual([]);
      expect((await c.get('/invoices/' + id)).status, role).toBe(403);
    }
  });

  it('sending under ₹10 lakh needs no sign-off: issued at once, totals frozen', async () => {
    const admin = await signIn('Admin');
    const res = await admin.post(`/invoices/${id}/send`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('Sent');
    const f = (await frozen(id))!;
    const client = await db.selectFrom('clients').select('state').where('id', '=', 'C-25').executeTakeFirstOrThrow();
    const t = invoiceTotals(res.body.lines, res.body.discount, [], client.state, 'Karnataka');
    expect(f.total).toBe(Math.round(t.total * 100));
    expect(f.subtotal).toBe(Math.round(t.subtotal * 100));
    expect((await admin.post(`/invoices/${id}/send`)).status).toBe(409); // only a draft can be sent
    // Frozen: a later change to the client (which would change the tax split) doesn't touch the issued totals.
    await db.updateTable('clients').set({ state: client.state === 'Karnataka' ? 'Maharashtra' : 'Karnataka' }).where('id', '=', 'C-25').execute();
    expect(await frozen(id)).toEqual(f);
    await db.updateTable('clients').set({ state: client.state }).where('id', '=', 'C-25').execute();
  });

  it('payments: within the balance; partial then paid; the database refuses more than the frozen total', async () => {
    const admin = await signIn('Admin');
    const total = (await frozen(id))!.total / 100;
    expect((await admin.post(`/invoices/${id}/payments`, { date: '2026-11-06', amount: total + 10, method: 'NEFT', reference: 'X' })).status).toBe(422);
    const part = await admin.post(`/invoices/${id}/payments`, { date: '2026-11-06', amount: 1000, method: 'UPI', reference: 'UTR-1', totalDue: 1 });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body.status).toBe('Partially paid');
    expect(await sqlError(`INSERT INTO payments (id, invoice_id, date, amount_paise, method, reference) VALUES ('PAY-X', '${id}', '2026-11-06', ${Math.round(total * 100)}, 'NEFT', '')`)).not.toBeNull();
  });

  it('a revision keeps the invoice as first issued, can’t add hours, and can’t go below what was paid', async () => {
    const admin = await signIn('Admin');
    const before = (await admin.get('/invoices/' + id)).body;
    const stray = (await unbilled('C-14'))[0];
    expect((await admin.post(`/invoices/${id}/revise`, { reason: 'no', lines: before.lines, discount: 0 })).status).toBe(422);
    expect((await admin.post(`/invoices/${id}/revise`, { reason: 'Rate cut to almost nothing', lines: before.lines.map((l: object) => ({ ...l, rate: 0.01 })), discount: 0 })).status).toBe(422);

    // Try to slip extra hours onto an existing line and onto a new one: both are ignored.
    const lines = [
      { ...before.lines[0], entryIds: [...before.lines[0].entryIds, stray.id], rate: before.lines[0].rate - 100 },
      ...before.lines.slice(1),
      { description: 'Setup fee', quantity: 1, rate: 5000, kind: 'time', entryIds: [stray.id] },
    ];
    const r1 = await admin.post(`/invoices/${id}/revise`, { reason: 'Agreed rate change and setup fee', lines, discount: 0 });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.lines[0].entryIds).toEqual(before.lines[0].entryIds);
    const added = r1.body.lines.at(-1);
    expect(added).toMatchObject({ kind: 'manual', entryIds: [], projectId: null, amount: 5000 });
    expect((await db.selectFrom('invoiceLineEntries').select('entryId').where('entryId', '=', stray.id).execute()).length).toBe(0);
    expect(r1.body.revisions.map((v: { reason: string }) => v.reason)).toEqual(['Issued', 'Revised: Agreed rate change and setup fee']);
    expect(r1.body.revisions[0].lines).toEqual(before.lines);
    const f = (await frozen(id))!;
    expect(f.total).toBe(Math.round(invoiceTotals(r1.body.lines, 0, [], (await db.selectFrom('clients').select('state').where('id', '=', 'C-25').executeTakeFirstOrThrow()).state, 'Karnataka').total * 100));

    // A second revision appends; the first issued state stays exactly as it was.
    const r2 = await admin.post(`/invoices/${id}/revise`, { reason: 'Drop the setup fee', lines: r1.body.lines.slice(0, -1), discount: 0 });
    expect(r2.status).toBe(200);
    expect(r2.body.revisions).toHaveLength(3);
    expect(r2.body.revisions[0]).toEqual(r1.body.revisions[0]);
    expect(await sqlError(`UPDATE invoice_revisions SET reason = 'x' WHERE invoice_id = '${id}'`)).not.toBeNull();
    expect(await sqlError(`DELETE FROM invoice_revisions WHERE invoice_id = '${id}'`)).not.toBeNull();
  });
});

describe('sign-off over ₹10 lakh', () => {
  it('waits for the Finance head; approved, it is issued and frozen', async () => {
    const admin = await signIn('Admin');
    const hours = await unbilled('C-11');
    const created = await admin.post('/invoices', draft('C-11', hours.map((h) => h.id)));
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.id;
    const sent = await admin.post(`/invoices/${id}/send`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('Draft');
    expect(await frozen(id)).toBeNull();
    expect((await admin.post(`/invoices/${id}/send`)).status).toBe(409); // already waiting
    const approver = await currentApprover(admin, sent.body.approvalId);
    const d = await approver.post(`/approvals/${sent.body.approvalId}/decision`, { approve: true, comment: '' });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const after = (await admin.get('/invoices/' + id)).body;
    expect(after.status).toBe('Sent');
    expect((await frozen(id))!.total).toBeGreaterThan(100_000_000); // > ₹10 lakh, in paise
  });
});

describe('expense claims', () => {
  it('anyone claims their own; it goes to their manager then Finance; others can’t see it', async () => {
    const emp = await signIn('Employee');
    const res = await emp.post('/expenses', { category: 'Travel', description: 'Cab to client site', amount: 1450, date: '2026-11-05', projectId: null, billable: false, receipt: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ employeeId: 'E-0112', status: 'Pending', amount: 1450 });
    expect(res.body.id).toMatch(/^EXP-\d{4}$/);
    const admin = await signIn('Admin');
    // Not visible to an unrelated manager.
    const vikram = await signIn('Manager');
    expect((await vikram.get('/expenses/' + res.body.id)).status).toBe(404);
    // Approve through the chain.
    for (let i = 0; i < 3; i++) {
      const a = (await admin.get('/approvals?type=Expense')).body.find((x: { id: string }) => x.id === res.body.approvalId);
      if (a.status !== 'Pending') break;
      const who = await currentApprover(admin, a.id);
      expect((await who.get('/expenses/' + res.body.id)).status).toBe(200);
      expect((await who.post(`/approvals/${a.id}/decision`, { approve: true, comment: '' })).status).toBe(200);
    }
    const done = (await emp.get('/expenses/' + res.body.id)).body;
    expect(done.status).toBe('Approved');

    // Reopen keeps the approved state as the first revision.
    expect((await emp.post(`/expenses/${done.id}/reopen`, { reason: 'no', amount: 1200 })).status).toBe(422);
    const re = await emp.post(`/expenses/${done.id}/reopen`, { reason: 'Receipt shows a lower fare', amount: 1200 });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(re.body.status).toBe('Pending');
    expect(re.body.revisions.map((v: { amount: number }) => v.amount)).toEqual([1450, 1200]);
  });

  it('a claim of ₹25,000 or more is refused by the workflow', async () => {
    const emp = await signIn('Employee');
    const res = await emp.post('/expenses', { category: 'Hardware', description: 'Monitor', amount: 30000, date: '2026-11-05', projectId: null, billable: false, receipt: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('Rejected');
  });

  it('employees see only their own claims; a billable claim needs a project', async () => {
    const emp = await signIn('Employee');
    const mine = (await emp.get('/expenses')).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x: { employeeId: string }) => x.employeeId === 'E-0112')).toBe(true);
    expect((await emp.post('/expenses', { category: 'Meals', description: 'Lunch', amount: 400, date: '2026-11-05', projectId: null, billable: true, receipt: false })).status).toBe(422);
    expect((await emp.post('/expenses', { category: 'Meals', description: 'Lunch', amount: 400, date: '2026-12-25', projectId: null, billable: false, receipt: false })).status).toBe(422);
  });
});
