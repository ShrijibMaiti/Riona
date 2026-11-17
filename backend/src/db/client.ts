/**
 * The database connection: one pg pool, wrapped in Kysely for typed queries.
 *
 * Every timestamp is stored as `timestamptz` and the session runs in UTC, so the database never guesses a zone;
 * the organisation's zone (config.timeZone) is applied when a date is computed for display or for "today".
 * Columns are snake_case in SQL and camelCase in TypeScript (CamelCasePlugin), including raw sql`` results.
 */
import { CamelCasePlugin, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { config } from '../config';
import type { DB } from './schema';
import { toZonedIso } from '../lib/dates';

// Value parsing, matched by the types in schema.ts (db/generate-types.ts patches them):
// - INT8 and NUMERIC as numbers. Money is BIGINT paise (Wave 2); counts and sums fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// - DATE stays 'YYYY-MM-DD', the shape the frontend uses, instead of becoming a midnight Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// - TIMESTAMPTZ as an ISO string in the organisation's zone ('2026-11-06T09:48:00+05:30'), ready for JSON and
//   matching the frontend's data, so a date sliced from it is the local date.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => toZonedIso(new Date(v)));

export type { DB };

export const pool = new pg.Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  options: '-c timezone=UTC',
  application_name: 'riona-backend',
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });

/** True when the database answers. Used by /health and at start-up. */
export async function pingDb(): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

/** Close every connection; called on shutdown. */
export async function closeDb(): Promise<void> {
  await db.destroy();
}
