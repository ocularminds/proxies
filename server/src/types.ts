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
}

export interface ValidationLogEntry {
  deviceId: string;
  success: boolean;
  errorMessage: string | null;
}

export interface LogStore {
  logValidation(entry: ValidationLogEntry): Promise<void>;
  close(): Promise<void>;
}
