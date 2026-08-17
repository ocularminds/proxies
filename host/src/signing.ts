import { createHash } from 'node:crypto';

// Deterministic JSON with sorted keys — mirror of server/src/crypto.ts; keep
// the implementations in sync (a shared package is planned for P2.1).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// The string a host signs to attest it relayed a device envelope over BLE.
export function hostAttestSigningString(
  hostId: string,
  timestamp: string,
  rssi: number | null,
  envelope: unknown
): string {
  return `proxies-host-attest\n${hostId}\n${timestamp}\n${rssi ?? 'null'}\n${sha256Hex(
    canonicalJson(envelope)
  )}`;
}
