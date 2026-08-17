import bleno, {
  Characteristic,
  PrimaryService,
  type ConnectionHandle,
  type State,
  type UpdateValueCallback,
  type WriteRequestCallback,
} from '@stoprocent/bleno';
import config from './config';
import { SERVICE_UUID, METRICS_CHAR_UUID, RESULT_CHAR_UUID } from './uuids';
import type { HostEvent, ValidationResult } from './events';

export type EventListener = (event: HostEvent) => void;

// Notify characteristic: pushes the server's verdict back to subscribed phones.
class ResultCharacteristic extends Characteristic {
  private subscribers = new Map<ConnectionHandle, UpdateValueCallback>();

  constructor() {
    super({ uuid: RESULT_CHAR_UUID, properties: ['notify'] });
  }

  override onSubscribe(
    handle: ConnectionHandle,
    _maxValueSize: number,
    updateValueCallback: UpdateValueCallback
  ) {
    this.subscribers.set(handle, updateValueCallback);
  }

  override onUnsubscribe(handle: ConnectionHandle) {
    this.subscribers.delete(handle);
  }

  push(payload: ValidationResult) {
    const data = Buffer.from(JSON.stringify(payload));
    for (const notify of this.subscribers.values()) {
      notify(data);
    }
  }
}

// Write characteristic: the phone submits its signed validation envelope as
// JSON. Envelopes exceed one MTU on iOS, so chunks are assembled — offset
// writes for prepared/long writes, and a parse attempt decides completeness.
const MAX_ENVELOPE_BYTES = 4096;

class MetricsCharacteristic extends Characteristic {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly handleMetrics: (metrics: unknown) => void) {
    super({ uuid: METRICS_CHAR_UUID, properties: ['write', 'writeWithoutResponse'] });
  }

  override onWriteRequest(
    _handle: ConnectionHandle,
    data: Buffer,
    offset: number,
    _withoutResponse: boolean,
    callback: WriteRequestCallback
  ) {
    if (offset === 0 && this.pending.length > 0 && !this.looksLikeContinuation(data)) {
      this.pending = Buffer.alloc(0);
    }
    if (offset !== 0 && offset !== this.pending.length) {
      this.pending = Buffer.alloc(0);
      return callback(this.RESULT_UNLIKELY_ERROR);
    }
    this.pending = offset === 0 && this.pending.length === 0
      ? data
      : Buffer.concat([this.pending, data]);
    if (this.pending.length > MAX_ENVELOPE_BYTES) {
      this.pending = Buffer.alloc(0);
      return callback(this.RESULT_UNLIKELY_ERROR);
    }
    callback(this.RESULT_SUCCESS);

    try {
      const parsed: unknown = JSON.parse(this.pending.toString('utf8'));
      this.pending = Buffer.alloc(0);
      this.handleMetrics(parsed);
    } catch {
      // Incomplete JSON: wait for the next chunk.
    }
  }

  // Sequential zero-offset writes carry continuation chunks on stacks that
  // fragment without offsets; a fresh envelope always starts with '{'.
  private looksLikeContinuation(data: Buffer): boolean {
    return data.length > 0 && data[0] !== 0x7b;
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

  bleno.on('stateChange', (state: State) => {
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
      new PrimaryService({
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
