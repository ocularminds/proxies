import { Component } from '@angular/core';
import { BluetoothLe } from '@capacitor-community/bluetooth-le';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  pairedDevice: any = null;

  constructor() {}

  async pairAndSendMetrics() {
    try {
      // Discover and connect to host
      const device = await BluetoothLe.requestDevice({
        filters: [{ services: ['host-service-uuid'] }], // Replace with the service UUID of the host
      });
      console.log('Paired with host:', device);

      await BluetoothLe.connect({ deviceId: device.deviceId });

      // Collect and send proximity metrics
      await sendProximityMetricsToHost(device.deviceId);
    } catch (error) {
      console.error('Error pairing with host or sending metrics:', error);
    }
  }
}
