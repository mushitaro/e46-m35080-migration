# Coding — reading and changing a chip's coding with NCS Expert's definitions

REWRITE's coding section reads the job's source — the chip, or a dump — with the cluster's own
coding definition: every parameter, its current value and the options it allows. The ones that can
safely be changed are changed as part of the job (`web/lib/domain/job.ts`): after the source and
the VIN, before the odometer, sealed once, and written in the same single pass as everything else
the job does (write, read back, record).

The definitions are NCS Expert's (KMBE46M3.Cxx, KMB_E46.Cxx), read by
`tools/refdata/gen_refdata.py` into JSON that is served to signed-in owners of the preview and
never committed (THIRD-PARTY-NOTICES.md 3.3). This document holds only numbers, addresses and
rules. It names no option or block, and one parameter: the coding index, which the code looks up by
its keyword.

The code is `web/lib/ncs/` (decode, definition, encode). `web/test/ncs.test.ts` and
`codingWrite.test.ts` test it on a synthetic definition; `ncsEvidence.test.ts` replays it on the
real definitions and real chip images, locally only, and prints every number below.

## What a definition says

For each parameter: a byte address in the chip, a length, a mask, and — for a switchable
parameter (FSW) — its options, each with the data it writes. Direct values (DIR) have no
options: the VIN field, dates, indexes, curves.

| Rule | Measured on |
|---|---|
| Addresses are the chip's byte addresses (late layout only) | the fits below, at those addresses |
| A value is `(BE(bytes) & mask) >> ctz(mask)`, and an option's data is that shifted value, big-endian | all 5996 scalar options in the 12 E46 definitions: each is the mask's width and inside it |
| A parameter longer than its mask is an array of mask-sized elements (a curve); its options are whole arrays | 91 switchable parameters (24 of 3×1 byte, 67 of 2–15×2 bytes) and 100 direct values |
| Memory organisation is MSB-first (`WORDMSB`) | all 12 |
| Four definitions declare the late coding-block layout (below) | the two newest of each family |

## Which definition a chip was coded with

A parameter is **informative** when it is a scalar whose options set at least two different
values and do not cover every value its mask can hold. Only those can tell definitions apart: one
whose options cover everything always "matches", and one with a single value was chosen by nobody.

A definition is chosen only when BOTH hold:

1. every informative parameter holds one of its options (a complete fit), and
2. the definition's own coding index equals the one the chip carries (its CODIERINDEX direct
   value — at `0x317` in the late layout).

Measured on two late-layout chips, two reads of each (informative parameters matched / present):

| Chip | Its own definition | Its family's other late definition | The other family's late definitions | Definitions with another block layout |
|---|---|---|---|---|
| A | 14 / 14 | 14 / 14 — index differs | 12 / 15 | 4–6 / 13–16 |
| B | 15 / 15 | 15 / 15 — index differs | 13 / 14 | 2–4 / 13–16 |

Neither gate is enough alone. Each family's two late definitions have identical informative
parameters and tie on the fit — only the chip's own index separates them. And one definition with
another block layout carries the same index as both chips hold at that definition's address, while
fitting 4 / 13 and 2 / 13.

Two older-layout chips are refused before any fit is taken (not the late layout); the closest any
definition comes is 3 / 15 and 3 / 14. Anything but exactly one chosen definition is a refusal,
with the closest fit shown.

## What may be written

Every gate must hold, or nothing is written:

- The image is the late layout, and **both checksums hold before** the change
  (`0x16E = XOR(0x070..0x16D)`, `0x3CD = XOR(0x310..0x3CC)` mirrored at `0x3DF`). A broken
  checksum is never repaired on the way past; INSPECT's FIX CHECKSUMS is the explicit way.
- The definition is the chip's own (above), organised `WORDMSB`, with the late coding-block
  layout: `0x020+0x10, 0x056+0x02, 0x070+0x0A, 0x07A+0x06, 0x07E+0x0A, 0x088+0xE6, 0x16E+0x02,
  0x170+0x14`.
- The parameter is **CODABLE**: a scalar with at least two different option values, its current
  value one of them, lying wholly inside `0x070–0x16D` or `0x310–0x3CC`, and clear of every
  protected range:

  | Protected | Why |
  |---|---|
  | `0x000–0x01F` | the odometer (increment-only) |
  | `0x07A–0x087` | the coded VIN, the odometer offset and the K-numbers |
  | `0x16E–0x16F` | the first checksum word |
  | `0x3CD`, `0x3DF` | the second checksum and its mirror |

- The new value is one of the parameter's own options.

Only the mask's bits change; the other bits of a shared byte are carried over. The checksums are
recomputed from the changed image and join the plan, so the confirmation shows `0x16E` (and
`0x3CD` with `0x3DF`) before anything is sent.

Every other row is shown and never written: PROTECTED (a protected range), VALUE (a direct value,
a curve, a single value, or outside the two regions) or UNKNOWN (the chip holds a value that is
none of the options).

## Not yet confirmed

- That a cluster accepts a chip changed this way. The rules above are measured on chip images
  and definitions; no changed chip has been put back in a cluster yet. TEST reads the cluster
  afterwards.
- The older generation's addressing: its definitions do not fit its chips at these addresses, so
  the coding section refuses them rather than guess.
