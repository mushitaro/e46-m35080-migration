/**
 * A simulated FT232R, and the `navigator.usb` it hangs off.
 *
 * Same principle as `simulator.ts`: this is NOT a mock of the transport. It stands in for the
 * DEVICE, so the tests drive the real `WebUsbFtdiTransport` through it. What that buys here is
 * specific — the FTDI framing is the part of this backend that cannot be checked by reading it:
 *
 *   - every bulk IN **packet** carries a two-byte status header, so with a multi-packet transfer
 *     the headers are *interior*. A transport that strips only offset 0 produces plausible data
 *     with two bytes of garbage every 64 and never says so. Only a simulator that packetises
 *     properly can fail that.
 *   - a short packet TERMINATES a bulk transfer, so every packet except the last is full. The
 *     transport's `offset += packetSize` walk depends on it, and this simulator enforces it rather
 *     than assuming the transport is right.
 *   - the chip emits a bare status packet on every latency-timer expiry whether or not it has
 *     data. That is what lets `pumpActive = false` stop the read loop with no transfer to cancel,
 *     and it is also the ghost-`rx` hazard that the base class's receive() precondition exists for.
 *     A simulator that only answers when it has bytes would hide both.
 *
 * `statusPeriodMs` stands for the latency timer and defaults to 1 ms so the suite stays fast. The
 * real default is 16. Nothing in the transport reads it back, so shortening it changes speed only.
 */

import type {
    USBAlternateInterface,
    USBConfiguration,
    USBControlTransferParameters,
    USBConnectionEvent,
    USBDevice,
    USBInTransferResult,
    USBInterface,
    USBLike,
    USBOutTransferResult,
    USBTransferStatus,
} from './webUsbTypes';

/** One vendor control request, as the device saw it. Tests assert on the ORDER of these. */
export interface ControlRecord {
    request: number;
    value: number;
    index: number;
}

export interface SimulatedFtdiOptions {
    /** bcdDevice major. 6 = FT232R (accepted); 9 = FT232H (must be refused). */
    deviceVersionMajor?: number;
    packetSize?: number;
    /** Omit the bulk endpoint pair, the way a non-FTDI device would. */
    bulkEndpoints?: boolean;
    /** Stands in for the latency timer — how long an otherwise-empty transferIn waits. */
    statusPeriodMs?: number;
    vendorId?: number;
    manufacturerName?: string;
    /** Called with everything written to the bulk OUT endpoint. This is the seam a DS2 slave hangs
     *  off — see simulatedFtdiEcu. */
    onWrite?: (bytes: Uint8Array) => void;
}

interface Emission {
    bytes: Uint8Array;
    lineStatus: number;
}

/** Modem-status byte. The transport ignores byte 0 entirely; a non-zero value here is deliberate,
 *  so a transport that ever started reading it would not get a convenient 0. */
const MODEM_STATUS = 0x31;

export class SimulatedFtdiDevice implements USBDevice {
    readonly vendorId: number;
    readonly productId = 0x6001;
    readonly deviceVersionMajor: number;
    readonly deviceVersionMinor = 0;
    readonly manufacturerName: string;
    readonly productName = 'FT232R USB UART';
    readonly serialNumber = 'SIM00001';
    opened = false;
    configuration: USBConfiguration | null = null;
    readonly configurations: USBConfiguration[];

    /** Every vendor control request, in order. The open() sequence is asserted against this. */
    readonly control: ControlRecord[] = [];
    /** Everything written to the bulk OUT endpoint. */
    readonly written: Uint8Array[] = [];
    readonly claimed: number[] = [];
    readonly released: number[] = [];
    readonly halts: string[] = [];
    closeCount = 0;

    /** One-shot fault for the next transferIn. */
    nextTransferIn: USBTransferStatus | 'throw' | null = null;

    private readonly packetSize: number;
    private readonly statusPeriodMs: number;
    private readonly onWrite?: (bytes: Uint8Array) => void;
    private emissions: Emission[] = [];
    private pendingLatch = 0;
    private idleCount = 0;
    private idleWaiters: Array<{ need: number; resolve: () => void }> = [];

    constructor(opts: SimulatedFtdiOptions = {}) {
        this.vendorId = opts.vendorId ?? 0x0403;
        this.deviceVersionMajor = opts.deviceVersionMajor ?? 6;
        this.manufacturerName = opts.manufacturerName ?? 'FTDI';
        this.packetSize = opts.packetSize ?? 64;
        this.statusPeriodMs = opts.statusPeriodMs ?? 1;
        this.onWrite = opts.onWrite;
        const endpoints = (opts.bulkEndpoints ?? true)
            ? [
                  { endpointNumber: 1, direction: 'in' as const, type: 'bulk' as const, packetSize: this.packetSize },
                  { endpointNumber: 2, direction: 'out' as const, type: 'bulk' as const, packetSize: this.packetSize },
              ]
            : [{ endpointNumber: 3, direction: 'in' as const, type: 'interrupt' as const, packetSize: 8 }];
        const alternate: USBAlternateInterface = { alternateSetting: 0, interfaceClass: 0xff, endpoints };
        const iface: USBInterface = { interfaceNumber: 0, alternate, alternates: [alternate], claimed: false };
        this.configurations = [{ configurationValue: 1, interfaces: [iface] }];
    }

    // ---- test controls -------------------------------------------------------------------

    /** Queue bytes for the wire. They are packetised on the way out, exactly as the chip would. */
    pushBytes(bytes: ArrayLike<number>): void {
        this.emissions.push({ bytes: Uint8Array.from(bytes), lineStatus: 0 });
    }

    /**
     * Queue a packet carrying LSR bits.
     *
     * Note what a caller has to arrange to exercise "deliver what arrived before the fault": the
     * preceding packet must be exactly full, because a short packet ends the transfer. Push
     * `packetSize - 2` bytes first.
     */
    pushLineStatus(lineStatus: number, bytes: ArrayLike<number> = []): void {
        this.emissions.push({ bytes: Uint8Array.from(bytes), lineStatus });
    }

    /**
     * Set the LSR bits the chip reports on its NEXT packet, then forgets.
     *
     * This is what "latched since last read" means on real hardware, and it is the whole reason
     * `skipLineStatusOnce` exists: after a break is repaired, the first packet back still carries
     * the break that has already been dealt with. A simulator that only reported faults on demand
     * could not tell a working guard from a missing one.
     */
    latchLineStatus(bits: number): void {
        this.pendingLatch = bits;
    }

    /** Resolves once the device has answered `n` transferIns with a bare status packet — i.e. the
     *  read loop is running and idle. Sequencing a fault after this makes `skipLineStatusOnce`
     *  deterministic instead of a race with the first packet. */
    waitForIdle(n = 1): Promise<void> {
        if (this.idleCount >= n) return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.push({ need: n, resolve }));
    }

    /** What the chip's own FIFO still holds. `flushReceive` must empty it. */
    queuedEmissions(): number {
        return this.emissions.length;
    }

    // ---- USBDevice ------------------------------------------------------------------------

    async open(): Promise<void> {
        this.opened = true;
    }

    async close(): Promise<void> {
        this.opened = false;
        this.closeCount++;
    }

    async selectConfiguration(value: number): Promise<void> {
        this.configuration = this.configurations.find((c) => c.configurationValue === value) ?? null;
    }

    async claimInterface(n: number): Promise<void> {
        this.claimed.push(n);
    }

    async releaseInterface(n: number): Promise<void> {
        this.released.push(n);
    }

    async controlTransferIn(): Promise<USBInTransferResult> {
        return { status: 'ok', data: new DataView(new ArrayBuffer(0)) };
    }

    // No `data` parameter: every FTDI vendor request this transport makes carries its argument in
    // the setup packet's value/index, never in a data stage. TypeScript allows the narrower
    // implementation, and a parameter that exists only to be ignored is one a reader has to check.
    async controlTransferOut(setup: USBControlTransferParameters): Promise<USBOutTransferResult> {
        this.control.push({ request: setup.request, value: setup.value, index: setup.index });
        // SIO_RESET with the corrected PURGE_RX sub-command empties the receive FIFO. Modelled
        // because /usb-check's loopback check is precisely "queue bytes, flush, confirm they are
        // gone", and a flush with the wrong polarity would otherwise pass every test on this bench.
        if (setup.request === 0x00 && setup.value === 2) this.emissions = [];
        return { bytesWritten: 0, status: 'ok' };
    }

    async transferOut(endpointNumber: number, data: ArrayBufferView | ArrayBuffer): Promise<USBOutTransferResult> {
        const view =
            data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const copy = Uint8Array.from(view);
        this.written.push(copy);
        this.onWrite?.(copy);
        void endpointNumber;
        return { bytesWritten: view.byteLength, status: 'ok' };
    }

    async transferIn(_endpointNumber: number, length: number): Promise<USBInTransferResult> {
        const fault = this.nextTransferIn;
        this.nextTransferIn = null;
        if (fault === 'throw') throw new DOMException('simulated transfer failure', 'NetworkError');
        if (fault) return { status: fault, data: new DataView(new ArrayBuffer(0)) };

        if (this.emissions.length === 0) {
            await new Promise((r) => setTimeout(r, this.statusPeriodMs));
            this.idleCount++;
            for (const w of this.idleWaiters.filter((w) => this.idleCount >= w.need)) w.resolve();
            this.idleWaiters = this.idleWaiters.filter((w) => this.idleCount < w.need);
            // A bare status packet: header only, no data. The transport must NOT report this as an
            // arrival — see the receive() precondition in BufferedByteTransport.
            return { status: 'ok', data: this.statusPacket(this.takeLatch()) };
        }
        return { status: 'ok', data: this.packetise(length) };
    }

    async clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void> {
        this.halts.push(`${direction}:${endpointNumber}`);
    }

    async reset(): Promise<void> {}

    // ---- FTDI packet framing ---------------------------------------------------------------

    private takeLatch(): number {
        const bits = this.pendingLatch;
        this.pendingLatch = 0;
        return bits;
    }

    private statusPacket(lineStatus: number): DataView {
        const p = new Uint8Array([MODEM_STATUS, lineStatus]);
        return new DataView(p.buffer);
    }

    /**
     * Builds one bulk IN transfer out of the queued emissions.
     *
     * Two rules from the wire, both enforced rather than assumed: each packet is capped at
     * `packetSize` INCLUDING its two header bytes, and a short packet ends the transfer.
     */
    private packetise(maxLength: number): DataView {
        const maxPackets = Math.max(1, Math.floor(maxLength / this.packetSize));
        const room = this.packetSize - 2;
        const packets: Uint8Array[] = [];
        while (packets.length < maxPackets && this.emissions.length > 0) {
            const em = this.emissions[0];
            const take = Math.min(room, em.bytes.length);
            const packet = new Uint8Array(2 + take);
            packet[0] = MODEM_STATUS;
            packet[1] = em.lineStatus | (packets.length === 0 ? this.takeLatch() : 0);
            packet.set(em.bytes.subarray(0, take), 2);
            packets.push(packet);
            if (take === em.bytes.length) this.emissions.shift();
            else em.bytes = em.bytes.subarray(take);
            if (packet.length < this.packetSize) break; // a short packet terminates the transfer
        }
        const total = packets.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const p of packets) {
            out.set(p, at);
            at += p.length;
        }
        return new DataView(out.buffer);
    }
}

/** A `navigator.usb` standing in front of some simulated devices. */
export class SimulatedUsb implements USBLike {
    requestDeviceCalls = 0;
    /** Set to reject requestDevice the way a dismissed chooser does. */
    dismissChooser = false;

    private listeners = new Set<(e: USBConnectionEvent) => void>();

    constructor(
        private readonly granted: USBDevice[] = [],
        private readonly offered: USBDevice | null = null,
    ) {}

    async getDevices(): Promise<USBDevice[]> {
        return [...this.granted];
    }

    async requestDevice(): Promise<USBDevice> {
        this.requestDeviceCalls++;
        if (this.dismissChooser || !this.offered) {
            throw new DOMException('No device selected.', 'NotFoundError');
        }
        return this.offered;
    }

    addEventListener(_type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void {
        this.listeners.add(listener);
    }

    removeEventListener(_type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void {
        this.listeners.delete(listener);
    }

    /** Fires the 'disconnect' the browser fires when the cable is pulled. */
    disconnect(device: USBDevice): void {
        const event = { device, type: 'disconnect' } as unknown as USBConnectionEvent;
        for (const l of [...this.listeners]) l(event);
    }

    listenerCount(): number {
        return this.listeners.size;
    }
}
