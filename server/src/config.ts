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
};

export default config;
