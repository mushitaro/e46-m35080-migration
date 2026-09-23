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

## The workflow

The tabs are the procedure, in order. Each one is enabled by what the previous
one produced — nothing about progress is stored, it is all derived from the
links and the image.

| | Step | With | What happens |
|---|---|---|---|
| 1 | **SETUP** | — | The UNO bench: wiring diagram, a seven-step assembly guide, the parts list |
| 2 | **READ** | UNO | Read the 1 KB image (twice, compared), decode the odometer and both VIN fields. **BACKUP** before any write |
| 3 | **RESTORE** | UNO | A backup onto a **new blank chip**, byte for byte, odometer not written — or, on a used chip, **REPAIR** the bytes it has lost |
| 4 | **REWRITE** | UNO | Raise the odometer to the car's true figure; write the VIN |
| 5 | **CODING** *(experimental)* | UNO | Read the chip with the NCS coding definition it was written with, and change what may safely be changed |
| 6 | **TEST** *(experimental)* | K+DCAN | The chip back in its cluster, the cluster on the desk: ask it, compare, move its needles and lamps |
| — | **INSPECT** | — | Open a `.bin`: what it is, edit a byte, fix the checksums, save a copy, or make it the PRACTICE chip |
| — | **RECORDS** | — | Every backup, and the image after every write |

After a read the tool says **which job this chip allows** rather than leaving you
to work it out: a donor below your target can simply be raised (no new chip), one
above it cannot be lowered at all.

Experimental steps are drawn only in the preview (`web/lib/domain/features.ts` says why each is
not yet a release, and a test pins the release's set). Promoting one is the operator's call.

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
  by an address that happens to hold something plausible. INSPECT shows their state on every
  edit and offers FIX CHECKSUMS; any write that lands inside a checksummed region recomputes it
  in the same plan, and the confirmation shows the checksum bytes.
- **Two VIN fields, which are different fields.** `CODED 07A` (late layout only): two letters
  and five BCD digits — the short VIN the cluster's own DS2 reply has the shape of — inside the
  `0x16E` region. `ASCII`: found by a scan (at `0x184` on the V6 chip), matching the
  registration. They can disagree, and the app says DIFFER. REWRITE writes every field the chip
  has — the coded one only on a late image whose checksums already hold, recomputing `0x16E`;
  blanking touches the ASCII field only. Which field the cluster reports is confirmed on the
  bench (TEST).

An image that is not the late layout (the older generation, or a file of unknown origin) is
still read, backed up, restored and rewritten, but no address in it is given a meaning the
measurements do not support, and CODING refuses it.

## Restoring onto a new chip

A new M35080 is blank: `0x00` counters and `0xFF` everywhere else. The car can
put back the **mileage**; it cannot put back the cluster's own data. So a
restore needs a backup of the original chip, and writes:

| Region | Written | Why |
|---|---|---|
| `0x020–0x3FF` | from the backup, byte for byte | the cluster's data — a new chip has none. The VIN fields travel with it |
| `0x000–0x01F` | **not written** | stays at 0 km, below the car, which syncs it up |

The reference project blanks `0x2E8–0x2EF` as "the VIN". On these chips that address is not
the VIN, so nothing is blanked. Its other rule stands: *"Mileage on new cluser MUST be lower
then mileage on your car"* — 0 km always is.

A backup whose standard array is one value repeated (all `FF`, all `00`, all
`A5`) is refused: those are failed reads or blank chips, not clusters. A late-layout backup
whose checksums do not hold is refused too — fix the file in INSPECT first, where you see which
byte changes. On a chip that is **not** blank, RESTORE offers REPAIR instead: only the
standard-array bytes that differ from the backup, never the odometer, and repeatable.

The sync to the car's higher mileage — held by the LCM from 09/2001, the EWS
before that — depends on the coding being right. **Check the odometer after
fitting and before driving.** If it still reads 0 km, set it on the REWRITE step.

## CODING — the chip off the cluster, on the UNO

CODING reads the image with every E46 cluster coding definition (NCS Expert's KMBE46M3.Cxx and
KMB_E46.Cxx), picks the one the chip was coded with, and lists every parameter — by block, in
the reader's language, with its keyword, address, current value and what may be done with it.
A definition is chosen only when every parameter that can tell definitions apart holds one of
its options **and** the definition's coding index is the one the chip carries; anything else is
a refusal with the closest fit shown.

A change is written only when every gate holds: late layout, both checksums holding before the
change, the chip's own definition, a parameter with at least two option values whose current
value is one of them, inside `0x070–0x16D` or `0x310–0x3CC`, clear of the odometer, the VIN
field, the K-numbers and the checksums. Only the mask's bits change; the checksums are
recomputed and shown before anything is sent. WRITE CODING goes through the same write path as
REWRITE: each byte written and read back, the whole chip read again and compared, the result
recorded (`Coding_…bin`, with the definition and each change in its note). Then put the chip
back and TEST the cluster.

DIFF compares, parameter by parameter, with the backup opened in RESTORE — the donor when
moving a cluster's identity to another. The rules and the measurements behind them are in
[`docs/CODING.md`](docs/CODING.md). **No chip changed this way has been put back in a cluster
yet**; that is why CODING is experimental.

## TEST — the cluster off the car, on the K+DCAN cable

TEST runs the cluster on the desk once its chip is back: it reads what the cluster says (IDENT,
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
| 12 V supply + → **1 A fuse** | cluster X11175 pin 4 | KL30, permanent |
| fused + → KL15 toggle | X11175 pins 5 and 6 | KL15 ignition, KL R |
| supply − | X11175 pin 1 | ground |
| fused + / supply − | OBD-II socket pin 16 / pins 4, 5 | the cable's power |
| OBD-II pin 7 | X11175 pin 25 | K-line (DS2) |

**The X11175 pin numbers come from one public pinout and are unverified** — the app marks them
so until they have been checked on a real cluster. Check every pin with a meter first, keep the
fuse in, and never connect the UNO to the cluster.

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
                          records · workflow (the step machine) · features (the registry) ·
                          hardware (the UNO pin map) · clusterBench (the TEST bench)
  lib/kombi               the cluster over DS2: telegrams, decode, mayRun, the simulated
                          cluster, the link, the checks, the report, the bit names
  lib/ncs                 coding: which definition a chip was coded with, its rows,
                          planCoding, and what the CODING screen derives
  lib/refdata             the reference data's types, validation and loading
  lib/hub                 the hub, derived per link: bridge (with coding), cluster
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
increment-only rule, and TEST against a simulated cluster. INSPECT's USE AS PRACTICE CHIP makes
a file you opened the chip PRACTICE reads.

`next dev` draws what a release draws. CODING and TEST are experimental and appear in a preview
build:

```bash
npm run build:preview && npm run serve:out   # http://localhost:5050 (or PORT)
```

That server has no functions — no gate, no SYNC, no `/api/ref` — so CODING's definitions and
TEST's names are opened as files (`kombi-coding.json`, `kombi-names.json`). localhost is a
secure context, so the UNO and the K+DCAN cable work there as on the deployed preview. For the
gate and SYNC, see [Running the gate and SYNC locally](#running-the-gate-and-sync-locally).

```bash
npm run test        # token rules → BMW-data guard → ds2-core vendor check → the vitest suite
npm run typecheck   # the app, then functions/
npm run build       # static export to web/out (production identity)
python -m unittest discover -s ../tools/refdata   # the generator
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
- **Desktop Chrome or Edge only.** The bridge and the K+DCAN cable are reached over Web Serial,
  which no phone browser and neither Firefox nor Safari has.
- **SYNC.** RECORDS › SYNC keeps this device's records — each backup, and the
  image after each rewrite, reset, restore or coding — in the owner's own account, where
  another device can RESTORE them. When an operation fails, the app sends an
  error record by itself. Both are stored per owner; nobody else can list, read
  or delete them. What is sent and for how long is in the privacy policy:
  <https://m3.tsunagi.app/privacy-policy#preview>
  (English: <https://m3.tsunagi.app/en/privacy-policy#preview>), linked from the
  shield in the preview's header. TEST reports are downloaded, never sent.
- **Reference data.** CODING's definitions and TEST's names are served from `/api/ref/<name>`
  to the signed-in owner only, from a private R2 bucket, and held in memory (below).
- **Production sends nothing.** A build without `app-variant=preview` has no
  SYNC panel, no PRIVACY link and makes no `/api` or `/_gate` request
  (`lib/sync/cloud.ts` `canSync()`, pinned by `test/sync.test.ts`; `lib/refdata/load.ts`).

The source carries production's identity (`E46 M35080 /// MIGRATION`,
`M35080`, the M ICON `migration` set). The preview is branded after the
compile:

```bash
npm run build          # next build → build-id → gen-sw → verify-export
npm run build:preview  # next build → build-id → brand-preview out PREVIEW → gen-sw → verify-export
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
