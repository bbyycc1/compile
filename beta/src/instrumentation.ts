import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Runs on Next.js server startup. Applies any SQL migrations in drizzle/
 * that haven't been applied yet (tracked in _migrations table).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "tag" varchar(64) PRIMARY KEY,
        "applied_at" timestamptz DEFAULT now() NOT NULL
      )
    `);

    const journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);

    for (const tag of tags) {
      const existing = await db.execute(sql`SELECT tag FROM "_migrations" WHERE tag = ${tag}`);
      if ((existing as unknown as { rows: unknown[] }).rows?.length) continue;
      const sqlPath = join(process.cwd(), 'drizzle', `${tag}.sql`);
      let sqlText: string;
      try {
        sqlText = readFileSync(sqlPath, 'utf8');
      } catch {
        continue;
      }
      // Split on drizzle's statement-breakpoint marker and run each statement.
      const statements = sqlText.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
      }
      await db.execute(sql`INSERT INTO "_migrations" ("tag") VALUES (${tag})`);
      console.log(`[migrations] applied ${tag}`);
    }
  } catch (err) {
    console.error('[migrations] failed:', err);
  }
}
