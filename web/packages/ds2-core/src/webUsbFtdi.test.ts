/**
 * The FTDI/WebUSB backend, driven through a simulated FT232R.
 *
 * The constants below are written out again rather than imported from the transport. That is
 * deliberate: a test that imports the value it is checking cannot fail when the value is wrong. The
 * numbers here come from FTDI's AN232B-05 and libftdi, and the divisor test recomputes the encoding
 * from scratch — so a wrong table fails against two independent statements of it, not against
 * itself.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatedFtdiDevice, SimulatedUsb, type ControlRecord } from './ftdiSimulator';
import { WebUsbFtdiTransport } from './webUsbFtdiTransport';
import { isDs2Error } from './errors';
import type { LinkTiming } from './timing';

const SIO_RESET = 0x00;
const SIO_SET_MODEM_CTRL = 0x01;
const SIO_SET_FLOW_CTRL = 0x02;
const SIO_SET_BAUD_RATE = 0x03;
const SIO_SET_DATA = 0x04;
const SIO_SET_LATENCY_TIMER = 0x09;
const PURGE_RX = 2; // libftdi 1.5 ftdi_tciflush — NOT the 1 that libftdi <= 1.4 called PURGE_RX
const DATA_8E1 = 0x0208;
const MODEM_DTR_LOW_RTS_LOW = 0x0300;
const PACKET = 64;

const LSR_OVERRUN = 0x02;
const LSR_FRAMING = 0x08;
const LSR_BREAK = 0x10;

let open: WebUsbFtdiTransport[] = [];

/** Every test must leave the read loop stopped: it is an unbounded loop over a 1 ms timer, so a
 *  transport left open keeps the worker alive after the assertions have passed. */
afterEach(async () => {
    for (const t of open) await t.close().catch(() => {});
    open = [];
    vi.unstubAllGlobals();
});

function install(device: SimulatedFtdiDevice, opts: { granted?: boolean } = {}): SimulatedUsb {
    const usb = new SimulatedUsb(opts.granted === false ? [] : [device], device);
    vi.stubGlobal('navigator', { usb });
    return usb;
}

async function connected(device = new SimulatedFtdiDevice()): Promise<WebUsbFtdiTransport> {
    const t = new WebUsbFtdiTransport();
    open.push(t);
    await t.open();
    await device.waitForIdle(1); // the read loop is running and has cleared skipLineStatusOnce
    return t;
}

function find(control: ControlRecord[], request: number): ControlRecord[] {
    return control.filter((c) => c.request === request);
}

describe('FTDI baud divisors', () => {
    it('encode 9600 / 38400 / 125000 exactly, matching AN232B-05', async () => {
        // An independent implementation of the encoding, written from the datasheet rather than
        // copied: integer divisor against a 3 MHz clock plus a 3-bit fractional code.
        const encode = (baud: number) => {
            const d8 = 24_000_000 / baud;
            expect(Number.isInteger(d8)).toBe(true); // zero baud error for all three
            const frac = [0, 3, 2, 4, 1, 5, 6, 7][d8 & 7];
            const encoded = (d8 >> 3) | (frac << 14);
            return { value: encoded & 0xffff, index: encoded >>> 16 };
        };
        expect(encode(9600)).toEqual({ value: 0x4138, index: 0 });
        expect(encode(38400)).toEqual({ value: 0xc04e, index: 0 });
        expect(encode(125000)).toEqual({ value: 0x0018, index: 0 });

        // And the values the transport actually puts on the wire are those.
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        expect(find(device.control, SIO_SET_BAUD_RATE)[0]).toMatchObject({ value: 0x4138, index: 0 });
        await t.reopen(38400);
        await t.reopen(125000);
        expect(find(device.control, SIO_SET_BAUD_RATE).map((c) => c.value)).toEqual([0x4138, 0xc04e, 0x0018]);
    });

    it('refuses a rate that is not in the audited table', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        await expect(t.reopen(19200)).rejects.toMatchObject({ code: 'PORT_UNSUPPORTED' });
    });
});

describe('support detection', () => {
    it('is false without navigator.usb and true with it', () => {
        vi.stubGlobal('navigator', {});
        expect(WebUsbFtdiTransport.isSupported()).toBe(false);
        vi.stubGlobal('navigator', { usb: new SimulatedUsb() });
        expect(WebUsbFtdiTransport.isSupported()).toBe(true);
    });

    it('open() reports the BROWSER as unsupported, not the cable', async () => {
        vi.stubGlobal('navigator', {});
        const t = new WebUsbFtdiTransport();
        await expect(t.open()).rejects.toMatchObject({ code: 'PORT_UNSUPPORTED' });
    });
});

describe('open()', () => {
    it('configures the chip in the order the firmware requires', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        await connected(device);

        // SIO_RESET must come FIRST: it clears modem-control state, so a DTR/RTS request before it
        // would be undone. The flush must come LAST, or it drops bytes that arrived during setup.
        expect(device.control.map((c) => [c.request, c.value])).toEqual([
            [SIO_RESET, 0],
            [SIO_SET_LATENCY_TIMER, 16],
            [SIO_SET_FLOW_CTRL, 0],
            [SIO_SET_BAUD_RATE, 0x4138],
            [SIO_SET_DATA, DATA_8E1],
            [SIO_SET_MODEM_CTRL, MODEM_DTR_LOW_RTS_LOW],
            [SIO_RESET, PURGE_RX],
        ]);
        expect(device.claimed).toEqual([0]);
        expect(device.configuration?.configurationValue).toBe(1);
    });

    it('reuses an already-granted cable instead of reopening the chooser', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device);
        await connected(device);
        expect(usb.requestDeviceCalls).toBe(0);
    });

    it('opens the chooser when nothing has been granted yet', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device, { granted: false });
        await connected(device);
        expect(usb.requestDeviceCalls).toBe(1);
    });

    it('lets a dismissed chooser through as NotFoundError, unwrapped', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device, { granted: false });
        usb.dismissChooser = true;
        const t = new WebUsbFtdiTransport();
        // Not a Ds2Error: a caller distinguishes "changed their mind" from a failure by this name,
        // and wrapping it would turn a cancel into a red error line.
        const err = await t.open().then(
            () => null,
            (e) => e,
        );
        expect(isDs2Error(err)).toBe(false);
        expect((err as Error).name).toBe('NotFoundError');
    });

    it('refuses an H-series chip as a DEVICE problem, before claiming the interface', async () => {
        const device = new SimulatedFtdiDevice({ deviceVersionMajor: 9 }); // FT232H
        install(device);
        const t = new WebUsbFtdiTransport();
        open.push(t);
        await expect(t.open()).rejects.toMatchObject({
            code: 'DEVICE_UNSUPPORTED',
            detail: { deviceVersionMajor: 9 },
        });
        expect(device.claimed).toEqual([]);
    });

    it('refuses a device with no bulk endpoint pair', async () => {
        const device = new SimulatedFtdiDevice({ bulkEndpoints: false });
        install(device);
        const t = new WebUsbFtdiTransport();
        open.push(t);
        await expect(t.open()).rejects.toMatchObject({ code: 'DEVICE_UNSUPPORTED' });
    });
});

describe('the read loop', () => {
    it('strips INTERIOR packet headers, not just the one at offset 0', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);

        // 100 bytes spans two packets: 62 payload in a full one, 38 in a short one. A transport
        // that only stripped offset 0 would return 62 correct bytes followed by two bytes of header
        // and then the rest — plausible, wrong, and silent.
        const sent = Array.from({ length: 100 }, (_, i) => (i * 7 + 3) & 0xff);
        device.pushBytes(sent);
        expect([...(await t.readExact(100, 1000))]).toEqual(sent);
    });

    it('does not record an rx for a bare status packet', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        let rx = 0;
        const timing = {
            rx: () => {
                rx++;
            },
            writeStart: () => {},
            writeEnd: () => {},
            parkStart: () => {},
            parkEnd: () => {},
            exchangeStart: () => {},
            echoComplete: () => {},
            exchangeEnd: () => {},
        } satisfies LinkTiming;
        t.setTiming(timing);

        // The chip emits one of these on every latency-timer expiry — 62.5 a second at idle on the
        // real default. Counting them as arrivals would make "the ECU was thinking" and "the bytes
        // were here and we were slow" indistinguishable, which is the instrument's whole job.
        await device.waitForIdle(4);
        expect(rx).toBe(0);

        device.pushBytes([0xa0]);
        await t.readExact(1, 1000);
        expect(rx).toBe(1);
    });

    it('delivers the bytes that arrived before a fault in the same transfer', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);

        // Exactly one full packet, so the transfer continues into the fault packet rather than
        // ending on a short one.
        const clean = Array.from({ length: PACKET - 2 }, (_, i) => i & 0xff);
        device.pushBytes(clean);
        device.pushLineStatus(LSR_BREAK);

        expect([...(await t.readExact(clean.length, 1000))]).toEqual(clean);
        expect(t.hasReadError()).toBe(true);
        expect(t.peekReadError()?.name).toBe('BreakError');
    });

    it.each([
        [LSR_BREAK, 'BreakError'],
        [LSR_FRAMING, 'FramingError'],
        [LSR_OVERRUN, 'BufferOverrunError'],
    ])('maps line status 0x%s onto the Web Serial spelling %s', async (bits, name) => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        device.pushLineStatus(bits);
        // The name is what the two backends share, and readExact is where it is read.
        await expect(t.readExact(1, 1000)).rejects.toMatchObject({
            code: 'READ_FAILED',
            kind: 'electrical',
            detail: { errorName: name },
        });
    });

    it('latches a disconnect as NetworkError', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device);
        const t = await connected(device);
        usb.disconnect(device);
        expect(t.peekReadError()?.name).toBe('NetworkError');
    });
});

describe('write()', () => {
    it('puts the bytes on the bulk OUT endpoint', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        await t.write(Uint8Array.from([0x12, 0x04, 0x00, 0x16]));
        expect([...device.written[0]]).toEqual([0x12, 0x04, 0x00, 0x16]);
    });

    it('wraps a rejected transfer as a coded electrical failure', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        vi.spyOn(device, 'transferOut').mockRejectedValueOnce(new DOMException('gone', 'NetworkError'));
        await expect(t.write(Uint8Array.from([0x12]))).rejects.toMatchObject({
            code: 'WRITE_FAILED',
            kind: 'electrical',
        });
    });
});

describe('purge / recoverRead', () => {
    it('purge is synchronous for the caller and still reaches the chip FIFO', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        device.pushBytes([1, 2, 3]);
        await t.readExact(1, 1000); // leaves 2 buffered

        const flushes = () => find(device.control, SIO_RESET).filter((c) => c.value === PURGE_RX).length;
        const before = flushes();
        t.purge(); // NOT awaited — the link's resync calls it exactly like this
        expect(t.bufferedLength()).toBe(0);
        await new Promise((r) => setTimeout(r, 10));
        expect(flushes()).toBe(before + 1);
    });

    it('clears the latch, restarts the pump, and reads again', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        device.pushLineStatus(LSR_BREAK);
        await expect(t.readExact(1, 1000)).rejects.toMatchObject({ code: 'READ_FAILED' });

        await t.recoverRead(1);
        expect(t.hasReadError()).toBe(false);
        device.pushBytes([0xa0]);
        expect([...(await t.readExact(1, 1000))]).toEqual([0xa0]);
    });

    it('ignores the line status on exactly the first packet after recovery', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        device.pushLineStatus(LSR_BREAK);
        await expect(t.readExact(1, 1000)).rejects.toMatchObject({ code: 'READ_FAILED' });
        await t.recoverRead(1);

        // LSR bits are latched-since-last-read, so the first packet back still carries the break we
        // just recovered from — on real hardware that is the status packet the next latency-timer
        // expiry produces, a few ms later. Re-latching it would make recovery impossible.
        device.latchLineStatus(LSR_BREAK);
        device.pushBytes([0xaa, 0xbb]);
        expect([...(await t.readExact(2, 1000))]).toEqual([0xaa, 0xbb]);
        expect(t.hasReadError()).toBe(false);

        // ...and exactly one. The next fault must land.
        device.pushLineStatus(LSR_BREAK);
        await expect(t.readExact(1, 1000)).rejects.toMatchObject({ code: 'READ_FAILED' });
    });

    it('refuses to recover a device that has physically gone', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device);
        const t = await connected(device);
        usb.disconnect(device);
        await expect(t.recoverRead(1)).rejects.toMatchObject({ code: 'READ_FAILED', kind: 'electrical' });
    });
});

describe('the latency timer', () => {
    it('arms 4 ms for a run, restores 16, and costs nothing when already there', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        const values = () => find(device.control, SIO_SET_LATENCY_TIMER).map((c) => c.value);

        expect(values()).toEqual([16]);
        await t.setLatencyTimer('log');
        await t.setLatencyTimer('log'); // no second round trip
        expect(values()).toEqual([16, 4]);
        await t.setLatencyTimer('idle');
        expect(values()).toEqual([16, 4, 16]);
    });

    it('never fails a run when the chip refuses the request', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        vi.spyOn(device, 'controlTransferOut').mockRejectedValueOnce(new DOMException('stall', 'NetworkError'));
        await expect(t.setLatencyTimer('log')).resolves.toBeUndefined();
    });
});

describe('reopen()', () => {
    it('changes baud in place — no close, and the read loop never stops', async () => {
        const device = new SimulatedFtdiDevice();
        install(device);
        const t = await connected(device);
        expect(t.reopenIsInPlace()).toBe(true);

        await t.reopen(38400);
        expect(device.closeCount).toBe(0);
        expect(device.opened).toBe(true);

        device.pushBytes([0x5a]);
        expect([...(await t.readExact(1, 1000))]).toEqual([0x5a]);
    });
});

describe('close()', () => {
    it('releases the interface, closes the device and drops the disconnect listener', async () => {
        const device = new SimulatedFtdiDevice();
        const usb = install(device);
        const t = await connected(device);
        expect(usb.listenerCount()).toBe(1);

        await t.close();
        expect(device.released).toEqual([0]);
        expect(device.closeCount).toBe(1);
        expect(usb.listenerCount()).toBe(0);
    });
});
