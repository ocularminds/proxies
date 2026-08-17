-- P2.1/P2.4: the platform pivot. Devices become generic endpoints — phones
-- (user-bound), sensors and gateways (site-bound) — and telemetry gets its
-- time-series home. TimescaleDB is used when available; plain Postgres with
-- the same indexes otherwise.

ALTER TABLE devices
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'phone' CHECK (kind IN ('phone', 'sensor', 'gateway')),
  ADD COLUMN site_id BIGINT REFERENCES sites(id),
  ADD COLUMN name TEXT,
  ADD COLUMN last_telemetry_seq BIGINT;

ALTER TABLE devices
  ADD CONSTRAINT devices_owner_check CHECK (
    (kind = 'phone' AND user_id IS NOT NULL) OR (kind <> 'phone' AND site_id IS NOT NULL)
  );

-- One row per reading; the canonical envelope's storage shape.
CREATE TABLE telemetry (
  ts TIMESTAMPTZ NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  site_id BIGINT REFERENCES sites(id),
  device_uuid UUID NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT,
  battery DOUBLE PRECISION,
  quality TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hypertable when TimescaleDB is present; a caught failure means plain
-- Postgres, which the indexes below serve fine at pilot scale.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb unavailable; telemetry stays a plain table';
  END;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('telemetry', 'ts', if_not_exists => TRUE);
  END IF;
END $$;

CREATE INDEX idx_telemetry_device_ts ON telemetry (device_uuid, ts DESC);
CREATE INDEX idx_telemetry_org_type_ts ON telemetry (organization_id, type, ts DESC);
CREATE INDEX idx_telemetry_site_type_ts ON telemetry (site_id, type, ts DESC);
