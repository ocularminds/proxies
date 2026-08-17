import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/migrate';

// Destructive by design (drops and recreates the schema), so it only runs when
// TEST_DATABASE_URL points at a throwaway database — the CI service container,
// or a local scratch instance. Never point it at a real deployment.
const url = process.env.TEST_DATABASE_URL;

const EXPECTED_TABLES = [
  'organizations',
  'sites',
  'users',
  'devices',
  'hosts',
  'validation_logs',
  'schema_migrations',
];

describe.skipIf(!url)('migrate', () => {
  test('applies all migrations on a fresh database, then is idempotent', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

      const allMigrations = readdirSync(path.join(__dirname, '..', 'migrations'))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const first = await migrate(url!);
      expect(first).toEqual(allMigrations);
      expect(first.length).toBeGreaterThanOrEqual(2);

      const second = await migrate(url!);
      expect(second).toEqual([]);

      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const names = tables.rows.map((row: { table_name: string }) => row.table_name);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }

      // Smoke the relational chain end to end.
      const org = await pool.query(
        `INSERT INTO organizations (name) VALUES ('Test Org') RETURNING id`
      );
      const site = await pool.query(
        `INSERT INTO sites (organization_id, name, latitude, longitude)
         VALUES ($1, 'HQ', 6.5244, 3.3792) RETURNING id, rssi_floor_dbm`,
        [org.rows[0].id]
      );
      expect(site.rows[0].rssi_floor_dbm).toBe(-70);

      const user = await pool.query(
        `INSERT INTO users (organization_id, email, display_name)
         VALUES ($1, 'test@example.com', 'Test User') RETURNING id`,
        [org.rows[0].id]
      );
      const device = await pool.query(
        `INSERT INTO devices (user_id, platform) VALUES ($1, 'android') RETURNING id, status`,
        [user.rows[0].id]
      );
      expect(device.rows[0].status).toBe('pending');

      const host = await pool.query(
        `INSERT INTO hosts (site_id, name) VALUES ($1, 'front-desk') RETURNING id`,
        [site.rows[0].id]
      );
      await pool.query(
        `INSERT INTO validation_logs (device_id, success, device_uuid, site_id, host_id, assurance_tier)
         VALUES ('legacy-id', TRUE, $1, $2, $3, 'A')`,
        [device.rows[0].id, site.rows[0].id, host.rows[0].id]
      );

      const invalidStatus = pool.query(`UPDATE devices SET status = 'bogus' WHERE id = $1`, [
        device.rows[0].id,
      ]);
      await expect(invalidStatus).rejects.toThrow();
    } finally {
      await pool.end();
    }
  }, 30000);
});
