// Minimal typings for @abandonware/bleno, which ships none.
declare module '@abandonware/bleno' {
  import { EventEmitter } from 'node:events';

  export interface CharacteristicOptions {
    uuid: string;
    properties: string[];
    value?: Buffer | null;
  }

  export class Characteristic {
    constructor(options: CharacteristicOptions);
    readonly RESULT_SUCCESS: number;
    readonly RESULT_ATTR_NOT_LONG: number;
    readonly RESULT_UNLIKELY_ERROR: number;
    onWriteRequest?(
      data: Buffer,
      offset: number,
      withoutResponse: boolean,
      callback: (result: number) => void
    ): void;
    onSubscribe?(maxValueSize: number, updateValueCallback: (data: Buffer) => void): void;
    onUnsubscribe?(): void;
  }

  export class PrimaryService {
    constructor(options: { uuid: string; characteristics: Characteristic[] });
  }

  interface Bleno extends EventEmitter {
    state: string;
    startAdvertising(
      name: string,
      serviceUuids?: string[],
      callback?: (error?: Error | null) => void
    ): void;
    stopAdvertising(callback?: () => void): void;
    setServices(services: PrimaryService[], callback?: (error?: Error | null) => void): void;
    disconnect(): void;
    Characteristic: typeof Characteristic;
    PrimaryService: typeof PrimaryService;
  }

  const bleno: Bleno;
  export default bleno;
}
