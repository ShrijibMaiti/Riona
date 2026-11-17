/**
 * A small query cache. Screens call repositories only through these hooks, so loading and error states
 * are always handled, and mutations invalidate what they touched.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

type Entry = { data?: unknown; error?: Error; promise?: Promise<unknown>; at: number; stale: boolean };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export type QueryKey = readonly (string | number | boolean | null | undefined | object)[];
const keyOf = (k: QueryKey) => JSON.stringify(k);

function load<T>(key: string, fn: () => Promise<T>) {
  const e = cache.get(key);
  if (e?.promise) return;
  const promise = fn().then(
    (data) => {
      cache.set(key, { data, at: Date.now(), stale: false });
      emit();
    },
    (error: Error) => {
      cache.set(key, { error, at: Date.now(), stale: false, data: e?.data });
      emit();
    },
  );
  cache.set(key, { ...(e ?? { at: 0, stale: true }), promise });
}

export type QueryState<T> = { data: T | undefined; error: Error | undefined; loading: boolean; refreshing: boolean; refetch: () => void };

/** Fetch through a repository. The first segment of the key is its domain, used for invalidation. */
export function useQuery<T>(key: QueryKey, fn: () => Promise<T>, opts: { enabled?: boolean } = {}): QueryState<T> {
  const k = keyOf(key);
  const enabled = opts.enabled ?? true;
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const e = cache.get(k);
  useEffect(() => {
    if (!enabled) return;
    const cur = cache.get(k);
    if (!cur || (cur.stale && !cur.promise)) load(k, () => fnRef.current());
  });
  const refetch = useCallback(() => {
    const cur = cache.get(k);
    cache.set(k, { ...(cur ?? { at: 0 }), stale: true, promise: undefined });
    load(k, () => fnRef.current());
  }, [k]);
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: enabled && e?.data === undefined && !e?.error,
    refreshing: !!e?.promise && e?.data !== undefined,
    refetch,
  };
}

/** Mark every cached query whose key starts with one of these domains as stale; mounted ones refetch. */
export function invalidate(...domains: string[]) {
  // The dashboard figures ('facts') are computed on the server from every record, so any change may move them.
  const all = [...domains, 'facts'];
  for (const [k, e] of cache) {
    const d = (JSON.parse(k) as unknown[])[0];
    if (all.includes(String(d))) cache.set(k, { ...e, stale: true, promise: undefined });
  }
  emit();
}

/** Combine several queries; loading until all have data. */
export function all<T extends Record<string, QueryState<unknown>>>(qs: T) {
  const vals = Object.values(qs);
  return {
    loading: vals.some((q) => q.loading),
    error: vals.find((q) => q.error)?.error,
    data: (vals.every((q) => q.data !== undefined) ? Object.fromEntries(Object.entries(qs).map(([k, q]) => [k, q.data])) : undefined) as
      | { [K in keyof T]: T[K] extends QueryState<infer D> ? D : never }
      | undefined,
    refetch: () => vals.forEach((q) => q.refetch()),
  };
}
