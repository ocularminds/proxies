import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import {
  adminCreateDevice,
  adminCreateUser,
  enrollRequest,
  unsignedValidation,
  validationEnvelope,
} from './schema';
import { evaluateProximity } from './evaluate';
import {
  generateEnrollmentCode,
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
    '/devices/enroll',
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

      const parsed = validationEnvelope.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      const { deviceId, timestamp, signature, metrics } = parsed.data;

      // The audit row is written before the response goes out; a log failure
      // is reported but does not take validation down.
      const record = async (success: boolean, errorMessage: string | null, deviceUuid?: string) => {
        try {
          await stores.logs.logValidation({
            deviceId,
            deviceUuid: deviceUuid ?? null,
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

      const device = await stores.devices.getById(deviceId);
      if (!device) return deny(401, 'Unknown device.');
      if (device.status === 'revoked') return deny(403, 'Device is revoked.', device.id);
      if (device.status !== 'active' || !device.publicKey) {
        return deny(403, 'Device is not enrolled.', device.id);
      }

      // Interim freshness window; single-use nonces land in P1.3.
      const age = Math.abs(Date.now() - Date.parse(timestamp));
      if (!(age <= config.timestampToleranceMs)) {
        return deny(401, 'Stale or future timestamp.', device.id);
      }

      const signedString = validationSigningString(deviceId, timestamp, metrics);
      if (!verifyEd25519(device.publicKey, signedString, signature)) {
        return deny(401, 'Invalid signature.', device.id);
      }

      await stores.devices
        .markSeen(device.id)
        .catch((err: Error) => console.error('Failed to update last_seen:', err.message));

      const denial = evaluateProximity(config, metrics);
      if (denial) return deny(403, denial, device.id);

      await record(true, null, device.id);
      res.json({ success: true, message: 'Proximity validation successful.' });
    })
  );

  return app;
}
