import { describe, it, expect } from 'vitest';
import {
  SOF,
  Cmd,
  Status,
  PAGE_SIZE,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  IMAGE_SIZE,
  BRIDGE_MAGIC,
  PROTOCOL_VERSION,
  RESPONSE_HEADER_SIZE,
  crc16,
  buildFrame,
  parseResponseHeader,
  verifyResponseCrc,
  splitWriteChunks,
  readRequest,
  writeRequest,
  wrincRequest,
  pingRequest,
  parsePing,
  parseIdentify,
  isRetriable,
  describeStatus,
} from '@/lib/codec/bridgeProtocol';

/** Build a response frame exactly the way the firmware does. */
function buildResponse(cmd: number, status: number, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body[0] = cmd;
  body[1] = status;
  body[2] = payload.length & 0xff;
  body[3] = (payload.length >> 8) & 0xff;
  body.set(payload, 4);
  const c = crc16(body);
  const frame = new Uint8Array(1 + body.length + 2);
  frame[0] = SOF;
  frame.set(body, 1);
  frame[frame.length - 2] = c & 0xff;
  frame[frame.length - 1] = (c >> 8) & 0xff;
  return frame;
}

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the standard check vector for "123456789"', () => {
    const data = Uint8Array.from(Array.from('123456789', (c) => c.charCodeAt(0)));
    expect(crc16(data)).toBe(0x29b1);
  });

  it('is empty-safe and returns the init value', () => {
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
  });

  it('detects a single flipped bit', () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 2, 3, 5]);
    expect(crc16(a)).not.toBe(crc16(b));
  });
});

describe('framing', () => {
  it('builds a request with SOF, cmd, little-endian length and CRC', () => {
    const f = buildFrame(Cmd.READ, Uint8Array.from([0x00, 0x01, 0x80, 0x00]));
    expect(f[0]).toBe(SOF);
    expect(f[1]).toBe(Cmd.READ);
    expect(f[2]).toBe(4); // len lo
    expect(f[3]).toBe(0); // len hi
    expect(f).toHaveLength(1 + 3 + 4 + 2);
  });

  it('round-trips a response through header + CRC verification', () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const frame = buildResponse(Cmd.READ, Status.OK, payload);
    const head = frame.subarray(0, RESPONSE_HEADER_SIZE);
    const h = parseResponseHeader(head);
    expect(h).toEqual({ cmd: Cmd.READ, status: Status.OK, length: 4 });
    const body = frame.subarray(RESPONSE_HEADER_SIZE, RESPONSE_HEADER_SIZE + h.length);
    const crcBytes = frame.subarray(RESPONSE_HEADER_SIZE + h.length);
    expect(verifyResponseCrc(head, body, crcBytes)).toBe(true);
  });

  it('detects a corrupted payload via CRC', () => {
    const frame = buildResponse(Cmd.READ, Status.OK, Uint8Array.from([1, 2, 3, 4]));
    frame[6] ^= 0xff; // flip a payload byte
    const head = frame.subarray(0, RESPONSE_HEADER_SIZE);
    const h = parseResponseHeader(head);
    const body = frame.subarray(RESPONSE_HEADER_SIZE, RESPONSE_HEADER_SIZE + h.length);
    const crcBytes = frame.subarray(RESPONSE_HEADER_SIZE + h.length);
    expect(verifyResponseCrc(head, body, crcBytes)).toBe(false);
  });

  it('rejects a header that does not start with SOF instead of guessing', () => {
    const bad = Uint8Array.from([0x00, 1, 0, 0, 0]);
    expect(() => parseResponseHeader(bad)).toThrow(/out of frame/);
  });

  it('validates the declared length BEFORE trusting it', () => {
    const bad = Uint8Array.from([SOF, Cmd.READ, Status.OK, 0xff, 0xff]);
    expect(() => parseResponseHeader(bad)).toThrow(/ceiling/);
  });
});

describe('page safety - the constant that can corrupt data', () => {
  it('caps the write chunk at the chip page size', () => {
    expect(MAX_WRITE_CHUNK).toBeLessThanOrEqual(PAGE_SIZE);
  });

  it('lets the read chunk be larger than a page (reads do not wrap)', () => {
    expect(MAX_READ_CHUNK).toBeGreaterThan(PAGE_SIZE);
  });

  it('splitWriteChunks never crosses a page boundary', () => {
    for (const start of [0x20, 0x2e8, 0x21, 0x3f0, 0x100]) {
      for (const len of [1, 5, 31, 32, 33, 64, 100]) {
        if (start + len > IMAGE_SIZE) continue;
        const chunks = splitWriteChunks(start, new Uint8Array(len).fill(0xaa));
        // reassembles exactly
        expect(chunks.reduce((n, c) => n + c.data.length, 0)).toBe(len);
        expect(chunks[0].address).toBe(start);
        for (const c of chunks) {
          expect(c.data.length).toBeLessThanOrEqual(MAX_WRITE_CHUNK);
          const firstPage = Math.floor(c.address / PAGE_SIZE);
          const lastPage = Math.floor((c.address + c.data.length - 1) / PAGE_SIZE);
          expect(firstPage).toBe(lastPage);
        }
        // chunks are contiguous
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i].address).toBe(chunks[i - 1].address + chunks[i - 1].data.length);
        }
      }
    }
  });

  it('writeRequest refuses a page-crossing write', () => {
    expect(() => writeRequest(0x3e, new Uint8Array(4))).toThrow(/page boundary/);
    expect(() => writeRequest(0x20, new Uint8Array(32))).not.toThrow();
  });

  it('writeRequest refuses an over-long chunk', () => {
    expect(() => writeRequest(0x20, new Uint8Array(MAX_WRITE_CHUNK + 1))).toThrow();
  });
});

describe('request builders validate before anything reaches the wire', () => {
  it('readRequest bounds address and length to the image', () => {
    expect(() => readRequest(0x3f0, 0x20)).toThrow(/outside/);
    expect(() => readRequest(0, MAX_READ_CHUNK + 1)).toThrow();
    expect(() => readRequest(0, MAX_READ_CHUNK)).not.toThrow();
  });

  it('wrincRequest requires an even address inside the secure area', () => {
    expect(() => wrincRequest(0x01, 1)).toThrow(/even/);
    expect(() => wrincRequest(0x20, 1)).toThrow(/secure area/);
    expect(() => wrincRequest(0x1e, 1)).not.toThrow();
  });

  it('wrincRequest bounds the value to a u16', () => {
    expect(() => wrincRequest(0x00, 0x10000)).toThrow();
    expect(() => wrincRequest(0x00, -1)).toThrow();
    expect(() => wrincRequest(0x00, 0xffff)).not.toThrow();
  });

  it('encodes WRINC address and value little-endian in the payload', () => {
    const f = wrincRequest(0x0a, 0x2613);
    // SOF, cmd, len_lo, len_hi, then payload
    expect(Array.from(f.subarray(4, 8))).toEqual([0x0a, 0x00, 0x13, 0x26]);
  });
});

describe('isRetriable - retry the transport failure, never the semantic one', () => {
  it('retries CRC and timeout', () => {
    expect(isRetriable(Status.ERR_CRC)).toBe(true);
    expect(isRetriable(Status.ERR_TIMEOUT)).toBe(true);
  });

  it('NEVER retries an incremental refusal', () => {
    expect(isRetriable(Status.ERR_INC_REFUSED)).toBe(false);
  });

  it('never retries a validation-class failure', () => {
    expect(isRetriable(Status.ERR_RANGE)).toBe(false);
    expect(isRetriable(Status.ERR_LENGTH)).toBe(false);
    expect(isRetriable(Status.ERR_UNKNOWN_CMD)).toBe(false);
    expect(isRetriable(Status.ERR_WRITE_DISABLED)).toBe(false);
  });

  it('describes every defined status without falling through', () => {
    for (const code of Object.values(Status)) {
      expect(describeStatus(code)).not.toMatch(/^unknown/);
    }
    expect(describeStatus(0x7f)).toMatch(/^unknown/);
  });
});

describe('parsePing - the bridge publishes its own limits', () => {
  function pingPayload(over: Partial<Record<string, number>> = {}): Uint8Array {
    const p = new Uint8Array(19);
    p.set(Uint8Array.from(Array.from(BRIDGE_MAGIC, (c) => c.charCodeAt(0))), 0);
    p[8] = (over.protocol as number) ?? PROTOCOL_VERSION;
    p[9] = 1;
    p[10] = 0;
    const put = (i: number, v: number) => {
      p[i] = v & 0xff;
      p[i + 1] = (v >> 8) & 0xff;
    };
    put(11, (over.maxReadChunk as number) ?? MAX_READ_CHUNK);
    put(13, (over.maxWriteChunk as number) ?? MAX_WRITE_CHUNK);
    put(15, (over.pageSize as number) ?? PAGE_SIZE);
    put(17, IMAGE_SIZE);
    return p;
  }

  it('decodes the advertised limits', () => {
    const info = parsePing(pingPayload());
    expect(info.magic).toBe(BRIDGE_MAGIC);
    expect(info.firmware).toBe('1.0');
    expect(info.maxReadChunk).toBe(MAX_READ_CHUNK);
    expect(info.maxWriteChunk).toBe(MAX_WRITE_CHUNK);
    expect(info.pageSize).toBe(PAGE_SIZE);
    expect(info.imageSize).toBe(IMAGE_SIZE);
  });

  it('refuses a device that is not our bridge', () => {
    const p = pingPayload();
    p[0] = 0x41;
    expect(() => parsePing(p)).toThrow(/not an M35080 bridge/);
  });

  it('refuses a protocol version mismatch rather than guessing', () => {
    expect(() => parsePing(pingPayload({ protocol: 99 }))).toThrow(/protocol/);
  });

  it('refuses a bridge whose write chunk exceeds its page size', () => {
    expect(() => parsePing(pingPayload({ maxWriteChunk: 64, pageSize: 32 }))).toThrow(
      /write chunk larger/,
    );
  });

  it('refuses a truncated reply', () => {
    expect(() => parsePing(new Uint8Array(4))).toThrow(/too short/);
  });

  it('pingRequest is a well-formed zero-payload frame', () => {
    const f = pingRequest();
    expect(f[0]).toBe(SOF);
    expect(f[1]).toBe(Cmd.PING);
    expect(f[2]).toBe(0);
  });
});

describe('parseIdentify', () => {
  it('splits the status byte from the 32-byte secure area', () => {
    const p = new Uint8Array(33);
    p[0] = 0x40;
    p.set(Uint8Array.from([0x26, 0x13]), 1);
    const r = parseIdentify(p);
    expect(r.status).toBe(0x40);
    expect(r.secure).toHaveLength(32);
    expect(Array.from(r.secure.subarray(0, 2))).toEqual([0x26, 0x13]);
  });

  it('refuses a truncated reply', () => {
    expect(() => parseIdentify(new Uint8Array(8))).toThrow(/too short/);
  });
});
