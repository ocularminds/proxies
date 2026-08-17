import express, { type Express } from 'express';
import { validationRequest } from './schema';
import { distanceMeters } from './distance';
import type { LogStore, ValidationConfig } from './types';

export interface AppDeps {
  config: ValidationConfig;
  logStore: LogStore;
}

export function createApp({ config, logStore }: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'proxies-server' });
  });

  app.post('/validate-proximity', async (req, res) => {
    const parsed = validationRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid request.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      });
      return;
    }

    const { deviceId, bluetoothRssi, wifiSignalStrength, gpsCoordinates } = parsed.data;

    const record = async (success: boolean, errorMessage: string | null) => {
      try {
        await logStore.logValidation({ deviceId, success, errorMessage });
      } catch (err) {
        console.error('Failed to record validation:', (err as Error).message);
      }
    };
    const deny = async (message: string) => {
      await record(false, message);
      res.status(403).json({ success: false, message });
    };

    if (bluetoothRssi < config.rssiFloorDbm) {
      return deny('Bluetooth signal too weak: device is out of range.');
    }
    if (wifiSignalStrength !== undefined && wifiSignalStrength < config.wifiFloorDbm) {
      return deny('Wi-Fi signal too weak: device is out of range.');
    }
    if (
      gpsCoordinates &&
      Number.isFinite(config.site.latitude) &&
      Number.isFinite(config.site.longitude)
    ) {
      const distance = distanceMeters(gpsCoordinates, config.site);
      if (distance > config.gpsMaxMeters) {
        return deny('Device is outside the site GPS boundary.');
      }
    }

    await record(true, null);
    res.status(200).json({ success: true, message: 'Proximity validation successful.' });
  });

  return app;
}
