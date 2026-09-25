# E46 M35080 /// MIGRATION

A browser tool for reading, backing up, rewriting, restoring and coding the **M35080** SPI
EEPROM of a BMW **E46 instrument cluster (IKE)**, driven through an Arduino UNO acting as a thin
SPI bridge — and for testing the cluster on the bench once the chip is back, over the K+DCAN
cable you already use on the car.

This updates the methodology of
[`gerchanovsky/m35080_odometer_fix`](https://github.com/gerchanovsky/m35080_odometer_fix),
which compiled the target VIN and mileage into the sketch as `#define`s and
dumped raw hex to the serial monitor. Here the UNO knows nothing but SPI, and
every decision — the odometer codec, the VIN, backup, restore, the safety gates
— lives in the UI.

```
Browser (Next.js PWA, TSUNAGI ///M)
  THE CHIP     useM35080Link ─ m35080Link ─ bridgeProtocol ─ webSerialTransport
               ═══ USB CDC ═══► Arduino UNO (bridge firmware: frame → one SPI op → reply)
               ─── SPI ───► M35080, off the cluster (SOP8→DIP8 adapter on a breadboard)

  THE CLUSTER  useKombiLink ─ kombiLink ─ mayRun ─ ds2-core
               ═══ K+DCAN cable, K-line, 9600 8E1 ═══► the cluster on the bench (DS2, address 0x80)
```

The two cables never meet the same thing. The UNO only ever talks to a chip; the K+DCAN cable
only to a cluster. TEST refuses the UNO's port, and a K+DCAN cable picked for the bridge fails
the bridge's handshake.

## The workflow: two modes

**MODE** — the corner at the bottom left of the hub panel, as in TUNER's VE / IDLE — says what
the tool is working on, and so which tabs, which cable, which hub and which PRACTICE
(`web/lib/domain/modes.ts`). The tabs are each mode's procedure, in order; nothing about progress
is stored, it is all derived from the links and the image. The mode holds while the chip is
being written, and while the cluster is in a session (STOP first).

**CHIP** — the M35080 off its board, on the UNO:

| | Step | What happens |
|---|---|---|
| 1 | **SETUP** | The UNO bench: wiring diagram, a seven-step assembly guide, the parts list |
| 2 | **READ** | Read the 1 KB image (twice, compared), decode the odometer and both VIN fields. **BACKUP** before any write |
| 3 | **REWRITE** | The job, in one plan and one write: the **SOURCE** (the chip as it is, or a **FILE**), bytes changed by hand in **HEX**, the **VIN**, the **CODING** *(experimental)* and the **ODOMETER** — or **SAVE EDITED** to keep the result as a file and write it later |
| 4 | **RECORDS** | Every backup, and the image after every write |

Three ways through the same steps, so there is one path to learn:

| To | Do |
|---|---|
| fix the chip that was read | READ → REWRITE, SOURCE **CHIP** → change → WRITE CHIP |
| move a donor's data over | READ → REWRITE, SOURCE **FILE** (the donor's dump) → change → WRITE CHIP |
| prepare a file now, write it later | REWRITE, SOURCE **FILE** → change → **SAVE EDITED**; later READ → REWRITE, SOURCE **FILE** (that file) → WRITE CHIP |

REWRITE opens without a chip, because the third starts there; what it can do without one is
SAVE EDITED. WRITE CHIP appears only after the hub has taken you through CONNECT, READ and
BACKUP — from REWRITE itself, so a file opened there stays open while the chip is read.

**TEST** *(experimental)* — the chip back in its cluster, the cluster on the desk, over the
K+DCAN cable: **BENCH** (the wiring, the parts, the procedure) and **CHECKS** (ask it, compare,
move its needles and lamps).

After a read the tool says **which job this chip allows** rather than leaving you
to work it out: a donor below your target can simply be raised (no new chip), one
above it cannot be lowered at all.

Experimental parts are drawn only in the preview (`web/lib/domain/features.ts` says why each is
not yet a release, and a test pins the release's set) - a release offers the CHIP mode, and
REWRITE without its CODING section. Promoting one is the operator's call.

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

## What the array holds: the late layout, its checksums, the two VIN fields

For one cluster generation — the "late" layout, both chips measured on this bench — the array
is understood well enough to write into (`web/lib/domain/layout.ts`, numbers and addresses only):

- **Two checksums.** `0x16E = XOR(0x070..0x16D)` and `0x3CD = XOR(0x310..0x3CC)`, with `0x3DF`
  holding the same value as `0x3CD`. An image is recognised as late **by its checksums**, never
  by an address that happens to hold something plausible. REWRITE's SOURCE shows their state,
  and offers FIX CHECKSUMS for a file whose checksums fail; any write that lands inside a
  checksummed region recomputes it in the same plan, and the confirmation shows the checksum
  bytes.
- **Two VIN fields, which are different fields.** `CODED 07A` (late layout only): two letters
  and five BCD digits — the short VIN the cluster's own DS2 reply has the shape of — inside the
  `0x16E` region. `ASCII`: found by a scan (at `0x184` on the V6 chip), matching the
  registration. They can disagree, and the app says DIFFER. REWRITE writes every field the chip
  has — the coded one only on a late image whose checksums already hold, recomputing `0x16E`;
  blanking touches the ASCII field only. Which field the cluster reports is confirmed on the
  bench (TEST).

An image that is not the late layout (the older generation, or a file of unknown origin) is
still read, backed up and rewritten, but no address in it is given a meaning the measurements do
not support, and its coding is not read.

## REWRITE — the job, in one write

Moving a cluster to another car used to be four tabs — RESTORE, REWRITE, CODING, and INSPECT
to edit a file before taking it to RESTORE — with their own plans and writes. It is one job now
(`web/lib/domain/job.ts`), planned in a fixed order and written through the one write path —
each byte written and read back, the whole chip read again and compared with the plan, the
result recorded:

1. **SOURCE** — the standard array (`0x020–0x3FF`) starts as the chip's own, or as a **FILE**'s:
   a donor's dump, a backup, or a file SAVE EDITED made earlier. A file can be opened before
   anything is connected; writing it needs the chip READ. On a blank chip the whole file is
   written; on a used one only the bytes that differ, and writing it again never raises the
   odometer. A file whose standard array is one value repeated (all `FF`, `00`, `A5` — failed
   reads, not clusters) is refused, and so is a late-layout file whose checksums do not hold,
   until **FIX CHECKSUMS** on the SOURCE recomputes them — explicitly, and it can be taken back.
   A chip whose checksums fail is not recomputed over: read it again, or write a good file.
2. **BYTES** — bytes changed by hand in the HEX view's edit bar, on the ones no other part owns:
   not the odometer (ODOMETER), not a VIN field (VIN), and on the late layout not the odometer
   offset, the K-numbers or the checksums. The checksums are sealed again after them.
3. **VIN** — written to every VIN field the source has, as above.
4. **CODING** *(experimental)* — the source's own definition, so a file's coding can be changed
   whatever the chip on the UNO holds — a blank one, or PRACTICE's made-up one.
5. **ODOMETER** — WRINC on the chip, upward only. Never copied from a file: left blank, the
   odometer is kept, and a new chip stays at 0 km, below the car, which syncs it up (the
   reference project's own rule: *"Mileage on new cluser MUST be lower then mileage on your
   car"*).

The checksums are sealed once, after every edit, and one confirmation lists everything that
will be sent: the WRINCs, what the file changes, the bytes changed by hand, the VIN fields, each
coding change, each checksum, and the runs of bytes themselves. The record is `Restore_…` for a
file, `Rewrite_…` otherwise, and its note keeps the source, the bytes, the odometer, the VIN and
each coding change.

**SAVE EDITED** keeps the result as a file instead — `Edited_<VIN>_<km>_<stamp>.bin`, never over
the file it came from, with the SOURCE's own odometer and no WRINC, so it is the same file with
a chip read or without one. Open it later as the SOURCE FILE and write it.

The reference project blanks `0x2E8–0x2EF` as "the VIN". On these chips that address is not the
VIN, so nothing is blanked. The sync to the car's higher mileage — held by the LCM from 09/2001,
the EWS before that — depends on the coding being right. **Check the odometer after fitting and
before driving.** If it still reads 0 km, set a target on REWRITE.

### CODING, inside the job

The coding section reads the source with every E46 cluster coding definition (NCS Expert's
KMBE46M3.Cxx and KMB_E46.Cxx), picks the one it was coded with, and lists it the way NCS Dummy
does: one row per function, in the definition's order, with the option it is set to now and a
choice of the option it will be set to — names in the reader's language, the keyword beside them
(the HEX / CODING switch on REWRITE's work surface). A function that may not be changed says why
in a word where the choice would be. The direct values (the VIN field, the coding index) follow,
read only. Where a function lives — address, mask, raw value — is in the side panel's detail of
the row picked. A definition is chosen only when
every parameter that can tell definitions apart holds one of its options **and** the
definition's coding index is the one the source carries; anything else is a refusal with the
closest fit shown.

A change is planned only when every gate holds: late layout, both checksums holding before the
change, the source's own definition, a parameter with at least two option values whose current
value is one of them, inside `0x070–0x16D` or `0x310–0x3CC`, clear of the odometer, the VIN
field, the K-numbers and the checksums. Only the mask's bits change. With a dump as the SOURCE,
DIFF shows the parameters the dump and the chip hold differently. The rules and the measurements
behind them are in [`docs/CODING.md`](docs/CODING.md). **No chip changed this way has been put
back in a cluster yet**; that is why CODING is experimental.

## TEST — the cluster off the car, on the K+DCAN cable

TEST mode (MODE › TEST) runs the cluster on the desk once its chip is back: it reads what the cluster says (IDENT,
the VIN, the odometer, the fault memory, the inputs), compares the VIN and odometer with the chip
image or the newest record, reads the EEPROM through the cluster to compare it too, sweeps each
needle up and back, lights the lamps one at a time for you to answer SEEN / NOT SEEN, and ends
the session with STOP. Nothing is graded: it records what was sent, what the cluster answered
and what you saw, and SAVE REPORT downloads that as JSON (never SYNCed).

The bench, in short (the full procedure, parts and cautions: [`docs/BENCH.md`](docs/BENCH.md);
the one source the app draws from is `web/lib/domain/clusterBench.ts`, and a test holds the
document to it):

| From | To | Carries |
|---|---|---|
| 12 V supply + → **1 A fuse** | +12 V lever connector | everything positive |
| +12 V lever connector | cluster X11175 pins 4, 5 and 6 | KL30, KL15, KL R — on together |
| supply − → ground lever connector | X11175 pin 1 | ground |
| +12 V / ground lever connectors | OBD-II socket pin 16 / pins 4, 5 | the cable's power |
| OBD-II pin 7 → 2-port lever connector | X11175 pin 25 | K-line (DS2) |

Every joint is a lever connector, one node each like a breadboard's rail, so nothing is soldered.
There is no ignition switch: the supply's output is the key.

**The X11175 pin numbers, where they sit and their wire colours come from one public source
(bmwgm5) and are unverified** — the app marks them so until they have been checked on a real
cluster. Check every pin with a meter first, keep the fuse in, and never connect the UNO to the
cluster.

Every telegram TEST sends is decided by one function, `mayRun` (`web/lib/kombi/runGate.ts`):
only the listed telegrams, at their exact length for the variant; anything that moves a needle,
lights a lamp or makes a sound waits for the variant (read from IDENT) and for you to confirm the
cluster is on the bench; needles stay within 10–90° and move at most 10° a step. There is no code
at all for the telegrams that would write to the cluster.

## Layout

```
firmware/m35080_bridge/   Arduino UNO sketch — the SPI bridge (the chip only)
web/                      Next.js 16 + React 19 + Tailwind v4 PWA
  lib/transport           Web Serial port, read buffer, readExact
  lib/codec               bridge frames, CRC, guards  (pure, no port)
  lib/link                bridge exchanges, retries, command gate + PRACTICE mock
  lib/domain              odometer / VIN / status / image / layout (checksums) / plans /
                          job (REWRITE's one plan) / records · workflow (the steps) · modes
                          (CHIP / TEST) · features (the registry) · hardware (the UNO pin map)
                          · clusterBench (the TEST bench)
  lib/kombi               the cluster over DS2: telegrams, decode, mayRun, the simulated
                          cluster, the link, the checks, the report, the bit names
  lib/ncs                 coding: which definition a chip was coded with, its rows,
                          planCoding, and what REWRITE's coding section derives
  lib/refdata             the reference data's types, validation and loading
  lib/hub                 the hub, derived per link: bridge (with the job), cluster
  lib/hooks               useM35080Link (the one write path to the chip), useKombiLink
  lib/copy                chrome words (one language), and JA/EN prose per surface
  lib/sync                the preview's SYNC client and error records (owner-sync.ts is a kit copy)
  packages/ds2-core       the DS2 core, vendored from E46M3 /// MONITORING (VENDOR.json pins it)
  components              ///M UI: wiring and bench diagrams, guides, hex view, panels
  functions               the preview's owner gate (_owner-gate/ is a kit copy) and /api:
                          sessions (SYNC), diagnostics (error records), ref (reference data)
  migrations              the preview's D1 tables
  scripts                 build-id · brand-preview · gen-sw · verify-export · deploy ·
                          verify-deploy · gate-verify · verify-ds2-core-sync ·
                          upload-refdata · sync-aliexpress (BOM → links)
  data                    parts.json and bench-parts.json (the BOMs) · aliexpress.json
  test                    domain, codec, device simulators, workflow, hubs, coding, TEST
tools/refdata/            the reference-data generator (Python) and its tests
docs/                     HARDWARE.md (UNO wiring, BOM) · PROTOCOL.md (bridge wire format) ·
                          BENCH.md (the TEST bench) · CODING.md (the coding rules)
scripts/                  check-public-tree.mjs · check-bmw-data.mjs — what may not be committed
```

`lib/domain/hardware.ts` and `lib/domain/clusterBench.ts` are the single sources of truth for
the two benches; the diagrams, the guides and `docs/HARDWARE.md` / `docs/BENCH.md` are checked
against them by tests, so they cannot drift.

## Running it

```bash
cd web && npm install && npm run dev
```

Then open <http://localhost:5049> in **Chrome or Edge on desktop** (Web Serial is
not in Firefox or Safari) and click CONNECT. `PORT`, when set, takes the place of 5049
(`web/scripts/dev.mjs`) — the desktop app's preview pane sets it when another worktree's dev server
already holds 5049.

**No hardware? Tick PRACTICE.** It runs the whole workflow — including the
destructive paths — against a simulated chip that really enforces the
increment-only rule, and the TEST mode against a simulated cluster. Where the coding definitions
are available, PRACTICE builds its chip to fit one of them (`web/lib/ncs/practice.ts`: made-up
values, the definition's options), so coding is rehearsed exactly as on a real chip —
CONNECT, READ, REWRITE, pick, WRITE CHIP — with nothing opened. A real chip's dump can also be
REWRITE's SOURCE, and READ's PRACTICE CHIP (shown while PRACTICE is ticked and nothing is
connected) makes a file the chip PRACTICE reads.

`next dev` draws what a release draws. REWRITE's CODING section and the TEST mode are
experimental and appear in a preview build:

```bash
npm run build:preview && npm run serve:out   # http://localhost:5050 (or PORT)
```

It serves the reference data the way the preview does — `/api/ref/<name>` from `REFDATA_OUT`
(default `C:\EDIABAS-derived\m35080-refdata`, where the generator writes it) — so the coding
definitions and TEST's names arrive without opening a file. There is no gate, so it answers this
machine only: a request from any other address is refused. No SYNC and no other `/api` either.
localhost is a secure context, so the UNO and the K+DCAN cable work there as on the deployed
preview. For the gate and SYNC, see [Running the gate and SYNC locally](#running-the-gate-and-sync-locally).

```bash
npm run test        # token rules → BMW-data guard → ds2-core vendor check → the vitest suite
npm run typecheck   # the app, then functions/
npm run build       # static export to web/out (production identity)
python -m unittest discover -s ../tools/refdata   # the generator
```

## The WORKS build

There is one environment: the owners' build, called **WORKS** (ワークス版) since
2026-09-25, at <https://e46-m35080-migration-preview.pages.dev>, for people who hold
`owner_preview` on [m3.tsunagi.app](https://m3.tsunagi.app) — MILE purchasers
and the owners whose cars TSUNAGI has worked on. They open it from the WORKS
row of the M menu. Its variant, host and scripts are still named `preview`; only what the
owner sees is WORKS (`web/scripts/brand-label.mjs`).

- **The whole origin is gated.** `web/functions/_middleware.ts` is the owner
  gate (a copy of tsunagi-m3's `tools/owner-gate`): without an m3 session that
  holds `owner_preview`, a page load goes to m3 to sign in and anything else is
  401. Only the web app manifest and its icons are public, because browsers
  fetch those without cookies.
- **Desktop Chrome or Edge only.** The bridge and the K+DCAN cable are reached over Web Serial,
  which no phone browser and neither Firefox nor Safari has.
- **SYNC.** RECORDS › SYNC keeps this device's records — each backup, and the
  image after each write — in the owner's own account, where another device can use them as
  a REWRITE SOURCE. When an operation fails, the app sends an
  error record by itself. Both are stored per owner; nobody else can list, read
  or delete them. TEST reports are downloaded, never sent.
- **Nothing is sent before the owner says yes.** The first time the WORKS build opens in a
  browser, a dialog says what it sends, when, what for, who can see it and how to delete it —
  m3's words, with the lines about error records made exact for this app — and covers the
  app until the owner presses 確認して続ける / Confirm and continue
  (`components/PreviewNotice.tsx`, remembered as `preview-notice:v1` in
  localStorage). Until then SYNC, the account lists and the error records' outbox make no
  request, and an error record waits on the device (`lib/sync/cloud.ts` `maySend()`,
  pinned by `test/previewNotice.test.ts`). The full text is the privacy policy:
  <https://m3.tsunagi.app/privacy-policy#preview>
  (English: <https://m3.tsunagi.app/en/privacy-policy#preview>), linked from the
  dialog and from the shield in the WORKS build's header.
- **Reference data.** CODING's definitions and TEST's names are served from `/api/ref/<name>`
  to the signed-in owner only, from a private R2 bucket, and held in memory (below).
- **Production sends nothing.** A build without `app-variant=preview` has no
  SYNC panel, no PRIVACY link, no first-run dialog and makes no `/api` or `/_gate` request
  (`lib/sync/cloud.ts` `canSync()`, pinned by `test/sync.test.ts`; `lib/refdata/load.ts`).

The source carries production's identity (`E46 M35080 /// MIGRATION`,
`M35080`, the M ICON `migration` set). The WORKS build is branded after the
compile — `— WORKS`, `W M35080`, the dev icon set, and `app-variant=preview` with
`app-label=WORKS`:

```bash
npm run build          # next build → build-id → gen-sw → verify-export
npm run build:preview  # next build → build-id → brand-preview out preview → gen-sw → verify-export
```

### Reference data (operator)

The coding definitions and the lamp/input names are BMW-derived: they are built on the
operator's machine, outside this tree, and never committed or bundled
(`THIRD-PARTY-NOTICES.md` 3.3; `scripts/check-bmw-data.mjs` refuses them in a commit).

```bash
# NCS Expert's files (NCS_DATEN), the private translations (M35080_TERMS), the Diagnosis
# translator (DIAG_TOOLS) and the SGBD dumps (SGBD_DUMP_DIR) are read from the environment;
# the JSON is written to REFDATA_OUT, outside the repository.
PYTHONIOENCODING=utf-8 M35080_TERMS=<data repo>/terms/m35080 python tools/refdata/gen_refdata.py
cd web && node scripts/upload-refdata.mjs --check && node scripts/upload-refdata.mjs
```

`--check` on the generator reports drift and translation coverage; on the uploader it validates
both files and stops. The uploader puts them in the bucket named in `wrangler.jsonc`
(`m35080-refdata`, private), and the only way out of it is `/api/ref` behind the gate.

### Deploying

```bash
cd web && npm run deploy            # or: npm run deploy -- --check (stops before the upload)
```

`web/scripts/deploy.mjs` refuses unless the project in `wrangler.jsonc` is
`e46-m35080-migration-preview` with `RUNS_DB` and `REFDATA` bound and the `m35080-refdata`
bucket present; the gate is present and
`npm run gate:verify` passes; `check-public-tree` passes; the tree is clean and
nothing gitignored sits under `public/` or `functions/`; `origin` is
`github.com/mushitaro/e46-m35080-migration`, `HEAD` equals `origin/main` after a
fetch, and GitHub shows an anonymous caller that the repository is public and
serves that commit. Then it runs the tests (this app writes to an EEPROM:
nothing deploys unless they pass), typecheck and `build:preview`, checks the
branding and the build id, and runs wrangler from `web/` with `--branch main`.
`scripts/verify-deploy.mjs` reads the deployment back — including that `/api/ref` is 401
without a session; give it an owner session
from tsunagi-m3's `access-session.mjs` in `GATE_SESSION_FILE` to check behind
the gate. **A push does not deploy**: `.github/workflows/test.yml` runs the
public-tree check, the suite, the generator's tests and the build, and stops.

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
VIN, BMW data or secret may be committed: `scripts/check-public-tree.mjs` and
`scripts/check-bmw-data.mjs` run from the pre-commit hook (`npm run hooks:install`
in `web/`), in CI and before a deploy. See `THIRD-PARTY-NOTICES.md`. The tests use synthetic
images and definitions only; the checks against real chips and real definitions
(`layoutEvidence`, `ncsEvidence`) run only on the operator's machine, when environment variables
point at the files, and print aggregates.

## Parts list

The SETUP step (the UNO bench) and TEST's BENCH view carry bills of materials with checkboxes.
Selected items open one at a time — **AliExpress has no public add-to-cart API**, so you add
each to your own cart on its own page; affiliate attribution is set by the click itself, so
nothing is lost.

Links and prices are resolved **at build time** and committed, so the build stays
hermetic and a stale price shows up in the diff rather than ageing silently:

```bash
cd web && node --env-file=.env.local scripts/sync-aliexpress.mjs
```

Needs `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` and `ALIEXPRESS_TRACKING_ID`.
Run it with `--dry` to see what it would fetch without spending quota. Anything
in `data/parts.json` or `data/bench-parts.json` with no `productId` ships as a search link
instead of an invented one.

## Hardware

Full wiring, bill of materials and the bench procedure for the chip are in
[`docs/HARDWARE.md`](docs/HARDWARE.md) — and, in an interactive form, in the
app's SETUP step; for the cluster, in [`docs/BENCH.md`](docs/BENCH.md) and TEST's BENCH view.
Three things that are easy to get wrong on the chip bench:

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
so the two can be compared side by side. The DS2 core is E46M3 /// MONITORING's
(`web/packages/ds2-core`, vendored byte for byte).
