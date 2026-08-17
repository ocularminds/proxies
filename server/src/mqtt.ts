import mqtt from 'mqtt';
import { processTelemetryBatch, type IngestDeps } from './ingest';

export interface MqttBridge {
  close(): Promise<void>;
}

const TELEMETRY_TOPIC = 'proxies/telemetry/+';
const ackTopic = (deviceId: string) => `proxies/telemetry-ack/${deviceId}`;

// MQTT transport: devices publish signed batches to proxies/telemetry/<id>
// and receive the pipeline's verdict on proxies/telemetry-ack/<id>. The
// broker is untrusted by design — the Ed25519 envelope carries the trust.
export function startMqttBridge(
  url: string,
  options: { username?: string; password?: string },
  deps: IngestDeps
): MqttBridge {
  const client = mqtt.connect(url, {
    username: options.username,
    password: options.password,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    client.subscribe(TELEMETRY_TOPIC, (err) => {
      if (err) {
        console.error('MQTT subscribe failed:', err.message);
      } else {
        console.log(`MQTT bridge subscribed to ${TELEMETRY_TOPIC}`);
      }
    });
  });

  client.on('message', (topic, message) => {
    void (async () => {
      const deviceId = topic.split('/')[2] ?? 'unknown';
      let payload: unknown;
      try {
        payload = JSON.parse(message.toString('utf8'));
      } catch {
        client.publish(
          ackTopic(deviceId),
          JSON.stringify({
            status: 400,
            success: false,
            code: 'MALFORMED_JSON',
            message: 'Payload is not valid JSON.',
          })
        );
        return;
      }
      try {
        const result = await processTelemetryBatch(deps, payload);
        client.publish(ackTopic(deviceId), JSON.stringify({ status: result.status, ...result.body }));
      } catch (err) {
        console.error('MQTT ingest failed:', (err as Error).message);
        client.publish(
          ackTopic(deviceId),
          JSON.stringify({ status: 500, success: false, code: 'INTERNAL', message: 'Internal error.' })
        );
      }
    })();
  });

  client.on('error', (err) => console.error('MQTT error:', err.message));

  return {
    close: () =>
      new Promise((resolve) => {
        client.end(false, {}, () => resolve());
      }),
  };
}
