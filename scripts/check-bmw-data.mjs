#!/usr/bin/env node
// check-bmw-data — nothing BMW-derived that THIS tool handles is tracked by git.
//
// scripts/check-public-tree.mjs is the canonical, shared check (a copy of the one in
// tsunagi-m3) and is not edited here. It already refuses .bin/.prg/.ipo and VINs. This file adds
// the shapes only this repository meets, because this is the repository that reads them:
//
//   - NCS Expert coding data: the C-files (KMB_E46.C08, KMBE46M3.C24 - a two-hex-digit
//     extension), the keyword tables (SWTFSW06.dat, SWTPSW06.dat) and the order tables (.000).
//   - EDIABAS group files (.grp) and the job/telegram/text tables extracted from SGBDs.
//   - The reference data tools/refdata generates from those (kombi-coding.json, kombi-names.json).
//     It is served only from behind the owner gate, never committed and never in the static build
//     (THIRD-PARTY-NOTICES.md section 3.3).
//   - A 1024-byte binary under any name: that is an M35080 image, and a chip image identifies a car.
//
//   node scripts/check-bmw-data.mjs            the tracked tree (git ls-files)
//   node scripts/check-bmw-data.mjs --staged   what is about to be committed
//
// Runs from any directory: it moves to the repository root first, so `npm run test` in web/ can
// call it too. Exceptions go in .public-tree-allow (one path per line), the same file the shared
// check reads.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const STAGED = process.argv.includes('--staged');

process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());

const RULES = [
  [/\.[cC][0-9A-Fa-f]{2}$/, 'NCS Expert coding data (C-file)'],
  [/(^|\/)SWT[A-Za-z]{3}\d{2}\.dat$/i, 'NCS Expert keyword table'],
  [/\.\d{3}$/, 'NCS Expert order/chassis table'],
  [/\.grp$/i, 'EDIABAS group file'],
  [/\.(jobs|telegrams|jobtext)\.json$/i, 'table extracted from a BMW SGBD'],
  [/(^|\/)kombi-(coding|names)\.json$/i, 'generated reference data (served behind the owner gate only)'],
];

const CHIP_IMAGE_BYTES = 1024;

const allow = new Set(
  fs.existsSync('.public-tree-allow')
    ? fs
        .readFileSync('.public-tree-allow', 'utf8')
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*/, '').trim())
        .filter(Boolean)
    : [],
);

const files = execFileSync(
  'git',
  STAGED ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

function contents(f) {
  try {
    return STAGED ? execFileSync('git', ['show', `:${f}`], { maxBuffer: 64 << 20 }) : fs.readFileSync(f);
  } catch {
    return null;
  }
}

const problems = [];
for (const f of files) {
  if (allow.has(f)) continue;
  const rule = RULES.find(([re]) => re.test(f));
  if (rule) {
    problems.push(`${f}: ${rule[1]}`);
    continue;
  }
  const buf = contents(f);
  // Text that happens to be 1024 bytes is not an image; an image of a real chip is binary.
  if (buf && buf.length === CHIP_IMAGE_BYTES && buf.includes(0)) {
    problems.push(`${f}: a 1024-byte binary - the size of an M35080 image`);
  }
}

if (problems.length) {
  console.log('BMW-derived data or a chip image is tracked:');
  for (const p of problems) console.log(`  ${p}`);
  console.log('\nRemove it (it is already in .gitignore), or list a deliberate exception in .public-tree-allow.');
  process.exit(1);
}
console.log(`bmw data: ok (${files.length} file(s) checked)`);
