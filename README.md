# E46 Cluster — M35080 Odometer Tool

A browser tool for reading, backing up, rewriting and restoring the **M35080**
SPI EEPROM in a BMW **E46 instrument cluster (IKE)**, driven through an Arduino
UNO acting as a thin SPI bridge.

This updates the methodology of
[`gerchanovsky/m35080_odometer_fix`](https://github.com/gerchanovsky/m35080_odometer_fix),
which compiled the target VIN and mileage into the sketch as `#define`s and
dumped raw hex to the serial monitor. Here the UNO knows nothing but SPI, and
every decision — the odometer codec, the VIN, backup, restore, the safety gates
— lives in the UI.

```
Browser (Next.js PWA, TSUNAGI ///M)                 Arduino UNO          M35080
  useM35080Link ─ m35080Link ─ bridgeProtocol ─      bridge firmware:    (SOP8→DIP8
  webSerialTransport ════════ USB CDC ════════►      frame → 1 SPI op     adapter on a
                                                     → reply frame ───►   breadboard)
```

## The workflow

The tabs are the procedure, in order. Each one is enabled by what the previous
one produced, and carries a check when its work is done — nothing about progress
is stored, it is all derived from the link and the image.

| | Step | What happens |
|---|---|---|
| 1 | **準備 / SETUP** | Wiring diagram, a seven-step assembly guide, and the parts list |
| 2 | **読み出し / READ** | Connect, read the 1 KB image, decode VIN + mileage |
| 3 | **復旧 / RESTORE** | A backup's cluster data onto a **new blank chip** — VIN blanked, odometer not written |
| 4 | **書き換え / REWRITE** | Raise the mileage to the vehicle's true figure |
| 5 | **記録 / RECORDS** | Backup history |

After a read the tool says **which job this chip allows** rather than leaving you
to work it out: a donor below your target can simply be raised (no new chip), one
above it cannot be lowered at all.

## Restoring onto a new chip

A new M35080 is blank: `0x00` counters and `0xFF` everywhere else. The car can
put back the **mileage** and the **VIN**; it cannot put back the cluster's own
data. So a restore needs a backup of the original chip, and writes:

| Region | Written | Why |
|---|---|---|
| `0x020–0x3FF` | from the backup | the cluster's data — a new chip has none |
| `0x2E8–0x2EF` | `0xFF` | VIN in factory state, set over OBD with a coding tool |
| `0x000–0x01F` | **not written** | stays at 0 km, below the car, which syncs it up |

This applies the rules in the reference project's README — blank the VIN and set
it over OBD, and *"Mileage on new cluser MUST be lower then mileage on your car"*
— to a blank chip. That README was written for re-programming a used cluster in
place, so it does not cover a blank chip itself.

A backup whose standard array is one value repeated (all `FF`, all `00`, all
`A5`) is refused: those are failed reads or blank chips, not clusters.

The sync to the car's higher mileage — held by the LCM from 09/2001, the EWS
before that — depends on the coding being right. **Check the odometer after
fitting and before driving.** If it still reads 0 km, set it on the REWRITE step.

## The constraint that shapes everything

The secure area `0x00–0x1F` is **hardware-enforced increment-only**. The chip
refuses any `WRINC` that would not increase a register and raises its `INC`
status bit. There is no erase instruction in the part's entire seven-opcode set.

- Mileage can be **raised** on a chip, never lowered.
- **A 0 km reset is impossible on a used chip.** A new one is already at 0 —
  ST ships the first sixteen words as `0000h`, so it has simply never counted.

That design exists to keep recorded mileage truthful. A value written here must
reflect the vehicle's true odometer reading — this is a tool for making a
replacement cluster tell the truth, not for rolling one back.

## Layout

```
firmware/m35080_bridge/   Arduino UNO sketch — the SPI bridge
web/                      Next.js 16 + React 19 + Tailwind v4 PWA
  lib/transport           Web Serial port, read buffer, readExact
  lib/codec               frames, CRC, guards  (pure, no port)
  lib/link                exchanges, retries, command gate + PRACTICE mock
  lib/domain              odometer / VIN / status / image / plans / records
                          workflow (the step machine) · hardware (the pin map)
  lib/copy                bench vocabulary (guide, wiring, parts), ja + en
  components              ///M UI, incl. the wiring diagram and assembly guide
  scripts                 sync-aliexpress.mjs — resolves the BOM to links
  data                    parts.json (the BOM) · aliexpress.json (sync output)
  test                    domain, codec, device simulator, workflow, hardware
docs/                     HARDWARE.md (wiring, BOM) · PROTOCOL.md (wire format)
```

`lib/domain/hardware.ts` is the single source of truth for the pin map; the
diagram, the guide and `docs/HARDWARE.md` are checked against it by a test, so
the three cannot drift.

## Running it

```bash
cd web && npm install && npm run dev
```

Then open `http://localhost:3000` in **Chrome or Edge on desktop** (Web Serial is
not in Firefox or Safari) and click CONNECT.

**No hardware? Click PRACTICE.** It runs the whole workflow — including the
destructive paths — against a simulated chip that really enforces the
increment-only rule.

```bash
npm run test        # domain, codec, device simulator, workflow, hardware parity
npm run build       # static export to web/out
```

This repository is the **PREVIEW** environment: dev icon set, a `PREVIEW`
badge in the header, and `app-variant=preview` in the served HTML. It is
published to Cloudflare Pages at
**<https://e46-m35080-migration-preview.pages.dev>**. Web Serial requires a
secure context, which that subdomain provides; `localhost` counts as one too,
so `npm run dev` also works.

```bash
npm run deploy      # test -> build -> wrangler pages deploy
```

**A push does not deploy.** Production is published by pushing to `main`;
staging and preview are published by a local script, deliberately, because a
preview is where you work rather than something that should reach the web on
every commit. `.github/workflows/test.yml` runs the suite and the build on
push and stops there, so the repository needs no Cloudflare secrets.

The test gate did not disappear with the deploy step — it moved into
`web/scripts/deploy.mjs`, which runs the suite itself before it uploads
anything. That script also reads the project name from `wrangler.jsonc` rather
than repeating it, pins `--branch` so no branch alias is ever minted, and
refuses to run if a `functions/` directory exists (this environment serves no
API, and wrangler would collect one from the working directory).

Installable as a PWA: `public/sw.js` keeps the shell available offline, but
serves documents network-first — this tool writes to an EEPROM, so running a
stale build is a hazard, not an inconvenience.

## Parts list

The SETUP step carries a bill of materials with checkboxes. Selected items open
one at a time — **AliExpress has no public add-to-cart API**, so you add each to
your own cart on its own page; affiliate attribution is set by the click itself,
so nothing is lost.

Links and prices are resolved **at build time** and committed, so the build stays
hermetic and a stale price shows up in the diff rather than ageing silently:

```bash
cd web && node --env-file=.env.local scripts/sync-aliexpress.mjs
```

Needs `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` and `ALIEXPRESS_TRACKING_ID`.
Run it with `--dry` to see what it would fetch without spending quota. Anything
in `data/parts.json` with no `productId` ships as a search link instead of an
invented one.

## Hardware

Full wiring, bill of materials and the bench procedure are in
[`docs/HARDWARE.md`](docs/HARDWARE.md) — and, in an interactive form, in the
app's SETUP step. Three things that are easy to get wrong:

- **The M35080 is not the standard 25xx pinout.** GND is pin 1, and there is no
  HOLD pin. Only VCC is where you would expect.
- **Use the 150 mil SOP8→DIP8 adapter**, not the 200 mil one.
- **Do not drive it from a 3.3 V board without level shifting.** The chip needs
  4.5–5.5 V; the UNO is natively 5 V, which is why it is the board targeted here.

## Credits

SPI primitives and the odometer/VIN encoding derive from
[`gerchanovsky/m35080_odometer_fix`](https://github.com/gerchanovsky/m35080_odometer_fix)
(Unlicense), itself forked from `kaeferfreund/m35080_Read_BitBang`. The jumper
colours in the wiring diagram are the ones that repository's own comments use,
so the two can be compared side by side.
