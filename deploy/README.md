# Deploy — one-box platform slice

Timescale-enabled Postgres, the validation/telemetry server (migrations applied
on boot), and Grafana pre-provisioned with the Proxies datasource and overview
dashboard.

```bash
cd deploy
ADMIN_TOKEN=$(openssl rand -base64 24) docker compose up -d --build
```

- Server: http://localhost:3000 (`/health`)
- Grafana: http://localhost:3001 (admin / `GRAFANA_ADMIN_PASSWORD`, default `admin`
  — change it) with the **Proxies Overview** dashboard: telemetry by metric,
  presence events, recent alerts, fleet last-seen.

The compose file is a pilot-scale scaffold: single box, no TLS termination.
For production put the server behind a TLS-terminating proxy (`TRUST_PROXY=true`)
or mount certs (`TLS_CERT_PATH`/`TLS_KEY_PATH`), and change both admin secrets.
