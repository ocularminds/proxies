import { telemetryBatch } from './schema';
import { telemetrySigningString, verifyEd25519 } from './crypto';
import type { Stores } from './stores';
import type { Notifier } from './notify';

export interface IngestDeps {
  config: { timestampToleranceMs: number };
  stores: Stores;
  notifier: Notifier;
}

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
}

// The transport-agnostic telemetry pipeline: HTTPS and MQTT both land here.
// Verification order: schema → device → freshness → seq claim → signature →
// insert → rules.
export async function processTelemetryBatch(
  { config, stores, notifier }: IngestDeps,
  payload: unknown
): Promise<IngestResult> {
  const parsed = telemetryBatch.safeParse(payload);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'BATCH_INVALID',
        message: 'Invalid batch.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      },
    };
  }
  const { deviceId, seq, timestamp, signature, readings } = parsed.data;

  const device = await stores.devices.getById(deviceId);
  if (!device || device.status !== 'active' || !device.publicKey) {
    return {
      status: 401,
      body: { success: false, code: 'DEVICE_UNKNOWN', message: 'Unknown or inactive device.' },
    };
  }
  const age = Math.abs(Date.now() - Date.parse(timestamp));
  if (!(age <= config.timestampToleranceMs)) {
    return {
      status: 401,
      body: { success: false, code: 'BATCH_STALE', message: 'Stale or future batch timestamp.' },
    };
  }
  const maxFutureMs = Date.now() + 5 * 60 * 1000;
  if (readings.some((reading) => Date.parse(reading.ts) > maxFutureMs)) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'READING_TS_FUTURE',
        message: 'Reading timestamps may not be in the future.',
      },
    };
  }

  // Claim the seq before verifying — replays and reorders lose the race.
  const claimed = await stores.devices.claimTelemetrySeq(device.id, seq);
  if (!claimed) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'SEQ_REPLAYED',
        message: 'Batch seq must be strictly greater than the last accepted one.',
      },
    };
  }
  const signedString = telemetrySigningString(deviceId, seq, timestamp, readings);
  if (!verifyEd25519(device.publicKey, signedString, signature)) {
    return {
      status: 401,
      body: { success: false, code: 'SIGNATURE_INVALID', message: 'Invalid signature.' },
    };
  }
  if (device.organizationId === null) {
    return {
      status: 403,
      body: {
        success: false,
        code: 'DEVICE_UNATTRIBUTED',
        message: 'Device has no organization attribution.',
      },
    };
  }

  const accepted = await stores.telemetry.insertBatch(
    device.id,
    device.organizationId,
    device.siteId,
    readings
  );
  await stores.devices
    .markSeen(device.id)
    .catch((err: Error) => console.error('Failed to update last_seen:', err.message));

  // Threshold rules: at most one alert per rule per batch.
  let alertsFired = 0;
  try {
    const types = [...new Set(readings.map((reading) => reading.type))];
    const activeRules = await stores.rules.matching(
      device.organizationId,
      device.siteId,
      device.id,
      types
    );
    for (const rule of activeRules) {
      const hit = readings.find(
        (reading) =>
          reading.type === rule.metricType &&
          (rule.op === 'gt' ? reading.value > rule.threshold : reading.value < rule.threshold)
      );
      if (!hit) continue;
      const alert = await stores.rules.createAlert(rule.id, device.id, hit.ts, hit.value);
      alertsFired += 1;
      try {
        await notifier({
          alertId: alert.id,
          rule,
          deviceUuid: device.id,
          readingTs: hit.ts,
          value: hit.value,
        });
        await stores.rules.markDelivered(alert.id);
      } catch (err) {
        console.error('Alert delivery failed:', (err as Error).message);
      }
    }
  } catch (err) {
    console.error('Rule evaluation failed:', (err as Error).message);
  }

  return { status: 200, body: { success: true, accepted, alertsFired } };
}
