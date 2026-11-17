/**
 * The audit log. Entries are written only inside a write transaction (db/tx.ts gives every transaction
 * `tx.audit(...)`), so an entry exists exactly when its change committed. The table is append-only (010).
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../db/schema';
import { newId } from '../../lib/ids';

export type Change = { field: string; before: string | null; after: string | null };

export type AuditActor = { employeeId: string | null; name: string; ip: string; requestId: string };

export type AuditEntry = { action: string; entity: string; entityId: string; changes?: Change[] };

/** Field-level changes between two versions of a record, for the fields listed. Values become text. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: (keyof T)[]): Change[] {
  const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return fields
    .filter((f) => f in after && text(before[f]) !== text(after[f]))
    .map((f) => ({ field: String(f), before: text(before[f]), after: text(after[f]) }));
}

export async function writeAudit(trx: Transaction<DB>, actor: AuditActor, e: AuditEntry): Promise<string> {
  const id = newId('AU');
  await trx
    .insertInto('auditLog')
    .values({
      id, actorId: actor.employeeId, actor: actor.name, action: e.action, entity: e.entity, entityId: e.entityId,
      changes: JSON.stringify(e.changes ?? []), ip: actor.ip, requestId: actor.requestId || null,
    })
    .execute();
  return id;
}
