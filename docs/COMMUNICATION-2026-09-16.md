# Communication repair — 2026-09-16

## Observed cause

The Arduino UNO appeared as COM7 (USB VID 2341, PID 0043), with no Windows
device error. Its installed program did not contain the bridge's `M35080BR`
identifier. At 115200 baud it emitted repeating bytes instead of a valid
bridge response. USB reconnection alone could not install the required sketch.

The previous ATmega328P flash was read before replacement and saved locally as
`.diagnostics/uno-before-bridge-20260916.hex` (32,768 bytes of flash in Intel HEX).
SHA-256 of the decoded flash:
`537705760d4588444c34928c69636399aa4da544325898c2431bba4698db1c88`.

## Device repair and verification

- Compiled the existing `firmware/m35080_bridge/m35080_bridge.ino` for
  `arduino:avr:uno`, using Arduino AVR Boards 1.8.8.
- Uploaded 3,806 bytes to the UNO and verified all 3,806 bytes with AVRDUDE.
- Opened COM7 at the app's 115200 8N1 settings, with DTR and RTS false.
- Sent three PING frames; all three returned the same 26-byte response:
  `7E010013004D333530383042520101008000200020000004840C`.
- The application's codec accepts its CRC, bridge magic, protocol v1, firmware
  1.0, 128-byte reads, 32-byte writes/pages, and 1,024-byte image size.

No M35080 read/write command, odometer change, or VIN change was sent.
The browser connection still needs confirmation from the user.

## Local application changes

Failed connections now release the port and stream locks. Failed firmware
handshakes include guidance about the UNO port and required bridge sketch;
errors wrap so that the guidance is visible. Four real-Web-Streams lifecycle
tests cover timeout/reconnection, protocol mismatch, open failure, and normal
disconnect. Before the fix, the timeout and protocol mismatch tests failed
because the port was never closed.

Validation: 187 tests passed; TypeScript and the production build passed.
These application changes are local only; the public site was not deployed.
