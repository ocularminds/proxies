export interface ValidationResult {
  success: boolean;
  message: string;
}

export type HostEvent =
  | { type: 'host-info'; hostAddress: string; serverUrl: string }
  | { type: 'state'; state: string }
  | { type: 'advertising'; name: string }
  | { type: 'connected'; clientAddress: string }
  | { type: 'disconnected'; clientAddress: string }
  | { type: 'metrics-received'; metrics: unknown }
  | { type: 'validation-result'; result: ValidationResult }
  | { type: 'error'; message: string };
