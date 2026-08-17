import { z } from 'zod';

// Every signal the client may submit, with hard ranges. bluetoothRssi and
// deviceId are mandatory: a request without them is rejected, never passed.
export const validationRequest = z
  .object({
    deviceId: z.string().min(1).max(255),
    bluetoothRssi: z.number().int().min(-127).max(0),
    wifiSignalStrength: z.number().min(-127).max(0).optional(),
    gpsCoordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
    qrData: z.string().max(4096).optional(),
  })
  .strict();

export type ValidationRequest = z.infer<typeof validationRequest>;
