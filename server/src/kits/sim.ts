// Random-walk value generator for kit simulators: drifts within the metric's
// typical range, clamped, with an optional forced excursion beyond it.
export function nextValue(
  current: number,
  [min, max]: [number, number],
  random: () => number = Math.random
): number {
  const span = max - min;
  const step = (random() - 0.5) * span * 0.1;
  const next = current + step;
  return Math.round(Math.max(min, Math.min(max, next)) * 100) / 100;
}

export function startValue([min, max]: [number, number], random: () => number = Math.random): number {
  return Math.round((min + (max - min) * random()) * 100) / 100;
}

// A breach value just past the range edge, used to demonstrate rule firing.
export function breachValue([min, max]: [number, number], op: 'gt' | 'lt', threshold: number): number {
  void min;
  void max;
  return op === 'gt' ? Math.round((threshold * 1.15 + 1) * 100) / 100 : Math.round((threshold * 0.7 - 1) * 100) / 100;
}
