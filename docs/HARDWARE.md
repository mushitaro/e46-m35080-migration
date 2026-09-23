# Hardware — bench setup

Out-of-circuit: the M35080 is desoldered from the cluster, seated in a SOP8→DIP8
adapter on a breadboard, and driven by an Arduino UNO running the bridge firmware.

## Why out-of-circuit

In-circuit, the cluster's own microcontroller stays attached to the same C/D/Q/S
lines and can drive the bus against the programmer, corrupting reads and writes.
Powering the chip also means partially powering the board, with backfeed through
I/O pins. On the bench the chip sees only your 5 V and only your SPI master, which
is what makes a read → verify → write cycle repeatable — and that matters most for
the blank-chip Reset path, where the value has to land exactly once.

## Bill of materials

| Item | Note |
|---|---|
| Arduino UNO (or any 5 V AVR with SPI) | **5 V logic is the point** — see the ESP32 warning below |
| **SOP8 → DIP8 adapter, 150 mil** | The M35080 SO8 body is **150 mil narrow**. **Not** the 200/208 mil wide version. |
| Breadboard + jumper wires | |
| 0.1 µF ceramic capacitor | Decoupling, across chip pins 8↔1, physically close |
| 10 kΩ resistor | Pull-up on S (chip select) |

A no-solder clamshell ("EZ") 150 mil adapter is the practical choice — the chip
drops in and out, so you can re-seat and re-read freely.

### About the OTS-16-1.27-03 socket

Two things to know before buying one for this job:

- A plain **OTS-16-1.27-03 has 16 contacts** (1.27 mm pitch, "-03" = 3.9 mm narrow
  body). An 8-pin SO8 only lands on 8 of them and registers poorly. The SO8 member
  of the family is the **OTS-8(16)-1.27-03**.
- OTS sockets are **soldered onto a programmer PCB**; they have no 0.1″ legs and do
  not plug into a breadboard.

So for breadboard work the **SOP8→DIP8 adapter is the actual chip carrier**. The OTS
socket is only worth it if you build a dedicated programmer board.

## Pinout — the M35080 is NOT a standard 25xx

This is the mistake that costs a chip. Only VCC (pin 8) is where a generic SO8 SPI
EEPROM guide would put it. **GND is pin 1**, and there is **no HOLD pin**.

| M35080 pin | Signal | Function | UNO |
|---|---|---|---|
| 1 | VSS | Ground | GND |
| 2 | S | Chip select (active low) | D10 |
| 3 | W | Write protect (active low) | D9 |
| 4 | Q | Data out (MISO) | D12 |
| 5 | NC | *not connected* | leave open |
| 6 | C | Clock (SCK) | D13 |
| 7 | D | Data in (MOSI) | D11 |
| 8 | VCC | +5 V | 5V |

```
        M35080 (SO8, top view, notch left)
        ┌───────∪───────┐
  VSS 1 │●              │ 8 VCC   ── +5V
    S 2 │               │ 7 D     ── MOSI (D11)
    W 3 │               │ 6 C     ── SCK  (D13)
    Q 4 │               │ 5 NC    ── (open)
        └───────────────┘
   GND ──┘   │   │   └── MISO (D12)
           D10  D9
```

### Powering the UNO

**The UNO is powered by the USB cable to your PC** — the same cable that carries
the serial link. There is no separate supply to connect. Its `5V` header pin is
an **output**, and that is what feeds the chip:

```
PC ──USB (power + data)──> Arduino UNO ──5V pin (output)──> M35080
```

### On a breadboard

Two facts do the work, and a diagram that hides them cannot be traced:

- **Five holes in a column are one node.** A jumper does not have to land on the
  chip's own hole to reach that pin — anywhere in the same column group works.
- **Each power rail is one node along its length.**

So the practical build is rail-based:

| Wire | From | To |
|---|---|---|
| 5V | UNO `5V` | top red rail |
| GND | UNO `GND` | top blue rail |
| link | top red rail | bottom red rail |
| link | top blue rail | bottom blue rail |
| VCC | pin 8's column | red rail |
| VSS | pin 1's column | blue rail |

### Passives

- **0.1 µF** between the red and blue rails, beside the chip. Electrically this
  is across pins 8 and 1; on a breadboard the rails are where the legs fit.
- **10 kΩ pull-up** from pin 2 (S)'s column up to the red rail — keeps the chip
  deselected while the UNO resets. The datasheet also wants a high→low
  transition on S after power-on before any operation, so a defined idle-high
  state matters.
- **W must never float.** It is driven from D9 by the firmware.
- **Nothing on pin 5.** It is NC, not HOLD — do not tie it high.

### Electrical

- Supply **4.5–5.5 V**. The UNO's 5 V rail powers the chip directly.
- Current is a few mA; budget ≤10 mA of headroom.
- SPI **Mode 0**, MSB-first, ≤5 MHz. The firmware runs **1 MHz**: at 3 MHz a bench read differed
  from a programmer's dump of the same chip on 3 of 1024 bytes, and jumper wires are not a PCB.

## ⚠ Do not drive it from a 3.3 V board without level shifting

The M35080's minimum VCC is **4.5 V**, so it has to run at ~5 V. An ESP32 / RP2040 /
Pi Pico is 3.3 V and **not 5 V tolerant** — the chip's Q output at 5 V driving a
3.3 V input can damage the MCU. Those boards need level shifting on C, D, S, W and
especially Q. The UNO avoids all of it by being natively 5 V, which is why it is the
board this project targets.

## Flashing the bridge

Open `firmware/m35080_bridge/m35080_bridge.ino` in the Arduino IDE, select the UNO,
and upload. The sketch replaces the reference project's all-in-one sketch: it holds
no VIN or mileage, it just executes one SPI operation per serial frame.

Smoke test without the chip: connect at 115200 and send the PING frame
`7E 01 00 00 AC FB`; the bridge answers with `M35080BR`, its protocol
version, and the chunk limits it will accept.

### If connecting times out with zero bytes

USB recognition only proves that the UNO's USB-to-serial interface is present.
The ATmega328P must also be running **this project's `m35080_bridge.ino`**.
Blink, a blank board, and the reference project's all-in-one odometer sketch
do not implement this app's PING protocol.

Close the web app and serial monitors before uploading. In Arduino IDE select
**Arduino Uno** and the UNO's USB port, upload the bridge sketch, then reconnect
from the app. The PING handshake does not access the M35080, so it should work
even with the EEPROM disconnected. Check the bridge firmware and USB connection
before changing EEPROM wiring. A failed handshake now closes the serial port
so the next connection attempt or firmware upload can open it.

## Connecting from the browser

Chrome or Edge on desktop, over HTTPS or `localhost` (Web Serial is unavailable in
Firefox and Safari). Click CONNECT — the port picker only opens from a real click.

Opening the port resets the UNO (DTR), so the app waits ~2 s for the bootloader
before the first frame. That is a boot wait, not a protocol timeout.
