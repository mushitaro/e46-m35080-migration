import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSerialM35080Link } from '@/lib/link/m35080Link';
import type { SerialPortLike } from '@/lib/transport/webSerialTransport';
import { crc16 } from '@/lib/codec/bridgeProtocol';
import { M35080Simulator } from './support/m35080Simulator';

/** Real Web Streams exercise the locks that a failed handshake used to leak. */
function serialPort(reply: (request: Uint8Array) => Uint8Array | null) {
  let opened = false;
  const port: SerialPortLike = {
    readable: null,
    writable: null,
    open: vi.fn(async () => {
      if (opened) throw new Error('port already open');
      opened = true;
      let input: ReadableStreamDefaultController<Uint8Array>;
      port.readable = new ReadableStream({ start: (controller) => { input = controller; } });
      port.writable = new WritableStream({
        write(request) {
          const response = reply(request);
          if (response) input.enqueue(response);
        },
      });
    }),
    close: vi.fn(async () => {
      if (port.readable?.locked || port.writable?.locked) throw new Error('streams still locked');
      opened = false;
    }),
  };
  return port;
}

afterEach(() => vi.useRealTimers());

describe('serial connection lifecycle', () => {
  it('releases a silent port after PING fails, allowing another connection', async () => {
    vi.useFakeTimers();
    const sim = new M35080Simulator();
    let silent = true;
    const port = serialPort((frame) => silent ? null : sim.respond(frame));
    const link = new WebSerialM35080Link(port);
    const failed = expect(link.connect()).rejects.toThrow(/Timed out/);
    await vi.runAllTimersAsync();
    await failed;
    expect(link.connected).toBe(false);
    expect(link.getInfo()).toBeNull();
    expect(port.close).toHaveBeenCalledOnce();
    expect(port.readable?.locked).toBe(false);
    expect(port.writable?.locked).toBe(false);

    silent = false;
    const retry = new WebSerialM35080Link(port);
    const connected = retry.connect();
    await vi.runAllTimersAsync();
    expect((await connected).magic).toBe('M35080BR');
    await retry.disconnect();
  });

  it('releases the port when a CRC-valid PING advertises an incompatible protocol', async () => {
    vi.useFakeTimers();
    const sim = new M35080Simulator();
    const port = serialPort((request) => {
      const response = sim.respond(request);
      response[5 + 8] = 99;
      const crc = crc16(response.subarray(1, -2));
      response[response.length - 2] = crc & 0xff;
      response[response.length - 1] = crc >> 8;
      return response;
    });
    const link = new WebSerialM35080Link(port);
    const failed = expect(link.connect()).rejects.toThrow(/protocol v99/);
    await vi.runAllTimersAsync();
    await failed;
    expect(port.close).toHaveBeenCalledOnce();
    expect(port.readable?.locked).toBe(false);
    expect(port.writable?.locked).toBe(false);
    expect(link.getInfo()).toBeNull();
  });

  it('preserves an open failure without closing a port owned by another connection', async () => {
    const port = serialPort(() => null);
    const denied = new Error('Access denied');
    port.open = vi.fn().mockRejectedValue(denied);
    const link = new WebSerialM35080Link(port);
    await expect(link.connect()).rejects.toBe(denied);
    expect(port.close).not.toHaveBeenCalled();
  });

  it('keeps a successful connection open until disconnect', async () => {
    vi.useFakeTimers();
    const sim = new M35080Simulator();
    const port = serialPort((request) => sim.respond(request));
    const link = new WebSerialM35080Link(port);
    const connected = link.connect();
    await vi.runAllTimersAsync();
    await connected;
    expect(link.connected).toBe(true);
    expect(port.close).not.toHaveBeenCalled();
    await link.disconnect();
    expect(port.close).toHaveBeenCalledOnce();
    expect(port.readable?.locked).toBe(false);
    expect(port.writable?.locked).toBe(false);
  });
});
