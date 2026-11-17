/**
 * The client portal's scope, the main data-leak boundary.
 *
 * In the API (onRequest, after the session):
 *   - /portal/* needs a signed-in client account; a staff session is refused (403), no session is 401.
 *   - a client account is refused everywhere else (403 portal.only) except signing in and out, so no staff
 *     endpoint (built, or still forwarded to the mock) ever answers a client.
 *
 * In the database (withClientScope): portal reads run in a read-only transaction as the role riona_portal, with
 * the client id set for that transaction only. Migration 011 grants that role client-safe columns and row
 * policies keyed on the client id, so a portal query that is wrong (no WHERE, the wrong join, an internal column)
 * returns less or fails; it can't return another client's rows or internal data.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { sql, type Transaction } from 'kysely';
import { config } from '../../config';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { forbidden, unauthenticated } from '../../lib/errors';
import type { Actor } from './session';

/** What a client account may call outside /portal: signing in and out, password links, the public site, health. */
const CLIENT_OPEN = ['/auth/login', '/auth/logout', '/auth/forgot', '/demo-requests', '/health'];
const clientOpen = (path: string) => CLIENT_OPEN.includes(path) || path.startsWith('/auth/reset/') || path.startsWith('/auth/sso/');

export const isPortalPath = (path: string) => path === '/portal' || path.startsWith('/portal/');

const portalScope: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith(config.apiPrefix + '/')) return;
    const path = req.url.slice(config.apiPrefix.length).split('?')[0];
    const actor = req.actor;
    if (isPortalPath(path)) {
      if (!actor) throw unauthenticated();
      if (actor.role !== 'Client' || !actor.clientId) throw forbidden('The client portal is for client accounts. Use Riona instead.', 'portal.clients_only');
      return;
    }
    if (actor?.role === 'Client' && !clientOpen(path)) throw forbidden('This account can only use the client portal.', 'portal.only');
  });
};

export default fp(portalScope, { name: 'riona-portal-scope', fastify: '5.x', dependencies: ['riona-session'] });

/** The signed-in client's id. Only called behind the hook above, so a client is always signed in. */
export function clientOf(actor: Actor | null): string {
  if (!actor || actor.role !== 'Client' || !actor.clientId) throw forbidden('The client portal is for client accounts.', 'portal.clients_only');
  return actor.clientId;
}

/**
 * Runs portal reads for one client: read-only, as riona_portal, with `riona.client_id` set for this transaction
 * only (SET LOCAL / set_config(…, true) end with it, so a pooled connection never carries them on).
 */
export async function withClientScope<T>(clientId: string, fn: (q: Transaction<DB>) => Promise<T>): Promise<T> {
  if (!clientId) throw forbidden();
  return db.transaction().execute(async (trx) => {
    await sql`SET TRANSACTION READ ONLY`.execute(trx);
    await sql`SET LOCAL ROLE riona_portal`.execute(trx);
    await sql`SET LOCAL statement_timeout = '5s'`.execute(trx);
    await sql`SELECT set_config('riona.client_id', ${clientId}, true)`.execute(trx);
    return fn(trx);
  });
}
