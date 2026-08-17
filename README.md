# Proxies

**Low Energy Bluetooth QR Code Proximity Validator** — prove a person's phone is physically
on premises before allowing a QR-code action, using a BLE link between the phone and an
organization-controlled host machine, with a validation server deciding and logging every attempt.

Proxies is also the seed of something larger: the same pipeline (enrolled devices → signed
readings → gateway → store → rules) is being grown into a real-time sensing platform for
agriculture, waste management, factories, and water systems. The full review, fix plan, and
expansion roadmap live in [docs/ROADMAP.md](docs/ROADMAP.md) — that document is the living
plan and is updated as work lands.

## How it works today

```
mobile (Capacitor, BLE central)
   │  connects to the host's GATT service, writes metrics JSON,
   │  subscribes for the verdict
   ▼
host (Electron tray app, BLE peripheral via bleno)
   │  forwards metrics to the server (3s timeout), notifies the
   │  phone of the verdict, shows a live status window
   ▼
server (Express + zod)
   │  strict schema validation — missing signals are a denial, not a pass;
   │  threshold checks (BLE floor, optional Wi-Fi floor, optional GPS boundary)
   ▼
Postgres (validation_logs) — every attempt recorded when DATABASE_URL is set
```

The whole codebase is **TypeScript** (strict), Apache-2.0 licensed, and CI-checked
(lint, typecheck, tests, `npm audit`) on every push.

## Feature status

| Feature | Status |
| --- | --- |
| BLE proximity link (host advertises, phone submits metrics, verdict notified back) | Implemented — hardware smoke test pending |
| Threshold validation with strict input validation (no bypass-by-omission) | Implemented, unit-tested |
| Validation audit logging to Postgres | Implemented (`DATABASE_URL`) |
| Device enrollment: per-device Ed25519 keys, one-time codes, signed requests | Implemented (P1.2) |
| Host attestation: envelopes must cross an enrolled host's radio; host-measured RSSI is authoritative when present | Implemented (P1.4) |
| Wi-Fi / GPS as advisory fallback signals | Collected when available; assurance tiers in Phase 1 |
| Trustworthy proximity (host-measured RSSI, nonce challenge) | Phase 1 — see roadmap |
| Same-network proof (LAN-served token) | Phase 1 |
| QR scanning gated on a signed session token | Phase 1 |
| Sensor platform (MQTT ingest, TimescaleDB, rules, fleet mgmt) | Phase 2 |

## Repository layout

```
server/   Validation API — Express, zod, pg, vitest
host/     Desktop host — Electron, @stoprocent/bleno (BLE peripheral)
mobile/   Phone app — Capacitor + Vite (BLE central)
shared/   Cross-component constants (BLE service/characteristic UUIDs)
docs/     ROADMAP.md — living review, fix plan, and expansion plan
```

## Getting started

Node.js ≥ 20 everywhere.

### Server

```bash
cd server
npm install
cp .env.example .env   # adjust thresholds / site coords / DATABASE_URL
npm run dev            # or: npm run build && npm start
npm test
```

To persist validation logs, create a Postgres database (≥ 13), set
`DATABASE_URL` in `.env`, and run `npm run db:migrate` — migrations live in
[server/migrations](server/migrations) and are applied in order, tracked in
`schema_migrations`.

#### Enrolling a site, host, and device

Validation requires an enrolled device **and** an enrolled host: the server
only accepts envelopes wrapped in a host's signed attestation, so a validation
that never crossed an organization-controlled radio is rejected outright. With
`ADMIN_TOKEN` set, bootstrap in order — user, site, host, device:

```bash
curl -s -X POST localhost:3000/admin/users -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"organizationName":"Acme","email":"someone@acme.test","displayName":"Someone"}'
```

```bash
curl -s -X POST localhost:3000/admin/sites -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"organizationName":"Acme","name":"HQ","latitude":6.5244,"longitude":3.3792}'
```

```bash
curl -s -X POST localhost:3000/admin/hosts -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"siteId":1,"name":"front-desk"}'
```

Start the host once with `HOST_ENROLLMENT_CODE=<code>` in `host/.env` — it
generates its keypair, enrolls, and stores its identity in the Electron user
data directory; the code is single-use and can be removed afterwards.

```bash
curl -s -X POST localhost:3000/admin/devices -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"userEmail":"someone@acme.test"}'
```

The response contains a 24-hour, single-use `enrollmentCode`. In the mobile
app, open **Enrollment**, point it at the server's LAN URL, and enter the code
— the phone generates a non-extractable keypair and registers its public key.
From then on every validation is a two-step protocol: the phone requests a
**single-use nonce** (signed request, ±5 min timestamp window), then submits a
signed envelope `{deviceId, nonce, signature, metrics}` over BLE via the host.
Nonces expire after 2 minutes and die on first use, so captured envelopes
cannot be replayed. Unsigned requests are rejected (dev-only escape hatch:
`ALLOW_UNSIGNED_VALIDATION=true` with no database).

### Host (desktop)

```bash
cd host
npm install            # builds bleno's native module; needs Xcode CLT on macOS
npm start              # compiles TypeScript, then launches the tray app
```

Grant the app Bluetooth permission when prompted. Configuration via `host/.env`:
`SERVER_URL` (default `http://localhost:3000`), `HOST_NAME` (advertised BLE name).

BLE peripheral support in desktop Node is the known-weakest link (we use
`@stoprocent/bleno`, the actively maintained bleno fork); the roadmap moves the
radio to dedicated gateway hardware in Phase 2.

### Mobile

```bash
cd mobile
npm install
npm run dev            # web preview of the UI (BLE needs a real device)
```

To run on a device: `npm run build`, `npx cap add android` (or `ios`),
`npx cap sync`, then open the native project. Android requires the
`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` and location permissions; iOS requires
`NSBluetoothAlwaysUsageDescription`.

## Configuration (server)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | API port (host's `SERVER_URL` must match) |
| `RSSI_FLOOR_DBM` | `-70` | Weakest acceptable Bluetooth signal |
| `WIFI_FLOOR_DBM` | `-60` | Weakest acceptable Wi-Fi signal (checked only if reported) |
| `GPS_MAX_METERS` | `50` | Max distance from site (checked only if site is configured) |
| `SITE_LATITUDE` / `SITE_LONGITUDE` | unset | Site coordinates; unset disables the GPS check |
| `DATABASE_URL` | unset | Postgres connection; required for enrollment + audit logging |
| `ADMIN_TOKEN` | unset | Gates `/admin/*` (user + device bootstrap); unset disables them |
| `ALLOW_UNSIGNED_VALIDATION` | `false` | Dev-only: unsigned validation when no DB is configured |
| `TIMESTAMP_TOLERANCE_MS` | `300000` | Max signed-timestamp age on nonce requests |
| `NONCE_TTL_MS` | `120000` | Validity window of a single-use validation nonce |

## Security model — read this

The current implementation validates **phone-reported** signals. That is honest
telemetry but not proof: a device can misreport its own measurements. Treat the
current build as a demo of the pipeline, not a security control. Phase 1 of the
[roadmap](docs/ROADMAP.md) inverts the trust model (server-issued nonce delivered
over BLE, host-measured RSSI, per-device enrollment keys, TLS) — that is the
point at which a validation becomes evidence.

## Contributing

Delivery convention: **one PR per feature, per phase**, scoped to a single roadmap item.

1. Pick an item from [docs/ROADMAP.md](docs/ROADMAP.md) (e.g. `P1.3`) and branch as
   `p1.3-nonce-issuance`.
2. `npm run lint && npm run typecheck && npm test` in the packages you touched.
3. In the same PR, cite the finding IDs the change closes and flip their status in the
   roadmap.
4. Open the pull request — one feature, no drive-by scope.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
