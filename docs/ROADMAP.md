# Proxies — Living Roadmap

> **This is the canonical plan.** It is reviewed and updated continuously: every PR that
> closes a finding or ships a roadmap item updates the matching status here **in the same PR**.
>
> **Last reviewed:** 2026-08-17 · **Current phase:** 0 → 1 · **License:** Apache-2.0 everywhere

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
| Network validation ("same network as the mobile device") | ❌ old SSRF probe removed; real proof pending | P1.7 (LAN-served token) |
| BLE-measured proximity | ◐ link real (host advertises, phone submits, verdict notified) | P0 done · trust: P1.4 + P1.5 |
| Wi-Fi / GPS fallback when BLE unavailable | ◐ collected as advisory; never faked | P1.11 (assurance tiers) |
| QR scanning gated on validation | ❌ not built yet | P1.8 (signed session tokens) |
| Error reporting | ◐ verdicts surfaced on phone + host; logged to Postgres | P1.11 (taxonomy) |
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
| G7 | Dead IPC wiring; no renderer; no QR UI | — | ◐ status UI wired (P0); QR UI in P1.8 |
| G8 | Database schema orphaned; nothing logged | — | ✅ P0 (pg store; set `DATABASE_URL`) |
| G9 | README described a fictional repo; MIT vs Apache-2.0 conflict | — | ✅ P0 (Apache-2.0 everywhere) |
| G10 | `geolib` used but never declared (found during fix) | — | ✅ P0 (inline haversine) |
| S1 | Every check skippable by omission | Crit | ✅ P0 (zod strict; required signals) |
| S2 | Phone attests its own proximity | Crit | ⬜ P1.4 + P1.5 |
| S3 | No users, devices, auth, or identity | Crit | ⬜ P1.1 + P1.2 |
| S4 | SSRF via client-supplied `hostAddress` | High | ✅ P0 (probe removed) · registry: P1.6 |
| S5 | No replay protection or freshness | High | ⬜ P1.3 |
| S6 | Host paired with any BLE device, broadcast its LAN IP | High | ◐ host no longer scans/connects out; peer auth: P1.9 |
| S7 | Plaintext everywhere (HTTP + BLE) | Med | ⬜ P1.9 |
| S8 | Electron renderer had full Node access | Med | ✅ P0 (contextIsolation + sandbox + preload) |
| S9 | Unvalidated input crashed the server | Med | ✅ P0 (schema + guarded parse, tested) |
| S10 | Abandoned/unused/outdated dependencies; no lockfiles | Med | ✅ P0 (pruned, TS toolchain, lockfiles, audit in CI) · bleno exit: P2.7 |
| S11 | Config and site coordinates hardcoded | Low | ◐ env-based (P0); sites table: P1.1 |
| P1 | Unfiltered always-on BLE scan | High | ✅ P0 (host advertises; no scanning at all) |
| P2 | Outbound fetch with no timeout | High | ✅ P0 (probe removed; host→server 3 s timeout) |
| P3 | Single-sample RSSI noise → flaky verdicts | Med | ⬜ P1.5 |
| P4 | No rate limiting | Med | ⬜ P1.10 (10 kb body limit done) |
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
| P1.1 | Schema expansion: `users`, `devices` (keys, enrollment state), `hosts`, `sites` (per-site thresholds/coords), indexed logs | S3, S11 |
| P1.2 | Device enrollment: per-device keypair at registration, bound to a user; signed requests; short-lived tokens | S3 |
| P1.3 | Server-issued single-use nonces with short TTL; signature + freshness verification | S5 |
| P1.4 | Nonce-over-BLE flow: phone must deliver the nonce across the radio link; host signs `{nonce, rssi, hostId, ts}` | S2 |
| P1.5 | Host-measured RSSI: windowed median over 5–10 samples, TX-power calibration, hysteresis at the floor | S2, P3 |
| P1.6 | Host↔server persistent WebSocket registry (liveness without inbound probes) | S4 class |
| P1.7 | Same-network proof: short-lived token served only on the host's LAN interface; phone fetches and returns it | contract |
| P1.8 | QR gate: signed short-lived session token bound to device + nonce; host unlock UI | contract, G7 |
| P1.9 | TLS on all HTTP; app-layer AES-GCM over BLE under enrolled keys; reject un-enrolled peers | S6, S7 |
| P1.10 | Rate limiting + helmet | P4 |
| P1.11 | Assurance tiers (A: BLE challenge–response · B: LAN token + attested GPS · C: deny) + error taxonomy, logged per decision | S1 class, contract |
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
