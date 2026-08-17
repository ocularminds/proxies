-- P1.3: single-use validation nonces (roadmap S5). Only the SHA-256 of a nonce
-- is stored; a claim sets used_at atomically so replays lose the race.
CREATE TABLE nonces (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nonce_hash TEXT NOT NULL UNIQUE,
  device_uuid UUID NOT NULL REFERENCES devices(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_nonces_expires ON nonces (expires_at);
