import type { LinkTiming } from './timing';

/**
 * The contract `Ds2Link` needs from whatever moves bytes.
 *
 * It was `WebSerialTransport` — the concrete class — for as long as there was only one. There is a
 * second backend now: Android Chrome exposes a `navigator.serial` that enumerates only Bluetooth
 * RFCOMM ports, so a USB K+DCAN cable is unreachable there and has to be driven over WebUSB with
 * the FTDI vendor protocol instead. Naming the contract is what lets a second backend exist without
 * `Ds2Link` knowing which one it has.
 *
 * **This is deliberately a description of the surface `Ds2Link` already calls, not a redesign of
 * it.** Every member below appears in link.ts today; nothing in that file changes.
 *
 * `setTiming` is OPTIONAL rather than required. The link attaches an instrument when it is given
 * one, but a backend that cannot measure — or that measures with its own instrument type — should
 * not have to supply a stub that lies about what it recorded. The call site uses `?.` accordingly.
 *
 * `reopen` / `reopenIsInPlace` are deliberately absent: baud switching is a capability of some
 * transports and a destructive-path concern of the caller. `Ds2Link` never initiates it —
 * `Ds2Control.REQUEST_BAUD_SWITCH` (0x91) exists in frame.ts and has no caller.
 *
 * The app this contract's backends come from does declare both, and its reasoning is worth keeping
 * even though the members are not: a Web Serial reopen is a close/open, which moves DTR and RTS
 * across the transition, and on some K+DCAN cables those lines gate the K-line transceiver — so the
 * one moment a baud change could desync the link is the moment an ECU is least able to survive it.
 * The FTDI backend has no such transition and says so. **That reasoning now lives beside each
 * backend's `reopen`, not here** — a guard deleted with no forwarding address is one that gets
 * re-litigated by the next reader.
 *
 * `setLatencyTimer` is likewise off the contract and kept as a concrete method on the FTDI class.
 * It is live — a datalog arms it — but `Ds2Link` must not know which backend it holds, so the hook
 * that owns the run boundary operates it instead.
 */
export interface Ds2ByteTransport {
    open(): Promise<void>;
    close(): Promise<void>;
    write(bytes: Uint8Array): Promise<void>;
    /** Reads exactly `length` bytes, waiting up to `timeoutMs`. Surplus stays buffered. */
    readExact(length: number, timeoutMs: number): Promise<Uint8Array>;
    /**
     * Discards buffered received bytes. **Synchronous by contract** — `resync` calls it without
     * awaiting and reads `bufferedLength()` immediately afterwards expecting zero.
     */
    purge(): void;
    bufferedLength(): number;
    hasReadError(): boolean;
    /** The latched error WITHOUT clearing it, so a caller can name the cause in its own message. */
    peekReadError(): Error | null;
    /**
     * Clears a latched read fault and restarts the receive path.
     *
     * `settleMs` exists because `Ds2Link.drainUntilQuiet` escalates it — a break that survives the
     * first attempt is given longer on the next — and a transport that hardcoded the wait would put
     * that number where the link's escalation cannot reach it.
     *
     * It is optional, not because a backend might have nothing to settle (both of them do: the
     * delay is sized to the break condition on the wire, not to anything about the host API), but
     * because a backend without a port transition to settle ACROSS may reasonably treat the figure
     * as advisory. What it may not do is ignore the wait itself.
     */
    recoverRead(settleMs?: number): Promise<void>;
    /**
     * Attach a timing instrument, if this backend can drive one.
     *
     * Optional because the two backends do not measure the same thing — only the FTDI path has a
     * latency timer — so their reported sample rates are not directly comparable, and a backend
     * with no instrument should say so by not implementing this rather than by recording zeros.
     */
    setTiming?(timing: LinkTiming | null): void;
}
