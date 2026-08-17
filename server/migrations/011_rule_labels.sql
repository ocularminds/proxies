-- P3.0: human-readable rule labels, so alerts read as operations language
-- ("Bin needs collection") rather than metric comparisons.
ALTER TABLE rules
  ADD COLUMN label TEXT;
