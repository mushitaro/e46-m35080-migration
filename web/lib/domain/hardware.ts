/**
 * The bench wiring, as data.
 *
 * ONE source of truth for the pin map. The wiring diagram, the assembly guide
 * and docs/HARDWARE.md all describe the same eight connections; when the same
 * fact lives in three places, two of them go stale and the one someone reads is
 * whichever they happened to open.
 *
 * The M35080 is NOT the standard 25xx pinout - only VCC (pin 8) is where a
 * generic SO8 SPI EEPROM guide would put it. GND is pin 1, and there is no HOLD
 * pin. This table is the thing that stops that mistake.
 *
 * Wire colours are carried over from the reference sketch's own comments
 * (m35080_odometer_fix.ino), so a reader comparing this diagram against the
 * photographs in that repository sees the same colours on the same pins.
 */

export type PinRole = 'power' | 'ground' | 'signal' | 'unused';

export type ChipPin = {
  /** Physical pin number on the SO8 package. */
  pin: number;
  /** The datasheet's name for it. */
  name: string;
  /** What it does, in the reader's terms. */
  functionKey: 'vss' | 'cs' | 'wp' | 'miso' | 'nc' | 'sck' | 'mosi' | 'vcc';
  /** Arduino UNO pin, or null when nothing connects. */
  uno: string | null;
  /** Jumper colour - from the reference sketch's comments. */
  color: string | null;
  role: PinRole;
};

export const M35080_PINS: readonly ChipPin[] = [
  { pin: 1, name: 'VSS', functionKey: 'vss', uno: 'GND', color: '#3F3F46', role: 'ground' },
  { pin: 2, name: 'S', functionKey: 'cs', uno: 'D10', color: '#E4E4E7', role: 'signal' },
  { pin: 3, name: 'W', functionKey: 'wp', uno: 'D9', color: '#F97316', role: 'signal' },
  { pin: 4, name: 'Q', functionKey: 'miso', uno: 'D12', color: '#3B82F6', role: 'signal' },
  { pin: 5, name: 'NC', functionKey: 'nc', uno: null, color: null, role: 'unused' },
  { pin: 6, name: 'C', functionKey: 'sck', uno: 'D13', color: '#EAB308', role: 'signal' },
  { pin: 7, name: 'D', functionKey: 'mosi', uno: 'D11', color: '#22C55E', role: 'signal' },
  { pin: 8, name: 'VCC', functionKey: 'vcc', uno: '5V', color: '#EF4444', role: 'power' },
] as const;

/**
 * Passives that are easy to leave out and cause intermittent faults.
 *
 * Endpoints are NETS, not pin numbers: on a breadboard the decoupling cap goes
 * between the two power rails beside the chip, which is the same electrical
 * node as pins 8 and 1 but a different pair of holes. Describing it by pin
 * number is what produced a diagram with the parts drawn and nothing wired.
 */
export type Net = 'VCC' | 'GND' | 'S';

export type Passive = {
  id: 'decoupling' | 'cs-pullup';
  value: string;
  from: Net;
  to: Net;
};

export const PASSIVES: readonly Passive[] = [
  { id: 'decoupling', value: '0.1uF', from: 'VCC', to: 'GND' },
  { id: 'cs-pullup', value: '10k', from: 'S', to: 'VCC' },
] as const;

/**
 * Where the power actually comes from.
 *
 * The UNO is powered by the USB cable that also carries the serial link - there
 * is no separate supply to connect. Its "5V" header pin is an OUTPUT that feeds
 * the chip. Stated here because the diagram has to show the direction, and
 * because "do I connect 5V to the Arduino?" is the first thing anyone asks.
 */
export const POWER = {
  unoSuppliedBy: 'usb' as const,
  /** The 5V header pin sources current; nothing is fed into it. */
  fiveVoltPinIs: 'output' as const,
  railVolts: 5,
} as const;

/**
 * A breadboard's own wiring, which the diagram must make visible: five holes in
 * a column are one node, and each power rail is one node along its length.
 */
export const BREADBOARD = {
  holesPerColumnGroup: 5,
  railsAreHorizontal: true,
} as const;

/** Electrical limits worth stating on screen, not just in a datasheet. */
export const ELECTRICAL = {
  supplyMin: 4.5,
  supplyMax: 5.5,
  /** Budget, not a typical figure - the part draws a few mA. */
  currentBudgetMa: 10,
  spiMode: 0,
  /** The part is rated 5 MHz; the firmware runs 3 MHz, as the reference did. */
  maxClockHz: 5_000_000,
  firmwareClockHz: 3_000_000,
  bitOrder: 'MSB first',
} as const;

/**
 * Why a 3.3 V board needs level shifting.
 *
 * Stated as data so the UI can show it where the board is chosen, rather than
 * leaving it as prose someone scrolls past.
 */
export const VOLTAGE_WARNING = {
  /** Boards that cannot drive this chip directly. */
  incompatible: ['ESP32', 'ESP32-S3', 'RP2040 / Pico', 'STM32 (3.3V)'],
  reason: 'supply-min-45',
} as const;

/** The adapter the chip actually sits in. 150 mil, not 200. */
export const ADAPTER = {
  pitchMm: 1.27,
  /** The M35080 SO8 is the NARROW body. */
  widthMil: 150,
  wrongWidthMil: 200,
} as const;

/** Look up a pin by its datasheet name, for the diagram's highlight logic. */
export function pinByName(name: string): ChipPin | undefined {
  return M35080_PINS.find((p) => p.name === name);
}

/** The pins that actually get a jumper - everything except NC. */
export function connectedPins(): ChipPin[] {
  return M35080_PINS.filter((p) => p.uno !== null);
}
