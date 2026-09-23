import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ds2Link, DS2_DEFAULT_TIMINGS } from './link';
import { WebSerialTransport } from './transport';
import { WebUsbFtdiTransport } from './webUsbFtdiTransport';
import { simulatedFtdiEcu, simulatedPort, type ExchangeBehavior, type TraceEntry } from './simulator';
import { Ds2Address, Ds2Control, Ds2Status, toHex } from './frame';
import { isDs2Error } from './errors';

/**
 * Every test here drives the REAL transport and Ds2Link against a simulated device. Nothing is
 * mocked out of the path under test.
 *
 * The protocol suite runs over BOTH backends, against the same DS2 slave. That is not symmetry for
 * its own sake: the link's echo verification, retry policy and resync were all tuned against a byte
 * stream that arrives in arbitrary chunks from Web Serial, and the FTDI path delivers the same
 * bytes as packets with two status bytes at the head of each. Everything below is a claim about the
 * PROTOCOL, so it has to hold whichever way the bytes arrived — and if one backend ever makes one
 * of them false, that is the finding.
 *
 * Two tests stay Web Serial only, because they are about the port rather than the protocol: the
 * 8E1 open options and the DTR/RTS discipline. The FTDI equivalents — the vendor request sequence
 * that sets exactly those things — are asserted in webUsbFtdi.test.ts.
 */

type Backend = 'web-serial' | 'web-usb-ftdi';

interface Harness {
    link: Ds2Link;
    /** What actually reached the device. A live reference: the array is appended to as it runs. */
    trace: TraceEntry[];
    /** Inject bytes as if the device had sent them unprompted. */
    emit(bytes: Uint8Array): void;
}

interface HarnessOptions {
    address?: number;
    timings?: Partial<typeof DS2_DEFAULT_TIMINGS>;
}

/**
 * The FTDI read loop is an unbounded loop over a timer, so a transport left open outlives its test
 * and keeps the worker alive. Closing them all here rather than in each test means a new test cannot
 * forget.
 */
const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
    // After the closes: WebUsbFtdiTransport.close() reads navigator.usb to drop its listener.
    vi.unstubAllGlobals();
});

function timingsFor(opts: HarnessOptions) {
    // Keep the failure paths quick; the real defaults are asserted separately.
    return { responseTimeoutMs: 120, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1, ...opts.timings };
}

async function connectWebSerial(script: ExchangeBehavior[] = [], opts: HarnessOptions = {}) {
    const address = opts.address ?? Ds2Address.DME;
    const { port, requestPort } = simulatedPort({ address, script });
    const transport = new WebSerialTransport({ requestPort });
    const link = new Ds2Link(transport, { address, timings: timingsFor(opts) });
    await link.connect();
    opened.push(transport);
    return { link, port, transport };
}

async function connectOver(
    backend: Backend,
    script: ExchangeBehavior[] = [],
    opts: HarnessOptions = {},
): Promise<Harness> {
    if (backend === 'web-serial') {
        const { link, port } = await connectWebSerial(script, opts);
        return { link, trace: port.trace, emit: (b) => port.emit(b) };
    }
    const address = opts.address ?? Ds2Address.DME;
    const { ecu, device, usb } = simulatedFtdiEcu({ address, script });
    vi.stubGlobal('navigator', { usb });
    const transport = new WebUsbFtdiTransport();
    const link = new Ds2Link(transport, { address, timings: timingsFor(opts) });
    await link.connect();
    opened.push(transport);
    // One status packet has been through the loop, so skipLineStatusOnce is spent and the device is
    // not about to swallow a fault a test injects.
    await device.waitForIdle(1);
    return { link, trace: ecu.trace, emit: (b) => device.pushBytes(b) };
}

describe('connect (Web Serial port shape)', () => {
    it('opens 8E1 at 9600 — the parity is not negotiable', async () => {
        // An 8N1 receiver samples the parity bit where the stop bit should be, so
        // every even-popcount byte raises a framing error. DS2's own address 0x12
        // and ACK 0xA0 both have popcount 2.
        const { port } = await connectWebSerial();
        expect(port.opens).toHaveLength(1);
        expect(port.opens[0]).toMatchObject({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' });
    });

    it('de-asserts DTR and RTS on open', async () => {
        const { port } = await connectWebSerial();
        expect(port.signals).toContainEqual({ dataTerminalReady: false, requestToSend: false });
    });
});

describe.each<Backend>(['web-serial', 'web-usb-ftdi'])('over %s', (backend) => {
    const connected = (script?: ExchangeBehavior[], opts?: HarnessOptions) =>
        connectOver(backend, script, opts);

    describe('exchange', () => {
        it('verifies the echo and returns the parsed response', async () => {
            const h = await connected([{ kind: 'respond', payload: new Uint8Array([0x01, 0x02]) }]);
            const frame = await h.link.exchange(Ds2Control.READ_IO_STATUS, new Uint8Array([0x03]));

            expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
            expect(Array.from(frame.payload)).toEqual([0x01, 0x02]);
            // The device saw exactly the frame we meant to send.
            // 0x12 ^ 0x05 ^ 0x0b ^ 0x03 = 0x1f
            expect(toHex(h.trace[0].bytes)).toBe('12 05 0b 03 1f');
        });

        it('classifies an electrically corrupted echo and does not retry it away', async () => {
            // Bits pulled low only — the physically honest corruption.
            const h = await connected([{ kind: 'corruptEcho', mask: 0xf0, trailingZeros: 2 }]);
            const err = await h.link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

            expect(isDs2Error(err)).toBe(true);
            expect(err.code).toBe('ECHO_MISMATCH');
            expect(err.kind).toBe('electrical');
            // The analysis rides as data, so a UI can branch without parsing prose.
            expect(err.detail.analysis.flips0to1).toBe(0);
        });

        it('classifies a stale reply in the echo slot as a recoverable desync', async () => {
            const h = await connected([{ kind: 'staleResponse' }]);
            const err = await h.link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

            expect(err.code).toBe('ECHO_MISMATCH');
            expect(err.kind).toBe('desync');
        });

        it('times out when the ECU echoes and then goes quiet', async () => {
            const h = await connected([{ kind: 'silent' }]);
            const err = await h.link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

            expect(err.code).toBe('READ_TIMEOUT');
            expect(err.kind).toBe('timeout');
        });

        it('rejects a response from the wrong address before trusting its length byte', async () => {
            // Out of frame, a bogus length would swallow the next response or stall a
            // whole timeout, so the address check has to come first.
            const h = await connected([{ kind: 'dead' }]);
            const pending = h.link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);
            const request = new Uint8Array([0x12, 0x04, 0x9e, 0x88]);
            h.emit(request); // the echo
            h.emit(new Uint8Array([Ds2Address.SMG, 0xff, 0xa0, 0x00])); // someone else's frame
            const err = await pending;

            expect(err.code).toBe('ADDRESS_MISMATCH');
            expect(err.kind).toBe('desync');
        });
    });

    describe('the command gate', () => {
        it('refuses a second concurrent operation instead of interleaving frames', async () => {
            const h = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
            const first = h.link.exchange(Ds2Control.KEEP_ALIVE).catch(() => 'first-failed');
            const err = await h.link.exchange(Ds2Control.READ_ERROR_MEMORY).catch((e) => e);

            expect(err.code).toBe('GATE_HELD');
            await first;
        });

        it('releases the gate after a failure', async () => {
            const h = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
            await h.link.exchange(Ds2Control.KEEP_ALIVE).catch(() => undefined);
            expect(h.link.isBusy).toBe(false);
            await expect(h.link.exchange(Ds2Control.KEEP_ALIVE)).resolves.toBeDefined();
        });

        it('does not deadlock on its own gate — public operations compose through private inner methods', async () => {
            // login() takes the gate and internally performs two exchanges. If those
            // went through the public gated exchange() it would deadlock here.
            const h = await connected([
                { kind: 'respond', payload: new Uint8Array(42) }, // 46-byte seed frame
                { kind: 'respond' },
            ]);
            await expect(h.link.login()).resolves.toBe('unlocked');
        });
    });

    describe('keepAlive', () => {
        it('never throws, and skips rather than queuing when the gate is held', async () => {
            const h = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
            const inFlight = h.link.exchange(Ds2Control.READ_ERROR_MEMORY).catch(() => undefined);

            // A timer has nothing to catch a rejection, so losing the race for the
            // gate must be a normal `false`, not an unhandled rejection.
            await expect(h.link.keepAlive()).resolves.toBe(false);
            await inFlight;
        });

        it('returns false rather than throwing when the exchange fails', async () => {
            const h = await connected([{ kind: 'dead' }]);
            await expect(h.link.keepAlive()).resolves.toBe(false);
        });

        it('reports true on a positive response', async () => {
            const h = await connected([{ kind: 'respond' }]);
            await expect(h.link.keepAlive()).resolves.toBe(true);
        });
    });

    describe('retry policy', () => {
        it('retries a transport failure and succeeds on a later attempt', async () => {
            const h = await connected([
                { kind: 'silent' }, // attempt 1 times out
                { kind: 'silent' }, // attempt 2 times out
                { kind: 'respond' }, // attempt 3 succeeds
            ]);
            const frame = await h.link.exchangeWithRetry(Ds2Control.READ_IO_STATUS, new Uint8Array([0x03]), {
                attempts: 3,
            });

            expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
            expect(h.trace).toHaveLength(3);
        });

        it('gives up after the configured attempts and reports the last error', async () => {
            const h = await connected([{ kind: 'silent' }, { kind: 'silent' }]);
            const err = await h.link
                .exchangeWithRetry(Ds2Control.KEEP_ALIVE, new Uint8Array(0), { attempts: 2 })
                .catch((e) => e);

            expect(err.code).toBe('READ_TIMEOUT');
            expect(h.trace).toHaveLength(2);
        });

        it('polls a BUSY status on its own budget instead of spending an attempt', async () => {
            // A slow commit must not burn the retries that exist for line faults.
            const h = await connected([{ kind: 'busy', times: 3 }, { kind: 'respond' }], {
                timings: { busyPollIntervalMs: 1 },
            });
            const frame = await h.link.exchangeWithRetry(Ds2Control.CLEAR_ADAPTATIONS, new Uint8Array([0x47]), {
                attempts: 1,
                tolerateBusy: true,
            });

            expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
            // One attempt, but four telegrams: three BUSY plus the eventual ACK.
            expect(h.trace).toHaveLength(4);
        });
    });

    describe('negative responses', () => {
        it('names the numeric status rather than swallowing it', async () => {
            // "rejected (status 0xB0)" is a fact about the device; "rejected" is a
            // fact about nothing. 0xB0 is what proved 19200 baud is unimplemented.
            const h = await connected([{ kind: 'respond', status: Ds2Status.PARAMETER_ERROR }]);
            const frame = await h.link.exchange(Ds2Control.REQUEST_BAUD_SWITCH);
            const err = await Promise.resolve()
                .then(() => h.link.assertPositive(frame, 'Baud switch'))
                .catch((e) => e);

            expect(err.code).toBe('NEGATIVE_RESPONSE');
            expect(err.kind).toBe('refused');
            expect(err.detail.status).toBe(0xb0);
            expect(err.message).toContain('0xb0');
        });
    });

    describe('multi-module addressing', () => {
        it.each([
            ['DME', Ds2Address.DME],
            ['SMG', Ds2Address.SMG],
            ['DSC', Ds2Address.DSC],
        ])('talks to %s at its own address', async (_name, address) => {
            const h = await connected([{ kind: 'respond' }], { address });
            await h.link.exchange(Ds2Control.READ_ERROR_MEMORY);
            expect(h.trace[0].request.address).toBe(address);
        });
    });
});

describe('defaults', () => {
    it('ships the measured timing values', () => {
        // These are evidence from a real vehicle, not taste. Changing one should
        // be a deliberate act with a measurement behind it.
        expect(DS2_DEFAULT_TIMINGS.responseTimeoutMs).toBe(2000);
        expect(DS2_DEFAULT_TIMINGS.breakSettleMs).toBe(400);
        expect(DS2_DEFAULT_TIMINGS.resyncSettleMs).toBe(30);
        expect(DS2_DEFAULT_TIMINGS.busyPollAttempts).toBe(13);
    });
});
