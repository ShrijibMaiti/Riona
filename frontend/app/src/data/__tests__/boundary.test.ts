/**
 * The data boundary: screens get data only through ./repositories, which talks to the API through one HTTP client.
 * (Until Wave 9 the same boundary let an in-memory fixture stand in for the API; that fixture and its seed are gone.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe('data boundary', () => {
  // Forward slashes on every OS, so the prefix checks below hold on Windows too.
  const all = files(root).map((p) => ({ p: p.slice(root.length + 1).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));
  it('only the HTTP client calls fetch', () => {
    const bad = all.filter((f) => f.p !== 'data/repositories/http/client.ts' && !f.p.startsWith('data/__tests__') && /\bfetch\(/.test(f.src));
    expect(bad.map((f) => f.p)).toEqual([]);
  });
  it('nothing imports a fixture or a seed', () => {
    const bad = all.filter((f) => !f.p.startsWith('data/__tests__') && /from ['"][^'"]*\/(seed|fixture)['"\/]/.test(f.src));
    expect(bad.map((f) => f.p)).toEqual([]);
  });
  it('every repository function returns a Promise', async () => {
    const repos = await import('../repositories');
    const fns = Object.entries(repos).filter(([k, v]) => typeof v === 'function' && k !== 'ApiError');
    expect(fns.length).toBeGreaterThan(60);
    for (const [k, fn] of fns) expect(/async|Promise/.test(String(fn)), k).toBe(true);
  });
});
