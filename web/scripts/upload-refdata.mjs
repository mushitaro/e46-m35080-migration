#!/usr/bin/env node
/**
 * upload-refdata - put the generated reference data into the preview's private R2 bucket.
 *
 * The operator runs this after tools/refdata/gen_refdata.py, on the machine that has NCS Expert,
 * the private terms and wrangler's login. It reads the JSON from REFDATA_OUT (default
 * C:\EDIABAS-derived\m35080-refdata - outside the repository, where the generator writes it),
 * refuses a file that is not what the app expects, and puts each one with
 * `wrangler r2 object put --remote`. The bucket's name is read from wrangler.jsonc, the one place
 * it is written. Nothing here reads from or writes to the repository tree.
 *
 * What it uploads is BMW-derived (THIRD-PARTY-NOTICES.md 3.3): the bucket is private, and the
 * only way out of it is /api/ref behind the owner gate.
 *
 *   node scripts/upload-refdata.mjs          validate, then upload both files
 *   node scripts/upload-refdata.mjs --check  validate and stop
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.REFDATA_OUT || 'C:\\EDIABAS-derived\\m35080-refdata';
const CHECK_ONLY = process.argv.includes('--check');
/** The files the app asks for, by the kind each declares. functions/_lib/refdata.ts serves the same names. */
const FILES = {
  'kombi-coding': (d) => d.definitions && typeof d.definitions === 'object' && d.names && typeof d.names === 'object',
  'kombi-names': (d) => d.variants && typeof d.variants === 'object',
};
/** Far above what the generator writes; a file this size is not reference data. */
const MAX_BYTES = 8 * 1024 * 1024;

function refuse(msg) {
  console.error(`upload-refdata: REFUSED - ${msg}\n        Nothing was uploaded.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(WEB, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const bucket = config.r2_buckets?.find((b) => b.binding === 'REFDATA')?.bucket_name;
if (!bucket) refuse('wrangler.jsonc binds no REFDATA bucket.');
if (!existsSync(SOURCE)) refuse(`${SOURCE} does not exist. Run tools/refdata/gen_refdata.py first (or set REFDATA_OUT).`);

const ready = [];
for (const [name, shaped] of Object.entries(FILES)) {
  const path = join(SOURCE, `${name}.json`);
  if (!existsSync(path)) refuse(`${path} is missing.`);
  const size = statSync(path).size;
  if (size > MAX_BYTES) refuse(`${path} is ${size} bytes.`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    refuse(`${path} is not JSON: ${e.message}`);
  }
  if (doc.schema !== 1) refuse(`${path}: schema ${doc.schema}, the app reads schema 1.`);
  if (doc.kind !== name) refuse(`${path}: kind "${doc.kind}", expected "${name}".`);
  if (!shaped(doc)) refuse(`${path}: not the shape the app reads.`);
  ready.push({ name, path, size, generatedAt: doc.generatedAt });
  console.log(`ok    ${name}.json  ${size} bytes, generated ${doc.generatedAt}`);
}

if (CHECK_ONLY) {
  console.log(`\nupload-refdata --check: both files are fit to upload to ${bucket}. Stopping.`);
  process.exit(0);
}

for (const f of ready) {
  const key = `${bucket}/${f.name}.json`;
  console.log(`upload-refdata: wrangler r2 object put ${key}`);
  try {
    execFileSync(
      'npx',
      ['--yes', 'wrangler@4', 'r2', 'object', 'put', key, '--file', f.path, '--content-type', 'application/json', '--remote'],
      { cwd: WEB, stdio: 'inherit', shell: process.platform === 'win32' },
    );
  } catch {
    refuse(`wrangler could not put ${key}.`);
  }
}
console.log(`upload-refdata: ${ready.length} file(s) in ${bucket}. The preview serves them at /api/ref/<name> to signed-in owners.`);
