/** Announcements, and acknowledging the ones that ask for it. Open to all staff. */
import type { Announcement } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';
import { nowIso } from '../../lib/dates';

type Q = Kysely<DB> | Transaction<DB>;

async function load(q: Q, ids?: string[]): Promise<Announcement[]> {
  let aq = q.selectFrom('announcements').selectAll();
  if (ids) aq = aq.where('id', 'in', ids.length ? ids : ['-']);
  const rows = await aq.orderBy('pinned', 'desc').orderBy('posted', 'desc').orderBy('id', 'desc').execute();
  if (!rows.length) return [];
  const acks = await q.selectFrom('announcementAcks').select(['announcementId', 'employeeId']).where('announcementId', 'in', rows.map((r) => r.id)).orderBy('seq').execute();
  return rows.map((a) => ({
    id: a.id, title: a.title, body: a.body, authorId: a.authorId, posted: a.posted, pinned: a.pinned, audience: a.audience, requiresAck: a.requiresAck,
    ackIds: acks.filter((x) => x.announcementId === a.id).map((x) => x.employeeId), audienceIds: a.audienceIds,
  }));
}

/** GET /announcements */
export async function listAnnouncements(actor: Actor): Promise<Announcement[]> {
  authorize(actor, 'directory', 'view');
  return load(db);
}

/** POST /announcements/:id/acknowledge — idempotent. */
export async function acknowledge(actor: Actor, id: string): Promise<Announcement> {
  const me = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const a = await tx.db.selectFrom('announcements').select('id').where('id', '=', id).executeTakeFirst();
    if (!a) throw notFound('Not found');
    const added = await tx.db.insertInto('announcementAcks').values({ announcementId: id, employeeId: me, at: nowIso() })
      .onConflict((oc) => oc.columns(['announcementId', 'employeeId']).doNothing()).returning('employeeId').executeTakeFirst();
    if (added) await tx.audit('Acknowledged', 'Announcement', id);
    return (await load(tx.db, [id]))[0];
  });
}
