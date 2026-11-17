/** Admin › Masters: reference lists (departments, locations, leave types…). Read by all staff; edited by Admin. */
import type { MasterList } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound, unprocessable } from '../../lib/errors';

type Q = Kysely<DB> | Transaction<DB>;

export const MasterRow = z.object({ values: z.array(z.string().max(200)).max(20), active: z.boolean().default(true) });

async function load(q: Q, ids?: string[]): Promise<MasterList[]> {
  let mq = q.selectFrom('masterLists').selectAll();
  if (ids) mq = mq.where('id', 'in', ids.length ? ids : ['-']);
  const lists = await mq.orderBy('position').execute();
  if (!lists.length) return [];
  const rows = await q.selectFrom('masterRows').selectAll().where('listId', 'in', lists.map((l) => l.id)).orderBy('seq').execute();
  return lists.map((m) => ({ id: m.id, name: m.name, columns: m.columns, rows: rows.filter((r) => r.listId === m.id).map((r) => ({ id: r.id, values: r.values, active: r.active })) }));
}

/** GET /masters */
export async function listMasters(actor: Actor): Promise<MasterList[]> {
  authorize(actor, 'directory', 'view');
  return load(db);
}

/** PUT /masters/:id/rows/:rowId | POST /masters/:id/rows */
export async function saveMasterRow(actor: Actor, listId: string, rowId: string | undefined, row: z.infer<typeof MasterRow>): Promise<MasterList> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    const list = await tx.db.selectFrom('masterLists').selectAll().where('id', '=', listId).forUpdate().executeTakeFirst();
    if (!list) throw notFound('List not found');
    const values = row.values.map((v) => v.trim());
    if (values.length !== list.columns.length || values.some((v) => !v)) throw unprocessable('Fill every column.', { values: 'Incomplete' });
    if (rowId) {
      const r = await tx.db.selectFrom('masterRows').selectAll().where('id', '=', rowId).where('listId', '=', listId).executeTakeFirst();
      if (!r) throw notFound('Row not found');
      await tx.db.updateTable('masterRows').set({ values, active: row.active }).where('id', '=', rowId).execute();
      await tx.audit('Updated', 'Master · ' + list.name, rowId, [
        ...(r.values.join(' · ') !== values.join(' · ') ? [{ field: 'values', before: r.values.join(' · '), after: values.join(' · ') }] : []),
        ...(r.active !== row.active ? [{ field: 'active', before: String(r.active), after: String(row.active) }] : []),
      ]);
    } else {
      const ids = (await tx.db.selectFrom('masterRows').select('id').where('listId', '=', listId).execute()).map((r) => +(r.id.split('-').pop() ?? 0)).filter(Number.isFinite);
      const id = `${listId}-${Math.max(-1, ...ids) + 1}`;
      await tx.db.insertInto('masterRows').values({ id, listId, values, active: row.active }).execute();
      await tx.audit('Created', 'Master · ' + list.name, id, [{ field: 'values', before: null, after: values.join(' · ') }]);
    }
    return (await load(tx.db, [listId]))[0];
  });
}
