import { readFileSync } from 'node:fs';
import path from 'node:path';

interface SharedUuids {
  serviceUuid: string;
  metricsCharacteristicUuid: string;
  resultCharacteristicUuid: string;
}

const uuids = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'shared', 'uuids.json'), 'utf8')
) as SharedUuids;

// bleno expects UUIDs as bare hex strings.
const strip = (uuid: string): string => uuid.replace(/-/g, '');

export const SERVICE_UUID = strip(uuids.serviceUuid);
export const METRICS_CHAR_UUID = strip(uuids.metricsCharacteristicUuid);
export const RESULT_CHAR_UUID = strip(uuids.resultCharacteristicUuid);
