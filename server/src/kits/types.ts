export type KitKey = 'agriculture' | 'waste' | 'factory' | 'water';

export interface KitMetric {
  type: string;
  label: string;
  unit?: string;
  // Plausible operating range; simulators walk within it.
  typicalRange: [number, number];
}

export interface KitRule {
  metricType: string;
  op: 'gt' | 'lt';
  threshold: number;
  label: string;
}

// A vertical kit is data, never a fork: metric catalog, default rule pack,
// and field notes. Applying a kit to a site instantiates its rules there.
export interface VerticalKit {
  key: KitKey;
  title: string;
  cadence: string;
  connectivity: string;
  metrics: KitMetric[];
  defaultRules: KitRule[];
  notes: string[];
}
