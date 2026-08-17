import bleno from '@abandonware/bleno';
import config from './config';
import { SERVICE_UUID, METRICS_CHAR_UUID, RESULT_CHAR_UUID } from './uuids';
import type { HostEvent, ValidationResult } from './events';

export type EventListener = (event: HostEvent) => void;

// Notify characteristic: pushes the server's verdict back to the phone.
class ResultCharacteristic extends bleno.Characteristic {
  private updateValue: ((data: Buffer) => void) | null = null;

  constructor() {
    super({ uuid: RESULT_CHAR_UUID, properties: ['notify'] });
  }

  override onSubscribe(_maxValueSize: number, updateValueCallback: (data: Buffer) => void) {
    this.updateValue = updateValueCallback;
  }

  override onUnsubscribe() {
    this.updateValue = null;
  }

  push(payload: ValidationResult) {
    if (this.updateValue) {
      this.updateValue(Buffer.from(JSON.stringify(payload)));
    }
  }
}

// Write characteristic: the phone submits its proximity metrics as JSON.
class MetricsCharacteristic extends bleno.Characteristic {
  constructor(private readonly handleMetrics: (metrics: unknown) => void) {
    super({ uuid: METRICS_CHAR_UUID, properties: ['write', 'writeWithoutResponse'] });
  }

  override onWriteRequest(
    data: Buffer,
    offset: number,
    _withoutResponse: boolean,
    callback: (result: number) => void
  ) {
    if (offset) {
      return callback(this.RESULT_ATTR_NOT_LONG);
    }
    let metrics: unknown;
    try {
      metrics = JSON.parse(data.toString('utf8'));
    } catch {
      return callback(this.RESULT_UNLIKELY_ERROR);
    }
    callback(this.RESULT_SUCCESS);
    this.handleMetrics(metrics);
  }
}

async function validateWithServer(metrics: unknown): Promise<ValidationResult> {
  const response = await fetch(`${config.serverUrl}/validate-proximity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metrics),
    signal: AbortSignal.timeout(3000),
  });
  return (await response.json()) as ValidationResult;
}

export function startBluetooth({ onEvent }: { onEvent: EventListener }) {
  const resultCharacteristic = new ResultCharacteristic();
  const metricsCharacteristic = new MetricsCharacteristic(async (metrics) => {
    onEvent({ type: 'metrics-received', metrics });
    let result: ValidationResult;
    try {
      result = await validateWithServer(metrics);
    } catch (err) {
      result = { success: false, message: `Server unreachable: ${(err as Error).message}` };
    }
    resultCharacteristic.push(result);
    onEvent({ type: 'validation-result', result });
  });

  bleno.on('stateChange', (state: string) => {
    onEvent({ type: 'state', state });
    if (state === 'poweredOn') {
      bleno.startAdvertising(config.hostName, [SERVICE_UUID]);
    } else {
      bleno.stopAdvertising();
    }
  });

  bleno.on('advertisingStart', (err?: Error | null) => {
    if (err) {
      return onEvent({ type: 'error', message: `Advertising failed: ${err.message}` });
    }
    bleno.setServices([
      new bleno.PrimaryService({
        uuid: SERVICE_UUID,
        characteristics: [metricsCharacteristic, resultCharacteristic],
      }),
    ]);
    onEvent({ type: 'advertising', name: config.hostName });
  });

  bleno.on('accept', (clientAddress: string) => onEvent({ type: 'connected', clientAddress }));
  bleno.on('disconnect', (clientAddress: string) =>
    onEvent({ type: 'disconnected', clientAddress })
  );
}
