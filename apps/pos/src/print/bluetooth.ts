// Direct Bluetooth printing (US036, architecture §6): BLE ESC/POS printers through Web Bluetooth
// (Chrome on Android and desktop). The receipt is sent as a raster image (escpos.ts in core).
// Classic-Bluetooth printers are not reachable from the web; they use browser print (RawBT).
import { chunkBytes } from '@naqdpos/core';
import { db } from '../db/schema.ts';

export const PRINTER_KEY = 'bluetooth_printer';

/** Services common BLE receipt printers expose for writing ESC/POS. */
export const PRINTER_SERVICES = [
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  0xff00,
  0xffe0,
] as const;

/** Bytes per write: small enough for any BLE MTU a printer negotiates. */
export const CHUNK_SIZE = 180;

export type PrintError = 'unsupported' | 'bluetooth_off' | 'not_found' | 'not_printer' | 'failed';

export class PrinterError extends Error {
  constructor(readonly reason: PrintError) {
    super(`Bluetooth printing: ${reason}`);
    this.name = 'PrinterError';
  }
}

export interface SavedPrinter {
  id: string;
  name: string | null;
}

export function bluetoothSupported(nav: Navigator = navigator): boolean {
  return typeof nav.bluetooth?.requestDevice === 'function';
}

export async function savedPrinter(): Promise<SavedPrinter | null> {
  return ((await db.meta.get(PRINTER_KEY))?.value as SavedPrinter | undefined) ?? null;
}

export async function forgetPrinter() {
  await db.meta.delete(PRINTER_KEY);
}

/**
 * The paired printer: the remembered one when the browser can return it without asking
 * (getDevices), otherwise the browser's chooser (one tap).
 */
async function findPrinter(nav: Navigator): Promise<BluetoothDevice> {
  const bluetooth = nav.bluetooth;
  if (!bluetooth) throw new PrinterError('unsupported');
  if (bluetooth.getAvailability && !(await bluetooth.getAvailability())) {
    throw new PrinterError('bluetooth_off');
  }
  const saved = await savedPrinter();
  if (saved && bluetooth.getDevices) {
    const known = (await bluetooth.getDevices()).find((d) => d.id === saved.id);
    if (known) return known;
  }
  try {
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...PRINTER_SERVICES],
    });
    await db.meta.put({ key: PRINTER_KEY, value: { id: device.id, name: device.name ?? null } });
    return device;
  } catch (error) {
    // The chooser was closed, or no printer was in range.
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new PrinterError('not_found');
    }
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new PrinterError('bluetooth_off');
    }
    throw new PrinterError('failed');
  }
}

async function writableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic> {
  for (const service of await server.getPrimaryServices()) {
    for (const c of await service.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
  }
  throw new PrinterError('not_printer');
}

/** Sends ESC/POS bytes to the printer in chunks. */
export async function printBytes(bytes: Uint8Array, nav: Navigator = navigator): Promise<void> {
  const device = await findPrinter(nav);
  if (!device.gatt) throw new PrinterError('not_printer');
  let server: BluetoothRemoteGATTServer;
  try {
    server = await device.gatt.connect();
  } catch {
    throw new PrinterError('not_found');
  }
  try {
    const target = await writableCharacteristic(server);
    for (const chunk of chunkBytes(bytes, CHUNK_SIZE)) {
      // Write with response where possible: printers drop data when written too fast.
      if (target.properties.write) await target.writeValue(chunk);
      else await target.writeValueWithoutResponse!(chunk);
    }
  } catch (error) {
    if (error instanceof PrinterError) throw error;
    throw new PrinterError('failed');
  } finally {
    server.disconnect();
  }
}
