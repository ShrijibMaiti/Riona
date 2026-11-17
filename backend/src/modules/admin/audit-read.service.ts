/** GET /audit — the audit log, read-only (there is no endpoint that changes or deletes it; 010 forbids it too). */
import type { AuditEvent, Paginated } from '@riona/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { F, opt } from '../../lib/validate';

export const AuditQuery = z.object({
  search: opt(z.string().max(200)), entity: opt(z.string().max(80)), actorId: opt(z.string().max(40)), from: opt(F.date), to: opt(F.date),
  page: opt(F.page), pageSize: opt(F.pageSize),
});

export async function listAudit(actor: Actor, f: z.infer<typeof AuditQuery>): Promise<Paginated<AuditEvent>> {
  authorize(actor, 'audit', 'view');
  const page = f.page ?? 1, pageSize = f.pageSize ?? 50;
  let q = db.selectFrom('auditLog');
  if (f.search?.trim()) {
    const like = '%' + f.search.trim().toLowerCase().replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    q = q.where(sql<boolean>`lower(actor || ' ' || action || ' ' || entity || ' ' || entity_id) LIKE ${like}`);
  }
  if (f.entity) q = q.where('entity', '=', f.entity);
  if (f.actorId) q = q.where('actorId', '=', f.actorId);
  // Dates are the office's calendar days.
  if (f.from) q = q.where(sql<boolean>`(at AT TIME ZONE (SELECT time_zone FROM org))::date >= ${f.from}::date`);
  if (f.to) q = q.where(sql<boolean>`(at AT TIME ZONE (SELECT time_zone FROM org))::date <= ${f.to}::date`);
  const [{ n }] = await q.select(sql<number>`count(*)::int`.as('n')).execute();
  const rows = await q.selectAll().orderBy('at', 'desc').orderBy('seq', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute();
  return {
    items: rows.map((a) => ({ id: a.id, at: a.at, actorId: a.actorId, actor: a.actor, action: a.action, entity: a.entity, entityId: a.entityId, changes: a.changes as AuditEvent['changes'], ip: a.ip })),
    total: n, page, pageSize,
  };
}
