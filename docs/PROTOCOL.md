# Bridge protocol

The contract between the WebUI and `firmware/m35080_bridge`. Both sides implement
it independently, so this document is the thing that keeps them in step — change
one side and you must change the other and the simulator in
`web/test/support/m35080Simulator.ts`.

## Shape

USB CDC is full duplex and does not echo, so unlike a K-line bus there is nothing
to strip. Frames are length-delimited; the SOF byte exists so a desynced stream
can be re-hunted, and the CRC is what confirms the hunt landed.

**Both sides re-hunt.** The firmware discards any byte that is not `SOF`
(`loop()`), and the host steps over stray bytes before a response header
(`readHeaderResync`), bounded so a babbling line fails fast rather than hanging.
This is not optional politeness: a USB-serial adapter emits noise around the
UNO's DTR auto-reset, and a side that refuses to resynchronise reports a working
bridge as a broken one.

```
request    SOF | CMD | LEN(2)          | payload[LEN] | CRC16(2)
response   SOF | CMD | STATUS | LEN(2) | payload[LEN] | CRC16(2)
```

- `SOF` = `0x7E`
- `LEN` and `CRC16` are **little-endian**, like every multi-byte field here.
- `CRC16` is **CRC-16/CCITT-FALSE** (poly `0x1021`, init `0xFFFF`, no reflection,
  no final XOR) over every byte after `SOF`, excluding the CRC itself.
- Serial is **115200 8N1**.

### Endianness

Every multi-byte field in *this protocol* is little-endian. The chip itself wants
big-endian addresses and counter values. That conversion happens once, in the
firmware, at the single point that talks SPI — so the host never deals with two
byte orders.

## Commands

| Code | Name | Request payload | Response payload |
|---|---|---|---|
| `0x01` | `PING` | — | 19 bytes, see below |
| `0x02` | `RDSR` | — | `status(1)` |
| `0x03` | `WREN` | — | `status(1)` |
| `0x04` | `WRDI` | — | `status(1)` |
| `0x05` | `READ` | `addr(2) len(2)` | `len` bytes |
| `0x06` | `WRITE` | `addr(2) data(n)` | `status(1)` |
| `0x07` | `WRINC` | `addr(2) value(2)` | `status(1)` |
| `0x08` | `IDENTIFY` | — | `status(1) secure(32)` |

`WRSR` is deliberately **not implemented**. The block-protect bits are not needed
for any supported operation and are an easy way to brick a working chip.

### PING reply

```
[0..7]   "M35080BR"   magic
[8]      protocol version
[9]      firmware major
[10]     firmware minor
[11..12] maxReadChunk   (u16 LE)
[13..14] maxWriteChunk  (u16 LE)
[15..16] pageSize       (u16 LE)
[17..18] imageSize      (u16 LE)
```

The bridge **publishes its own limits** and the host uses them rather than
assuming. A firmware built with a smaller buffer stays correct with no host
change. The host still refuses anything above its own ceiling, and rejects a
bridge advertising a write chunk larger than its page size.

## Status codes

| Code | Name | Retriable? |
|---|---|---|
| `0x00` | `OK` | — |
| `0x01` | `ERR_CRC` | **yes** |
| `0x02` | `ERR_UNKNOWN_CMD` | no |
| `0x03` | `ERR_LENGTH` | no |
| `0x04` | `ERR_RANGE` | no |
| `0x05` | `ERR_WRITE_DISABLED` | no |
| `0x06` | `ERR_INC_REFUSED` | **no — never** |
| `0x07` | `ERR_TIMEOUT` | **yes** |

**Retry the transport failure, never the semantic one.** A CRC error or a bridge
timeout means the exchange did not land; re-sending the same bytes is idempotent
and correct. `ERR_INC_REFUSED` means the chip received the write, tried it, and
rejected it on its own rules — re-sending that papers over a real refusal and
would report success. The host enforces this in `isRetriable()`, and validation
sits *outside* the retry loop so the two can never be confused.

## The two chunk constants

They look like one number and are three:

| Constant | Value | Bounded by |
|---|---|---|
| `PAGE_SIZE` | 32 | the chip: 32 pages of 32 bytes |
| `MAX_WRITE_CHUNK` | 32 | **the page** — a page-crossing WRITE wraps *within* the page and silently corrupts data |
| `MAX_READ_CHUNK` | 128 | the bridge's SRAM only; reads do not wrap |

Only the read side may ever grow. Both sides assert this at load time — the
firmware with `#error`, the host with a module-scope check — so an illegal
constant fails the build rather than being discovered after the first byte
reached the chip.

## Guards

Refusals that happen on the host, before any byte is sent:

- a write range outside the 1 KB image (checked for the **whole** range, not
  per-chunk — otherwise the leading chunks go out and only then does it refuse)
- a plain `WRITE` touching `0x00–0x1F`; that area is reachable only via `WRINC`
- a `WRINC` at an odd address, outside the secure area, or with a non-`u16` value
- a write crossing a page boundary

The firmware repeats all of them as defence in depth, and the PRACTICE mock calls
the *same* exported guards, so a rehearsal refuses exactly what hardware refuses,
with the same words.

## Smoke test

```
host -> 7E 01 00 00 <crc_lo> <crc_hi>          PING
bridge -> 7E 01 00 13 00 "M35080BR" ...        magic + limits
```

`web/test/support/m35080Simulator.ts` implements this whole protocol in
TypeScript and the link suite drives the real client against it, including the
destructive paths.
