# Third-party notices and data provenance

This file records what this project depends on, what it is derived from, and what is
deliberately kept out of the repository.

**This is a record of facts, not legal advice.**

The code in this repository is MIT (`LICENSE`, Copyright (c) 2026 TSUNAGI). That licence
covers the code. It does not cover, and cannot relicense, anything in §3.

---

## 1. Dependencies

### 1.1 Shipped in the app (`web/`)

| Package | License | How it reaches a user |
|---|---|---|
| next, react, react-dom | MIT | bundled into the static export |
| lucide-react | ISC | bundled (the icons the UI draws) |
| Inter, JetBrains Mono (through `next/font/google`) | SIL OFL 1.1 | downloaded at build time and self-hosted in the export |
| tailwindcss, @tailwindcss/postcss | MIT | build time; its output is the shipped CSS |

Exact versions are in `web/package.json` and `web/package-lock.json`.

### 1.2 Build and test only (not shipped)

typescript (Apache-2.0), vitest (MIT), @types/* (MIT), @cloudflare/workers-types
(MIT OR Apache-2.0, types only). Wrangler is run through `npx` for local development and
deployment and is not a dependency.

The preview's Pages Functions (`web/functions/`) are this repository's own code. The owner
gate in `web/functions/_owner-gate/` and `web/lib/sync/owner-sync.ts` are byte-for-byte
copies of `tools/owner-gate` in tsunagi-m3 (MIT, same author); `npm run gate:verify` checks
that they have not drifted.

### 1.3 What the app talks to

The Arduino UNO bridge, over Web Serial. Nothing else in the production build: no API, no
analytics, no third party.

The preview build — for owners who hold `owner_preview` on m3.tsunagi.app — also talks to
its own origin: `/_gate/status` (is the owner still signed in), `/api/sessions` (the chip
records the owner chooses to SYNC: the 1 KB image, the short VIN, the odometer reading, the
kind of record, its parent, its note and whether it was PRACTICE) and `/api/diagnostics`
(error records the app sends by itself when an operation fails). They are stored per owner
in Cloudflare D1. What is sent, and for how long, is disclosed on m3's `/preview-notice`
before first use and in its privacy policy
(<https://m3.tsunagi.app/privacy-policy#preview>), which the preview links from its header.

---

## 2. Code this project builds on

The SPI primitives and the odometer / VIN encoding derive from
[`gerchanovsky/m35080_odometer_fix`](https://github.com/gerchanovsky/m35080_odometer_fix),
which states the Unlicense, and which was itself forked from
`kaeferfreund/m35080_Read_BitBang`. The jumper colours in the wiring diagram are the ones
that repository's comments use, so the two can be compared side by side.

`web/packages/ds2-core/` is a vendored copy of `packages/ds2-core` from
[`mushitaro/E46M3-Monitoring`](https://github.com/mushitaro/E46M3-Monitoring) (MIT, the same
author), the DS2 link that tool measured on a car. TEST uses it to talk to a cluster on the
bench. It is copied, never edited: `web/packages/VENDOR.json` records the upstream commit and a
hash of every file, and `web/scripts/verify-ds2-core-sync.mjs` (run by `npm run test`) fails when
the copy and the record disagree.

---

## 3. Not in this repository

This repository is public. `scripts/check-public-tree.mjs` — run by the pre-commit hook
(`npm run hooks:install` in `web/`), by CI and by `npm run deploy` — refuses a tree that
tracks any of the following.

### 3.1 Chip images from a real car

An M35080 image holds a car's odometer and the last seven characters of its VIN. The app
reads them from the owner's own chip, or opens a `.bin` the owner has on disk; they live in
that browser's IndexedDB and in the files the owner downloads, and nowhere else unless the
owner presses SYNC in the preview. No real image is committed: `.bin` files are refused by
the check, and every image the tests use is built in code from made-up values.

`.diagnostics/` (the bench's chip baselines, probe scripts and the UNO's previous flash) is
gitignored for the same reason.

### 3.2 VINs

A full VIN is refused by the check (`WBS` followed by fourteen VIN characters). The one
full VIN in the tests, `WBSXX00000AB12345`, is made up and is listed in
`.public-tree-allow`. The short VINs in the tests and comments are not from any car this
project has handled: `KT17727`, `KP83884` and `AW72288` are the examples published in the
upstream [`gerchanovsky/m35080_odometer_fix`](https://github.com/gerchanovsky/m35080_odometer_fix)
(its README and sketch), and `ABC12345` / `CD67890` are made up. The bench chip's own VIN
was replaced with `ABC12345` before the first public commit.

### 3.3 BMW data

Nothing here is derived from BMW software or data: no NCS Expert or SGBD files, no coding
data, no factory images. A feature that needs BMW coding data reads it from files the user
supplies at run time; those files are never committed (the check refuses the BMW file
types), because they are BMW's and not ours to publish.

### 3.4 Secrets and local state

`.env*`, `.dev.vars` (the local gate secret) and `.wrangler/` (wrangler's local D1 and
bundles) are gitignored and refused by the check. `web/.env.local` holds the AliExpress API
keys for `scripts/sync-aliexpress.mjs`.
