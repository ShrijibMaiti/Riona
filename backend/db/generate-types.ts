/**
 * Regenerates src/db/schema.ts from the migrated database (npm run db:types), then aligns the types with the
 * parsers in src/db/client.ts: DATE and TIMESTAMPTZ arrive as strings, INT8 and NUMERIC as numbers.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config';

const out = join(import.meta.dirname, '..', 'src', 'db', 'schema.ts');
execSync(`npx kysely-codegen --dialect postgres --camel-case --exclude-pattern schema_migrations --date-parser string --out-file "${out}"`, {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: config.db.url },
});
const src = readFileSync(out, 'utf8')
  .replace(/export type Int8 = ColumnType<string,/, 'export type Int8 = ColumnType<number,')
  .replace(/export type Numeric = ColumnType<string,/, 'export type Numeric = ColumnType<number,')
  .replace(/export type Timestamp = ColumnType<Date,/, 'export type Timestamp = ColumnType<string,');
writeFileSync(out, src);
console.log('src/db/schema.ts updated.');