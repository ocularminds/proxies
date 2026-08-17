# Waste pilot runbook

The chosen pilot vertical (owner decision, 2026-08-17). Target: **M4** — a
customer-shaped deployment of ~10 bins at one zone, running 30 days.

## Architecture consequence

Waste bins are dispersed citywide, so this vertical uses **no shared radio
gateway**: each bin's sensor module speaks NB-IoT / LTE-M directly and submits
signed batches over HTTPS (`POST /telemetry`) or MQTT. The P2.7 gateway work
narrows, for this pilot, to **per-bin device firmware** implementing the
envelope in [docs/TELEMETRY.md](../TELEMETRY.md): Ed25519 keypair generated on
first boot, one-time-code enrollment, monotonic `seq`, store-and-forward when
the cell network drops.

## Hardware per bin (reference BOM)

| Part | Notes |
| --- | --- |
| Ultrasonic distance sensor (waterproof, e.g. JSN-SR04T class) | Measures headspace; mounted under the lid, pointing down |
| MCU + NB-IoT/LTE-M module (e.g. ESP32 + SIM70xx class, or integrated Cat-M1 board) | Must support Ed25519 signing (any modern MCU does) |
| Tilt/IMU (often on-board) | `tilt_deg` — knock-over/tamper |
| Temperature sensor | `temp_c` — fire early-warning |
| Battery (Li-SOCl₂ or Li-ion + cage) | Target years, not months: report hourly, sample locally more often |
| Theft-resistant mounting | Matters more than sensor spec — inside the lid, tamper screws |

SIM plan: one Cat-M1/NB-IoT SIM per bin; at hourly batches of ~1 KB, data cost
is negligible — the per-SIM platform fee dominates. Negotiate a fleet plan.

## Calibration (fill %)

Ultrasonic gives distance-to-surface. On installation, record per bin:

```
fill_pct = clamp( (empty_distance_cm - measured_cm)
                / (empty_distance_cm - full_distance_cm) ) × 100
```

- `empty_distance_cm`: sensor to bin floor (measured at install, empty bin)
- `full_distance_cm`: sensor to "full" line (typically 15–25 cm below sensor)
- **Median-of-5 samples on-device** before reporting — single ultrasonic reads
  lie on loose bags and heavy rain (kit field note).

## Installation flow (per bin)

1. Run provisioning once for the zone:
   `npm run provision -- --kit waste --org "<org>" --site "<zone>" --devices 10 --admin $ADMIN_TOKEN`
   → manifest CSV with one enrollment code per bin (single-use, 24 h expiry).
2. Flash firmware; on first boot the device generates its keypair and calls
   `POST /devices/enroll` with its code from the manifest.
3. Measure and store `empty_distance_cm` / `full_distance_cm` in the device.
4. Verify on the platform: the bin appears in `GET /admin/fleet` (online, with
   battery) and readings land on the **Vertical Kit** dashboard.

## Daily operation

- **Collection route**: `GET /admin/routes/waste?organization=<org>` — bins at
  ≥ 80 % (tunable via `threshold=`), fullest first. This list is the product.
- Alerts fire from the kit's rule pack: *Bin needs collection* (fill > 80),
  *Possible bin fire* (temp > 60 °C), *Bin knocked over* (tilt > 45°) — wire a
  webhook per rule or watch `GET /admin/alerts`.
- Fleet health (`/admin/fleet`) is the morning check: `stale` bins are dead
  batteries, vandalism, or SIM issues before they are missing data.

## 30-day acceptance criteria (M4)

- ≥ 95 % of expected hourly batches delivered per bin (seq gaps measure this)
- Fill trends visibly track collection cycles on the dashboard
- Collection-route list matches ground truth on spot checks (no phantom-full
  bins from bag/rain misreads — median filtering working)
- Zero silent bin deaths: every offline bin surfaced by fleet health within
  its staleness window
- Alert precision reviewed weekly; thresholds tuned per site, not in code

## Rehearsal without hardware

Three simulated bins streaming now:
`npm run simulate -- --kit waste --site <id> --admin $ADMIN_TOKEN --breach`
(run three in parallel; `--breach` forces one *Bin needs collection* alert).
