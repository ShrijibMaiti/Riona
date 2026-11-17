/**
 * Admin › Users: who can sign in, as what. Inviting gives an employee record (added by HR) an account and emails
 * a link (valid a week) to set a password; the person signs in once they have. Deactivating ends their sessions at once. Two guards: nobody
 * deactivates or demotes themselves, and the last active Admin stays an Admin.
 */
import type { AppUser } from '@riona/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../db/client';
import type { AppRole } from '../../db/schema';
import { withTransaction, type Tx } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { hashToken } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { newId, newToken } from '../../lib/ids';
import { today } from '../../lib/dates';

const INVITE_DAYS = 7;

export const InviteUser = z.object({
  name: z.string({ required_error: 'Enter a name.' }).trim().min(1, 'Enter a name.').max(200),
  email: z.string({ required_error: 'Enter a valid email.' }).trim().email('Enter a valid email.').max(200),
  role: z.string({ required_error: 'Choose a role.' }).min(1, 'Choose a role.').max(60),
});
export const UpdateUser = z.object({
  status: z.enum(['Active', 'Deactivated'], { errorMap: () => ({ message: 'A user is Active or Deactivated.' }) }).optional(),
  role: z.string().min(1).max(60).optional(),
});

/** What the API authorises a role name as. Custom roles take the closest built-in one. */
export const appRoleOf = (roleName: string): Exclude<AppRole, 'Client'> =>
  roleName === 'Admin' || roleName === 'HR' || roleName === 'Manager' || roleName === 'Employee' ? roleName : roleName === 'Finance' ? 'Manager' : 'Employee';

const toUser = (u: { id: string; employeeId: string | null; email: string; name: string; roleName: string; status: string; lastActive: string | null; invited: string }): AppUser => ({
  id: u.id, employeeId: u.employeeId, email: u.email, name: u.name, role: u.roleName, status: u.status as AppUser['status'], lastActive: u.lastActive, invited: u.invited,
});

/** GET /users */
export async function listUsers(actor: Actor): Promise<AppUser[]> {
  authorize(actor, 'admin', 'view');
  const rows = await db.selectFrom('users').select(['id', 'employeeId', 'email', 'name', 'roleName', 'status', 'lastActive', 'invited']).orderBy('name').orderBy('id').execute();
  return rows.map(toUser);
}

/** A link to set a password: the same table and page as a password reset, valid for `days`. */
export async function passwordLink(tx: Tx, userId: string, days: number) {
  const token = newToken();
  await tx.db.insertInto('passwordResets').values({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + days * 24 * 3600_000) }).execute();
  return `${config.appOrigin}/#/reset-password/${token}`;
}

/** POST /users/invite { name, email, role } */
export async function inviteUser(actor: Actor, input: z.infer<typeof InviteUser>): Promise<AppUser> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    const role = await tx.db.selectFrom('roles').select('name').where('name', '=', input.role).executeTakeFirst();
    if (!role || role.name === 'Client') throw unprocessable('Choose one of the staff roles.', { role: 'Unknown' });
    const email = input.email.toLowerCase();
    if (await tx.db.selectFrom('users').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst()) throw conflict('That email already has an account.', 'user.exists');
    // A staff account belongs to an employee record (the app is built around it): HR adds the person first.
    const emp = await tx.db.selectFrom('employees').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (!emp) throw unprocessable('Add them as an employee first (People › New hire), then invite them with the same email.', { email: 'No employee record' }, 'user.no_employee');
    if (await tx.db.selectFrom('users').select('id').where('employeeId', '=', emp.id).executeTakeFirst()) throw conflict('That employee already has an account.', 'user.exists');
    const id = newId('U');
    await tx.db.insertInto('users').values({
      id, employeeId: emp.id, email: input.email, name: input.name, role: appRoleOf(role.name), roleName: role.name, status: 'Invited', invited: today(),
    }).execute();
    const link = await passwordLink(tx, id, INVITE_DAYS);
    const org = (await tx.db.selectFrom('org').select('name').executeTakeFirst())?.name ?? 'Riona';
    await tx.email({ to: input.email, subject: `You’re invited to ${org} on Riona`, text: `${actor.name} invited you to ${org} on Riona as ${role.name}.\n\nSet your password to get started (the link works for ${INVITE_DAYS} days):\n\n${link}` });
    await tx.audit('Created', 'User', id, [{ field: 'status', before: null, after: 'Invited' }, { field: 'role', before: null, after: role.name }]);
    return toUser((await tx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

/** PATCH /users/:id { status?, role? } */
export async function updateUser(actor: Actor, id: string, patch: z.infer<typeof UpdateUser>): Promise<AppUser> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    // Serialise admin changes, so two can't each remove "the other last Admin" at once.
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.users-admins'))`.execute(tx.db);
    const u = await tx.db.selectFrom('users').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!u) throw notFound('User not found');
    if (u.role === 'Client') throw conflict('Client portal accounts are managed from the client’s page.');
    const changes: { field: string; before: string | null; after: string | null }[] = [];
    const set: { status?: string; role?: Exclude<AppRole, 'Client'>; roleName?: string } = {};

    if (patch.role !== undefined && patch.role !== u.roleName) {
      const role = await tx.db.selectFrom('roles').select('name').where('name', '=', patch.role).executeTakeFirst();
      if (!role || role.name === 'Client') throw unprocessable('Choose one of the staff roles.', { role: 'Unknown' });
      if (id === actor.userId) throw conflict('You can’t change your own role. Ask another Admin.');
      set.role = appRoleOf(role.name);
      set.roleName = role.name;
      changes.push({ field: 'role', before: u.roleName, after: role.name });
    }
    if (patch.status !== undefined && patch.status !== u.status) {
      if (id === actor.userId) throw conflict('You can’t deactivate yourself.');
      if (patch.status === 'Active' && !u.passwordHash) throw conflict('They haven’t set a password yet. Their invitation link still works, or invite them again.');
      set.status = patch.status;
      changes.push({ field: 'status', before: u.status, after: patch.status });
    }
    if (!changes.length) return toUser(u);

    const losesAdmin = u.role === 'Admin' && u.status === 'Active' && ((set.role && set.role !== 'Admin') || set.status === 'Deactivated');
    if (losesAdmin) {
      const admins = Number((await tx.db.selectFrom('users').select(sql<number>`count(*)`.as('n')).where('role', '=', 'Admin').where('status', '=', 'Active').executeTakeFirstOrThrow()).n);
      if (admins <= 1) throw conflict('This is the last active Admin. Make someone else an Admin first.', 'user.last_admin');
    }
    await tx.db.updateTable('users').set(set).where('id', '=', id).execute();
    if (set.status === 'Deactivated') await tx.db.updateTable('sessions').set({ revokedAt: new Date() }).where('userId', '=', id).where('revokedAt', 'is', null).execute();
    await tx.audit('Updated', 'User', id, changes);
    return toUser((await tx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

/** POST /users/:id/invite — sends a fresh invitation link (earlier ones stop working). */
export async function resendInvite(actor: Actor, id: string): Promise<AppUser> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    const u = await tx.db.selectFrom('users').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!u) throw notFound('User not found');
    if (u.status !== 'Invited') throw conflict('Only an invited user who hasn’t set a password can be sent a new invitation.');
    await tx.db.updateTable('passwordResets').set({ usedAt: new Date() }).where('userId', '=', id).where('usedAt', 'is', null).execute();
    const link = await passwordLink(tx, id, INVITE_DAYS);
    const org = (await tx.db.selectFrom('org').select('name').executeTakeFirst())?.name ?? 'Riona';
    await tx.email({ to: u.email, subject: `Your invitation to ${org} on Riona`, text: `${actor.name} sent you a new link to join ${org} on Riona as ${u.roleName}.

Set your password (the link works for ${INVITE_DAYS} days):

${link}` });
    await tx.audit('Invited again', 'User', id);
    return toUser(u);
  });
}
