/**
 * Stamps every exported document with a build id you can say out loud, and writes
 * `out/version.json` so the deploy verifier can compare what is served against what was built.
 *
 *     next build → build-id.mjs → (brand-preview.mjs) → gen-sw.mjs → verify-export.mjs
 *
 * Ported from E46M3-Diagnosis (itself from E46M3CSL_TuningTool). This repository had no build id
 * at all: the deployed preview could not say which commit it was, and a phone on the bench could
 * not be compared with the desk.
 *
 * ## The format: `<count>.<sha>`, e.g. `12.eb45f1b`
 *
 * `git rev-list --count HEAD` is monotonic on a linear history, so a larger number is a later build.
 * The short sha turns the number back into a diff. A `+` suffix marks a build made with changes
 * that are not committed (scripts/tree-state.mjs, shared with deploy.mjs) - the thing you want to
 * know before trusting a number that looks like a commit. deploy.mjs refuses a `+` build.
 *
 * ## Why this is not the service worker's cache name
 *
 * gen-sw.mjs names the cache after a hash of the built bytes, which changes exactly when the
 * contents do. That is a correct cache key and a useless build number: it orders nothing and points
 * at no commit. Two questions, two values.
 *
 * ## Before gen-sw, always
 *
 * gen-sw hashes the bytes it is about to cache. A stamp written after it would ship under the
 * previous build's cache name, and a device holding that cache would keep serving the older HTML.
 *
 * Falls back to `dev` when git is unavailable rather than failing the build: a build id is a
 * convenience, and refusing to produce an export because `git` is missing would not be.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { dirtyPaths } from './tree-state.mjs';

const OUT = 'out';

if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`[FATAL] ${OUT}/index.html is missing. Run \`next build\` first.`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function buildId() {
  try {
    const count = git(['rev-list', '--count', 'HEAD']);
    const sha = git(['rev-parse', '--short', 'HEAD']);
    const dirty = dirtyPaths().length > 0 ? '+' : '';
    return `${count}.${sha}${dirty}`;
  } catch {
    return 'dev';
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const id = buildId();
// ISO to the minute. Seconds add noise to something read by a human comparing two devices.
const at = new Date().toISOString().slice(0, 16) + 'Z';

let patched = 0;
for (const path of walk(OUT)) {
  if (extname(path) !== '.html') continue;
  const html = readFileSync(path, 'utf8');
  if (!html.includes('</head>')) continue;
  // STRIP FIRST, then insert. out/ is not guaranteed to be a fresh export, and an insert-only
  // stamp appends a SECOND tag to a document that already had one - measured on the tuner's
  // preview: two build-id metas, the stale one first, which is the one every reader takes.
  writeFileSync(
    path,
    html
      .replace(/<meta name="build-(?:id|at)" content="[^"]*"\s*\/?>/g, '')
      .replace(/<\/head>/, `<meta name="build-id" content="${id}"><meta name="build-at" content="${at}"></head>`),
  );
  patched++;
}

if (patched === 0) {
  console.error('[FATAL] no document carried a </head> to stamp. Nothing would say which build this is.');
  process.exit(1);
}

// scripts/verify-deploy.mjs reads this back and compares it against the meta tag it fetched from
// the live URL. It is never precached (gen-sw.mjs): a cached copy would answer "which build is
// deployed" with whatever was deployed last time.
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ buildId: id, builtAt: at, documents: patched }, null, 2) + '\n');

console.log(`[build-id] ${id} (${at}) -> ${patched} document(s)`);
