/**
 * Which backend can reach a car from this browser.
 *
 * Its own file, and not part of `byteTransport.ts`, on purpose. That module is types only, so
 * importing the contract costs nothing. A factory there would bind the interface to both concrete
 * classes, and a test that only wanted the type would start loading the FTDI module — and with it
 * that module's load-time divisor assertion.
 */

import { Ds2Error } from './errors';
import type { Ds2ByteTransport } from './byteTransport';
import { WebSerialTransport } from './transport';
import { WebUsbFtdiTransport } from './webUsbFtdiTransport';

/**
 * 'none' is a real answer rather than an error. Everything that reads recorded data — a saved
 * datalog, a fault report — works with no cable and no transport at all, so this gates the live
 * features and nothing else.
 */
export type TransportKind = 'web-serial' | 'web-usb-ftdi' | 'none';

/**
 * Everything the choice depends on, gathered in one place so the decision can be made in a test
 * without a browser. `readTransportEnv()` fills it from the globals; nothing else here touches them.
 */
export interface TransportEnv {
    /** `location.search`, or null when there is no document (static prerender). */
    search: string | null;
    android: boolean;
    webSerial: boolean;
    webUsb: boolean;
}

/**
 * True on Android, which is the one platform where capability detection cannot decide for us.
 *
 * `userAgentData.platform` is Chromium's own structured answer and is not subject to the UA-string
 * freezing games; the regex is the fallback for engines that do not expose it.
 */
export function isAndroidPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    if (uaData?.platform) return uaData.platform === 'Android';
    return /android/i.test(navigator.userAgent);
}

export function readTransportEnv(): TransportEnv {
    // Static prerender: neither API can exist, and answering anything else here would bake a wrong
    // decision into the exported HTML. Callers resolve this after mount.
    if (typeof navigator === 'undefined' || typeof location === 'undefined') {
        return { search: null, android: false, webSerial: false, webUsb: false };
    }
    return {
        search: location.search,
        android: isAndroidPlatform(),
        webSerial: WebSerialTransport.isSupported(),
        webUsb: WebUsbFtdiTransport.isSupported(),
    };
}

/**
 * Picks the backend for this browser.
 *
 * **This is the one place in the app that looks at the platform rather than at a capability, and it
 * has to.** Chrome for Android 138+ exposes `navigator.serial`, so `'serial' in navigator` is true
 * there — but it enumerates *only* Bluetooth RFCOMM serial-port emulation, and a USB K+DCAN cable
 * never appears in its picker. There is no feature test that separates "Web Serial that can see USB
 * adapters" from "Web Serial that can see only Bluetooth SPP": both objects are identical, and the
 * difference shows up as an empty chooser after the user has already tapped through a permission
 * prompt. So Android is asked by name and routed to WebUSB.
 *
 * `?transport=webusb` / `?transport=webserial` overrides the choice. It costs nothing on a static
 * export, and it is what lets the WebUSB path be driven from a desktop bench rig — which matters a
 * great deal when the alternative is testing a new byte transport for the first time in a car.
 *
 * A forced backend that is not available answers 'none' rather than falling back. Someone who typed
 * the parameter is testing that specific path; silently giving them the other one would let a bench
 * session "pass" against the backend it was meant to exercise.
 */
export function detectTransportKind(env: TransportEnv = readTransportEnv()): TransportKind {
    if (env.search === null) return 'none';

    const forced = new URLSearchParams(env.search).get('transport');
    if (forced === 'webusb') return env.webUsb ? 'web-usb-ftdi' : 'none';
    if (forced === 'webserial') return env.webSerial ? 'web-serial' : 'none';

    if (env.android) return env.webUsb ? 'web-usb-ftdi' : 'none';
    return env.webSerial ? 'web-serial' : 'none';
}

/**
 * Builds the transport this browser can actually use, and says which one it is.
 *
 * Detection happens HERE rather than being passed in, so the decision is made at connect time — a
 * phone that gains an OTG adapter between page load and the first tap does not need a reload.
 *
 * The kind comes back with it because the caller has to name the backend in the connect log. A
 * session that says "Web Serial" while running over WebUSB makes every later measurement in that
 * log unattributable, and the two backends do not measure the same thing.
 *
 * PRACTICE mode does not come through here. It constructs a `WebSerialTransport` around a simulated
 * port directly, which is the point: the simulator drives the real transport class rather than a
 * mock of it.
 */
export function createDs2Transport(env: TransportEnv = readTransportEnv()): {
    kind: Exclude<TransportKind, 'none'>;
    transport: Ds2ByteTransport;
} {
    const kind = detectTransportKind(env);
    switch (kind) {
        case 'web-serial':
            return { kind, transport: new WebSerialTransport() };
        case 'web-usb-ftdi':
            return { kind, transport: new WebUsbFtdiTransport() };
        default:
            throw new Ds2Error(
                'PORT_UNSUPPORTED',
                'No serial transport is available in this browser. Chrome or Edge is required on ' +
                    'desktop; on Android, Chrome with a USB OTG adapter.',
                { kind: 'protocol' },
            );
    }
}

/** A backend that can trade idle wakeups for response latency. Only the FTDI one has the knob. */
interface LatencyTunable {
    setLatencyTimer(mode: 'log' | 'idle'): Promise<void>;
}

/**
 * The latency timer, if this backend has one — otherwise null.
 *
 * Asked of the OBJECT rather than with `instanceof`, so the caller never has to import the FTDI
 * class to find out. That matters more than it looks: the hook operates this at a run boundary,
 * and the whole reason the knob is off `Ds2ByteTransport` is that `Ds2Link` must not know which
 * backend it is holding. A hook that reached for the class would put that knowledge back one layer
 * up.
 *
 * Null is a real answer. Web Serial exposes no equivalent at all, so a run there gets whatever the
 * driver does — which is worth stating, because it means the two backends' measured sample rates
 * are not directly comparable.
 */
export function latencyTimerOf(transport: Ds2ByteTransport): ((mode: 'log' | 'idle') => Promise<void>) | null {
    const fn = (transport as Partial<LatencyTunable>).setLatencyTimer;
    return typeof fn === 'function' ? fn.bind(transport) : null;
}
