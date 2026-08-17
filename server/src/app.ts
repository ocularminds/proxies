import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
  adminCreateDevice,
  adminCreateHost,
  adminCreateRule,
  adminCreateSite,
  adminCreateUser,
  attestedValidation,
  enrollRequest,
  nonceRequest,
  redeemRequest,
  telemetryBatch,
  unsignedValidation,
} from './schema';
import { evaluateProximity } from './evaluate';
import {
  generateEnrollmentCode,
  generateNonce,
  hostAttestSigningString,
  lanTokenSigningString,
  nonceSigningString,
  secretsEqual,
  sha256Hex,
  telemetrySigningString,
  validationSigningString,
  verifyEd25519,
} from './crypto';
import type { AppConfig } from './types';
import type { RuleRecord, Stores } from './stores';

export type AppRuntimeConfig = Omit<
  AppConfig,
  'port' | 'databaseUrl' | 'tlsCertPath' | 'tlsKeyPath'
>;

export interface AlertNotification {
  alertId: number;
  rule: RuleRecord;
  deviceUuid: string;
  readingTs: string;
  value: number;
}

export type Notifier = (notification: AlertNotification) => Promise<void>;

// Default delivery: the rule's webhook when it has one, loud console otherwise
// (SMS/WhatsApp adapters plug in here later).
const defaultNotifier: Notifier = async ({ rule, deviceUuid, readingTs, value }) => {
  const payload = {
    ruleId: rule.id,
    metricType: rule.metricType,
    op: rule.op,
    threshold: rule.threshold,
    deviceUuid,
    readingTs,
    value,
  };
  if (rule.webhookUrl) {
    const response = await fetch(rule.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`Webhook answered ${response.status}`);
    }
    return;
  }
  console.warn('ALERT:', JSON.stringify(payload));
};

export interface AppDeps {
  config: AppRuntimeConfig;
  stores: Stores | null;
  notifier?: Notifier;
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

export function createApp({ config, stores, notifier = defaultNotifier }: AppDeps): Express {
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

      // The code is returned once and only its hash is stored.
      const enrollmentCode = generateEnrollmentCode();
      const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);

      if ('userEmail' in parsed.data) {
        const user = await db.users.findByEmail(parsed.data.userEmail);
        if (!user) {
          res.status(404).json({ success: false, message: 'No user with that email.' });
          return;
        }
        const device = await db.devices.createPending(user.id, sha256Hex(enrollmentCode), expiresAt);
        res.status(201).json({ success: true, deviceId: device.id, enrollmentCode });
        return;
      }

      try {
        const device = await db.devices.createPendingForSite(
          parsed.data.siteId,
          parsed.data.kind,
          parsed.data.name ?? null,
          sha256Hex(enrollmentCode),
          expiresAt
        );
        res.status(201).json({ success: true, deviceId: device.id, enrollmentCode });
      } catch (err) {
        if ((err as { code?: string }).code === '23503') {
          res.status(404).json({ success: false, message: 'No site with that id.' });
          return;
        }
        throw err;
      }
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
        parsed.data.longitude ?? null,
        parsed.data.minTier
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
    '/admin/rules',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = adminCreateRule.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const org = await db.orgs.findByName(parsed.data.organizationName);
      if (!org) {
        res.status(404).json({ success: false, message: 'No organization with that name.' });
        return;
      }
      const rule = await db.rules.create({
        organizationId: org.id,
        siteId: parsed.data.siteId ?? null,
        deviceUuid: parsed.data.deviceId ?? null,
        metricType: parsed.data.metricType,
        op: parsed.data.op,
        threshold: parsed.data.threshold,
        webhookUrl: parsed.data.webhookUrl ?? null,
      });
      res.status(201).json({ success: true, ruleId: rule.id });
    })
  );

  app.get(
    '/admin/alerts',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const organizationName = String(req.query.organization ?? '');
      if (!organizationName) {
        res.status(400).json({ success: false, message: 'organization query param required.' });
        return;
      }
      const org = await db.orgs.findByName(organizationName);
      if (!org) {
        res.status(404).json({ success: false, message: 'No organization with that name.' });
        return;
      }
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      res.json({ success: true, alerts: await db.rules.listAlerts(org.id, limit) });
    })
  );

  // Signed telemetry batches from any enrolled endpoint — see docs/TELEMETRY.md.
  app.post(
    '/telemetry',
    wrap(async (req, res) => {
      const db = requireStores(res);
      if (!db) return;
      const parsed = telemetryBatch.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      const { deviceId, seq, timestamp, signature, readings } = parsed.data;

      const device = await db.devices.getById(deviceId);
      if (!device || device.status !== 'active' || !device.publicKey) {
        res
          .status(401)
          .json({ success: false, code: 'DEVICE_UNKNOWN', message: 'Unknown or inactive device.' });
        return;
      }
      const age = Math.abs(Date.now() - Date.parse(timestamp));
      if (!(age <= config.timestampToleranceMs)) {
        res
          .status(401)
          .json({ success: false, code: 'BATCH_STALE', message: 'Stale or future batch timestamp.' });
        return;
      }
      const maxFutureMs = Date.now() + 5 * 60 * 1000;
      if (readings.some((reading) => Date.parse(reading.ts) > maxFutureMs)) {
        res.status(400).json({
          success: false,
          code: 'READING_TS_FUTURE',
          message: 'Reading timestamps may not be in the future.',
        });
        return;
      }

      // Claim the seq before verifying — replays and reorders lose the race.
      const claimed = await db.devices.claimTelemetrySeq(device.id, seq);
      if (!claimed) {
        res.status(409).json({
          success: false,
          code: 'SEQ_REPLAYED',
          message: 'Batch seq must be strictly greater than the last accepted one.',
        });
        return;
      }
      const signedString = telemetrySigningString(deviceId, seq, timestamp, readings);
      if (!verifyEd25519(device.publicKey, signedString, signature)) {
        res
          .status(401)
          .json({ success: false, code: 'SIGNATURE_INVALID', message: 'Invalid signature.' });
        return;
      }
      if (device.organizationId === null) {
        res.status(403).json({
          success: false,
          code: 'DEVICE_UNATTRIBUTED',
          message: 'Device has no organization attribution.',
        });
        return;
      }

      const accepted = await db.telemetry.insertBatch(
        device.id,
        device.organizationId,
        device.siteId,
        readings
      );
      await db.devices
        .markSeen(device.id)
        .catch((err: Error) => console.error('Failed to update last_seen:', err.message));

      // Threshold rules: at most one alert per rule per batch.
      let alertsFired = 0;
      try {
        const types = [...new Set(readings.map((reading) => reading.type))];
        const activeRules = await db.rules.matching(
          device.organizationId,
          device.siteId,
          device.id,
          types
        );
        for (const rule of activeRules) {
          const hit = readings.find(
            (reading) =>
              reading.type === rule.metricType &&
              (rule.op === 'gt' ? reading.value > rule.threshold : reading.value < rule.threshold)
          );
          if (!hit) continue;
          const alert = await db.rules.createAlert(rule.id, device.id, hit.ts, hit.value);
          alertsFired += 1;
          try {
            await notifier({
              alertId: alert.id,
              rule,
              deviceUuid: device.id,
              readingTs: hit.ts,
              value: hit.value,
            });
            await db.rules.markDelivered(alert.id);
          } catch (err) {
            console.error('Alert delivery failed:', (err as Error).message);
          }
        }
      } catch (err) {
        console.error('Rule evaluation failed:', (err as Error).message);
      }

      res.json({ success: true, accepted, alertsFired });
    })
  );

  // The org's scanning system redeems a displayed QR session exactly once.
  app.post(
    '/sessions/redeem',
    wrap(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const db = requireStores(res);
      if (!db) return;
      const parsed = redeemRequest.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);

      const redeemed = await db.sessions.redeem(parsed.data.sessionId);
      if (!redeemed) {
        res
          .status(400)
          .json({ success: false, message: 'Unknown, expired, or already-redeemed session.' });
        return;
      }
      db.sessions
        .deleteExpired(60 * 60 * 1000)
        .catch((err: Error) => console.error('Session cleanup failed:', err.message));
      res.json({ success: true, ...redeemed });
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
          `UNSIGNED validation (dev mode) from "${parsed.data.deviceId}": ${denial?.code ?? 'pass'}`
        );
        if (denial) {
          res.status(403).json({ success: false, code: denial.code, message: denial.message });
          return;
        }
        res.json({ success: true, message: 'Proximity validation successful (unsigned dev mode).' });
        return;
      }

      const parsed = attestedValidation.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      const { envelope, attestation } = parsed.data;
      const { deviceId, nonce, lanToken, signature, metrics } = envelope;

      // The audit row is written before the response goes out; a log failure
      // is reported but does not take validation down.
      let logHostId: string | null = null;
      let logSiteId: number | null = null;
      let lanVerified = false;
      let tier: 'A' | 'B' | 'C' | null = null;
      const record = async (
        success: boolean,
        errorCode: string | null,
        errorMessage: string | null,
        deviceUuid?: string
      ) => {
        try {
          await stores.logs.logValidation({
            deviceId,
            deviceUuid: deviceUuid ?? null,
            hostId: logHostId,
            siteId: logSiteId,
            lanVerified,
            assuranceTier: tier,
            errorCode,
            success,
            errorMessage,
          });
        } catch (err) {
          console.error('Failed to record validation:', (err as Error).message);
        }
      };
      const deny = async (
        status: number,
        code: string,
        message: string,
        deviceUuid?: string
      ) => {
        await record(false, code, message, deviceUuid);
        res.status(status).json({ success: false, code, message });
      };

      // The relaying host vouches first: an envelope that did not cross an
      // enrolled host's radio never reaches device verification.
      const host = await stores.hosts.getById(attestation.hostId);
      if (!host || host.status !== 'active' || !host.publicKey) {
        return deny(401, 'HOST_UNKNOWN', 'Unknown or inactive host.');
      }
      logHostId = host.id;
      logSiteId = host.siteId;

      const hostAge = Math.abs(Date.now() - Date.parse(attestation.timestamp));
      if (!(hostAge <= config.timestampToleranceMs)) {
        return deny(401, 'HOST_ATTEST_STALE', 'Stale or future host attestation.');
      }
      const attestString = hostAttestSigningString(
        attestation.hostId,
        attestation.timestamp,
        attestation.rssi,
        envelope
      );
      if (!verifyEd25519(host.publicKey, attestString, attestation.signature)) {
        return deny(401, 'HOST_ATTEST_INVALID', 'Invalid host attestation signature.');
      }
      await stores.hosts
        .markSeen(host.id)
        .catch((err: Error) => console.error('Failed to update host last_seen:', err.message));

      // Same-network proof: a LAN token is optional, but a bad one is a hard
      // failure — an invalid proof is worse than none.
      if (lanToken !== undefined) {
        let parsedToken: { hostId?: string; issuedAt?: string; sig?: string };
        try {
          parsedToken = JSON.parse(Buffer.from(lanToken, 'base64').toString('utf8'));
        } catch {
          return deny(401, 'LAN_TOKEN_MALFORMED', 'Malformed same-network token.');
        }
        if (
          parsedToken.hostId !== host.id ||
          typeof parsedToken.issuedAt !== 'string' ||
          typeof parsedToken.sig !== 'string'
        ) {
          return deny(
            401,
            'LAN_TOKEN_MISMATCH',
            'Same-network token does not match the attesting host.'
          );
        }
        const tokenAge = Math.abs(Date.now() - Date.parse(parsedToken.issuedAt));
        if (!(tokenAge <= config.lanTokenTtlMs)) {
          return deny(401, 'LAN_TOKEN_EXPIRED', 'Expired same-network token.');
        }
        if (
          !verifyEd25519(
            host.publicKey,
            lanTokenSigningString(parsedToken.hostId, parsedToken.issuedAt),
            parsedToken.sig
          )
        ) {
          return deny(401, 'LAN_TOKEN_INVALID', 'Invalid same-network token signature.');
        }
        lanVerified = true;
      }

      const device = await stores.devices.getById(deviceId);
      if (!device) return deny(401, 'DEVICE_UNKNOWN', 'Unknown device.');
      if (device.status === 'revoked') {
        return deny(403, 'DEVICE_REVOKED', 'Device is revoked.', device.id);
      }
      if (device.status !== 'active' || !device.publicKey) {
        return deny(403, 'DEVICE_NOT_ENROLLED', 'Device is not enrolled.', device.id);
      }

      // Claim before verifying: a bad signature burns the nonce, and parallel
      // replays lose the atomic race.
      const claimed = await stores.nonces.claim(sha256Hex(nonce), device.id);
      if (!claimed) {
        return deny(401, 'NONCE_INVALID', 'Invalid, expired, or already-used nonce.', device.id);
      }

      const signedString = validationSigningString(deviceId, nonce, lanToken ?? null, metrics);
      if (!verifyEd25519(device.publicKey, signedString, signature)) {
        return deny(401, 'SIGNATURE_INVALID', 'Invalid signature.', device.id);
      }

      await stores.devices
        .markSeen(device.id)
        .catch((err: Error) => console.error('Failed to update last_seen:', err.message));

      // Achieved assurance: A = host-measured radio, B = same-network proof,
      // C = relay only. Site policy sets the floor.
      tier = attestation.rssi !== null ? 'A' : lanVerified ? 'B' : 'C';
      const site = await stores.sites.getById(host.siteId);
      const TIER_RANK = { A: 3, B: 2, C: 1 } as const;
      const minTier = site?.minTier ?? 'C';
      if (TIER_RANK[tier] < TIER_RANK[minTier]) {
        return deny(
          403,
          'TIER_BELOW_POLICY',
          `Assurance tier ${tier} is below this site's minimum (${minTier}).`,
          device.id
        );
      }

      // Per-site thresholds and coordinates override the global env config.
      const effectiveConfig = site
        ? {
            rssiFloorDbm: site.rssiFloorDbm,
            wifiFloorDbm: site.wifiFloorDbm,
            gpsMaxMeters: site.gpsMaxMeters,
            site: { latitude: site.latitude ?? NaN, longitude: site.longitude ?? NaN },
          }
        : config;

      // Host-measured RSSI is authoritative when the radio reports it; the
      // phone's own reading remains advisory.
      const effectiveMetrics =
        attestation.rssi !== null ? { ...metrics, bluetoothRssi: attestation.rssi } : metrics;
      const denial = evaluateProximity(effectiveConfig, effectiveMetrics);
      if (denial) return deny(403, denial.code, denial.message, device.id);

      await record(true, null, null, device.id);

      // Presence is the platform's first telemetry stream: every approved
      // validation lands in the same store as any sensor reading.
      if (device.organizationId !== null) {
        await stores.telemetry
          .insertBatch(device.id, device.organizationId, host.siteId, [
            { ts: new Date().toISOString(), type: 'presence', value: 1, unit: 'event' },
          ])
          .catch((err: Error) =>
            console.error('Failed to record presence telemetry:', err.message)
          );
      }

      // Mint the single-use QR session the host will display.
      let session: { id: string; expiresInMs: number } | null = null;
      try {
        const created = await stores.sessions.create(
          device.id,
          host.id,
          host.siteId,
          new Date(Date.now() + config.sessionTtlMs)
        );
        session = { id: created.id, expiresInMs: config.sessionTtlMs };
      } catch (err) {
        console.error('Failed to mint session:', (err as Error).message);
      }
      res.json({ success: true, message: 'Proximity validation successful.', tier, session });
    })
  );

  return app;
}
