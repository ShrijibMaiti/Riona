/** Admin › Notification rules: which channels (in-app, email, daily digest) each event goes to. Kept and audited. */
import type { NotificationRule } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';

export const SetChannel = z.object({
  channel: z.enum(['inApp', 'email', 'digest'], { errorMap: () => ({ message: 'Choose in-app, email or digest.' }) }),
  on: z.boolean({ required_error: 'Say whether it’s on.' }),
});

const COLUMN = { inApp: 'inApp', email: 'email', digest: 'digest' } as const;
const toRule = (r: { id: string; event: string; module: string; inApp: boolean; email: boolean; digest: boolean }): NotificationRule =>
  ({ id: r.id, event: r.event, module: r.module, channels: { inApp: r.inApp, email: r.email, digest: r.digest } });

/** GET /notification-rules */
export async function listRules(actor: Actor): Promise<NotificationRule[]> {
  authorize(actor, 'admin', 'view');
  return (await db.selectFrom('notificationRules').selectAll().orderBy('position').execute()).map(toRule);
}

/** PATCH /notification-rules/:id { channel, on } */
export async function setChannel(actor: Actor, id: string, channel: keyof NotificationRule['channels'], on: boolean): Promise<NotificationRule> {
  authorize(actor, 'admin', 'edit');
  return withTransaction(actor, async (tx) => {
    const r = await tx.db.selectFrom('notificationRules').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!r) throw notFound('Rule not found');
    if (r[COLUMN[channel]] !== on) {
      await tx.db.updateTable('notificationRules').set({ [COLUMN[channel]]: on }).where('id', '=', id).execute();
      await tx.audit('Updated', 'Notification rule', id, [{ field: r.event + ' · ' + channel, before: String(r[COLUMN[channel]]), after: String(on) }]);
    }
    return toRule({ ...r, [COLUMN[channel]]: on });
  });
}
