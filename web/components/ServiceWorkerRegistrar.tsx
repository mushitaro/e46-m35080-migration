'use client';

/**
 * Registers the service worker, and answers the one question it asks.
 *
 * Mounted from the root layout rather than the page so that PWA install does
 * not depend on which step the reader happens to be on. Renders no markup, so
 * it cannot contribute to a hydration mismatch.
 *
 * Dev is deliberately excluded: a worker caching `next dev` chunks serves a
 * build that no longer exists, and the resulting "my edit did nothing" is
 * expensive to diagnose.
 */

import { useEffect } from 'react';
import { answerBusyProbes } from '@/lib/pwa/linkBusy';

/* Static export bakes this in at build time. Empty for the Cloudflare Pages
   root deploy; a repo prefix if this is ever published under a sub-path. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    /* An installing worker asks whether the bridge is connected before it
       downloads anything (scripts/sw.template.js). Listening first, so the
       answer is ready before the first worker can ask. */
    answerBusyProbes();

    /* A worker's scope cannot rise above its own path, so both have to carry
       the base prefix or registration is rejected under a sub-path deploy. */
    navigator.serviceWorker
      .register(`${BASE}/sw.js`, { scope: `${BASE}/` })
      .catch(() => {
        /* Offline support is a bonus; the tool works without it. Never let a
           failed registration surface as an error in a bench workflow. */
      });
  }, []);

  return null;
}
