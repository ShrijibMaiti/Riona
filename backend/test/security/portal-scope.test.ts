/**
 * Wave 7: the client portal can't leak. A client user never reaches internal hours, assignees, internal notes or
 * unshared documents, or another client's records — through the API, and in the database even with a
 * deliberately broken query.
 *
 *  1. parity: the portal answers exactly what the frontend's fixture portal does (Lumen Energy, C-31)
 *  2. API walls: client accounts only reach /portal; /portal only answers client accounts; other clients' records 404
 *  3. no internal field or note in any portal response
 *  4. database walls: queries run as riona_portal can't select internal columns or tables, and see only the
 *     client's rows even without a WHERE clause
 *  5. tickets both ways; paying online; the gateway webhook is signed and idempotent
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fixture } from '../helpers/golden';
import { sql as ksql } from 'kysely';
import { withClientScope } from '../../src/http/plugins/portal-scope';
import { signPayload } from '../../src/http/routes/webhooks.routes';
import { db, sql } from '../helpers/db';
import { anonymous, PREFIX, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const CLIENT = 'C-31';
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
/** Timestamps compared as instants (the API answers in the org's zone, the fixture in mixed forms). */
const TIMES = new Set(['at', 'opened', 'resolved', 'slaDue']);
const instants = <T,>(x: T): T => JSON.parse(JSON.stringify(x), (k, v) => (TIMES.has(k) && typeof v === 'string' ? Date.parse(v) : v));
/** The golden fixture predates the GST split on portal invoices; compare without it, and check the split adds up. */
const noSplit = <T,>(x: T): T => JSON.parse(JSON.stringify(x), (k, v) => (k === 'gst' ? undefined : v));
const splitAddsUp = (i: { tax: number; gst: { cgst: number; sgst: number; igst: number } }) => i.gst.cgst + i.gst.sgst + i.gst.igst === i.tax && (i.gst.igst === 0 || i.gst.cgst + i.gst.sgst === 0);
const client = () => signIn('Client');

describe('1 · parity with the frontend’s portal (Lumen Energy)', () => {
  it('session, projects, invoices, tickets, documents and download links', async () => {
    const c = await client();
    expect((await c.get('/portal/session')).body).toEqual(await fixture.getPortalSession());
    expect(byId((await c.get('/portal/projects')).body)).toEqual(byId(await fixture.getPortalProjects()));
    expect((await c.get('/portal/projects/P-228')).body).toEqual(await fixture.getPortalProject('P-228'));
    const all = (await c.get('/portal/invoices')).body;
    expect(all.every(splitAddsUp)).toBe(true);
    expect(noSplit(instants(byId(all)))).toEqual(noSplit(instants(byId(await fixture.getPortalInvoices()))));
    expect(noSplit(instants((await c.get('/portal/invoices/INV-2026-0158')).body))).toEqual(noSplit(instants(await fixture.getPortalInvoice('INV-2026-0158'))));
    expect(instants(byId((await c.get('/portal/tickets')).body))).toEqual(instants(byId(await fixture.getPortalTickets())));
    expect(byId((await c.get('/portal/documents')).body)).toEqual(byId(await fixture.getPortalDocuments()));
    expect((await c.get('/portal/documents/DOC-283/download')).body).toEqual(await fixture.getPortalDocumentUrl('DOC-283'));
  });
});

describe('2 · API walls', () => {
  it('/portal needs a client account: 401 without a session, 403 for staff', async () => {
    expect((await (await anonymous()).get('/portal/session')).status).toBe(401);
    for (const role of ['Admin', 'HR', 'Manager', 'Employee'] as const) {
      const res = await (await signIn(role)).get('/portal/invoices');
      expect(res.status, role).toBe(403);
      expect(res.body.error.code).toBe('portal.clients_only');
    }
  });

  it('a client account reaches nothing outside /portal — built routes, unbuilt ones, reads and writes', async () => {
    const c = await client();
    for (const path of ['/me', '/employees', '/employees/E-0100', '/clients', '/projects', '/projects/P-228', '/tasks?projectId=P-228', '/timesheet-entries', '/invoices', '/invoices/INV-2026-0158', '/expenses', '/tickets', '/tickets/TK-1155', '/approvals', '/salary-events', '/profitability', '/budgets', '/workflows', '/assets', '/documents?ownerType=client&ownerId=C-31', '/audit']) {
      const res = await c.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('portal.only');
    }
    expect((await c.post('/tickets/TK-1155/messages', { text: 'hi', internal: true })).status).toBe(403);
    expect((await c.post('/expenses', {})).status).toBe(403);
    // Signing out still works.
    expect((await c.post('/auth/logout')).status).toBe(204);
  });

  it('another client’s records, unshared documents and draft invoices are 404', async () => {
    const c = await client();
    expect((await c.get('/portal/projects/P-214')).status).toBe(404); // Northwind's
    expect((await c.get('/portal/invoices/INV-2026-0145')).status).toBe(404); // C-17's
    expect((await c.get('/portal/tickets/TK-1182')).status).toBe(404); // C-11's
    expect((await c.get('/portal/documents/DOC-241/download')).status).toBe(404); // P-214's, shared with Northwind only
    expect((await c.get('/portal/documents/DOC-285/download')).status).toBe(404); // Lumen's own project, not shared
    expect((await c.get('/portal/documents/DOC-301/download')).status).toBe(404); // Lumen's, not shared
    expect((await c.post('/portal/tickets/TK-1182/messages', { text: 'Hello' })).status).toBe(404);
    expect((await c.post('/portal/invoices/INV-2026-0145/pay', { method: 'UPI' })).status).toBe(404);
    // A draft for Lumen, made by Finance: invisible until it is issued.
    const admin = await signIn('Admin');
    const draft = await admin.post('/invoices', { clientId: CLIENT, issued: '2026-11-06', termsDays: 30, notes: '', discount: 0, entryIds: [], expenseIds: [], manual: [{ description: 'Workshop', amount: 50000 }] });
    expect(draft.status).toBe(200);
    expect((await c.get('/portal/invoices/' + draft.body.id)).status).toBe(404);
    expect((await c.get('/portal/invoices')).body.map((i: { id: string }) => i.id)).not.toContain(draft.body.id);
  });

  it('another client’s account sees only its own data', async () => {
    const rajiv = await signIn('rajiv@northwind.in');
    expect((await rajiv.get('/portal/session')).body.clientId).toBe('C-11');
    expect((await rajiv.get('/portal/projects')).body.map((p: { id: string }) => p.id).sort()).toEqual(['P-203', 'P-214', 'P-215']);
    expect((await rajiv.get('/portal/projects/P-228')).status).toBe(404);
  });
});

/** Every key anywhere in a JSON value. */
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
};
const INTERNAL = ['assigneeId', 'authorId', 'internal', 'entryIds', 'expenseIds', 'hours', 'managerId', 'budget', 'fee', 'billRate', 'costRate', 'notes', 'note', 'approvalId', 'byId', 'ownerId', 'kind', 'margin', 'issuedTotals'];

describe('3 · nothing internal in any portal response', () => {
  it('no internal field, and no internal note’s text', async () => {
    const c = await client();
    const all = [];
    for (const path of ['/portal/session', '/portal/projects', '/portal/invoices', '/portal/tickets', '/portal/documents']) all.push((await c.get(path)).body);
    for (const t of (await c.get('/portal/tickets')).body) all.push((await c.get('/portal/tickets/' + t.id)).body);
    for (const i of (await c.get('/portal/invoices')).body) all.push((await c.get('/portal/invoices/' + i.id)).body);
    const keys = keysOf(all);
    for (const k of INTERNAL) expect(keys.has(k), k).toBe(false);
    const notes = (await sql<{ text: string }>`SELECT m.text FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.client_id = ${CLIENT} AND m.internal`.execute(db)).rows;
    const json = JSON.stringify(all);
    for (const n of notes) expect(json.includes(n.text), n.text).toBe(false);
  });
});

/** Raw SQL as the portal role for Lumen, returning rows or the database's error message. */
const asPortal = (statement: string, clientId = CLIENT) =>
  withClientScope(clientId, async (q) => (await ksql.raw<Record<string, unknown>>(statement).execute(q)).rows).catch((e: Error) => e.message);

describe('4 · database walls (riona_portal), even with a broken query', () => {
  it('internal tables are out of reach', async () => {
    for (const table of ['timesheet_entries', 'employees', 'users', 'sessions', 'salary_events', 'payslips', 'audit_log', 'expenses', 'invoice_line_entries', 'invoice_line_expenses', 'approvals', 'entry_costs', 'budgets', 'payment_intents', 'outbox']) {
      expect(await asPortal(`SELECT * FROM ${table} LIMIT 1`), table).toMatch(/permission denied/);
    }
  });

  it('internal columns are out of reach on shared tables', async () => {
    for (const [table, col] of [['tickets', 'assignee_id'], ['ticket_messages', 'internal'], ['ticket_messages', 'author_id'], ['tasks', 'title'], ['tasks', 'assignee_id'], ['tasks', 'estimate_hours'], ['projects', 'budget_paise'], ['projects', 'manager_id'], ['projects', 'fee_paise'], ['invoices', 'notes'], ['invoices', 'approval_id'], ['invoice_lines', 'kind'], ['invoice_revisions', 'lines'], ['documents', 'visible_to_client'], ['document_versions', 'by_id'], ['document_versions', 'note'], ['clients', 'owner_id'], ['payments', 'actor_id']]) {
      expect(await asPortal(`SELECT ${col} FROM ${table}`), `${table}.${col}`).toMatch(/permission denied/);
    }
    expect(await asPortal('SELECT * FROM invoices')).toMatch(/permission denied/);
  });

  it('a query without a WHERE clause sees only Lumen’s rows', async () => {
    const own = async (q: string) => (await sql.raw<{ id: string }>(q).execute(db)).rows.map((r) => r.id).sort();
    const ids = async (statement: string) => ((await asPortal(statement)) as { id: string }[]).map((r) => r.id).sort();
    expect(await ids('SELECT id FROM clients')).toEqual([CLIENT]);
    expect(await ids('SELECT id FROM projects')).toEqual(['P-228']);
    expect(await ids('SELECT id FROM invoices')).toEqual(await own(`SELECT id FROM invoices WHERE client_id = '${CLIENT}' AND status NOT IN ('Draft','Void')`));
    expect(await ids('SELECT id FROM invoice_lines')).toEqual(await own(`SELECT l.id FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.client_id = '${CLIENT}' AND i.status NOT IN ('Draft','Void')`));
    expect(await ids('SELECT id FROM tickets')).toEqual(await own(`SELECT id FROM tickets WHERE client_id = '${CLIENT}'`));
    expect(await ids('SELECT id FROM ticket_messages')).toEqual(await own(`SELECT m.id FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.client_id = '${CLIENT}' AND NOT m.internal`));
    expect(await ids('SELECT id FROM documents')).toEqual(['DOC-283', 'DOC-284', 'DOC-300']);
    expect(await asPortal('SELECT DISTINCT project_id AS id FROM tasks')).toEqual([{ id: 'P-228' }]);
    // A join that "forgets" the client still can't reach anyone else's rows.
    expect(await ids('SELECT DISTINCT i.id FROM invoices i, projects p')).toEqual(await ids('SELECT id FROM invoices'));
    const internalNotes = await own(`SELECT m.id FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.client_id = '${CLIENT}' AND m.internal`);
    expect(internalNotes.length).toBeGreaterThan(0); // the test means something: Lumen's ticket has internal notes
  });

  it('read-only; without a client id nothing is visible; the pooled connection is restored afterwards', async () => {
    expect(await asPortal(`UPDATE tickets SET status = 'Resolved'`)).toMatch(/read-only|permission denied/);
    expect(await asPortal(`INSERT INTO ticket_messages (id, ticket_id, author, text) VALUES ('X', 'TK-1155', 'x', 'x')`)).toMatch(/read-only|permission denied/);
    // The scope set to a client that doesn't exist sees nothing.
    expect(await asPortal('SELECT id FROM invoices', 'C-NOPE')).toEqual([]);
    // No client id at all: portal_client() is null and matches no rows.
    const none = await db.transaction().execute(async (trx) => {
      await ksql`SET LOCAL ROLE riona_portal`.execute(trx);
      return (await ksql<{ n: number }>`SELECT count(*)::int AS n FROM invoices`.execute(trx)).rows[0].n;
    });
    expect(none).toBe(0);
    const after = await Promise.all(Array.from({ length: 12 }, () => sql<{ u: string; c: string | null }>`SELECT current_user AS u, current_setting('riona.client_id', true) AS c`.execute(db)));
    expect(after.every((r) => r.rows[0].u !== 'riona_portal' && !r.rows[0].c)).toBe(true);
  });
});

/** A fresh issued invoice for Lumen (so payments don't change the seeded ones other tests compare). */
async function issuedInvoice(amount: number) {
  const admin = await signIn('Admin');
  const draft = await admin.post('/invoices', { clientId: CLIENT, issued: '2026-11-06', termsDays: 30, notes: '', discount: 0, entryIds: [], expenseIds: [], manual: [{ description: 'Support retainer', amount }] });
  const sent = await admin.post(`/invoices/${draft.body.id}/send`);
  expect(sent.body.status).toBe('Sent');
  return draft.body.id as string;
}

describe('5 · tickets both ways, paying online, the gateway webhook', () => {
  it('a client raises a ticket; staff see it with its assignee; an internal note never reaches the client; a reply does', async () => {
    const c = await client();
    const raised = await c.post('/portal/tickets', { subject: 'Dashboard shows last week', text: 'The energy dashboard still shows last week’s data.', priority: 'High', projectId: 'P-228' });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    const id = raised.body.id;
    expect(raised.body).toMatchObject({ clientId: CLIENT, status: 'Open', priority: 'High', projectId: 'P-228' });
    expect(raised.body.messages).toEqual([expect.objectContaining({ author: 'Meghna Sood', fromClient: true })]);
    expect((await c.post('/portal/tickets', { subject: 'x', text: 'y', priority: 'Low', projectId: 'P-214' })).status).toBe(422); // not their project

    const admin = await signIn('Admin');
    const staff = (await admin.get('/tickets/' + id)).body;
    const manager = (await db.selectFrom('projects').select('managerId').where('id', '=', 'P-228').executeTakeFirstOrThrow()).managerId;
    expect(staff.assigneeId).toBe(manager);
    expect((await admin.post(`/tickets/${id}/messages`, { text: 'Cache TTL is 7 days — our bug.', internal: true })).status).toBe(200);
    expect((await admin.post(`/tickets/${id}/messages`, { text: 'Fixed; data is current now.', internal: false })).status).toBe(200);
    expect((await admin.patch(`/tickets/${id}`, { status: 'Waiting on client' })).status).toBe(200);

    const seen = (await c.get('/portal/tickets/' + id)).body;
    expect(seen.messages.map((m: { text: string }) => m.text)).toEqual(['The energy dashboard still shows last week’s data.', 'Fixed; data is current now.']);
    expect(seen.messages[1].author).toBe('Dipak Sharma · Kestrel');
    const mail = await db.selectFrom('outbox').select('payload').where('topic', '=', 'email').execute();
    expect(mail.some((m) => (m.payload as { to: string; subject: string }).to === 'meghna@lumen.in' && (m.payload as { subject: string }).subject.includes(id))).toBe(true);

    const reply = await c.post(`/portal/tickets/${id}/messages`, { text: 'Confirmed, thanks!' });
    expect(reply.body.status).toBe('In progress');
    expect((await c.post(`/portal/tickets/${id}/messages`, { text: '   ' })).status).toBe(422);
  });

  it('paying online settles the balance once; paying again is refused', async () => {
    const c = await client();
    const inv = await issuedInvoice(80000);
    const before = (await c.get('/portal/invoices/' + inv)).body;
    expect(before.balance).toBeGreaterThan(0);
    const paid = await c.post(`/portal/invoices/${inv}/pay`, { method: 'UPI' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'Paid', balance: 0, paid: before.total });
    expect(paid.body.payments.at(-1)).toMatchObject({ amount: before.balance, method: 'UPI' });
    expect((await c.post(`/portal/invoices/${inv}/pay`, { method: 'UPI' })).status).toBe(409);
    // Finance sees the same payment.
    const fin = (await (await signIn('Admin')).get('/invoices/' + inv)).body;
    expect(fin.status).toBe('Paid');
    expect(fin.payments.at(-1).reference).toBe(paid.body.payments.at(-1).reference);
  });

  it('the webhook needs a valid signature, checks the amount, and settles an intent once', async () => {
    const app = await testApp();
    const invId = await issuedInvoice(120000);
    const inv = (await (await client()).get('/portal/invoices/' + invId)).body;
    const amount = Math.round(inv.balance * 100);
    await db.insertInto('paymentIntents').values({ id: 'PI-TEST-1', invoiceId: invId, clientId: CLIENT, amountPaise: amount, method: 'NEFT' }).execute();
    await db.insertInto('paymentIntents').values({ id: 'PI-TEST-2', invoiceId: invId, clientId: CLIENT, amountPaise: amount, method: 'NEFT' }).execute();
    const send = (body: object, signature?: string) => {
      const raw = JSON.stringify(body);
      return app.inject({ method: 'POST', url: PREFIX + '/webhooks/payments', payload: raw, headers: { 'content-type': 'application/json', 'x-riona-signature': signature ?? signPayload(raw, process.env.PAYMENT_WEBHOOK_SECRET!) } });
    };
    expect((await send({ intentId: 'PI-TEST-1', status: 'captured', reference: 'GW-1', amount }, 'sha256=00')).statusCode).toBe(401);
    expect((await send({ intentId: 'PI-NOPE', status: 'captured', reference: 'GW-0' })).statusCode).toBe(404);
    // A wrong amount fails the intent rather than booking it.
    const wrong = await send({ intentId: 'PI-TEST-2', status: 'captured', reference: 'GW-2', amount: amount + 100 });
    expect(JSON.parse(wrong.body)).toMatchObject({ status: 'Failed', changed: true });

    const ok = await send({ intentId: 'PI-TEST-1', status: 'captured', reference: 'GW-1', amount });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ status: 'Captured', changed: true });
    const again = await send({ intentId: 'PI-TEST-1', status: 'captured', reference: 'GW-1', amount });
    expect(JSON.parse(again.body)).toMatchObject({ status: 'Captured', changed: false });
    const pays = await db.selectFrom('payments').select('reference').where('invoiceId', '=', invId).where('reference', '=', 'GW-1').execute();
    expect(pays).toHaveLength(1);
    expect((await (await client()).get('/portal/invoices/' + invId)).body.status).toBe('Paid');
  });
});
