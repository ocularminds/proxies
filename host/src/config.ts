import dotenv from 'dotenv';
import os from 'node:os';

dotenv.config();

export interface HostConfig {
  serverUrl: string;
  hostName: string;
  enrollmentCode: string | null;
}

const config: HostConfig = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  // Advertised BLE local name; kept short — advertising payloads cap at 26 bytes.
  hostName: (process.env.HOST_NAME || os.hostname()).slice(0, 20),
  // One-time code from an admin; consumed on first start, then ignored.
  enrollmentCode: process.env.HOST_ENROLLMENT_CODE || null,
};

export default config;
