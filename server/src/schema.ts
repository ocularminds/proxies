import { z } from 'zod';

// Metric ranges are hard bounds; the signature covers exactly these fields.
export const metricsSchema = z
  .object({
    bluetoothRssi: z.number().int().min(-127).max(0),
    wifiSignalStrength: z.number().min(-127).max(0).optional(),
    gpsCoordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
  })
  .strict();

// The signed envelope a device submits (relayed verbatim by the host over BLE,
// which is why identity and signature travel in the body, not headers). The
// nonce is server-issued, device-bound, and single-use.
export const validationEnvelope = z
  .object({
    deviceId: z.string().uuid(),
    nonce: z.string().min(16).max(128),
    lanToken: z.string().max(2048).optional(),
    signature: z.string().min(64).max(512),
    metrics: metricsSchema,
  })
  .strict();

// Signed request for a validation nonce.
export const nonceRequest = z
  .object({
    deviceId: z.string().uuid(),
    timestamp: z.string().datetime(),
    signature: z.string().min(64).max(512),
  })
  .strict();

// The host's counter-signature over the device envelope it relayed: proof the
// envelope crossed an enrolled host's BLE radio, plus the host-measured RSSI.
export const hostAttestation = z
  .object({
    hostId: z.string().uuid(),
    timestamp: z.string().datetime(),
    rssi: z.number().int().min(-127).max(0).nullable(),
    signature: z.string().min(64).max(512),
  })
  .strict();

// What the host actually POSTs: the device envelope, wrapped and attested.
export const attestedValidation = z
  .object({
    envelope: validationEnvelope,
    attestation: hostAttestation,
  })
  .strict();

export const enrollRequest = z
  .object({
    enrollmentCode: z.string().min(8).max(128),
    publicKey: z.string().min(32).max(128),
    platform: z.string().max(64).optional(),
  })
  .strict();

// Dev-mode body accepted only when ALLOW_UNSIGNED_VALIDATION=true and no
// database is configured.
export const unsignedValidation = z
  .object({
    deviceId: z.string().min(1).max(255),
    metrics: metricsSchema,
  })
  .strict();

export const adminCreateUser = z
  .object({
    organizationName: z.string().min(1).max(255),
    email: z.string().email().max(255),
    displayName: z.string().min(1).max(255),
  })
  .strict();

// Phones bind to a user; sensors and gateways bind to a site.
export const adminCreateDevice = z.union([
  z.object({ userEmail: z.string().email().max(255) }).strict(),
  z
    .object({
      siteId: z.number().int().positive(),
      kind: z.enum(['sensor', 'gateway']),
      name: z.string().min(1).max(255).optional(),
    })
    .strict(),
]);

// One telemetry reading — see docs/TELEMETRY.md.
export const telemetryReading = z
  .object({
    ts: z.string().datetime(),
    type: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'snake_case identifiers only'),
    value: z.number().finite(),
    unit: z.string().max(32).optional(),
    battery: z.number().min(0).max(100).optional(),
    quality: z.string().max(32).optional(),
  })
  .strict();

export const telemetryBatch = z
  .object({
    deviceId: z.string().uuid(),
    seq: z.number().int().min(0),
    timestamp: z.string().datetime(),
    signature: z.string().min(64).max(512),
    readings: z.array(telemetryReading).min(1).max(500),
  })
  .strict();

export type TelemetryReading = z.infer<typeof telemetryReading>;

export const adminCreateRule = z
  .object({
    organizationName: z.string().min(1).max(255),
    siteId: z.number().int().positive().optional(),
    deviceId: z.string().uuid().optional(),
    metricType: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'snake_case identifiers only'),
    op: z.enum(['gt', 'lt']),
    threshold: z.number().finite(),
    webhookUrl: z.string().url().max(2048).optional(),
    label: z.string().min(1).max(255).optional(),
  })
  .strict();

export const applyKitRequest = z
  .object({
    kit: z.enum(['agriculture', 'waste', 'factory', 'water']),
  })
  .strict();

export const redeemRequest = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();

export const adminCreateSite = z
  .object({
    organizationName: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    minTier: z.enum(['A', 'B', 'C']).optional(),
  })
  .strict();

export const adminCreateHost = z
  .object({
    siteId: z.number().int().positive(),
    name: z.string().min(1).max(255),
  })
  .strict();

export type ValidationEnvelope = z.infer<typeof validationEnvelope>;
export type ProximityMetricsInput = z.infer<typeof metricsSchema>;
