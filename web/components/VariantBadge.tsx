'use client';

/**
 * The badge that says this is not a release - and, in preview, the switch that
 * makes it behave like one.
 *
 * tsunagi-m-release section 10.
 *
 *   amber   this is NOT a release            (preview)
 *   violet  this IS the release, one step away (staging, and AS PRODUCTION)
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
  const tone = asProduction || variant === 'staging'
    ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  const shape = 'rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest';

  if (variant === 'staging') {
    return <span className={`${shape} ${tone}`}>{label}</span>;
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
      className={`${shape} ${tone} transition-colors hover:brightness-125`}
    >
      {label}
    </button>
  );
}
