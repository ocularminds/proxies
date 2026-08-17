import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import type { Express } from 'express';
import { createApp, type AlertNotification, type AppRuntimeConfig } from '../src/app';
import { createStores, type Stores } from '../src/stores';
import { migrate } from '../src/migrate';
import {
  hostAttestSigningString,
  lanTokenSigningString,
  nonceSigningString,
  telemetrySigningString,
  validationSigningString,
} from '../src/crypto';

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
    lanTokenTtlMs: 120_000,
    sessionTtlMs: 120_000,
    trustProxy: false,
    rateLimit: { windowMs: 60_000, max: 100_000, enrollMax: 100_000 },
    ...overrides,
  };
}

function makeKeys(): { publicKeyB64: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { publicKeyB64: Buffer.from(jwk.x, 'base64url').toString('base64'), privateKey };
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
  nonce: string,
  lanToken: string | null = null
) {
  const signature = signWith(
    privateKey,
    validationSigningString(deviceId, nonce, lanToken, metrics)
  );
  const body: Record<string, unknown> = { deviceId, nonce, signature, metrics };
  if (lanToken !== null) {
    body.lanToken = lanToken;
  }
  return body as {
    deviceId: string;
    nonce: string;
    lanToken?: string;
    signature: string;
    metrics: Record<string, unknown>;
  };
}

function makeLanToken(
  lanHostId: string,
  hostKey: KeyObject,
  issuedAt = new Date().toISOString()
): string {
  const sig = signWith(hostKey, lanTokenSigningString(lanHostId, issuedAt));
  return Buffer.from(JSON.stringify({ hostId: lanHostId, issuedAt, sig })).toString('base64');
}

function attest(
  envelopeBody: ReturnType<typeof envelope>,
  hostId: string,
  hostKey: KeyObject,
  rssi: number | null = null,
  timestamp = new Date().toISOString()
) {
  const signature = signWith(
    hostKey,
    hostAttestSigningString(hostId, timestamp, rssi, envelopeBody)
  );
  return { envelope: envelopeBody, attestation: { hostId, timestamp, rssi, signature } };
}

// Destructive (drops the schema); gated on TEST_DATABASE_URL like migrate.test.
describe.skipIf(!url)('API with enrollment, nonces, and host attestation (Postgres)', () => {
  let pool: Pool;
  let stores: Stores;
  let app: Express;
  const admin = { 'x-admin-token': 'test-admin' };

  const deviceKeys = makeKeys();
  const hostKeys = makeKeys();
  let deviceId: string;
  let hostId: string;
  let siteId: number;

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

  async function freshAttestedValidation(metrics: Record<string, unknown>, rssi: number | null = null) {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    expect(nonceRes.status).toBe(200);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, metrics, nonceRes.body.nonce),
      hostId,
      hostKeys.privateKey,
      rssi
    );
    return request(app).post('/validate-proximity').send(body);
  }

  test('admin bootstraps org, user, site, host, and device', async () => {
    const user = await request(app)
      .post('/admin/users')
      .set(admin)
      .send({ organizationName: 'Acme', email: 'festus@example.com', displayName: 'Festus' });
    expect(user.status).toBe(201);

    const site = await request(app)
      .post('/admin/sites')
      .set(admin)
      .send({ organizationName: 'Acme', name: 'HQ', latitude: 6.5244, longitude: 3.3792 });
    expect(site.status).toBe(201);
    siteId = site.body.siteId;

    const dupSite = await request(app)
      .post('/admin/sites')
      .set(admin)
      .send({ organizationName: 'Acme', name: 'HQ' });
    expect(dupSite.status).toBe(409);

    const badSiteHost = await request(app)
      .post('/admin/hosts')
      .set(admin)
      .send({ siteId: 999999, name: 'front-desk' });
    expect(badSiteHost.status).toBe(404);

    const host = await request(app)
      .post('/admin/hosts')
      .set(admin)
      .send({ siteId, name: 'front-desk' });
    expect(host.status).toBe(201);
    hostId = host.body.hostId;

    const hostEnroll = await request(app)
      .post('/hosts/enroll')
      .send({ enrollmentCode: host.body.enrollmentCode, publicKey: hostKeys.publicKeyB64 });
    expect(hostEnroll.status).toBe(200);
    expect(hostEnroll.body.hostId).toBe(hostId);

    const reuse = await request(app)
      .post('/hosts/enroll')
      .send({ enrollmentCode: host.body.enrollmentCode, publicKey: hostKeys.publicKeyB64 });
    expect(reuse.status).toBe(400);

    const device = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ userEmail: 'festus@example.com' });
    expect(device.status).toBe(201);
    deviceId = device.body.deviceId;

    const deviceEnroll = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: device.body.enrollmentCode, publicKey: deviceKeys.publicKeyB64 });
    expect(deviceEnroll.status).toBe(200);
  });

  test('an attested, signed validation passes, logs host and site, and mints a session', async () => {
    const res = await freshAttestedValidation({ bluetoothRssi: -50 });
    expect(res.status).toBe(200);
    expect(res.body.session?.id).toBeTruthy();

    const redeem = await request(app)
      .post('/sessions/redeem')
      .set(admin)
      .send({ sessionId: res.body.session.id });
    expect(redeem.status).toBe(200);
    expect(redeem.body.userEmail).toBe('festus@example.com');
    expect(redeem.body.deviceUuid).toBe(deviceId);
    expect(Number(redeem.body.siteId)).toBe(siteId);

    const again = await request(app)
      .post('/sessions/redeem')
      .set(admin)
      .send({ sessionId: res.body.session.id });
    expect(again.status).toBe(400);

    const unauthed = await request(app)
      .post('/sessions/redeem')
      .send({ sessionId: res.body.session.id });
    expect(unauthed.status).toBe(401);

    const logged = await pool.query(
      `SELECT host_id, site_id FROM validation_logs WHERE device_uuid = $1 AND success = TRUE`,
      [deviceId]
    );
    expect(logged.rows.length).toBeGreaterThan(0);
    expect(logged.rows[0].host_id).toBe(hostId);
    expect(Number(logged.rows[0].site_id)).toBe(siteId);

    // Presence lands in the telemetry stream too (P2.10).
    const presence = await pool.query(
      `SELECT value, site_id FROM telemetry WHERE device_uuid = $1 AND type = 'presence'`,
      [deviceId]
    );
    expect(presence.rows.length).toBeGreaterThan(0);
    expect(Number(presence.rows[0].value)).toBe(1);
    expect(Number(presence.rows[0].site_id)).toBe(siteId);
  });

  test('a bare device envelope without attestation is rejected', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const res = await request(app)
      .post('/validate-proximity')
      .send(envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce));
    expect(res.status).toBe(400);
  });

  test('an unknown host is rejected before device checks', async () => {
    const strangerHost = makeKeys();
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
      '123e4567-e89b-42d3-a456-426614174000',
      strangerHost.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/host/i);
  });

  test('a stale host attestation is rejected', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
      hostId,
      hostKeys.privateKey,
      null,
      old
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/attestation/i);
  });

  test('swapping the envelope under an attestation breaks the host signature', async () => {
    const nonceA = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const nonceB = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const attested = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceA.body.nonce),
      hostId,
      hostKeys.privateKey
    );
    attested.envelope = envelope(
      deviceId,
      deviceKeys.privateKey,
      { bluetoothRssi: -50 },
      nonceB.body.nonce
    );
    const res = await request(app).post('/validate-proximity').send(attested);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/attestation/i);
  });

  test('an expired session cannot be redeemed', async () => {
    const shortApp = createApp({ config: runtimeConfig({ sessionTtlMs: -1000 }), stores });
    const nonceRes = await fetchNonce(shortApp, deviceId, deviceKeys.privateKey);
    const res = await request(shortApp)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
          hostId,
          hostKeys.privateKey
        )
      );
    expect(res.status).toBe(200);
    const redeem = await request(app)
      .post('/sessions/redeem')
      .set(admin)
      .send({ sessionId: res.body.session.id });
    expect(redeem.status).toBe(400);
  });

  test('a valid LAN token verifies and is logged as same-network', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const lanToken = makeLanToken(hostId, hostKeys.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, lanToken),
      hostId,
      hostKeys.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(200);

    const logged = await pool.query(
      `SELECT lan_verified FROM validation_logs WHERE device_uuid = $1 AND success = TRUE AND lan_verified = TRUE`,
      [deviceId]
    );
    expect(logged.rows.length).toBeGreaterThan(0);
  });

  test('a LAN token signed by the wrong key is a hard failure', async () => {
    const stranger = makeKeys();
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const lanToken = makeLanToken(hostId, stranger.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, lanToken),
      hostId,
      hostKeys.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/same-network token signature/i);
  });

  test("a LAN token naming a different host is rejected", async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const lanToken = makeLanToken('123e4567-e89b-42d3-a456-426614174000', hostKeys.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, lanToken),
      hostId,
      hostKeys.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/does not match/i);
  });

  test('an expired LAN token is rejected', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const lanToken = makeLanToken(hostId, hostKeys.privateKey, old);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, lanToken),
      hostId,
      hostKeys.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired same-network/i);
  });

  test('a malformed LAN token is rejected', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, 'not-base64-json'),
      hostId,
      hostKeys.privateKey
    );
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/token/i);
  });

  test('host-measured RSSI overrides the phone-claimed value (deny case)', async () => {
    // Phone claims -50 (would pass); host measured -85 (must deny).
    const res = await freshAttestedValidation({ bluetoothRssi: -50 }, -85);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Bluetooth/);
  });

  test('host-measured RSSI overrides the phone-claimed value (pass case)', async () => {
    // Phone claims -85 (would deny); host measured -50 (authoritative pass).
    const res = await freshAttestedValidation({ bluetoothRssi: -85 }, -50);
    expect(res.status).toBe(200);
  });

  test('replaying an attested envelope fails: the nonce is single-use', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const body = attest(
      envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
      hostId,
      hostKeys.privateKey
    );
    const first = await request(app).post('/validate-proximity').send(body);
    expect(first.status).toBe(200);

    const replay = await request(app).post('/validate-proximity').send(body);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/nonce/i);
  });

  test('tampered metrics fail the device signature', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const innerEnvelope = envelope(
      deviceId,
      deviceKeys.privateKey,
      { bluetoothRssi: -50 },
      nonceRes.body.nonce
    );
    innerEnvelope.metrics = { bluetoothRssi: -40 };
    // Host attests what it relayed — the tampered envelope — so the host
    // signature is fine and the device signature must be the one that fails.
    const body = attest(innerEnvelope, hostId, hostKeys.privateKey);
    const res = await request(app).post('/validate-proximity').send(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/signature/i);
  });

  test('a weak signal is denied end to end', async () => {
    const res = await freshAttestedValidation({ bluetoothRssi: -85 });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Bluetooth/);
  });

  test('an expired nonce is rejected', async () => {
    const shortApp = createApp({ config: runtimeConfig({ nonceTtlMs: -1000 }), stores });
    const nonceRes = await fetchNonce(shortApp, deviceId, deviceKeys.privateKey);
    const res = await request(app)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
          hostId,
          hostKeys.privateKey
        )
      );
    expect(res.status).toBe(401);
  });

  test("another device cannot spend this device's nonce", async () => {
    const second = makeKeys();
    const created = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ userEmail: 'festus@example.com' });
    await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: created.body.enrollmentCode, publicKey: second.publicKeyB64 });

    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const res = await request(app)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(created.body.deviceId, second.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
          hostId,
          hostKeys.privateKey
        )
      );
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/nonce/i);
  });

  test('a revoked host is refused', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    await pool.query(`UPDATE hosts SET status = 'revoked' WHERE id = $1`, [hostId]);
    const res = await request(app)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
          hostId,
          hostKeys.privateKey
        )
      );
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/host/i);
    await pool.query(`UPDATE hosts SET status = 'active' WHERE id = $1`, [hostId]);
  });

  test('tier policy: a site requiring tier B refuses relay-only validations', async () => {
    await pool.query(`UPDATE sites SET min_tier = 'B' WHERE id = $1`, [siteId]);

    // Tier C: no host-measured RSSI, no LAN token.
    const tierC = await freshAttestedValidation({ bluetoothRssi: -50 });
    expect(tierC.status).toBe(403);
    expect(tierC.body.code).toBe('TIER_BELOW_POLICY');

    // Tier B: LAN token verified.
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    const lanToken = makeLanToken(hostId, hostKeys.privateKey);
    const tierB = await request(app)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce, lanToken),
          hostId,
          hostKeys.privateKey
        )
      );
    expect(tierB.status).toBe(200);
    expect(tierB.body.tier).toBe('B');

    // Tier A: host-measured RSSI outranks B.
    const tierA = await freshAttestedValidation({ bluetoothRssi: -50 }, -48);
    expect(tierA.status).toBe(200);
    expect(tierA.body.tier).toBe('A');

    const tierLog = await pool.query(
      `SELECT assurance_tier, error_code FROM validation_logs
       WHERE device_uuid = $1 AND error_code = 'TIER_BELOW_POLICY'`,
      [deviceId]
    );
    expect(tierLog.rows.length).toBeGreaterThan(0);
    expect(tierLog.rows[0].assurance_tier).toBe('C');

    await pool.query(`UPDATE sites SET min_tier = 'C' WHERE id = $1`, [siteId]);
  });

  test('per-site thresholds override the global config', async () => {
    // Site floor -60: a host-measured -65 must be denied even though the
    // global floor (-70) would pass it.
    await pool.query(`UPDATE sites SET rssi_floor_dbm = -60 WHERE id = $1`, [siteId]);
    const denied = await freshAttestedValidation({ bluetoothRssi: -50 }, -65);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('RSSI_BELOW_FLOOR');

    const passed = await freshAttestedValidation({ bluetoothRssi: -50 }, -55);
    expect(passed.status).toBe(200);
    await pool.query(`UPDATE sites SET rssi_floor_dbm = -70 WHERE id = $1`, [siteId]);
  });

  const sensorKeys = makeKeys();
  let sensorId: string;

  function telemetryBody(
    devId: string,
    key: KeyObject,
    seq: number,
    readings: Record<string, unknown>[],
    timestamp = new Date().toISOString()
  ) {
    const signature = signWith(key, telemetrySigningString(devId, seq, timestamp, readings));
    return { deviceId: devId, seq, timestamp, signature, readings };
  }

  test('a sensor enrolls at a site and posts a signed batch', async () => {
    const created = await request(app)
      .post('/admin/devices')
      .set(admin)
      .send({ siteId, kind: 'sensor', name: 'soil-probe-1' });
    expect(created.status).toBe(201);
    sensorId = created.body.deviceId;

    const enrolled = await request(app)
      .post('/devices/enroll')
      .send({ enrollmentCode: created.body.enrollmentCode, publicKey: sensorKeys.publicKeyB64 });
    expect(enrolled.status).toBe(200);

    const now = new Date().toISOString();
    const res = await request(app)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 1, [
          { ts: now, type: 'soil_moisture_pct', value: 31.4, unit: '%', battery: 87 },
          { ts: now, type: 'temp_c', value: 24.9 },
        ])
      );
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(2);

    const rows = await pool.query(
      `SELECT type, value, site_id, organization_id FROM telemetry WHERE device_uuid = $1 ORDER BY type`,
      [sensorId]
    );
    expect(rows.rows.length).toBe(2);
    expect(Number(rows.rows[0].site_id)).toBe(siteId);
    expect(rows.rows[0].organization_id).not.toBeNull();
  });

  test('a replayed or reordered batch seq is rejected', async () => {
    const replay = await request(app)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 1, [
          { ts: new Date().toISOString(), type: 'temp_c', value: 20 },
        ])
      );
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('SEQ_REPLAYED');
  });

  test('tampered readings fail the batch signature', async () => {
    const body = telemetryBody(sensorId, sensorKeys.privateKey, 3, [
      { ts: new Date().toISOString(), type: 'temp_c', value: 20 },
    ]);
    body.readings = [{ ts: new Date().toISOString(), type: 'temp_c', value: 99 }];
    const res = await request(app).post('/telemetry').send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  test('stale batch timestamps and future readings are rejected', async () => {
    const stale = await request(app)
      .post('/telemetry')
      .send(
        telemetryBody(
          sensorId,
          sensorKeys.privateKey,
          4,
          [{ ts: new Date().toISOString(), type: 'temp_c', value: 20 }],
          new Date(Date.now() - 10 * 60 * 1000).toISOString()
        )
      );
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('BATCH_STALE');

    const future = await request(app)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 5, [
          { ts: new Date(Date.now() + 10 * 60 * 1000).toISOString(), type: 'temp_c', value: 20 },
        ])
      );
    expect(future.status).toBe(400);
    expect(future.body.code).toBe('READING_TS_FUTURE');
  });

  test('threshold rules fire alerts with delivery, scoping, and per-batch dedupe', async () => {
    const delivered: AlertNotification[] = [];
    const notifyingApp = createApp({
      config: runtimeConfig(),
      stores,
      notifier: async (notification) => {
        delivered.push(notification);
      },
    });

    const rule = await request(app)
      .post('/admin/rules')
      .set(admin)
      .send({ organizationName: 'Acme', metricType: 'temp_c', op: 'gt', threshold: 30 });
    expect(rule.status).toBe(201);

    // Two breaching readings in one batch → one alert (per-rule dedupe).
    const now = new Date().toISOString();
    const res = await request(notifyingApp)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 10, [
          { ts: now, type: 'temp_c', value: 35.5 },
          { ts: now, type: 'temp_c', value: 41.0 },
          { ts: now, type: 'soil_moisture_pct', value: 30 },
        ])
      );
    expect(res.status).toBe(200);
    expect(res.body.alertsFired).toBe(1);
    expect(delivered.length).toBe(1);
    expect(delivered[0].value).toBe(35.5);
    expect(delivered[0].rule.metricType).toBe('temp_c');

    // Non-breaching batch fires nothing.
    const calm = await request(notifyingApp)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 11, [
          { ts: new Date().toISOString(), type: 'temp_c', value: 22 },
        ])
      );
    expect(calm.body.alertsFired).toBe(0);

    // Delivered alert is recorded and listable.
    const alerts = await request(app).get('/admin/alerts?organization=Acme').set(admin);
    expect(alerts.status).toBe(200);
    expect(alerts.body.alerts.length).toBeGreaterThan(0);
    expect(alerts.body.alerts[0].delivered).toBe(true);

    // A rule scoped to a different device never fires for this sensor.
    const otherScoped = await request(app)
      .post('/admin/rules')
      .set(admin)
      .send({
        organizationName: 'Acme',
        deviceId,
        metricType: 'soil_moisture_pct',
        op: 'lt',
        threshold: 50,
      });
    expect(otherScoped.status).toBe(201);
    const scopedRun = await request(notifyingApp)
      .post('/telemetry')
      .send(
        telemetryBody(sensorId, sensorKeys.privateKey, 12, [
          { ts: new Date().toISOString(), type: 'soil_moisture_pct', value: 10 },
        ])
      );
    expect(scopedRun.body.alertsFired).toBe(0);
  });

  test('vertical kits list, detail, and apply idempotently to a site', async () => {
    const list = await request(app).get('/kits');
    expect(list.status).toBe(200);
    expect(list.body.kits.length).toBe(4);

    const detail = await request(app).get('/kits/waste');
    expect(detail.status).toBe(200);
    expect(detail.body.kit.defaultRules.length).toBeGreaterThan(0);

    const missing = await request(app).get('/kits/mining');
    expect(missing.status).toBe(404);

    const applied = await request(app)
      .post(`/admin/sites/${siteId}/apply-kit`)
      .set(admin)
      .send({ kit: 'waste' });
    expect(applied.status).toBe(200);
    expect(applied.body.rulesCreated).toBe(3);

    const reapplied = await request(app)
      .post(`/admin/sites/${siteId}/apply-kit`)
      .set(admin)
      .send({ kit: 'waste' });
    expect(reapplied.body.rulesCreated).toBe(0);
    expect(reapplied.body.rulesSkipped).toBe(3);

    const badSite = await request(app)
      .post('/admin/sites/999999/apply-kit')
      .set(admin)
      .send({ kit: 'waste' });
    expect(badSite.status).toBe(404);

    // A kit rule fires with its label attached to the alert listing.
    const now = new Date().toISOString();
    const res = await request(app)
      .post('/telemetry')
      .send(telemetryBody(sensorId, sensorKeys.privateKey, 20, [{ ts: now, type: 'fill_pct', value: 91, unit: '%' }]));
    expect(res.status).toBe(200);
    expect(res.body.alertsFired).toBe(1);
    const alerts = await request(app).get('/admin/alerts?organization=Acme').set(admin);
    expect(alerts.body.alerts[0].label).toBe('Bin needs collection');
  });

  test('fleet health lists devices and hosts with battery and staleness', async () => {
    const res = await request(app).get('/admin/fleet?organization=Acme').set(admin);
    expect(res.status).toBe(200);

    const sensor = res.body.devices.find((d: { id: string }) => d.id === sensorId);
    expect(sensor).toBeTruthy();
    expect(sensor.kind).toBe('sensor');
    expect(sensor.name).toBe('soil-probe-1');
    expect(sensor.siteName).toBe('HQ');
    expect(sensor.lastBattery).toBe(87);
    expect(sensor.health).toBe('online');

    const phone = res.body.devices.find((d: { id: string }) => d.id === deviceId);
    expect(phone.kind).toBe('phone');
    expect(phone.userEmail).toBe('festus@example.com');

    const host = res.body.hosts.find((h: { id: string }) => h.id === hostId);
    expect(host).toBeTruthy();
    expect(host.siteName).toBe('HQ');
    expect(host.health).toBe('online');

    const unknownOrg = await request(app).get('/admin/fleet?organization=Nope').set(admin);
    expect(unknownOrg.status).toBe(404);

    const unauthed = await request(app).get('/admin/fleet?organization=Acme');
    expect(unauthed.status).toBe(401);
  });

  test('a revoked device is refused', async () => {
    const nonceRes = await fetchNonce(app, deviceId, deviceKeys.privateKey);
    await pool.query(`UPDATE devices SET status = 'revoked' WHERE id = $1`, [deviceId]);
    const res = await request(app)
      .post('/validate-proximity')
      .send(
        attest(
          envelope(deviceId, deviceKeys.privateKey, { bluetoothRssi: -50 }, nonceRes.body.nonce),
          hostId,
          hostKeys.privateKey
        )
      );
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
      .post('/hosts/enroll')
      .send({ enrollmentCode: 'x'.repeat(10), publicKey: 'y'.repeat(44) });
    expect(res.status).toBe(503);
  });
});

describe('rate limiting', () => {
  test('the global limiter answers 429 past the window budget', async () => {
    const app = createApp({
      config: runtimeConfig({ rateLimit: { windowMs: 60_000, max: 3, enrollMax: 100 } }),
      stores: null,
    });
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/health');
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).get('/health');
    expect(blocked.status).toBe(429);
  });

  test('the enrollment limiter is stricter than the global one', async () => {
    const app = createApp({
      config: runtimeConfig({ rateLimit: { windowMs: 60_000, max: 100, enrollMax: 2 } }),
      stores: null,
    });
    const body = { enrollmentCode: 'x'.repeat(10), publicKey: 'y'.repeat(44) };
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/devices/enroll').send(body);
      expect(res.status).toBe(503);
    }
    const blocked = await request(app).post('/devices/enroll').send(body);
    expect(blocked.status).toBe(429);
  });
});
