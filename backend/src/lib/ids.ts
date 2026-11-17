/**
 * Identifiers. Record ids are a readable prefix plus a random part ("SE-8f3k2m9q4t"); tokens for cookies and
 * one-time links are 256 random bits. Neither is guessable or sequential.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lower case: no i, l, o, u

/** A new id like "SE-8f3k2m9q4t" (10 random base32 characters, 50 bits). */
export function newId(prefix: string): string {
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return `${prefix}-${s}`;
}

/** A secret for a session cookie or a one-time link. Only its hash is ever stored. */
export const newToken = () => randomBytes(32).toString('base64url');
