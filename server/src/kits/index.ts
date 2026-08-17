import type { KitKey, VerticalKit } from './types';

export type { KitKey, KitMetric, KitRule, VerticalKit } from './types';

const agriculture: VerticalKit = {
  key: 'agriculture',
  title: 'Agriculture',
  cadence: '5–15 min readings; days of gateway buffering',
  connectivity: 'LoRaWAN to a solar-powered gateway',
  metrics: [
    { type: 'soil_moisture_pct', label: 'Soil moisture', unit: '%', typicalRange: [10, 55] },
    { type: 'soil_temp_c', label: 'Soil temperature', unit: '°C', typicalRange: [12, 35] },
    { type: 'air_temp_c', label: 'Air temperature', unit: '°C', typicalRange: [8, 42] },
    { type: 'humidity_pct', label: 'Relative humidity', unit: '%', typicalRange: [25, 95] },
    { type: 'leaf_wetness_pct', label: 'Leaf wetness', unit: '%', typicalRange: [0, 100] },
    { type: 'tank_level_pct', label: 'Water tank level', unit: '%', typicalRange: [5, 100] },
  ],
  defaultRules: [
    { metricType: 'soil_moisture_pct', op: 'lt', threshold: 20, label: 'Irrigation needed' },
    { metricType: 'air_temp_c', op: 'lt', threshold: 2, label: 'Frost risk' },
    { metricType: 'air_temp_c', op: 'gt', threshold: 38, label: 'Heat stress' },
    { metricType: 'tank_level_pct', op: 'lt', threshold: 15, label: 'Water tank low' },
  ],
  notes: [
    'Calibrate capacitive probes per soil type; expect sensor drift over a season.',
    'Livestock BLE ear tags reuse the presence stream directly.',
    'Dry-season dust degrades solar charging — oversize the panel.',
  ],
};

const waste: VerticalKit = {
  key: 'waste',
  title: 'Waste management',
  cadence: 'Hourly plus event-driven (tilt, fire)',
  connectivity: 'NB-IoT / LTE-M per bin (no gateway density citywide)',
  metrics: [
    { type: 'fill_pct', label: 'Fill level', unit: '%', typicalRange: [0, 100] },
    { type: 'tilt_deg', label: 'Tilt', unit: '°', typicalRange: [0, 15] },
    { type: 'temp_c', label: 'Bin temperature', unit: '°C', typicalRange: [5, 45] },
  ],
  defaultRules: [
    { metricType: 'fill_pct', op: 'gt', threshold: 80, label: 'Bin needs collection' },
    { metricType: 'temp_c', op: 'gt', threshold: 60, label: 'Possible bin fire' },
    { metricType: 'tilt_deg', op: 'gt', threshold: 45, label: 'Bin knocked over' },
  ],
  notes: [
    'Ultrasonic fill sensors misread on loose bags and heavy rain — median-filter at the edge.',
    'Theft-resistant mounting matters more than sensor spec.',
    'Driver depot check-in reuses the presence stream.',
  ],
};

const factory: VerticalKit = {
  key: 'factory',
  title: 'Factory',
  cadence: 'High-rate bursts with edge feature extraction (send band summaries, not waveforms)',
  connectivity: 'Wired power + Ethernet/Wi-Fi; Modbus/OPC-UA bridge on the gateway',
  metrics: [
    { type: 'vibration_rms', label: 'Vibration (RMS velocity)', unit: 'mm/s', typicalRange: [0.3, 4.5] },
    { type: 'motor_current_a', label: 'Motor current', unit: 'A', typicalRange: [4, 24] },
    { type: 'line_temp_c', label: 'Line temperature', unit: '°C', typicalRange: [20, 60] },
    { type: 'energy_kwh', label: 'Energy (interval)', unit: 'kWh', typicalRange: [0.5, 12] },
  ],
  defaultRules: [
    { metricType: 'vibration_rms', op: 'gt', threshold: 7.1, label: 'ISO 10816 zone D — investigate' },
    { metricType: 'motor_current_a', op: 'gt', threshold: 30, label: 'Motor overcurrent' },
    { metricType: 'line_temp_c', op: 'gt', threshold: 70, label: 'Line overheating' },
  ],
  notes: [
    'Electrical noise: shielded cabling and grounding discipline before blaming sensors.',
    'IT/OT separation — agree the network path with plant IT early.',
    'Worker presence zones (mustering, lockout/tagout evidence) reuse the presence stream.',
  ],
};

const water: VerticalKit = {
  key: 'water',
  title: 'Water',
  cadence: '1–15 min plus threshold events; night-flow window for leak analysis',
  connectivity: 'LoRa or cellular per site',
  metrics: [
    { type: 'level_pct', label: 'Tank/reservoir level', unit: '%', typicalRange: [10, 98] },
    { type: 'flow_lpm', label: 'Flow', unit: 'L/min', typicalRange: [0, 220] },
    { type: 'ph', label: 'pH', typicalRange: [6.6, 8.4] },
    { type: 'turbidity_ntu', label: 'Turbidity', unit: 'NTU', typicalRange: [0.1, 4] },
    { type: 'tds_ppm', label: 'Total dissolved solids', unit: 'ppm', typicalRange: [80, 450] },
    { type: 'chlorine_ppm', label: 'Free chlorine', unit: 'ppm', typicalRange: [0.2, 1.5] },
    { type: 'pump_current_a', label: 'Pump current', unit: 'A', typicalRange: [2, 12] },
  ],
  defaultRules: [
    { metricType: 'level_pct', op: 'lt', threshold: 10, label: 'Tank critically low' },
    { metricType: 'level_pct', op: 'gt', threshold: 95, label: 'Overflow risk' },
    { metricType: 'ph', op: 'lt', threshold: 6.5, label: 'pH out of band (low)' },
    { metricType: 'ph', op: 'gt', threshold: 8.5, label: 'pH out of band (high)' },
    { metricType: 'turbidity_ntu', op: 'gt', threshold: 5, label: 'Turbidity high' },
    { metricType: 'pump_current_a', op: 'lt', threshold: 1, label: 'Pump possibly dry-running' },
  ],
  notes: [
    'Quality probes (pH, chlorine) need scheduled recalibration — an ops commitment, not just tech.',
    'Signed immutable logs double as the regulatory audit trail.',
    'Actuation (remote pump control) requires a separate safety review: signed commands, interlocks, manual override.',
  ],
};

export const KITS: Record<KitKey, VerticalKit> = { agriculture, waste, factory, water };

export const KIT_KEYS = Object.keys(KITS) as KitKey[];
