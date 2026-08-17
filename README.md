# Proxies

**Low Energy Bluetooth QR Code Proximity Validator** — prove a person's phone is physically
on premises before allowing a QR-code action, using a BLE link between the phone and an
organization-controlled host machine, with a validation server deciding and logging every attempt.

Proxies has grown past the QR product into its intended shape: a **real-time
sensing platform** where presence is the first stream among many — the same
pipeline (enrolled endpoints → signed readings → time-series store → rules →
alerts → dashboards) that agriculture, waste management, factory, and water
deployments need. The platform slice is **live and smoke-tested end to end**
(sensor enrollment → signed batches → Timescale hypertable → rule firing →
alert → Grafana). The living plan is [docs/ROADMAP.md](docs/ROADMAP.md),
updated in every PR that changes status.

## How it works today

```
mobile (BLE central)             sensors / gateways
   │ nonce + signed envelope        │ signed telemetry batches
   ▼                                ▼
host (Electron, BLE peripheral)  HTTPS POST /telemetry  or  MQTT proxies/telemetry/<id>
   │ measures RSSI (median),        │
   │ counter-signs + relays         │
   ▼                                ▼
server (Express + zod, TypeScript) — one transport-agnostic ingest pipeline
   │  enrollment (Ed25519) · single-use nonces · host attestation ·
   │  same-network proof · assurance tiers · threshold rules → alerts
   ▼
TimescaleDB (hypertable telemetry + audit tables) ──► Grafana dashboard
```

The whole codebase is **TypeScript** (strict), Apache-2.0 licensed, and CI-checked
(lint, typecheck, tests against Timescale-enabled Postgres, `npm audit`) on
every push. [deploy/](deploy/) boots the whole stack with one `docker compose up`.

## Feature status

| Feature | Status |
| --- | --- |
| BLE proximity link (host advertises, phone submits metrics, verdict notified back) | Implemented — hardware smoke test pending |
| Threshold validation with strict input validation (no bypass-by-omission) | Implemented, unit-tested |
| Validation audit logging to Postgres | Implemented (`DATABASE_URL`) |
| Device enrollment: per-device Ed25519 keys, one-time codes, signed requests | Implemented (P1.2) |
| Host attestation: envelopes must cross an enrolled host's radio; host-measured RSSI is authoritative when present | Implemented (P1.4) |
| Same-network proof: host-signed token served on its LAN-only listener | Implemented (P1.7) |
| QR scanning gated on validation: single-use session QR on the host, redeemed once | Implemented (P1.8) |
| Assurance tiers (A radio-measured · B same-network · C relay-only) with per-site minimum policy and per-site thresholds | Implemented (P1.11) |
| Structured error codes on every denial, logged with the achieved tier | Implemented (P1.11) |
| Telemetry platform: canonical signed envelope, Timescale hypertable storage, org/site/device attribution | Implemented (P2.1/P2.4) — live-verified |
| Sensor/gateway enrollment (site-bound) + HTTPS batch ingest with seq replay protection | Implemented (P2.9) |
| MQTT transport sharing the same ingest pipeline (`proxies/telemetry/<id>` + acks) | Implemented (P2.2/P2.3 v1) |
| Threshold rules → persisted alerts with pluggable delivery (webhook/console) | Implemented (P2.5 v1) |
| Fleet health (`/admin/fleet`): last-seen, battery, staleness for every device and host | Implemented (P2.6) |
| Presence as telemetry — validations land in the same stream as sensor data | Implemented (P2.10) |
| One-box deploy: Timescale + server + mosquitto + provisioned Grafana dashboard | Implemented (P2.8) — first boot verified |
| Vertical kits (agriculture · waste · factory · water): metric catalogs, labeled rule packs, `apply-kit`, simulator CLI, templated dashboard | Implemented (P3.0) |
| Gateway hardware, BLE payload crypto, retention/aggregates, SMS/WhatsApp | Remaining — see roadmap |

## Repository layout

```
server/   Validation + telemetry platform — Express, zod, pg, mqtt, vitest
host/     Desktop host — Electron, @stoprocent/bleno (BLE peripheral)
mobile/   Phone app — Capacitor + Vite (BLE central)
shared/   Cross-component constants (BLE service/characteristic UUIDs)
deploy/   One-box Docker Compose: Timescale, server, mosquitto, Grafana
docs/     ROADMAP.md (living plan) · TELEMETRY.md (canonical envelope)
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
From then on every validation is a three-step protocol: the phone requests a
**single-use nonce** (signed request, ±5 min timestamp window), collects a
**same-network token** from the host's LAN-only listener (advertised over BLE;
reachability of a LAN-bound address is the network proof), and submits a
signed envelope `{deviceId, nonce, lanToken?, signature, metrics}` over BLE.
The host wraps it in its own attestation. Nonces expire after 2 minutes and
die on first use; an invalid LAN token is a hard failure while an absent one
is recorded and scored by policy. Unsigned requests are rejected (dev-only
escape hatch: `ALLOW_UNSIGNED_VALIDATION=true` with no database).

On approval the server mints a **single-use QR session** (2 min TTL); the host
displays it, and the organization's scanning system redeems it exactly once:

```bash
curl -s -X POST localhost:3000/sessions/redeem -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"sessionId":"<uuid from the QR>"}'
```

### Host (desktop)

```bash
cd host
npm install            # builds bleno's native module; needs Xcode CLT on macOS
npm start              # compiles TypeScript, then launches the tray app
```

Grant the app Bluetooth permission when prompted. Configuration via `host/.env`:
`SERVER_URL` (default `http://localhost:3000`), `HOST_NAME` (advertised BLE
name), `HOST_LAN_PORT` (same-network token listener, default `47814`),
`HOST_ENROLLMENT_CODE` (one-time, first start only).

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

## One-box deployment

[deploy/](deploy/) has a Docker Compose scaffold — Timescale-enabled Postgres,
the server (migrations applied on boot), and Grafana pre-provisioned with the
Proxies Overview dashboard. See [deploy/README.md](deploy/README.md).

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
| `LAN_TOKEN_TTL_MS` | `120000` | Max age of a host-served same-network token |
| `SESSION_TTL_MS` | `120000` | Lifetime of a minted QR session before redemption |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `900000` / `300` | Per-IP request budget |
| `RATE_LIMIT_ENROLL_MAX` | `10` | Stricter per-IP budget on the enroll endpoints |
| `TRUST_PROXY` | `false` | Set behind a reverse proxy so limits see real client IPs |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | unset | Serve HTTPS directly (dev: mkcert); otherwise terminate TLS at a proxy |
| `MQTT_URL` | unset | Broker URL; when set, the bridge subscribes to `proxies/telemetry/+` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | unset | Broker credentials when it requires them |

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
