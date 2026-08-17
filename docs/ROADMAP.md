# Proxies — Living Roadmap

> **This is the canonical plan.** It is reviewed and updated continuously: every PR that
> closes a finding or ships a roadmap item updates the matching status here **in the same PR**.
>
> **Last reviewed:** 2026-08-17 · **Current phase:** 1 (in progress) · **License:** Apache-2.0 everywhere

## Delivery workflow

- **One PR per feature, per phase.** Every work item below has an ID (`P1.3` = phase 1,
  feature 3). A PR implements exactly one item — no phase-sized dumps, no drive-by scope.
- Branch naming: `p<phase>.<n>-short-name` (e.g. `p1.3-nonce-issuance`).
- The PR description cites the finding IDs it closes (see the register below) and flips
  their status in this file.
- A phase is "done" when all its items are merged and its milestone's proof holds.

## Vision

Proxies started as a BLE proximity validator: prove the person is physically on premises
before a QR-code action. The expansion reframe: **presence is just the first sensor.**
The machinery a trustworthy presence check needs — enrolled devices with keys, signed
time-stamped readings, a gateway bridging radio to IP, a time-series store, rules that
trigger actions — is exactly what real-time sensing for **agriculture, waste management,
factories, and water systems** needs. So we build one platform (Phase 2) and ship
verticals as sensor kits + rule packs (Phase 3). The proximity product becomes the
platform's first application, never a fork.

## Product contract (from the original README)

| Promise | Status | Delivered by |
| --- | --- | --- |
| Network validation ("same network as the mobile device") | ✅ P1.7 — phone must fetch a host-signed token from the host's LAN-bound listener; verified server-side, logged per validation | done |
| BLE-measured proximity | ◐ link real (host advertises, phone submits, verdict notified) | P0 done · trust: P1.4 + P1.5 |
| Wi-Fi / GPS fallback when BLE unavailable | ✅ P1.11 — explicit tiers (A radio-measured · B same-network · C relay-only) with per-site minimum policy; fallback is scored, never silently equal | done |
| QR scanning gated on validation | ✅ P1.8 — approval mints a single-use 2-min session; host renders the QR; `/sessions/redeem` claims it atomically | done |
| Error reporting | ✅ P1.11 — structured error codes on every denial, surfaced to phone + host, logged (`error_code`) | done |
| GitHub Actions testing & deployment | ✅ lint + typecheck + tests + audit on every push | P0 done · deploy: Phase 2 |

## Findings register

From the August 2026 review ([published copy](https://claude.ai/code/artifact/70208cea-cbd9-4b50-955b-4ba857ffb27e)).
G = gap, S = security, P = performance. Statuses: ✅ fixed · ◐ partial · ⬜ open.

| ID | Finding | Sev | Status |
| --- | --- | --- | --- |
| G1 | `npm start` pointed at a nonexistent path | — | ✅ P0 |
| G2 | Four conflicting port numbers, no config | — | ✅ P0 (env config, default 3000) |
| G3 | Host crashed on wrong import; no package.json; missing tray icon | — | ✅ P0 |
| G4 | BLE bridge used nonexistent noble APIs | — | ✅ P0 (real GATT service; hardware smoke test = M1) |
| G5 | Both ends were BLE centrals — could never connect | — | ✅ P0 (host = peripheral via bleno, phone = central) |
| G6 | Mobile fragments didn't compile; no project scaffolding | — | ✅ P0 (Capacitor + Vite + strict TS) |
| G7 | Dead IPC wiring; no renderer; no QR UI | — | ✅ P1.8 — host renders the session QR; redemption by the org's scanner via `/sessions/redeem` |
| G8 | Database schema orphaned; nothing logged | — | ✅ P0 (pg store; set `DATABASE_URL`) |
| G9 | README described a fictional repo; MIT vs Apache-2.0 conflict | — | ✅ P0 (Apache-2.0 everywhere) |
| G10 | `geolib` used but never declared (found during fix) | — | ✅ P0 (inline haversine) |
| S1 | Every check skippable by omission | Crit | ✅ P0 (zod strict; required signals) |
| S2 | Phone attests its own proximity | Crit | ✅ P1.4 + P1.5 — enrolled host vouches for every envelope and attests its own windowed-median RSSI, which overrides the phone's claim; calibration + hardware verification = M1 |
| S3 | No users, devices, auth, or identity | Crit | ✅ P1.2 — Ed25519 device enrollment enforced on validation; interactive user auth deferred until a dashboard exists |
| S4 | SSRF via client-supplied `hostAddress` | High | ✅ P0 (probe removed) · registry: P1.6 |
| S5 | No replay protection or freshness | High | ✅ P1.3 — server-issued, device-bound, single-use nonces (2 min TTL, atomic claim); timestamp window guards nonce issuance |
| S6 | Host paired with any BLE device, broadcast its LAN IP | High | ◐ host no longer scans/connects out; peer auth: P1.9 |
| S7 | Plaintext everywhere (HTTP + BLE) | Med | ◐ P1.9 — server HTTPS supported (`TLS_CERT_PATH`/`TLS_KEY_PATH` or terminating proxy); BLE payload crypto deferred to gateway (P2.7) |
| S8 | Electron renderer had full Node access | Med | ✅ P0 (contextIsolation + sandbox + preload) |
| S9 | Unvalidated input crashed the server | Med | ✅ P0 (schema + guarded parse, tested) |
| S10 | Abandoned/unused/outdated dependencies; no lockfiles | Med | ✅ P0 (pruned, TS toolchain, lockfiles, audit in CI; `@abandonware/bleno` → maintained `@stoprocent/bleno` after tar advisory chain) · bleno exit: P2.7 |
| S11 | Config and site coordinates hardcoded | Low | ✅ P1.11 — per-site thresholds, coordinates, and tier policy resolved from the database per validation; env is the fallback |
| P1 | Unfiltered always-on BLE scan | High | ✅ P0 (host advertises; no scanning at all) |
| P2 | Outbound fetch with no timeout | High | ✅ P0 (probe removed; host→server 3 s timeout) |
| P3 | Single-sample RSSI noise → flaky verdicts | Med | ✅ P1.5 — host samples every 500 ms, attests the median of the last 10; hysteresis/calibration tuning with real hardware (M1) |
| P4 | No rate limiting | Med | ✅ P1.10 — per-IP budgets (global + stricter enroll), helmet, 10 kb body limit |
| P5 | Cold GPS fix per validation | Low | ◐ timeout + `maximumAge` set (P0) |
| P6 | No persistence/queue/scale story | Low | ⬜ Phase 2 |

## Phase 0 — Make it real ✅ (executed 2026-08-17)

Landed as the bootstrap change set (split or land as the four units below):

- **P0.1 server-rewrite** — TypeScript rebuild (`src/`, tsc build, vitest): env config,
  zod strict validation, required signals, inline haversine, 400/403/200 semantics,
  Postgres `validation_logs` store with console fallback, 10 unit tests.
- **P0.2 host-rewrite** — TypeScript Electron app: bleno GATT peripheral (real 128-bit
  UUIDs; metrics write + verdict notify), 3 s-timeout forwarding to the server, hardened
  windows (contextIsolation, sandbox, preload bridge), tray with generated template icon,
  live status window.
- **P0.3 mobile-scaffold** — real Capacitor + Vite + strict TS project: `BleClient` flow
  (initialize → filtered scan → connect → write metrics → await verdict notification),
  advisory Wi-Fi/GPS collection that omits rather than fakes missing signals.
- **P0.4 repo-truth** — truthful README, Apache-2.0 in LICENSE + all manifests, fixed
  `.gitignore`, committed lockfiles, shared UUID constants, GitHub Actions CI
  (lint + typecheck + tests + build + `npm audit` per package).

Owner decisions recorded: **TypeScript across the codebase** · **Apache-2.0 all through** ·
**PR per phase per feature**.

## Phase 1 — Fix the trust model (next)

Goal: a presence claim an auditor would accept. Measurement moves to the trusted side;
every message gains identity and freshness. Target: ~3–5 weeks.

| PR | Feature | Closes |
| --- | --- | --- |
| P1.1 ✅ | Schema expansion: `organizations`, `users`, `devices` (keys, enrollment state), `hosts`, `sites` (per-site thresholds/coords), indexed logs; migration runner + `npm run db:migrate`; Postgres service in CI | S3 ◐, S11 ◐ |
| P1.2 ✅ | Device enrollment: per-device Ed25519 keypair (non-extractable, WebCrypto/IndexedDB), bound to a user via one-time 24 h enrollment codes; validation requests become signed envelopes relayed over BLE; admin bootstrap endpoints; unsigned requests rejected by default | S3, S5 ◐ |
| P1.3 ✅ | Server-issued single-use nonces: signed `/nonces` requests, device-bound hashes, 2 min TTL, claim-before-verify (replays lose the atomic race); envelope timestamp retired | S5 |
| P1.4 ✅ | Host attestation: sites + hosts enroll (one-time codes, Ed25519); every validation must arrive as `{envelope, attestation}` — the host counter-signs the envelope hash + its measured RSSI; audit rows gain host + site; host-measured RSSI authoritative server-side | S2 ◐ |
| P1.5 ✅ | Host-measured RSSI: sampled every 500 ms per connection via `updateRssiAsync`, median of last 10 attested; graceful null on radios that don't report RSSI; TX-power calibration + hysteresis deferred to hardware tuning (M1) | S2, P3 |
| P1.6 | Host↔server persistent WebSocket registry (liveness without inbound probes) | S4 class |
| P1.7 ✅ | Same-network proof: host serves signed 2-min tokens on a LAN-bound listener (advertised via a BLE read characteristic); token bound into the device's signed envelope; invalid = hard fail, absent = logged (`lan_verified`), scored by P1.11 tiers | contract |
| P1.8 ✅ | QR gate: approval mints a DB-backed single-use session (2 min TTL) bound to device/host/site; host renders the QR (main-process generation, data-URL to renderer); `/sessions/redeem` claims atomically and returns user/device/site | contract, G7 |
| P1.9 ◐ | TLS on HTTP shipped (direct HTTPS via env certs, or terminating proxy + `TRUST_PROXY`). Remaining: app-layer crypto over BLE + peer gating — needs X25519 key material alongside the Ed25519 identities; scheduled with the gateway rework (P2.7), where the BLE surface is redesigned anyway | S6, S7 |
| P1.10 ✅ | Rate limiting (per-IP global budget + stricter enroll budget, RFC draft-7 headers, `TRUST_PROXY` switch) + helmet | P4 |
| P1.11 ✅ | Assurance tiers (A: host-measured radio · B: same-network proof · C: relay-only) with per-site `min_tier` policy; per-site thresholds/coords override env; structured error codes on every denial, logged (`assurance_tier`, `error_code`); tier returned on success | S11, contract |
| P1.12 | GPS attestation via Play Integrity / DeviceCheck (only if GPS stays load-bearing) | S2 residual |

Residual risk to document, not hide: **relay attacks** (two radios bridging host and a
distant phone). Mitigations escalate later: RTT bounds on the challenge, short nonce
windows, BT 6.0 channel sounding hardware, or an out-of-band tap for high-assurance actions.

## Phase 2 — The platform slice

Goal: three real sensor nodes reporting through a gateway into a dashboard with alerts,
multi-tenant from day one. Target: ~6–10 weeks to pilot-ready.

| PR | Feature |
| --- | --- |
| P2.1 | Canonical telemetry envelope `{tenant, site, device_id, ts, type, value, unit, seq, battery, fw, sig}` + shared types package |
| P2.2 | MQTT broker (Mosquitto → EMQX at scale) with mutual TLS; per-device certs reuse P1.2 enrollment |
| P2.3 | Ingest service: MQTT → TimescaleDB |
| P2.4 | TimescaleDB migration: hypertables, continuous aggregates, retention/downsampling |
| P2.5 | Rules engine (threshold + rate-of-change, per tenant) + alert delivery (SMS / WhatsApp / email) |
| P2.6 | Device registry & fleet health (last-seen, battery, firmware) |
| P2.7 | Gateway agent v1 on ESP32/Pi-class hardware: BLE + store-and-forward buffering, NTP, signed config — retires desktop-Node BLE (bleno) |
| P2.8 | Grafana provisioning + starter dashboards (no custom UI yet) |
| P2.9 | HTTPS batch ingest fallback for constrained links |
| P2.10 | Presence-as-telemetry: the original product emits the envelope; QR app becomes the platform's first consumer |

Design constraints held throughout: intermittent connectivity and solar/battery power are
first-class, not edge cases; alerts must reach a phone (SMS/WhatsApp), not just a dashboard.

## Phase 3 — Vertical kits

Each vertical = sensor kit + calibration profile + rule pack + dashboard preset on the
same platform. One PR series per vertical (`P3.A*` agriculture, `P3.W*` waste,
`P3.F*` factory, `P3.H2O*` water). ~4–8 weeks per pilot including hardware lead time.

| Vertical | Kit | Connectivity | Rule pack highlights |
| --- | --- | --- | --- |
| Agriculture | Soil moisture/temp, air temp/RH, leaf wetness, tank level, livestock BLE tags (presence reuse) | LoRaWAN → solar gateway; 5–15 min cadence | Irrigation triggers, frost/heat stress, geofence |
| Waste | Ultrasonic bin fill, tilt/tamper, fire-temp | NB-IoT / LTE-M per bin; hourly + event | Fill > 80 % → route list, fire spike, missed pickup |
| Factory | Vibration bands (ISO 10816), motor current, energy; Modbus/OPC-UA bridge; presence → safety zones | Wired/Ethernet; burst + edge feature extraction | Band thresholds, current anomaly, downtime, mustering |
| Water | Level, flow, pH/turbidity/TDS/chlorine, pump state | LoRa/cellular; 1–15 min + events | Tank low/high, quality out-of-band, dry-run, night-flow leak detection |

**Sequencing:** pick ONE pilot vertical, chosen by whoever will actually use it. Absent a
customer, bin fill-level or farm monitoring are the gentlest starts. Water adds a probe
recalibration ops burden; factory vibration needs the most edge compute. **Actuation
(e.g. pump control) requires a separate safety review** — signed commands, interlocks,
manual override — before any remote control ships.

## Milestones

| Milestone | Proves | Status |
| --- | --- | --- |
| M1 — Honest demo | Phone ↔ host ↔ server end-to-end on one desk; every attempt logged | Code complete; hardware smoke test pending |
| M2 — Secure presence MVP | Enrollment + nonce + host-measured RSSI + TLS | ⬜ Phase 1 |
| M3 — Platform slice | 3 nodes → gateway → MQTT → TimescaleDB → Grafana, one alert firing | ⬜ Phase 2 |
| M4 — First vertical pilot | Customer-shaped deployment (≈10 nodes, 1 site) running 30 days | ⬜ Phase 3 |
| M5 — Multi-tenant operation | Second vertical onboarded with zero platform forks | ⬜ Phase 3 |

## Review log

| Date | Entry |
| --- | --- |
| 2026-08-17 | Initial review published (gaps G1–G10, security S1–S11, performance P1–P6); plan created. |
| 2026-08-17 | Phase 0 executed: server/host/mobile rebuilt in strict TypeScript; SSRF removed; validation hardened + tested (10 tests); Electron hardened; CI added; Apache-2.0 standardized (owner decision); lockfiles committed. |
| 2026-08-17 | Delivery convention adopted (owner decision): one PR per feature per phase; roadmap statuses updated in the closing PR. |
| 2026-08-17 | CI's audit gate caught 8 production advisories (1 critical: `tar` ≤7.5.20) in `@abandonware/bleno`'s install chain (xpc-connect / bluetooth-hci-socket → node-gyp ≤10.3.1 → tar), with no fixed `tar` reachable from those parents. Host swapped to the maintained, API-compatible `@stoprocent/bleno` fork — production tree audits clean. |
| 2026-08-17 | PR #1 merged — Phase 0 complete. Phase 1 opened with P1.1: identity/site schema (`organizations`, `users`, `devices`, `hosts`, `sites`), indexed + extended `validation_logs`, numbered SQL migrations with a transactional runner (`npm run db:migrate`), and a Postgres service container in CI running a destructive migration integration test. |
| 2026-08-17 | P1.9 partially shipped: the server can serve HTTPS directly (`TLS_CERT_PATH`/`TLS_KEY_PATH`, e.g. mkcert in dev) or sit behind a terminating proxy with `TRUST_PROXY`. The BLE-payload-crypto half (app-layer AEAD + peer gating) deliberately waits for P2.7's gateway, which replaces the desktop BLE surface it would harden — building it twice serves nobody. |
| 2026-08-17 | P1.11 shipped: assurance tiers + per-site policy + error taxonomy. Each validation earns a tier — A (host-measured radio), B (same-network proof), C (relay-only) — checked against the site's `min_tier`; per-site thresholds and coordinates now override env config (S11 closed); every denial carries a structured code (HOST_*, LAN_TOKEN_*, DEVICE_*, NONCE_INVALID, SIGNATURE_INVALID, TIER_BELOW_POLICY, RSSI/WIFI/GPS codes) logged in `error_code` with the achieved tier in `assurance_tier`. |
| 2026-08-17 | P1.8 shipped: the QR gate the product was named for. A successful validation mints a DB-backed, single-use session (2 min TTL, bound to device/host/site); the host generates the QR in the main process and the status window displays it until expiry; `/sessions/redeem` (admin-token gated, for the org's scanning system) claims it atomically — replays and expired sessions answer 400 — returning user email, device, and site for the consuming system. |
| 2026-08-17 | P1.7 shipped: same-network proof. The host binds an HTTP listener to its LAN address only and serves signed 2-minute tokens; the phone learns the listener URL from a new BLE read characteristic, fetches a token, and binds it into its signed envelope (the signing string gained a LAN-token slot — literal `null` when absent). Server verifies host binding, freshness, and signature; invalid tokens deny hard, absent tokens are recorded as `lan_verified = false` for tier policy (P1.11). Note: the LAN URL is readable by any connected central (private-IP disclosure, accepted until P1.9/P2.7 peer gating). |
| 2026-08-17 | P1.10 shipped: helmet security headers plus per-IP rate limits — a global request budget and a stricter one on the code-burning enroll endpoints; `TRUST_PROXY` documented for reverse-proxy deployments. |
| 2026-08-17 | P1.5 shipped: the host now measures. While a central is connected the host samples connection RSSI every 500 ms (`updateRssiAsync`) and attests the median of the last 10 readings; radios that don't report RSSI degrade to a null attestation (phone value stays advisory). With P1.4's authority rule this completes the S2 inversion in code — remaining: calibration and hysteresis tuning against real hardware at M1. |
| 2026-08-17 | P1.4 shipped: host attestation. Sites and hosts get admin bootstrap + one-time-code enrollment (host identity persisted in Electron userData, private key on-machine). `/validate-proximity` now only accepts `{envelope, attestation}` where the enrolled host counter-signs `hostId + timestamp + rssi + sha256(envelope)` — an envelope that never crossed an enrolled host's radio is dead on arrival, and the phone can no longer reach the server alone. Audit rows now carry `host_id` and `site_id`. Server treats host-measured RSSI as authoritative over the phone's claim (sampling lands in P1.5 — `@stoprocent/bleno` exposes `updateRssiAsync`). |
| 2026-08-17 | P1.3 shipped: single-use nonces close S5. `/nonces` issues device-bound nonces against a signed request (timestamp-windowed); validation envelopes carry the nonce instead of a timestamp; the server claims the nonce atomically **before** signature verification, so replays and parallel spends fail; expired nonces are swept opportunistically. Next: P1.4 moves nonce delivery onto the BLE link as the proximity proof, with host-side signing. |
| 2026-08-17 | P1.2 shipped: device enrollment end to end. Server: admin bootstrap (`/admin/users`, `/admin/devices` behind `ADMIN_TOKEN`), one-time hashed enrollment codes, `/devices/enroll`, and `/validate-proximity` now accepts only Ed25519-signed envelopes (canonical-JSON signing string, ±5 min timestamp window as interim replay guard) from active devices — audit rows carry `device_uuid` and are written before responding. Mobile: non-extractable WebCrypto keypair in IndexedDB, enrollment UI, signed envelopes over BLE. Host: metrics characteristic assembles long writes (envelopes exceed one MTU on iOS). Unsigned validation now requires an explicit dev-only flag. |
