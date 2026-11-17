/**
 * Stock: items with their movements. Anyone on staff can see stock; moving it takes workplace:edit (Admin, IT).
 * The stock figure and the movement are written together, under a row lock, and can't go below zero.
 */
import type { InventoryItem } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';

type Q = Kysely<DB> | Transaction<DB>;

export const Movement = z.object({
  kind: z.enum(['in', 'out'], { errorMap: () => ({ message: 'Choose in or out.' }) }),
  qty: z.number({ required_error: 'Enter a quantity above zero.', invalid_type_error: 'Enter a quantity above zero.' }),
  note: z.string().max(500).default(''),
});

async function load(q: Q, ids?: string[]): Promise<InventoryItem[]> {
  let iq = q.selectFrom('inventoryItems').selectAll();
  if (ids) iq = iq.where('id', 'in', ids.length ? ids : ['-']);
  const rows = await iq.orderBy('id').execute();
  if (!rows.length) return [];
  const moves = await q.selectFrom('stockMovements').selectAll().where('itemId', 'in', rows.map((r) => r.id)).orderBy('seq').execute();
  return rows.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, stock: i.stock, reorderLevel: i.reorderLevel, location: i.location,
    movements: moves.filter((m) => m.itemId === i.id).map((m) => ({ id: m.id, date: m.date, kind: m.kind as 'in' | 'out', qty: m.qty, note: m.note, byId: m.byId })),
  }));
}

/** GET /inventory */
export async function listInventory(actor: Actor): Promise<InventoryItem[]> {
  authorize(actor, 'directory', 'view');
  return load(db);
}

/** POST /inventory/:id/movements { kind, qty, note } */
export async function moveStock(actor: Actor, id: string, input: z.infer<typeof Movement>): Promise<InventoryItem> {
  authorize(actor, 'workplace', 'edit');
  const me = selfId(actor);
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw unprocessable('Enter a whole quantity above zero.', { qty: 'Invalid' });
  return withTransaction(actor, async (tx) => {
    const item = await tx.db.selectFrom('inventoryItems').select(['stock', 'name', 'reorderLevel']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!item) throw notFound('Item not found');
    if (input.kind === 'out' && input.qty > item.stock) throw unprocessable('Only ' + item.stock + ' in stock.', { qty: 'Too many' });
    const stock = item.stock + (input.kind === 'in' ? input.qty : -input.qty);
    await tx.db.insertInto('stockMovements').values({ id: newId('MV'), itemId: id, date: today(), kind: input.kind, qty: input.qty, note: input.note.trim(), byId: me }).execute();
    await tx.db.updateTable('inventoryItems').set({ stock }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Stock', id, [{ field: 'stock', before: String(item.stock), after: String(stock) }]);
    return (await load(tx.db, [id]))[0];
  });
}
