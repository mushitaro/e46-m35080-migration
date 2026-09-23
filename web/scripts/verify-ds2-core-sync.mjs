#!/usr/bin/env node
/**
 * verify-ds2-core-sync - the vendored @tsunagi/ds2-core is byte-for-byte its upstream.
 *
 * tsunagi-m-stack section 5: shared code is VENDORED (copied, never forked) and a hash check
 * fails the gate when the copy drifts. The upstream is E46M3 /// MONITORING's
 * packages/ds2-core (github.com/mushitaro/E46M3-Monitoring), where the DS2 link was measured on a
 * car; this repository uses it for TEST, to talk to a cluster on the bench.
 *
 * Two different questions, two different answers - they are never folded into one:
 *
 *   1. Was the local copy edited?     packages/ds2-core against the hashes in packages/VENDOR.json.
 *                                     Always answerable: both are in this repository.
 *   2. Has the upstream moved on?     packages/VENDOR.json against the upstream checkout.
 *                                     Answerable only where that checkout exists.
 *
 *   exit 0   the copy matches VENDOR.json, and VENDOR.json matches the upstream
 *   exit 1   something DIFFERS (named, file by file)
 *   exit 2   COULD NOT COMPARE the upstream (not found, or its path has uncommitted changes) -
 *            printed as such, never as a pass
 *
 *   node scripts/verify-ds2-core-sync.mjs               both questions
 *   node scripts/verify-ds2-core-sync.mjs --missing-ok  as above, but an absent upstream is exit 0
 *                                                       WITH the COULD NOT COMPARE line (CI and
 *                                                       `npm run test`, which have no sibling checkout)
 *   node scripts/verify-ds2-core-sync.mjs --update      copy the upstream in and rewrite VENDOR.json
 *                                                       from the UPSTREAM's bytes, never local ones
 *
 * Upstream location: DS2_CORE_UPSTREAM, else the sibling checkout ../E46M3-Diagnosis next to this
 * repository.
 *
 * Hashes are over LF-normalised text, so a CRLF checkout (core.autocrlf on Windows) and CI's LF
 * checkout agree.
 *
 * STOP CONDITION: when this repository and E46M3 /// MONITORING become one monorepo, delete this
 * script, packages/VENDOR.json and test/vendor.test.ts, and import the package from its one place.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '..');
const VENDORED = join(WEB, 'packages', 'ds2-core');
const MANIFEST = join(WEB, 'packages', 'VENDOR.json');
const UPSTREAM = resolve(process.env.DS2_CORE_UPSTREAM || join(ROOT, '..', 'E46M3-Diagnosis', 'packages', 'ds2-core'));

const MISSING_OK = process.argv.includes('--missing-ok');
const UPDATE = process.argv.includes('--update');

/** The files that make the package: its package.json and everything under src/. */
function packageFiles(dir) {
  const out = ['package.json'];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(join(dir, 'src'));
  return out.sort();
}

export function lfHash(buf) {
  return createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function hashes(dir) {
  return Object.fromEntries(packageFiles(dir).map((f) => [f, lfHash(readFileSync(join(dir, f)))]));
}

function diffSets(expected, actual) {
  const problems = [];
  for (const [f, h] of Object.entries(expected)) {
    if (!(f in actual)) problems.push(`missing   ${f}`);
    else if (actual[f] !== h) problems.push(`differs   ${f}`);
  }
  for (const f of Object.keys(actual)) if (!(f in expected)) problems.push(`extra     ${f}`);
  return problems;
}

/** null when the upstream path is committed; otherwise why it cannot be trusted as a reference. */
function upstreamUnusable() {
  if (!existsSync(join(UPSTREAM, 'package.json'))) return `upstream not found at ${UPSTREAM}`;
  try {
    const dirty = execFileSync('git', ['-C', UPSTREAM, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim();
    if (dirty) return `upstream has uncommitted changes under ${UPSTREAM}`;
  } catch {
    return `upstream at ${UPSTREAM} is not in a git checkout`;
  }
  return null;
}

function upstreamCommit() {
  return execFileSync('git', ['-C', UPSTREAM, 'log', '-1', '--format=%H', '--', '.'], { encoding: 'utf8' }).trim();
}

const readManifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (UPDATE) {
  const why = upstreamUnusable();
  if (why) {
    console.error(`ds2-core: COULD NOT UPDATE - ${why}`);
    process.exit(2);
  }
  rmSync(VENDORED, { recursive: true, force: true });
  mkdirSync(VENDORED, { recursive: true });
  for (const f of packageFiles(UPSTREAM)) {
    mkdirSync(dirname(join(VENDORED, f)), { recursive: true });
    cpSync(join(UPSTREAM, f), join(VENDORED, f));
  }
  const manifest = {
    '//': 'Written by scripts/verify-ds2-core-sync.mjs --update from the UPSTREAM bytes. Do not edit, and do not edit packages/ds2-core/ - change it upstream and update.',
    'ds2-core': {
      upstream: 'E46M3 /// MONITORING, packages/ds2-core',
      repository: 'https://github.com/mushitaro/E46M3-Monitoring',
      commit: upstreamCommit(),
      hash: 'sha256 of LF-normalised text',
      files: hashes(UPSTREAM),
    },
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`ds2-core: vendored ${Object.keys(manifest['ds2-core'].files).length} files at ${manifest['ds2-core'].commit.slice(0, 8)}`);
  process.exit(0);
}

// 1. The local copy against the manifest - always answerable.
const manifest = readManifest()['ds2-core'];
const local = diffSets(manifest.files, hashes(VENDORED));
if (local.length) {
  console.error('ds2-core: the vendored copy DIFFERS from packages/VENDOR.json (it was edited here):');
  for (const p of local) console.error(`  ${p}`);
  console.error('Change it upstream and run --update; never edit the copy.');
  process.exit(1);
}

// 2. The manifest against the upstream - only where the upstream exists.
const why = upstreamUnusable();
if (why) {
  console.log(`ds2-core: copy matches VENDOR.json (${manifest.commit.slice(0, 8)}). Upstream COULD NOT COMPARE - ${why}`);
  process.exit(MISSING_OK ? 0 : 2);
}
const upstream = diffSets(manifest.files, hashes(UPSTREAM));
if (upstream.length) {
  console.error(`ds2-core: the upstream DIFFERS from the vendored copy (vendored ${manifest.commit.slice(0, 8)}, upstream ${upstreamCommit().slice(0, 8)}):`);
  for (const p of upstream) console.error(`  ${p}`);
  console.error('Review the upstream change, then run: node scripts/verify-ds2-core-sync.mjs --update');
  process.exit(1);
}
console.log(`ds2-core: vendored copy is the upstream at ${manifest.commit.slice(0, 8)} (${Object.keys(manifest.files).length} files)`);
