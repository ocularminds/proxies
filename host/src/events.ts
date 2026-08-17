export interface ValidationResult {
  success: boolean;
  message: string;
  session?: { id: string; expiresInMs: number } | null;
}

export type HostEvent =
  | { type: 'host-info'; hostAddress: string; serverUrl: string; hostId: string | null }
  | { type: 'state'; state: string }
  | { type: 'advertising'; name: string }
  | { type: 'connected'; clientAddress: string }
  | { type: 'disconnected'; clientAddress: string }
  | { type: 'metrics-received'; metrics: unknown }
  | { type: 'rssi-measured'; rssi: number | null }
  | { type: 'lan'; url: string }
  | { type: 'session'; dataUrl: string; expiresInMs: number }
  | { type: 'validation-result'; result: ValidationResult }
  | { type: 'error'; message: string };
