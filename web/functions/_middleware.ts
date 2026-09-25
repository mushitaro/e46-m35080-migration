/**
 * The owner gate, in front of everything this origin serves.
 *
 * The preview is for people m3.tsunagi.app says hold `owner_preview` - MILE purchasers and the
 * owners whose cars were worked on - and for nobody else. That includes the app itself: this is an
 * EEPROM writer, and an unreleased build of one is not something to hand to whoever has the URL.
 * The gate is tsunagi-m3's canonical copy (`_owner-gate/`, checked byte for byte by `npm run
 * gate:verify`); this file only says which app it is guarding. Change the gate there, not here.
 *
 * `publicPaths` is what a browser fetches WITHOUT cookies: the manifest, and the icons it and the
 * document head name. Installing a PWA reads those anonymously, and a 401 there reads to Chrome as
 * "this app has no icon". They are the preview's own (-dev-) names, because scripts/brand-preview.mjs
 * moves every reference to that set - the production icons are never requested here - and
 * scripts/verify-export.mjs fails a branded build that names an icon missing from this list.
 *
 * wrangler runs from web/ (scripts/deploy.mjs), so these functions are web/functions/.
 */
import { createGate, type GateContext } from './_owner-gate/gate';

const gate = createGate({
  clientId: 'm35080-preview',
  canonicalHost: 'e46-m35080-migration-preview.pages.dev',
  name: 'E46 M35080 /// MIGRATION — WORKS',
  publicPaths: [
    '/manifest.webmanifest',
    '/icons/migration-dev-192.png',
    '/icons/migration-dev-512.png',
    '/icons/migration-dev-maskable-192.png',
    '/icons/migration-dev-maskable-512.png',
    '/icons/migration-dev-256.png',
    '/icons/migration-dev-32.png',
  ],
});

// Pages hands the middleware its full EventContext; the gate reads four members of it and says so
// in its own type.
export const onRequest = (context: GateContext) => gate(context);
