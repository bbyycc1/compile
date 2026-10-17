/**
 * Minimal migration runner using the `pg` driver (already a prod dependency).
 * Applies every *.sql file in drizzle/ in name order, once each, tracking
 * applied migrations in the __migrations table. Used at container boot.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = new Client({
    connectionString: url,
    ssl:
      process.env.PGSSL === 'true' ||
      (/railway|render|neon|amazonaws/.test(url) && !/\.railway\.internal/.test(url))
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())',
    );
    const applied = new Set(
      (await client.query('SELECT name FROM __migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      if (applied.has(f)) {
        console.log(`migrate: skipping ${f} (already applied)`);
        continue;
      }
      console.log(`migrate: applying ${f}`);
      const sql = readFileSync(join(dir, f), 'utf8');
      // drizzle-kit separates statements with `--> statement-breakpoint`
      const statements = sql
        .split(/-->\s*statement-breakpoint/)
        .map((s) => s.trim())
        .filter(Boolean);
      await client.query('BEGIN');
      try {
        for (const st of statements) await client.query(st);
        await client.query('INSERT INTO __migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      console.log(`migrate: applied ${f}`);
    }
    console.log('migrate: done');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('migrate: FAILED', e);
  process.exit(1);
});
