/**
 * Admin › Roles: each role's permission per module, as shown on the matrix. Changes are kept and audited.
 *
 * Note: what the API enforces is the matrix in auth/rbac/permissions.ts, keyed by the built-in roles. These
 * stored permissions describe the roles for people (and the Roles screen); they don't change enforcement yet.
 */
import type { Permission, RoleDef } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';

export const SetPermission = z.object({ permission: z.enum(['none', 'view', 'edit', 'approve'], { errorMap: () => ({ message: 'Choose none, view, edit or approve.' }) }) });

const toRole = (r: { id: string; name: string; seeded: boolean; description: string; permissions: unknown }): RoleDef =>
  ({ id: r.id, name: r.name, seeded: r.seeded, description: r.description, permissions: r.permissions as Record<string, Permission> });

/** GET /roles */
export async function listRoles(actor: Actor): Promise<RoleDef[]> {
  authorize(actor, 'admin', 'view');
  return (await db.selectFrom('roles').selectAll().orderBy('id').execute()).map(toRole);
}

/** PUT /roles/:id/permissions/:module { permission } */
export async function setPermission(actor: Actor, roleId: string, module: string, permission: Permission): Promise<RoleDef> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    const r = await tx.db.selectFrom('roles').selectAll().where('id', '=', roleId).forUpdate().executeTakeFirst();
    if (!r) throw notFound('Role not found');
    const perms = r.permissions as Record<string, Permission>;
    if (!(module in perms)) throw unprocessable('Unknown module.', { module: 'Unknown' });
    // Admins must always be able to manage users, or nobody can fix access again.
    if (r.name === 'Admin' && module === 'Admin · Users' && permission !== 'edit' && permission !== 'approve') throw conflict('Admins keep access to users.');
    if (perms[module] === permission) return toRole(r);
    const next = { ...perms, [module]: permission };
    await tx.db.updateTable('roles').set({ permissions: JSON.stringify(next) }).where('id', '=', roleId).execute();
    await tx.audit('Updated', 'Role', roleId, [{ field: module, before: perms[module], after: permission }]);
    return toRole({ ...r, permissions: next });
  });
}
