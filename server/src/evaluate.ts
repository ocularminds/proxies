import { distanceMeters } from './distance';
import type { ValidationConfig } from './types';

export interface ProximityMetrics {
  bluetoothRssi: number;
  wifiSignalStrength?: number;
  gpsCoordinates?: { latitude: number; longitude: number };
}

// Pure threshold evaluation. Returns null on pass, or the denial message.
export function evaluateProximity(
  config: ValidationConfig,
  metrics: ProximityMetrics
): string | null {
  if (metrics.bluetoothRssi < config.rssiFloorDbm) {
    return 'Bluetooth signal too weak: device is out of range.';
  }
  if (
    metrics.wifiSignalStrength !== undefined &&
    metrics.wifiSignalStrength < config.wifiFloorDbm
  ) {
    return 'Wi-Fi signal too weak: device is out of range.';
  }
  if (
    metrics.gpsCoordinates &&
    Number.isFinite(config.site.latitude) &&
    Number.isFinite(config.site.longitude)
  ) {
    const distance = distanceMeters(metrics.gpsCoordinates, config.site);
    if (distance > config.gpsMaxMeters) {
      return 'Device is outside the site GPS boundary.';
    }
  }
  return null;
}
