/*
 * Service worker for E46 M35080 /// Migration.
 *
 * This app writes to an EEPROM in a car's instrument cluster, so a stale copy
 * of it is not a cosmetic bug - it is the wrong logic deciding what to write.
 * That single constraint picks every strategy below:
 *
 *   - Documents are NETWORK-FIRST. Online you always run the current build;
 *     the cache is the offline fallback and nothing more.
 *   - /_next/static/* is content-hashed, so a hit there can never be stale.
 *     Those are cache-first. (next/font self-hosts into this path too.)
 *   - Nothing cross-origin is touched, and nothing is cached speculatively.
 *   - No skipWaiting(). Swapping the code out from under a write in flight is
 *     the one failure this tool cannot afford, so an update lands on the next
 *     cold start instead of mid-session.
 *
 * Web Serial is untouched by all of this: it is not HTTP traffic and never
 * passes through fetch.
 */

const VERSION = 'v3';
const CACHE = `m35080-migration-${VERSION}`;

/* The shell needed to open the app with no network. Deliberately tiny - the
   hashed chunks arrive through the runtime rules below. */
const SHELL = ['./', './manifest.webmanifest', './icons/migration-dev-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      /* Safe here precisely BECAUSE there is no skipWaiting: when this runs it
         is either the first install or every older client is already gone. */
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    /* Only a navigation may fall back to the shell. Handing index.html to an
       image or JSON request would be a confusing lie, not a fallback. */
    if (isNavigation) {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave third parties alone

  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});
