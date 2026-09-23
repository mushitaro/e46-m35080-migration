import { Ds2Error } from './errors';
import type { LinkTiming } from './timing';

/**
 * The half of a byte transport that has nothing to do with how the bytes arrive.
 *
 * A receive buffer, one parked reader, and `readExact`. Both backends need exactly this and it is
 * the same code in each — so it is lifted here rather than copied, and it was lifted rather than
 * copied for a specific reason: two copies would drift, and the drift would surface as an
 * intermittent framing fault in a car rather than as a failing check on a desk.
 *
 * Subclasses own the device. They call `receive()` when bytes land and `latch()` when the receive
 * path dies; everything else below is theirs to use, not to reimplement.
 *
 * Not exported from index.ts. This is an implementation seam, not API.
 */
export abstract class BufferedByteTransport {
    private buffer: number[] = [];
    /**
     * A single reader parked in readExact, woken by the receive path the moment enough bytes have
     * arrived.
     *
     * Replaces a setTimeout(2) polling loop. Browsers clamp nested timers to ~4 ms, so that loop
     * could sit on data that had already arrived for up to a full clamp period — three times per
     * DS2 exchange (echo, header, body). At 9600 the wire dominates and it hides; the faster the
     * rate, the larger that fixed cost looms, which is why raising the baud stopped producing a
     * speed-up.
     *
     * One waiter is enough: the transport is serialised by the link's command gate, so readExact is
     * never re-entered concurrently.
     */
    private waiter: { need: number; wake: () => void } | null = null;
    protected pumpError: Error | null = null;
    protected timing: LinkTiming | null = null;

    /** Attaches the instrument. The link owns exchange boundaries; the transport owns byte arrival,
     *  so both write into the same object. */
    setTiming(timing: LinkTiming | null): void {
        this.timing = timing;
    }

    // ---- subclass entry points ------------------------------------------------------------

    /**
     * Hand over bytes that have arrived from the device.
     *
     * **Callers must not invoke this for a zero-length arrival.** It is not a harmless no-op: it
     * timestamps an `rx` event, and on the FTDI backend the chip emits a two-byte status packet on
     * every latency-timer expiry whether or not it carries data — 62.5 of them a second at idle at
     * the 16 ms default. Those would be recorded as byte arrivals that never happened, and the
     * instrument's whole purpose is to tell "the ECU was thinking" apart from "the bytes were here
     * and we were slow to notice".
     */
    protected receive(bytes: Uint8Array | number[]): void {
        // Timestamped HERE, not in readExact: readExact only ever learns that enough bytes exist,
        // never when each arrived. Byte arrival times are the whole point.
        this.timing?.rx(now());
        for (let i = 0; i < bytes.length; i++) this.buffer.push(bytes[i]);
        this.signalWaiter();
    }

    /**
     * Record that the receive path has failed and can no longer deliver bytes.
     *
     * Wakes any parked reader as well, or it waits out its whole timeout for bytes that can never
     * arrive — turning a break into a multi-second stall.
     */
    protected latch(error: unknown): void {
        this.pumpError = error instanceof Error ? error : new Error(String(error));
        this.signalWaiter();
    }

    /** Drop everything buffered and clear the latch. For a subclass restarting its receive path. */
    protected clearBuffer(): void {
        this.buffer = [];
        this.pumpError = null;
    }

    /**
     * Releases a parked reader unconditionally. Used wherever the receive path it is waiting on is
     * about to be torn down: after that point no byte can ever arrive to wake it, so leaving it
     * parked would cost a full timeout for nothing.
     */
    protected releaseWaiter(): void {
        const w = this.waiter;
        if (w) {
            this.waiter = null;
            w.wake();
        }
    }

    /** Wakes the parked reader once its byte count is satisfiable — or once it can only fail. */
    private signalWaiter(): void {
        const w = this.waiter;
        if (w && (this.buffer.length >= w.need || this.pumpError)) {
            this.waiter = null;
            w.wake();
        }
    }

    // ---- the contract's buffer side -------------------------------------------------------

    /** Discards buffered bytes — used to resynchronise after a timeout before retrying. */
    purge(): void {
        // No waiter can be parked here: purge runs between exchanges, and the link's command gate
        // makes those strictly sequential. Emptying the buffer under a parked reader would strand
        // it until its deadline, so if that invariant ever changes this needs a signalWaiter().
        this.buffer = [];
    }

    /**
     * How many received bytes are waiting. Lets a caller tell whether the line has gone quiet
     * (buffer stays empty across a pause) before starting a fresh exchange, rather than purging
     * into a stream that is still arriving.
     */
    bufferedLength(): number {
        return this.buffer.length;
    }

    /** True if the receive path has latched an error — most often a serial break. */
    hasReadError(): boolean {
        return this.pumpError !== null;
    }

    /**
     * The latched error, WITHOUT clearing it, so a caller can name the cause in its own message.
     *
     * Deliberately non-consuming: clearing the latch here would make hasReadError() report false,
     * and a resync would then purge() instead of recoverRead() — leaving the dead receive path
     * unrestarted, which is strictly worse than not looking at all.
     */
    peekReadError(): Error | null {
        return this.pumpError;
    }

    /**
     * Reads exactly `length` bytes, waiting up to `timeoutMs`.
     *
     * **Wait for bytes, never for a clock.** The park below is how often we look, not how long we
     * wait — it returns the instant the bytes land. Surplus bytes received alongside are RETAINED
     * for the next call, never dropped: that is what stops an echo and a response arriving in one
     * chunk from desyncing the stream.
     *
     * If you find yourself adding a delay so a response "has time to arrive", the bug is in the
     * wait, not in the timing.
     */
    async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
        const deadline = Date.now() + timeoutMs;
        while (this.buffer.length < length) {
            // Name the error class: a BreakError/FramingError (recoverable, the signature of a
            // disturbed K-line) and a NetworkError (device gone) otherwise read identically. Both
            // backends spell these the same way on purpose — see FtdiLineError.
            if (this.pumpError) {
                throw new Ds2Error(
                    'READ_FAILED',
                    `Serial read failed: ${this.pumpError.name} (${this.pumpError.message})`,
                    {
                        kind: 'electrical',
                        detail: { errorName: this.pumpError.name },
                        cause: this.pumpError,
                    },
                );
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Ds2Error(
                    'READ_TIMEOUT',
                    `Timed out waiting for ${length} byte(s) (received ${this.buffer.length})`,
                    {
                        kind: 'timeout',
                        detail: { expected: length, received: this.buffer.length, timeoutMs },
                    },
                );
            }
            // Park until the receive path says the bytes are here, or the deadline passes —
            // whichever first. The loop re-checks afterwards, so a spurious wake costs one
            // comparison.
            //
            // Parked time is measured because it is the honest accounting of "waiting for the wire"
            // versus "us being slow": if parked time is close to the total, the bytes genuinely
            // were not here yet and no host-side change helps.
            this.timing?.parkStart(now());
            await new Promise<void>((resolve) => {
                // The entry is compared by identity below rather than by its callback, so the
                // deadline only ever clears the waiter it actually created — never one a later
                // readExact installed.
                const entry = {
                    need: length,
                    wake: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                };
                const timer = setTimeout(() => {
                    if (this.waiter === entry) this.waiter = null;
                    resolve();
                }, remaining);
                this.waiter = entry;
            });
            this.timing?.parkEnd(now());
        }
        return Uint8Array.from(this.buffer.splice(0, length));
    }
}

export function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function describeError(e: unknown): string {
    return e instanceof Error ? `${e.name} (${e.message})` : String(e);
}
