// Pilot provisioning: creates the site, applies the vertical kit, and issues
// N devices with one-time enrollment codes, written to a field manifest.
//
//   npm run provision -- --kit waste --org "Lagos Waste Co" --site "Ikeja Zone A" \
//     --devices 10 --admin $ADMIN_TOKEN [--server http://localhost:3000] \
//     [--lat 6.6018 --lon 3.3515]
import { writeFileSync } from 'node:fs';
import { KITS, type KitKey } from '../src/kits';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing --${name}`);
  process.exit(1);
}

const kitKey = arg('kit') as KitKey;
if (!KITS[kitKey]) {
  console.error(`Unknown kit "${kitKey}". Kits: ${Object.keys(KITS).join(', ')}`);
  process.exit(1);
}
const server = arg('server', 'http://localhost:3000');
const adminToken = arg('admin');
const organizationName = arg('org');
const siteName = arg('site');
const deviceCount = Number(arg('devices', '10'));
const lat = process.argv.includes('--lat') ? Number(arg('lat')) : undefined;
const lon = process.argv.includes('--lon') ? Number(arg('lon')) : undefined;

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${server}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const main = async () => {
  const site = await post('/admin/sites', {
    organizationName,
    name: siteName,
    ...(lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : {}),
  });
  if (site.status !== 201) {
    console.error('Site creation failed (site names must be new per org):', site.body);
    process.exit(1);
  }
  const siteId = site.body.siteId as number;

  const applied = await post(`/admin/sites/${siteId}/apply-kit`, { kit: kitKey });
  console.log(
    `Site #${siteId} "${siteName}" created; ${kitKey} kit applied ` +
      `(${applied.body.rulesCreated} rules created, ${applied.body.rulesSkipped} already present).`
  );

  const manifest: { name: string; deviceId: string; enrollmentCode: string }[] = [];
  for (let i = 1; i <= deviceCount; i++) {
    const name = `${kitKey}-${String(i).padStart(2, '0')}`;
    const device = await post('/admin/devices', { siteId, kind: 'sensor', name });
    if (device.status !== 201) {
      console.error(`Device ${name} failed:`, device.body);
      process.exit(1);
    }
    manifest.push({
      name,
      deviceId: device.body.deviceId as string,
      enrollmentCode: device.body.enrollmentCode as string,
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `provision-${kitKey}-${stamp}`;
  writeFileSync(`${base}.json`, JSON.stringify({ organizationName, siteName, siteId, kit: kitKey, devices: manifest }, null, 2));
  writeFileSync(
    `${base}.csv`,
    ['name,deviceId,enrollmentCode', ...manifest.map((d) => `${d.name},${d.deviceId},${d.enrollmentCode}`)].join('\n')
  );
  console.log(`${deviceCount} devices issued. Manifest: ${base}.json / ${base}.csv`);
  console.log('Enrollment codes are single-use and expire in 24h — install within that window or reissue.');
};

void main();
