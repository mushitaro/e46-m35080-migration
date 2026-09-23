'use client';

/**
 * The badge that says this is not a release. A label, not a control.
 *
 * tsunagi-m-release section 11.
 *
 *   caution    PREVIEW  this is NOT a release
 *   secondary  STAGING  this IS the release, one step away
 *
 * In production it renders nothing at all - a release carries no variant, so
 * there is no badge to draw.
 *
 * It used to be a button that switched the preview build into an "AS
 * PRODUCTION" view. Each environment has its own URL; the way to see the
 * release is to open it. See variant.ts.
 *
 * Both are ui.tsx tints, not outlines. In this theme both roles are M-violet:
 * `amber-*` is its lightest step and `indigo-*` the secondary one, so the two
 * badges differ in lightness and in their word, never in hue.
 */

import { useEffect } from 'react';
import { initVariant, useVariant } from '@/lib/domain/variant';
import { pillClass } from '@/components/ui';

export function VariantBadge() {
  const variant = useVariant();

  /* Read after mount, never at module scope: the prerender has no meta tag,
     and reading it early is a hydration mismatch in the one element whose job
     is to state the truth. */
  useEffect(() => {
    initVariant();
  }, []);

  if (variant === 'production') return null;

  return variant === 'staging' ? (
    <span className={pillClass('secondary')}>STAGING</span>
  ) : (
    <span className={pillClass('caution')}>PREVIEW</span>
  );
}
