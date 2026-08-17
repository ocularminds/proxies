import { describe, expect, test } from 'vitest';
import { evaluateProximity } from '../src/evaluate';
import type { ValidationConfig } from '../src/types';

function config(overrides: Partial<ValidationConfig> = {}): ValidationConfig {
  return {
    rssiFloorDbm: -70,
    wifiFloorDbm: -60,
    gpsMaxMeters: 50,
    site: { latitude: NaN, longitude: NaN },
    ...overrides,
  };
}

describe('evaluateProximity', () => {
  test('passes a strong Bluetooth signal', () => {
    expect(evaluateProximity(config(), { bluetoothRssi: -50 })).toBeNull();
  });

  test('denies a weak Bluetooth signal', () => {
    expect(evaluateProximity(config(), { bluetoothRssi: -85 })?.code).toBe('RSSI_BELOW_FLOOR');
  });

  test('denies a weak Wi-Fi signal when provided', () => {
    expect(
      evaluateProximity(config(), { bluetoothRssi: -50, wifiSignalStrength: -75 })?.code
    ).toBe('WIFI_BELOW_FLOOR');
  });

  test('ignores GPS when the site has no coordinates', () => {
    expect(
      evaluateProximity(config(), {
        bluetoothRssi: -50,
        gpsCoordinates: { latitude: 0, longitude: 0 },
      })
    ).toBeNull();
  });

  test('denies GPS outside the configured boundary', () => {
    expect(
      evaluateProximity(config({ site: { latitude: 6.5244, longitude: 3.3792 } }), {
        bluetoothRssi: -50,
        gpsCoordinates: { latitude: 6.6, longitude: 3.5 },
      })?.code
    ).toBe('GPS_OUT_OF_BOUNDS');
  });

  test('passes GPS near the configured site', () => {
    expect(
      evaluateProximity(config({ site: { latitude: 6.5244, longitude: 3.3792 } }), {
        bluetoothRssi: -50,
        gpsCoordinates: { latitude: 6.52441, longitude: 3.37921 },
      })
    ).toBeNull();
  });
});
