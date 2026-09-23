/**
 * WebUSB API types, as explicit exports rather than ambient globals.
 *
 * WebUSB is NOT in TypeScript's DOM lib (checked against the version pinned here), so something has
 * to declare it. The app this came from does it in a .d.ts that augments the global `Navigator`,
 * which is fine inside one app and wrong in a package: a consumer with its own WebUSB declarations
 * — or a future DOM lib that ships them — collides with ours, and the failure surfaces as a
 * duplicate-identifier error in someone else's build. Same reasoning as webSerialTypes.ts.
 *
 * The source file also declared `WakeLock` / `WakeLockSentinel`. Those ARE in the DOM lib here, so
 * they are dropped rather than carried across. Shadowing a lib type with a hand-written copy is how
 * a narrower-than-real signature gets believed: our copy would be the one type-checked against, and
 * it would keep passing after the real API grew a member we never wrote down.
 *
 * Covers only what this package uses.
 */

export interface USBEndpoint {
    readonly endpointNumber: number;
    readonly direction: 'in' | 'out';
    readonly type: 'bulk' | 'interrupt' | 'isochronous';
    readonly packetSize: number;
}

export interface USBAlternateInterface {
    readonly alternateSetting: number;
    readonly interfaceClass: number;
    readonly endpoints: USBEndpoint[];
}

export interface USBInterface {
    readonly interfaceNumber: number;
    readonly alternate: USBAlternateInterface;
    readonly alternates: USBAlternateInterface[];
    readonly claimed: boolean;
}

export interface USBConfiguration {
    readonly configurationValue: number;
    readonly interfaces: USBInterface[];
}

export interface USBControlTransferParameters {
    requestType: 'standard' | 'class' | 'vendor';
    recipient: 'device' | 'interface' | 'endpoint' | 'other';
    request: number;
    value: number;
    index: number;
}

export type USBTransferStatus = 'ok' | 'stall' | 'babble';

export interface USBInTransferResult {
    readonly data?: DataView;
    readonly status?: USBTransferStatus;
}

export interface USBOutTransferResult {
    readonly bytesWritten: number;
    readonly status?: USBTransferStatus;
}

export interface USBDevice {
    readonly vendorId: number;
    readonly productId: number;
    /** bcdDevice high byte — libftdi's own way of telling FT232R (6) from FT232BM (4), 232H (9), etc. */
    readonly deviceVersionMajor: number;
    readonly deviceVersionMinor: number;
    readonly manufacturerName?: string;
    readonly productName?: string;
    readonly serialNumber?: string;
    readonly opened: boolean;
    readonly configuration: USBConfiguration | null;
    readonly configurations: USBConfiguration[];
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult>;
    // ArrayBufferView rather than BufferSource: TypeScript 5.7 made typed arrays generic over their
    // backing buffer, so a plain Uint8Array is Uint8Array<ArrayBufferLike> and no longer assignable
    // to BufferSource. The spec accepts any view; this says so without forcing casts at call sites.
    controlTransferOut(setup: USBControlTransferParameters, data?: ArrayBufferView | ArrayBuffer): Promise<USBOutTransferResult>;
    transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
    transferOut(endpointNumber: number, data: ArrayBufferView | ArrayBuffer): Promise<USBOutTransferResult>;
    clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
    reset(): Promise<void>;
}

export interface USBConnectionEvent extends Event {
    readonly device: USBDevice;
}

export interface USBDeviceFilter {
    vendorId?: number;
    productId?: number;
    classCode?: number;
}

/**
 * Deliberately NOT `extends EventTarget`, even though the real `USB` is one.
 *
 * Narrowing `addEventListener` to the two USB event names is the point of writing it out — but
 * the base signature accepts `EventListenerOrEventListenerObject | null`, so a narrowed override
 * is not assignable to it under strictNullChecks and the extends clause fails to compile. The
 * source app's copy did not hit this because it declared the interface globally, in a project
 * whose checking was looser.
 *
 * Nothing here calls `dispatchEvent`, so the base buys nothing that is worth losing the narrowing
 * for: with it, a typo in the event name is a compile error rather than a listener that is never
 * called — which is exactly how a pulled cable would go unnoticed.
 */
export interface USBLike {
    getDevices(): Promise<USBDevice[]>;
    requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
    addEventListener(
        type: 'connect' | 'disconnect',
        listener: (event: USBConnectionEvent) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
        type: 'connect' | 'disconnect',
        listener: (event: USBConnectionEvent) => void,
        options?: boolean | EventListenerOptions,
    ): void;
}

/**
 * `navigator.usb`, or undefined.
 *
 * Present is not the same as usable, and the two failures look identical from the UI:
 *
 * - **Secure context.** WebUSB is gated on one, and `http://localhost` qualifies while a LAN IP
 *   does NOT. Opening the dev server from a phone by its 192.168.x.x address gives a page where
 *   this returns undefined and nothing explains why. That is the single easiest way to lose an
 *   afternoon at the bench.
 * - **Permissions-Policy.** `usb=()` is an EMPTY allowlist, not an absent restriction. The object
 *   below still exists; it is `requestDevice()` that rejects with SecurityError, on the deployed
 *   origin only, indistinguishable from the user dismissing the picker. This project shipped that
 *   header — see the comment above the directive in `public/_headers`.
 *
 * So a true from isWebUsbSupported() means the API is reachable, never that a device can be
 * obtained. `/usb-check` exists because only an actual attempt answers the second question.
 */
export function getUsb(): USBLike | undefined {
    if (typeof navigator === 'undefined') return undefined;
    return (navigator as Navigator & { usb?: USBLike }).usb;
}

export function isWebUsbSupported(): boolean {
    return getUsb() !== undefined;
}
