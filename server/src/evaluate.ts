import { distanceMeters } from './distance';
import type { ValidationConfig } from './types';

export interface ProximityMetrics {
  bluetoothRssi: number;
  wifiSignalStrength?: number;
  gpsCoordinates?: { latitude: number; longitude: number };
}

export interface ProximityDenial {
  code: 'RSSI_BELOW_FLOOR' | 'WIFI_BELOW_FLOOR' | 'GPS_OUT_OF_BOUNDS';
  message: string;
}

// Pure threshold evaluation. Returns null on pass, or the coded denial.
export function evaluateProximity(
  config: ValidationConfig,
  metrics: ProximityMetrics
): ProximityDenial | null {
  if (metrics.bluetoothRssi < config.rssiFloorDbm) {
    return {
      code: 'RSSI_BELOW_FLOOR',
      message: 'Bluetooth signal too weak: device is out of range.',
    };
  }
  if (
    metrics.wifiSignalStrength !== undefined &&
    metrics.wifiSignalStrength < config.wifiFloorDbm
  ) {
    return { code: 'WIFI_BELOW_FLOOR', message: 'Wi-Fi signal too weak: device is out of range.' };
  }
  if (
    metrics.gpsCoordinates &&
    Number.isFinite(config.site.latitude) &&
    Number.isFinite(config.site.longitude)
  ) {
    const distance = distanceMeters(metrics.gpsCoordinates, config.site);
    if (distance > config.gpsMaxMeters) {
      return { code: 'GPS_OUT_OF_BOUNDS', message: 'Device is outside the site GPS boundary.' };
    }
  }
  return null;
}
