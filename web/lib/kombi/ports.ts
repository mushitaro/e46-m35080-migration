/**
 * Which serial ports TEST will not use.
 *
 * The UNO bridge and the K+DCAN cable are both USB serial ports, and the browser's picker shows
 * them side by side. The UNO talks to a chip on a breadboard; connected to a cluster it would be
 * the wrong device on a live K-line. So an Arduino's port is refused before it is opened - by its
 * USB vendor id, which the picker's own port carries. (The reverse mistake, the cable picked for
 * the bridge, is caught by the bridge's PING, which the cable cannot answer.)
 */

import type { SerialPortLike } from '@tsunagi/ds2-core';

/** Arduino LLC and Arduino SRL. */
export const ARDUINO_VENDOR_IDS: ReadonlySet<number> = new Set([0x2341, 0x2a03]);

export function isArduinoPort(port: Pick<SerialPortLike, 'getInfo'>): boolean {
  const vendor = port.getInfo?.().usbVendorId;
  return vendor !== undefined && ARDUINO_VENDOR_IDS.has(vendor);
}
