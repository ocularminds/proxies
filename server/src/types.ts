export interface SiteLocation {
  latitude: number;
  longitude: number;
}

export interface ValidationConfig {
  rssiFloorDbm: number;
  wifiFloorDbm: number;
  gpsMaxMeters: number;
  site: SiteLocation;
}

export interface AppConfig extends ValidationConfig {
  port: number;
  databaseUrl: string | null;
  adminToken: string | null;
  allowUnsignedValidation: boolean;
  timestampToleranceMs: number;
  nonceTtlMs: number;
  trustProxy: boolean;
  rateLimit: {
    windowMs: number;
    max: number;
    enrollMax: number;
  };
}

export interface ValidationLogEntry {
  deviceId: string;
  deviceUuid?: string | null;
  hostId?: string | null;
  siteId?: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface LogStore {
  logValidation(entry: ValidationLogEntry): Promise<void>;
  close(): Promise<void>;
}
