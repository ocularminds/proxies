# Telemetry envelope

The canonical shape every reading takes on its way into the platform,
regardless of vertical (presence, soil moisture, bin fill, vibration bands,
water level) or transport (HTTPS batch today; MQTT in P2.2/P2.3).

## Batch (transport envelope)

```json
{
  "deviceId": "uuid — enrolled device (phone, sensor, or gateway)",
  "seq": 42,
  "timestamp": "2026-08-17T12:00:00.000Z",
  "signature": "base64 Ed25519 over the signing string below",
  "readings": [
    {
      "ts": "2026-08-17T11:59:58.000Z",
      "type": "soil_moisture_pct",
      "value": 31.4,
      "unit": "%",
      "battery": 87,
      "quality": "ok"
    }
  ]
}
```

- `seq` is strictly monotonic per device and claimed atomically server-side —
  a replayed or reordered batch is rejected (`SEQ_REPLAYED`).
- `timestamp` must be within the server's tolerance window (±5 min default).
- Max 500 readings per batch; `value` must be finite; reading `ts` may not be
  more than 5 minutes in the future.

**Signing string** (Ed25519, enrolled device key):

```
proxies-telemetry\n<deviceId>\n<seq>\n<timestamp>\n<sha256hex(canonicalJson(readings))>
```

`canonicalJson` = JSON with object keys sorted at every level, `undefined`
dropped (same function used across server, host, and mobile).

## Reading fields

| Field | Required | Notes |
| --- | --- | --- |
| `ts` | yes | Measurement time (ISO 8601); may lag `timestamp` for buffered uploads |
| `type` | yes | Metric name, snake_case with unit suffix (`temp_c`, `fill_pct`, `presence`) |
| `value` | yes | Finite number; booleans encode as 0/1 |
| `unit` | no | Display unit; the `type` suffix is the machine-readable one |
| `battery` | no | 0–100 (%) of the reporting device |
| `quality` | no | Sensor-defined flag (`ok`, `estimated`, `stale`) |

## Storage

`telemetry` — one row per reading, attributed to organization, site, and
device. Created as a TimescaleDB hypertable when the extension is available
(CI runs the Timescale image; plain Postgres works with the same schema and
indexes for dev and pilot scale). Retention and continuous aggregates are
deliberate follow-ups once real volumes exist.

## Presence is a stream too

A successful proximity validation emits `{type: "presence", value: 1}` for the
validated device at the attesting host's site — the original product is the
platform's first telemetry source (P2.10).
