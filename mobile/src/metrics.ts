import { BleClient } from '@capacitor-community/bluetooth-le';
import { Network } from '@capacitor/network';
import { Geolocation } from '@capacitor/geolocation';

export interface ProximityMetrics {
  bluetoothRssi: number;
  wifiSignalStrength?: number;
  gpsCoordinates?: { latitude: number; longitude: number };
}

// Phone-measured signals. These are advisory: the phone reporting on itself is
// not proof of presence (the trust rework moves authority to the host side).
export async function collectProximityMetrics(bleDeviceId: string): Promise<ProximityMetrics> {
  const rssi = await BleClient.readRssi(bleDeviceId);
  const metrics: ProximityMetrics = { bluetoothRssi: Math.round(rssi) };

  const wifi = await getWifiSignalStrength();
  if (wifi !== null) {
    metrics.wifiSignalStrength = wifi;
  }
  const gps = await getGpsCoordinates();
  if (gps !== null) {
    metrics.gpsCoordinates = gps;
  }
  return metrics;
}

// Web/Capacitor APIs expose whether Wi-Fi is connected but not its RSSI; that
// needs a native plugin. Until one exists we omit the field rather than fake it.
async function getWifiSignalStrength(): Promise<number | null> {
  try {
    const status = await Network.getStatus();
    if (status.connectionType !== 'wifi') {
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

async function getGpsCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 60000,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    return null;
  }
}
