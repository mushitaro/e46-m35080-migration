'use client';

/**
 * Which build this is, and which scope the reader has asked for.
 *
 * tsunagi-m-release sections 5.7 and 10.
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
 */

import { useSyncExternalStore } from 'react';

export type Variant = 'preview' | 'staging' | 'production';

const SCOPE_KEY = 'm35080-odo.scope';

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

/* ------------------------- the reader's chosen scope ---------------------- */

/**
 * `production` means "show me only what the release shows".
 *
 * It can only ever close things - see enabledSurfaces, which takes a single
 * boolean and whose preview set is a superset of its production set.
 */
export type Scope = 'as-built' | 'production';

let scope: Scope = 'as-built';
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Called once on mount: the URL wins over the stored choice. */
export function initScope(): void {
  let next: Scope = 'as-built';
  try {
    next = localStorage.getItem(SCOPE_KEY) === 'production' ? 'production' : 'as-built';
  } catch {
    /* private mode: the choice just does not persist */
  }
  try {
    if (new URLSearchParams(location.search).get('scope') === 'production') {
      next = 'production';
    }
  } catch {
    /* no location, nothing to read */
  }
  if (next !== scope) {
    scope = next;
    notify();
  }
}

export function setScope(next: Scope): void {
  scope = next;
  try {
    localStorage.setItem(SCOPE_KEY, next);
  } catch {
    /* private mode */
  }
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => scope;
/* The server rendered a build that had not yet read any tag or any storage. */
const getServerSnapshot = (): Scope => 'as-built';

export function useScope(): Scope {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ------------------------------ what it means ----------------------------- */

let variant: Variant = 'production';
let variantRead = false;

/** Same store treatment: the prerender has no tag, so it answers 'production'. */
export function initVariant(): void {
  const v = readVariant();
  if (!variantRead || v !== variant) {
    variant = v;
    variantRead = true;
    notify();
  }
}

export function useVariant(): Variant {
  return useSyncExternalStore(
    subscribe,
    () => variant,
    (): Variant => 'production',
  );
}

/**
 * Whether this render may draw non-stable surfaces.
 *
 * A release is never preview whatever the stored scope says - the flag is only
 * ever ANDed, so no combination re-opens something the release closed.
 */
export function usePreviewScope(): boolean {
  const v = useVariant();
  const s = useScope();
  return v !== 'production' && s === 'as-built';
}
