/**
 * Sign-in, password reset and organisation setup. Error messages are UI copy and never reveal whether an
 * email has an account.
 */
import { sql } from 'kysely';
import { config } from '../../config';
import { db } from '../../db/client';
import { hashPassword, MIN_PASSWORD_LENGTH, needsRehash, verifyPassword } from '../../auth/password';
import { ApiError, gone, notFound, unprocessable } from '../../lib/errors';
import { newId, newToken } from '../../lib/ids';
import { hashToken } from '../../http/plugins/session';
import { today } from '../../lib/dates';
import { SYSTEM_ACTOR, withTransaction } from '../../db/tx';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const BAD_LOGIN = 'That email and password don’t match.';

const byEmail = (email: string) =>
  db.selectFrom('users').selectAll().where(sql`lower(email)`, '=', email.trim().toLowerCase()).executeTakeFirst();

/** Checks the password and returns the user to start a session for. Five failures lock the account for 15 minutes. */
export async function signIn(email: string, password: string) {
  const user = await byEmail(email);
  if (user?.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
    throw new ApiError(429, `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`, 'auth.locked');
  }
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok || user.status !== 'Active') {
    if (user && !ok) {
      const failures = user.failedLogins + 1;
      const lock = failures >= MAX_FAILURES;
      await withTransaction({ ...SYSTEM_ACTOR, employeeId: user.employeeId, name: user.name }, async (tx) => {
        await tx.db
          .updateTable('users')
          .set({ failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where('id', '=', user.id)
          .execute();
        if (lock) await tx.audit('Locked', 'User', user.id, [{ field: 'reason', before: null, after: `${MAX_FAILURES} failed sign-ins` }]);
      });
    }
    throw new ApiError(401, BAD_LOGIN, 'auth.bad_credentials');
  }
  const patch: { failedLogins: number; lockedUntil: null; passwordHash?: string } = { failedLogins: 0, lockedUntil: null };
  if (needsRehash(user.passwordHash!)) patch.passwordHash = await hashPassword(password);
  await db.updateTable('users').set(patch).where('id', '=', user.id).execute();
  return user;
}

/**
 * Always succeeds from the caller's view; for an active account, stores a one-hour reset link and queues the
 * email in the same transaction (sent after commit by the outbox dispatcher).
 */
export async function requestPasswordReset(email: string, ip = '') {
  const user = await byEmail(email);
  if (!user || user.status !== 'Active') return;
  const token = newToken();
  await withTransaction({ ...SYSTEM_ACTOR, employeeId: user.employeeId, name: user.name, ip }, async (tx) => {
    await tx.db.insertInto('passwordResets').values({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) }).execute();
    await tx.audit('Requested', 'Password reset', user.id);
    await tx.email({
      to: user.email,
      subject: 'Reset your Riona password',
      text: `Someone asked to reset the password for this account. If it was you, use this link within an hour:\n\n${config.appOrigin}/#/reset-password/${token}\n\nIf it wasn’t, ignore this email.`,
    });
  });
}

async function liveSetupToken(token: string) {
  const row = await db.selectFrom('setupTokens').selectAll().where('tokenHash', '=', hashToken(token)).executeTakeFirst();
  if (!row) throw notFound('This setup link isn’t valid. Check the link in your email.');
  if (row.usedAt || Date.parse(row.expiresAt) < Date.now()) throw gone('This setup link has expired. Ask for a new one.');
  return row;
}

export async function checkSetupToken(token: string) {
  const row = await liveSetupToken(token);
  return { orgName: row.orgName, email: row.email };
}

export type SetupInput = { orgName: string; legalName: string; state: string; gstin: string; adminName: string; password: string; modules: string[] };

/** Creates (or updates) the organisation and its first Admin, and returns the Admin's user id. */
export async function completeSetup(token: string, input: SetupInput, ip = ''): Promise<string> {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw unprocessable(`Use at least ${MIN_PASSWORD_LENGTH} characters.`, { password: 'Too short' });
  await liveSetupToken(token);
  const passwordHash = await hashPassword(input.password);
  return withTransaction({ ...SYSTEM_ACTOR, name: input.adminName, ip }, async (tx) => {
    const trx = tx.db;
    // Claim the link inside the transaction, so it can't be used twice at once.
    const claimed = await trx
      .updateTable('setupTokens')
      .set({ usedAt: new Date() })
      .where('tokenHash', '=', hashToken(token))
      .where('usedAt', 'is', null)
      .where('expiresAt', '>', new Date().toISOString())
      .returning(['email'])
      .executeTakeFirst();
    if (!claimed) throw gone('This setup link has expired. Ask for a new one.');
    const org = { name: input.orgName, legalName: input.legalName, state: input.state, gstin: input.gstin, modules: input.modules };
    await trx.insertInto('org').values(org).onConflict((oc) => oc.column('id').doUpdateSet(org)).execute();

    const email = claimed.email.toLowerCase();
    let emp = await trx.selectFrom('employees').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (!emp) {
      const last = await trx.selectFrom('employees').select(sql<number>`max(substring(id from 3)::int)`.as('n')).where('id', '~', '^E-\\d+$').executeTakeFirst();
      emp = { id: 'E-' + String((last?.n ?? 0) + 1).padStart(4, '0') };
      await trx
        .insertInto('employees')
        .values({ id: emp.id, name: input.adminName, email: claimed.email, title: 'Administrator', dept: 'Leadership', state: input.state, type: 'Full-time', status: 'Active', joined: today() })
        .execute();
    }
    const existing = await trx.selectFrom('users').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    const userId = existing?.id ?? newId('U');
    if (existing) {
      await trx.updateTable('users').set({ passwordHash, status: 'Active', role: 'Admin', roleName: 'Admin', employeeId: emp.id, name: input.adminName }).where('id', '=', userId).execute();
    } else {
      await trx.insertInto('users').values({ id: userId, employeeId: emp.id, email: claimed.email, name: input.adminName, role: 'Admin', roleName: 'Admin', status: 'Active', passwordHash }).execute();
    }
    await tx.audit('Set up', 'Organisation', 'ORG', [{ field: 'name', before: null, after: input.orgName }]);
    await tx.audit(existing ? 'Updated' : 'Created', 'User', userId, [{ field: 'role', before: null, after: 'Admin' }]);
    return userId;
  });
}

// ---------------- setting a password from an emailed link ----------------
// The same link serves "Forgot password" (an hour) and an invitation (a week): #/reset-password/:token.

async function liveReset(token: string) {
  const row = await db
    .selectFrom('passwordResets as r')
    .innerJoin('users as u', 'u.id', 'r.userId')
    .select(['r.tokenHash', 'r.expiresAt', 'r.usedAt', 'u.id as userId', 'u.email', 'u.name', 'u.status'])
    .where('r.tokenHash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) throw notFound('This link isn’t valid. Check the link in your email.');
  if (row.usedAt || Date.parse(row.expiresAt) < Date.now() || row.status === 'Deactivated') throw gone('This link has expired. Ask for a new one.');
  return row;
}

/** GET /auth/reset/:token — whose link it is, and whether it is a first password (an invitation). */
export async function checkResetToken(token: string) {
  const row = await liveReset(token);
  return { email: row.email, name: row.name, invite: row.status === 'Invited' };
}

/** POST /auth/reset/:token { password } — sets the password (an invited account becomes active) and ends other sessions. */
export async function completeReset(token: string, password: string, ip = ''): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw unprocessable(`Use at least ${MIN_PASSWORD_LENGTH} characters.`, { password: 'Too short' });
  const row = await liveReset(token);
  const passwordHash = await hashPassword(password);
  return withTransaction({ ...SYSTEM_ACTOR, name: row.name, ip }, async (tx) => {
    const claimed = await tx.db
      .updateTable('passwordResets')
      .set({ usedAt: new Date() })
      .where('tokenHash', '=', hashToken(token))
      .where('usedAt', 'is', null)
      .returning('userId')
      .executeTakeFirst();
    if (!claimed) throw gone('This link has expired. Ask for a new one.');
    await tx.db.updateTable('users').set({ passwordHash, failedLogins: 0, lockedUntil: null, ...(row.status === 'Invited' ? { status: 'Active' } : {}) }).where('id', '=', row.userId).execute();
    await tx.db.updateTable('sessions').set({ revokedAt: new Date() }).where('userId', '=', row.userId).where('revokedAt', 'is', null).execute();
    // Other unused links for this account stop working too.
    await tx.db.updateTable('passwordResets').set({ usedAt: new Date() }).where('userId', '=', row.userId).where('usedAt', 'is', null).execute();
    await tx.audit(row.status === 'Invited' ? 'Activated' : 'Reset password', 'User', row.userId);
    return row.userId;
  });
}
