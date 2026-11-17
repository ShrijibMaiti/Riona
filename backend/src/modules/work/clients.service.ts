/** Client accounts (read). Every staff role may view them; leads, contracts and tickets come in Wave 8. */
import type { Client } from '@riona/shared';
import type { Selectable } from 'kysely';
import { db } from '../../db/client';
import type { Clients } from '../../db/schema';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';

const toClient = (r: Selectable<Clients>): Client => ({
  id: r.id, name: r.name, industry: r.industry, city: r.city, state: r.state, gstin: r.gstin, ownerId: r.ownerId ?? '',
  status: r.status as Client['status'], since: r.since, paymentTermsDays: r.paymentTermsDays, contacts: r.contacts as Client['contacts'],
});

export async function listClients(actor: Actor): Promise<Client[]> {
  authorize(actor, 'clients', 'view');
  return (await db.selectFrom('clients').selectAll().orderBy('name').execute()).map(toClient);
}

export async function getClient(actor: Actor, id: string): Promise<Client> {
  authorize(actor, 'clients', 'view');
  const r = await db.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Client not found');
  return toClient(r);
}
