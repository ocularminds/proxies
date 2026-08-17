import { describe, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { LogStore, ValidationConfig, ValidationLogEntry } from '../src/types';

function testConfig(overrides: Partial<ValidationConfig> = {}): ValidationConfig {
  return {
    rssiFloorDbm: -70,
    wifiFloorDbm: -60,
    gpsMaxMeters: 50,
    site: { latitude: NaN, longitude: NaN },
    ...overrides,
  };
}

function makeApp(configOverrides: Partial<ValidationConfig> = {}) {
  const logged: ValidationLogEntry[] = [];
  const logStore: LogStore = {
    async logValidation(entry) {
      logged.push(entry);
    },
    async close() {},
  };
  const app = createApp({ config: testConfig(configOverrides), logStore });
  return { app, logged };
}

const validBody = { deviceId: 'test-device', bluetoothRssi: -50 };

describe('POST /validate-proximity', () => {
  test('rejects an empty body instead of passing it', async () => {
    const { app, logged } = makeApp();
    const res = await request(app).post('/validate-proximity').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(logged).toHaveLength(0);
  });

  test('rejects a request missing bluetoothRssi', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/validate-proximity')
      .send({ deviceId: 'test-device' });
    expect(res.status).toBe(400);
  });

  test('rejects unknown fields such as hostAddress', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/validate-proximity')
      .send({ ...validBody, hostAddress: '169.254.169.254' });
    expect(res.status).toBe(400);
  });

  test('rejects malformed gpsCoordinates without crashing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/validate-proximity')
      .send({ ...validBody, gpsCoordinates: { latitude: 'abc', longitude: 'def' } });
    expect(res.status).toBe(400);
  });

  test('denies and logs a weak Bluetooth signal', async () => {
    const { app, logged } = makeApp();
    const res = await request(app)
      .post('/validate-proximity')
      .send({ deviceId: 'test-device', bluetoothRssi: -85 });
    expect(res.status).toBe(403);
    expect(logged).toEqual([
      expect.objectContaining({ deviceId: 'test-device', success: false }),
    ]);
  });

  test('denies a weak Wi-Fi signal when provided', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/validate-proximity')
      .send({ ...validBody, wifiSignalStrength: -75 });
    expect(res.status).toBe(403);
  });

  test('denies GPS coordinates outside the configured site boundary', async () => {
    const { app } = makeApp({ site: { latitude: 6.5244, longitude: 3.3792 } });
    const res = await request(app)
      .post('/validate-proximity')
      .send({ ...validBody, gpsCoordinates: { latitude: 6.6, longitude: 3.5 } });
    expect(res.status).toBe(403);
  });

  test('accepts GPS coordinates near the configured site', async () => {
    const { app } = makeApp({ site: { latitude: 6.5244, longitude: 3.3792 } });
    const res = await request(app)
      .post('/validate-proximity')
      .send({ ...validBody, gpsCoordinates: { latitude: 6.52441, longitude: 3.37921 } });
    expect(res.status).toBe(200);
  });

  test('accepts and logs a valid request', async () => {
    const { app, logged } = makeApp();
    const res = await request(app).post('/validate-proximity').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(logged).toEqual([
      expect.objectContaining({ deviceId: 'test-device', success: true }),
    ]);
  });

  test('keeps serving after a log-store failure', async () => {
    const logStore: LogStore = {
      async logValidation() {
        throw new Error('db down');
      },
      async close() {},
    };
    const app = createApp({ config: testConfig(), logStore });
    const res = await request(app).post('/validate-proximity').send(validBody);
    expect(res.status).toBe(200);
  });
});
