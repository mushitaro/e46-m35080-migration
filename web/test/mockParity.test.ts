import { describe, it, expect } from 'vitest';
import { WebSerialM35080Link, type M35080Link } from '@/lib/link/m35080Link';
import { MockM35080Link } from '@/lib/link/mockLink';
import { M35080Simulator, ScriptedTransport, TEST_TIMING } from './support/m35080Simulator';
import { IMAGE_SIZE } from '@/lib/codec/bridgeProtocol';
import { readSecureSlots } from '@/lib/domain/odometer';

/**
 * PRACTICE must rehearse the REAL refusals.
 *
 * A mock that accepts something the hardware rejects is worse than no mock: it
 * teaches the user a workflow that fails at the bench. These tests assert the
 * two implementations refuse the same things, so the rehearsal is honest.
 */

async function realLink(sim: M35080Simulator) {
  const transport = new ScriptedTransport(sim);
  const link = new WebSerialM35080Link({} as never, TEST_TIMING);
  (link as unknown as { transport: ScriptedTransport }).transport = transport;
  await link.connect();
  transport.clearTrace();
  return { link, transport };
}

async function mockLink(preset: 'used' | 'blank') {
  const link = new MockM35080Link(preset);
  await link.connect();
  return link;
}

describe('mock / hardware parity', () => {
  it('both refuse a plain write into the secure area', async () => {
    const { link: real } = await realLink(new M35080Simulator({ blank: true }));
    const mock = await mockLink('blank');
    await expect(real.writeBytes(0x00, new Uint8Array(2))).rejects.toThrow(/secure area/);
    await expect(mock.writeBytes(0x00, new Uint8Array(2))).rejects.toThrow(/secure area/);
  });

  it('both refuse an out-of-image write WITHOUT writing anything first', async () => {
    const sim = new M35080Simulator({ blank: true });
    const { link: real, transport } = await realLink(sim);
    const mock = await mockLink('blank');

    await expect(real.writeBytes(0x3ff, new Uint8Array(8))).rejects.toThrow(/outside/);
    await expect(mock.writeBytes(0x3ff, new Uint8Array(8))).rejects.toThrow(/outside/);

    // The whole point: nothing reached the device before the refusal.
    expect(transport.trace).toHaveLength(0);
    expect(sim.memory[0x3ff]).toBe(0xff);
  });

  it('both refuse a decrement of the secure counter', async () => {
    const sim = new M35080Simulator({ km: 155_940 });
    const { link: real } = await realLink(sim);
    const mock = await mockLink('used');
    const current = readSecureSlots(sim.memory.slice(0, 32))[0];

    await expect(real.writeSecure(0x00, current - 1)).rejects.toThrow();
    await expect(mock.writeSecure(0x00, 1)).rejects.toThrow();
  });

  it('both refuse an odd WRINC address', async () => {
    const { link: real } = await realLink(new M35080Simulator());
    const mock = await mockLink('used');
    await expect(real.writeSecure(0x01, 9999)).rejects.toThrow(/even/);
    await expect(mock.writeSecure(0x01, 9999)).rejects.toThrow(/even/);
  });

  it('both report a blank chip the same way', async () => {
    const { link: real } = await realLink(new M35080Simulator({ blank: true }));
    const mock = await mockLink('blank');
    const a = await real.identify();
    const b = await mock.identify();
    expect(a.status.uv).toBe(b.status.uv);
    expect(Array.from(a.secure)).toEqual(Array.from(b.secure));
  });

  it('both read a full-size image', async () => {
    const { link: real } = await realLink(new M35080Simulator({ km: 100_000 }));
    const mock = await mockLink('used');
    expect(await real.readImage()).toHaveLength(IMAGE_SIZE);
    expect(await mock.readImage()).toHaveLength(IMAGE_SIZE);
  });

  it('the mock implements every method the interface declares', async () => {
    const mock = await mockLink('used');
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
    // A mock that throws on a method added later turns a real feature into a
    // PRACTICE-only crash.
    for (const m of required) expect(typeof mock[m]).toBe('function');
  });

  it('the mock models state: a write is still there on the next read', async () => {
    const mock = await mockLink('blank');
    await mock.writeAndVerify(0x200, Uint8Array.from([1, 2, 3, 4]));
    const image = await mock.readImage();
    expect(Array.from(image.subarray(0x200, 0x204))).toEqual([1, 2, 3, 4]);
  });

  it('the mock enforces the counter climb like the chip does', async () => {
    const mock = await mockLink('blank');
    await mock.writeSecure(0x00, 100);
    await expect(mock.writeSecure(0x00, 100)).rejects.toThrow(); // equal is refused
    await mock.writeSecure(0x00, 101); // strictly greater is accepted
    const image = await mock.readImage();
    expect((image[0] << 8) | image[1]).toBe(101);
  });
});
