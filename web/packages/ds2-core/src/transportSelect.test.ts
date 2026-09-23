import { describe, expect, it } from 'vitest';
import { createDs2Transport, detectTransportKind, type TransportEnv } from './transportSelect';
import { WebSerialTransport } from './transport';
import { WebUsbFtdiTransport } from './webUsbFtdiTransport';

const env = (over: Partial<TransportEnv> = {}): TransportEnv => ({
    search: '',
    android: false,
    webSerial: true,
    webUsb: true,
    ...over,
});

describe('detectTransportKind', () => {
    it('uses Web Serial on a desktop that has it', () => {
        expect(detectTransportKind(env({ android: false, webUsb: false }))).toBe('web-serial');
    });

    it('routes Android to WebUSB even though navigator.serial exists there', () => {
        // The case the whole module exists for. Chrome for Android exposes a Web Serial that
        // enumerates only Bluetooth RFCOMM, so preferring it would give the user an empty chooser
        // after they had already granted permission — and no feature test tells the two apart.
        expect(detectTransportKind(env({ android: true, webSerial: true }))).toBe('web-usb-ftdi');
    });

    it('answers none on Android with no WebUSB rather than falling back to a picker that cannot see the cable', () => {
        expect(detectTransportKind(env({ android: true, webUsb: false }))).toBe('none');
    });

    it('lets ?transport=webusb drive the FTDI path from a desktop bench', () => {
        expect(detectTransportKind(env({ search: '?transport=webusb' }))).toBe('web-usb-ftdi');
    });

    it('lets ?transport=webserial pin Android back to Web Serial', () => {
        expect(detectTransportKind(env({ search: '?transport=webserial', android: true }))).toBe('web-serial');
    });

    it.each([
        ['?transport=webusb', { webUsb: false }],
        ['?transport=webserial', { webSerial: false }],
    ])('answers none for %s when that backend is missing, instead of quietly using the other', (search, missing) => {
        // Someone who typed the parameter is testing that specific path. A silent fallback would let
        // a bench session pass against the backend it was meant to exercise.
        expect(detectTransportKind(env({ search, ...missing }))).toBe('none');
    });

    it('answers none during a static prerender', () => {
        // Not "unsupported browser" — there is no browser yet. Baking that answer into the exported
        // HTML would ship a page that says the cable cannot work before it has looked.
        expect(detectTransportKind(env({ search: null, webSerial: true, webUsb: true }))).toBe('none');
    });
});

describe('createDs2Transport', () => {
    it('builds the backend it named', () => {
        const serial = createDs2Transport(env({ webUsb: false }));
        expect(serial.kind).toBe('web-serial');
        expect(serial.transport).toBeInstanceOf(WebSerialTransport);

        const usb = createDs2Transport(env({ android: true }));
        expect(usb.kind).toBe('web-usb-ftdi');
        expect(usb.transport).toBeInstanceOf(WebUsbFtdiTransport);
    });

    it('refuses with a coded error when nothing can reach a car', () => {
        expect(() => createDs2Transport(env({ webSerial: false, webUsb: false }))).toThrowError(
            expect.objectContaining({ code: 'PORT_UNSUPPORTED' }),
        );
    });
});
