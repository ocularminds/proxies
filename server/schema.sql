CREATE TABLE validation_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  user_id INT,
  device_id VARCHAR(255),
  success BOOLEAN,
  error_message TEXT
);
