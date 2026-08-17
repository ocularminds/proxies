-- P1.1: identity and site foundations (roadmap S3 partial, S11 partial).
-- Requires PostgreSQL >= 13 (gen_random_uuid).

CREATE TABLE organizations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-site thresholds replace one-global-config; NULL coordinates disable the
-- GPS boundary for that site.
CREATE TABLE sites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  rssi_floor_dbm INTEGER NOT NULL DEFAULT -70,
  wifi_floor_dbm INTEGER NOT NULL DEFAULT -60,
  gps_max_meters INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A device belongs to a user. public_key/enrolled_at are set when enrollment
-- completes (P1.2); status gates whether its claims are accepted at all.
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id),
  public_key TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  enrolled_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id BIGINT NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  public_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  enrolled_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);

-- Forward-path columns for the audit trail. The legacy user_id INT and
-- device_id VARCHAR stay unconstrained: logs must record attempts from
-- unknown/unenrolled devices too.
ALTER TABLE validation_logs
  ADD COLUMN device_uuid UUID REFERENCES devices(id),
  ADD COLUMN site_id BIGINT REFERENCES sites(id),
  ADD COLUMN host_id UUID REFERENCES hosts(id),
  ADD COLUMN assurance_tier TEXT;

CREATE INDEX idx_validation_logs_timestamp ON validation_logs (timestamp DESC);
CREATE INDEX idx_validation_logs_device_time ON validation_logs (device_id, timestamp DESC);
CREATE INDEX idx_validation_logs_site_time ON validation_logs (site_id, timestamp DESC);
CREATE INDEX idx_users_org ON users (organization_id);
CREATE INDEX idx_sites_org ON sites (organization_id);
CREATE INDEX idx_devices_user ON devices (user_id);
CREATE INDEX idx_hosts_site ON hosts (site_id);
