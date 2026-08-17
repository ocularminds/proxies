import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
// Arbitrary constant identifying "Proxies migrations" for the advisory lock.
const MIGRATION_LOCK_KEY = 727274;

// Applies pending .sql files from migrations/ in filename order, one
// transaction each, tracked in schema_migrations. Returns the files it ran.
export async function migrate(
  databaseUrl: string,
  dir: string = MIGRATIONS_DIR
): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const result = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(result.rows.map((row: { version: string }) => row.version));

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  migrate(url)
    .then((ran) =>
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Already up to date.')
    )
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
