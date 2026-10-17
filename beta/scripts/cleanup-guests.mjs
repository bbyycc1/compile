/**
 * Delete stale guest accounts: guests whose last activity was 30+ days ago.
 * All of a guest's data (people, encounters, etc.) is removed via the
 * ON DELETE CASCADE foreign keys.
 *
 * NOT wired to run automatically — run it manually or from a scheduler:
 *   node scripts/cleanup-guests.mjs           # delete
 *   node scripts/cleanup-guests.mjs --dry-run # report only
 */
import { Client } from 'pg';

const STALE_DAYS = 30;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
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
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale = await client.query(
      `SELECT id, display_name, last_active_at FROM users
       WHERE is_guest = true AND last_active_at < $1`,
      [cutoff],
    );
    console.log(
      `Found ${stale.rowCount} stale guest account(s) (inactive since ${cutoff.toISOString().slice(0, 10)}).`,
    );
    for (const row of stale.rows) {
      console.log(` - ${row.id} (${row.display_name ?? 'Guest'}, last active ${row.last_active_at.toISOString().slice(0, 10)})`);
    }
    if (dryRun || stale.rowCount === 0) {
      console.log(dryRun ? 'Dry run — nothing deleted.' : 'Nothing to delete.');
      return;
    }
    const ids = stale.rows.map((r) => r.id);
    const del = await client.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    console.log(`Deleted ${del.rowCount} stale guest account(s).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
