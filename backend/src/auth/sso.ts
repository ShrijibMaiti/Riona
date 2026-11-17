/**
 * Single sign-on with Google and Microsoft (OpenID Connect, authorization code flow with PKCE).
 *
 *   GET /auth/sso/:provider/start     → 302 to the provider, with a signed, ten-minute cookie holding state, nonce
 *                                       and the PKCE verifier
 *   GET /auth/sso/:provider/callback  → exchanges the code, verifies the ID token (RS256 signature against the
 *                                       provider's published keys; issuer, audience, expiry, nonce; a verified
 *                                       email), signs in the active Riona account with that email, and lands them
 *                                       in the app (or their portal)
 *
 * SSO never creates accounts: an email with no active account goes back to #/login?sso=no_account. A provider with no
 * client id/secret configured goes back to #/login?sso=unavailable; any other failure to #/login?sso=failed.
 */
import { createHash, createPublicKey, createVerify, randomBytes, type JsonWebKey } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { config } from '../config';
import { db } from '../db/client';
import { SYSTEM_ACTOR, withTransaction } from '../db/tx';
import { startSession } from '../http/plugins/session';

export type Provider = 'google' | 'microsoft';
export const PROVIDERS: Provider[] = ['google', 'microsoft'];
const NAME: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft' };

const COOKIE = 'riona_sso';
const COOKIE_PATH = () => config.apiPrefix + '/auth/sso';
const FLOW_SECONDS = 600;

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
type Flow = { p: Provider; state: string; nonce: string; verifier: string; exp: number };
class SsoError extends Error {
  constructor(public readonly reason: 'unavailable' | 'no_account' | 'failed', message: string) {
    super(message);
  }
}

const b64url = (b: Buffer) => b.toString('base64url');
const redirectUri = (p: Provider) => `${config.appOrigin}${config.apiPrefix}/auth/sso/${p}/callback`;
const settings = (p: Provider) => config.sso[p];

// ---------------- discovery and keys (cached) ----------------

const discoveries = new Map<string, { at: number; d: Discovery }>();
async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveries.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit.d;
  const res = await fetch(issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration');
  if (!res.ok) throw new SsoError('failed', `Discovery failed (${res.status})`);
  const d = (await res.json()) as Discovery;
  discoveries.set(issuer, { at: Date.now(), d });
  return d;
}

const keySets = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string })[] }>();
async function keyFor(jwksUri: string, kid: string) {
  const fetchKeys = async () => {
    const res = await fetch(jwksUri);
    if (!res.ok) throw new SsoError('failed', `Key set unavailable (${res.status})`);
    const keys = ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys;
    keySets.set(jwksUri, { at: Date.now(), keys });
    return keys;
  };
  const cached = keySets.get(jwksUri);
  let keys = cached && Date.now() - cached.at < 3600_000 ? cached.keys : await fetchKeys();
  // Providers rotate keys: an unknown kid means fetch again, once.
  if (!keys.some((k) => k.kid === kid)) keys = await fetchKeys();
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new SsoError('failed', 'Unknown signing key');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

// ---------------- the ID token ----------------

type Claims = { iss: string; aud: string | string[]; exp: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; preferred_username?: string; tid?: string; name?: string };

/** Verifies an ID token and returns its claims. */
export async function verifyIdToken(token: string, d: Discovery, clientId: string, nonce: string): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new SsoError('failed', 'Malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new SsoError('failed', 'Unexpected token algorithm');
  const key = await keyFor(d.jwks_uri, header.kid);
  const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new SsoError('failed', 'Bad token signature');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Claims;
  // Microsoft's multi-tenant discovery names the issuer with a {tenantid} placeholder.
  const issuer = d.issuer.replace('{tenantid}', c.tid ?? '');
  if (c.iss !== issuer) throw new SsoError('failed', 'Wrong issuer');
  if (!(Array.isArray(c.aud) ? c.aud.includes(clientId) : c.aud === clientId)) throw new SsoError('failed', 'Wrong audience');
  const now = Date.now() / 1000;
  if (!(c.exp > now - 60)) throw new SsoError('failed', 'Token expired');
  if (c.iat && c.iat > now + 300) throw new SsoError('failed', 'Token from the future');
  if (c.nonce !== nonce) throw new SsoError('failed', 'Wrong nonce');
  return c;
}

/** The verified email the token vouches for. */
function emailOf(p: Provider, c: Claims) {
  if (p === 'google') {
    if (!c.email || !(c.email_verified === true || c.email_verified === 'true')) throw new SsoError('no_account', 'No verified email');
    return c.email;
  }
  // Microsoft work accounts: the email claim, else the sign-in name (an email address for work accounts).
  const e = c.email ?? c.preferred_username;
  if (!e || !/^\S+@\S+\.\S+$/.test(e)) throw new SsoError('no_account', 'No email');
  return e;
}

// ---------------- the routes' work ----------------

const back = (reply: FastifyReply, reason: string) => reply.redirect(`${config.appOrigin}/#/login?sso=${reason}`, 302);

/** GET /auth/sso/:provider/start */
export async function startSso(req: FastifyRequest, reply: FastifyReply, p: Provider) {
  const s = settings(p);
  if (!s) return back(reply, 'unavailable');
  try {
    const d = await discover(s.issuer);
    const flow: Flow = { p, state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), exp: Math.floor(Date.now() / 1000) + FLOW_SECONDS };
    reply.setCookie(COOKIE, JSON.stringify(flow), { path: COOKIE_PATH(), httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: FLOW_SECONDS, signed: true });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: s.clientId, redirect_uri: redirectUri(p), scope: 'openid email profile', state: flow.state, nonce: flow.nonce,
      code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    return reply.redirect(url.toString(), 302);
  } catch (e) {
    req.log.warn({ err: e }, `SSO start failed for ${p}`);
    return back(reply, 'failed');
  }
}

/** GET /auth/sso/:provider/callback?code&state */
export async function finishSso(req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply: FastifyReply, p: Provider) {
  const s = settings(p);
  if (!s) return back(reply, 'unavailable');
  const raw = req.cookies[COOKIE];
  reply.clearCookie(COOKIE, { path: COOKIE_PATH() });
  try {
    const un = raw ? req.unsignCookie(raw) : null;
    if (!un?.valid || !un.value) throw new SsoError('failed', 'No sign-in in progress');
    const flow = JSON.parse(un.value) as Flow;
    if (flow.p !== p || flow.exp < Date.now() / 1000) throw new SsoError('failed', 'Sign-in took too long');
    if (req.query.error) throw new SsoError('failed', 'Provider said: ' + req.query.error);
    if (!req.query.code || req.query.state !== flow.state) throw new SsoError('failed', 'State mismatch');

    const d = await discover(s.issuer);
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri(p), client_id: s.clientId, client_secret: s.clientSecret, code_verifier: flow.verifier }).toString(),
    });
    if (!res.ok) throw new SsoError('failed', `Code exchange failed (${res.status})`);
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) throw new SsoError('failed', 'No ID token');
    const claims = await verifyIdToken(tokens.id_token, d, s.clientId, flow.nonce);
    const email = emailOf(p, claims);

    const user = await db.selectFrom('users').select(['id', 'role', 'status', 'name', 'employeeId']).where(sql`lower(email)`, '=', email.toLowerCase()).executeTakeFirst();
    if (!user || user.status !== 'Active') throw new SsoError('no_account', `No active account for ${email}`);
    await startSession(req, reply, user.id);
    await withTransaction({ ...SYSTEM_ACTOR, employeeId: user.employeeId, name: user.name, ip: req.ip }, async (tx) => {
      await tx.db.updateTable('users').set({ failedLogins: 0, lockedUntil: null }).where('id', '=', user.id).execute();
      await tx.audit('Signed in', 'User', user.id, [{ field: 'method', before: null, after: NAME[p] }]);
    });
    const landing = user.role === 'Client' ? '#/portal' : user.role === 'Employee' ? '#/app/me' : '#/app';
    return reply.redirect(`${config.appOrigin}/${landing}`, 302);
  } catch (e) {
    const reason = e instanceof SsoError ? e.reason : 'failed';
    req.log.warn({ err: e }, `SSO callback failed for ${p}`);
    return back(reply, reason);
  }
}
