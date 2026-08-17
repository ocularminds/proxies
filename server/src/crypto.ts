import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateEnrollmentCode(): string {
  return randomBytes(16).toString('base64url');
}

// Constant-time string comparison for secrets (hash first so lengths match).
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

// WebCrypto exports Ed25519 public keys as raw 32 bytes; Node's verify wants a
// KeyObject, so wrap the raw key in its SPKI DER prefix.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyEd25519(
  publicKeyRawBase64: string,
  message: string,
  signatureBase64: string
): boolean {
  try {
    const raw = Buffer.from(publicKeyRawBase64, 'base64');
    if (raw.length !== 32) {
      return false;
    }
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(
      null,
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

// Deterministic JSON: object keys sorted at every level. The mobile app builds
// the same string before signing — keep the two implementations in sync.
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

// The string a device signs for a validation request.
export function validationSigningString(
  deviceId: string,
  timestamp: string,
  metrics: unknown
): string {
  return `proxies-validate\n${deviceId}\n${timestamp}\n${canonicalJson(metrics)}`;
}
