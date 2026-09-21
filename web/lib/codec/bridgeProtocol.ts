/**
 * Codec for the M35080 bridge protocol.
 *
 * PURE AND SELF-CONTAINED: frame building, parsing, CRC and failure
 * classification all run without a port, which is what makes them testable
 * offline (datalog-link.md -> Layering).
 *
 * Wire format (USB CDC is full-duplex, so there is no echo to strip):
 *
 *   request   SOF | CMD | LEN_lo LEN_hi | payload[LEN]          | CRC_lo CRC_hi
 *   response  SOF | CMD | STATUS | LEN_lo LEN_hi | payload[LEN] | CRC_lo CRC_hi
 *
 * CRC-16/CCITT-FALSE over every byte after SOF up to (not including) the CRC.
 * Frames are length-delimited rather than byte-stuffed; SOF exists so a
 * desynced stream can be re-hunted, and the CRC is what confirms the hunt.
 *
 * ENDIANNESS: every multi-byte field in THIS protocol is little-endian. The
 * chip itself wants big-endian addresses and counter values; the firmware does
 * that conversion at the single point where it talks SPI, so the host never
 * has to think about two orderings.
 */

export const SOF = 0x7e;
export const PROTOCOL_VERSION = 1;

export const Cmd = {
  PING: 0x01,
  RDSR: 0x02,
  WREN: 0x03,
  WRDI: 0x04,
  READ: 0x05,
  WRITE: 0x06,
  WRINC: 0x07,
  IDENTIFY: 0x08,
} as const;
export type CmdCode = (typeof Cmd)[keyof typeof Cmd];

export const Status = {
  OK: 0x00,
  ERR_CRC: 0x01,
  ERR_UNKNOWN_CMD: 0x02,
  ERR_LENGTH: 0x03,
  ERR_RANGE: 0x04,
  ERR_WRITE_DISABLED: 0x05,
  ERR_INC_REFUSED: 0x06,
  ERR_TIMEOUT: 0x07,
} as const;
export type StatusCode = (typeof Status)[keyof typeof Status];

/**
 * Is this failure worth re-sending the same bytes for?
 *
 * The rule from link-measurement-and-safety.md: retry the TRANSPORT failure,
 * never the SEMANTIC one. A CRC error or a bridge timeout means the exchange
 * did not land cleanly - re-sending is idempotent and correct. INC_REFUSED
 * means the chip received the write, tried it, and rejected it on its own
 * rules; re-sending that papers over the refusal and would report success.
 */
export function isRetriable(status: StatusCode): boolean {
  return status === Status.ERR_CRC || status === Status.ERR_TIMEOUT;
}

export function describeStatus(status: number): string {
  switch (status) {
    case Status.OK:
      return 'OK';
    case Status.ERR_CRC:
      return 'bridge rejected the frame checksum';
    case Status.ERR_UNKNOWN_CMD:
      return 'bridge does not implement this command';
    case Status.ERR_LENGTH:
      return 'payload length is wrong for this command';
    case Status.ERR_RANGE:
      return 'address or length falls outside the 1 KB image';
    case Status.ERR_WRITE_DISABLED:
      return 'write enable latch did not set - the chip is write-protected';
    case Status.ERR_INC_REFUSED:
      return 'chip refused the incremental write (value not greater than stored)';
    case Status.ERR_TIMEOUT:
      return 'chip never finished its write cycle';
    default:
      return `unknown bridge status 0x${status.toString(16)}`;
  }
}

/* ---------------------------------------------------------------------------
   Limits.

   These look like one number and are three. The read chunk is bounded by the
   bridge's RAM; the write chunk is bounded by the chip's 32-byte PAGE, because
   a page-crossing WRITE wraps within the page instead of advancing - it would
   silently corrupt data. They must never be merged into a shared constant.
   The firmware publishes its own values via PING and those win at runtime;
   these are the defaults and the safety ceiling.
   --------------------------------------------------------------------------- */

export const IMAGE_SIZE = 0x400; // 1024 bytes
export const PAGE_SIZE = 32; // M35080: 32 pages of 32 bytes
export const MAX_READ_CHUNK = 128; // bounded by bridge SRAM
export const MAX_WRITE_CHUNK = PAGE_SIZE; // bounded by the page, NOT by RAM
export const MAX_PAYLOAD = 192; // framing ceiling for either direction

/**
 * A load-time invariant beats a runtime throw: a constant only checked where it
 * is used would be checked AFTER the first byte is already on its way to the
 * chip. This runs at import, so an illegal constant cannot reach hardware.
 */
function assertChunkConstantsAreFlashSafe(): void {
  if (MAX_WRITE_CHUNK > PAGE_SIZE) {
    throw new Error(
      `MAX_WRITE_CHUNK (${MAX_WRITE_CHUNK}) exceeds the ${PAGE_SIZE}-byte page; a page-crossing write wraps and corrupts data`,
    );
  }
  if (PAGE_SIZE % MAX_WRITE_CHUNK !== 0) {
    throw new Error('MAX_WRITE_CHUNK must divide the page size evenly');
  }
  if (MAX_READ_CHUNK > MAX_PAYLOAD || MAX_WRITE_CHUNK + 2 > MAX_PAYLOAD) {
    throw new Error('chunk sizes must fit inside MAX_PAYLOAD');
  }
  if (IMAGE_SIZE % PAGE_SIZE !== 0) {
    throw new Error('image size must be a whole number of pages');
  }
}
assertChunkConstantsAreFlashSafe();

/** Split a write so that no chunk crosses a page boundary. */
export function splitWriteChunks(
  address: number,
  data: Uint8Array,
  maxChunk = MAX_WRITE_CHUNK,
): { address: number; data: Uint8Array }[] {
  const chunks: { address: number; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const addr = address + offset;
    const toPageEnd = PAGE_SIZE - (addr % PAGE_SIZE);
    const n = Math.min(maxChunk, toPageEnd, data.length - offset);
    chunks.push({ address: addr, data: data.subarray(offset, offset + n) });
    offset += n;
  }
  return chunks;
}

/* --------------------------------- CRC ---------------------------------- */

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/* ------------------------------- Framing -------------------------------- */

/** Bytes before the payload in a response: SOF, CMD, STATUS, LEN(2). */
export const RESPONSE_HEADER_SIZE = 5;

export function buildFrame(cmd: CmdCode, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > MAX_PAYLOAD) {
    throw new RangeError(`payload ${payload.length} exceeds MAX_PAYLOAD ${MAX_PAYLOAD}`);
  }
  const body = new Uint8Array(3 + payload.length);
  body[0] = cmd;
  body[1] = payload.length & 0xff;
  body[2] = (payload.length >> 8) & 0xff;
  body.set(payload, 3);

  const crc = crc16(body);
  const frame = new Uint8Array(1 + body.length + 2);
  frame[0] = SOF;
  frame.set(body, 1);
  frame[frame.length - 2] = crc & 0xff;
  frame[frame.length - 1] = (crc >> 8) & 0xff;
  return frame;
}

export type ResponseHeader = { cmd: number; status: number; length: number };

/** Read a 5-byte response header. Throws when it is not a frame at all. */
export function parseResponseHeader(head: Uint8Array): ResponseHeader {
  if (head.length < RESPONSE_HEADER_SIZE) {
    throw new Error(`short response header (${head.length} bytes)`);
  }
  if (head[0] !== SOF) {
    // Report the WHOLE header, not just the offending byte. "got 0x00" is the
    // same message whether the line is silent, the wrong baud, or a valid frame
    // one byte late - and those need different fixes.
    throw new Error(
      `out of frame: expected SOF 0x7E, got 0x${head[0].toString(16).padStart(2, '0')} ` +
        `(header bytes: ${hex(head.subarray(0, RESPONSE_HEADER_SIZE))})`,
    );
  }
  const length = head[3] | (head[4] << 8);
  if (length > MAX_PAYLOAD) {
    // Validate BEFORE trusting the length: a bogus length would otherwise
    // swallow the next response or stall a whole timeout.
    throw new Error(`response claims ${length} payload bytes, over the ${MAX_PAYLOAD} ceiling`);
  }
  return { cmd: head[1], status: head[2], length };
}

/** Verify the trailing CRC of a fully-received response. */
export function verifyResponseCrc(
  head: Uint8Array,
  payload: Uint8Array,
  crcBytes: Uint8Array,
): boolean {
  const body = new Uint8Array(4 + payload.length);
  body.set(head.subarray(1, 5), 0); // cmd, status, len_lo, len_hi
  body.set(payload, 4);
  const expected = crc16(body);
  const actual = crcBytes[0] | (crcBytes[1] << 8);
  return expected === actual;
}

/* --------------------------- Request builders --------------------------- */

const u16le = (v: number) => Uint8Array.from([v & 0xff, (v >> 8) & 0xff]);

export function pingRequest(): Uint8Array {
  return buildFrame(Cmd.PING);
}

export function rdsrRequest(): Uint8Array {
  return buildFrame(Cmd.RDSR);
}

export function identifyRequest(): Uint8Array {
  return buildFrame(Cmd.IDENTIFY);
}

export function readRequest(address: number, length: number): Uint8Array {
  assertInImage(address, length);
  if (length < 1 || length > MAX_READ_CHUNK) {
    throw new RangeError(`read length ${length} outside 1..${MAX_READ_CHUNK}`);
  }
  const p = new Uint8Array(4);
  p.set(u16le(address), 0);
  p.set(u16le(length), 2);
  return buildFrame(Cmd.READ, p);
}

export function writeRequest(address: number, data: Uint8Array): Uint8Array {
  assertInImage(address, data.length);
  if (data.length < 1 || data.length > MAX_WRITE_CHUNK) {
    throw new RangeError(`write length ${data.length} outside 1..${MAX_WRITE_CHUNK}`);
  }
  if (Math.floor(address / PAGE_SIZE) !== Math.floor((address + data.length - 1) / PAGE_SIZE)) {
    throw new RangeError(
      `write 0x${address.toString(16)}+${data.length} crosses a ${PAGE_SIZE}-byte page boundary`,
    );
  }
  const p = new Uint8Array(2 + data.length);
  p.set(u16le(address), 0);
  p.set(data, 2);
  return buildFrame(Cmd.WRITE, p);
}

/**
 * Validate a secure-register write before it can reach the chip.
 *
 * Exported because the PRACTICE mock calls it too. A mock that validates
 * somewhere else refuses the same action with different words - and then the
 * rehearsal has taught the user a workflow that behaves differently at the
 * bench. One guard, both paths.
 */
export function assertSecureRegisterWrite(address: number, value: number): void {
  if (address % 2 !== 0) {
    throw new RangeError(`WRINC address 0x${address.toString(16)} must be even (16-bit register)`);
  }
  assertInImage(address, 2);
  if (address > SECURE_END_ADDRESS) {
    throw new RangeError(`WRINC address 0x${address.toString(16)} is outside the secure area`);
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`WRINC value ${value} is not a u16`);
  }
}

export function wrincRequest(address: number, value: number): Uint8Array {
  assertSecureRegisterWrite(address, value);
  const p = new Uint8Array(4);
  p.set(u16le(address), 0);
  p.set(u16le(value), 2);
  return buildFrame(Cmd.WRINC, p);
}

function assertInImage(address: number, length: number): void {
  if (!Number.isInteger(address) || address < 0 || address + length > IMAGE_SIZE) {
    throw new RangeError(
      `0x${address.toString(16)}+${length} falls outside the ${IMAGE_SIZE}-byte image`,
    );
  }
}

/** Last address of the increment-only secure area. */
export const SECURE_END_ADDRESS = 0x1f;

/**
 * Validate an ENTIRE write range before the first byte goes out.
 *
 * Splitting into chunks and letting each chunk validate itself sends the
 * leading chunks and only then refuses - a partial write to a chip we had
 * already decided not to write. "Validate before touching the device at all"
 * means before the first byte, not before the last.
 */
export function assertWritableRange(address: number, length: number): void {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError('write length must be at least 1 byte');
  }
  assertInImage(address, length);
  if (address <= SECURE_END_ADDRESS) {
    throw new RangeError(
      `0x${address.toString(16)} is inside the secure area; that area is writable only through WRINC`,
    );
  }
}

/* --------------------------- Response decoders -------------------------- */

export type BridgeInfo = {
  magic: string;
  protocol: number;
  firmware: string;
  maxReadChunk: number;
  maxWriteChunk: number;
  pageSize: number;
  imageSize: number;
};

export const BRIDGE_MAGIC = 'M35080BR';

/**
 * Decode the PING reply.
 *
 * The bridge PUBLISHES ITS OWN LIMITS here and the host uses them instead of
 * assuming - "ask the device; do not infer it". A firmware built with a
 * smaller buffer stays correct without a host change.
 */
export function parsePing(payload: Uint8Array): BridgeInfo {
  if (payload.length < 19) {
    throw new Error(`PING reply too short (${payload.length} bytes)`);
  }
  const magic = Array.from(payload.subarray(0, 8))
    .map((b) => String.fromCharCode(b))
    .join('');
  if (magic !== BRIDGE_MAGIC) {
    throw new Error(`not an M35080 bridge (identifies as "${magic}")`);
  }
  const rd = (i: number) => payload[i] | (payload[i + 1] << 8);
  const info: BridgeInfo = {
    magic,
    protocol: payload[8],
    firmware: `${payload[9]}.${payload[10]}`,
    maxReadChunk: rd(11),
    maxWriteChunk: rd(13),
    pageSize: rd(15),
    imageSize: rd(17),
  };
  if (info.protocol !== PROTOCOL_VERSION) {
    throw new Error(
      `bridge speaks protocol v${info.protocol}, this app speaks v${PROTOCOL_VERSION}`,
    );
  }
  if (info.maxWriteChunk > info.pageSize) {
    throw new Error('bridge reports a write chunk larger than its page size');
  }
  return info;
}

export type IdentifyResult = { status: number; secure: Uint8Array };

export function parseIdentify(payload: Uint8Array): IdentifyResult {
  if (payload.length < 33) {
    throw new Error(`IDENTIFY reply too short (${payload.length} bytes)`);
  }
  return { status: payload[0], secure: payload.slice(1, 33) };
}

/** Format bytes for an error message. */
export function hex(bytes: Uint8Array, limit = 16): string {
  const shown = Array.from(bytes.subarray(0, limit))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
  return bytes.length > limit ? `${shown} ... (${bytes.length} bytes)` : shown;
}
