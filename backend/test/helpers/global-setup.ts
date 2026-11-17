/**
 * Once per test run (vitest globalSetup): make sure the test database exists, reset it, apply db/migrations and
 * load the demo data. Development data is never touched (see env.ts for how the test database is chosen).
 */
import pg from 'pg';
import { testDatabaseUrl } from './env';

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`Tests need Postgres at ${admin.host} (npm run db:up): ${(e as Error).message}`);
  }
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }

  // env.ts has pointed DATABASE_URL at the test database, so these modules connect there.
  const { migrate } = await import('../../db/migrate');
  const { importFixture } = await import('../../db/seed/import-fixture');
  const { db, closeDb } = await import('../../src/db/client');
  await migrate(url.toString(), { reset: true, log: () => {} });
  await importFixture(db, { fastPasswords: true, log: () => {} });
  await closeDb();
}
