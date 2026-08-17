import { BleClient, dataViewToText, textToDataView } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID, METRICS_CHAR_UUID, RESULT_CHAR_UUID } from './uuids';
import { collectProximityMetrics } from './metrics';

export interface ValidationResult {
  success: boolean;
  message: string;
}

export type StatusListener = (message: string) => void;

const VERDICT_TIMEOUT_MS = 8000;

export async function runValidation(onStatus: StatusListener): Promise<ValidationResult> {
  await BleClient.initialize();

  onStatus('Scanning for a Proxies host…');
  const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });

  await BleClient.connect(device.deviceId, () => onStatus('Disconnected from host.'));
  try {
    onStatus(`Connected to ${device.name ?? 'host'}. Collecting metrics…`);
    const metrics = await collectProximityMetrics(device.deviceId);

    let resolveVerdict: (result: ValidationResult) => void;
    const verdict = new Promise<ValidationResult>((resolve) => {
      resolveVerdict = resolve;
    });
    await BleClient.startNotifications(device.deviceId, SERVICE_UUID, RESULT_CHAR_UUID, (value) => {
      try {
        resolveVerdict(JSON.parse(dataViewToText(value)) as ValidationResult);
      } catch {
        resolveVerdict({ success: false, message: 'Unreadable response from host.' });
      }
    });

    await BleClient.write(
      device.deviceId,
      SERVICE_UUID,
      METRICS_CHAR_UUID,
      textToDataView(JSON.stringify(metrics))
    );
    onStatus('Metrics sent. Waiting for the verdict…');

    const timeout = new Promise<ValidationResult>((resolve) =>
      setTimeout(
        () => resolve({ success: false, message: 'Timed out waiting for the host.' }),
        VERDICT_TIMEOUT_MS
      )
    );
    return await Promise.race([verdict, timeout]);
  } finally {
    await BleClient.disconnect(device.deviceId).catch(() => undefined);
  }
}
