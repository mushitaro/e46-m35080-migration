/**
 * The Web Serial transport: a pump, and a latch.
 *
 * Owns the PORT. The receive buffer, the parked reader and readExact live in
 * BufferedByteTransport — lifted there when a second backend arrived, rather than copied into it,
 * because two copies would drift and the drift would surface as an intermittent framing fault in a
 * car rather than as a failing check on a desk. This class must NOT know the protocol — no frame
 * shapes, no control bytes, no retry policy.
 *
 * Received bytes are drained by a single background pump into the base class's buffer, and
 * readExact consumes from it. This is deliberate: the Web Serial reader delivers bytes on arbitrary
 * chunk boundaries, so a DS2 echo and the start of its response frequently arrive in the SAME
 * chunk. A naive "one chunk per readExact" drops the surplus and desynchronises the stream — which
 * is exactly what broke bulk reads in the reference app. Buffering never drops a byte, keeping
 * echo/response framing aligned across thousands of exchanges.
 *
 * Ported from the MSS54HP CSL Convert Tuner. Changes: explicit Web Serial types instead of ambient
 * globals, coded errors instead of English prose, and the port acquisition is injectable so a
 * device simulator can drive this exact class rather than a mock of it. That last one is why this
 * copy, not the tuner's, is the one that survived when the two backends were brought together.
 */

import { BufferedByteTransport, delay, describeError, now } from './bufferedByteTransport';
import type { Ds2ByteTransport } from './byteTransport';
import { Ds2Error } from './errors';
import { getSerial, type SerialPortLike } from './webSerialTypes';

/**
 * Receive buffer requested from the Web Serial implementation. The spec default
 * is 255 bytes.
 *
 * **This is NOT the OS or FTDI driver receive buffer.** Chromium's
 * serial_port.cc passes bufferSize straight to mojo::CreateDataPipe as
 * capacity_num_bytes — it is the ring between the browser process and the
 * renderer, nothing more. On Windows, serial_io_handler_win.cc contains no
 * SetupComm() call at all, so the driver's buffers stay at their Device Manager
 * defaults no matter what we pass. **Raising it cannot add bandwidth.**
 *
 * What it does buy is room to fall behind: at 255 bytes, reads have been
 * reported to stall outright on some devices (WICG/serial#164).
 *
 * The related hazard is worth stating because it may be one of ours:
 * WICG/serial#123 reports Chromium treats this buffer as a circular queue and
 * SPLITS a write that straddles the boundary. A DS2 request frame is ~9 bytes;
 * a split write puts a gap mid-frame on a half-duplex K-line, which comes back
 * as an echo mismatch that classifyEchoMismatch would most likely score
 * 'unclassified'. The write timer is the measurement that tests it: the median
 * should be ~0. It measured 0.10 ms on the tuner, so this is not happening
 * there.
 *
 * The WebUSB backend has no equivalent knob and a far smaller margin: there the FT232R's own
 * 256-byte FIFO is drained by a read loop sharing the main thread. See webUsbFtdiTransport.
 */
export const RX_BUFFER_BYTES = 4096;

/**
 * 8E1 at 9600 is not a default to tune — it is the proven configuration.
 *
 * Do not "simplify" the parity to 8N1 while chasing line errors. DS2 is
 * even-parity; an 8N1 receiver samples the parity bit where the stop bit should
 * be, so every even-popcount byte raises a framing error. DS2's own address
 * 0x12 and its ACK 0xA0 both have popcount 2, so effectively every frame would
 * fault on its first byte.
 *
 * (The previous OldBMW-Diag-PWA opened the port 8N1. That path was unreachable
 * from its UI, which is the only reason it never showed up as a bug.)
 */
export const DS2_SERIAL_DEFAULTS = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'even',
} as const;

export interface TransportOptions {
    /** Defaults to 9600. Only 9600/38400/125000 exist on the MSS54, and only 9600 survives. */
    baudRate?: number;
    bufferSize?: number;
    /**
     * Supplies the port. Defaults to `navigator.serial.requestPort()`, which
     * MUST be called from inside a real user gesture (a click handler).
     * Injectable so a device simulator can drive this class directly.
     */
    requestPort?: () => Promise<SerialPortLike>;
}

export class WebSerialTransport extends BufferedByteTransport implements Ds2ByteTransport {
    private port: SerialPortLike | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private pumpActive = false;
    private readonly opts: Required<Omit<TransportOptions, 'requestPort'>> &
        Pick<TransportOptions, 'requestPort'>;

    constructor(options: TransportOptions = {}) {
        super();
        this.opts = {
            baudRate: options.baudRate ?? DS2_SERIAL_DEFAULTS.baudRate,
            bufferSize: options.bufferSize ?? RX_BUFFER_BYTES,
            requestPort: options.requestPort,
        };
    }

    static isSupported(): boolean {
        return getSerial() !== undefined;
    }

    async open(): Promise<void> {
        this.port = await this.acquirePort();
        await this.port.open({
            baudRate: this.opts.baudRate,
            dataBits: DS2_SERIAL_DEFAULTS.dataBits,
            stopBits: DS2_SERIAL_DEFAULTS.stopBits,
            parity: DS2_SERIAL_DEFAULTS.parity,
            bufferSize: this.opts.bufferSize,
        });
        await this.deassertControlLines();
        this.attachStreams(this.port);
    }

    private async acquirePort(): Promise<SerialPortLike> {
        if (this.opts.requestPort) return this.opts.requestPort();
        const serial = getSerial();
        if (!serial) {
            throw new Ds2Error(
                'PORT_UNSUPPORTED',
                'Web Serial is not available in this browser (desktop Chrome or Edge required).',
                { kind: 'protocol' },
            );
        }
        // Must be called from within a real user gesture (e.g. a click handler).
        return serial.requestPort();
    }

    private attachStreams(port: SerialPortLike): void {
        if (!port.writable || !port.readable) {
            throw new Ds2Error('PORT_NOT_OPEN', 'The serial port opened without readable/writable streams.');
        }
        this.writer = port.writable.getWriter();
        this.reader = port.readable.getReader();
        this.clearBuffer();
        this.pumpActive = true;
        this.startPump();
    }

    /**
     * Puts DTR and RTS in a known, de-asserted state — matching what native
     * tools do on a COM-port transport (`DtrEnable = false; RtsEnable = false`).
     * Untouched, they sit at whatever Chromium's open() leaves behind.
     *
     * It matters more here than it does natively, because of something only a
     * Web Serial app has to do: there is no in-place baud change, so a DS2 baud
     * switch means close() + open(). Native stacks assign a property on the
     * still-open handle and never disturb the line. A close/open cycle moves
     * whatever these two lines were doing — and on some K+DCAN cables they gate
     * the K-line transceiver. Setting them identically on BOTH sides of a
     * reopen removes that variable; setting them on only one side is worse than
     * not setting them at all.
     *
     * Best-effort: a cable that does not implement the request must not fail
     * the connection.
     */
    private async deassertControlLines(): Promise<void> {
        try {
            await this.port?.setSignals?.({ dataTerminalReady: false, requestToSend: false });
        } catch {
            /* not all platforms/cables support it; the link works without it */
        }
    }

    private startPump(): void {
        const reader = this.reader!;
        void (async () => {
            try {
                while (this.pumpActive) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    // `length > 0`, not merely `value`. receive() timestamps an rx event, so a
                    // zero-length arrival would record a byte arrival that never happened. Web
                    // Serial is not known to produce one; the FTDI backend certainly does, and the
                    // precondition belongs to the base class rather than to one of its callers.
                    if (value && value.length > 0) this.receive(value);
                }
            } catch (e: unknown) {
                // Wakes any parked reader too, or it waits out its whole timeout for bytes that
                // can no longer arrive — turning a break into a multi-second stall.
                this.latch(e);
            }
        })();
    }

    async close(): Promise<void> {
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        try {
            this.writer?.releaseLock();
        } catch {}
        try {
            await this.port?.close();
        } catch {}
        this.reader = null;
        this.writer = null;
        this.port = null;
        this.clearBuffer();
    }

    /**
     * Reconfigures the port to a new baud rate. Web Serial has no way to change
     * baud on an open port, so this closes and reopens the SAME port object and
     * restarts the pump.
     *
     * Because no other tool does this, any failure that appears only on switched
     * rates should be suspected here first.
     *
     * **Deliberately not on `Ds2ByteTransport`.** A close/open moves DTR and RTS across the
     * transition, and on some K+DCAN cables those lines gate the K-line transceiver — so on this
     * backend the one moment a baud change could desync the link is the moment an ECU is least
     * able to survive it. The FTDI backend has no such transition and changes rate in place. A
     * diagnostics app never initiates a baud switch at all, so rather than carry a capability with
     * that asymmetry in the contract, it stays a concrete method on the classes that have one.
     */
    async reopen(baudRate: number): Promise<void> {
        const port = this.port;
        if (!port) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        try {
            this.writer?.releaseLock();
        } catch {}
        await port.close();
        await port.open({
            baudRate,
            dataBits: DS2_SERIAL_DEFAULTS.dataBits,
            stopBits: DS2_SERIAL_DEFAULTS.stopBits,
            parity: DS2_SERIAL_DEFAULTS.parity,
            bufferSize: this.opts.bufferSize,
        });
        // Same state as open() left, so crossing this reopen does not move the control lines.
        await this.deassertControlLines();
        this.attachStreams(port);
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (!this.writer) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        // Timed because it should be ~0, and a non-zero median would be a
        // finding — see the WICG/serial#123 note on RX_BUFFER_BYTES.
        this.timing?.writeStart(now());
        try {
            await this.writer.write(bytes);
        } catch (e) {
            throw new Ds2Error('WRITE_FAILED', `Serial write failed: ${describeError(e)}`, {
                kind: 'electrical',
                cause: e,
            });
        }
        this.timing?.writeEnd(now());
    }

    /**
     * Restarts the read side after an error latched the pump, without closing
     * the port.
     *
     * A serial break — the K-line held low by an ECU reset or a transient fault
     * — rejects the pump's read() and sets the latch, after which every readExact
     * throws until the port is reopened. That is why one break used to kill all
     * further communication until a full reconnect.
     *
     * The pump cannot self-heal, and pretending otherwise is the trap: a fresh
     * reader re-latches the same fault, so cycling it every 150 ms is churn, not
     * recovery — the line never gets a quiet stretch long enough to come back.
     * Recovery must be explicit and escalating, which is the caller's job.
     */
    async recoverRead(settleMs = 100): Promise<void> {
        const port = this.port;
        if (!port) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        await delay(settleMs); // let the break / idle condition settle
        // A break is recoverable; the device physically vanishing is not.
        // Chromium leaves readable null after a fatal NetworkError, and a bare
        // `!` here would surface that as an opaque TypeError — retried by the
        // caller's recovery loop — instead of naming the real cause.
        if (!port.readable) {
            throw new Ds2Error(
                'READ_FAILED',
                'The serial device disconnected — unplug and replug the cable, then reconnect.',
                { kind: 'electrical' },
            );
        }
        this.reader = port.readable.getReader();
        this.clearBuffer();
        this.pumpActive = true;
        this.startPump();
    }
}
