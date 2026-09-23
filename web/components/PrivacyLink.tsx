'use client';

/**
 * PRIVACY, first of the header's links (tsunagi-m-chrome section 1) - in the preview build only.
 *
 * The preview sends things: the records an owner SYNCs and the error records the app sends by
 * itself. What it sends, and for how long, is on m3's privacy policy under #preview, and this is
 * where an owner finds it from any screen, cable in or not. A new tab, always: a same-tab
 * navigation would drop the serial link.
 *
 * Production sends nothing and has no published policy for this tool, so it draws nothing here.
 */

import { Shield } from 'lucide-react';
import { usePreviewSurfaces } from '@/lib/domain/variant';
import { privacyUrl, syncCopy } from '@/lib/copy/sync';

export function PrivacyLink() {
  const preview = usePreviewSurfaces();
  if (!preview) return null;
  return (
    <a
      href={privacyUrl()}
      target="_blank"
      rel="noopener noreferrer"
      title={syncCopy().privacyTitle}
      aria-label={syncCopy().privacyTitle}
      className="text-slate-500 transition-colors hover:text-slate-300"
    >
      <Shield className="h-5 w-5" />
    </a>
  );
}
