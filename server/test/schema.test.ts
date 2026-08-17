import { describe, expect, test } from 'vitest';
import { metricsSchema, validationEnvelope } from '../src/schema';
import { canonicalJson, validationSigningString } from '../src/crypto';

describe('metricsSchema', () => {
  test('requires bluetoothRssi', () => {
    expect(metricsSchema.safeParse({}).success).toBe(false);
  });

  test('rejects malformed gpsCoordinates', () => {
    expect(
      metricsSchema.safeParse({
        bluetoothRssi: -50,
        gpsCoordinates: { latitude: 'abc', longitude: 'def' },
      }).success
    ).toBe(false);
  });

  test('rejects unknown fields such as hostAddress', () => {
    expect(
      metricsSchema.safeParse({ bluetoothRssi: -50, hostAddress: '169.254.169.254' }).success
    ).toBe(false);
  });
});

describe('validationEnvelope', () => {
  const valid = {
    deviceId: '7d90d0c0-09a0-45b8-b873-e7110f3d5fb9',
    timestamp: new Date().toISOString(),
    signature: 'a'.repeat(88),
    metrics: { bluetoothRssi: -50 },
  };

  test('accepts a well-formed envelope', () => {
    expect(validationEnvelope.safeParse(valid).success).toBe(true);
  });

  test('rejects a non-UUID deviceId', () => {
    expect(validationEnvelope.safeParse({ ...valid, deviceId: 'not-a-uuid' }).success).toBe(false);
  });

  test('rejects extra top-level fields', () => {
    expect(validationEnvelope.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe('canonicalJson', () => {
  test('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 }, e: undefined })).toBe(
      '{"a":{"c":3,"d":2},"b":1}'
    );
  });

  test('signing string is stable across key order', () => {
    const a = validationSigningString('id', 't', { x: 1, y: { b: 2, a: 3 } });
    const b = validationSigningString('id', 't', { y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
  });
});
