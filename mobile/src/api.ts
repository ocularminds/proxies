import {
  ensureKeyPair,
  exportPublicKeyB64,
  getDeviceId,
  setDeviceId,
  signMessage,
} from './keystore';
import type { ProximityMetrics } from './metrics';

export interface ValidationEnvelope {
  deviceId: string;
  timestamp: string;
  signature: string;
  metrics: ProximityMetrics;
}

export function getServerUrl(): string {
  return localStorage.getItem('proxies.serverUrl') ?? '';
}

export function setServerUrl(url: string): void {
  localStorage.setItem('proxies.serverUrl', url.replace(/\/+$/, ''));
}

// One-time registration: sends the public key with the enrollment code the
// admin issued; the server binds this device to the user.
export async function enroll(serverUrl: string, enrollmentCode: string): Promise<string> {
  const pair = await ensureKeyPair();
  const publicKey = await exportPublicKeyB64(pair);
  const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/devices/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentCode, publicKey, platform: 'capacitor' }),
  });
  const body = (await response.json()) as { deviceId?: string; message?: string };
  if (!response.ok || !body.deviceId) {
    throw new Error(body.message ?? `Enrollment failed (HTTP ${response.status}).`);
  }
  await setDeviceId(body.deviceId);
  return body.deviceId;
}

// Deterministic JSON with sorted keys — mirror of server/src/crypto.ts; keep
// the two implementations in sync.
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

export async function buildSignedEnvelope(metrics: ProximityMetrics): Promise<ValidationEnvelope> {
  const deviceId = await getDeviceId();
  if (!deviceId) {
    throw new Error('This device is not enrolled yet — open Enrollment and register it first.');
  }
  const timestamp = new Date().toISOString();
  const message = `proxies-validate\n${deviceId}\n${timestamp}\n${canonicalJson(metrics)}`;
  const signature = await signMessage(message);
  return { deviceId, timestamp, signature, metrics };
}
