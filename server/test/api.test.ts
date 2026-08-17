import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import type { Express } from 'express';
import { createApp, type AppRuntimeConfig } from '../src/app';
import { createStores, type Stores } from '../src/stores';
import { migrate } from '../src/migrate';
import { nonceSigningString, validationSigningString } from '../src/crypto';

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
    nonceTtlMs: 120_000,
    ...overrides,
  };
}

function makeDeviceKeys(): { publicKeyB64: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const publicKeyB64 = Buffer.from(jwk.x, 'base64url').toString('base64');
  return { publicKeyB64, privateKey };
}

function signWith(privateKey: KeyObject, message: string): string {
  return cryptoSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

async function fetchNonce(app: Express, deviceId: string, privateKey: KeyObject) {
  const timestamp = new Date().toISOString();
  return request(app)
    .post('/nonces')
    .send({
      deviceId,
      timestamp,
      signature: signWith(privateKey, nonceSigningString(deviceId, timestamp)),
    });
}

function envelope(
  deviceId: string,
  privateKey: KeyObject,
  metrics: Record<string, unknown>,
  nonce: string
) {
  const signature = signWith(privateKey, validationSigningString(deviceId, nonce, metrics));
  return { deviceId, nonce, signature, metrics };
}

// Destructive (drops the schema); gated on TEST_DATABASE_URL like migrate.test.
describe.skipIf(!url)('API with enrollment and nonces (Postgres)', () => {
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

  test('an unenrolled device gets no nonce', async () => {
    const res = await fetchNonce(app, deviceId, keys.privateKey);
    expect(res.status).toBe(401);
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

  test('a stale nonce request is rejected', async () => {
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/nonces')
      .send({
        deviceId,
        timestamp,
        signature: signWith(keys.privateKey, nonceSigningString(deviceId, timestamp)),
      });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/timestamp/i);
  });

  test('a tampered nonce request fails its signature check', async () => {
    const timestamp = new Date().toISOString();
    const res = await request(app)
      .post('/nonces')
      .send({
        deviceId,
        timestamp,
        signature: signWith(keys.privateKey, nonceSigningString(deviceId, 'other-time')),
      });
    expect(res.status).toBe(401);
  });

  test('a signed validation with a fresh nonce passes and is logged', async () => {
    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    expect(nonceRes.status).toBe(200);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const logged = await pool.query(
      `SELECT success FROM validation_logs WHERE device_uuid = $1 AND success = TRUE`,
      [deviceId]
    );
    expect(logged.rows.length).toBeGreaterThan(0);
  });

  test('replaying an envelope fails: the nonce is single-use', async () => {
    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    const body = envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce);

    const first = await request(app).post('/validate-proximity').send(body);
    expect(first.status).toBe(200);

    const replay = await request(app).post('/validate-proximity').send(body);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/nonce/i);
  });

  test('a made-up nonce is rejected', async () => {
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, 'f'.repeat(32)));
    expect(res.status).toBe(401);
  });

  test('an expired nonce is rejected', async () => {
    const shortApp = createApp({ config: runtimeConfig({ nonceTtlMs: -1000 }), stores });
    const nonceRes = await fetchNonce(shortApp, deviceId, keys.privateKey);
    expect(nonceRes.status).toBe(200);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce));
    expect(res.status).toBe(401);
  });

  test("a nonce bound to one device cannot be spent by another", async () => {
    const second = makeDeviceKeys();
    const created = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ userEmail: 'festus@example.com' });
    await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: created.body.enrollmentCode, publicKey: second.publicKeyB64 });
    const secondId = created.body.deviceId;

    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(secondId, second.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce));
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/nonce/i);
  });

  test('tampered metrics fail signature verification', async () => {
    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    const body = envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce);
    body.metrics = { bluetoothRssi: -40 };
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/signature/i);
  });

  test('a weak signal is denied even with a valid signature and nonce', async () => {
    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, keys.privateKey, { bluetoothRssi: -85 }, nonceRes.body.nonce));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Bluetooth/);
  });

  test('a revoked device is refused even with an unspent nonce', async () => {
    const nonceRes = await fetchNonce(app, deviceId, keys.privateKey);
    await pool.query(`UPDATE devices SET status = 'revoked' WHERE id = $1`, [deviceId]);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, keys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce));
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
      .post('/nonces')
      .send({ deviceId: 'x', timestamp: new Date().toISOString(), signature: 'y'.repeat(80) });
    expect(res.status).toBe(503);
  });
});
