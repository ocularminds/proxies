import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { Aedes } from 'aedes';
import { createServer, type Server } from 'node:net';
import mqtt, { type MqttClient } from 'mqtt';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { createStores, type Stores } from '../src/stores';
import { migrate } from '../src/migrate';
import { startMqttBridge, type MqttBridge } from '../src/mqtt';
import { telemetrySigningString } from '../src/crypto';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('MQTT transport (Postgres + in-process broker)', () => {
  let pool: Pool;
  let stores: Stores;
  let broker: Aedes;
  let netServer: Server;
  let bridge: MqttBridge;
  let client: MqttClient;
  let deviceId: string;
  let privateKey: KeyObject;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(url!);
    stores = createStores(url!)!;

    // Bootstrap a site-bound sensor over the admin API.
    const app = createApp({
      config: {
        rssiFloorDbm: -70,
        wifiFloorDbm: -60,
        gpsMaxMeters: 50,
        site: { latitude: NaN, longitude: NaN },
        adminToken: 'test-admin',
        allowUnsignedValidation: false,
        timestampToleranceMs: 300_000,
        nonceTtlMs: 120_000,
        lanTokenTtlMs: 120_000,
        sessionTtlMs: 120_000,
        trustProxy: false,
        rateLimit: { windowMs: 60_000, max: 100_000, enrollMax: 100_000 },
      },
      stores,
    });
    const admin = { 'x-admin-token': 'test-admin' };
    const site = await request(app)
      .post('/admin/sites')
      .set(admin)
      .send({ organizationName: 'MqttOrg', name: 'Plant' });
    const created = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ siteId: site.body.siteId, kind: 'sensor', name: 'mqtt-probe' });
    deviceId = created.body.deviceId;

    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: 'jwk' }) as { x: string };
    await request(app)
      .post('/devices/enroll')
      .send({
        enrollmentCode: created.body.enrollmentCode,
        publicKey: Buffer.from(jwk.x, 'base64url').toString('base64'),
      });

    // In-process broker on an ephemeral port (v1 requires the async factory).
    broker = await Aedes.createBroker();
    netServer = createServer(broker.handle);
    await new Promise<void>((resolve) => netServer.listen(0, resolve));
    const port = (netServer.address() as { port: number }).port;

    // Start the bridge and wait until its subscription is registered.
    const bridgeSubscribed = new Promise<void>((resolve) => {
      broker.on('subscribe', (subscriptions) => {
        if (subscriptions.some((s) => s.topic === 'proxies/telemetry/+')) resolve();
      });
    });
    bridge = startMqttBridge(
      `mqtt://127.0.0.1:${port}`,
      {},
      {
        config: { timestampToleranceMs: 300_000 },
        stores,
        notifier: async () => {},
      }
    );
    await bridgeSubscribed;

    client = mqtt.connect(`mqtt://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () =>
        client.subscribe(`proxies/telemetry-ack/${deviceId}`, (err) =>
          err ? reject(err) : resolve()
        )
      );
    });
  }, 30000);

  afterAll(async () => {
    await new Promise<void>((resolve) => client?.end(false, {}, () => resolve()));
    await bridge?.close();
    await new Promise<void>((resolve) => broker?.close(() => resolve()));
    await new Promise<void>((resolve) => netServer?.close(() => resolve()));
    await stores?.close();
    await pool?.end();
  });

  function batch(seq: number, readings: Record<string, unknown>[]) {
    const timestamp = new Date().toISOString();
    const signature = cryptoSign(
      null,
      Buffer.from(telemetrySigningString(deviceId, seq, timestamp, readings), 'utf8'),
      privateKey
    ).toString('base64');
    return { deviceId, seq, timestamp, signature, readings };
  }

  function publishAndAwaitAck(payload: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No ack within 10s')), 10_000);
      client.once('message', (_topic, message) => {
        clearTimeout(timer);
        resolve(JSON.parse(message.toString('utf8')) as Record<string, unknown>);
      });
      client.publish(`proxies/telemetry/${deviceId}`, payload);
    });
  }

  test('a signed batch over MQTT is accepted and stored', async () => {
    const ack = await publishAndAwaitAck(
      JSON.stringify(batch(1, [{ ts: new Date().toISOString(), type: 'vibration_rms', value: 0.42 }]))
    );
    expect(ack.status).toBe(200);
    expect(ack.accepted).toBe(1);

    const rows = await pool.query(`SELECT type FROM telemetry WHERE device_uuid = $1`, [deviceId]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].type).toBe('vibration_rms');
  });

  test('a replayed seq is rejected over MQTT too', async () => {
    const ack = await publishAndAwaitAck(
      JSON.stringify(batch(1, [{ ts: new Date().toISOString(), type: 'vibration_rms', value: 0.5 }]))
    );
    expect(ack.status).toBe(409);
    expect(ack.code).toBe('SEQ_REPLAYED');
  });

  test('a tampered batch fails its signature over MQTT', async () => {
    const body = batch(3, [{ ts: new Date().toISOString(), type: 'vibration_rms', value: 0.5 }]);
    body.readings = [{ ts: new Date().toISOString(), type: 'vibration_rms', value: 9.9 }];
    const ack = await publishAndAwaitAck(JSON.stringify(body));
    expect(ack.status).toBe(401);
    expect(ack.code).toBe('SIGNATURE_INVALID');
  });

  test('malformed JSON gets a structured ack', async () => {
    const ack = await publishAndAwaitAck('{not json');
    expect(ack.status).toBe(400);
    expect(ack.code).toBe('MALFORMED_JSON');
  });
});
