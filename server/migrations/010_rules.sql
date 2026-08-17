-- P2.5: threshold rules and the alerts they raise. Scope narrows from
-- organization to site to device as the optional columns are set.
CREATE TABLE rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  site_id BIGINT REFERENCES sites(id),
  device_uuid UUID REFERENCES devices(id),
  metric_type TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('gt', 'lt')),
  threshold DOUBLE PRECISION NOT NULL,
  webhook_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rules_org_type ON rules (organization_id, metric_type) WHERE is_active;

CREATE TABLE alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES rules(id),
  device_uuid UUID NOT NULL REFERENCES devices(id),
  reading_ts TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_rule_time ON alerts (rule_id, created_at DESC);
