/**
 * Wave 9: single sign-on. A stand-in OpenID provider (its own RSA key, discovery, key set and token endpoint, which
 * checks the PKCE verifier) plays Google; the tests walk the real flow and try to break it.
 */
import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../helpers/db';
import { clientFor, PREFIX, sessionCookie, testApp } from '../helpers/session';

const ISSUER = 'http://127.0.0.1:47811';
const CLIENT_ID = 'test-google-client';
const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });

type Grant = { claims: Record<string, unknown>; challenge: string; key?: KeyObject };
const grants = new Map<string, Grant>();
let server: Server;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims: Record<string, unknown>, key: KeyObject = good.privateKey) {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + b64(claims);
  return head + '.' + createSign('RSA-SHA256').update(head).sign(key).toString('base64url');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/.well-known/openid-configuration') return json(200, { issuer: ISSUER, authorization_endpoint: ISSUER + '/authorize', token_endpoint: ISSUER + '/token', jwks_uri: ISSUER + '/jwks' });
    if (req.url === '/jwks') return json(200, { keys: [{ ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const g = grants.get(f.get('code') ?? '');
        if (!g || f.get('client_secret') !== 'test-google-secret' || f.get('client_id') !== CLIENT_ID) return json(400, { error: 'invalid_grant' });
        // PKCE: the verifier must hash to the challenge sent at the start.
        if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== g.challenge) return json(400, { error: 'invalid_grant' });
        grants.delete(f.get('code')!);
        json(200, { id_token: sign(g.claims, g.key), access_token: 'x', token_type: 'Bearer' });
      });
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(47811, '127.0.0.1', r));
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await (await testApp()).close();
  await db.destroy();
});

/** Starts a sign-in; returns what the provider would be sent, and the browser's flow cookie. */
async function start(provider = 'google') {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: `${PREFIX}/auth/sso/${provider}/start` });
  const location = String(res.headers.location);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] as string[] ?? []).map((c) => c.split(';')[0]).join('; ');
  const params = location.startsWith(ISSUER) ? new URL(location).searchParams : null;
  return { res, location, cookie, params };
}

/** The provider redirects back with a code for these claims. */
async function finish(s: Awaited<ReturnType<typeof start>>, claims: Record<string, unknown>, opts: { key?: KeyObject; state?: string; cookie?: string } = {}) {
  const code = 'code-' + Math.random().toString(36).slice(2);
  grants.set(code, { claims, challenge: s.params!.get('code_challenge')!, key: opts.key });
  const app = await testApp();
  return app.inject({ method: 'GET', url: `${PREFIX}/auth/sso/google/callback?code=${code}&state=${opts.state ?? s.params!.get('state')}`, headers: { cookie: opts.cookie ?? s.cookie } });
}

const claimsFor = (s: Awaited<ReturnType<typeof start>>, email: string, extra: Record<string, unknown> = {}) => ({
  iss: ISSUER, aud: CLIENT_ID, sub: 'sub-' + email, email, email_verified: true, nonce: s.params!.get('nonce'),
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...extra,
});

describe('single sign-on (Google, via a stand-in provider)', () => {
  it('start sends the browser to the provider with state, nonce and a PKCE challenge, and sets a signed flow cookie', async () => {
    const s = await start();
    expect(s.res.statusCode).toBe(302);
    expect(s.params).not.toBeNull();
    expect(s.params!.get('client_id')).toBe(CLIENT_ID);
    expect(s.params!.get('redirect_uri')).toBe('http://localhost:5173/api/v1/auth/sso/google/callback');
    expect(s.params!.get('code_challenge_method')).toBe('S256');
    expect(s.params!.get('state')!.length).toBeGreaterThan(20);
    expect(s.cookie).toMatch(/riona_sso=/);
  });

  it('a verified email with an active account is signed in and lands in the app', async () => {
    const s = await start();
    const res = await finish(s, claimsFor(s, 'Aarav.Shah@kestrel.digital'));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/#/app/me');
    const me = await clientFor(await testApp(), sessionCookie(res.headers['set-cookie'])).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.employee.id).toBe('E-0112');
    const audit = await db.selectFrom('auditLog').select(['action', 'changes']).where('entityId', '=', 'U-0112').orderBy('seq', 'desc').executeTakeFirst();
    expect(audit?.action).toBe('Signed in');
  });

  it('a client account lands in its portal', async () => {
    const s = await start();
    const res = await finish(s, claimsFor(s, 'meghna@lumen.in'));
    expect(res.headers.location).toBe('http://localhost:5173/#/portal');
  });

  it('no account, an unverified email, or a deactivated account: back to sign-in, no session', async () => {
    for (const [email, extra] of [['stranger@gmail.com', {}], ['aarav.shah@kestrel.digital', { email_verified: false }]] as const) {
      const s = await start();
      const res = await finish(s, claimsFor(s, email, extra));
      expect(res.headers.location, email).toBe('http://localhost:5173/#/login?sso=no_account');
      expect(sessionCookie(res.headers['set-cookie'])).toBeNull();
    }
    await db.updateTable('users').set({ status: 'Deactivated' }).where('email', '=', 'vikram.menon@kestrel.digital').execute();
    try {
      const s = await start();
      expect((await finish(s, claimsFor(s, 'vikram.menon@kestrel.digital'))).headers.location).toBe('http://localhost:5173/#/login?sso=no_account');
    } finally {
      await db.updateTable('users').set({ status: 'Active' }).where('email', '=', 'vikram.menon@kestrel.digital').execute();
    }
  });

  it('refuses a forged signature, the wrong audience or issuer, a stale token, a replayed nonce, a changed state and a missing cookie', async () => {
    const cases: [string, (s: Awaited<ReturnType<typeof start>>) => Promise<{ headers: Record<string, unknown> }>][] = [
      ['forged signature', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital'), { key: rogue.privateKey })],
      ['wrong audience', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital', { aud: 'someone-else' }))],
      ['wrong issuer', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital', { iss: 'https://evil.example' }))],
      ['expired', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital', { exp: Math.floor(Date.now() / 1000) - 3600 }))],
      ['other nonce', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital', { nonce: 'not-this-flow' }))],
      ['changed state', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital'), { state: 'attacker-state' })],
      ['no flow cookie', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital'), { cookie: '' })],
      ['tampered flow cookie', (s) => finish(s, claimsFor(s, 'aarav.shah@kestrel.digital'), { cookie: s.cookie.replace(/riona_sso=([^;]+)/, (_m, v) => 'riona_sso=' + v.slice(0, -3) + 'abc') })],
    ];
    for (const [name, run] of cases) {
      const s = await start();
      const res = await run(s);
      expect(res.headers.location, name).toBe('http://localhost:5173/#/login?sso=failed');
      expect(sessionCookie(res.headers['set-cookie']), name).toBeNull();
    }
  });

  it('an unconfigured provider says so; an unknown one is 404', async () => {
    expect((await start('microsoft')).location).toBe('http://localhost:5173/#/login?sso=unavailable');
    expect((await start('github')).res.statusCode).toBe(404);
  });
});
