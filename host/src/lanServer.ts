import http from 'node:http';
import { getHostAddress } from './network';
import { lanTokenSigningString } from './signing';
import { signWithIdentity, type HostIdentity } from './identity';

export interface LanServer {
  url: string;
  close(): void;
}

// Serves short-lived same-network tokens, bound to the LAN interface only —
// reachability of this listener is the proof that the phone shares the
// host's network.
export function startLanServer(identity: HostIdentity, port: number): Promise<LanServer> {
  const address = getHostAddress();
  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method !== 'GET' || req.url !== '/lan-token') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const issuedAt = new Date().toISOString();
    const sig = signWithIdentity(identity, lanTokenSigningString(identity.hostId, issuedAt));
    const token = Buffer.from(
      JSON.stringify({ hostId: identity.hostId, issuedAt, sig })
    ).toString('base64');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => {
      resolve({ url: `http://${address}:${port}`, close: () => server.close() });
    });
  });
}
