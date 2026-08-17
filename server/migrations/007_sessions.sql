-- P1.8: single-use QR sessions. A successful validation mints one; the org's
-- scanning system redeems it exactly once within its window.
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid UUID NOT NULL REFERENCES devices(id),
  host_id UUID NOT NULL REFERENCES hosts(id),
  site_id BIGINT NOT NULL REFERENCES sites(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);
