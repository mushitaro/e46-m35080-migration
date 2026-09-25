'use client';

/**
 * The badge that says this is not a release. A label, not a control.
 *
 * tsunagi-m-release section 11.
 *
 *   caution    WORKS    this is NOT a release (the owners' build; app-variant=preview)
 *   secondary  STAGING  this IS the release, one step away
 *
 * The word is the build's app-label (brand-label.mjs), not the variant spelled in capitals: the
 * preview has been called WORKS since 2026-09-25 while its variant stays `preview`.
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
import { initVariant, useBuildLabel, useVariant } from '@/lib/domain/variant';
import { pillClass } from '@/components/ui';

export function VariantBadge() {
  const variant = useVariant();
  const label = useBuildLabel();

  /* Read after mount, never at module scope: the prerender has no meta tag,
     and reading it early is a hydration mismatch in the one element whose job
     is to state the truth. */
  useEffect(() => {
    initVariant();
  }, []);

  // A branded build always carries both tags (verify-export.mjs); without a label there is no word to show.
  if (variant === 'production' || !label) return null;

  return <span className={pillClass(variant === 'staging' ? 'secondary' : 'caution')}>{label}</span>;
}
