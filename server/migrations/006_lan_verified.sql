-- P1.7: whether the same-network proof (host-signed LAN token) was verified
-- for this validation.
ALTER TABLE validation_logs
  ADD COLUMN lan_verified BOOLEAN NOT NULL DEFAULT FALSE;
