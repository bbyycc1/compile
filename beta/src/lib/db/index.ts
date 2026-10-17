import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function getPool(): Pool {
  if (!globalForDb.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    globalForDb.__pgPool = new Pool({
      connectionString,
      max: 10,
      // Railway/managed Postgres needs SSL; local and Railway private networking don't.
      // Note: *.railway.internal is the private network (no SSL) — only force SSL
      // for public managed hosts.
      ssl:
        process.env.PGSSL === 'true' ||
        (/railway|render|neon|amazonaws/.test(connectionString) &&
          !/\.railway\.internal/.test(connectionString))
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return globalForDb.__pgPool;
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;
function getDb(): Db {
  if (!instance) instance = drizzle(getPool(), { schema });
  return instance;
}

/**
 * Lazily-initialized drizzle client: importing this module never requires
 * DATABASE_URL; the pool is created on first query. Safe for `next build`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_t, prop, _r) {
    const v = (getDb() as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? v.bind(getDb()) : v;
  },
});

export { schema };
