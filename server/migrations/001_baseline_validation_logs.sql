-- Baseline: the original validation_logs table. IF NOT EXISTS so dev databases
-- created from the pre-migration schema.sql adopt cleanly.
CREATE TABLE IF NOT EXISTS validation_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  user_id INT,
  device_id VARCHAR(255),
  success BOOLEAN,
  error_message TEXT
);
