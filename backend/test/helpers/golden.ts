/**
 * The frontend fixture's answers, frozen. Until Wave 9 the parity tests asked the in-memory fixture directly; the
 * fixture is gone now; its answers to exactly the calls the tests make were captured once, while it still existed,
 * into test/golden/fixture.json, and `fixture.getX(...)` here replays them.
 *
 * A call that was never captured fails loudly rather than passing vacuously.
 */
import { readFileSync } from 'node:fs';
import type { Repo } from '../../../frontend/app/src/data/repositories/http/endpoints';

const FILE = new URL('../golden/fixture.json', import.meta.url);
const store: Record<string, unknown> = JSON.parse(readFileSync(FILE, 'utf8'));

type Fn = (...args: any[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const fixture = new Proxy({} as Record<string, Fn>, {
  get: (_target, name: string): Fn => async (...args: unknown[]) => {
    const key = name + JSON.stringify(args);
    if (!(key in store)) throw new Error(`No recorded fixture answer for ${key}.`);
    return structuredClone(store[key]);
  },
}) as unknown as Repo;
