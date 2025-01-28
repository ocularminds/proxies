import { BluetoothLe } from '@capacitor-community/bluetooth-le';
import { BluetoothLe } from '@capacitor-community/bluetooth-le';
import { Network } from '@capacitor/network';
import { Geolocation } from '@capacitor/geolocation';

async function collectProximityMetrics(deviceId: string): Promise<any> {
  const proximityMetrics: any = {};

  // Collect Bluetooth RSSI
  proximityMetrics.bluetoothRssi = await getBluetoothRssi(deviceId);

  // Collect Wi-Fi Signal Strength
  proximityMetrics.wifiSignalStrength = await getWifiSignalStrength();

  // Collect GPS Coordinates
  proximityMetrics.gpsCoordinates = await getGpsCoordinates();

  return proximityMetrics;
}

async function sendProximityMetricsToHost(deviceId: string) {
  try {
    const metrics = await collectProximityMetrics(deviceId);
    console.log('Collected Proximity Metrics:', metrics);

    // Send metrics to the host (via BLE)
    const metricsData = JSON.stringify(metrics);
    await BluetoothLe.write({
      deviceId,
      service: 'host-service-uuid', // Replace with host's service UUID
      characteristic: 'metrics-characteristic-uuid', // Replace with the characteristic UUID
      value: btoa(metricsData), // Base64-encode the data
    });

    console.log('Proximity metrics sent to host!');
  } catch (error) {
    console.error('Error sending proximity metrics:', error);
  }
}

async function getBluetoothRssi(deviceId: string): Promise<number | null> {
  try {
    const rssiResult = await BluetoothLe.readRssi({ deviceId });
    console.log('Bluetooth RSSI:', rssiResult.rssi);
    return rssiResult.rssi;
  } catch (error) {
    console.error('Error getting Bluetooth RSSI:', error);
    return null;
  }
}
import { Network } from '@capacitor/network';

async function getWifiSignalStrength(): Promise<number | null> {
  try {
    const status = await Network.getStatus();
    if (status.connectionType !== 'wifi') {
      console.warn('Device is not connected to Wi-Fi');
      return null;
    }

    // Optionally, you can implement advanced signal strength detection via native plugins (like custom Capacitor plugin).
    console.log('Connected to Wi-Fi');
    return -40; // Placeholder, replace with a real native implementation for Wi-Fi RSSI
  } catch (error) {
    console.error('Error getting Wi-Fi signal strength:', error);
    return null;
  }
}
import { Geolocation } from '@capacitor/geolocation';

async function getGpsCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const coordinates = await Geolocation.getCurrentPosition();
    console.log('GPS Coordinates:', coordinates.coords);
    return {
      latitude: coordinates.coords.latitude,
      longitude: coordinates.coords.longitude,
    };
  } catch (error) {
    console.error('Error getting GPS coordinates:', error);
    return null;
  }
}
