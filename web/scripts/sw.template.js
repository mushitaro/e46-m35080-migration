/*
 * Service worker for E46 M35080 /// MIGRATION.
 *
 * scripts/gen-sw.mjs fills in this build's file list and a content-hash cache name after
 * `next build`, and writes the result to out/sw.js. This file is never served: it lives in scripts/
 * rather than public/ so that Next does not publish the template alongside the worker made from it.
 *
 * This app writes to an EEPROM in a car's instrument cluster, so a stale copy of it is not a
 * cosmetic bug - it is the wrong logic deciding what to write. That constraint picks every rule
 * below, as it did in the hand-written worker this replaces:
 *
 *   - Documents are NETWORK-FIRST. Online you always run the current build; the cache is the
 *     offline fallback and nothing more.
 *   - /_next/static/* is content-hashed, so a cached copy can never be stale. Cache-first.
 *   - No skipWaiting(), and no message that asks for one. Swapping the code out from under a write
 *     in flight is the one failure this tool cannot afford, so an update lands on the next cold
 *     start. And an install does not even DOWNLOAD while a page has the bridge connected (see
 *     `anyPageBusy`): it gives up, and the browser tries again at its next check.
 *   - Nothing cross-origin is touched. Web Serial is not HTTP and never passes through here.
 *
 * ## Behind the owner gate (the preview)
 *
 * The preview origin is served through web/functions/_middleware.ts, which answers a request
 * without a session with a redirect to m3 (a page load) or a 401 (anything else). Neither may ever
 * be mistaken for the app:
 *
 *   - /_gate/* and /api/* are network-only, decided BEFORE the navigate branch. Otherwise the
 *     "sign in again" navigation (/_gate/start) or m3 sending the owner back (/_gate/callback)
 *     would be answered with the cached shell and nobody could ever sign in; and a SYNC list from a
 *     cache would be a lie about what the account holds.
 *   - The install is all-or-nothing, and an asset counts only when it came back as itself: 2xx,
 *     same-origin, not bounced through /_gate/, and of the type its name says. Anything else leaves
 *     the previous version installed and working - which is the whole point when the failure was
 *     an expired session.
 *   - A navigation that comes back as an opaque redirect (the gate sending the page to m3) or any
 *     non-2xx is answered from the cached build when there is one, so an owner whose session lapsed
 *     still opens the app they installed. The app offers "sign in again" itself, and only when
 *     nothing is connected.
 *
 * ## Nothing is written at run time
 *
 * What is cached is exactly what the install checked. A response kept at run time could be the new
 * build's page sitting in the old build's cache, whose chunks are not there - an app that opens
 * offline and then dies.
 */

const CACHE = '__CACHE_NAME__';
/** Empty on Cloudflare Pages; the basePath next.config.ts would add under a sub-path deploy. */
const BASE = '__BASE__';
/** `[{ url, fetch, bytes }]`: `url` is the key, `fetch` is where the host serves it (gen-sw.mjs). */
const ASSETS = __ASSETS__;
/** Every .html in the export. The navigate branch resolves against this rather than assuming one. */
const DOCUMENTS = __DOCUMENTS__;

/** How long an install waits for open pages to say whether they are busy. Silence is "not busy". */
const BUSY_ASK_MS = 500;

/**
 * What a file's name says it is. A response whose Content-Type disagrees is not that file - the case
 * that matters is HTML where a script was expected, which is what a sign-in or error page looks like
 * from here.
 */
const TYPES = {
  '.html': 'text/html',
  '.js': 'javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

function typeMatches(url, response) {
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const dot = url.lastIndexOf('.');
  const expected = dot > url.lastIndexOf('/') ? TYPES[url.slice(dot)] : undefined;
  if (expected) return type.includes(expected);
  // An extension this table does not know: accept it, unless it is a document pretending.
  return !type.includes('text/html');
}

/**
 * Whether a response is the asset itself and not something standing in for it. `ok` alone is not
 * enough behind the gate: a redirect that was followed can still end in a 200.
 */
function isGenuine(asset, response) {
  if (!response.ok || response.type !== 'basic') return false;
  if (response.redirected) {
    const to = new URL(response.url);
    if (to.origin !== self.location.origin || to.pathname.startsWith('/_gate/')) return false;
  }
  return typeMatches(asset.url, response);
}

/**
 * A copy holding the bytes we actually have. Re-wrapping clears `redirected` (a redirected response
 * may not satisfy a navigation - measured as a blank screen on Pages, which 308s /index.html), and
 * drops the framing headers, which describe the compressed bytes on the wire and not these.
 */
function rewrap(body, response) {
  const headers = new Headers(response.headers);
  for (const framing of ['content-encoding', 'content-length', 'transfer-encoding']) headers.delete(framing);
  return new Response(body, { status: 200, statusText: 'OK', headers });
}

/**
 * Asks every open page whether it has the bridge connected. True if any says so. A page that does
 * not answer in time - an old build, a frozen tab - is not busy, so a page can delay an update but
 * never block updates for good. Pages answer from components/ServiceWorkerRegistrar.tsx.
 */
async function anyPageBusy() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const answers = await Promise.all(
    pages.map(
      (page) =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve(false), BUSY_ASK_MS);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve(e.data === true);
          };
          page.postMessage({ type: 'busy?' }, [channel.port2]);
        }),
    ),
  );
  return answers.includes(true);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (await anyPageBusy()) throw new Error('a page has the bridge connected; the update waits for the next check');

      // The same name is the same bytes (the name IS their hash). If that cache is already whole,
      // there is nothing to download.
      if (await caches.has(CACHE)) {
        const have = new Set((await (await caches.open(CACHE)).keys()).map((r) => new URL(r.url).pathname));
        if (ASSETS.every((a) => have.has(a.url))) return;
      }

      // Downloaded into a staging cache and copied over only when EVERY asset passed, so a failure
      // leaves nothing half-written - not even in a cache of the same name.
      const stagingName = `${CACHE}-staging`;
      await caches.delete(stagingName);
      const staging = await caches.open(stagingName);
      const results = await Promise.allSettled(
        ASSETS.map(async (asset) => {
          const response = await fetch(asset.fetch || asset.url, { cache: 'reload', credentials: 'same-origin' });
          if (!isGenuine(asset, response)) {
            throw new Error(`${response.status} ${response.type}${response.redirected ? ' redirected' : ''} for ${asset.url}`);
          }
          await staging.put(asset.url, rewrap(await response.blob(), response));
        }),
      );
      const failed = ASSETS.filter((_, i) => results[i].status === 'rejected');
      if (failed.length > 0) {
        await caches.delete(stagingName);
        // The installed version keeps running: only `activate` deletes caches, and a worker whose
        // install threw never activates.
        throw new Error(`precache incomplete: ${failed.length}/${ASSETS.length} failed, first was ${failed[0].url}`);
      }
      const cache = await caches.open(CACHE);
      for (const asset of ASSETS) {
        const hit = await staging.match(asset.url);
        if (hit) await cache.put(asset.url, hit);
      }
      await caches.delete(stagingName);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The cache name is a hash of the build's own contents, so anything that is not the current
      // name is a build nobody can reach any more.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // Safe here precisely BECAUSE there is no skipWaiting: when this runs it is either the first
      // install or every page of the older build is already gone.
      await self.clients.claim();
    })(),
  );
});

/** The cached document for a path: its own, else the app shell. Null when nothing usable is cached. */
async function cachedDocument(pathname) {
  const path = pathname.replace(/\/+$/, '');
  const candidates =
    path === '' || path === BASE ? [`${BASE}/index.html`] : [`${path}/index.html`, `${path}.html`, `${BASE}/index.html`];
  for (const candidate of candidates) {
    if (!DOCUMENTS.includes(candidate)) continue;
    const hit = await caches.match(candidate, { cacheName: CACHE });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave third parties alone

  // The gate and the API: the network, always, and decided before anything else.
  if (url.pathname.startsWith('/_gate/') || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        let response = null;
        try {
          response = await fetch(request);
        } catch {
          response = null; // offline
        }
        // 2xx from the network: the current build. Anything else - offline, the gate's redirect to
        // m3 (an opaque redirect here), a 401, a 503 while m3 is unreachable, a 404 - opens the
        // installed build instead, when there is one.
        if (response && response.type !== 'opaqueredirect' && response.ok) return response;
        const cached = await cachedDocument(url.pathname);
        if (cached) return cached;
        if (response) return response;
        throw new Error('offline, and no cached copy of this page');
      })(),
    );
    return;
  }

  if (url.pathname.startsWith(`${BASE}/_next/static/`)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: CACHE });
        return cached || fetch(request);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      let response = null;
      try {
        response = await fetch(request);
      } catch {
        response = null;
      }
      if (response && response.type !== 'opaqueredirect' && response.ok) return response;
      const cached = await caches.match(request, { cacheName: CACHE });
      if (cached) return cached;
      if (response) return response;
      throw new Error('offline, and not cached');
    })(),
  );
});
