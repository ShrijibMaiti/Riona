/**
 * Password hashing with scrypt, built into Node, so there is no native module to compile on Windows.
 * Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later and old hashes still verify.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, opts, (err, key) => (err ? rej(err) : res(key))));

const N = 2 ** 15, R = 8, P = 1, LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Spend the same time as a real check, so a missing account can't be told apart by timing.
    await scrypt(password, randomBytes(16), LEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** True when the stored hash uses weaker parameters than today's and should be replaced on next sign-in. */
export const needsRehash = (stored: string) => {
  const [, n, r, p] = stored.split('$');
  return +n < N || +r !== R || +p !== P;
};