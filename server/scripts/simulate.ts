// Kit simulator: enrolls a virtual sensor and streams plausible readings so a
// pilot can be rehearsed (and dashboards demoed) before hardware exists.
//
//   npm run simulate -- --kit waste --site 1 --server http://localhost:3000 \
//     --admin $ADMIN_TOKEN [--interval 5] [--count 12] [--breach]
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { KITS, type KitKey } from '../src/kits';
import { breachValue, nextValue, startValue } from '../src/kits/sim';
import { telemetrySigningString } from '../src/crypto';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing --${name}`);
  process.exit(1);
}

const kitKey = arg('kit') as KitKey;
const kit = KITS[kitKey];
if (!kit) {
  console.error(`Unknown kit "${kitKey}". Kits: ${Object.keys(KITS).join(', ')}`);
  process.exit(1);
}
const server = arg('server', 'http://localhost:3000');
const adminToken = arg('admin');
const siteId = Number(arg('site'));
const intervalS = Number(arg('interval', '5'));
const count = Number(arg('count', '12'));
const breach = process.argv.includes('--breach');

const post = async (path: string, body: unknown, admin = false) => {
  const response = await fetch(`${server}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(admin ? { 'x-admin-token': adminToken } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const main = async () => {
  const name = `${kitKey}-sim-${Math.floor(Math.random() * 10000)}`;
  const created = await post('/admin/devices', { siteId, kind: 'sensor', name }, true);
  if (created.status !== 201) {
    console.error('Device creation failed:', created.body);
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const enrolled = await post('/devices/enroll', {
    enrollmentCode: created.body.enrollmentCode,
    publicKey: Buffer.from(jwk.x, 'base64url').toString('base64'),
    platform: 'simulator',
  });
  const deviceId = enrolled.body.deviceId as string;
  console.log(`[${name}] enrolled as ${deviceId} — streaming ${count} batches every ${intervalS}s`);

  const values = new Map(kit.metrics.map((metric) => [metric.type, startValue(metric.typicalRange)]));
  for (let seq = 1; seq <= count; seq++) {
    const readings = kit.metrics.map((metric) => {
      const value = nextValue(values.get(metric.type)!, metric.typicalRange);
      values.set(metric.type, value);
      return { ts: new Date().toISOString(), type: metric.type, value, unit: metric.unit, battery: 90 - seq * 0.1 };
    });
    // Optionally force one rule breach mid-run to demonstrate alerting.
    if (breach && seq === Math.ceil(count / 2) && kit.defaultRules.length) {
      const rule = kit.defaultRules[0];
      const reading = readings.find((r) => r.type === rule.metricType);
      if (reading) {
        const metric = kit.metrics.find((m) => m.type === rule.metricType)!;
        reading.value = breachValue(metric.typicalRange, rule.op, rule.threshold);
      }
    }
    const timestamp = new Date().toISOString();
    // JSON.stringify and canonicalJson both drop undefined fields, so signing
    // the in-memory readings matches what the server reconstructs.
    const signature = cryptoSign(
      null,
      Buffer.from(telemetrySigningString(deviceId, seq, timestamp, readings), 'utf8'),
      privateKey
    ).toString('base64');
    const ack = await post('/telemetry', { deviceId, seq, timestamp, signature, readings });
    console.log(
      `[${name}] seq ${seq}: ${ack.status} accepted=${ack.body.accepted ?? 0} alerts=${ack.body.alertsFired ?? 0}`
    );
    if (seq < count) await new Promise((resolve) => setTimeout(resolve, intervalS * 1000));
  }
  console.log(`[${name}] done`);
};

void main();
