/**
 * Cookie sessions. The cookie carries a random token; the database stores only its SHA-256, so a leaked
 * database can't be replayed as sessions. Every request gets `req.actor` (or null): the user, their role and
 * employee id, always from the session and never from the request body.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../../config';
import { db } from '../../db/client';
import type { AppRole } from '../../db/schema';
import { newToken } from '../../lib/ids';
import { unauthenticated } from '../../lib/errors';
import { now } from '../../lib/dates';

export const SESSION_COOKIE = 'riona_session';
/** Idle lifetime; every request within it extends the session. */
const IDLE_MS = 7 * 24 * 3600 * 1000;
/** Don't write last_seen more often than this. */
const TOUCH_MS = 5 * 60 * 1000;

export type Actor = {
  userId: string;
  employeeId: string | null;
  clientId: string | null;
  name: string;
  role: AppRole;
  /** The role as named on Admin › Users ("Finance", "IT"); grants a little extra for some names (permissions.ts). */
  roleName?: string;
  sessionId: string;
  ip: string;
  requestId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Create a session for a user and set the cookie. Used by sign-in and setup. */
export async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = newToken();
  await db
    .insertInto('sessions')
    .values({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + IDLE_MS), ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null })
    .execute();
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: IDLE_MS / 1000 });
}

/** Revoke the current session and clear the cookie. */
export async function endSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.updateTable('sessions').set({ revokedAt: new Date() }).where('id', '=', hashToken(token)).execute();
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** onRequest hook for route groups that need a signed-in user. */
export async function requireSession(req: FastifyRequest) {
  if (!req.actor) throw unauthenticated();
}

const sessionPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req) => {
    req.actor = null;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const id = hashToken(token);
    const row = await db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.userId')
      .select(['s.id as sid', 's.expiresAt', 's.lastSeenAt', 's.revokedAt', 'u.id as userId', 'u.employeeId', 'u.clientId', 'u.name', 'u.role', 'u.roleName', 'u.status'])
      .where('s.id', '=', id)
      .executeTakeFirst();
    if (!row || row.revokedAt || Date.parse(row.expiresAt) < Date.now() || row.status !== 'Active') return;
    req.actor = { userId: row.userId, employeeId: row.employeeId, clientId: row.clientId, name: row.name, role: row.role, roleName: row.roleName, sessionId: row.sid, ip: req.ip, requestId: String(req.id) };
    if (Date.now() - Date.parse(row.lastSeenAt) > TOUCH_MS) {
      const at = new Date();
      await db.updateTable('sessions').set({ lastSeenAt: at, expiresAt: new Date(at.getTime() + IDLE_MS) }).where('id', '=', id).execute();
      await db.updateTable('users').set({ lastActive: now() }).where('id', '=', row.userId).execute();
    }
  });
};

export default fp(sessionPlugin, { name: 'riona-session', fastify: '5.x', dependencies: ['@fastify/cookie'] });