# E46 M35080 /// MIGRATION

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
  lib/sync                the preview's SYNC client and error records (owner-sync.ts is a kit copy)
  components              ///M UI, incl. the wiring diagram and assembly guide
  functions               the preview's owner gate (_owner-gate/ is a kit copy) and /api
  migrations              the preview's D1 tables
  scripts                 build-id · brand-preview · gen-sw · verify-export · deploy ·
                          verify-deploy · gate-verify · sync-aliexpress (BOM → links)
  data                    parts.json (the BOM) · aliexpress.json (sync output)
  test                    domain, codec, device simulator, workflow, hardware
docs/                     HARDWARE.md (wiring, BOM) · PROTOCOL.md (wire format)
scripts/                  check-public-tree.mjs — what a public repository may not carry
```

`lib/domain/hardware.ts` is the single source of truth for the pin map; the
diagram, the guide and `docs/HARDWARE.md` are checked against it by a test, so
the three cannot drift.

## Running it

```bash
cd web && npm install && npm run dev
```

Then open the address `next dev` prints in **Chrome or Edge on desktop** (Web Serial is
not in Firefox or Safari) and click CONNECT.

**No hardware? Click PRACTICE.** It runs the whole workflow — including the
destructive paths — against a simulated chip that really enforces the
increment-only rule.

```bash
npm run test        # domain, codec, device simulator, workflow, hardware parity
npm run build       # static export to web/out (production identity)
```

## The preview

There is one environment: the **owner preview** at
<https://e46-m35080-migration-preview.pages.dev>, for people who hold
`owner_preview` on [m3.tsunagi.app](https://m3.tsunagi.app) — MILE purchasers
and the owners whose cars TSUNAGI has worked on. They open it from the APPS
PREVIEW row of the M menu.

- **The whole origin is gated.** `web/functions/_middleware.ts` is the owner
  gate (a copy of tsunagi-m3's `tools/owner-gate`): without an m3 session that
  holds `owner_preview`, a page load goes to m3 to sign in and anything else is
  401. Only the web app manifest and its icons are public, because browsers
  fetch those without cookies.
- **Desktop Chrome or Edge only.** The bridge is reached over Web Serial, which
  no phone browser and neither Firefox nor Safari has.
- **SYNC.** RECORDS › SYNC keeps this device's records — each backup, and the
  image after each rewrite, reset or restore — in the owner's own account, where
  another device can RESTORE them. When an operation fails, the app sends an
  error record by itself. Both are stored per owner; nobody else can list, read
  or delete them. What is sent and for how long is in the privacy policy:
  <https://m3.tsunagi.app/privacy-policy#preview>
  (English: <https://m3.tsunagi.app/en/privacy-policy#preview>), linked from the
  shield in the preview's header.
- **Production sends nothing.** A build without `app-variant=preview` has no
  SYNC panel, no PRIVACY link and makes no `/api` or `/_gate` request
  (`lib/sync/cloud.ts` `canSync()`, pinned by `test/sync.test.ts`).

The source carries production's identity (`E46 M35080 /// MIGRATION`,
`M35080`, the M ICON `migration` set). The preview is branded after the
compile:

```bash
npm run build          # next build → build-id → gen-sw → verify-export
npm run build:preview  # next build → build-id → brand-preview out PREVIEW → gen-sw → verify-export
```

### Deploying

```bash
cd web && npm run deploy            # or: npm run deploy -- --check (stops before the upload)
```

`web/scripts/deploy.mjs` refuses unless the project in `wrangler.jsonc` is
`e46-m35080-migration-preview` with `RUNS_DB` bound; the gate is present and
`npm run gate:verify` passes; `check-public-tree` passes; the tree is clean and
nothing gitignored sits under `public/` or `functions/`; `origin` is
`github.com/mushitaro/e46-m35080-migration`, `HEAD` equals `origin/main` after a
fetch, and GitHub shows an anonymous caller that the repository is public and
serves that commit. Then it runs the tests (this app writes to an EEPROM:
nothing deploys unless they pass), typecheck and `build:preview`, checks the
branding and the build id, and runs wrangler from `web/` with `--branch main`.
`scripts/verify-deploy.mjs` reads the deployment back; give it an owner session
from tsunagi-m3's `access-session.mjs` in `GATE_SESSION_FILE` to check behind
the gate. **A push does not deploy**: `.github/workflows/test.yml` runs the
public-tree check, the suite and the build, and stops.

The SYNC tables live in the D1 database `tsunagi-m-preview-runs`, shared with
E46M3 /// MONITORING (`m35080_*` tables, `web/migrations/0001_m35080_sync.sql`).

### Running the gate and SYNC locally

`next dev` has no functions. To see the gate and SYNC, build the preview and
serve it with wrangler, on localhost only:

```bash
cd web
# web/.dev.vars (gitignored — never commit it):
#   M3_CLIENT_SECRET=<32+ random characters, or `npm run access:client -- --dev-vars` in tsunagi-m3>
#   GATE_DEV_ACCOUNT=<an account id>   # skip m3 entirely: you are signed in as this account
npx wrangler@4 d1 migrations apply tsunagi-m-preview-runs --local
npm run build:preview
npx wrangler@4 pages dev out --port <a free port>
```

`GATE_DEV_ACCOUNT` (and `GATE_DEV_M3`) work only on `localhost` and
`127.0.0.1`; the gate ignores them on any other host. Without
`GATE_DEV_ACCOUNT` the gate behaves as deployed: a page load is sent to m3.

### Offline

The service worker is generated per build (`scripts/gen-sw.mjs` from
`scripts/sw.template.js`), its cache named after a hash of the files. Documents
are network-first — this tool writes to an EEPROM, so running a stale build is a
hazard, not an inconvenience — and fall back to the installed build offline, or
when the gate answers with a redirect or any non-2xx. `/_gate/*` and `/api/*`
always go to the network. There is no `skipWaiting`: an update lands on the next
cold start, and an install does not even download while a page has the bridge
connected.

### Public repository

This repository is public under the MIT licence (`LICENSE`). No real chip image,
VIN, BMW data or secret may be committed: `scripts/check-public-tree.mjs` runs
from the pre-commit hook (`npm run hooks:install` in `web/`), in CI and before a
deploy. See `THIRD-PARTY-NOTICES.md`.

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
