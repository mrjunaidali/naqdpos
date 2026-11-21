// The small part of Web Bluetooth the receipt printer uses (not in lib.dom; no extra package).
interface BluetoothRemoteGATTCharacteristic {
  readonly uuid: string;
  readonly properties: { readonly write: boolean; readonly writeWithoutResponse: boolean };
  writeValue(value: ArrayBufferView): Promise<void>;
  writeValueWithoutResponse?(value: ArrayBufferView): Promise<void>;
}

interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice {
  readonly id: string;
  readonly name?: string | undefined;
  readonly gatt?: BluetoothRemoteGATTServer | undefined;
}

interface RequestDeviceOptions {
  acceptAllDevices?: boolean;
  filters?: { services?: (string | number)[] }[];
  optionalServices?: (string | number)[];
}

interface Bluetooth {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
}

interface Navigator {
  readonly bluetooth?: Bluetooth;
}
