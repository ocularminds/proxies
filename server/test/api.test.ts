import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import type { Express } from 'express';
import { createApp, type AppRuntimeConfig } from '../src/app';
import { createStores, type Stores } from '../src/stores';
import { migrate } from '../src/migrate';
import { validationSigningString } from '../src/crypto';

const url = process.env.TEST_DATABASE_URL;

function runtimeConfig(overrides: Partial<AppRuntimeConfig> = {}): AppRuntimeConfig {
  return {
    rssiFloorDbm: -70,
    wifiFloorDbm: -60,
    gpsMaxMeters: 50,
    site: { latitude: NaN, longitude: NaN },
    adminToken: 'test-admin',
    allowUnsignedValidation: false,
    timestampToleranceMs: 300_000,
    ...overrides,
  };
}

function makeDeviceKeys(): { publicKeyB64: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const publicKeyB64 = Buffer.from(jwk.x, 'base64url').toString('base64');
  return { publicKeyB64, privateKey };
}

function signedEnvelope(
  deviceId: string,
  privateKey: KeyObject,
  metrics: Record<string, unknown>,
  timestamp = new Date().toISOString()
) {
  const signature = cryptoSign(
    null,
    Buffer.from(validationSigningString(deviceId, timestamp, metrics), 'utf8'),
    privateKey
  ).toString('base64');
  return { deviceId, timestamp, signature, metrics };
}

// Destructive (drops the schema); gated on TEST_DATABASE_URL like migrate.test.
describe.skipIf(!url)('API with enrollment (Postgres)', () => {
  let pool: Pool;
  let stores: Stores;
  let app: Express;
  const admin = { 'x-admin-token': 'test-admin' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(url!);
    stores = createStores(url!)!;
    app = createApp({ config: runtimeConfig(), stores });
  }, 30000);

  afterAll(async () => {
    await stores?.close();
    await pool?.end();
  });

  test('admin endpoints reject missing or wrong tokens', async () => {
    const noToken = await request(app)
      .post('/admin/users')
      .send({ organizationName: 'Org', email: 'a@b.co', displayName: 'A' });
    expect(noToken.status).toBe(401);

    const badToken = await request(app)
      .post('/admin/users')
      .set('x-admin-token', 'wrong')
      .send({ organizationName: 'Org', email: 'a@b.co', displayName: 'A' });
    expect(badToken.status).toBe(401);
  });

  let enrollmentCode: string;
  let deviceId: string;
  const keys = makeDeviceKeys();

  test('admin creates a user, then a device with a one-time code', async () => {
    const user = await request(app)
      .post('/admin/users')
      .set(admin)
      .send({ organizationName: 'Acme', email: 'festus@example.com', displayName: 'Festus' });
    expect(user.status).toBe(201);

    const duplicate = await request(app)
      .post('/admin/users')
      .set(admin)
      .send({ organizationName: 'Acme', email: 'festus@example.com', displayName: 'Again' });
    expect(duplicate.status).toBe(409);

    const device = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ userEmail: 'festus@example.com' });
    expect(device.status).toBe(201);
    expect(device.body.enrollmentCode).toBeTruthy();
    enrollmentCode = device.body.enrollmentCode;
    deviceId = device.body.deviceId;
  });

  test('unsigned validation is rejected once a database exists', async () => {
    const res = await request(app)
      .post('/validate-proximity')
      .send({ deviceId, metrics: { bluetoothRssi: -50 } });
    expect(res.status).toBe(400);
  });

  test('a device cannot validate before enrolling', async () => {
    const res = await request(app)
      .post('/validate-proximity')
      .send(signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not enrolled/);
  });

  test('enrollment rejects a bad code, accepts the real one exactly once', async () => {
    const bad = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: 'wrong-code', publicKey: keys.publicKeyB64 });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode, publicKey: keys.publicKeyB64, platform: 'test' });
    expect(ok.status).toBe(200);
    expect(ok.body.deviceId).toBe(deviceId);

    const reuse = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode, publicKey: keys.publicKeyB64 });
    expect(reuse.status).toBe(400);
  });

  test('a correctly signed validation passes and is logged with the device UUID', async () => {
    const res = await request(app)
      .post('/validate-proximity')
      .send(signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const logged = await pool.query(
      `SELECT success, device_uuid FROM validation_logs WHERE device_uuid = $1 AND success = TRUE`,
      [deviceId]
    );
    expect(logged.rows.length).toBeGreaterThan(0);

    const seen = await pool.query(`SELECT last_seen_at FROM devices WHERE id = $1`, [deviceId]);
    expect(seen.rows[0].last_seen_at).not.toBeNull();
  });

  test('tampered metrics fail signature verification', async () => {
    const envelope = signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -50 });
    envelope.metrics = { bluetoothRssi: -40 };
    const res = await request(app).post('/validate-proximity').send(envelope);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/signature/i);
  });

  test('a stale timestamp is rejected', async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/validate-proximity')
      .send(signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, old));
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/timestamp/i);
  });

  test('an unknown device is rejected', async () => {
    const stranger = makeDeviceKeys();
    const res = await request(app)
      .post('/validate-proximity')
      .send(
        signedEnvelope('123e4567-e89b-42d3-a456-426614174000', stranger.privateKey, {
          bluetoothRssi: -50,
        })
      );
    expect(res.status).toBe(401);
  });

  test('a weak signal is denied even with a valid signature', async () => {
    const res = await request(app)
      .post('/validate-proximity')
      .send(signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -85 }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Bluetooth/);
  });

  test('a revoked device is refused', async () => {
    await pool.query(`UPDATE devices SET status = 'revoked' WHERE id = $1`, [deviceId]);
    const res = await request(app)
      .post('/validate-proximity')
      .send(signedEnvelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/revoked/i);
  });
});

describe('without a database', () => {
  test('validation is refused by default', async () => {
    const app = createApp({ config: runtimeConfig(), stores: null });
    const res = await request(app)
      .post('/validate-proximity')
      .send({ deviceId: 'dev', metrics: { bluetoothRssi: -50 } });
    expect(res.status).toBe(503);
  });

  test('the explicit dev flag allows unsigned validation', async () => {
    const app = createApp({
      config: runtimeConfig({ allowUnsignedValidation: true }),
      stores: null,
    });
    const ok = await request(app)
      .post('/validate-proximity')
      .send({ deviceId: 'desk-demo', metrics: { bluetoothRssi: -50 } });
    expect(ok.status).toBe(200);

    const weak = await request(app)
      .post('/validate-proximity')
      .send({ deviceId: 'desk-demo', metrics: { bluetoothRssi: -85 } });
    expect(weak.status).toBe(403);
  });

  test('identity endpoints answer 503', async () => {
    const app = createApp({ config: runtimeConfig(), stores: null });
    const res = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: 'x'.repeat(10), publicKey: 'y'.repeat(44) });
    expect(res.status).toBe(503);
  });
});
