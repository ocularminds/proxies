-- P1.4: hosts enroll like devices — one-time hashed codes, cleared on success.
ALTER TABLE hosts
  ADD COLUMN enrollment_code_hash TEXT,
  ADD COLUMN enrollment_code_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_hosts_enrollment_code
  ON hosts (enrollment_code_hash)
  WHERE enrollment_code_hash IS NOT NULL;
