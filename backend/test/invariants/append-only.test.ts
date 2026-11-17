/**
 * Wave 2: the write path.
 *  - a write through withTransaction leaves its domain row, audit entry and outbox row together, or none of them
 *  - the audit log refuses UPDATE, DELETE and TRUNCATE in the database itself
 *  - email and notifications are delivered only after commit, at least once, with retries
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR, withTransaction } from '../../src/db/tx';
import { dispatchOnce, MAX_ATTEMPTS, setAutoDispatch } from '../../src/engines/notifications/dispatcher.job';
import { setEmailTransport } from '../../src/engines/notifications/channels/email';
import type { EmailPayload } from '../../src/engines/notifications/outbox';
import { diff } from '../../src/engines/audit/audit';
import { percentOf, sumPaise, toPaise, toRupees } from '../../src/lib/money';
import { newId, newToken } from '../../src/lib/ids';
import { count, db, sql, sqlError } from '../helpers/db';

const sent: EmailPayload[] = [];
let originalPhone = '';
const actor = { ...SYSTEM_ACTOR, employeeId: 'E-0101', name: 'Ananya Rao', ip: '127.0.0.1', requestId: 'req-test' };
const EMP = 'E-0130';

beforeAll(async () => {
  setAutoDispatch(false); // the tests decide when delivery runs
  setEmailTransport(async (m) => void sent.push(m));
  await dispatchOnce(); // drain anything earlier writes queued
  originalPhone = await phoneOf();
});
afterEach(() => {
  sent.length = 0;
  setEmailTransport(async (m) => void sent.push(m));
});
afterAll(async () => {
  setEmailTransport();
  // Other test files compare employees with the seed: put the phone back.
  await db.updateTable('employees').set({ phone: originalPhone }).where('id', '=', EMP).execute();
  await db.destroy();
});

const phoneOf = async () => (await db.selectFrom('employees').select('phone').where('id', '=', EMP).executeTakeFirstOrThrow()).phone;

/** One realistic write: change a phone number, audit it, tell the person, email them. */
const changePhone = (phone: string, failAfterWriting = false) =>
  withTransaction(actor, async (tx) => {
    const before = await tx.db.selectFrom('employees').select(['phone', 'email']).where('id', '=', EMP).executeTakeFirstOrThrow();
    await tx.db.updateTable('employees').set({ phone }).where('id', '=', EMP).execute();
    await tx.audit('Updated', 'Employee', EMP, diff({ phone: before.phone }, { phone }, ['phone']));
    await tx.notify({ recipientIds: [EMP], kind: 'System', text: 'HR updated your phone number.', href: '/app/me/profile' });
    await tx.email({ to: before.email, subject: 'Your phone number changed', text: `It is now ${phone}.` });
    if (failAfterWriting) throw new Error('boom');
  });

describe('withTransaction', () => {
  it('commits the domain row, its audit entry and its outbox rows together', async () => {
    const audits = await count('audit_log', `entity_id = '${EMP}'`);
    const outbox = await count('outbox');
    await changePhone('+91 98450 11111');
    expect(await phoneOf()).toBe('+91 98450 11111');
    expect(await count('audit_log', `entity_id = '${EMP}'`)).toBe(audits + 1);
    expect(await count('outbox')).toBe(outbox + 2);
    const entry = await db.selectFrom('auditLog').selectAll().where('entityId', '=', EMP).orderBy('seq', 'desc').executeTakeFirstOrThrow();
    expect(entry).toMatchObject({ actorId: 'E-0101', actor: 'Ananya Rao', action: 'Updated', entity: 'Employee', ip: '127.0.0.1', requestId: 'req-test' });
    expect((entry.changes as { field: string; after: string }[])[0]).toMatchObject({ field: 'phone', after: '+91 98450 11111' });
  });

  it('leaves none of them when the work fails part-way', async () => {
    const phone = await phoneOf();
    const audits = await count('audit_log');
    const outbox = await count('outbox');
    await expect(changePhone('+91 00000 00000', true)).rejects.toThrow('boom');
    expect(await phoneOf()).toBe(phone);
    expect(await count('audit_log')).toBe(audits);
    expect(await count('outbox')).toBe(outbox);
  });
});

describe('audit log is append-only', () => {
  it('refuses UPDATE, DELETE and TRUNCATE', async () => {
    expect(await count('audit_log')).toBeGreaterThan(0);
    expect(await sqlError(`UPDATE audit_log SET actor = 'someone else'`)).toMatch(/append-only: UPDATE/);
    expect(await sqlError(`DELETE FROM audit_log`)).toMatch(/append-only: DELETE/);
    expect(await sqlError(`TRUNCATE audit_log`)).toMatch(/append-only: TRUNCATE/);
  });
});

describe('outbox delivery', () => {
  it('sends nothing before commit, everything after, and nothing for a rollback', async () => {
    await dispatchOnce();
    sent.length = 0;
    let duringTransaction = -1;
    await withTransaction(actor, async (tx) => {
      await tx.email({ to: 'meera.iyer@kestrel.digital', subject: 'After commit', text: 'Only once committed.' });
      // The dispatcher runs on its own connection: the uncommitted row is invisible to it.
      duringTransaction = await dispatchOnce();
    });
    expect(duringTransaction).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await dispatchOnce()).toBe(1);
    expect(sent.map((m) => m.subject)).toEqual(['After commit']);

    await expect(withTransaction(actor, async (tx) => {
      await tx.email({ to: 'meera.iyer@kestrel.digital', subject: 'Rolled back', text: 'Never.' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await dispatchOnce();
    expect(sent.map((m) => m.subject)).toEqual(['After commit']);
  });

  it('writes the bell once and queues the email a notification asked for', async () => {
    const bell = await count('notifications', `recipient_id = '${EMP}'`);
    await withTransaction(actor, async (tx) => {
      await tx.notify({ recipientIds: [EMP, EMP], kind: 'System', text: 'Policy updated.', href: '/app/workplace/kb', email: { subject: 'Policy updated' } });
    });
    await dispatchOnce(); // the notification: bell row + a queued email
    await dispatchOnce(); // the email it queued
    expect(await count('notifications', `recipient_id = '${EMP}'`)).toBe(bell + 1);
    const email = (await db.selectFrom('employees').select('email').where('id', '=', EMP).executeTakeFirstOrThrow()).email;
    expect(sent).toEqual([expect.objectContaining({ to: email, subject: 'Policy updated', text: expect.stringContaining('/#/app/workplace/kb') })]);
    expect(await dispatchOnce()).toBe(0); // nothing delivered twice
  });

  it('retries a failed send with backoff and records the error', async () => {
    await dispatchOnce();
    setEmailTransport(async () => {
      throw new Error('SMTP down');
    });
    await withTransaction(actor, (tx) => tx.email({ to: 'x@kestrel.digital', subject: 'Retry me', text: '.' }));
    expect(await dispatchOnce()).toBe(0);
    const row = await db.selectFrom('outbox').selectAll().where(sql<boolean>`payload->>'subject' = 'Retry me'`).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ attempts: 1, lastError: 'SMTP down', dispatchedAt: null });
    expect(Date.parse(row.availableAt)).toBeGreaterThan(Date.now()); // backed off, not retried in a hot loop

    // Once the transport recovers and the backoff has passed, it goes.
    setEmailTransport(async (m) => void sent.push(m));
    await db.updateTable('outbox').set({ availableAt: new Date(Date.now() - 1000) }).where('id', '=', row.id).execute();
    expect(await dispatchOnce()).toBe(1);
    expect(sent.map((m) => m.subject)).toEqual(['Retry me']);
    expect(MAX_ATTEMPTS).toBe(10);
  });
});

describe('ids and money', () => {
  it('makes unguessable ids and tokens', () => {
    expect(newId('SE')).toMatch(/^SE-[0-9a-hjkmnp-tv-z]{10}$/);
    expect(new Set(Array.from({ length: 1000 }, () => newId('X'))).size).toBe(1000);
    expect(newToken()).toMatch(/^[\w-]{43}$/);
  });

  it('keeps money in integer paise', () => {
    expect(toPaise(1234.56)).toBe(123456);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(-10.005)).toBe(-1001);
    expect(toRupees(123456)).toBe(1234.56);
    expect(sumPaise([toPaise(0.1), toPaise(0.2)])).toBe(30);
    expect(percentOf(150000, 12)).toBe(18000);
    expect(() => toPaise(Number.NaN)).toThrow();
  });
});
