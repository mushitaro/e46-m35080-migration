'use client';

/**
 * The badge that says this is not a release - and, in preview, the switch that
 * makes it behave like one.
 *
 * tsunagi-m-release section 10.
 *
 *   caution  this is NOT a release              (preview)
 *   secondary this IS the release, one step away (staging, and AS PRODUCTION)
 *
 * Both are ui.tsx tints, not outlines. It used to spell `violet-*`, a namespace
 * this theme never defines - so the AS PRODUCTION and STAGING badges generated
 * no colour at all. In this theme both roles are M-violet: `amber-*` is its
 * lightest step and `indigo-*` the secondary one, so the two badges differ in
 * lightness and in their word, never in hue.
 *
 * In preview it is a <button>: pressing it closes every non-stable surface so
 * the release can be looked at without deploying one. In staging it is a
 * static <span>, because staging already IS the release candidate and has
 * nothing extra to close. In production it renders nothing at all - a release
 * carries no variant, so there is no badge to draw.
 *
 * The switch can only CLOSE. usePreviewScope ANDs the variant with the scope,
 * so no arrangement of the two opens a surface the release does not have.
 */

import { useEffect } from 'react';
import { initScope, initVariant, setScope, useScope, useVariant } from '@/lib/domain/variant';
import { pillClass } from '@/components/ui';

export function VariantBadge() {
  const variant = useVariant();
  const scope = useScope();

  /* Both reads happen after mount, never at module scope: the prerender has no
     meta tag and no localStorage, and reading them early is a hydration
     mismatch in the one control whose job is to state the truth. */
  useEffect(() => {
    initVariant();
    initScope();
  }, []);

  if (variant === 'production') return null;

  const asProduction = scope === 'production';
  const label = variant === 'staging' ? 'STAGING' : asProduction ? 'AS PRODUCTION' : 'PREVIEW';
  const badge = pillClass(asProduction || variant === 'staging' ? 'secondary' : 'caution');

  if (variant === 'staging') {
    return <span className={badge}>{label}</span>;
  }

  return (
    <button
      onClick={() => setScope(asProduction ? 'as-built' : 'production')}
      aria-pressed={asProduction}
      title={
        asProduction
          ? 'Showing only what the release shows. Click to go back to the preview build.'
          : 'Preview build. Click to hide everything the release does not have.'
      }
      className={`${badge} transition-colors hover:brightness-125`}
    >
      {label}
    </button>
  );
}
