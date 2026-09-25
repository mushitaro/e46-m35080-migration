'use client';

/**
 * Which build this is.
 *
 * tsunagi-m-release section 5.7.
 *
 * THREE PROPERTIES THE READ HAS TO HAVE
 *
 * 1. ONE COMPILED OUTPUT FOR EVERY VARIANT. The variant arrives as a `<meta>`
 *    tag, never as a compile-time branch, so production and preview ship the
 *    same bytes and a feature tested in preview is promoted by changing a
 *    stage - not by porting code that has never run in the release build.
 *
 * 2. SAFE AT HYDRATION. A module-scope `document.querySelector` runs before
 *    the DOM on the server and then returns, on the client, something the
 *    prerender never had. That is a hydration mismatch in the one component
 *    whose whole job is to say what this build is. `useSyncExternalStore` with
 *    a server snapshot of "not preview" is the fix.
 *
 * 3. EMPTY IS PRODUCTION. A release carries no variant. Nothing is named
 *    'production', because a name for the absence creates a value some code
 *    path can compare against and none should.
 *
 * WHAT THIS FILE NO LONGER DOES
 *
 * It used to hold a reader-chosen "scope": a PREVIEW <-> AS PRODUCTION switch
 * on the badge that hid preview-only surfaces inside the preview build. It is
 * gone. Each environment has its own URL - to see what the release shows, open
 * the release (or staging, which exists for exactly that); a preview that can
 * pretend to be production is a second, unreliable way of asking the same
 * question. The build decides what is drawn; the reader does not.
 */

import { useSyncExternalStore } from 'react';

export type Variant = 'preview' | 'staging' | 'production';

/**
 * Where the retired switch stored its choice. Deleted at boot and never read:
 * a reader who once pressed AS PRODUCTION must not stay in it with no way out.
 */
const RETIRED_SCOPE_KEY = 'm35080-odo.scope';

/** Read the tag the build was stamped with. Absent or empty means a release. */
export function readVariant(): Variant {
  if (typeof document === 'undefined') return 'production';
  const v = document
    .querySelector('meta[name="app-variant"]')
    ?.getAttribute('content')
    ?.trim()
    .toLowerCase();
  return v === 'preview' || v === 'staging' ? v : 'production';
}

/**
 * What the build is CALLED - `WORKS` on the preview (operator, 2026-09-25), `STAGING` on staging,
 * '' on a release. Display only: brand-preview.mjs stamps it from scripts/brand-label.mjs beside
 * app-variant, and nothing compares it. The variant is still what decides.
 */
export function readLabel(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector('meta[name="app-label"]')?.getAttribute('content')?.trim() ?? '';
}

let variant: Variant = 'production';
let label = '';
let variantRead = false;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called once on mount. The prerender has no tag, so it answered 'production'. */
export function initVariant(): void {
  try {
    localStorage.removeItem(RETIRED_SCOPE_KEY);
  } catch {
    /* private mode: nothing was stored */
  }
  const v = readVariant();
  const l = readLabel();
  if (!variantRead || v !== variant || l !== label) {
    variant = v;
    label = l;
    variantRead = true;
    for (const fn of listeners) fn();
  }
}

export function useVariant(): Variant {
  return useSyncExternalStore(
    subscribe,
    () => variant,
    (): Variant => 'production',
  );
}

/** The build's name for the badge; '' until mounted, and on a release. */
export function useBuildLabel(): string {
  return useSyncExternalStore(
    subscribe,
    () => label,
    () => '',
  );
}

/**
 * Whether this build may draw non-stable surfaces.
 *
 * Preview only. Staging is the release before it is released and must not
 * show more than production does (tsunagi-m-release section 11).
 */
export function usePreviewSurfaces(): boolean {
  return useVariant() === 'preview';
}
