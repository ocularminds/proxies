-- P1.11: per-site assurance policy and structured error codes in the audit
-- trail. Tier A = host-measured radio, B = same-network proof, C = relay only.
ALTER TABLE sites
  ADD COLUMN min_tier TEXT NOT NULL DEFAULT 'C' CHECK (min_tier IN ('A', 'B', 'C'));

ALTER TABLE validation_logs
  ADD COLUMN error_code TEXT;
