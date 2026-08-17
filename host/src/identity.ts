import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface HostIdentity {
  hostId: string;
  privateKeyPem: string;
  publicKeyB64: string;
}

export function identityPath(userDataDir: string): string {
  return path.join(userDataDir, 'proxies-identity.json');
}

export function loadIdentity(userDataDir: string): HostIdentity | null {
  const file = identityPath(userDataDir);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as HostIdentity;
    return parsed.hostId && parsed.privateKeyPem ? parsed : null;
  } catch {
    return null;
  }
}

function generateKeys(): { privateKeyPem: string; publicKeyB64: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyB64: Buffer.from(jwk.x, 'base64url').toString('base64'),
  };
}

// One-time enrollment against a code issued by an admin; the private key never
// leaves this machine.
export async function enrollHost(
  userDataDir: string,
  serverUrl: string,
  enrollmentCode: string
): Promise<HostIdentity> {
  const keys = generateKeys();
  const response = await fetch(`${serverUrl}/hosts/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentCode, publicKey: keys.publicKeyB64 }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as { hostId?: string; message?: string };
  if (!response.ok || !body.hostId) {
    throw new Error(body.message ?? `Host enrollment failed (HTTP ${response.status}).`);
  }
  const identity: HostIdentity = { hostId: body.hostId, ...keys };
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(identityPath(userDataDir), JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

export function signWithIdentity(identity: HostIdentity, message: string): string {
  const key = createPrivateKey(identity.privateKeyPem);
  return cryptoSign(null, Buffer.from(message, 'utf8'), key).toString('base64');
}
