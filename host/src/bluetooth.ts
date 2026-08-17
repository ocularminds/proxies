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
import { hostAttestSigningString } from './signing';
import { signWithIdentity, type HostIdentity } from './identity';
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

const RSSI_SAMPLE_INTERVAL_MS = 500;
const RSSI_WINDOW = 10;

// Samples the connection RSSI while a central is connected. One reading is
// noise (±10 dB); the median of a sliding window is what the host attests.
class RssiSampler {
  private samples: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;

  start() {
    this.stop();
    this.timer = setInterval(() => void this.sample(), RSSI_SAMPLE_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
    this.samples = [];
    this.failures = 0;
  }

  private async sample() {
    try {
      const rssi = await bleno.updateRssiAsync();
      if (Number.isFinite(rssi) && rssi < 0) {
        this.samples.push(rssi);
        if (this.samples.length > RSSI_WINDOW) {
          this.samples.shift();
        }
      }
      this.failures = 0;
    } catch {
      // Not every radio binding reports RSSI; stop asking after repeated
      // failures and let the attestation carry null.
      this.failures += 1;
      if (this.failures >= 3 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }

  median(): number | null {
    if (this.samples.length === 0) {
      return null;
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
}

// Wraps the device's envelope in this host's attestation: proof the envelope
// crossed this host's radio, carrying the host-measured RSSI median.
async function validateWithServer(
  envelope: unknown,
  identity: HostIdentity,
  rssi: number | null
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const signature = signWithIdentity(
    identity,
    hostAttestSigningString(identity.hostId, timestamp, rssi, envelope)
  );
  const response = await fetch(`${config.serverUrl}/validate-proximity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      envelope,
      attestation: { hostId: identity.hostId, timestamp, rssi, signature },
    }),
    signal: AbortSignal.timeout(3000),
  });
  return (await response.json()) as ValidationResult;
}

export interface BluetoothDeps {
  onEvent: EventListener;
  getIdentity: () => HostIdentity | null;
}

export function startBluetooth({ onEvent, getIdentity }: BluetoothDeps) {
  const sampler = new RssiSampler();
  const resultCharacteristic = new ResultCharacteristic();
  const metricsCharacteristic = new MetricsCharacteristic(async (envelope) => {
    onEvent({ type: 'metrics-received', metrics: envelope });
    let result: ValidationResult;
    const identity = getIdentity();
    if (!identity) {
      result = {
        success: false,
        message: 'Host is not enrolled — ask an admin for an enrollment code.',
      };
    } else {
      const rssi = sampler.median();
      onEvent({ type: 'rssi-measured', rssi });
      try {
        result = await validateWithServer(envelope, identity, rssi);
      } catch (err) {
        result = { success: false, message: `Server unreachable: ${(err as Error).message}` };
      }
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

  bleno.on('accept', (clientAddress: string) => {
    sampler.start();
    onEvent({ type: 'connected', clientAddress });
  });
  bleno.on('disconnect', (clientAddress: string) => {
    sampler.stop();
    onEvent({ type: 'disconnected', clientAddress });
  });
}
