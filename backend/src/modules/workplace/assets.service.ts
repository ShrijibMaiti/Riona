/**
 * The asset register. With workplace:view (Admin, HR, managers, IT) the whole register; otherwise only what the
 * person holds or has held. Allocating takes workplace:edit (Admin, IT). The holder reports problems on what they
 * hold. An asset has at most one open allocation (database: asset_allocations_open_key).
 */
import type { Asset } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, can, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso, today } from '../../lib/dates';
import { toRupees } from '../../lib/money';

type Q = Kysely<DB> | Transaction<DB>;

export const AssetIssue = z.object({ text: z.string({ required_error: 'Say what’s wrong in a few words.' }).max(2000) });
export const Allocate = z.object({ employeeId: z.string().max(40).nullable(), note: z.string().max(500).default('') });

async function load(q: Q, where: { ids?: string[]; heldBy?: string; everHeldBy?: string } = {}): Promise<Asset[]> {
  let aq = q.selectFrom('assets').selectAll();
  if (where.ids) aq = aq.where('id', 'in', where.ids.length ? where.ids : ['-']);
  if (where.heldBy) aq = aq.where('id', 'in', q.selectFrom('assetAllocations').select('assetId').where('employeeId', '=', where.heldBy).where('to', 'is', null));
  if (where.everHeldBy) aq = aq.where('id', 'in', q.selectFrom('assetAllocations').select('assetId').where('employeeId', '=', where.everHeldBy));
  const rows = await aq.orderBy(sql`length(id)`).orderBy('id').execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [allocs, issues] = await Promise.all([
    q.selectFrom('assetAllocations').selectAll().where('assetId', 'in', ids).orderBy('id').execute(),
    q.selectFrom('assetIssues').selectAll().where('assetId', 'in', ids).orderBy('at').orderBy('id').execute(),
  ]);
  return rows.map((a) => {
    const mine = issues.filter((i) => i.assetId === a.id);
    return {
      id: a.id, tag: a.tag, name: a.name, category: a.category as Asset['category'], serial: a.serial, purchased: a.purchased, cost: toRupees(a.costPaise),
      status: a.status as Asset['status'],
      allocations: allocs.filter((x) => x.assetId === a.id).map((x) => ({ employeeId: x.employeeId, from: x.from, to: x.to, note: x.note })),
      ...(mine.length ? { issues: mine.map((i) => ({ id: i.id, at: i.at, reportedById: i.reportedById, text: i.text })) } : {}),
    };
  });
}

/** GET /assets — the register, or (without workplace access) what the person holds or has held. */
export async function listAssets(actor: Actor): Promise<Asset[]> {
  if (can(actor, 'workplace', 'view')) return load(db);
  return actor.employeeId ? load(db, { everHeldBy: actor.employeeId }) : [];
}

/** GET /me/assets — what the signed-in person holds now. */
export async function myAssets(actor: Actor): Promise<Asset[]> {
  return load(db, { heldBy: selfId(actor) });
}

/** GET /assets/:id */
export async function getAsset(actor: Actor, id: string): Promise<Asset> {
  const [a] = await load(db, { ids: [id] });
  if (!a || (!can(actor, 'workplace', 'view') && !a.allocations.some((x) => x.employeeId === actor.employeeId))) throw notFound('Asset not found');
  return a;
}

/** POST /assets/:id/issues { text } — the current holder reports a problem; IT sees it on the asset. */
export async function reportAssetIssue(actor: Actor, id: string, text: string): Promise<Asset> {
  const me = selfId(actor);
  if (text.trim().length < 5) throw unprocessable('Say what’s wrong in a few words.', { text: 'Too short' });
  return withTransaction(actor, async (tx) => {
    const asset = await tx.db.selectFrom('assets').select('id').where('id', '=', id).executeTakeFirst();
    if (!asset) throw notFound('Asset not found');
    const holds = await tx.db.selectFrom('assetAllocations').select('id').where('assetId', '=', id).where('employeeId', '=', me).where('to', 'is', null).executeTakeFirst();
    if (!holds) throw forbidden('You can only report issues on items you hold.');
    const issueId = newId('AI');
    await tx.db.insertInto('assetIssues').values({ id: issueId, assetId: id, at: nowIso(), reportedById: me, text: text.trim() }).execute();
    await tx.audit('Created', 'Asset issue', id, [{ field: 'issue', before: null, after: text.trim() }]);
    // Tell whoever looks after assets (IT, else Admin).
    const it = await tx.db.selectFrom('users').select('employeeId').where('status', '=', 'Active').where('employeeId', 'is not', null)
      .where((eb) => eb.or([eb('roleName', '=', 'IT'), eb('role', '=', 'Admin')])).orderBy(sql`role_name = 'IT'`, 'desc').orderBy('employeeId').executeTakeFirst();
    if (it?.employeeId && it.employeeId !== me) await tx.notify({ recipientIds: [it.employeeId], kind: 'System', text: `${actor.name} reported a problem with ${id}: ${text.trim().slice(0, 80)}`, href: '/app/workplace/assets/' + id });
    return (await load(tx.db, { ids: [id] }))[0];
  });
}

/** POST /assets/:id/allocate { employeeId, note } — closes the open allocation first; null returns it to stock. */
export async function allocateAsset(actor: Actor, id: string, employeeId: string | null, note: string): Promise<Asset> {
  authorize(actor, 'workplace', 'edit');
  return withTransaction(actor, async (tx) => {
    const asset = await tx.db.selectFrom('assets').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!asset) throw notFound('Asset not found');
    if (asset.status === 'Retired') throw conflict('This asset is retired.');
    if (employeeId) {
      const emp = await tx.db.selectFrom('employees').select(['id', 'status']).where('id', '=', employeeId).executeTakeFirst();
      if (!emp || emp.status === 'Inactive') throw unprocessable('Choose a current employee.', { employeeId: 'Unknown' });
    }
    const open = await tx.db.selectFrom('assetAllocations').select(['id', 'employeeId']).where('assetId', '=', id).where('to', 'is', null).executeTakeFirst();
    if (open?.employeeId === employeeId) return (await load(tx.db, { ids: [id] }))[0];
    const on = today();
    if (open) await tx.db.updateTable('assetAllocations').set({ to: on }).where('id', '=', open.id).execute();
    if (employeeId) await tx.db.insertInto('assetAllocations').values({ assetId: id, employeeId, from: on, to: null, note: note.trim() }).execute();
    await tx.db.updateTable('assets').set({ status: employeeId ? 'Allocated' : 'Available' }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Asset', id, [{ field: 'holder', before: open?.employeeId ?? null, after: employeeId }]);
    if (employeeId) await tx.notify({ recipientIds: [employeeId], kind: 'System', text: `${id} has been allocated to you`, href: '/app/me/assets' });
    return (await load(tx.db, { ids: [id] }))[0];
  });
}
