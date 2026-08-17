import dotenv from 'dotenv';
import type { AppConfig } from './types';

dotenv.config();

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config: AppConfig = {
  port: num(process.env.PORT, 3000),
  // Weakest acceptable signals; readings below these floors are denied.
  rssiFloorDbm: num(process.env.RSSI_FLOOR_DBM, -70),
  wifiFloorDbm: num(process.env.WIFI_FLOOR_DBM, -60),
  gpsMaxMeters: num(process.env.GPS_MAX_METERS, 50),
  // GPS is only enforced when the site's coordinates are configured.
  site: {
    latitude: num(process.env.SITE_LATITUDE, NaN),
    longitude: num(process.env.SITE_LONGITUDE, NaN),
  },
  databaseUrl: process.env.DATABASE_URL || null,
  // Gates the /admin endpoints; unset disables them entirely.
  adminToken: process.env.ADMIN_TOKEN || null,
  // Dev-only escape hatch: accept unsigned validation bodies when no database
  // is configured. Never enable outside a desk demo.
  allowUnsignedValidation: process.env.ALLOW_UNSIGNED_VALIDATION === 'true',
  // Freshness window for signed nonce requests.
  timestampToleranceMs: num(process.env.TIMESTAMP_TOLERANCE_MS, 300_000),
  // Validity window of an issued single-use validation nonce.
  nonceTtlMs: num(process.env.NONCE_TTL_MS, 120_000),
  // Max age of a host-served LAN token (same-network proof).
  lanTokenTtlMs: num(process.env.LAN_TOKEN_TTL_MS, 120_000),
  // Set true only when deployed behind a reverse proxy, so rate limits see
  // real client addresses.
  trustProxy: process.env.TRUST_PROXY === 'true',
  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 300),
    enrollMax: num(process.env.RATE_LIMIT_ENROLL_MAX, 10),
  },
};

export default config;
