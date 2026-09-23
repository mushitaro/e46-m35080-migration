/**
 * Turns scripts/sw.template.js into out/sw.js, with this build's file list and a cache name
 * derived from this build's contents.
 *
 *     next build → build-id.mjs → (brand-preview.mjs) → gen-sw.mjs → verify-export.mjs
 *
 * Ported from E46M3-Diagnosis. This repository used to ship a hand-written public/sw.js whose cache
 * was named `m35080-migration-v3`, bumped by hand, precaching three files. A forgotten bump is a
 * device serving the previous build's page with no way to tell. Here the name is a hash of the bytes
 * being cached, so it changes exactly when they do.
 *
 * LAST in the build, always: anything that rewrites a byte after this (a stamp, a brand) would ship
 * under a cache name that describes bytes that no longer exist (tsunagi-m-release section 5.5).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = 'out';
const TEMPLATE = join('scripts', 'sw.template.js');
const CACHE_PREFIX = 'm35080-';
/** Empty on Cloudflare Pages. next.config.ts still honours a basePath, so the worker does too. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Not precached, each for its own reason:
 *
 *   sw.js          the worker cannot be one of its own assets
 *   version.json   the deploy verifier fetches it from the network on purpose; a cached copy would
 *                  answer "which build is deployed" with whatever was deployed last time
 *   *.map          source maps are for a debugger on a desk, not for a bench
 *   .well-known/*  host-level verification files, fetched outside this scope
 *   .nojekyll      a GitHub Pages marker; nothing serves it as a file
 *   _headers, _routes.json, _redirects
 *                  Cloudflare Pages reads these as configuration and never serves them. Listed, one
 *                  would be an entry the host can never answer - and one failed entry fails the
 *                  whole install.
 */
const NOT_PRECACHED = new Set(['/sw.js', '/version.json', '/.nojekyll', '/_headers', '/_routes.json', '/_redirects']);
const isAsset = (url) => !NOT_PRECACHED.has(url) && !url.endsWith('.map') && !url.startsWith('/.well-known/');

/**
 * Where the worker FETCHES a document from, which is not where it is stored.
 *
 * Cloudflare Pages answers `/index.html` with a 308 to `/`, and `/x/index.html` with a 308 to
 * `/x/` (trailingSlash export). Behind the owner gate a redirect is no longer a harmless detour: it
 * is exactly what an expired session looks like, so the worker treats any redirect it did not
 * expect as a failed install (sw.template.js, `isGenuine`). Fetching the URL the host actually
 * serves means a healthy install sees no redirect at all; the response is then stored under the
 * original `.html` key, which is what the navigate branch looks up.
 */
const fetchUrlOf = (url) => {
  if (!url.endsWith('.html')) return url;
  if (url === '/index.html') return '/';
  if (url.endsWith('/index.html')) return url.slice(0, -'index.html'.length);
  return url.slice(0, -'.html'.length);
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const paths = walk(OUT).sort();
const urlOf = (path) => '/' + relative(OUT, path).split(sep).join('/');

/**
 * `{ url, fetch, bytes }`: `url` is the cache key, `fetch` is where the host serves it (above), and
 * the on-disk size is the total an install can report against - content-length is the compressed
 * size where the host compresses, and would not add up.
 */
const assets = paths
  .map((path) => ({ url: urlOf(path), path }))
  .filter(({ url }) => isAsset(url))
  .map(({ url, path }) => ({ url: BASE + url, fetch: BASE + fetchUrlOf(url), bytes: statSync(path).size }));

if (!assets.some(({ url }) => url === `${BASE}/index.html`)) {
  // Without the document there is no offline app, only a cache.
  throw new Error('gen-sw: out/index.html is missing — did next build run?');
}

// Every document in the export, so the navigate branch can resolve a path to the right one.
const documents = assets.map(({ url }) => url).filter((url) => url.endsWith('.html'));

// Hash the bytes, in a fixed order, with the name alongside the content so that moving a file to a
// new path counts as a change even if its bytes do not. The template is hashed too: a change to the
// worker's own logic must reach devices even when the export did not change.
const digest = createHash('sha256');
digest.update(readFileSync(TEMPLATE));
for (const path of paths) {
  const url = urlOf(path);
  if (!isAsset(url)) continue;
  digest.update(url);
  digest.update(readFileSync(path));
}
const cacheName = `${CACHE_PREFIX}${digest.digest('hex').slice(0, 12)}`;

const worker = readFileSync(TEMPLATE, 'utf8')
  .replace("'__CACHE_NAME__'", JSON.stringify(cacheName))
  .replace("'__BASE__'", JSON.stringify(BASE))
  .replace('__DOCUMENTS__', JSON.stringify(documents, null, 2))
  .replace('__ASSETS__', JSON.stringify(assets, null, 2));

for (const placeholder of ['__CACHE_NAME__', '__BASE__', '__ASSETS__', '__DOCUMENTS__']) {
  // A template whose placeholder silently survived produces a worker that throws on load, which
  // presents as "the app has no offline cache" with nothing pointing here.
  if (worker.includes(placeholder)) throw new Error(`gen-sw: ${placeholder} was not substituted`);
}

writeFileSync(join(OUT, 'sw.js'), worker);

const bytes = assets.reduce((sum, { bytes: n }) => sum + n, 0);
console.log(
  `gen-sw: ${assets.length} assets (${documents.length} documents), ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB, cache ${cacheName}`,
);
