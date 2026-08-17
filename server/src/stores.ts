import { Pool } from 'pg';
import type { LogStore, ValidationLogEntry } from './types';

export type DeviceStatus = 'pending' | 'active' | 'revoked';

export interface DeviceRecord {
  id: string;
  userId: number | null;
  kind: 'phone' | 'sensor' | 'gateway';
  siteId: number | null;
  organizationId: number | null;
  publicKey: string | null;
  status: DeviceStatus;
}

export interface DeviceStore {
  getById(id: string): Promise<DeviceRecord | null>;
  createPending(userId: number, codeHash: string, expiresAt: Date): Promise<{ id: string }>;
  createPendingForSite(
    siteId: number,
    kind: 'sensor' | 'gateway',
    name: string | null,
    codeHash: string,
    expiresAt: Date
  ): Promise<{ id: string }>;
  // Atomically claims an unexpired, unused code; returns the activated device.
  enroll(codeHash: string, publicKey: string, platform: string | null): Promise<DeviceRecord | null>;
  markSeen(id: string): Promise<void>;
  // Strictly monotonic per-device batch counter; false = replay/reorder.
  claimTelemetrySeq(id: string, seq: number): Promise<boolean>;
}

export interface TelemetryStore {
  insertBatch(
    deviceUuid: string,
    organizationId: number,
    siteId: number | null,
    readings: {
      ts: string;
      type: string;
      value: number;
      unit?: string;
      battery?: number;
      quality?: string;
    }[]
  ): Promise<number>;
}

export interface UserStore {
  findByEmail(email: string): Promise<{ id: number } | null>;
  createWithOrganization(
    organizationName: string,
    email: string,
    displayName: string
  ): Promise<{ id: number }>;
}

export interface HostRecord {
  id: string;
  siteId: number;
  publicKey: string | null;
  status: DeviceStatus;
}

export interface HostStore {
  getById(id: string): Promise<HostRecord | null>;
  createPending(siteId: number, name: string, codeHash: string, expiresAt: Date): Promise<{ id: string }>;
  enroll(codeHash: string, publicKey: string): Promise<HostRecord | null>;
  markSeen(id: string): Promise<void>;
}

export interface SiteRecord {
  id: number;
  latitude: number | null;
  longitude: number | null;
  rssiFloorDbm: number;
  wifiFloorDbm: number;
  gpsMaxMeters: number;
  minTier: 'A' | 'B' | 'C';
}

export interface SiteStore {
  // Upserts the organization by name and creates the site under it.
  create(
    organizationName: string,
    name: string,
    latitude: number | null,
    longitude: number | null,
    minTier?: 'A' | 'B' | 'C'
  ): Promise<{ id: number } | null>;
  getById(id: number): Promise<SiteRecord | null>;
}

export interface RedeemedSession {
  deviceUuid: string;
  hostId: string;
  siteId: number;
  userEmail: string;
  createdAt: Date;
}

export interface SessionStore {
  create(deviceUuid: string, hostId: string, siteId: number, expiresAt: Date): Promise<{ id: string }>;
  // Atomically redeems; null when unknown, expired, or already redeemed.
  redeem(id: string): Promise<RedeemedSession | null>;
  deleteExpired(olderThanMs: number): Promise<void>;
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
  hosts: HostStore;
  sites: SiteStore;
  sessions: SessionStore;
  telemetry: TelemetryStore;
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
    async logValidation({
      deviceId,
      deviceUuid,
      hostId,
      siteId,
      lanVerified,
      assuranceTier,
      errorCode,
      success,
      errorMessage,
    }: ValidationLogEntry) {
      await pool.query(
        `INSERT INTO validation_logs
           (device_id, device_uuid, host_id, site_id, lan_verified, assurance_tier, error_code, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          deviceId,
          deviceUuid ?? null,
          hostId ?? null,
          siteId ?? null,
          lanVerified ?? false,
          assuranceTier ?? null,
          errorCode ?? null,
          success,
          errorMessage,
        ]
      );
    },
    async close() {},
  };

  const deviceRow = (row: {
    id: string;
    user_id: string | number | null;
    kind: 'phone' | 'sensor' | 'gateway';
    site_id: string | number | null;
    organization_id: string | number | null;
    public_key: string | null;
    status: DeviceStatus;
  }): DeviceRecord => ({
    id: row.id,
    userId: row.user_id === null ? null : Number(row.user_id),
    kind: row.kind,
    siteId: row.site_id === null ? null : Number(row.site_id),
    organizationId: row.organization_id === null ? null : Number(row.organization_id),
    publicKey: row.public_key,
    status: row.status,
  });

  // Organization resolves through the user (phones) or the site (sensors).
  const DEVICE_SELECT = `
    SELECT d.id, d.user_id, d.kind, d.site_id, d.public_key, d.status,
           COALESCE(u.organization_id, s.organization_id) AS organization_id
    FROM devices d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN sites s ON s.id = d.site_id`;

  const devices: DeviceStore = {
    async getById(id) {
      const result = await pool.query(`${DEVICE_SELECT} WHERE d.id = $1`, [id]);
      return result.rows[0] ? deviceRow(result.rows[0]) : null;
    },
    async createPending(userId, codeHash, expiresAt) {
      const result = await pool.query(
        `INSERT INTO devices (user_id, enrollment_code_hash, enrollment_code_expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, codeHash, expiresAt]
      );
      return { id: result.rows[0].id };
    },
    async createPendingForSite(siteId, kind, name, codeHash, expiresAt) {
      const result = await pool.query(
        `INSERT INTO devices (kind, site_id, name, enrollment_code_hash, enrollment_code_expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [kind, siteId, name, codeHash, expiresAt]
      );
      return { id: result.rows[0].id };
    },
    async enroll(codeHash, publicKey, platform) {
      const result = await pool.query(
        `WITH updated AS (
           UPDATE devices
           SET status = 'active', public_key = $2, platform = $3, enrolled_at = now(),
               enrollment_code_hash = NULL, enrollment_code_expires_at = NULL
           WHERE enrollment_code_hash = $1
             AND enrollment_code_expires_at > now()
             AND status = 'pending'
           RETURNING *
         )
         SELECT d.id, d.user_id, d.kind, d.site_id, d.public_key, d.status,
                COALESCE(u.organization_id, s.organization_id) AS organization_id
         FROM updated d
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN sites s ON s.id = d.site_id`,
        [codeHash, publicKey, platform]
      );
      return result.rows[0] ? deviceRow(result.rows[0]) : null;
    },
    async markSeen(id) {
      await pool.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [id]);
    },
    async claimTelemetrySeq(id, seq) {
      const result = await pool.query(
        `UPDATE devices SET last_telemetry_seq = $2
         WHERE id = $1 AND (last_telemetry_seq IS NULL OR last_telemetry_seq < $2)
         RETURNING id`,
        [id, seq]
      );
      return result.rows.length > 0;
    },
  };

  const telemetry: TelemetryStore = {
    async insertBatch(deviceUuid, organizationId, siteId, readings) {
      const params: unknown[] = [];
      const rows = readings.map((reading, i) => {
        const base = i * 9;
        params.push(
          reading.ts,
          organizationId,
          siteId,
          deviceUuid,
          reading.type,
          reading.value,
          reading.unit ?? null,
          reading.battery ?? null,
          reading.quality ?? null
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      });
      const result = await pool.query(
        `INSERT INTO telemetry (ts, organization_id, site_id, device_uuid, type, value, unit, battery, quality)
         VALUES ${rows.join(', ')}`,
        params
      );
      return result.rowCount ?? 0;
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

  const hosts: HostStore = {
    async getById(id) {
      const result = await pool.query(
        `SELECT id, site_id, public_key, status FROM hosts WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      return row
        ? { id: row.id, siteId: Number(row.site_id), publicKey: row.public_key, status: row.status }
        : null;
    },
    async createPending(siteId, name, codeHash, expiresAt) {
      const result = await pool.query(
        `INSERT INTO hosts (site_id, name, enrollment_code_hash, enrollment_code_expires_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [siteId, name, codeHash, expiresAt]
      );
      return { id: result.rows[0].id };
    },
    async enroll(codeHash, publicKey) {
      const result = await pool.query(
        `UPDATE hosts
         SET status = 'active', public_key = $2, enrolled_at = now(),
             enrollment_code_hash = NULL, enrollment_code_expires_at = NULL
         WHERE enrollment_code_hash = $1
           AND enrollment_code_expires_at > now()
           AND status = 'pending'
         RETURNING id, site_id, public_key, status`,
        [codeHash, publicKey]
      );
      const row = result.rows[0];
      return row
        ? { id: row.id, siteId: Number(row.site_id), publicKey: row.public_key, status: row.status }
        : null;
    },
    async markSeen(id) {
      await pool.query(`UPDATE hosts SET last_seen_at = now() WHERE id = $1`, [id]);
    },
  };

  const sites: SiteStore = {
    async create(organizationName, name, latitude, longitude, minTier = 'C') {
      const org = await pool.query(
        `INSERT INTO organizations (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [organizationName]
      );
      try {
        const site = await pool.query(
          `INSERT INTO sites (organization_id, name, latitude, longitude, min_tier)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [org.rows[0].id, name, latitude, longitude, minTier]
        );
        return { id: Number(site.rows[0].id) };
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          return null; // duplicate site name within the organization
        }
        throw err;
      }
    },
    async getById(id) {
      const result = await pool.query(
        `SELECT id, latitude, longitude, rssi_floor_dbm, wifi_floor_dbm, gps_max_meters, min_tier
         FROM sites WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      return row
        ? {
            id: Number(row.id),
            latitude: row.latitude,
            longitude: row.longitude,
            rssiFloorDbm: Number(row.rssi_floor_dbm),
            wifiFloorDbm: Number(row.wifi_floor_dbm),
            gpsMaxMeters: Number(row.gps_max_meters),
            minTier: row.min_tier,
          }
        : null;
    },
  };

  const sessions: SessionStore = {
    async create(deviceUuid, hostId, siteId, expiresAt) {
      const result = await pool.query(
        `INSERT INTO sessions (device_uuid, host_id, site_id, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [deviceUuid, hostId, siteId, expiresAt]
      );
      return { id: result.rows[0].id };
    },
    async redeem(id) {
      const result = await pool.query(
        `UPDATE sessions s SET redeemed_at = now()
         FROM devices d, users u
         WHERE s.id = $1 AND s.redeemed_at IS NULL AND s.expires_at > now()
           AND d.id = s.device_uuid AND u.id = d.user_id
         RETURNING s.device_uuid, s.host_id, s.site_id, s.created_at, u.email`,
        [id]
      );
      const row = result.rows[0];
      return row
        ? {
            deviceUuid: row.device_uuid,
            hostId: row.host_id,
            siteId: Number(row.site_id),
            userEmail: row.email,
            createdAt: row.created_at,
          }
        : null;
    },
    async deleteExpired(olderThanMs) {
      await pool.query(`DELETE FROM sessions WHERE expires_at < now() - ($1 * interval '1 ms')`, [
        olderThanMs,
      ]);
    },
  };

  return {
    logs,
    devices,
    users,
    nonces,
    hosts,
    sites,
    sessions,
    telemetry,
    async close() {
      await pool.end();
    },
  };
}
