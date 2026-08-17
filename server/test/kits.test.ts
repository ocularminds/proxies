import { describe, expect, test } from 'vitest';
import { KITS, KIT_KEYS } from '../src/kits';
import { breachValue, nextValue, startValue } from '../src/kits/sim';

describe('vertical kits', () => {
  test('every kit rule references a metric the kit defines', () => {
    for (const key of KIT_KEYS) {
      const kit = KITS[key];
      const metricTypes = new Set(kit.metrics.map((metric) => metric.type));
      for (const rule of kit.defaultRules) {
        expect(metricTypes.has(rule.metricType), `${key}: ${rule.metricType}`).toBe(true);
      }
    }
  });

  test('metric types are snake_case and ranges are ordered', () => {
    for (const key of KIT_KEYS) {
      for (const metric of KITS[key].metrics) {
        expect(metric.type).toMatch(/^[a-z0-9_]+$/);
        expect(metric.typicalRange[0]).toBeLessThan(metric.typicalRange[1]);
      }
    }
  });
});

describe('simulator value walk', () => {
  test('stays clamped to the range', () => {
    let value = startValue([10, 55], () => 0.5);
    for (let i = 0; i < 200; i++) {
      value = nextValue(value, [10, 55], Math.random);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(55);
    }
  });

  test('breach values land on the breaching side of the threshold', () => {
    expect(breachValue([0, 100], 'gt', 80)).toBeGreaterThan(80);
    expect(breachValue([0, 100], 'lt', 20)).toBeLessThan(20);
  });
});
