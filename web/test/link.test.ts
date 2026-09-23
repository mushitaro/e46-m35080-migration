import { describe, it, expect, beforeEach } from 'vitest';
import {
  WebSerialM35080Link,
  BridgeError,
  type M35080Link,
  type LinkTiming,
} from '@/lib/link/m35080Link';
import {
  M35080Simulator,
  ScriptedTransport,
  TEST_TIMING,
} from './support/m35080Simulator';
import {
  Cmd,
  Status,
  IMAGE_SIZE,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  PAGE_SIZE,
} from '@/lib/codec/bridgeProtocol';
import { encodeOdometer, decodeOdometer, readSecureSlots } from '@/lib/domain/odometer';
import { encodeVin } from '@/lib/domain/vin';

/** Where a real V6 chip carries its VIN. Not a constant in the app. */
const VIN_AT = 0x184;
import {
  planReset,
  planRepairStandard,
  planRestore,
  applyPlanPreview,
} from '@/lib/domain/operations';
import { diff } from '@/lib/domain/image';
import { planRewrite } from '@/lib/domain/operations';
import { readVins } from '@/lib/domain/vin';
import { checksumStatus } from '@/lib/domain/layout';
import { lateImage } from './support/lateImage';
import { slotsToBytes } from '@/lib/domain/odometer';

/**
 * Build a real link wired to the simulator.
 *
 * `private` is compile-time only in TypeScript, so the transport can be
 * swapped after construction - no seam has to exist in production code purely
 * for tests.
 */
function makeLink(sim: M35080Simulator, timing: Partial<LinkTiming> = {}) {
  const transport = new ScriptedTransport(sim);
  const link = new WebSerialM35080Link({} as never, { ...TEST_TIMING, ...timing });
  (link as unknown as { transport: ScriptedTransport }).transport = transport;
  return { link, transport };
}

async function connected(sim: M35080Simulator) {
  const { link, transport } = makeLink(sim);
  await link.connect();
  transport.clearTrace();
  return { link, transport };
}

describe('connect / PING', () => {
  /* The bench failure: "out of frame: expected SOF 0x7E, got 0x00". The
     firmware hunts for SOF and PROTOCOL.md says the stream may be re-hunted,
     but the host threw on the first stray byte - so ordinary noise around the
     UNO's DTR auto-reset made a working bridge look broken. */
  it('re-hunts for SOF when stray bytes arrive before the reply', async () => {
    /* attempts: 1 is load-bearing. With the normal 3, a retry PURGES the line
       and the second reply arrives clean - which is exactly how this defect
       hid for so long, and why the first version of this test passed against
       the broken code. One attempt isolates the parser from the retry. */
    const { link, transport } = makeLink(new M35080Simulator(), { attempts: 1 });
    transport.queueFault({ kind: 'prefix', bytes: [0x00, 0x00, 0x00] });
    const info = await link.connect();
    expect(info.magic).toBe('M35080BR');
  });

  it('still gives up, with the bytes in hand, when nothing resembles a frame', async () => {
    const { link, transport } = makeLink(new M35080Simulator());
    // Faulted on every attempt, so a retry cannot quietly rescue it.
    transport.queueFault(
      ...Array.from({ length: 6 }, () => ({
        kind: 'prefix' as const,
        bytes: Array<number>(400).fill(0x00),
      })),
    );
    // Match the NEW message specifically: the old parser said "expected SOF",
    // so asserting only /out of frame/ would pass against the broken code too.
    await expect(link.connect()).rejects.toThrow(/with no SOF/);
  });

  it('identifies the bridge and reads its published limits', async () => {
    const { link } = makeLink(new M35080Simulator());
    const info = await link.connect();
    expect(info.magic).toBe('M35080BR');
    expect(info.maxReadChunk).toBe(MAX_READ_CHUNK);
    expect(info.maxWriteChunk).toBe(MAX_WRITE_CHUNK);
    expect(info.pageSize).toBe(PAGE_SIZE);
    expect(link.connected).toBe(true);
  });

  it('reports not-connected after disconnect', async () => {
    const { link } = makeLink(new M35080Simulator());
    await link.connect();
    await link.disconnect();
    expect(link.connected).toBe(false);
    expect(link.getInfo()).toBeNull();
  });
});

describe('reading', () => {
  it('reads the whole 1 KB image in read-chunk-sized exchanges', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link, transport } = await connected(sim);

    const image = await link.readImage();
    expect(image).toHaveLength(IMAGE_SIZE);
    expect(Array.from(image)).toEqual(Array.from(sim.memory));

    // The count proves which constant was used: 1024 / 128 = 8.
    expect(transport.countOf(Cmd.READ)).toBe(IMAGE_SIZE / MAX_READ_CHUNK);
  });

  it('decodes the odometer the simulator was built with', async () => {
    const sim = new M35080Simulator({ km: 242_680 });
    const { link } = await connected(sim);
    const image = await link.readImage();
    const d = decodeOdometer(image.slice(0, 32));
    expect(d.ok && d.km).toBe(242_680);
  });

  it('identify returns the status and the secure area', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link } = await connected(sim);
    const r = await link.identify();
    expect(r.status.uv).toBe(true); // blank chip reports erased
    expect(r.secure).toHaveLength(32);
    expect(Array.from(r.secure).every((b) => b === 0)).toBe(true);
  });

  it('reads a used chip as not-erased', async () => {
    const { link } = await connected(new M35080Simulator({ km: 100_000 }));
    expect((await link.readStatus()).uv).toBe(false);
  });
});

describe('writing the standard array', () => {
  it('splits into page-sized chunks and never crosses a page', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link, transport } = await connected(sim);

    const data = new Uint8Array(64).fill(0x5a);
    await link.writeBytes(0x100, data);

    // 64 bytes at a 32-byte write chunk = 2 exchanges. If the READ chunk
    // (128) had leaked into the write path this would be 1.
    expect(transport.countOf(Cmd.WRITE)).toBe(64 / MAX_WRITE_CHUNK);
    expect(Array.from(sim.memory.subarray(0x100, 0x140))).toEqual(Array.from(data));
  });

  it('writes the VIN and reads it back', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link } = await connected(sim);
    await link.writeAndVerify(VIN_AT, encodeVin('KP83884'));
    const back = sim.memory.subarray(VIN_AT, VIN_AT + 7);
    expect(String.fromCharCode(...back)).toBe('KP83884');
  });

  it('writeAndVerify issues the writes THEN the read-back', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link, transport } = await connected(sim);
    await link.writeAndVerify(0x200, new Uint8Array(32).fill(0x11));

    const cmds = transport.cmds();
    const lastWrite = cmds.lastIndexOf(Cmd.WRITE);
    const firstRead = cmds.indexOf(Cmd.READ);
    expect(firstRead).toBeGreaterThan(lastWrite); // verify comes after the write
  });

  it('the bridge refuses a plain WRITE into the secure area', async () => {
    const { link } = await connected(new M35080Simulator({ blank: true }));
    await expect(link.writeBytes(0x00, new Uint8Array(2))).rejects.toThrow();
  });

  it('a verify mismatch throws and is NOT retried into success', async () => {
    const sim = new M35080Simulator({ blank: true });
    sim.swallowWrites = true; // chip accepts the bytes but stores nothing
    const { link, transport } = await connected(sim);

    await expect(link.writeAndVerify(0x200, new Uint8Array(32).fill(0x11))).rejects.toThrow(
      /Verify failed/,
    );
    // exactly one write attempt - a semantic failure must not be re-sent
    expect(transport.countOf(Cmd.WRITE)).toBe(1);
  });
});

describe('the secure area - the destructive path', () => {
  it('raises a register and stores the new value', async () => {
    const sim = new M35080Simulator({ km: 100_000 });
    const { link } = await connected(sim);
    const before = readSecureSlots(sim.memory.slice(0, 32))[0];
    await link.writeSecure(0x00, before + 1);
    expect(readSecureSlots(sim.memory.slice(0, 32))[0]).toBe(before + 1);
  });

  it('REFUSES a decrement, and sends it exactly once', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link, transport } = await connected(sim);
    const current = readSecureSlots(sim.memory.slice(0, 32))[0];

    await expect(link.writeSecure(0x00, current - 1)).rejects.toThrow(BridgeError);
    // The refusal is SEMANTIC. Re-sending would paper over it, so the retry
    // loop must not fire: exactly one telegram.
    expect(transport.countOf(Cmd.WRINC)).toBe(1);
  });

  it('refuses an equal value too (the chip needs strictly greater)', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link } = await connected(sim);
    const current = readSecureSlots(sim.memory.slice(0, 32))[0];
    await expect(link.writeSecure(0x00, current)).rejects.toThrow(/not greater/);
  });

  it('surfaces the refusal as a non-retriable BridgeError', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link } = await connected(sim);
    try {
      await link.writeSecure(0x00, 1);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError);
      expect((e as BridgeError).status).toBe(Status.ERR_INC_REFUSED);
      expect((e as BridgeError).retriable).toBe(false);
    }
  });

  it('walks a blank chip up to a target mileage', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link } = await connected(sim);
    const target = encodeOdometer(1_234);
    for (let slot = 0; slot < 16; slot++) {
      if (target[slot] > 0) await link.writeSecure(slot << 1, target[slot]);
    }
    expect(decodeOdometer(sim.memory.slice(0, 32))).toMatchObject({ ok: true, km: 1_234 });
  });
});

describe('guards run before anything reaches the device', () => {
  it('an odd WRINC address never produces a telegram', async () => {
    const { link, transport } = await connected(new M35080Simulator());
    await expect(link.writeSecure(0x01, 5)).rejects.toThrow(/even/);
    expect(transport.trace).toHaveLength(0); // the guard path leaves it empty
  });

  it('a WRINC outside the secure area never produces a telegram', async () => {
    const { link, transport } = await connected(new M35080Simulator());
    await expect(link.writeSecure(0x20, 5)).rejects.toThrow(/secure area/);
    expect(transport.trace).toHaveLength(0);
  });

  it('an out-of-image read never produces a telegram', async () => {
    const { link, transport } = await connected(new M35080Simulator());
    await expect(link.writeBytes(0x3ff, new Uint8Array(8))).rejects.toThrow(/outside/);
    expect(transport.trace).toHaveLength(0);
  });
});

describe('retry policy - transport yes, semantic no', () => {
  it('retries a timeout and succeeds on a later attempt', async () => {
    const sim = new M35080Simulator({ km: 100_000 });
    const { link, transport } = await connected(sim);
    transport.queueFault({ kind: 'timeout' }); // first attempt gets no reply

    const status = await link.readStatus();
    expect(status.uv).toBe(false);
    expect(transport.countOf(Cmd.RDSR)).toBe(2); // one lost, one good
  });

  it('retries a corrupted response', async () => {
    const sim = new M35080Simulator({ km: 100_000 });
    const { link, transport } = await connected(sim);
    transport.queueFault({ kind: 'badcrc' });

    await link.readStatus();
    expect(transport.countOf(Cmd.RDSR)).toBe(2);
  });

  it('gives up after the configured number of attempts', async () => {
    const sim = new M35080Simulator();
    const { link, transport } = await connected(sim);
    transport.queueFault({ kind: 'timeout' }, { kind: 'timeout' }, { kind: 'timeout' });

    await expect(link.readStatus()).rejects.toThrow(/Timed out/);
    expect(transport.countOf(Cmd.RDSR)).toBe(TEST_TIMING.attempts);
  });

  it('retries a transport fault on the WRITE path too (no read/write asymmetry)', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link, transport } = await connected(sim);
    transport.queueFault({ kind: 'timeout' });

    await link.writeBytes(0x200, new Uint8Array(32).fill(0x7f));
    expect(transport.countOf(Cmd.WRITE)).toBe(2);
    expect(sim.memory[0x200]).toBe(0x7f);
  });
});

describe('the command gate', () => {
  it('refuses a second operation while one is in flight', async () => {
    const { link } = await connected(new M35080Simulator());
    const first = link.readImage();
    await expect(link.readStatus()).rejects.toThrow(/already in progress/);
    await first;
  });

  it('releases the gate after a failure, so the next call can run', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link } = await connected(sim);
    await expect(link.writeSecure(0x00, 1)).rejects.toThrow();
    await expect(link.readStatus()).resolves.toBeDefined(); // gate was released
  });
});

describe('interface conformance', () => {
  it('the serial link implements every M35080Link method', async () => {
    const { link } = makeLink(new M35080Simulator());
    const required: (keyof M35080Link)[] = [
      'connect',
      'disconnect',
      'getInfo',
      'readStatus',
      'identify',
      'readImage',
      'writeBytes',
      'writeSecure',
      'writeAndVerify',
    ];
    for (const m of required) expect(typeof link[m]).toBe('function');
  });
});

/*
 * The post-write check compares the chip against applyPlanPreview(). That is
 * only safe if the preview predicts the chip EXACTLY - otherwise the check
 * would reject every honest restore and teach people to ignore it, which is
 * worse than not checking at all.
 */
describe('restore: the verification basis', () => {
  it('applyPlanPreview predicts exactly what the chip holds after a restore', async () => {
    /* 0x5A, NOT 0xFF. A blank chip's standard array is already 0xFF, so a
       backup of 0xFF makes a write that never lands look identical to one that
       did - the comparison would pass while proving nothing. */
    const backup = new Uint8Array(IMAGE_SIZE).fill(0x5a);
    backup.set(slotsToBytes(encodeOdometer(45_198)), 0);
    backup.set(encodeVin('AB12345'), VIN_AT);

    const sim = new M35080Simulator({ blank: true });
    const { link } = await connected(sim);
    const before = await link.readImage();

    const plan = planRestore(backup, before);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // Exactly the order runJob uses: the irreversible half first.
    for (const op of plan.secureOps) await link.writeSecure(op.address, op.to);
    for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);

    const after = await link.readImage();
    const expected = applyPlanPreview(before, plan.byteWrites, plan.secureOps);

    expect(diff(after, expected)).toEqual([]);
    expect(decodeOdometer(after.slice(0, 0x20))).toMatchObject({ ok: true, km: 45_198 });
  });

  it('a restore that lands wrong is caught by that same comparison', async () => {
    // The chip accepts the write but does not store it: exactly what an
    // unverified secure area would hide.
    const backup = new Uint8Array(IMAGE_SIZE).fill(0x5a); // must differ from blank 0xFF
    backup.set(slotsToBytes(encodeOdometer(45_198)), 0);

    const sim = new M35080Simulator({ blank: true });
    const { link } = await connected(sim);
    const before = await link.readImage();
    const plan = planRestore(backup, before);
    if (!plan.ok) throw new Error('plan should be ok');

    for (const op of plan.secureOps) await link.writeSecure(op.address, op.to);
    sim.swallowWrites = true; // the standard array silently does not take
    await link.writeBytes(plan.byteWrites[0].address, plan.byteWrites[0].data);

    const after = await link.readImage();
    const expected = applyPlanPreview(before, plan.byteWrites, plan.secureOps);
    expect(diff(after, expected).length).toBeGreaterThan(0);
  });
});

/*
 * The path the RESTORE step actually uses, end to end against the simulated
 * chip: the post-write check has to pass on it, and the odometer must never
 * receive a single WRINC.
 */
describe('restore onto a new chip - the RESTORE step path', () => {
  it('writes the backup array, blanks the VIN, leaves 0 km, and passes the post-write check', async () => {
    const backup = new Uint8Array(IMAGE_SIZE);
    for (let i = 0; i < IMAGE_SIZE; i++) backup[i] = (i * 7 + 3) & 0xff; // cluster-like
    backup.set(slotsToBytes(encodeOdometer(155_940)), 0);
    backup.set(encodeVin('AB12345'), VIN_AT);

    const sim = new M35080Simulator({ blank: true });
    const { link, transport } = await connected(sim);
    const before = await link.readImage();

    const plan = planReset(before, backup);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);
    const after = await link.readImage();

    // The same comparison runJob makes after a write.
    expect(diff(after, applyPlanPreview(before, plan.byteWrites, []))).toEqual([]);

    // Not one WRINC: the odometer was never touched and still reads 0 km.
    expect(transport.countOf(Cmd.WRINC)).toBe(0);
    expect(decodeOdometer(after.slice(0, 0x20))).toMatchObject({ ok: true, km: 0 });

    // The whole array is the backup, byte for byte - 0x2E8-0x2EF included.
    expect(Array.from(after.subarray(0x20, 0x400))).toEqual(Array.from(backup.subarray(0x20, 0x400)));
  });
});

/*
 * Repair on a chip that is NOT blank: it must reach the chip, and it must not
 * send a single WRINC - that is what makes it repeatable, and therefore usable
 * as a data-retention test.
 */
describe('repair - the RESTORE step on a chip that is not blank', () => {
  it('writes only the lost bytes and leaves the odometer untouched', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link, transport } = await connected(sim);
    const before = await link.readImage();

    const backup = Uint8Array.from(before);
    for (let a = 0x300; a < 0x340; a++) backup[a] = (a * 3) & 0xff; // cluster-like
    backup[0x040] = 0x11;
    backup[0x041] = 0x22;
    backup[0x200] = 0x33;

    const plan = planRepairStandard(before, backup);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);
    const after = await link.readImage();

    expect(diff(after, applyPlanPreview(before, plan.byteWrites, []))).toEqual([]);
    expect(transport.countOf(Cmd.WRINC)).toBe(0);
    expect(Array.from(after.subarray(0, 0x20))).toEqual(Array.from(before.subarray(0, 0x20)));
  });
});


describe('a VIN rewrite on a late-layout chip, through the real link', () => {
  it('lands both fields and the recomputed checksum, and the chip reads back consistent', async () => {
    const sim = new M35080Simulator({ image: lateImage({ codedVin: 'AB12345', asciiVin: 'CD67890' }) });
    const { link, transport } = await connected(sim);
    const before = await link.readImage();
    const plan = planRewrite(before, 155_940, { kind: 'write', vin: 'EF24680' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    transport.clearTrace();
    for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);

    // Three ranges, three pages - no WRINC, the odometer is untouched.
    expect(transport.countOf(Cmd.WRITE)).toBe(3);
    expect(transport.countOf(Cmd.WRINC)).toBe(0);
    const after = await link.readImage();
    expect(diff(after, applyPlanPreview(before, plan.byteWrites))).toEqual([]);
    const v = readVins(after);
    expect([v.coded?.text, v.ascii?.text, v.differ]).toEqual(['EF24680', 'EF24680', false]);
    expect(checksumStatus(after).every((c) => c.ok)).toBe(true);
  });
});
