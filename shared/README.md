# Shared constants

`uuids.json` holds the BLE identifiers for the Proxies GATT service:

- `serviceUuid` — the primary service the host advertises and the phone filters on.
- `metricsCharacteristicUuid` — write: the phone submits its proximity metrics as JSON.
- `resultCharacteristicUuid` — notify: the host pushes the server's validation verdict back.

The host loads this file directly. The mobile app keeps a mirrored copy in
`mobile/src/uuids.ts` (Vite cannot import outside its root by default) — if you
change a UUID here, change it there too.
