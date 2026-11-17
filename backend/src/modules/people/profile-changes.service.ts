/**
 * Changes to HR-approved profile fields (legal name, address, marital status, bank account, PAN). The employee
 * asks; HR approves; only then does the record change. One pending change per field.
 */
import type { ProfileChange } from '@riona/shared';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { ProfileChanges } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { openApproval } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { F } from '../../lib/validate';

const FIELDS = ['Legal name', 'Address', 'Marital status', 'Bank account', 'PAN'] as const;

/** POST /me/profile-changes { field, after, reason } */
export const NewProfileChange = z.object({
  field: z.enum(FIELDS, { errorMap: () => ({ message: 'Choose what to change.' }) }),
  after: F.text(500),
  reason: F.text(500).default(''),
});

const toChange = (r: Selectable<ProfileChanges>): ProfileChange => ({
  id: r.id, employeeId: r.employeeId, field: r.field as ProfileChange['field'], before: r.before, after: r.after, reason: r.reason,
  submitted: r.submitted, status: r.status as ProfileChange['status'], approvalId: r.approvalId ?? '',
});

/** GET /me/profile-changes — the signed-in person's, newest first. */
export async function getMyProfileChanges(actor: Actor): Promise<ProfileChange[]> {
  const me = selfId(actor);
  return (await db.selectFrom('profileChanges').selectAll().where('employeeId', '=', me).orderBy('submitted', 'desc').orderBy('id', 'desc').execute()).map(toChange);
}

export async function requestProfileChange(actor: Actor, input: z.infer<typeof NewProfileChange>): Promise<ProfileChange> {
  const me = selfId(actor);
  let after = input.after.trim();
  if (!after) throw unprocessable('Enter the new value.', { after: 'Required' });
  if (input.field === 'PAN') {
    after = after.toUpperCase();
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(after)) throw unprocessable('A PAN has ten characters, like ABCDE1234F.', { after: 'Not a PAN' });
  }
  if (input.field === 'Marital status' && after !== 'Married' && after !== 'Single') throw unprocessable('Choose Married or Single.', { after: 'Not valid' });
  return withTransaction(actor, async (tx) => {
    const e = await tx.db.selectFrom('employees').selectAll().where('id', '=', me).executeTakeFirstOrThrow();
    const waiting = await tx.db.selectFrom('profileChanges').select('id').where('employeeId', '=', me).where('field', '=', input.field).where('status', '=', 'Pending').executeTakeFirst();
    if (waiting) throw conflict('A change to this field is already waiting on HR.');
    const before = input.field === 'Legal name' ? e.name : input.field === 'Address' ? e.address : input.field === 'Marital status' ? e.maritalStatus
      : input.field === 'PAN' ? e.pan : `${e.bankName} · ${e.bankIfsc} · ••••${e.bankAccount.slice(-4)}`;
    const id = newId('PC');
    await tx.db.insertInto('profileChanges').values({ id, employeeId: me, field: input.field, before, after, reason: input.reason, submitted: today(), status: 'Pending' }).execute();
    const ap = await openApproval(tx, { type: 'Profile change', sourceId: id, requesterId: me, facts: { field: input.field } });
    await tx.db.updateTable('profileChanges').set({ approvalId: ap.id }).where('id', '=', id).execute();
    // The bank account is never written to the audit log in full.
    await tx.audit('Created', 'Profile change', id, [{ field: input.field, before, after: input.field === 'Bank account' ? '(new account)' : after }]);
    return toChange((await tx.db.selectFrom('profileChanges').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

export const profileChangeOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => {
    const rows = ids.length ? await q.selectFrom('profileChanges').selectAll().where('id', 'in', ids).execute() : [];
    return new Map(rows.map((r) => [r.id, { kind: 'Profile change' as const, change: toChange(r) }]));
  },
  apply: async (tx, a) => {
    const c = await tx.db.selectFrom('profileChanges').selectAll().where('id', '=', a.sourceId).executeTakeFirst();
    if (!c) return;
    await tx.db.updateTable('profileChanges').set({ status: a.status }).where('id', '=', c.id).execute();
    if (a.status !== 'Approved') return;
    if (c.field === 'Bank account') {
      // "HDFC Bank · HDFC0001234 · 50218834109712" (the account number may be written with spaces).
      const [name, ifsc, acct] = c.after.split('·').map((s) => s.trim());
      await tx.db.updateTable('employees').set({ bankName: name ?? '', bankIfsc: ifsc ?? '', bankAccount: (acct ?? '').replace(/\s+/g, '') }).where('id', '=', c.employeeId).execute();
    } else {
      const column = c.field === 'Legal name' ? 'name' : c.field === 'Address' ? 'address' : c.field === 'Marital status' ? 'maritalStatus' : 'pan';
      await tx.db.updateTable('employees').set({ [column]: c.after }).where('id', '=', c.employeeId).execute();
    }
    await tx.audit('Updated', 'Employee', c.employeeId, [{ field: c.field, before: c.before, after: c.field === 'Bank account' ? '(approved new account)' : c.after }]);
  },
};
