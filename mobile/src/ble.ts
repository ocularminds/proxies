import { BleClient, dataViewToText, textToDataView } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID, METRICS_CHAR_UUID, RESULT_CHAR_UUID, LAN_INFO_CHAR_UUID } from './uuids';
import { collectProximityMetrics } from './metrics';
import { buildSignedEnvelope } from './api';

export interface ValidationResult {
  success: boolean;
  message: string;
}

export type StatusListener = (message: string) => void;

const VERDICT_TIMEOUT_MS = 8000;
const LAN_FETCH_TIMEOUT_MS = 3000;

// Same-network proof: the host publishes its LAN listener over BLE; being able
// to fetch a token from it demonstrates we share the host's network. Absence
// is reported, not fatal — the server scores it.
async function fetchLanToken(
  bleDeviceId: string,
  onStatus: StatusListener
): Promise<string | null> {
  try {
    const info = await BleClient.read(bleDeviceId, SERVICE_UUID, LAN_INFO_CHAR_UUID);
    const { url } = JSON.parse(dataViewToText(info)) as { url: string | null };
    if (!url) {
      return null;
    }
    onStatus('Proving same-network via the host LAN…');
    const response = await fetch(`${url}/lan-token`, {
      signal: AbortSignal.timeout(LAN_FETCH_TIMEOUT_MS),
    });
    const body = (await response.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    onStatus('Same-network proof unavailable; continuing without it.');
    return null;
  }
}

export async function runValidation(onStatus: StatusListener): Promise<ValidationResult> {
  await BleClient.initialize();

  onStatus('Scanning for a Proxies host…');
  const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });

  await BleClient.connect(device.deviceId, () => onStatus('Disconnected from host.'));
  try {
    onStatus(`Connected to ${device.name ?? 'host'}. Collecting metrics…`);
    const metrics = await collectProximityMetrics(device.deviceId);
    const lanToken = await fetchLanToken(device.deviceId, onStatus);
    const envelope = await buildSignedEnvelope(metrics, lanToken);

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
      textToDataView(JSON.stringify(envelope))
    );
    onStatus('Signed metrics sent. Waiting for the verdict…');

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
