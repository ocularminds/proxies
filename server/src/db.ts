import { Pool } from 'pg';
import type { LogStore, ValidationLogEntry } from './types';

// Returns a log store backed by Postgres when DATABASE_URL is set, otherwise a
// console fallback so the demo still runs — but loudly, so the gap is visible.
export function createLogStore(databaseUrl: string | null): LogStore {
  if (!databaseUrl) {
    return {
      async logValidation(entry: ValidationLogEntry) {
        console.warn('DATABASE_URL not set; validation not persisted:', JSON.stringify(entry));
      },
      async close() {},
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async logValidation({ deviceId, success, errorMessage }: ValidationLogEntry) {
      await pool.query(
        'INSERT INTO validation_logs (device_id, success, error_message) VALUES ($1, $2, $3)',
        [deviceId, success, errorMessage]
      );
    },
    async close() {
      await pool.end();
    },
  };
}
