-- P1.2: one-time, short-lived enrollment codes. Only the SHA-256 of a code is
-- stored; it is cleared when enrollment completes.
ALTER TABLE devices
  ADD COLUMN enrollment_code_hash TEXT,
  ADD COLUMN enrollment_code_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_devices_enrollment_code
  ON devices (enrollment_code_hash)
  WHERE enrollment_code_hash IS NOT NULL;
