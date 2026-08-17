import { Pool } from 'pg';
import type { LogStore, ValidationLogEntry } from './types';

export type DeviceStatus = 'pending' | 'active' | 'revoked';

export interface DeviceRecord {
  id: string;
  userId: number;
  publicKey: string | null;
  status: DeviceStatus;
}

export interface DeviceStore {
  getById(id: string): Promise<DeviceRecord | null>;
  createPending(userId: number, codeHash: string, expiresAt: Date): Promise<{ id: string }>;
  // Atomically claims an unexpired, unused code; returns the activated device.
  enroll(codeHash: string, publicKey: string, platform: string | null): Promise<DeviceRecord | null>;
  markSeen(id: string): Promise<void>;
}

export interface UserStore {
  findByEmail(email: string): Promise<{ id: number } | null>;
  createWithOrganization(
    organizationName: string,
    email: string,
    displayName: string
  ): Promise<{ id: number }>;
}

export interface NonceStore {
  issue(deviceUuid: string, nonceHash: string, expiresAt: Date): Promise<void>;
  // Atomically marks the nonce used; false when unknown, expired, already
  // used, or bound to a different device.
  claim(nonceHash: string, deviceUuid: string): Promise<boolean>;
  deleteExpired(olderThanMs: number): Promise<void>;
}

export interface Stores {
  logs: LogStore;
  devices: DeviceStore;
  users: UserStore;
  nonces: NonceStore;
  close(): Promise<void>;
}

// Postgres-backed stores. Identity endpoints require a database — callers get
// null when DATABASE_URL is unset and must degrade explicitly.
export function createStores(databaseUrl: string | null): Stores | null {
  if (!databaseUrl) {
    return null;
  }
  const pool = new Pool({ connectionString: databaseUrl });

  const logs: LogStore = {
    async logValidation({ deviceId, deviceUuid, success, errorMessage }: ValidationLogEntry) {
      await pool.query(
        `INSERT INTO validation_logs (device_id, device_uuid, success, error_message)
         VALUES ($1, $2, $3, $4)`,
        [deviceId, deviceUuid ?? null, success, errorMessage]
      );
    },
    async close() {},
  };

  const devices: DeviceStore = {
    async getById(id) {
      const result = await pool.query(
        `SELECT id, user_id, public_key, status FROM devices WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      return row
        ? { id: row.id, userId: Number(row.user_id), publicKey: row.public_key, status: row.status }
        : null;
    },
    async createPending(userId, codeHash, expiresAt) {
      const result = await pool.query(
        `INSERT INTO devices (user_id, enrollment_code_hash, enrollment_code_expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, codeHash, expiresAt]
      );
      return { id: result.rows[0].id };
    },
    async enroll(codeHash, publicKey, platform) {
      const result = await pool.query(
        `UPDATE devices
         SET status = 'active', public_key = $2, platform = $3, enrolled_at = now(),
             enrollment_code_hash = NULL, enrollment_code_expires_at = NULL
         WHERE enrollment_code_hash = $1
           AND enrollment_code_expires_at > now()
           AND status = 'pending'
         RETURNING id, user_id, public_key, status`,
        [codeHash, publicKey, platform]
      );
      const row = result.rows[0];
      return row
        ? { id: row.id, userId: Number(row.user_id), publicKey: row.public_key, status: row.status }
        : null;
    },
    async markSeen(id) {
      await pool.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [id]);
    },
  };

  const users: UserStore = {
    async findByEmail(email) {
      const result = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },
    async createWithOrganization(organizationName, email, displayName) {
      const org = await pool.query(
        `INSERT INTO organizations (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [organizationName]
      );
      const user = await pool.query(
        `INSERT INTO users (organization_id, email, display_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [org.rows[0].id, email, displayName]
      );
      return { id: Number(user.rows[0].id) };
    },
  };

  const nonces: NonceStore = {
    async issue(deviceUuid, nonceHash, expiresAt) {
      await pool.query(
        `INSERT INTO nonces (nonce_hash, device_uuid, expires_at) VALUES ($1, $2, $3)`,
        [nonceHash, deviceUuid, expiresAt]
      );
    },
    async claim(nonceHash, deviceUuid) {
      const result = await pool.query(
        `UPDATE nonces SET used_at = now()
         WHERE nonce_hash = $1 AND device_uuid = $2 AND used_at IS NULL AND expires_at > now()
         RETURNING id`,
        [nonceHash, deviceUuid]
      );
      return result.rows.length > 0;
    },
    async deleteExpired(olderThanMs) {
      await pool.query(`DELETE FROM nonces WHERE expires_at < now() - ($1 * interval '1 ms')`, [
        olderThanMs,
      ]);
    },
  };

  return {
    logs,
    devices,
    users,
    nonces,
    async close() {
      await pool.end();
    },
  };
}
