# Waste-bin node firmware (reference)

ESP32 reference implementation of the platform envelope
([docs/TELEMETRY.md](../../docs/TELEMETRY.md)) for the waste pilot:
Ed25519 identity in NVS, one-time-code enrollment, median-of-5 ultrasonic fill
sampling, canonical-JSON signing, strictly monotonic `seq` with
store-and-forward, deep sleep between cycles.

## Bench mode (default)

Desk-testable with any ESP32 devkit + JSN-SR04T against the compose stack:

1. `npm run provision` (see [docs/PILOTS/waste.md](../../docs/PILOTS/waste.md))
   and paste one enrollment code, your WiFi, and the server URL into
   `src/config.h`.
2. Wire TRIG→GPIO5, ECHO→GPIO18 (via divider — the echo pin is 5 V on many
   JSN-SR04T boards), 5 V, GND.
3. `pio run -t upload && pio run -t monitor` — the node enrolls on first boot,
   then reports every 30 s; watch it appear in `/admin/fleet` and on the
   Vertical Kit dashboard.

## Field build (the cellular swap point)

`#undef BENCH_MODE` deliberately fails the build at one marked `#error`: swap
`netUp()`/`httpPost()` for the cellular transport — TinyGSM
(`vshymanskyy/TinyGSM`) with a SIM70xx-class Cat-M1/NB-IoT modem, network time
from the modem instead of NTP, and `REPORT_INTERVAL_S` at 3600. Everything
else (identity, signing, buffering, seq) is transport-independent.

TLS: SIM70xx modems support TLS 1.2 via AT commands; alternatively run on a
private APN. Either way the envelope is signed and replay-protected at the
application layer — transport TLS adds confidentiality, not integrity.

## Sharp edges encoded here

- **Number formatting must match `JSON.stringify`**: values are rounded to
  2 dp and printed with trailing zeros stripped (`31.4`, never `31.40`), or
  device signatures won't verify.
- **Reading JSON keys are emitted in sorted order** (battery, ts, type, unit,
  value) to match the server's `canonicalJson`.
- **A 409 (`SEQ_REPLAYED`) after a lost ack means the batch was accepted** —
  advance `seq` and clear the buffer, don't resend.
- Calibrate `EMPTY_DISTANCE_CM` / `FULL_DISTANCE_CM` per bin at install.
- `readBatteryPct()` and tilt/temperature sensors are marked TODO hooks —
  wire them to the chosen board's divider/IMU/probe.
