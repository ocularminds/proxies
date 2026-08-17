import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
  adminCreateDevice,
  adminCreateHost,
  adminCreateSite,
  adminCreateUser,
  attestedValidation,
  enrollRequest,
  nonceRequest,
  unsignedValidation,
} from './schema';
import { evaluateProximity } from './evaluate';
import {
  generateEnrollmentCode,
  generateNonce,
  hostAttestSigningString,
  nonceSigningString,
  secretsEqual,
  sha256Hex,
  validationSigningString,
  verifyEd25519,
} from './crypto';
import type { AppConfig } from './types';
import type { Stores } from './stores';

export type AppRuntimeConfig = Omit<AppConfig, 'port' | 'databaseUrl'>;

export interface AppDeps {
  config: AppRuntimeConfig;
  stores: Stores | null;
}

const ENROLLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

// Async handlers funnel unexpected failures to one place.
function wrap(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res) => {
    fn(req, res).catch((err: Error) => {
      console.error('Unhandled route error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Internal error.' });
      }
    });
  };
}

function invalid(res: Response, issues: { path: PropertyKey[]; message: string }[]): void {
  res.status(400).json({
    success: false,
    message: 'Invalid request.',
    issues: issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  });
}

export function createApp({ config, stores }: AppDeps): Express {
  const app = express();
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    })
  );
  // Enrollment endpoints burn one-time codes; keep guessing expensive.
  const enrollLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.enrollMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'proxies-server' });
  });

  const requireAdmin = (req: Request, res: Response): boolean => {
    if (!config.adminToken) {
      res.status(503).json({ success: false, message: 'ADMIN_TOKEN is not configured.' });
      return false;
    }
    const token = req.header('x-admin-token');
    if (!token || !secretsEqual(token, config.adminToken)) {
      res.status(401).json({ success: false, message: 'Invalid admin token.' });
      return false;
    }
    return true;
  };

  const requireStores = (res: Response): Stores | null => {
    if (!stores) {
      res.status(503).json({
        success: false,
        message: 'Database not configured; identity endpoints are unavailable.',
      });
      return null;
    }
    return stores;
  };

  app.post(
    '/admin/users',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = adminCreateUser.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const existing = await db.users.findByEmail(parsed.data.email);
      if (existing) {
        res.status(409).json({ success: false, message: 'A user with that email exists.' });
        return;
      }
      const user = await db.users.createWithOrganization(
        parsed.data.organizationName,
        parsed.data.email,
        parsed.data.displayName
      );
      res.status(201).json({ success: true, userId: user.id });
    })
  );

  app.post(
    '/admin/devices',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = adminCreateDevice.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const user = await db.users.findByEmail(parsed.data.userEmail);
      if (!user) {
        res.status(404).json({ success: false, message: 'No user with that email.' });
        return;
      }
      // The code is returned once and only its hash is stored.
      const enrollmentCode = generateEnrollmentCode();
      const device = await db.devices.createPending(
        user.id,
        sha256Hex(enrollmentCode),
        new Date(Date.now() + ENROLLMENT_CODE_TTL_MS)
      );
      res.status(201).json({ success: true, deviceId: device.id, enrollmentCode });
    })
  );

  app.post(
    '/admin/sites',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = adminCreateSite.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const site = await db.sites.create(
        parsed.data.organizationName,
        parsed.data.name,
        parsed.data.latitude ?? null,
        parsed.data.longitude ?? null
      );
      if (!site) {
        res.status(409).json({
          success: false,
          message: 'A site with that name exists in the organization.',
        });
        return;
      }
      res.status(201).json({ success: true, siteId: site.id });
    })
  );

  app.post(
    '/admin/hosts',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = adminCreateHost.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const enrollmentCode = generateEnrollmentCode();
      try {
        const host = await db.hosts.createPending(
          parsed.data.siteId,
          parsed.data.name,
          sha256Hex(enrollmentCode),
          new Date(Date.now() + ENROLLMENT_CODE_TTL_MS)
        );
        res.status(201).json({ success: true, hostId: host.id, enrollmentCode });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23503') {
          res.status(404).json({ success: false, message: 'No site with that id.' });
          return;
        }
        if (code === '23505') {
          res.status(409).json({ success: false, message: 'A host with that name exists at the site.' });
          return;
        }
        throw err;
      }
    })
  );

  app.post(
    '/hosts/enroll',
    enrollLimiter,
    wrap(async (req, res) => {
      const db = requireStores(res);
      if (!db) return;
      const parsed = enrollRequest.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const rawKey = Buffer.from(parsed.data.publicKey, 'base64');
      if (rawKey.length !== 32) {
        res.status(400).json({
          success: false,
          message: 'publicKey must be a base64-encoded raw Ed25519 public key (32 bytes).',
        });
        return;
      }
      const host = await db.hosts.enroll(sha256Hex(parsed.data.enrollmentCode), parsed.data.publicKey);
      if (!host) {
        res.status(400).json({ success: false, message: 'Invalid or expired enrollment code.' });
        return;
      }
      res.json({ success: true, hostId: host.id });
    })
  );

  app.post(
    '/devices/enroll',
    enrollLimiter,
    wrap(async (req, res) => {
      const db = requireStores(res);
      if (!db) return;
      const parsed = enrollRequest.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const rawKey = Buffer.from(parsed.data.publicKey, 'base64');
      if (rawKey.length !== 32) {
        res.status(400).json({
          success: false,
          message: 'publicKey must be a base64-encoded raw Ed25519 public key (32 bytes).',
        });
        return;
      }
      const device = await db.devices.enroll(
        sha256Hex(parsed.data.enrollmentCode),
        parsed.data.publicKey,
        parsed.data.platform ?? null
      );
      if (!device) {
        res.status(400).json({ success: false, message: 'Invalid or expired enrollment code.' });
        return;
      }
      res.json({ success: true, deviceId: device.id });
    })
  );

  app.post(
    '/nonces',
    wrap(async (req, res) => {
      const db = requireStores(res);
      if (!db) return;
      const parsed = nonceRequest.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      const { deviceId, timestamp, signature } = parsed.data;

      const device = await db.devices.getById(deviceId);
      if (!device || device.status !== 'active' || !device.publicKey) {
        res.status(401).json({ success: false, message: 'Unknown or inactive device.' });
        return;
      }
      const age = Math.abs(Date.now() - Date.parse(timestamp));
      if (!(age <= config.timestampToleranceMs)) {
        res.status(401).json({ success: false, message: 'Stale or future timestamp.' });
        return;
      }
      if (!verifyEd25519(device.publicKey, nonceSigningString(deviceId, timestamp), signature)) {
        res.status(401).json({ success: false, message: 'Invalid signature.' });
        return;
      }

      const nonce = generateNonce();
      await db.nonces.issue(
        device.id,
        sha256Hex(nonce),
        new Date(Date.now() + config.nonceTtlMs)
      );
      // Opportunistic housekeeping: drop nonces expired for over an hour.
      db.nonces
        .deleteExpired(60 * 60 * 1000)
        .catch((err: Error) => console.error('Nonce cleanup failed:', err.message));

      res.json({ success: true, nonce, expiresInMs: config.nonceTtlMs });
    })
  );

  app.post(
    '/validate-proximity',
    wrap(async (req, res) => {
      if (!stores) {
        if (!config.allowUnsignedValidation) {
          res.status(503).json({
            success: false,
            message:
              'Database not configured; validation requires enrolled devices. Set DATABASE_URL, or ALLOW_UNSIGNED_VALIDATION=true for a desk demo.',
          });
          return;
        }
        const parsed = unsignedValidation.safeParse(req.body);
        if (!parsed.success) return invalid(res, parsed.error.issues);
        const denial = evaluateProximity(config, parsed.data.metrics);
        console.warn(
          `UNSIGNED validation (dev mode) from "${parsed.data.deviceId}": ${denial ?? 'pass'}`
        );
        if (denial) {
          res.status(403).json({ success: false, message: denial });
          return;
        }
        res.json({ success: true, message: 'Proximity validation successful (unsigned dev mode).' });
        return;
      }

      const parsed = attestedValidation.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      const { envelope, attestation } = parsed.data;
      const { deviceId, nonce, signature, metrics } = envelope;

      // The audit row is written before the response goes out; a log failure
      // is reported but does not take validation down.
      let logHostId: string | null = null;
      let logSiteId: number | null = null;
      const record = async (success: boolean, errorMessage: string | null, deviceUuid?: string) => {
        try {
          await stores.logs.logValidation({
            deviceId,
            deviceUuid: deviceUuid ?? null,
            hostId: logHostId,
            siteId: logSiteId,
            success,
            errorMessage,
          });
        } catch (err) {
          console.error('Failed to record validation:', (err as Error).message);
        }
      };
      const deny = async (status: number, message: string, deviceUuid?: string) => {
        await record(false, message, deviceUuid);
        res.status(status).json({ success: false, message });
      };

      // The relaying host vouches first: an envelope that did not cross an
      // enrolled host's radio never reaches device verification.
      const host = await stores.hosts.getById(attestation.hostId);
      if (!host || host.status !== 'active' || !host.publicKey) {
        return deny(401, 'Unknown or inactive host.');
      }
      logHostId = host.id;
      logSiteId = host.siteId;

      const hostAge = Math.abs(Date.now() - Date.parse(attestation.timestamp));
      if (!(hostAge <= config.timestampToleranceMs)) {
        return deny(401, 'Stale or future host attestation.');
      }
      const attestString = hostAttestSigningString(
        attestation.hostId,
        attestation.timestamp,
        attestation.rssi,
        envelope
      );
      if (!verifyEd25519(host.publicKey, attestString, attestation.signature)) {
        return deny(401, 'Invalid host attestation signature.');
      }
      await stores.hosts
        .markSeen(host.id)
        .catch((err: Error) => console.error('Failed to update host last_seen:', err.message));

      const device = await stores.devices.getById(deviceId);
      if (!device) return deny(401, 'Unknown device.');
      if (device.status === 'revoked') return deny(403, 'Device is revoked.', device.id);
      if (device.status !== 'active' || !device.publicKey) {
        return deny(403, 'Device is not enrolled.', device.id);
      }

      // Claim before verifying: a bad signature burns the nonce, and parallel
      // replays lose the atomic race.
      const claimed = await stores.nonces.claim(sha256Hex(nonce), device.id);
      if (!claimed) {
        return deny(401, 'Invalid, expired, or already-used nonce.', device.id);
      }

      const signedString = validationSigningString(deviceId, nonce, metrics);
      if (!verifyEd25519(device.publicKey, signedString, signature)) {
        return deny(401, 'Invalid signature.', device.id);
      }

      await stores.devices
        .markSeen(device.id)
        .catch((err: Error) => console.error('Failed to update last_seen:', err.message));

      // Host-measured RSSI is authoritative when the radio reports it; the
      // phone's own reading remains advisory.
      const effectiveMetrics =
        attestation.rssi !== null ? { ...metrics, bluetoothRssi: attestation.rssi } : metrics;
      const denial = evaluateProximity(config, effectiveMetrics);
      if (denial) return deny(403, denial, device.id);

      await record(true, null, device.id);
      res.json({ success: true, message: 'Proximity validation successful.' });
    })
  );

  return app;
}
